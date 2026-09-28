import { closePool, getPool } from './db.mjs';
import { addDays, businessDate } from './ranges.mjs';

const from = addDays(businessDate().day, -29);
const client = await getPool().connect();
try {
  await client.query('BEGIN');
  const jobs = await client.query(`DELETE FROM sync_jobs
    WHERE data_type='reports' AND sync_date < $1 AND status IN ('pending','failed')
    RETURNING sync_date`, [from]);
  await client.query(`DELETE FROM sync_days d
    WHERE d.data_type='reports' AND d.sync_date < $1 AND d.status IN ('pending','failed')
    AND NOT EXISTS (SELECT 1 FROM sync_jobs j WHERE j.data_type=d.data_type AND j.sync_date=d.sync_date)`, [from]);
  await client.query('COMMIT');
  console.log(`[SYNC][reports] removed ${jobs.rowCount} queued/failed days older than ${from}; completed data kept`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await closePool();
}
