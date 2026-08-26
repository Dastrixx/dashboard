import { DAY_MS, PERIODS, shortDate } from "./config";
import type {
  AnalyticsPeriod,
  ChartPoint,
  OnecCategoryReference,
  OnecProductReference,
  OnecRetailReport,
  ProductRow,
  RevenueBucket,
  SalesAnalytics,
} from "./types";

export function percentageChange(current: number, previous: number) {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

export function inRange(value: string, from: number, to: number) {
  const timestamp = new Date(value).getTime();
  return timestamp >= from && timestamp <= to;
}

function grossRevenue(reports: OnecRetailReport[]) {
  return reports.reduce(
    (sum, report) => sum + Number(report.СуммаДокумента || 0),
    0,
  );
}

function returnsAmount(reports: OnecRetailReport[]) {
  return reports.reduce(
    (sum, report) => sum + Number(report.СуммаВозвратов || 0),
    0,
  );
}

function netRevenue(report: OnecRetailReport) {
  return (
    Number(report.СуммаДокумента || 0) -
    Number(report.СуммаВозвратов || 0)
  );
}

export function buildProductRows(
  reports: OnecRetailReport[],
  products: OnecProductReference[],
  categories: OnecCategoryReference[],
) {
  const productByKey = new Map(
    products.map((product) => [product.Ref_Key, product]),
  );
  const categoryByKey = new Map(
    categories.map((category) => [category.Ref_Key, category.Description]),
  );
  const aggregate = new Map<string, { revenue: number; sold: number }>();

  const addLine = (line: OnecRetailReport["Товары"][number], sign: 1 | -1) => {
      const current = aggregate.get(line.Номенклатура_Key) || {
        revenue: 0,
        sold: 0,
      };
      current.revenue += sign * Number(line.Сумма || 0);
      current.sold += sign * Number(line.Количество || 0);
      aggregate.set(line.Номенклатура_Key, current);
  };

  reports.forEach((report) => {
    (report.Товары || []).forEach((line) => addLine(line, 1));
    (report.ВозвращенныеТовары || []).forEach((line) => addLine(line, -1));
  });

  const totalRevenue =
    [...aggregate.values()].reduce(
      (sum, item) => sum + Math.max(item.revenue, 0),
      0,
    ) || 1;
  let cumulative = 0;

  return [...aggregate.entries()]
    .map(([key, value]) => {
      const product = productByKey.get(key);

      return {
        key,
        article: product?.Артикул || product?.Code || "—",
        name:
          product?.Description ||
          product?.НаименованиеПолное ||
          "Название не найдено",
        category:
          product?.BusinessCategory ||
          categoryByKey.get(product?.BusinessCategory_Key || "") ||
          "Не классифицировано",
        revenue: value.revenue,
        sold: value.sold,
        share: 0,
        abc: "C" as const,
      };
    })
    .sort((left, right) => right.revenue - left.revenue)
    .map((row): ProductRow => {
      const share = (Math.max(row.revenue, 0) / totalRevenue) * 100;
      cumulative += share;

      return {
        ...row,
        share,
        abc: cumulative <= 80 ? "A" : cumulative <= 95 ? "B" : "C",
      };
    });
}

function buildRevenueBuckets(
  reports: OnecRetailReport[],
  rangeStart: number,
  duration: number,
  period: AnalyticsPeriod,
) {
  const bucketCount = period === "day" ? 6 : period === "week" ? 7 : 30;
  const bucketSize = duration / bucketCount;
  const buckets: RevenueBucket[] = Array.from(
    { length: bucketCount },
    (_, index) => ({
      label:
        period === "day"
          ? `${index * 4}–${(index + 1) * 4}ч`
          : shortDate.format(new Date(rangeStart + index * bucketSize)),
      value: 0,
    }),
  );

  reports.forEach((report) => {
    const reportTime = new Date(report.Date).getTime();
    const bucketIndex = Math.min(
      Math.floor((reportTime - rangeStart) / bucketSize),
      buckets.length - 1,
    );
    if (bucketIndex >= 0) {
      buckets[bucketIndex].value += netRevenue(report);
    }
  });

  return buckets;
}

export function buildSalesAnalytics(
  reports: OnecRetailReport[],
  products: OnecProductReference[],
  categories: OnecCategoryReference[],
  period: AnalyticsPeriod,
): SalesAnalytics | null {
  const latestTimestamp = Math.max(
    ...reports.map((report) => new Date(report.Date).getTime()),
    0,
  );
  if (!latestTimestamp) return null;

  const duration = PERIODS[period].days * DAY_MS;
  const currentFrom = latestTimestamp - duration + 1;
  const previousTo = currentFrom - 1;
  const previousFrom = previousTo - duration + 1;
  const currentReports = reports.filter((report) =>
    inRange(report.Date, currentFrom, latestTimestamp),
  );
  const previousReports = reports.filter((report) =>
    inRange(report.Date, previousFrom, previousTo),
  );
  const currentGrossRevenue = grossRevenue(currentReports);
  const currentReturns = returnsAmount(currentReports);
  const previousGross = grossRevenue(previousReports);
  const previousReturnAmount = returnsAmount(previousReports);
  const revenue = currentGrossRevenue - currentReturns;
  const previousRevenue = previousGross - previousReturnAmount;
  const soldQuantity = (items: OnecRetailReport[]) =>
    items.reduce(
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
  const sold = soldQuantity(currentReports);
  const rows = buildProductRows(currentReports, products, categories);
  const categoryMap = new Map<string, number>(
    categories.map((category) => [category.Description, 0]),
  );

  rows.forEach((row) => {
    if (categoryMap.has(row.category)) {
      categoryMap.set(
        row.category,
        (categoryMap.get(row.category) || 0) + row.revenue,
      );
    }
  });

  const categorizedRevenue =
    [...categoryMap.values()].reduce((sum, value) => sum + value, 0) || 1;
  const categoryRows = [...categoryMap.entries()]
    .map(([label, value]) => ({
      label,
      value,
      share: (value / categorizedRevenue) * 100,
    }))
    .sort((left, right) => right.value - left.value);

  return {
    latestTimestamp,
    currentReports,
    revenue,
    previousRevenue,
    grossRevenue: currentGrossRevenue,
    previousGrossRevenue: previousGross,
    returns: currentReturns,
    previousReturns: previousReturnAmount,
    sold,
    averagePrice: sold ? revenue / sold : 0,
    activeSku: rows.length,
    rows,
    categoryRows,
    currentBuckets: buildRevenueBuckets(
      currentReports,
      currentFrom,
      duration,
      period,
    ),
    previousBuckets: buildRevenueBuckets(
      previousReports,
      previousFrom,
      duration,
      period,
    ),
    growth: percentageChange(revenue, previousRevenue),
  };
}

export function buildRankingRows(
  reports: OnecRetailReport[],
  products: OnecProductReference[],
  categories: OnecCategoryReference[],
  period: AnalyticsPeriod,
) {
  const latestTimestamp = Math.max(
    ...reports.map((report) => new Date(report.Date).getTime()),
    0,
  );
  if (!latestTimestamp) return [];

  const from = latestTimestamp - PERIODS[period].days * DAY_MS + 1;
  return buildProductRows(
    reports.filter((report) => inRange(report.Date, from, latestTimestamp)),
    products,
    categories,
  );
}

export function makeChartPoints(
  items: RevenueBucket[],
  maximum: number,
  width = 760,
  height = 270,
  padding = 18,
): ChartPoint[] {
  return items.map((item, index) => ({
    ...item,
    x:
      padding +
      (index / Math.max(items.length - 1, 1)) * (width - padding * 2),
    y:
      height - padding - (item.value / maximum) * (height - padding * 2),
  }));
}

export function summarizeAbc(rows: ProductRow[]) {
  return (["A", "B", "C"] as const).map((group) => {
    const groupRows = rows.filter((row) => row.abc === group);
    return {
      group,
      count: groupRows.length,
      share: groupRows.reduce((sum, row) => sum + row.share, 0),
    };
  });
}

export function downloadRankingCsv(filename: string, rows: ProductRow[]) {
  const escape = (value: string | number) =>
    `"${String(value).replaceAll('"', '""')}"`;
  const csv = [
    ["Артикул", "Товар", "Категория", "Выручка, сом", "Продано"],
    ...rows.map((row) => [
      row.article,
      row.name,
      row.category,
      row.revenue,
      row.sold,
    ]),
  ]
    .map((line) => line.map(escape).join(";"))
    .join("\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
