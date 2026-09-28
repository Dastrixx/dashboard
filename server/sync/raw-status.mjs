import { closePool } from './db.mjs';
import { rawStatus, rangeStatus } from './repository.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--') && arg.includes('='))
  .map(arg => arg.slice(2).split('=')));
try {
  const [reports, raw] = await Promise.all([
    rangeStatus(args.from, args.to, { enqueue: false }),
    rawStatus(args.from, args.to),
  ]);
  console.log(`[SYNC] reports ${reports.completedDays}/${reports.totalDays} ${reports.status}`);
  for (const source of raw.sources) {
    console.log(`[SYNC] ${source.source} ${source.completedDays}/${source.totalDays} records=${source.records} failed=${source.failedDays}${source.error ? ` error=${source.error}` : ''}`);
  }
  if (reports.status !== 'ready' || raw.status !== 'ready') process.exitCode = 1;
} finally { await closePool(); }
