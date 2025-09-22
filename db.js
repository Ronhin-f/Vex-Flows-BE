// backend/db.js
import pg from "pg";
const { Pool } = pg;

// ---------- helpers ----------
const toBool = (v) => String(v ?? "").toLowerCase() === "true";
const norm = (v) => String(v ?? "").toLowerCase();

// Hosts/proveedores que típicamente requieren SSL (o van detrás de proxy)
const needsSSLByHost = (url) =>
  /sslmode=|rlwy\.net|railway|metro\.proxy\.rlwy\.net|neon\.tech|supabase\.co|render\.com|amazonaws\.com|herokuapp\.com/i
    .test(url || "");

// Decide config SSL según env/URL
function sslConfigFromEnv(url) {
  const mode = norm(process.env.PGSSLMODE);      // "no-verify" | "require" | ""
  const dbSsl = toBool(process.env.DB_SSL);      // true/false

  // Modo explícito desde env primero
  if (mode === "no-verify" || mode === "prefer" || mode === "allow") {
    return { rejectUnauthorized: false };
  }
  if (mode === "require" || mode === "verify-full" || mode === "verify-ca") {
    return { rejectUnauthorized: true };
  }

  // Fallback: si DB_SSL=true o el host/URL sugiere SSL -> no-verify (proxy con cert self-signed)
  if (dbSsl || needsSSLByHost(url)) {
    return { rejectUnauthorized: false };
  }

  // Sin SSL
  return false;
}

function buildConfig() {
  const url = process.env.DATABASE_URL;

  if (url) {
    return {
      connectionString: url,
      ssl: sslConfigFromEnv(url),
      max: Number(process.env.PGPOOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 30_000),
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT || 10_000),
    };
  }

  // Local por variables sueltas
  return {
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "vex_flows",
    ssl: sslConfigFromEnv(),
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 30_000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT || 10_000),
  };
}

export const pool = new Pool(buildConfig());

// Log limpio si el pool tiene un error asíncrono
pool.on("error", (err) => {
  console.error("PG pool error:", err);
});

// ----------------------------
// Auto-migración mínima (idempotente)
// ----------------------------
async function initSchema() {
  if (toBool(process.env.HEALTH_SKIP_DB)) {
    console.log("⏭️  HEALTH_SKIP_DB=true → se salta creación de esquema al boot.");
    return;
  }

  let client;
  try {
    client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS flows (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        active BOOLEAN DEFAULT TRUE,
        meta JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS triggers (
        id BIGSERIAL PRIMARY KEY,
        flow_id BIGINT REFERENCES flows(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        schedule TEXT,
        active BOOLEAN DEFAULT TRUE,
        config JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
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
    console.log("✅ Tablas chequeadas/creadas");
  } catch (err) {
    // No tumbar el proceso por errores de conexión/SSL; loguear y seguir
    console.error("❌ Error creando tablas:", err);
  } finally {
    try { client?.release?.(); } catch {}
  }
}

initSchema();

export default pool;
