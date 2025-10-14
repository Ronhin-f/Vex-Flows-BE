// backend/index.js
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
// No usamos cors() con opciones: hardening manual de CORS
// import cors from "cors";

import { initSchema, pingDb } from "./db.js";

import providersRoutes from "./config/routes/providers.routes.js";
import flowsRoutes from "./config/routes/flows.routes.js";
import messagesRoutes from "./config/routes/messages.routes.js";
import triggersRoutes from "./config/routes/triggers.routes.js";

import auth from "./config/middleware/auth.js";

// Scheduler opcional
let initScheduler = () => console.log("🕒 Scheduler omitido (opcional)");
try {
  ({ initScheduler } = await import("./config/services/scheduler.service.js"));
} catch (e) {
  console.warn("[scheduler] no cargado:", e?.message);
}

const app = express();

/* ───────── Middlewares base ───────── */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("tiny"));

/* ───────── CORS Hardening (ANTES de rutas) ─────────
   CORS_ORIGIN="https://vex-flows-fe.vercel.app,https://vex-core-frontend.vercel.app"
   Podés activar DEV_CORS_OPEN=true para diagnóstico temporal (refleja cualquier Origin).
*/
const DEV_CORS_OPEN = String(process.env.DEV_CORS_OPEN || "false").toLowerCase() === "true";
const rawOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const allowset = new Set(rawOrigins);
console.log("[CORS] allowset:", [...allowset], "DEV_CORS_OPEN:", DEV_CORS_OPEN);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (req.method === "OPTIONS") {
    console.log("[CORS OPTIONS]", {
      origin,
      path: req.path,
      acrh: req.headers["access-control-request-headers"] || "",
      acrm: req.headers["access-control-request-method"] || "",
    });
  }

  if (DEV_CORS_OPEN) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else if (origin && allowset.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin); // no "*"
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With");

  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// app.use(cors()); // no necesario

/* ───────── Healthcheck ───────── */
app.get("/api/health", async (_req, res) => {
  try {
    await pingDb();
    res.json({ ok: true, service: "vex-flows-backend", db: "up" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "db error", code: e?.code });
  }
});
// Root 200 por si Railway chequea "/"
app.get("/", (_req, res) => res.status(200).send("ok: vex-flows-be"));
app.get(["/health", "/healthz"], (_req, res) => res.json({ ok: true, service: "vex-flows-backend" }));

/* ───────── In-Memory MVP (no rompe si no hay DB) ───────── */
const mem = {
  orgId: 1,
  providers: new Map([
    ["gmail",    { id: "gmail",    kind: "gmail",    label: "Gmail",    desc: "1 minuto · 3 pasos",        status: "pending", credentials: {} }],
    ["whatsapp", { id: "whatsapp", kind: "whatsapp", label: "WhatsApp", desc: "Business Accounts only",    status: "pending", credentials: {} }],
    ["sms",      { id: "sms",      kind: "sms",      label: "SMS",      desc: "Requiere Twilio SID/Token", status: "pending", credentials: {} }],
    ["slack",    { id: "slack",    kind: "slack",    label: "Slack",    desc: "1 minuto · 2 pasos",        status: "pending", credentials: {} }],
  ]),
  flows: [],           // { id, org_id, name, enabled, definition_json, ... }
  flowRuns: [],        // { id, org_id, flow_id, flow_name, status, ... }
};
let seqFlow = 1;
let seqRun  = 1;

/* ───────── Providers helpers ───────── */
const getProviders = async (_org_id) => Array.from(mem.providers.values());

const connectProvider = async (_org_id, id, credentials) => {
  const p = mem.providers.get(id);
  if (!p) throw new Error("provider_not_found");

  // Guardamos credenciales tal cual; para Slack esperamos { webhook_url }
  p.status = "connected";
  p.credentials = credentials || {};
  p.last_check_at = new Date().toISOString();
  mem.providers.set(id, p);

  // Test mínimo de Slack si viene webhook
  if (id === "slack" && p.credentials?.webhook_url) {
    try {
      await postToSlack(p.credentials.webhook_url, `✅ Vex Flows conectado (${new Date().toISOString()})`);
    } catch (e) {
      console.warn("[slack] test failed:", e?.message);
    }
  }
  return { status: "connected" };
};

function getSlackWebhook(org_id = 1) {
  const p = mem.providers.get("slack");
  return p?.status === "connected" ? p?.credentials?.webhook_url : null;
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

/* ───────── Recipes ───────── */
const getRecipes = async () => ([
  { id: "lead_whatsapp_task", title: "New lead ➜ WhatsApp + Task", trigger: "crm.lead.created" },
  { id: "lead_won",           title: "Lead won",                   trigger: "crm.lead.won" },
  { id: "invoice_due",        title: "Invoice expiring",           trigger: "billing.invoice.due" },

  // ★ Nuevo preset: Bid sent → Slack reminders
  {
    id: "bid_sent_slack",
    title: "Bid sent ➜ Slack reminders",
    trigger: "crm.deal.bid_sent",
    // steps por defecto: +1d, +4d, +7d, +12d (último toque a 5 días después del tercero).
    steps: [
      { type: "slack.post", delay_days: 1,  template: "🔔 Follow-up 1/4 for *{{deal.name}}* (Bid sent yesterday)." },
      { type: "slack.post", delay_days: 4,  template: "🔔 Follow-up 2/4 for *{{deal.name}}* (3 days later)." },
      { type: "slack.post", delay_days: 7,  template: "🔔 Follow-up 3/4 for *{{deal.name}}* (another 3 days)." },
      { type: "slack.post", delay_days: 12, template: "🔔 Final follow-up for *{{deal.name}}* (+5 days). Close or reschedule." },
    ],
  },
]);

/* ───────── Flows CRUD (memoria) ───────── */
const createFlow = async (org_id, { name, trigger, steps }) => {
  const now = new Date();
  const flow = {
    id: seqFlow++,
    org_id,
    name: name || "New Flow",
    enabled: true,
    definition_json: { trigger, steps },
    created_by: "system",
    created_at: now.toISOString(),
  };
  mem.flows.push(flow);

  // Guardamos un run de “alta” para que Activity tenga algo
  mem.flowRuns.unshift({
    id: seqRun++,
    org_id,
    flow_id: flow.id,
    flow_name: flow.name,
    status: "ok",
    started_at: now.toISOString(),
    finished_at: now.toISOString(),
  });

  return { id: flow.id, ok: true };
};

const publishFlow = async (org_id, flow_id) => {
  const flow = mem.flows.find((f) => f.id === Number(flow_id) && f.org_id === org_id);
  if (!flow) throw new Error("flow_not_found");
  flow.enabled = true;
  flow.published_at = new Date().toISOString();
  return { ok: true, flow_id: flow.id, status: "published" };
};

const getRuns = async (org_id, limit = 20) =>
  mem.flowRuns.filter((r) => r.org_id === org_id).slice(0, limit);

/* ───────── Mini-runner: procesa steps slack.post con delay_days ─────────
   ⚠️ MVP: usa setTimeout en memoria (sirve para demo; no sobrevive redeploy).
   Para prod real, mover a scheduler persistente/queue.
*/
function scheduleSlackPosts({ org_id, flow, payload }) {
  const webhook = getSlackWebhook(org_id);
  if (!webhook) {
    console.warn("[slack] webhook missing; skipping");
    return [];
  }

  const steps = flow?.definition_json?.steps || [];
  const createdRunIds = [];

  for (const s of steps) {
    if (s?.type !== "slack.post") continue;

    const delayDays = Number(s.delay_days || 0);
    const delayMs = Math.max(0, delayDays) * 24 * 60 * 60 * 1000;
    const runId = seqRun++;

    // Run “scheduled”
    mem.flowRuns.unshift({
      id: runId,
      org_id,
      flow_id: flow.id,
      flow_name: flow.name,
      status: delayMs ? "scheduled" : "processing",
      started_at: new Date().toISOString(),
      finished_at: null,
    });
    createdRunIds.push(runId);

    const text = (s.template || "🔔 Follow-up for *{{deal.name}}*")
      .replaceAll("{{deal.name}}", payload?.deal?.name || payload?.deal_name || payload?.name || "deal")
      .replaceAll("{{deal.owner}}", payload?.deal?.owner || payload?.owner || "owner");

    setTimeout(async () => {
      try {
        await postToSlack(webhook, text);
        // marcar OK
        const r = mem.flowRuns.find((x) => x.id === runId);
        if (r) {
          r.status = "ok";
          r.finished_at = new Date().toISOString();
        }
      } catch (e) {
        const r = mem.flowRuns.find((x) => x.id === runId);
        if (r) {
          r.status = "error";
          r.finished_at = new Date().toISOString();
        }
        console.error("[slack] post failed:", e?.message);
      }
    }, delayMs);
  }

  return createdRunIds;
}

/* ───────── API mínima que consume el FE ───────── */

// Públicos (GET)
app.get("/api/providers", async (req, res) => {
  try {
    const org_id = req.user?.org_id || mem.orgId;
    const rows = await getProviders(org_id);
    res.json(rows.map((r) => ({
      id: r.id, kind: r.kind, label: r.label, desc: r.desc, status: r.status,
      last_check_at: r.last_check_at || null,
    })));
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

app.get("/api/flow-runs", async (req, res) => {
  try {
    const org_id = req.user?.org_id || mem.orgId;
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    res.json(await getRuns(org_id, limit));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Protegidos (POST)
app.post("/api/providers/:id/connect", auth, async (req, res) => {
  try {
    const org_id = req.user?.org_id || mem.orgId;
    const id = req.params.id;
    const credentials = req.body?.credentials || {};
    const out = await connectProvider(org_id, id, credentials);
    res.json(out);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/flows/create", auth, async (req, res) => {
  try {
    const org_id = req.user?.org_id || mem.orgId;
    const payload = req.body || {};
    const out = await createFlow(org_id, payload);
    res.status(201).json(out);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/flows/publish", auth, async (req, res) => {
  try {
    const org_id = req.user?.org_id || mem.orgId;
    const { flow_id } = req.body || {};
    if (!flow_id) return res.status(400).json({ ok: false, error: "flow_id requerido" });
    const out = await publishFlow(org_id, flow_id);
    res.json(out);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/triggers/emit", auth, async (req, res) => {
  try {
    const org_id = req.user?.org_id || mem.orgId;
    const { event, payload } = req.body || {};
    if (!event) return res.status(400).json({ ok: false, error: "event requerido" });

    const matches = mem.flows.filter(
      (f) => f.org_id === org_id && f.enabled && f.definition_json?.trigger === event
    );

    // Crea runs y, si aplica, agenda posts a Slack
    let createdRuns = [];
    const now = new Date();

    for (const f of matches) {
      // Si el flow tiene steps slack.post, programar; si no, crear un run simple
      const hasSlack = (f.definition_json?.steps || []).some(s => s?.type === "slack.post");
      if (hasSlack) {
        createdRuns.push(...scheduleSlackPosts({ org_id, flow: f, payload }));
      } else {
        const run = {
          id: seqRun++,
          org_id,
          flow_id: f.id,
          flow_name: f.name,
          status: "ok",
          started_at: now.toISOString(),
          finished_at: now.toISOString(),
        };
        mem.flowRuns.unshift(run);
        createdRuns.push(run.id);
      }
    }

    res.status(202).json({
      ok: true,
      event,
      matched_flows: matches.map((f) => f.id),
      created_runs: createdRuns,
    });
  } catch (e) {
    console.error("[emit] error:", e);
    res.status(500).json({ ok: false, error: "emit failed" });
  }
});

// Routers existentes (si definen POST, ya pasan por auth arriba)
app.use("/api/providers", providersRoutes);
app.use("/api/flows", auth, flowsRoutes);
app.use("/api/messages", auth, messagesRoutes);
app.use("/api/triggers", auth, triggersRoutes);

/* ───────── 404 ───────── */
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found", path: req.path });
});

/* ───────── Server ───────── */
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

  try { await initSchema(); } catch {}
  try { initScheduler(app); } catch (e) { console.error("❌ Scheduler error:", e?.message); }
});

process.on("unhandledRejection", (reason) => console.error("UNHANDLED REJECTION:", reason));
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));
