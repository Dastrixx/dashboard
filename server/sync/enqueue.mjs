import { closePool } from './db.mjs';
import { enqueueDays } from './repository.mjs';
import { addDays, businessDate } from './ranges.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(item => item.startsWith('--') && item.includes('='))
  .map(item => item.slice(2).split('=')));
const { day } = businessDate();
let from = args.from;
let to = args.to;
let refresh = false;
if (process.argv.includes('--initial')) {
  const [year, month] = day.split('-').map(Number);
  from = new Date(Date.UTC(year, month - 4, 1)).toISOString().slice(0, 10);
  to = day;
} else if (process.argv.includes('--daily')) {
  from = addDays(day, -7); to = day; refresh = true;
}
try {
  const count = await enqueueDays(from, to, { refresh });
  console.log(`[SYNC][reports] queued ${count} days ${from}..${to}`);
} finally { await closePool(); }
