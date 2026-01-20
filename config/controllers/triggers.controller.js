// backend/config/controllers/triggers.controller.js
import { pool } from "../../db.js";

function getOrgId(req) {
  const raw = req?.user?.org_id || req?.user?.orgId || "1";
  return String(raw || "1");
}

/** GET /api/triggers?flow_id= */
export async function listTriggers(req, res, next) {
  try {
    const org_id = getOrgId(req);
    const { flow_id } = req.query || {};
    const q = flow_id
      ? {
          text: "SELECT * FROM triggers WHERE organizacion_id = $1 AND flow_id = $2 ORDER BY id DESC",
          values: [org_id, flow_id],
        }
      : {
          text: "SELECT * FROM triggers WHERE organizacion_id = $1 ORDER BY id DESC",
          values: [org_id],
        };

    const { rows } = await pool.query(q);
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
}

/** GET /api/triggers/:id */
export async function getTriggerById(req, res, next) {
  try {
    const org_id = getOrgId(req);
    const { id } = req.params;
    const { rows } = await pool.query(
      "SELECT * FROM triggers WHERE id = $1 AND organizacion_id = $2",
      [id, org_id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Trigger not found" });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** POST /api/triggers  { flow_id, type, schedule?, active?, config? } */
export async function createTrigger(req, res, next) {
  try {
    const org_id = getOrgId(req);
    const { flow_id, type, schedule = null, active = true, config = {} } = req.body || {};
    if (!flow_id) return res.status(400).json({ ok: false, error: "Field 'flow_id' is required" });
    if (!type) return res.status(400).json({ ok: false, error: "Field 'type' is required" });

    const { rows } = await pool.query(
      `
        INSERT INTO triggers (organizacion_id, flow_id, type, schedule, active, config)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb)
        RETURNING *
      `,
      [org_id, flow_id, type, schedule, active, JSON.stringify(config)]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/triggers/:id  { flow_id?, type?, schedule?, active?, config? } */
export async function updateTrigger(req, res, next) {
  try {
    const org_id = getOrgId(req);
    const { id } = req.params;
    const { flow_id, type, schedule, active, config } = req.body || {};

    const fields = [];
    const values = [];
    let i = 1;

    if (flow_id !== undefined) {
      fields.push(`flow_id = $${i++}`);
      values.push(flow_id);
    }
    if (type !== undefined) {
      fields.push(`type = $${i++}`);
      values.push(type);
    }
    if (schedule !== undefined) {
      fields.push(`schedule = $${i++}`);
      values.push(schedule);
    }
    if (active !== undefined) {
      fields.push(`active = $${i++}`);
      values.push(active);
    }
    if (config !== undefined) {
      fields.push(`config = $${i++}::jsonb`);
      values.push(JSON.stringify(config));
    }

    fields.push("updated_at = now()");

    if (values.length === 0) {
      return res.status(400).json({ ok: false, error: "Nothing to update" });
    }

    values.push(id, org_id);
    const { rows } = await pool.query(
      `
        UPDATE triggers SET ${fields.join(", ")}
        WHERE id = $${values.length - 1} AND organizacion_id = $${values.length}
        RETURNING *
      `,
      values
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Trigger not found" });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/triggers/:id */
export async function deleteTrigger(req, res, next) {
  try {
    const org_id = getOrgId(req);
    const { id } = req.params;
    const { rows } = await pool.query(
      "DELETE FROM triggers WHERE id = $1 AND organizacion_id = $2 RETURNING id",
      [id, org_id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Trigger not found" });
    res.json({ ok: true, deleted: rows[0].id });
  } catch (err) {
    next(err);
  }
}
