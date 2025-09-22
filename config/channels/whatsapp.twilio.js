import axios from "axios";

export async function send({ to, body } = {}) {
  const sid = process.env.TWILIO_SID;
  const token = process.env.TWILIO_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM; // ej: 14155238886
  if (!sid || !token || !from) throw new Error("TWILIO_SID/TWILIO_TOKEN/TWILIO_WHATSAPP_FROM faltan en .env");
  if (!to || !body) throw new Error("Campos 'to' y 'body' son obligatorios");

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const params = new URLSearchParams({ From: `whatsapp:${from}`, To: `whatsapp:${to}`, Body: body });
  await axios.post(url, params, { auth: { username: sid, password: token } });
  return { ok: true };
}

export default { send };
