// backend/config/services/scheduler.service.js
import cron from "node-cron";

// Global guard to avoid double start
const SCHED_FLAG = Symbol.for("vex.scheduler.started");

export function initScheduler(app) {
  if (globalThis[SCHED_FLAG]) {
    console.log("[scheduler] already started (skip)");
    return;
  }
  globalThis[SCHED_FLAG] = true;

  try {
    // Example: run every minute
    cron.schedule("* * * * *", async () => {
      try {
        // TODO: real jobs
        // console.log("[cron] tick");
      } catch (err) {
        console.error("[cron] error:", err?.message);
      }
    });

    console.log("[scheduler] started");
  } catch (e) {
    // Do not let scheduler crash the process
    console.error("[scheduler] error:", e?.message);
  }
}
