// backend/index.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

// DB (dotenv se carga dentro de db.js, ESM-safe)
import { initSchema, pingDb } from "./db.js";

// Routers (pueden convivir con los endpoints MVP)
import providersRoutes from "./config/routes/providers.routes.js";
import flowsRoutes from "./config/routes/flows.routes.js";
import messagesRoutes from "./config/routes/messages.routes.js";
import triggersRoutes from "./config/routes/triggers.routes.js";

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler: import dinámico + fallback para que NUNCA crashee en prod
let initScheduler = () => console.log("🕒 Scheduler omitido (opcional)");
try {
  ({ initScheduler } = await import("./config/services/scheduler.service.js"));
} catch (e) {
  console.warn("[scheduler] no cargado:", e?.message);
}
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

/* ───────────── Middlewares base ───────────── */
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("tiny"));

/* ───────────── CORS ─────────────
   Soporta lista separada por comas en CORS_ORIGIN
   ej: https://tu-frontend.vercel.app,http://localhost:5173
*/
const parseOrigins = (v) =>
  (v ? v.split(",") : ["http://localhost:5173"]).map((s) => s.trim()).filter(Boolean);

const allowedOrigins = parseOrigins(process.env.CORS_ORIGIN);
app.use(
  cors({
    origin: allowedOrigins, // array completo
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);
app.options("*", cors());

/* ───────────── Healthcheck ───────────── */
app.get(["/health", "/healthz"], async (_req, res) => {
  try {
    await pingDb();
    res.json({ ok: true, service: "vex-flows-backend", db: "up" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "db error", code: e?.code });
  }
});

/* ───────────── MVP en memoria ───────────── */
const mem = {
  orgId: 1,
  providers: new Map([
    ["gmail",    { id: "gmail",    kind: "gmail",    label: "Gmail",    desc: "1 minuto · 3 pasos",        status: "pending", credentials: {} }],
    ["whatsapp", { id: "whatsapp", kind: "whatsapp", label: "WhatsApp", desc: "Business Accounts only",    status: "pending", credentials: {} }],
    ["sms",      { id: "sms",      kind: "sms",      label: "SMS",      desc: "Requiere Twilio SID/Token", status: "pending", credentials: {} }],
    ["slack",    { id: "slack",    kind: "slack",    label: "Slack",    desc: "1 minuto · 2 pasos",        status: "pending", credentials: {} }],
  ]),
  flows: [],     // { id, org_id, name, enabled, definition_json, created_by, created_at, published_at? }
  flowRuns: [],  // { id, org_id, flow_id, flow_name, status, started_at, finished_at }
};
let seqFlow = 1;
let seqRun  = 1;

// Helpers (luego se reemplazan por queries a DB)
const getProviders = async (_org_id) => Array.from(mem.providers.values());

const connectProvider = async (_org_id, id, credentials) => {
  const p = mem.providers.get(id);
  if (!p) throw new Error("provider_not_found");
  p.status = "connected";
  p.credentials = credentials || {};
  p.last_check_at = new Date().toISOString();
  mem.providers.set(id, p);
  return { status: "connected" };
};

const getRecipes = async () => ([
  { id: "lead_whatsapp_task", title: "New lead ➜ WhatsApp + Task", trigger: "crm.lead.created" },
  { id: "lead_won",           title: "Lead won",                   trigger: "crm.lead.won" },
  { id: "invoice_due",        title: "Invoice expiring",           trigger: "billing.invoice.due" },
]);

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

  // Run de muestra para que Activity no quede vacío
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

/* ───────────── Endpoints mínimos que consume el frontend ───────────── */

// Providers
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

app.post("/api/providers/:id/connect", async (req, res) => {
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

// Flows Library
app.get("/api/flows/recipes", async (_req, res) => {
  try {
    res.json(await getRecipes());
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Crear flow
app.post("/api/flows/create", async (req, res) => {
  try {
    const org_id = req.user?.org_id || mem.orgId;
    const payload = req.body || {};
    const out = await createFlow(org_id, payload);
    res.status(201).json(out);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Publicar flow (stub dev)
app.post("/api/flows/publish", async (req, res) => {
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

// Emitir trigger (simula evento y genera runs)
app.post("/api/triggers/emit", async (req, res) => {
  try {
    const org_id = req.user?.org_id || mem.orgId;
    const { event, payload } = req.body || {};
    if (!event) return res.status(400).json({ ok: false, error: "event requerido" });

    const matches = mem.flows.filter(
      (f) => f.org_id === org_id && f.enabled && f.definition_json?.trigger === event
    );

    const now = new Date();
    const createdRuns = matches.map((f) => {
      const run = {
        id: seqRun++, org_id, flow_id: f.id, flow_name: f.name, status: "ok",
        started_at: now.toISOString(), finished_at: now.toISOString(),
      };
      mem.flowRuns.unshift(run);
      return run.id;
    });

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

// Activity
app.get("/api/flow-runs", async (req, res) => {
  try {
    const org_id = req.user?.org_id || mem.orgId;
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    res.json(await getRuns(org_id, limit));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ───────────── Montaje de routers existentes ───────────── */
app.use("/api/providers", providersRoutes);
app.use("/api/flows", flowsRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/triggers", triggersRoutes);

/* ───────────── 404 controlado ───────────── */
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found", path: req.path });
});

/* ───────────── Arranque ───────────── */
const PORT = Number(process.env.PORT) || 8082;
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, async () => {
  console.log("[Vex Flows] env check:", {
    has_DATABASE_URL: !!process.env.DATABASE_URL,
    PGSSLMODE: process.env.PGSSLMODE,
    DB_SSL: process.env.DB_SSL,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
  });
  console.log(`[Vex Flows] listening on http://${HOST}:${PORT}`);

  try {
    await initSchema(); // no rompe si no hay DB (ya loguea adentro)
  } catch {}

  try {
    initScheduler(app); // si el archivo no existe, ya lo manejamos arriba
  } catch (e) {
    console.error("❌ Scheduler error:", e?.message);
  }
});

/* ───────────── Robustez ───────────── */
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
