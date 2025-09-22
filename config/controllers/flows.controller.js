// backend/config/controllers/flows.controller.js
import { pool } from "../../db.js";

/** Inicialización idempotente (no rompe si ya existen) */
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
  _initDone = true;
}

/** GET /api/flows */
export async function listFlows(req, res, next) {
  try {
    await ensureTables();
    const { rows } = await pool.query(
      `SELECT * FROM flows ORDER BY updated_at DESC NULLS LAST, created_at DESC`
    );
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
}

/** GET /api/flows/:id */
export async function getFlowById(req, res, next) {
  try {
    await ensureTables();
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT * FROM flows WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Flow not found" });
    res.json({ ok: true, data: rows[0] });
  } catch (err) { next(err); }
}

/** POST /api/flows  { name, description?, active?, meta? } */
export async function createFlow(req, res, next) {
  try {
    await ensureTables();
    const { name, description = null, active = true, meta = {} } = req.body || {};
    if (!name || typeof name !== "string") {
      return res.status(400).json({ ok: false, error: "Field 'name' is required" });
    }
    const { rows } = await pool.query(
      `INSERT INTO flows (name, description, active, meta)
       VALUES ($1,$2,$3,$4::jsonb)
       RETURNING *`,
      [name, description, active, JSON.stringify(meta)]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (err) { next(err); }
}

/** PUT /api/flows/:id  { name?, description?, active?, meta? } */
export async function updateFlow(req, res, next) {
  try {
    await ensureTables();
    const { id } = req.params;
    const { name, description, active, meta } = req.body || {};

    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined)        { fields.push(`name = $${idx++}`);        values.push(name); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }
    if (active !== undefined)      { fields.push(`active = $${idx++}`);      values.push(active); }
    if (meta !== undefined)        { fields.push(`meta = $${idx++}::jsonb`); values.push(JSON.stringify(meta)); }

    fields.push(`updated_at = now()`);

    if (values.length === 0) {
      return res.status(400).json({ ok: false, error: "Nothing to update" });
    }

    values.push(id); // last placeholder for WHERE

    const { rows } = await pool.query(
      `UPDATE flows SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Flow not found" });
    res.json({ ok: true, data: rows[0] });
  } catch (err) { next(err); }
}

/** DELETE /api/flows/:id */
export async function deleteFlow(req, res, next) {
  try {
    await ensureTables();
    const { id } = req.params;
    const { rows } = await pool.query(`DELETE FROM flows WHERE id = $1 RETURNING id`, [id]);
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Flow not found" });
    res.json({ ok: true, deleted: rows[0].id });
  } catch (err) { next(err); }
}
