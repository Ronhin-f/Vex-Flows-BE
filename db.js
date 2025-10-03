// backend/db.js
import "dotenv/config";
import pg from "pg";
const { Pool } = pg;

// 🔧 Kill switch SOLO si lo pedimos por env (dev/local/Railway con cert intermedio)
if (String(process.env.FORCE_DB_SSL_NO_VERIFY).toLowerCase() === "true") {
  // Desactiva la verificación de la cadena TLS en TODO el proceso
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.log("[db] TLS verify disabled via FORCE_DB_SSL_NO_VERIFY");
}

// 🔒 Falla explícito si falta la URL
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is missing. Asegurate de tener backend/.env o variables en Railway."
  );
}

// 🌐 Pool PG con SSL no-verify (evita SELF_SIGNED_CERT_IN_CHAIN)
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

console.log("[db] url mode -> ssl:", true, "rejectUnauthorized=false");

// ✅ Ping DB usando el MISMO Pool
export async function pingDb() {
  await pool.query("SELECT 1");
}

// 🗄️ Migración mínima
export async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS flows (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS triggers (
        id SERIAL PRIMARY KEY,
        flow_id INT REFERENCES flows(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        flow_id INT REFERENCES flows(id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        payload JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT now()
      );
    `);
    await client.query("COMMIT");
    console.log("[db] schema ok");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error creando tablas:", err);
    throw err;
  } finally {
    client.release();
  }
}
