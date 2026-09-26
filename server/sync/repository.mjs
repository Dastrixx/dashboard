import { getPool } from './db.mjs';
import { daysInRange } from './ranges.mjs';

export async function enqueueDays(from, to, { refresh = false } = {}) {
  const days = daysInRange(from, to);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const day of days) {
      await client.query(`INSERT INTO sync_jobs (data_type, sync_date, status) VALUES ('reports', $1, 'pending')
        ON CONFLICT (data_type, sync_date) DO UPDATE SET status='pending', attempt=0, run_after=now(), error=NULL, completed_at=NULL
        WHERE sync_jobs.status='failed' OR ($2 AND sync_jobs.status='completed')`, [day, refresh]);
      await client.query(`INSERT INTO sync_days (data_type, sync_date, status) VALUES ('reports', $1, 'pending')
        ON CONFLICT (data_type, sync_date) DO UPDATE SET status='pending', error=NULL
        WHERE sync_days.status='failed'`, [day]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  return days.length;
}

export async function rangeStatus(from, to, { enqueue = true } = {}) {
  const days = daysInRange(from, to);
  const result = await getPool().query(
    `SELECT sync_date::text AS day, status, error FROM sync_days
     WHERE data_type='reports' AND sync_date BETWEEN $1 AND $2`, [from, to]);
  const states = new Map(result.rows.map(row => [row.day, row]));
  const missing = days.filter(day => !states.has(day));
  if (enqueue && missing.length) {
    // The unique constraint deduplicates concurrent callers, including separate API processes.
    for (const day of missing) await enqueueDays(day, day);
  }
  const failed = days.filter(day => states.get(day)?.status === 'failed');
  const pending = days.filter(day => states.get(day)?.status !== 'completed' && !failed.includes(day));
  return {
    status: failed.length ? 'failed' : pending.length ? 'syncing' : 'ready',
    completedDays: days.length - failed.length - pending.length,
    totalDays: days.length,
    missingRanges: pending.map(day => ({ from: day, to: day })),
    failedRanges: failed.map(day => ({ from: day, to: day, error: states.get(day)?.error })),
  };
}

export async function claimJob() {
  const result = await getPool().query(`WITH next AS (
    SELECT id FROM sync_jobs WHERE status='pending' AND run_after <= now()
    ORDER BY run_after, id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE sync_jobs j SET status='running', attempt=attempt+1, started_at=now()
    FROM next WHERE j.id=next.id RETURNING j.*, j.sync_date::text AS day`);
  const job = result.rows[0];
  if (job) await getPool().query(`UPDATE sync_days SET status='running', started_at=now(), error=NULL
    WHERE data_type=$1 AND sync_date=$2 AND status <> 'completed'`, [job.data_type, job.day]);
  return job;
}

export async function recoverJobs() {
  // Called only after acquiring the singleton worker advisory lock.
  await getPool().query(`UPDATE sync_jobs SET status='pending', run_after=now()
    WHERE status='running'`);
  await getPool().query(`UPDATE sync_days SET status='pending' WHERE status='running'`);
}

export async function storeReports(day, reports, jobId) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // A day is visible only after the entire fetch and transaction succeed.
    await client.query('DELETE FROM retail_reports WHERE sync_date=$1', [day]);
    for (const report of reports) {
      await client.query('DELETE FROM retail_reports WHERE source_id=$1', [report.Ref_Key]);
      await client.query(`INSERT INTO retail_reports
        (source_id, document_date, sync_date, number, posted, deletion_mark, store_id, cashbox_id, net_amount, returns_amount, raw_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
        report.Ref_Key, report.Date, day, report.Number, !!report.Posted, !!report.DeletionMark,
        report.Магазин_Key, report.КассаККМ_Key, report.СуммаДокумента, report.СуммаВозвратов, report,
      ]);
      for (const [kind, lines] of [['sale', report.Товары], ['return', report.ВозвращенныеТовары]]) {
        for (const [index, line] of (lines || []).entries()) {
          await client.query(`INSERT INTO retail_report_lines
            (report_id, line_kind, line_number, product_id, warehouse_id, seller_id, quantity, amount, raw_data)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
            report.Ref_Key, kind, index + 1, line.Номенклатура_Key, line.Склад_Key,
            line.Продавец_Key, line.Количество, line.Сумма, line,
          ]);
        }
      }
    }
    await client.query(`INSERT INTO sync_days (data_type,sync_date,status,started_at,completed_at,records_count,error)
      VALUES ('reports',$1,'completed',now(),now(),$2,NULL)
      ON CONFLICT (data_type,sync_date) DO UPDATE SET status='completed',completed_at=now(),records_count=$2,error=NULL`, [day, reports.length]);
    await client.query(`UPDATE sync_jobs SET status='completed', completed_at=now(), error=NULL WHERE id=$1`, [jobId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function failJob(job, error) {
  const retry = job.attempt < 4;
  const seconds = [30, 120, 300][job.attempt - 1];
  await getPool().query(`UPDATE sync_jobs SET status=$2,run_after=now()+($3 * interval '1 second'),error=$4,
    completed_at=CASE WHEN $2='failed' THEN now() ELSE NULL END WHERE id=$1`,
  [job.id, retry ? 'pending' : 'failed', retry ? seconds : 0, String(error).slice(0, 1000)]);
  await getPool().query(`UPDATE sync_days SET status=$2,error=$3 WHERE data_type='reports' AND sync_date=$1 AND status <> 'completed'`,
    [job.day, retry ? 'pending' : 'failed', String(error).slice(0, 1000)]);
}

export async function readReports(from, to) {
  const result = await getPool().query(`SELECT raw_data FROM retail_reports
    WHERE sync_date BETWEEN $1 AND $2 AND posted AND NOT deletion_mark
    ORDER BY document_date DESC, source_id DESC`, [from, to]);
  return result.rows.map(row => row.raw_data);
}

export async function syncHealth() {
  const [jobs, freshness] = await Promise.all([
    getPool().query(`SELECT count(*) FILTER (WHERE status='running')::integer AS running,
      count(*) FILTER (WHERE status='failed')::integer AS failed FROM sync_jobs`),
    getPool().query(`SELECT max(sync_date)::text AS day,max(completed_at) AS completed
      FROM sync_days WHERE data_type='reports' AND status='completed'`),
  ]);
  return { lastSuccessfulSync: freshness.rows[0].completed, runningJobs: jobs.rows[0].running,
    failedJobs: jobs.rows[0].failed, dataFreshness: { reports: freshness.rows[0].day } };
}
