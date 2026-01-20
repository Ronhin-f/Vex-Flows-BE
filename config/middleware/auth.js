// backend/config/middleware/auth.js
import axios from "axios";
import jwt from "jsonwebtoken";

/**
 * Auth modes:
 *  - CORE_AUTH_MODE=jwt        -> local validate with CORE_JWT_SECRET or JWT_SECRET
 *  - CORE_AUTH_MODE=introspect -> validate via CORE_URL + CORE_INTROSPECT_PATH (GET)
 * Env:
 *  - CORE_URL=https://<core>.up.railway.app
 *  - CORE_INTROSPECT_PATH=/api/auth/introspect
 *  - CORE_JWT_SECRET=xxxxx (or JWT_SECRET)
 *  - ALLOW_ANON=true (dev only)
 */

const MODE = (process.env.CORE_AUTH_MODE || "introspect").toLowerCase();
const CORE_URL = (process.env.CORE_URL || "").replace(/\/$/, "");
const INTROSPECT_PATH = process.env.CORE_INTROSPECT_PATH || "/api/auth/introspect";
const ALLOW_ANON = String(process.env.ALLOW_ANON || "false").toLowerCase() === "true";

// Simple 60s cache
const cache = new Map(); // token -> { payload, exp }
const getFromCache = (t) => {
  const hit = cache.get(t);
  if (!hit) return null;
  if (Date.now() > hit.exp) return cache.delete(t), null;
  return hit.payload;
};
const setInCache = (t, payload, ttlMs = 60_000) =>
  cache.set(t, { payload, exp: Date.now() + ttlMs });

function normalizeUser(src = {}) {
  return {
    id: src.id || src.sub || src.user_id,
    email: src.email || src.user?.email,
    org_id: src.org_id || src.user?.org_id || 1,
    role: src.role || src.user?.role || "user",
    ...src,
  };
}

async function validateWithIntrospect(token) {
  const cached = getFromCache(token);
  if (cached) return cached;
  if (!CORE_URL) throw new Error("CORE_URL not configured");

  const { data, status } = await axios.get(`${CORE_URL}${INTROSPECT_PATH}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 5000,
    validateStatus: () => true,
  });

  const active = !!(data && (data.ok === true || data.active === true));
  if (!active) {
    const reason = data?.error || data?.message || "invalid_token";
    const err = new Error(reason);
    err.status = status || 401;
    throw err;
  }

  const user = normalizeUser(data.user || data);
  setInCache(token, user);
  return user;
}

function validateWithJwt(token) {
  const secret = process.env.CORE_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("missing_secret");
  const payload = jwt.verify(token, secret); // throws if invalid
  return normalizeUser(payload);
}

export default async function auth(req, res, next) {
  try {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;

    if (!token) {
      if (ALLOW_ANON) {
        req.user = { org_id: 1, email: "anon@dev" };
        return next();
      }
      return res.status(401).json({ ok: false, error: "Missing bearer token" });
    }

    const user =
      MODE === "jwt" ? validateWithJwt(token) : await validateWithIntrospect(token);

    req.user = user && user.org_id ? user : { ...user, org_id: 1 };
    return next();
  } catch (err) {
    if (ALLOW_ANON) {
      req.user = { org_id: 1, email: "anon@dev" };
      return next();
    }
    const msg =
      err?.name === "JsonWebTokenError" || err?.name === "TokenExpiredError"
        ? "Invalid or expired token"
        : "core_auth_failed";
    return res.status(401).json({ ok: false, error: msg });
  }
}

export const requireAuth = auth;

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Unauthenticated" });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    next();
  };
}
