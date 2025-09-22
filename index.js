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

// 1) Crear app ANTES de usar app.get/app.use
const app = express();

// 2) Middlewares
app.use(
  cors({
    origin:
      (process.env.CORS_ORIGIN?.split(",")
        .map((s) => s.trim())
        .filter(Boolean)) || true,
    credentials: true,
  })
);
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

// 3) Healthcheck (si querés saltear DB para hoy, poné HEALTH_SKIP_DB=true en .env)
app.get("/health", async (_req, res) => {
  if (String(process.env.HEALTH_SKIP_DB).toLowerCase() === "true") {
    return res.json({ ok: true, service: "vex-flows-backend", db: "skipped" });
  }
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "vex-flows-backend", db: "up" });
  } catch (e) {
    console.error("DB healthcheck failed:", e);
    res.status(500).json({ ok: false, error: e.message || "", code: e.code });
  }
});

// 4) Rutas
app.use("/api/flows", flowsRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/triggers", triggersRoutes);

// 5) 404 y handler de errores
app.use((req, res) => res.status(404).json({ ok: false, error: "Not found" }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ ok: false, error: err.message || "Internal error" });
});

// 6) Listen
const port = process.env.PORT || 8082;
app.listen(port, () => console.log(`[Vex Flows] listening on :${port}`));

export default app;
