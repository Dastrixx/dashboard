import { closePool, getPool } from './db.mjs';
import { claimJob, enqueueDays, failJob, recoverJobs, storeReports } from './repository.mjs';
import { fetchReportDay } from './onec-reports.mjs';
import { addDays, businessDate } from './ranges.mjs';

let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

async function scheduleDaily() {
  const { day, hour } = businessDate();
  if (hour < 5) return;
  const result = await getPool().query(`INSERT INTO sync_schedule(sync_date) VALUES ($1)
    ON CONFLICT DO NOTHING RETURNING sync_date`, [day]);
  if (!result.rowCount) return;
  try {
    await enqueueDays(addDays(day, -7), day, { refresh: true });
    console.log(`[SYNC][reports] daily queued ${addDays(day, -7)}..${day}`);
  } catch (error) {
    await getPool().query('DELETE FROM sync_schedule WHERE sync_date=$1', [day]);
    throw error;
  }
}

const lockClient = await getPool().connect();
try {
  const lock = await lockClient.query('SELECT pg_try_advisory_lock(38291741) AS acquired');
  if (!lock.rows[0].acquired) throw new Error('Another sync worker is already running');
  await recoverJobs();
  while (!stopping) {
    try {
      await scheduleDaily();
      const job = await claimJob();
      if (!job) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }
      const day = job.day;
      const start = Date.now();
      console.log(`[SYNC][reports][${day}] started attempt=${job.attempt}`);
      try {
        const reports = await fetchReportDay(day);
        await storeReports(day, reports, job.id);
        console.log(`[SYNC][reports][${day}] completed fetched=${reports.length} durationMs=${Date.now() - start}`);
      } catch (error) {
        console.error(`[SYNC][reports][${day}] attempt=${job.attempt} error=${error.message}`);
        await failJob(job, error.message);
      }
    } catch (error) {
      console.error('[SYNC] worker loop error', error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
} finally {
  try { await lockClient.query('SELECT pg_advisory_unlock(38291741)'); }
  finally { lockClient.release(); await closePool(); }
}
