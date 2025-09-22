import nodemailer from "nodemailer";

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP_HOST/SMTP_USER/SMTP_PASS faltan en .env");
  }
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

/** payload: { to, subject, text?, html? } */
export async function send(payload = {}) {
  const { to, subject, text = undefined, html = undefined } = payload;
  if (!to || !subject) throw new Error("Campos 'to' y 'subject' son obligatorios");
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  const transporter = createTransport();
  const info = await transporter.sendMail({ from, to, subject, text, html });
  return { ok: true, messageId: info.messageId };
}

export default { send };
