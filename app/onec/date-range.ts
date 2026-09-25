const DAY_MS = 86_400_000;
const configuredOffset = Number(import.meta.env.VITE_ONEC_TIMEZONE_OFFSET_MINUTES ?? 360);
export const ONEC_OFFSET_MS = (Number.isFinite(configuredOffset) ? configuredOffset : 360) * 60_000;

export function onecCalendarDate(timestamp: number): string {
  return new Date(timestamp + ONEC_OFFSET_MS).toISOString().slice(0, 10);
}

export function onecRollingRange(days: number, timestamp: number) {
  const to = onecCalendarDate(timestamp);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * DAY_MS)
    .toISOString().slice(0, 10);
  return { from, to };
}

export function onecRangeBounds(range: { from: string; to: string }) {
  const currentFrom = Date.parse(`${range.from}T00:00:00Z`) - ONEC_OFFSET_MS;
  const endExclusive = Date.parse(`${range.to}T00:00:00Z`) + DAY_MS - ONEC_OFFSET_MS;
  const duration = endExclusive - currentFrom;
  return {
    currentFrom,
    currentTo: endExclusive - 1,
    previousFrom: currentFrom - duration,
    previousTo: currentFrom - 1,
    duration,
  };
}
