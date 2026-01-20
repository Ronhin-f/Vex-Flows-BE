// backend/config/controllers/messages.controller.js
import { pool } from "../../db.js";

function getOrgId(req) {
  const raw = req?.user?.org_id || req?.user?.orgId || "1";
  return String(raw || "1");
}

/** GET /api/messages?flow_id=&status= */
export async function listMessages(req, res, next) {
  try {
    const org_id = getOrgId(req);
    const { flow_id, status } = req.query || {};
    const where = ["organizacion_id = $1"];
    const vals = [org_id];

    if (flow_id) {
      vals.push(flow_id);
      where.push(`flow_id = $${vals.length}`);
    }
    if (status) {
      vals.push(status);
      where.push(`status = $${vals.length}`);
    }

    const sql = `
      SELECT * FROM messages
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(sql, vals);
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
}

/** GET /api/messages/:id */
export async function getMessageById(req, res, next) {
  try {
    const org_id = getOrgId(req);
    const { id } = req.params;
    const { rows } = await pool.query(
      "SELECT * FROM messages WHERE id = $1 AND organizacion_id = $2",
      [id, org_id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Message not found" });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** POST /api/messages  { flow_id?, channel, recipient?, subject?, body?, status?, meta? } */
export async function createMessage(req, res, next) {
  try {
    const org_id = getOrgId(req);
    const {
      flow_id = null,
      channel,
      recipient = null,
      subject = null,
      body = null,
      status = "draft",
      meta = {},
    } = req.body || {};

    if (!channel) {
      return res.status(400).json({ ok: false, error: "Field 'channel' is required" });
    }

    const { rows } = await pool.query(
      `
        INSERT INTO messages (organizacion_id, flow_id, channel, recipient, subject, body, status, meta)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
        RETURNING *
      `,
      [org_id, flow_id, channel, recipient, subject, body, status, JSON.stringify(meta)]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/messages/:id  { flow_id?, channel?, recipient?, subject?, body?, status?, meta? } */
export async function updateMessage(req, res, next) {
  try {
    const org_id = getOrgId(req);
    const { id } = req.params;
    const { flow_id, channel, recipient, subject, body, status, meta } = req.body || {};

    const sets = [];
    const vals = [];
    let i = 1;

    if (flow_id !== undefined) {
      sets.push(`flow_id = $${i++}`);
      vals.push(flow_id);
    }
    if (channel !== undefined) {
      sets.push(`channel = $${i++}`);
      vals.push(channel);
    }
    if (recipient !== undefined) {
      sets.push(`recipient = $${i++}`);
      vals.push(recipient);
    }
    if (subject !== undefined) {
      sets.push(`subject = $${i++}`);
      vals.push(subject);
    }
    if (body !== undefined) {
      sets.push(`body = $${i++}`);
      vals.push(body);
    }
    if (status !== undefined) {
      sets.push(`status = $${i++}`);
      vals.push(status);
    }
    if (meta !== undefined) {
      sets.push(`meta = $${i++}::jsonb`);
      vals.push(JSON.stringify(meta));
    }

    sets.push("updated_at = now()");

    if (vals.length === 0) {
      return res.status(400).json({ ok: false, error: "Nothing to update" });
    }

    vals.push(id, org_id);
    const { rows } = await pool.query(
      `
        UPDATE messages SET ${sets.join(", ")}
        WHERE id = $${vals.length - 1} AND organizacion_id = $${vals.length}
        RETURNING *
      `,
      vals
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Message not found" });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/messages/:id */
export async function deleteMessage(req, res, next) {
  try {
    const org_id = getOrgId(req);
    const { id } = req.params;
    const { rows } = await pool.query(
      "DELETE FROM messages WHERE id = $1 AND organizacion_id = $2 RETURNING id",
      [id, org_id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Message not found" });
    res.json({ ok: true, deleted: rows[0].id });
  } catch (err) {
    next(err);
  }
}
