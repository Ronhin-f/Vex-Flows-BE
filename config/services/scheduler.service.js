// backend/config/services/scheduler.service.js
import cron from "node-cron";
import { pool } from "../../db.js";
import { sendSlack } from "./providers/slack.js";
import { sendEmail } from "./providers/email.js";
import { sendWhatsapp } from "./providers/whatsapp.js";

const SCHED_FLAG = Symbol.for("vex.scheduler.started");
const RUNNER_CRON = process.env.FLOW_RUNNER_CRON || "* * * * *";
const RUNNER_BATCH = Math.max(1, Number(process.env.FLOW_RUNNER_BATCH || 5));

function getByPath(obj, path) {
  if (!obj || !path) return "";
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : ""), obj);
}

function renderTemplate(text, ctx) {
  const raw = String(text || "");
  return raw.replace(/{{\s*([\w.]+)\s*}}/g, (_m, key) => {
    const val = getByPath(ctx, key);
    return val === undefined || val === null ? "" : String(val);
  });
}

async function getSlackWebhook(org_id) {
  const { rows } = await pool.query(
    "SELECT credentials FROM flow_providers WHERE organizacion_id = $1 AND provider_id = 'slack' AND status = 'connected' LIMIT 1",
    [org_id]
  );
  const creds = rows[0]?.credentials || {};
  return creds.webhook_url || process.env.SLACK_WEBHOOK_URL || null;
}

async function fetchNextRuns(limit) {
  const { rows } = await pool.query(
    `
      WITH next AS (
        SELECT id
        FROM flow_runs
        WHERE status IN ('queued','pending') AND flow_id IS NOT NULL
        ORDER BY started_at ASC NULLS LAST, id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE flow_runs r
      SET status = 'running', started_at = COALESCE(r.started_at, now())
      FROM next
      WHERE r.id = next.id
      RETURNING r.id, r.flow_id, r.organizacion_id, r.meta
    `,
    [limit]
  );
  return rows;
}

async function markRun(id, status, error) {
  await pool.query(
    "UPDATE flow_runs SET status = $1, error = $2, finished_at = now() WHERE id = $3",
    [status, error || null, id]
  );
}

async function executeRun(run) {
  const { id, flow_id, organizacion_id, meta } = run;
  const org_id = String(organizacion_id || "1");

  const flowRes = await pool.query(
    "SELECT id, name FROM flows WHERE id = $1 AND organizacion_id = $2",
    [flow_id, org_id]
  );
  const flow = flowRes.rows[0];
  if (!flow) {
    await markRun(id, "error", "flow_not_found");
    return;
  }

  const stepsRes = await pool.query(
    "SELECT type, config FROM flow_steps WHERE flow_id = $1 AND organizacion_id = $2 ORDER BY position ASC",
    [flow_id, org_id]
  );
  const steps = stepsRes.rows || [];

  const ctx = meta?.payload || {};

  try {
    for (const step of steps) {
      const type = step.type;
      const config = step.config || {};

      if (type === "slack.post") {
        const webhook = await getSlackWebhook(org_id);
        if (!webhook) throw new Error("slack_not_connected");
        const text = renderTemplate(config.template || config.text || "", ctx);
        await sendSlack({ webhook, text });
        continue;
      }

      if (type === "whatsapp.send") {
        const to = renderTemplate(config.to || "", ctx);
        const message = renderTemplate(config.template || config.template_id || "WhatsApp", ctx);
        await sendWhatsapp({ to, message });
        continue;
      }

      if (type === "email.send") {
        const to = renderTemplate(config.to || "", ctx);
        const subject = renderTemplate(config.subject || "Vex Flow", ctx);
        const text = renderTemplate(config.text || config.body || "", ctx);
        await sendEmail({ to, subject, text });
        continue;
      }

      if (type === "task.create") {
        // Placeholder: tasks live in Core/CRM. We only log the run for now.
        continue;
      }

      throw new Error(`unsupported_step:${type}`);
    }

    await markRun(id, "ok", null);
  } catch (err) {
    await markRun(id, "error", err?.message || "run_failed");
  }
}

export function initScheduler(app) {
  if (globalThis[SCHED_FLAG]) {
    console.log("[scheduler] already started (skip)");
    return;
  }
  globalThis[SCHED_FLAG] = true;

  try {
    cron.schedule(RUNNER_CRON, async () => {
      try {
        const runs = await fetchNextRuns(RUNNER_BATCH);
        for (const run of runs) {
          await executeRun(run);
        }
      } catch (err) {
        console.error("[runner] error:", err?.message || err);
      }
    });

    console.log("[scheduler] started", { cron: RUNNER_CRON, batch: RUNNER_BATCH });
  } catch (e) {
    console.error("[scheduler] error:", e?.message);
  }
}
