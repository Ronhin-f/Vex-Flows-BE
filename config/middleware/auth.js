// backend/config/middleware/auth.js
import jwt from "jsonwebtoken";

/** Default: auth */
export default function auth(req, res, next) {
  const hdr = req.headers["authorization"] || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;

  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing bearer token" });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: "Invalid or expired token" });
  }
}

/** Alias named export: requireAuth (para compatibilidad con tus rutas) */
export const requireAuth = auth;

/** Opcional: chequeo de rol */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Unauthenticated" });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    next();
  };
}
