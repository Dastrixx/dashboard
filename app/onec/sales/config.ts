import type { AnalyticsPeriod, SalesDateRange } from "./types";

export const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "";
export const DAY_MS = 86_400_000;
export const TABLE_PAGE_SIZE = 20;

export function formatQueryDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function rollingDateRange(
  days: number,
  now = new Date(),
): SalesDateRange {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));

  return {
    from: formatQueryDate(from),
    to: formatQueryDate(now),
  };
}

export function dateRangeQuery(range: SalesDateRange) {
  return new URLSearchParams({
    from: range.from,
    to: range.to,
  }).toString();
}

export const PERIODS: Record<
  AnalyticsPeriod,
  { label: string; days: number; caption: string }
> = {
  day: { label: "День", days: 1, caption: "за день" },
  week: { label: "Неделя", days: 7, caption: "за неделю" },
  month: { label: "Месяц", days: 30, caption: "за 30 дней" },
};

export const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "KGS",
  maximumFractionDigits: 0,
});

export const number = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
});

export const compactNumber = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const shortDate = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
});
