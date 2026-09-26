import { closePool } from './db.mjs';
import { daysInRange } from './ranges.mjs';
import { readReports, rangeStatus } from './repository.mjs';
import { fetchReportDay } from './onec-reports.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--') && arg.includes('='))
  .map(arg => arg.slice(2).split('=')));
try {
  const days = daysInRange(args.from, args.to);
  if (days.length > 31) throw new Error('Сверяйте не более 31 дня за запуск');
  const coverage = await rangeStatus(args.from, args.to, { enqueue: false });
  if (coverage.status !== 'ready') throw new Error(`Период ещё не готов: ${coverage.completedDays}/${coverage.totalDays}`);
  let differences = 0;
  for (const day of days) {
    const source = (await fetchReportDay(day)).filter(row => row.Posted && !row.DeletionMark);
    const local = await readReports(day, day);
    const summarize = rows => ({
      count: rows.length,
      net: rows.reduce((sum, row) => sum + Number(row.СуммаДокумента || 0), 0),
      returns: rows.reduce((sum, row) => sum + Number(row.СуммаВозвратов || 0), 0),
      lines: rows.reduce((sum, row) => sum + (row.Товары || []).length + (row.ВозвращенныеТовары || []).length, 0),
      ids: rows.map(row => row.Ref_Key).sort(),
    });
    const expected = summarize(source);
    const actual = summarize(local);
    const matched = JSON.stringify(expected) === JSON.stringify(actual);
    if (!matched) differences += 1;
    console.log(`[VERIFY][reports][${day}] ${matched ? 'OK' : 'DIFFERENT'} 1C=${expected.count}/${expected.net}/${expected.returns}/${expected.lines} DB=${actual.count}/${actual.net}/${actual.returns}/${actual.lines}`);
  }
  if (differences) process.exitCode = 1;
} finally { await closePool(); }
