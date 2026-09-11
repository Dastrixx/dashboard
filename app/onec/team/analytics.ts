import { ZERO_GUID } from "../shared";
import type { SellerPayload, SellerReference } from "../types";
import type { SellerChart, SellerRow, TeamView } from "./types";

const CHART_LEFT = 10;
const CHART_RIGHT = 710;
const CHART_BASELINE = 190;
const CHART_HEIGHT = 160;

export function buildTeamView(
  payload: SellerPayload,
  selectedStoreKey: string,
): TeamView {
  const people = createReferenceMap(payload.references?.sellers);
  const stores = createReferenceMap(payload.references?.stores);

  const rows = (payload.items ?? [])
    .map((item) => {
      const person = people.get(item.Продавец_Key);
      const storeKey = resolveStoreKey(item.Магазин_Key, person?.Магазин_Key);

      return {
        key: `${item.Продавец_Key}:${storeKey}`,
        name:
          person?.Description ??
          `Продавец ${item.Продавец_Key.slice(0, 8)}`,
        storeKey,
        store: resolveStoreName(stores.get(storeKey), storeKey),
        revenue: Number(item.СтоимостьTurnover ?? 0),
        quantity: Number(item.КоличествоTurnover ?? 0),
        checks: Number(item.Чеков ?? 0),
        checkKeys: item.ИдентификаторыЧеков ?? [],
        discounts: Math.max(Number(item.СуммаСкидок ?? 0), 0),
        returns: Number(item.СтрокВозвратов ?? 0),
        daily: item.ПродажиПоДатам ?? {},
      };
    })
    .filter(
      (item) =>
        selectedStoreKey === "all" || item.storeKey === selectedStoreKey,
    )
    .sort((left, right) => right.revenue - left.revenue);

  const revenue = sum(rows, (item) => item.revenue);
  const checks = countUniqueChecks(rows);

  return {
    rows: addRanking(rows, revenue),
    stores: [...stores.values()].sort(compareStores),
    revenue,
    checks,
    averageCheck: checks ? revenue / checks : 0,
    quantity: sum(rows, (item) => item.quantity),
  };
}

export function buildSellerChart(seller?: SellerRow): SellerChart {
  const dates = Object.keys(seller?.daily ?? {}).sort();
  const values = dates.map((date) =>
    Math.max(Number(seller?.daily[date] ?? 0), 0),
  );
  const maximum = Math.max(...values, 1);

  const points = values.map((value, index) => ({
    date: dates[index],
    value,
    x: chartX(index, dates.length),
    y: CHART_BASELINE - (value / maximum) * CHART_HEIGHT,
  }));

  return {
    points,
    line: points.map((point) => `${point.x},${point.y}`).join(" "),
    area: buildChartArea(points),
  };
}

function createReferenceMap(items: SellerReference[] = []) {
  return new Map(items.map((item) => [item.Ref_Key, item]));
}

function resolveStoreKey(itemStoreKey?: string, personStoreKey?: string) {
  if (itemStoreKey && itemStoreKey !== ZERO_GUID) {
    return itemStoreKey;
  }

  return personStoreKey ?? ZERO_GUID;
}

function resolveStoreName(store: SellerReference | undefined, storeKey: string) {
  if (store?.Description) {
    return store.Description;
  }

  return storeKey === ZERO_GUID
    ? "Филиал не указан"
    : "Филиал не найден";
}

function countUniqueChecks(rows: Omit<SellerRow, "rank" | "share">[]) {
  const uniqueChecks = new Set(rows.flatMap((item) => item.checkKeys));

  return uniqueChecks.size || sum(rows, (item) => item.checks);
}

function addRanking(
  rows: Omit<SellerRow, "rank" | "share">[],
  teamRevenue: number,
): SellerRow[] {
  return rows.map((item, index) => ({
    ...item,
    rank: index + 1,
    share: teamRevenue ? (item.revenue / teamRevenue) * 100 : 0,
  }));
}

function compareStores(left: SellerReference, right: SellerReference) {
  return (left.Description ?? "").localeCompare(
    right.Description ?? "",
    "ru",
  );
}

function sum<T>(items: T[], selectValue: (item: T) => number) {
  return items.reduce((total, item) => total + selectValue(item), 0);
}

function chartX(index: number, total: number) {
  if (total === 1) {
    return (CHART_LEFT + CHART_RIGHT) / 2;
  }

  return CHART_LEFT + (index / (total - 1)) * (CHART_RIGHT - CHART_LEFT);
}

function buildChartArea(points: SellerChart["points"]) {
  if (!points.length) {
    return "";
  }

  const line = points.map((point) => `${point.x} ${point.y}`).join(" L ");
  const lastPoint = points.at(-1);

  return [
    `M ${points[0].x} ${CHART_BASELINE}`,
    `L ${line}`,
    `L ${lastPoint?.x} ${CHART_BASELINE}`,
    "Z",
  ].join(" ");
}
