import { closePool, getPool } from './db.mjs';
import { addDays, businessDate, daysInRange } from './ranges.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--') && arg.includes('='))
  .map(arg => arg.slice(2).split('=')));
if (Boolean(args.from) !== Boolean(args.to)) throw new Error('Укажите оба параметра: --from и --to');
const from = args.from || addDays(businessDate().day, -29);
const to = args.to || businessDate().day;
daysInRange(from, to);
const client = await getPool().connect();
try {
  await client.query('BEGIN');
  const jobs = await client.query(`DELETE FROM sync_jobs
    WHERE data_type='reports' AND (sync_date < $1 OR sync_date > $2) AND status IN ('pending','failed')
    RETURNING sync_date`, [from, to]);
  await client.query(`DELETE FROM sync_days d
    WHERE d.data_type='reports' AND (d.sync_date < $1 OR d.sync_date > $2) AND d.status IN ('pending','failed')
    AND NOT EXISTS (SELECT 1 FROM sync_jobs j WHERE j.data_type=d.data_type AND j.sync_date=d.sync_date)`, [from, to]);
  await client.query('COMMIT');
  console.log(`[SYNC][reports] removed ${jobs.rowCount} queued/failed days outside ${from}..${to}; completed data kept`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await closePool();
}
