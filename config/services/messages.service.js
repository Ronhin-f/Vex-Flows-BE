import { pool } from "../db.js";

export async function insertMessageRecord(p) {
  const sql = `INSERT INTO messages
    (flow_id, channel, recipient, subject, body, status, meta, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())
    RETURNING id`;
  const vals = [
    p.flow_id ?? null,
    p.channel ?? null,
    p.recipient ?? null,
    p.subject ?? null,
    p.body ?? null,
    p.status ?? "queued",
    p.meta ? JSON.stringify(p.meta) : null,
  ];
  const r = await pool.query(sql, vals);
  return r.rows[0];
}

export async function updateMessageStatus(id, status, meta) {
  const sql = `UPDATE messages SET status=$1, meta=$2, updated_at=now() WHERE id=$3`;
  await pool.query(sql, [status, meta ? JSON.stringify(meta) : null, id]);
}
