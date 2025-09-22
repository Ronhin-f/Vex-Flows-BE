import axios from "axios";

/** payload: { text?, blocks? } */
export async function send(payload = {}) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error("SLACK_WEBHOOK_URL falta en .env");

  const body = payload.blocks ? { blocks: payload.blocks } : { text: payload.text || "" };
  await axios.post(url, body);
  return { ok: true };
}

export default { send };
