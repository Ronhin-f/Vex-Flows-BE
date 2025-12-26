// routes/webhooks.js  (o donde tengas las rutas publicas)
import express from "express";
import { sendEmail } from "../services/providers/email.js";

const router = express.Router();

/**
 * Webhook compatible con VEX FLOWS.
 * Recibe { type: "gmail.message.created", email:{from_name,from_address,subject,snippet} }
 * y lo reenvia al motor de eventos /flows/events (misma estructura que usamos para test).
 */
router.post("/webhooks/gmail", express.json(), async (req, res) => {
  try {
    const secret = req.get("X-VEX-SECRET");
    if (!secret || secret !== process.env.GMAIL_WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const payload = req.body || {};
    if (payload?.type !== "gmail.message.created") {
      return res.status(400).json({ ok: false, error: "bad_type" });
    }

    // Enriquecemos con defaults utiles para tus flows
    payload.leadDefaults = {
      source: "gmail",
      owner_email: process.env.DEFAULT_GMAIL_OWNER_EMAIL || "austin@sanjuantuff.com",
    };

    // Si ya tenes /flows/events, reusalo directamente:
    // nota: si preferis no llamar HTTP interno, invoca tu funcion de dispatcher aqui.
    const fetch = (await import("node-fetch")).default;
    const base = process.env.PUBLIC_API_BASE || `http://localhost:${process.env.PORT || 3000}`;
    const r = await fetch(`${base}/flows/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await r.json();
    return res.status(200).json({ ok: true, forwarded: true, out });
  } catch (e) {
    console.error("[/webhooks/gmail] error", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * Webhook de Core: password reset
 * Espera:
 * - Header: X-VEX-SECRET = PASSWORD_RESET_WEBHOOK_SECRET
 * - Body: { email, reset_url?, token?, org_id?, usuario_email? }
 */
router.post("/webhooks/core/password-reset", express.json(), async (req, res) => {
  try {
    const secret = req.get("X-VEX-SECRET");
    if (!secret || secret !== process.env.PASSWORD_RESET_WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const { email, reset_url, token, org_id } = req.body || {};
    if (!email) {
      return res.status(400).json({ ok: false, error: "email requerido" });
    }

    const base = process.env.PASSWORD_RESET_URL_BASE;
    const builtUrl = base && token
      ? `${base}?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
      : null;
    const finalUrl = reset_url || builtUrl;

    if (!finalUrl) {
      return res.status(400).json({ ok: false, error: "reset_url o token requerido" });
    }

    const subject = process.env.PASSWORD_RESET_EMAIL_SUBJECT || "Recuperar contrasenia";
    const text = [
      "Hola,",
      "",
      "Para recuperar tu contrasenia, usa este link:",
      finalUrl,
      "",
      "Si no fuiste vos, ignora este email.",
      org_id ? `Org: ${org_id}` : null,
    ].filter(Boolean).join("\n");

    const out = await sendEmail({ to: email, subject, text });

    return res.json({ ok: true, sent: true, preview: out?.preview || null });
  } catch (e) {
    console.error("[/webhooks/core/password-reset] error", e);
    return res.status(500).json({ ok: false, error: "send_failed" });
  }
});

export default router;
