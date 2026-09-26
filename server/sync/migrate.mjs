import { readFile } from 'node:fs/promises';
import { getPool, closePool } from './db.mjs';

const sql = await readFile(new URL('./migrations/001_reports.sql', import.meta.url), 'utf8');
try {
  await getPool().query(sql);
  console.log('[SYNC] reports migration applied');
} finally {
  await closePool();
}
