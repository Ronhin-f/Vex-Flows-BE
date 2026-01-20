// backend/db.js
import "dotenv/config";
import pg from "pg";
const { Pool } = pg;

// Kill switch for local/dev only
if (String(process.env.FORCE_DB_SSL_NO_VERIFY).toLowerCase() === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.log("[db] TLS verify disabled via FORCE_DB_SSL_NO_VERIFY");
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is missing. Ensure backend/.env or Railway vars are set."
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

console.log("[db] url mode -> ssl:", true, "rejectUnauthorized=false");

export async function pingDb() {
  await pool.query("SELECT 1");
}

export async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS flows (
        id BIGSERIAL PRIMARY KEY,
        organizacion_id TEXT NOT NULL,
        name TEXT NOT NULL,
        trigger TEXT NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        meta JSONB DEFAULT '{}'::jsonb,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS flow_steps (
        id BIGSERIAL PRIMARY KEY,
        flow_id BIGINT REFERENCES flows(id) ON DELETE CASCADE,
        organizacion_id TEXT NOT NULL,
        position INT NOT NULL,
        type TEXT NOT NULL,
        config JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS flow_runs (
        id BIGSERIAL PRIMARY KEY,
        flow_id BIGINT REFERENCES flows(id) ON DELETE SET NULL,
        organizacion_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        started_at TIMESTAMPTZ DEFAULT now(),
        finished_at TIMESTAMPTZ,
        meta JSONB DEFAULT '{}'::jsonb
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS flow_providers (
        id BIGSERIAL PRIMARY KEY,
        organizacion_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        credentials JSONB DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS triggers (
        id BIGSERIAL PRIMARY KEY,
        organizacion_id TEXT NOT NULL,
        flow_id BIGINT REFERENCES flows(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        schedule TEXT,
        active BOOLEAN DEFAULT TRUE,
        config JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        organizacion_id TEXT NOT NULL,
        flow_id BIGINT REFERENCES flows(id) ON DELETE SET NULL,
        channel TEXT NOT NULL,
        recipient TEXT,
        subject TEXT,
        body TEXT,
        status TEXT DEFAULT 'draft',
        meta JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS flow_providers_org_provider_idx ON flow_providers(organizacion_id, provider_id);");
    await client.query("CREATE INDEX IF NOT EXISTS flow_runs_org_idx ON flow_runs(organizacion_id, started_at DESC);");
    await client.query("CREATE INDEX IF NOT EXISTS flow_steps_flow_idx ON flow_steps(flow_id, position);");

    await client.query("ALTER TABLE flows ADD COLUMN IF NOT EXISTS organizacion_id TEXT;");
    await client.query("ALTER TABLE flows ADD COLUMN IF NOT EXISTS trigger TEXT;");
    await client.query("ALTER TABLE flows ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;");
    await client.query("ALTER TABLE flows ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;");
    await client.query("ALTER TABLE flows ADD COLUMN IF NOT EXISTS created_by TEXT;");
    await client.query("ALTER TABLE flows ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();");
    await client.query("UPDATE flows SET organizacion_id = COALESCE(organizacion_id, '1') WHERE organizacion_id IS NULL;");

    await client.query("ALTER TABLE triggers ADD COLUMN IF NOT EXISTS organizacion_id TEXT;");
    await client.query("UPDATE triggers SET organizacion_id = COALESCE(organizacion_id, '1') WHERE organizacion_id IS NULL;");

    await client.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS organizacion_id TEXT;");
    await client.query("UPDATE messages SET organizacion_id = COALESCE(organizacion_id, '1') WHERE organizacion_id IS NULL;");

    await client.query("COMMIT");
    console.log("[db] schema ok");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[db] schema error:", err);
    throw err;
  } finally {
    client.release();
  }
}
