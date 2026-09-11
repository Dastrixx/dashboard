import { onecTurnovers } from "../onec.mjs";

const SALES_REGISTER = "AccumulationRegister_Продажи";
const DEFAULT_LIMIT = 20_000;
const MAX_LIMIT = 50_000;
const cache = new Map();

export async function loadSalesDocuments({
  startDate,
  endDate,
  includeSalesChannel = false,
  limit = DEFAULT_LIMIT,
}) {
  const safeLimit = Math.min(
    Math.max(Number(limit) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const cacheKey = [
    startDate.toISOString(),
    endDate.toISOString(),
    includeSalesChannel,
    safeLimit,
  ].join(":");
  const now = Date.now();
  const cached = cache.get(cacheKey);

  if (cached?.value && cached.expiresAt > now) return cached.value;
  if (cached?.promise) return cached.promise;

  const dimensions = [
    "Магазин",
    "ДокументПродажи",
    ...(includeSalesChannel ? ["ЗаказПокупателя"] : []),
  ];
  const promise = onecTurnovers(SALES_REGISTER, {
    startPeriod: startDate,
    endPeriod: endDate,
    dimensions: dimensions.join(","),
    top: safeLimit + 1,
    select: [
      "Магазин_Key",
      "ДокументПродажи",
      "ДокументПродажи_Type",
      ...(includeSalesChannel ? ["ЗаказПокупателя_Key"] : []),
      "КоличествоTurnover",
      "СтоимостьTurnover",
      "СтоимостьБезСкидокTurnover",
      "ор_СебестоимостьTurnover",
    ].join(","),
  }).then((rows) => ({
    rows: rows.slice(0, safeLimit),
    truncated: rows.length > safeLimit,
  }));
  const ttlMs = Math.max(
    Number(process.env.ONEC_REPORT_CACHE_TTL_MS || 30_000),
    5_000,
  );

  cache.set(cacheKey, { promise, expiresAt: now + ttlMs });

  try {
    const value = await promise;
    cache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
    return value;
  } catch (error) {
    cache.delete(cacheKey);
    throw error;
  }
}

function documentIdentity(row) {
  return String(row.ДокументПродажи || "").trim();
}

function isCheckDocument(row) {
  const type = String(row.ДокументПродажи_Type || "");
  return !type || type.includes("Document_ЧекККМ");
}

export function summarizeSalesDocuments(rows) {
  const documents = new Map();

  rows.forEach((row) => {
    const key = documentIdentity(row);
    if (!key || !isCheckDocument(row)) return;

    const current = documents.get(key) || {
      quantity: 0,
      revenue: 0,
      revenueBeforeDiscount: 0,
    };
    current.quantity += Number(row.КоличествоTurnover || 0);
    current.revenue += Number(row.СтоимостьTurnover || 0);
    current.revenueBeforeDiscount += Number(
      row.СтоимостьБезСкидокTurnover || 0,
    );
    documents.set(key, current);
  });

  const sales = [];
  const returns = [];
  documents.forEach((document) => {
    if (document.revenue === 0 && document.quantity === 0) return;

    const isReturn =
      document.revenue < 0 ||
      (document.revenue === 0 && document.quantity < 0);
    (isReturn ? returns : sales).push(document);
  });

  const revenue = sales.reduce(
    (sum, document) => sum + Math.abs(document.revenue),
    0,
  );
  const returnsAmount = returns.reduce(
    (sum, document) => sum + Math.abs(document.revenue),
    0,
  );
  const discounts = sales.reduce(
    (sum, document) =>
      sum +
      Math.max(
        Math.abs(document.revenueBeforeDiscount) -
          Math.abs(document.revenue),
        0,
      ),
    0,
  );
  const grossRevenue = revenue + discounts;

  return {
    totalChecks: sales.length + returns.length,
    checks: sales.length,
    revenue,
    netRevenue: revenue - returnsAmount,
    averageCheck: sales.length ? revenue / sales.length : 0,
    returns: returns.length,
    returnsAmount,
    grossRevenue,
    discounts,
    discountShare: grossRevenue > 0 ? (discounts / grossRevenue) * 100 : 0,
    certificatePayments: 0,
    certificatesUsed: 0,
  };
}
