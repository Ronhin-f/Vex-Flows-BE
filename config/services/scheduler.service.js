// backend/config/services/scheduler.service.js
import cron from "node-cron";

// Guardia global para evitar doble inicio incluso si lo importan dos veces
const SCHED_FLAG = Symbol.for("vex.scheduler.started");

export function initScheduler(app) {
  if (globalThis[SCHED_FLAG]) {
    console.log("🕒 Scheduler ya iniciado (skip)");
    return;
  }
  globalThis[SCHED_FLAG] = true;

  try {
    // Ejemplo: corre cada minuto (ajustá a tus jobs)
    cron.schedule("* * * * *", async () => {
      try {
        // TODO: tu lógica real
        // console.log("[cron] tick");
      } catch (err) {
        console.error("[cron] error:", err?.message);
      }
    });

    console.log("🕒 Scheduler iniciado");
  } catch (e) {
    // Nunca dejes que el scheduler mate el proceso
    console.error("❌ Scheduler error:", e?.message);
  }
}
