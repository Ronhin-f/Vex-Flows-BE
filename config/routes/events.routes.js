import express from "express";

/**
 * Endpoint de ingestion unificada para eventos de CRM/Stock.
 *
 * Payload:
 * {
 *   source: "crm" | "stock",
 *   event:  "crm.deal.bid_sent" | "crm.deal.stalled" | "crm.deal.won" | "stock.product.low" | "stock.order.delayed",
 *   payload: { ... } // ver handlers abajo
 * }
 *
 * Seguridad:
 *  - Si EVENTS_TOKEN está seteado, exigimos header X-Events-Token o Authorization: Bearer <token>
 *  - Si no, es público (solo para PoC).
 */
export default function buildEventsRouter({
  mem,
  pushRun,
  postToSlack,
  getSlackWebhook,
  scheduleSlackPosts,
}) {
  const router = express.Router();
  const EVENTS_TOKEN = process.env.EVENTS_TOKEN || "";

  function authGuard(req, res, next) {
    if (!EVENTS_TOKEN) return next();
    const hdr = req.headers["x-events-token"] || req.headers.authorization || "";
    const tok = hdr.startsWith("Bearer ") ? hdr.slice(7) : hdr;
    if (tok && tok === EVENTS_TOKEN) return next();
    return res.status(401).json({ ok: false, error: "invalid_events_token" });
  }

  async function notifySlack(org_id, text) {
    const webhook = getSlackWebhook?.(org_id) || process.env.SLACK_WEBHOOK_URL;
    if (!webhook) return;
    try {
      await postToSlack(webhook, text);
    } catch (e) {
      console.warn("[events] slack notify failed:", e?.message);
    }
  }

  router.post("/flows/events", authGuard, express.json(), async (req, res) => {
    try {
      const { source = "crm", event, payload = {} } = req.body || {};
      if (!event) return res.status(400).json({ ok: false, error: "event requerido" });

      const org_id = payload.org_id || mem?.orgId || 1;
      const handled = { notified: false, runs: [] };

      // --- CRM handlers ---
      if (source === "crm" || event.startsWith("crm.")) {
        switch (event) {
          case "crm.deal.bid_sent": {
            // Cadencia de Slack (reusa scheduleSlackPosts si hay webhook)
            const flow = {
              id: 9_001,
              name: "Bid sent -> Slack reminders",
              definition_json: {
                steps: [
                  { type: "slack.post", delay_days: 1, template: "Follow-up 1/4 for *{{deal.name}}* (bid sent)" },
                  { type: "slack.post", delay_days: 4, template: "Follow-up 2/4 for *{{deal.name}}*" },
                  { type: "slack.post", delay_days: 7, template: "Follow-up 3/4 for *{{deal.name}}*" },
                  { type: "slack.post", delay_days: 12, template: "Final follow-up for *{{deal.name}}*" },
                ],
              },
            };
            const created = scheduleSlackPosts ? scheduleSlackPosts({ org_id, flow, payload }) : [];
            if (created.length === 0 && pushRun) {
              const r = pushRun({
                org_id,
                flow_name: flow.name,
                status: "scheduled",
                meta: { event, deal: payload?.deal?.name || payload?.deal_name },
              });
              handled.runs.push(r?.id);
            } else {
              handled.runs.push(...created);
            }
            handled.notified = true;
            break;
          }
          case "crm.deal.stalled": {
            const deal = payload?.deal?.name || payload?.deal_name || "Deal";
            const owner = payload?.deal?.owner || payload?.owner || "owner";
            const text = `⚠️ Deal estancado: *${deal}* (owner: ${owner})`;
            await notifySlack(org_id, text);
            if (pushRun) {
              const r = pushRun({ org_id, flow_name: "Deal stalled reminder", status: "ok", meta: { event, deal } });
              handled.runs.push(r?.id);
            }
            handled.notified = true;
            break;
          }
          case "crm.deal.won": {
            const deal = payload?.deal?.name || payload?.deal_name || "Deal";
            const text = `🏁 Deal ganado: *${deal}*`;
            await notifySlack(org_id, text);
            if (pushRun) {
              const r = pushRun({ org_id, flow_name: "Deal won thank-you", status: "ok", meta: { event, deal } });
              handled.runs.push(r?.id);
            }
            handled.notified = true;
            break;
          }
          default:
            // Otros eventos CRM no manejados
            break;
        }
      }

      // --- Stock handlers ---
      if (source === "stock" || event.startsWith("stock.")) {
        switch (event) {
          case "stock.product.low": {
            const sku = payload?.product?.sku || payload?.sku || "SKU";
            const qty = payload?.product?.qty || payload?.qty || "?";
            const text = `📦 Stock bajo: ${sku} (qty: ${qty})`;
            await notifySlack(org_id, text);
            if (pushRun) {
              const r = pushRun({ org_id, flow_name: "Low stock reminder", status: "ok", meta: { event, sku, qty } });
              handled.runs.push(r?.id);
            }
            handled.notified = true;
            break;
          }
          case "stock.order.delayed": {
            const order = payload?.order?.id || payload?.order_id || "order";
            const text = `⏳ Pedido atrasado: ${order}`;
            await notifySlack(org_id, text);
            if (pushRun) {
              const r = pushRun({ org_id, flow_name: "Order delayed reminder", status: "ok", meta: { event, order } });
              handled.runs.push(r?.id);
            }
            handled.notified = true;
            break;
          }
          default:
            break;
        }
      }

      return res.status(handled.notified ? 202 : 200).json({
        ok: true,
        event,
        source,
        handled: handled.notified,
        created_runs: handled.runs,
      });
    } catch (e) {
      console.error("[/flows/events] error:", e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  return router;
}
