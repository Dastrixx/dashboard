const DAY_MS = 86_400_000;

export function validDay(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

export function daysInRange(from, to) {
  if (!validDay(from) || !validDay(to) || from > to) throw new Error('Некорректный диапазон дат');
  const result = [];
  for (let time = Date.parse(`${from}T00:00:00Z`); time <= Date.parse(`${to}T00:00:00Z`); time += DAY_MS) {
    result.push(new Date(time).toISOString().slice(0, 10));
    if (result.length > 366) throw new Error('Максимальный диапазон — 366 дней');
  }
  return result;
}

export function addDays(day, count) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
}

export function businessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.SYNC_TIMEZONE || 'Asia/Almaty',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { day: `${value.year}-${value.month}-${value.day}`, hour: Number(value.hour) };
}
