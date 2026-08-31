import type { Period } from "../types";

export const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "KGS",
  maximumFractionDigits: 0,
});

export const number = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 1,
});

export const compactMoney = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const periodLabel: Record<Period, string> = {
  7: "7 дней",
  30: "30 дней",
  90: "90 дней",
};

export function change(current: number, previous: number) {
  return previous ? ((current - previous) / previous) * 100 : null;
}
