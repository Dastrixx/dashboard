import { buildProductRows, percentageChange } from "../sales/analytics";
import type {
  OnecCategoryReference,
  OnecProductReference,
  OnecRetailReport,
} from "../sales/types";
import type { Period } from "../types";
import type {
  OwnerComparisonBucket,
  OwnerOverviewAnalytics,
} from "./types";

const DAY_MS = 86_400_000;

function reportRevenue(reports: OnecRetailReport[]) {
  return reports.reduce(
    (sum, report) =>
      sum +
      Number(report.СуммаДокумента || 0) -
      Number(report.СуммаВозвратов || 0),
    0,
  );
}

function reportReturns(reports: OnecRetailReport[]) {
  return reports.reduce(
    (sum, report) => sum + Number(report.СуммаВозвратов || 0),
    0,
  );
}

function soldQuantity(reports: OnecRetailReport[]) {
  return reports.reduce(
    (sum, report) =>
      sum +
      (report.Товары || []).reduce(
        (lineSum, line) => lineSum + Number(line.Количество || 0),
        0,
      ) -
      (report.ВозвращенныеТовары || []).reduce(
        (lineSum, line) => lineSum + Number(line.Количество || 0),
        0,
      ),
    0,
  );
}

function inRange(report: OnecRetailReport, from: number, to: number) {
  const timestamp = new Date(report.Date).getTime();
  return timestamp >= from && timestamp <= to;
}

function startOfCalendarDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function periodBounds(latestTimestamp: number, days: Period) {
  const latestDayStart = startOfCalendarDay(latestTimestamp);
  const currentFrom = latestDayStart - (days - 1) * DAY_MS;
  const currentTo = latestDayStart + DAY_MS - 1;
  const previousTo = currentFrom - 1;
  const previousFrom = currentFrom - days * DAY_MS;

  return { currentFrom, currentTo, previousFrom, previousTo };
}

function buildComparison(
  current: OnecRetailReport[],
  previous: OnecRetailReport[],
  currentFrom: number,
  previousFrom: number,
  latestTimestamp: number,
  days: number,
): OwnerComparisonBucket[] {
  const bucketCount = days === 7 ? 7 : 15;
  const duration = days * DAY_MS;
  const bucketSize = duration / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    label: new Date(currentFrom + index * bucketSize).toLocaleDateString(
      "ru-RU",
      { day: "2-digit", month: "2-digit" },
    ),
    value: 0,
    previousValue: 0,
  }));

  const addReports = (
    reports: OnecRetailReport[],
    rangeStart: number,
    field: "value" | "previousValue",
  ) => {
    reports.forEach((report) => {
      const timestamp = new Date(report.Date).getTime();
      const index = Math.min(
        Math.max(Math.floor((timestamp - rangeStart) / bucketSize), 0),
        buckets.length - 1,
      );
      buckets[index][field] +=
        Number(report.СуммаДокумента || 0) -
        Number(report.СуммаВозвратов || 0);
    });
  };

  addReports(current, currentFrom, "value");
  addReports(previous, previousFrom, "previousValue");

  // Последний бакет включает документ с точной датой-якорем.
  if (latestTimestamp < currentFrom) return [];
  return buckets;
}

function buildCategories(
  reports: OnecRetailReport[],
  products: OnecProductReference[],
  categories: OnecCategoryReference[],
) {
  if (!products.length || !categories.length) return [];

  const rows = buildProductRows(reports, products, categories);
  const revenueByCategory = new Map(
    categories.map((category) => [
      category.Description,
      {
        revenue: 0,
        subcategories: new Map<
          string,
          { label: string; revenue: number }
        >(),
      },
    ]),
  );

  rows.forEach((row) => {
    const category = revenueByCategory.get(row.category) || {
      revenue: 0,
      subcategories: new Map<
        string,
        { label: string; revenue: number }
      >(),
    };
    const subcategoryKey = row.subcategoryKey || row.subcategory;
    const subcategory = category.subcategories.get(subcategoryKey) || {
      label: row.subcategory,
      revenue: 0,
    };

    category.revenue += row.revenue;
    subcategory.revenue += row.revenue;
    category.subcategories.set(subcategoryKey, subcategory);
    revenueByCategory.set(row.category, category);
  });

  const total = [...revenueByCategory.values()].reduce(
    (sum, category) => sum + category.revenue,
    0,
  );

  return [...revenueByCategory.entries()]
    .map(([label, category]) => ({
      label,
      revenue: category.revenue,
      share: total ? (category.revenue / total) * 100 : 0,
      subcategories: [...category.subcategories.entries()]
        .map(([key, subcategory]) => ({
          key,
          label: subcategory.label,
          revenue: subcategory.revenue,
          share: category.revenue
            ? (subcategory.revenue / category.revenue) * 100
            : 0,
        }))
        .sort((left, right) => right.revenue - left.revenue),
    }))
    .filter((category) => category.revenue > 0)
    .sort((left, right) => right.revenue - left.revenue);
}

export function buildOwnerOverview(
  sourceReports: OnecRetailReport[],
  products: OnecProductReference[],
  categories: OnecCategoryReference[],
  days: Period,
  dateRange?: { from: string; to: string } | null,
): OwnerOverviewAnalytics | null {
  const reports = sourceReports.filter((report) => report.Posted);
  const absoluteLatestTimestamp = Math.max(
    ...reports.map((report) => new Date(report.Date).getTime()),
    0,
  );
  if (!absoluteLatestTimestamp) return null;

  const customFrom = dateRange
    ? new Date(`${dateRange.from}T00:00:00`).getTime()
    : null;
  const customTo = dateRange
    ? new Date(`${dateRange.to}T23:59:59.999`).getTime()
    : null;
  const customDuration =
    customFrom !== null && customTo !== null ? customTo - customFrom + 1 : 0;
  const bounds =
    customFrom !== null &&
    customTo !== null &&
    Number.isFinite(customFrom) &&
    Number.isFinite(customTo) &&
    customFrom <= customTo
      ? {
          currentFrom: customFrom,
          currentTo: customTo,
          previousFrom: customFrom - customDuration,
          previousTo: customFrom - 1,
        }
      : periodBounds(absoluteLatestTimestamp, days);
  const { currentFrom, currentTo, previousFrom, previousTo } = bounds;
  const current = reports.filter((report) =>
    inRange(report, currentFrom, currentTo),
  );
  const previous = reports.filter((report) =>
    inRange(report, previousFrom, previousTo),
  );
  if (!current.length) return null;

  const latestTimestamp = Math.max(
    ...current.map((report) => new Date(report.Date).getTime()),
  );

  const activityDates = [...new Set(reports.map((report) => report.Date.slice(0, 10)))]
    .sort()
    .reverse();
  const latestDay = activityDates[0];
  const previousDay = activityDates[1];
  const todayReports = reports.filter((report) =>
    report.Date.startsWith(latestDay),
  );
  const previousDayReports = previousDay
    ? reports.filter((report) => report.Date.startsWith(previousDay))
    : [];
  const revenue = reportRevenue(current);
  const previousRevenue = reportRevenue(previous);
  const sold = soldQuantity(current);
  const previousSold = soldQuantity(previous);

  return {
    latestDate: new Date(latestTimestamp).toISOString(),
    today: {
      revenue: reportRevenue(todayReports),
      previousRevenue: reportRevenue(previousDayReports),
      sold: soldQuantity(todayReports),
      previousSold: soldQuantity(previousDayReports),
      returns: reportReturns(todayReports),
    },
    period: {
      revenue,
      previousRevenue,
      sold,
      previousSold,
      returns: reportReturns(current),
      previousReturns: reportReturns(previous),
      activeSku: buildProductRows(current, products, categories).length,
      revenueGrowth: percentageChange(revenue, previousRevenue),
      soldGrowth: percentageChange(sold, previousSold),
    },
    comparison: buildComparison(
      current,
      previous,
      currentFrom,
      previousFrom,
      latestTimestamp,
      Math.max(Math.round((currentTo - currentFrom + 1) / DAY_MS), 1),
    ),
    categories: buildCategories(current, products, categories),
  };
}
