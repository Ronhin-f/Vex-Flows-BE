import axios from "axios";

export async function sendSlack({ webhook, text }) {
  const url = webhook || process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error("Slack webhook not configured");
  const r = await axios.post(url, { text });
  return { status: r.status, data: r.data };
}
