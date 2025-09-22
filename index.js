// backend/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import flowsRoutes from "./config/routes/flows.routes.js";
import messagesRoutes from "./config/routes/messages.routes.js";
import triggersRoutes from "./config/routes/triggers.routes.js";

import { pool } from "./db.js";

const app = express();

// Si hay proxy (Railway), confiar en X-Forwarded-*
app.set("trust proxy", 1);

// CORS robusto: CORS_ORIGIN="https://a.com,https://b.com" | "*" | "true"
function resolveCorsOrigin() {
  const raw = process.env.CORS_ORIGIN;
  if (!raw || raw === "*" || raw.toLowerCase() === "true") return true;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : true;
}

app.use(
  cors({
    origin: resolveCorsOrigin(),
    credentials: true,
  })
);
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// Ping simple
app.get("/", (_req, res) =>
  res.json({ ok: true, service: "vex-flows-backend" })
);

// Healthcheck (podés saltear DB con HEALTH_SKIP_DB=true)
app.get("/health", async (_req, res) => {
  if ((process.env.HEALTH_SKIP_DB || "").toLowerCase() === "true") {
    return res.json({ ok: true, service: "vex-flows-backend", db: "skipped" });
  }
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "vex-flows-backend", db: "up" });
  } catch (e) {
    console.error("DB healthcheck failed:", e);
    res
      .status(500)
      .json({ ok: false, error: e.message || "", code: e.code || null });
  }
});

// Rutas de API
app.use("/api/flows", flowsRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/triggers", triggersRoutes);

// 404 y handler de errores
app.use((req, res) => res.status(404).json({ ok: false, error: "Not found" }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(err);
  res
    .status(err.status || 500)
    .json({ ok: false, error: err.message || "Internal error" });
});

// Listen
const PORT = process.env.PORT || 8082;
app.listen(PORT, () => console.log(`[Vex Flows] listening on :${PORT}`));

export default app;
