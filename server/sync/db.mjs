import pg from 'pg';

let pool;
export function getPool() {
  if (!process.env.DATABASE_URL) throw new Error(
    'Не задан DATABASE_URL. Создайте .env в корне проекта и добавьте DATABASE_URL=postgres://dashboard:dashboard_local_only@127.0.0.1:5432/dashboard (см. docs/local-sync.md).',
  );
  pool ||= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  return pool;
}

export async function closePool() {
  if (pool) await pool.end();
  pool = undefined;
}
