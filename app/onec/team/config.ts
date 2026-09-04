import type { Period, SalesChannel } from "./types";

type FilterOption<T> = {
  value: T;
  label: string;
};

export const PERIOD_OPTIONS: FilterOption<Period>[] = [
  { value: 1, label: "Сегодня" },
  { value: 7, label: "Неделя" },
  { value: 30, label: "Месяц" },
];

export const CHANNEL_OPTIONS: FilterOption<SalesChannel>[] = [
  { value: "all", label: "Все" },
  { value: "online", label: "Онлайн" },
  { value: "offline", label: "Офлайн" },
];

export function getChannelLabel(channel: SalesChannel) {
  return (
    CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? "Все"
  );
}
export function formatChartDate(value: string) {
  const [, month = "", day = ""] = value.split("-");
  return `${day}.${month}`;
}
