import { getPool } from './db.mjs';
import { daysInRange } from './ranges.mjs';
import { rawRecordKey } from './raw-source.mjs';
import { CATALOG_SOURCES, DATED_SOURCES, SNAPSHOT_SOURCES, datedType } from './sources.mjs';

export async function enqueueDays(from, to, { refresh = false, retryNow = false, dataType = 'reports' } = {}) {
  const days = daysInRange(from, to);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO sync_jobs (data_type, sync_date, status)
      SELECT $5, day::date, 'pending'
      FROM generate_series($1::date,$2::date,interval '1 day') AS dates(day)
      ON CONFLICT (data_type, sync_date) DO UPDATE
        SET status='pending', attempt=0, run_after=now(), error=NULL, completed_at=NULL
      WHERE sync_jobs.status='failed' OR ($3 AND sync_jobs.status='completed') OR ($4 AND sync_jobs.status='pending')`,
    [from, to, refresh, retryNow, dataType]);
    await client.query(`INSERT INTO sync_days (data_type, sync_date, status)
      SELECT $4, day::date, 'pending'
      FROM generate_series($1::date,$2::date,interval '1 day') AS dates(day)
      ON CONFLICT (data_type, sync_date) DO UPDATE SET status='pending', error=NULL, completed_at=NULL
      WHERE sync_days.status='failed' OR ($3 AND sync_days.status='completed')`,
    [from, to, refresh, dataType]);
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
    `SELECT d.sync_date::text AS day,
       CASE WHEN j.status IN ('pending','running','failed') THEN j.status ELSE d.status END AS status,
       COALESCE(j.error, d.error) AS error
     FROM sync_days d LEFT JOIN sync_jobs j ON j.data_type=d.data_type AND j.sync_date=d.sync_date
     WHERE d.data_type='reports' AND d.sync_date BETWEEN $1 AND $2`, [from, to]);
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

export async function claimJob(preferredFrom, preferredTo) {
  const result = await getPool().query(`WITH next AS (
    SELECT id FROM sync_jobs WHERE status='pending' AND run_after <= now()
    ORDER BY CASE WHEN sync_date BETWEEN $1 AND $2 THEN 0 ELSE 1 END, run_after, id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE sync_jobs j SET status='running', attempt=attempt+1, started_at=now()
    FROM next WHERE j.id=next.id RETURNING j.*, j.sync_date::text AS day`, [preferredFrom, preferredTo]);
  const job = result.rows[0];
  if (job) await getPool().query(`UPDATE sync_days SET status='running', started_at=now(), completed_at=NULL, error=NULL
    WHERE data_type=$1 AND sync_date=$2`, [job.data_type, job.day]);
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
    await client.query('DELETE FROM onec_raw_records WHERE source=$1 AND scope_date=$2',
      ['Document_ОтчетОРозничныхПродажах', day]);
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
      await client.query(`INSERT INTO onec_raw_records(source,scope_date,source_key,source_day,raw_data)
        VALUES ($1,$2,$3,$2,$4)`,
      ['Document_ОтчетОРозничныхПродажах', day, report.Ref_Key, report]);
    }
    await client.query(`INSERT INTO sync_days (data_type,sync_date,status,started_at,completed_at,records_count,error)
      VALUES ('reports',$1,'completed',now(),now(),$2,NULL)
      ON CONFLICT (data_type,sync_date) DO UPDATE SET status='completed',completed_at=now(),records_count=$2,error=NULL`, [day, reports.length]);
    await client.query(`UPDATE sync_jobs SET status='completed', completed_at=now(), error=NULL WHERE id=$1`, [jobId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function storeRaw(day, source, rows, job) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM onec_raw_records WHERE source=$1 AND scope_date=$2', [source, day]);
    for (let index = 0; index < rows.length; index += 500) {
      const records = rows.slice(index, index + 500).map(row => ({
        source_key: rawRecordKey(row, source),
        source_day: String(row.Date || row.Period || '').slice(0, 10) || null,
        raw_data: row,
      }));
      await client.query(`INSERT INTO onec_raw_records(source,scope_date,source_key,source_day,raw_data)
        SELECT $1,$2,r.source_key,r.source_day,r.raw_data
        FROM jsonb_to_recordset($3::jsonb) AS r(source_key text,source_day date,raw_data jsonb)`,
      [source, day, JSON.stringify(records)]);
    }
    await client.query(`INSERT INTO sync_days(data_type,sync_date,status,started_at,completed_at,records_count,error)
      VALUES ($1,$2,'completed',now(),now(),$3,NULL)
      ON CONFLICT(data_type,sync_date) DO UPDATE SET status='completed',completed_at=now(),records_count=$3,error=NULL`,
    [job.data_type, day, rows.length]);
    await client.query(`UPDATE sync_jobs SET status='completed',completed_at=now(),error=NULL WHERE id=$1`, [job.id]);
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
  await getPool().query(`UPDATE sync_days SET status=$2,error=$3 WHERE data_type=$4 AND sync_date=$1 AND status <> 'completed'`,
    [job.day, retry ? 'pending' : 'failed', String(error).slice(0, 1000), job.data_type]);
}

export async function readReports(from, to) {
  const result = await getPool().query(`SELECT r.raw_data FROM retail_reports r
    JOIN sync_days d ON d.data_type='reports' AND d.sync_date=r.sync_date
    JOIN sync_jobs j ON j.data_type='reports' AND j.sync_date=r.sync_date
    WHERE r.sync_date BETWEEN $1 AND $2 AND d.status='completed' AND j.status='completed'
      AND r.posted AND NOT r.deletion_mark
    ORDER BY r.document_date DESC, r.source_id DESC`, [from, to]);
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

export async function rawStatus(from, to) {
  const days = daysInRange(from, to);
  const types = [
    ...DATED_SOURCES.map(({ entity }) => datedType(entity)),
    ...SNAPSHOT_SOURCES.map(datedType),
  ];
  const catalogTypes = CATALOG_SOURCES.map(datedType);
  const result = await getPool().query(`SELECT data_type,status,count(*)::integer AS days,
      sum(records_count)::integer AS records,max(error) AS error FROM sync_days
    WHERE (sync_date BETWEEN $1 AND $2 AND data_type=ANY($3))
       OR (sync_date=$2 AND data_type=ANY($4))
    GROUP BY data_type,status`, [from, to, types, catalogTypes]);
  const sources = [...types, ...catalogTypes].map(type => {
    const rows = result.rows.filter(row => row.data_type === type);
    const completed = rows.find(row => row.status === 'completed');
    const failed = rows.find(row => row.status === 'failed');
    const totalDays = catalogTypes.includes(type) ? 1 : days.length;
    return { source: type.slice(4), completedDays: completed?.days || 0,
      totalDays, records: completed?.records || 0, failedDays: failed?.days || 0,
      error: failed?.error || null };
  });
  return { from, to, sources,
    status: sources.some(source => source.failedDays) ? 'failed'
      : sources.every(source => source.completedDays === source.totalDays) ? 'ready' : 'syncing' };
}

export async function rawJobsMissing(from, to) {
  const days = daysInRange(from, to);
  const types = [
    ...DATED_SOURCES.map(({ entity }) => datedType(entity)),
    ...SNAPSHOT_SOURCES.map(datedType),
  ];
  const catalogs = CATALOG_SOURCES.map(datedType);
  const result = await getPool().query(`SELECT count(*)::integer AS count FROM sync_jobs
    WHERE (sync_date BETWEEN $1 AND $2 AND data_type=ANY($3))
       OR (sync_date=$2 AND data_type=ANY($4))`, [from, to, types, catalogs]);
  return result.rows[0].count < days.length * types.length + catalogs.length;
}

export async function readRaw(source, from, to, limit, offset) {
  daysInRange(from, to);
  const [rows, count] = await Promise.all([
    getPool().query(`SELECT raw_data FROM onec_raw_records
      WHERE source=$1 AND scope_date BETWEEN $2 AND $3
      ORDER BY scope_date,source_key LIMIT $4 OFFSET $5`, [source, from, to, limit, offset]),
    getPool().query(`SELECT count(*)::integer AS total FROM onec_raw_records
      WHERE source=$1 AND scope_date BETWEEN $2 AND $3`, [source, from, to]),
  ]);
  return { items: rows.rows.map(row => row.raw_data), total: count.rows[0].total };
}
