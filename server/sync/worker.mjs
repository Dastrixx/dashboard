import { closePool, getPool } from './db.mjs';
import { claimJob, enqueueDays, failJob, rangeStatus, recoverJobs, storeRaw, storeReports } from './repository.mjs';
import { fetchReportDay } from './onec-reports.mjs';
import { fetchRawSource } from './raw-source.mjs';
import { enqueueRawRange } from './enqueue-raw.mjs';
import { CATALOG_SOURCES, DATED_SOURCES, SNAPSHOT_SOURCES, datedType } from './sources.mjs';
import { addDays, businessDate } from './ranges.mjs';

let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

async function scheduleDaily() {
  if (process.env.SYNC_AUTO_SCHEDULE === 'false') return;
  const { day, hour } = businessDate();
  if (hour < 5) return;
  const result = await getPool().query(`INSERT INTO sync_schedule(sync_date) VALUES ($1)
    ON CONFLICT DO NOTHING RETURNING sync_date`, [day]);
  if (!result.rowCount) return;
  try {
    await enqueueDays(addDays(day, -7), day, { refresh: true });
    await enqueueRawRange(addDays(day, -7), day, { refresh: true });
    console.log(`[SYNC][reports] daily queued ${addDays(day, -7)}..${day}`);
  } catch (error) {
    await getPool().query('DELETE FROM sync_schedule WHERE sync_date=$1', [day]);
    throw error;
  }
}

async function scheduleBackfill() {
  if (process.env.SYNC_AUTO_SCHEDULE === 'false') return;
  const { day } = businessDate();
  const month = `${day.slice(0, 7)}-01`;
  const coverage = await rangeStatus(month, day, { enqueue: false });
  if (coverage.status !== 'ready') return;
  const required = [
    ...DATED_SOURCES.map(({ entity }) => datedType(entity)),
    ...SNAPSHOT_SOURCES.map(datedType),
  ];
  const raw = await getPool().query(`SELECT data_type,count(*)::integer AS count FROM sync_days
    WHERE sync_date BETWEEN $1 AND $2 AND status IN ('completed','failed') AND data_type=ANY($3)
    GROUP BY data_type`, [month, day, required]);
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${month}T00:00:00Z`)) / 86_400_000) + 1;
  if (raw.rows.length !== required.length || raw.rows.some(row => row.count !== days)) return;
  const catalogs = await getPool().query(`SELECT count(*)::integer AS count FROM sync_days
    WHERE sync_date=$1 AND status IN ('completed','failed') AND data_type=ANY($2)`,
  [day, CATALOG_SOURCES.map(datedType)]);
  if (catalogs.rows[0].count !== CATALOG_SOURCES.length) return;
  const marker = await getPool().query(`INSERT INTO sync_backfill(sync_month) VALUES ($1)
    ON CONFLICT DO NOTHING RETURNING sync_month`, [month]);
  if (!marker.rowCount) return;
  try {
    const [year, monthNumber] = month.split('-').map(Number);
    const from = new Date(Date.UTC(year, monthNumber - 4, 1)).toISOString().slice(0, 10);
    const to = addDays(month, -1);
    await enqueueDays(from, to);
    await enqueueRawRange(from, to);
    console.log(`[SYNC][reports] background queued ${from}..${to}`);
  } catch (error) {
    await getPool().query('DELETE FROM sync_backfill WHERE sync_month=$1', [month]);
    throw error;
  }
}

const lockClient = await getPool().connect();
try {
  const lock = await lockClient.query('SELECT pg_try_advisory_lock(38291741) AS acquired');
  if (!lock.rows[0].acquired) {
    console.error('[SYNC] Worker уже запущен для этой базы. Проверьте первый терминал и очередь sync_jobs. Если меняли .env, остановите старый worker и запустите заново.');
    process.exitCode = 1;
  } else {
    await recoverJobs();
    while (!stopping) {
      try {
        await scheduleDaily();
        await scheduleBackfill();
        const { day: preferredDay } = businessDate();
        const job = await claimJob(`${preferredDay.slice(0, 7)}-01`, preferredDay);
        if (!job) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        const day = job.day;
        const start = Date.now();
        console.log(`[SYNC][reports][${day}] started attempt=${job.attempt}`);
        try {
          if (job.data_type === 'reports') {
            const reports = await fetchReportDay(day);
            await storeReports(day, reports, job.id);
            console.log(`[SYNC][reports][${day}] completed fetched=${reports.length} durationMs=${Date.now() - start}`);
          } else if (job.data_type.startsWith('raw:')) {
            const source = job.data_type.slice(4);
            const rows = await fetchRawSource(day, source);
            await storeRaw(day, source, rows, job);
            console.log(`[SYNC][${source}][${day}] completed fetched=${rows.length} durationMs=${Date.now() - start}`);
          } else throw new Error(`Неизвестный тип задания ${job.data_type}`);
        } catch (error) {
          console.error(`[SYNC][reports][${day}] attempt=${job.attempt} error=${error.message}`);
          await failJob(job, error.message);
        }
      } catch (error) {
        console.error('[SYNC] worker loop error', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
} finally {
  try { await lockClient.query('SELECT pg_advisory_unlock(38291741)'); }
  finally { lockClient.release(); await closePool(); }
}
