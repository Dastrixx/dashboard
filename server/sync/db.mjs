import pg from 'pg';

let pool;
export function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for sync');
  pool ||= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  return pool;
}

export async function closePool() {
  if (pool) await pool.end();
  pool = undefined;
}
