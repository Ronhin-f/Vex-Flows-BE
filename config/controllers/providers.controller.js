export async function testEmail(req, res) {
  const { to = "demo@example.com", subject = "Vex test", body = "Hola 👋" } = req.body || {};
  console.log("[providers] testEmail ->", { to, subject });
  return res.json({ ok: true, channel: "email", to, subject, preview: true });
}

export async function testSlack(req, res) {
  const { channel = "#general", text = "Hola Slack 👋" } = req.body || {};
  console.log("[providers] testSlack ->", { channel, text });
  return res.json({ ok: true, channel: "slack", target: channel, preview: true });
}

export async function testWhatsapp(req, res) {
  const { to = "+541111111111", text = "Hola WhatsApp 👋" } = req.body || {};
  console.log("[providers] testWhatsapp ->", { to, text });
  return res.json({ ok: true, channel: "whatsapp", to, preview: true });
}

// ⚠️ No pongas `export default ...` acá.
