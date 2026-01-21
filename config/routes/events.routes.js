import express from "express";
import auth from "../middleware/auth.js";

/**
 * Unified ingestion endpoint for CRM/Stock events.
 * Requires org_id in payload or authenticated user.
 */
export default function buildEventsRouter({
  createRun,
  postToSlack,
  getSlackWebhook,
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

  function resolveOrgId(req, payload) {
    const fromPayload = payload?.org_id || payload?.organizacion_id;
    const fromUser = req.user?.org_id || req.user?.orgId;
    return fromPayload || fromUser || null;
  }

  async function optionalAuth(req, res, next) {
    const hasBearer =
      typeof req.headers.authorization === "string" &&
      req.headers.authorization.startsWith("Bearer ");
    if (!hasBearer) return next();
    return auth(req, res, next);
  }

  async function notifySlack(org_id, text) {
    const webhook = (await getSlackWebhook?.(org_id)) || process.env.SLACK_WEBHOOK_URL;
    if (!webhook) return;
    try {
      await postToSlack(webhook, text);
    } catch (e) {
      console.warn("[events] slack notify failed:", e?.message);
    }
  }

  router.post("/flows/events", authGuard, optionalAuth, express.json(), async (req, res) => {
    try {
      const { source = "crm", event, payload = {} } = req.body || {};
      if (!event) return res.status(400).json({ ok: false, error: "event_required" });

      const org_id = resolveOrgId(req, payload);
      if (!org_id) return res.status(400).json({ ok: false, error: "org_id_required" });

      const handled = { notified: false, runs: [] };

      if (source === "crm" || event.startsWith("crm.")) {
        switch (event) {
          case "crm.deal.bid_sent": {
            const flowName = "Bid sent -> Slack reminders";
            const runId = await createRun({
              org_id,
              flow_name: flowName,
              status: "queued",
              meta: { event, payload },
            });
            handled.runs.push(runId);
            handled.notified = true;
            break;
          }
          case "crm.deal.stalled": {
            const deal = payload?.deal?.name || payload?.deal_name || "Deal";
            const owner = payload?.deal?.owner || payload?.owner || "owner";
            const text = `Deal stalled: ${deal} (owner: ${owner})`;
            await notifySlack(org_id, text);
            const runId = await createRun({
              org_id,
              flow_name: "Deal stalled reminder",
              status: "ok",
              meta: { event, deal },
            });
            handled.runs.push(runId);
            handled.notified = true;
            break;
          }
          case "crm.deal.won": {
            const deal = payload?.deal?.name || payload?.deal_name || "Deal";
            const text = `Deal won: ${deal}`;
            await notifySlack(org_id, text);
            const runId = await createRun({
              org_id,
              flow_name: "Deal won thank-you",
              status: "ok",
              meta: { event, deal },
            });
            handled.runs.push(runId);
            handled.notified = true;
            break;
          }
          default:
            break;
        }
      }

      if (source === "stock" || event.startsWith("stock.")) {
        switch (event) {
          case "stock.product.low": {
            const sku = payload?.product?.sku || payload?.sku || "SKU";
            const qty = payload?.product?.qty || payload?.qty || "?";
            const text = `Stock low: ${sku} (qty: ${qty})`;
            await notifySlack(org_id, text);
            const runId = await createRun({
              org_id,
              flow_name: "Low stock reminder",
              status: "ok",
              meta: { event, sku, qty },
            });
            handled.runs.push(runId);
            handled.notified = true;
            break;
          }
          case "stock.order.delayed": {
            const order = payload?.order?.id || payload?.order_id || "order";
            const text = `Order delayed: ${order}`;
            await notifySlack(org_id, text);
            const runId = await createRun({
              org_id,
              flow_name: "Order delayed reminder",
              status: "ok",
              meta: { event, order },
            });
            handled.runs.push(runId);
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
