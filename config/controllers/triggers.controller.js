// backend/config/controllers/triggers.controller.js
import { pool } from "../../db.js";

let _initDone = false;
async function ensureTables() {
  if (_initDone) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flows (
      id           BIGSERIAL PRIMARY KEY,
      name         TEXT NOT NULL,
      description  TEXT,
      active       BOOLEAN DEFAULT TRUE,
      meta         JSONB   DEFAULT '{}'::jsonb,
      created_at   TIMESTAMPTZ DEFAULT now(),
      updated_at   TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS triggers (
      id           BIGSERIAL PRIMARY KEY,
      flow_id      BIGINT REFERENCES flows(id) ON DELETE CASCADE,
      type         TEXT NOT NULL,                     -- 'email' | 'slack' | 'whatsapp' | 'webhook' | etc.
      schedule     TEXT,                              -- cron o condición
      active       BOOLEAN DEFAULT TRUE,
      config       JSONB DEFAULT '{}'::jsonb,         -- credenciales/plantillas/etc
      created_at   TIMESTAMPTZ DEFAULT now(),
      updated_at   TIMESTAMPTZ DEFAULT now()
    );
  `);
  _initDone = true;
}

/** GET /api/triggers?flow_id= */
export async function listTriggers(req, res, next) {
  try {
    await ensureTables();
    const { flow_id } = req.query || {};
    const q = flow_id
      ? { text: `SELECT * FROM triggers WHERE flow_id = $1 ORDER BY id DESC`, values: [flow_id] }
      : { text: `SELECT * FROM triggers ORDER BY id DESC`, values: [] };

    const { rows } = await pool.query(q);
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
}

/** GET /api/triggers/:id */
export async function getTriggerById(req, res, next) {
  try {
    await ensureTables();
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT * FROM triggers WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Trigger not found" });
    res.json({ ok: true, data: rows[0] });
  } catch (err) { next(err); }
}

/** POST /api/triggers  { flow_id, type, schedule?, active?, config? } */
export async function createTrigger(req, res, next) {
  try {
    await ensureTables();
    const { flow_id, type, schedule = null, active = true, config = {} } = req.body || {};
    if (!flow_id) return res.status(400).json({ ok: false, error: "Field 'flow_id' is required" });
    if (!type)    return res.status(400).json({ ok: false, error: "Field 'type' is required" });

    const { rows } = await pool.query(
      `INSERT INTO triggers (flow_id, type, schedule, active, config)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       RETURNING *`,
      [flow_id, type, schedule, active, JSON.stringify(config)]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (err) { next(err); }
}

/** PUT /api/triggers/:id  { flow_id?, type?, schedule?, active?, config? } */
export async function updateTrigger(req, res, next) {
  try {
    await ensureTables();
    const { id } = req.params;
    const { flow_id, type, schedule, active, config } = req.body || {};

    const fields = [];
    const values = [];
    let i = 1;

    if (flow_id !== undefined) { fields.push(`flow_id = $${i++}`);  values.push(flow_id); }
    if (type !== undefined)    { fields.push(`type = $${i++}`);     values.push(type); }
    if (schedule !== undefined){ fields.push(`schedule = $${i++}`); values.push(schedule); }
    if (active !== undefined)  { fields.push(`active = $${i++}`);   values.push(active); }
    if (config !== undefined)  { fields.push(`config = $${i++}::jsonb`); values.push(JSON.stringify(config)); }

    fields.push(`updated_at = now()`);

    if (values.length === 0) {
      return res.status(400).json({ ok: false, error: "Nothing to update" });
    }

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE triggers SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Trigger not found" });
    res.json({ ok: true, data: rows[0] });
  } catch (err) { next(err); }
}

/** DELETE /api/triggers/:id */
export async function deleteTrigger(req, res, next) {
  try {
    await ensureTables();
    const { id } = req.params;
    const { rows } = await pool.query(`DELETE FROM triggers WHERE id = $1 RETURNING id`, [id]);
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Trigger not found" });
    res.json({ ok: true, deleted: rows[0].id });
  } catch (err) { next(err); }
}
