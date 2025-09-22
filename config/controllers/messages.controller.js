// backend/config/controllers/messages.controller.js
import { pool } from "../../db.js";

// Crea las tablas si no existen (idempotente)
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
    CREATE TABLE IF NOT EXISTS messages (
      id           BIGSERIAL PRIMARY KEY,
      flow_id      BIGINT REFERENCES flows(id) ON DELETE SET NULL,
      channel      TEXT NOT NULL,                   -- 'email' | 'slack' | 'whatsapp' | 'webhook' | etc.
      recipient    TEXT,                            -- email, número, canal destino
      subject      TEXT,
      body         TEXT,
      status       TEXT DEFAULT 'draft',            -- 'draft' | 'queued' | 'sent' | 'failed'
      meta         JSONB DEFAULT '{}'::jsonb,       -- payload extra: html, blocks, etc.
      created_at   TIMESTAMPTZ DEFAULT now(),
      updated_at   TIMESTAMPTZ DEFAULT now()
    );
  `);
  _initDone = true;
}

/** GET /api/messages?flow_id=&status= */
export async function listMessages(req, res, next) {
  try {
    await ensureTables();
    const { flow_id, status } = req.query || {};
    const where = [];
    const vals = [];
    if (flow_id) { vals.push(flow_id); where.push(`flow_id = $${vals.length}`); }
    if (status)  { vals.push(status);  where.push(`status = $${vals.length}`); }
    const sql = `
      SELECT * FROM messages
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(sql, vals);
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
}

/** GET /api/messages/:id */
export async function getMessageById(req, res, next) {
  try {
    await ensureTables();
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT * FROM messages WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Message not found" });
    res.json({ ok: true, data: rows[0] });
  } catch (err) { next(err); }
}

/** POST /api/messages  { flow_id?, channel, recipient?, subject?, body?, status?, meta? } */
export async function createMessage(req, res, next) {
  try {
    await ensureTables();
    const {
      flow_id = null,
      channel,
      recipient = null,
      subject = null,
      body = null,
      status = "draft",
      meta = {}
    } = req.body || {};

    if (!channel) {
      return res.status(400).json({ ok: false, error: "Field 'channel' is required" });
    }

    const { rows } = await pool.query(
      `INSERT INTO messages (flow_id, channel, recipient, subject, body, status, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING *`,
      [flow_id, channel, recipient, subject, body, status, JSON.stringify(meta)]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (err) { next(err); }
}

/** PUT /api/messages/:id  { flow_id?, channel?, recipient?, subject?, body?, status?, meta? } */
export async function updateMessage(req, res, next) {
  try {
    await ensureTables();
    const { id } = req.params;
    const { flow_id, channel, recipient, subject, body, status, meta } = req.body || {};

    const sets = [];
    const vals = [];
    let i = 1;

    if (flow_id !== undefined)  { sets.push(`flow_id = $${i++}`);  vals.push(flow_id); }
    if (channel !== undefined)  { sets.push(`channel = $${i++}`);  vals.push(channel); }
    if (recipient !== undefined){ sets.push(`recipient = $${i++}`);vals.push(recipient); }
    if (subject !== undefined)  { sets.push(`subject = $${i++}`);  vals.push(subject); }
    if (body !== undefined)     { sets.push(`body = $${i++}`);     vals.push(body); }
    if (status !== undefined)   { sets.push(`status = $${i++}`);   vals.push(status); }
    if (meta !== undefined)     { sets.push(`meta = $${i++}::jsonb`); vals.push(JSON.stringify(meta)); }

    sets.push(`updated_at = now()`);

    if (vals.length === 1) { // solo updated_at
      return res.status(400).json({ ok: false, error: "Nothing to update" });
    }

    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE messages SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Message not found" });
    res.json({ ok: true, data: rows[0] });
  } catch (err) { next(err); }
}

/** DELETE /api/messages/:id */
export async function deleteMessage(req, res, next) {
  try {
    await ensureTables();
    const { id } = req.params;
    const { rows } = await pool.query(`DELETE FROM messages WHERE id = $1 RETURNING id`, [id]);
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Message not found" });
    res.json({ ok: true, deleted: rows[0].id });
  } catch (err) { next(err); }
}
