import pg from "pg";
const { Pool } = pg;

function isTrue(v) {
  return String(v || "").toLowerCase() === "true";
}

function wantsSSL(url) {
  // Detecta proveedores que requieren SSL o query ?sslmode=require
  return /sslmode=require|neon\.tech|supabase\.co|render\.com|amazonaws\.com/i.test(url || "");
}

function buildConfig() {
  const url = process.env.DATABASE_URL;

  if (url) {
    const useSSL = wantsSSL(url) || isTrue(process.env.DB_SSL) || process.env.PGSSLMODE === "require";
    return {
      connectionString: url,
      ssl: useSSL ? { rejectUnauthorized: false } : false,
      max: Number(process.env.PGPOOL_MAX || 10),
      idleTimeoutMillis: 30_000
    };
  }

  // Alternativa por variables sueltas (local)
  const useSSL =
    isTrue(process.env.DB_SSL) || process.env.PGSSLMODE === "require";
  return {
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "vex_flows",
    ssl: useSSL ? { rejectUnauthorized: false } : false,
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: 30_000
  };
}

export const pool = new Pool(buildConfig());

// Log limpio si el pool tiene un error asíncrono
pool.on("error", (err) => {
  console.error("PG pool error:", err);
});

export default pool;
