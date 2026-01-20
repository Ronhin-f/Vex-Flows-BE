// backend/index.js
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import webhooks from "./config/routes/webhooks.js";

import { initSchema, pingDb, pool } from "./db.js";

import providersRoutes from "./config/routes/providers.routes.js";
import flowsRoutes from "./config/routes/flows.routes.js";
import messagesRoutes from "./config/routes/messages.routes.js";
import triggersRoutes from "./config/routes/triggers.routes.js";

import buildEventsRoutes from "./config/routes/events.routes.js";

import auth from "./config/middleware/auth.js";

let initScheduler = () => console.log("[scheduler] omitted (optional)");
try {
  ({ initScheduler } = await import("./config/services/scheduler.service.js"));
} catch (e) {
  console.warn("[scheduler] not loaded:", e?.message);
}

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("tiny"));

const DEV_CORS_OPEN = String(process.env.DEV_CORS_OPEN || "false").toLowerCase() === "true";
const rawOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const allowset = new Set(rawOrigins);
console.log("[CORS] allowset:", [...allowset], "DEV_CORS_OPEN:", DEV_CORS_OPEN);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (DEV_CORS_OPEN) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else if (origin && allowset.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With");

  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.get("/api/health", async (_req, res) => {
  try {
    await pingDb();
    res.json({ ok: true, service: "vex-flows-backend", db: "up" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "db error", code: e?.code });
  }
});
app.get("/", (_req, res) => res.status(200).send("ok: vex-flows-be"));
app.get(["/health", "/healthz"], (_req, res) => res.json({ ok: true, service: "vex-flows-backend" }));

const PROVIDERS = [
  { id: "gmail", kind: "gmail", label: "Gmail", desc: "1 min - 3 steps" },
  { id: "whatsapp", kind: "whatsapp", label: "WhatsApp", desc: "Business accounts only" },
  { id: "sms", kind: "sms", label: "SMS", desc: "Requires Twilio SID/Token" },
  { id: "slack", kind: "slack", label: "Slack", desc: "1 min - 2 steps" },
];

function getOrgId(req) {
  const raw = req?.user?.org_id || req?.user?.orgId || "1";
  return String(raw || "1");
}

async function listProviders(org_id) {
  const { rows } = await pool.query(
    "SELECT provider_id, status, updated_at FROM flow_providers WHERE organizacion_id = $1",
    [org_id]
  );
  const map = new Map(rows.map((r) => [r.provider_id, r]));
  return PROVIDERS.map((p) => {
    const row = map.get(p.id);
    return {
      ...p,
      status: row?.status || "pending",
      last_check_at: row?.updated_at || null,
    };
  });
}

async function connectProvider(org_id, id, credentials) {
  const exists = PROVIDERS.find((p) => p.id === id);
  if (!exists) throw new Error("provider_not_found");

  await pool.query(
    `
      INSERT INTO flow_providers (organizacion_id, provider_id, status, credentials, updated_at)
      VALUES ($1,$2,'connected',$3::jsonb, now())
      ON CONFLICT (organizacion_id, provider_id)
      DO UPDATE SET status = 'connected', credentials = EXCLUDED.credentials, updated_at = now()
    `,
    [org_id, id, JSON.stringify(credentials || {})]
  );

  return { status: "connected" };
}

async function getSlackWebhook(org_id) {
  const { rows } = await pool.query(
    "SELECT credentials FROM flow_providers WHERE organizacion_id = $1 AND provider_id = 'slack' AND status = 'connected' LIMIT 1",
    [org_id]
  );
  const creds = rows[0]?.credentials || {};
  return creds.webhook_url || process.env.SLACK_WEBHOOK_URL || null;
}

async function postToSlack(webhookUrl, text) {
  if (!webhookUrl) throw new Error("missing_slack_webhook");
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`slack_post_failed ${res.status}: ${t}`);
  }
}

const getRecipes = async () => ([
  { id: "lead_whatsapp_task", title: "New lead -> WhatsApp + Task", trigger: "crm.lead.created" },
  { id: "lead_won", title: "Lead won", trigger: "crm.lead.won" },
  { id: "invoice_due", title: "Invoice expiring", trigger: "billing.invoice.due" },
  { id: "bid_sent_slack", title: "Bid sent -> Slack reminders", trigger: "crm.deal.bid_sent" },
]);

async function createRun({
  org_id,
  flow_id = null,
  flow_name = "Flow",
  status = "pending",
  error = null,
  meta = {},
}) {
  const finishedAt = status === "ok" || status === "error" ? new Date().toISOString() : null;
  const { rows } = await pool.query(
    `
      INSERT INTO flow_runs (organizacion_id, flow_id, status, error, meta, started_at, finished_at)
      VALUES ($1,$2,$3,$4,$5::jsonb, now(), $6)
      RETURNING id
    `,
    [org_id, flow_id, status, error, JSON.stringify({ flow_name, ...meta }), finishedAt]
  );
  return rows[0]?.id;
}

app.get("/api/providers", auth, async (req, res) => {
  try {
    const org_id = getOrgId(req);
    const rows = await listProviders(org_id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/flows/recipes", async (_req, res) => {
  try {
    res.json(await getRecipes());
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/flow-runs", auth, async (req, res) => {
  try {
    const org_id = getOrgId(req);
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    const { rows } = await pool.query(
      `
        SELECT r.id, r.status, r.started_at, COALESCE(f.name, r.meta->>'flow_name') AS flow_name
        FROM flow_runs r
        LEFT JOIN flows f ON f.id = r.flow_id
        WHERE r.organizacion_id = $1
        ORDER BY r.started_at DESC
        LIMIT $2
      `,
      [org_id, limit]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/providers/:id/connect", auth, async (req, res) => {
  try {
    const org_id = getOrgId(req);
    const id = req.params.id;
    const credentials = req.body?.credentials || {};
    const out = await connectProvider(org_id, id, credentials);
    res.json(out);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/flows/create", auth, async (req, res) => {
  const org_id = getOrgId(req);
  const { name, trigger, steps } = req.body || {};

  if (!name || typeof name !== "string") {
    return res.status(400).json({ ok: false, error: "name_required" });
  }
  if (!trigger || typeof trigger !== "string") {
    return res.status(400).json({ ok: false, error: "trigger_required" });
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ ok: false, error: "steps_required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const flowRes = await client.query(
      `
        INSERT INTO flows (organizacion_id, name, trigger, active, meta, created_by)
        VALUES ($1,$2,$3,true,'{}'::jsonb,$4)
        RETURNING id
      `,
      [org_id, name, trigger, req.user?.email || "system"]
    );
    const flowId = flowRes.rows[0].id;

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i] || {};
      const type = step.type;
      if (!type) throw new Error("step_type_required");
      const { type: _omit, ...config } = step;
      await client.query(
        `
          INSERT INTO flow_steps (flow_id, organizacion_id, position, type, config)
          VALUES ($1,$2,$3,$4,$5::jsonb)
        `,
        [flowId, org_id, i + 1, type, JSON.stringify(config)]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ ok: true, id: flowId });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(400).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.post("/api/flows/publish", auth, async (req, res) => {
  try {
    const org_id = getOrgId(req);
    const { flow_id } = req.body || {};
    if (!flow_id) return res.status(400).json({ ok: false, error: "flow_id_required" });

    const { rowCount } = await pool.query(
      "UPDATE flows SET active = true, updated_at = now() WHERE id = $1 AND organizacion_id = $2",
      [flow_id, org_id]
    );
    if (!rowCount) return res.status(404).json({ ok: false, error: "flow_not_found" });
    res.json({ ok: true, flow_id, status: "published" });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/triggers/emit", auth, async (req, res) => {
  try {
    const org_id = getOrgId(req);
    const { event, payload } = req.body || {};
    if (!event) return res.status(400).json({ ok: false, error: "event_required" });

    const { rows: flows } = await pool.query(
      "SELECT id, name FROM flows WHERE organizacion_id = $1 AND active = true AND trigger = $2",
      [org_id, event]
    );

    const createdRuns = [];
    for (const f of flows) {
      const runId = await createRun({
        org_id,
        flow_id: f.id,
        flow_name: f.name,
        status: "queued",
        meta: { event, payload: payload || {} },
      });
      createdRuns.push(runId);
    }

    res.status(202).json({
      ok: true,
      event,
      matched_flows: flows.map((f) => f.id),
      created_runs: createdRuns,
    });
  } catch (e) {
    console.error("[emit] error:", e);
    res.status(500).json({ ok: false, error: "emit_failed" });
  }
});

app.use("/api/providers", providersRoutes);
app.use("/api/flows", auth, flowsRoutes);
app.use("/api/messages", auth, messagesRoutes);
app.use("/api/triggers", auth, triggersRoutes);

app.use(webhooks);
app.use(
  buildEventsRoutes({
    createRun,
    postToSlack,
    getSlackWebhook,
  })
);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found", path: req.path });
});

const isRailway = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_STATIC_URL;
const PORT = isRailway ? Number(process.env.PORT) : Number(process.env.PORT || 8082);
const HOST = "0.0.0.0";

app.listen(PORT, HOST, async () => {
  console.log("[Vex Flows] up:", { PORT, HOST, isRailway, allowset: [...allowset] });
  console.log("[Vex Flows] env check:", {
    has_DATABASE_URL: !!process.env.DATABASE_URL,
    PGSSLMODE: process.env.PGSSLMODE,
    DB_SSL: process.env.DB_SSL,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    CORE_AUTH_MODE: process.env.CORE_AUTH_MODE,
    CORE_URL: process.env.CORE_URL,
  });

  try {
    await initSchema();
  } catch {}
  try {
    initScheduler(app);
  } catch (e) {
    console.error("[scheduler] error:", e?.message);
  }
});

process.on("unhandledRejection", (reason) => console.error("UNHANDLED REJECTION:", reason));
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));
