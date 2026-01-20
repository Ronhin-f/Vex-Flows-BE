// backend/config/controllers/flows.controller.js
import { pool } from "../../db.js";

function getOrgId(req) {
  const raw = req?.user?.org_id || req?.user?.orgId || "1";
  return String(raw || "1");
}

/** GET /api/flows */
export async function listFlows(req, res, next) {
  try {
    const org_id = getOrgId(req);
    const { rows } = await pool.query(
      `
        SELECT * FROM flows
        WHERE organizacion_id = $1
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
      `,
      [org_id]
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
}

/** GET /api/flows/:id */
export async function getFlowById(req, res, next) {
  try {
    const org_id = getOrgId(req);
    const { id } = req.params;
    const { rows } = await pool.query(
      "SELECT * FROM flows WHERE id = $1 AND organizacion_id = $2",
      [id, org_id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Flow not found" });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** POST /api/flows  { name, trigger, active?, meta?, steps? } */
export async function createFlow(req, res, next) {
  const org_id = getOrgId(req);
  const { name, trigger, active = true, meta = {}, steps = [] } = req.body || {};

  if (!name || typeof name !== "string") {
    return res.status(400).json({ ok: false, error: "Field 'name' is required" });
  }
  if (!trigger || typeof trigger !== "string") {
    return res.status(400).json({ ok: false, error: "Field 'trigger' is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
        INSERT INTO flows (organizacion_id, name, trigger, active, meta, created_by)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6)
        RETURNING *
      `,
      [org_id, name, trigger, active, JSON.stringify(meta), req.user?.email || "system"]
    );

    const flow = rows[0];

    if (Array.isArray(steps) && steps.length) {
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
          [flow.id, org_id, i + 1, type, JSON.stringify(config)]
        );
      }
    }

    await client.query("COMMIT");
    res.status(201).json({ ok: true, data: flow });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}

/** PUT /api/flows/:id  { name?, trigger?, active?, meta? } */
export async function updateFlow(req, res, next) {
  try {
    const org_id = getOrgId(req);
    const { id } = req.params;
    const { name, trigger, active, meta } = req.body || {};

    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(name);
    }
    if (trigger !== undefined) {
      fields.push(`trigger = $${idx++}`);
      values.push(trigger);
    }
    if (active !== undefined) {
      fields.push(`active = $${idx++}`);
      values.push(active);
    }
    if (meta !== undefined) {
      fields.push(`meta = $${idx++}::jsonb`);
      values.push(JSON.stringify(meta));
    }

    fields.push("updated_at = now()");

    if (values.length === 0) {
      return res.status(400).json({ ok: false, error: "Nothing to update" });
    }

    values.push(id, org_id);

    const { rows } = await pool.query(
      `
        UPDATE flows
        SET ${fields.join(", ")}
        WHERE id = $${values.length - 1} AND organizacion_id = $${values.length}
        RETURNING *
      `,
      values
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Flow not found" });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/flows/:id */
export async function deleteFlow(req, res, next) {
  try {
    const org_id = getOrgId(req);
    const { id } = req.params;
    const { rows } = await pool.query(
      "DELETE FROM flows WHERE id = $1 AND organizacion_id = $2 RETURNING id",
      [id, org_id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Flow not found" });
    res.json({ ok: true, deleted: rows[0].id });
  } catch (err) {
    next(err);
  }
}
