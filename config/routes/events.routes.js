import express from "express";

const router = express.Router();

/**
 * Endpoint de eventos de Flows.
 * Hoy manejamos: "gmail.message.created" → avisa por Slack (via Slack Incoming Webhook).
 */
router.post("/flows/events", express.json(), async (req, res) => {
  try {
    const { type, email = {}, leadDefaults = {} } = req.body || {};
    if (type !== "gmail.message.created") {
      return res.status(400).json({ ok: false, error: "unsupported_type" });
    }

    const owner = leadDefaults.owner_email || process.env.DEFAULT_GMAIL_OWNER_EMAIL || "austin@sanjuanthuff.com";
    const text =
      `🆕 New Gmail lead\n` +
      `From: ${email.from_name || "-"} <${email.from_address || "-"}>\n` +
      `Subject: ${email.subject || "-"}\n` +
      `${(email.snippet || "").slice(0, 200)}\n` +
      `Owner: ${owner}`;

    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      return res.status(500).json({ ok: false, error: "SLACK_WEBHOOK_URL missing" });
    }

    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return res.status(502).json({ ok: false, error: `slack_failed ${r.status}: ${t}` });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("[/flows/events] error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
