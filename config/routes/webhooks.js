// routes/webhooks.js  (o donde tengas las rutas públicas)
import express from "express";
const router = express.Router();

/**
 * Webhook compatible con VEX FLOWS.
 * Recibe { type: "gmail.message.created", email:{from_name,from_address,subject,snippet} }
 * y lo reenvía al motor de eventos /flows/events (misma estructura que usamos para test).
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

    // Enriquecemos con defaults útiles para tus flows
    payload.leadDefaults = {
      source: "gmail",
      owner_email: process.env.DEFAULT_GMAIL_OWNER_EMAIL || "austin@sanjuantuff.com",
    };

    // >>> Si ya tenés /flows/events, reusalo directamente:
    // nota: si preferís no llamar HTTP interno, invocá tu función de dispatcher aquí.
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

export default router;
