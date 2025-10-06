// backend/config/middleware/auth.js
import axios from "axios";
import jwt from "jsonwebtoken";

/**
 * Modo de autenticación:
 *  - CORE_AUTH_MODE=jwt          -> valida local con CORE_JWT_SECRET o JWT_SECRET
 *  - CORE_AUTH_MODE=introspect   -> valida contra CORE_URL + CORE_INTROSPECT_PATH (GET)
 * Env útiles:
 *  - CORE_URL=https://<core>.up.railway.app
 *  - CORE_INTROSPECT_PATH=/api/auth/introspect
 *  - CORE_JWT_SECRET=xxxxx    (o JWT_SECRET)
 *  - ALLOW_ANON=true          (sólo DEV; permite pasar sin token)
 */

const MODE = (process.env.CORE_AUTH_MODE || "introspect").toLowerCase();
const CORE_URL = (process.env.CORE_URL || "").replace(/\/$/, "");
const INTROSPECT_PATH = process.env.CORE_INTROSPECT_PATH || "/api/auth/introspect";
const ALLOW_ANON = String(process.env.ALLOW_ANON || "false").toLowerCase() === "true";

// Cache simple en memoria para /introspect (60s)
const cache = new Map(); // token -> { payload, exp }
function getFromCache(token) {
  const hit = cache.get(token);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    cache.delete(token);
    return null;
  }
  return hit.payload;
}
function setInCache(token, payload, ttlMs = 60000) {
  cache.set(token, { payload, exp: Date.now() + ttlMs });
}

/** Normaliza el usuario para req.user */
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
  // cache
  const cached = getFromCache(token);
  if (cached) return cached;

  if (!CORE_URL) throw new Error("CORE_URL not configured");

  const { data } = await axios.get(`${CORE_URL}${INTROSPECT_PATH}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 5000,
    validateStatus: () => true,
  });

  if (!data || data.active !== true) {
    throw new Error("invalid_token");
  }

  // data.user sugerido: { id, email, org_id, role }
  const user = normalizeUser(data.user || data);
  setInCache(token, user);
  return user;
}

function validateWithJwt(token) {
  const secret = process.env.CORE_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("missing_secret");
  const payload = jwt.verify(token, secret); // lanza si no es válido
  return normalizeUser(payload);
}

/** Default: auth */
export default async function auth(req, res, next) {
  try {
    const hdr = req.headers["authorization"] || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;

    if (!token) {
      if (ALLOW_ANON) {
        req.user = { org_id: 1, email: "anon@dev" };
        return next();
      }
      return res.status(401).json({ ok: false, error: "Missing bearer token" });
    }

    let user;
    if (MODE === "jwt") {
      user = validateWithJwt(token);
    } else {
      user = await validateWithIntrospect(token);
    }

    if (!user || !user.org_id) user = { ...user, org_id: 1 };
    req.user = user;
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

/** Alias compatible con tus rutas */
export const requireAuth = auth;

/** Chequeo de rol (opcional) */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Unauthenticated" });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    next();
  };
}
