import { onecGet } from "../onec.mjs";
import {
  filterByPeriod,
  parseOnecDateTime,
  resolveActivityAnchor,
  toOdataDateTime,
} from "./utils.mjs";

const DAY_MS = 86_400_000;
const CHECK_ENTITY = "Document_ЧекККМ";
const CHECK_SELECT = [
  "Ref_Key",
  "Number",
  "Date",
  "Posted",
  "ВидОперации",
  "СуммаДокумента",
  "Товары",
  "Оплата",
  "ПогашениеПодарочныхСертификатов",
].join(",");

const checkAnalyticsCache = new Map();
let paymentKindsCache = null;

function isReturnCheck(check) {
  return /возврат/i.test(String(check?.ВидОперации || ""));
}

function checkDiscount(check) {
  return (check.Товары || []).reduce(
    (sum, line) =>
      sum +
      Number(line.СуммаАвтоматическойСкидки || 0) +
      Number(line.СуммаРучнойСкидки || 0) +
      Number(line.СуммаСкидкиОплатыБонусом || 0),
    0,
  );
}

function checkCertificatePayment(check, certificatePaymentKeys) {
  return (check.Оплата || []).reduce(
    (sum, payment) =>
      certificatePaymentKeys.has(payment.ВидОплаты_Key)
        ? sum + Number(payment.Сумма || 0)
        : sum,
    0,
  );
}

function summarizeChecks(checks, certificatePaymentKeys = new Set()) {
  const sales = checks.filter((check) => !isReturnCheck(check));
  const returns = checks.filter(isReturnCheck);
  const revenue = sales.reduce(
    (sum, check) => sum + Number(check.СуммаДокумента || 0),
    0,
  );
  const returnsAmount = returns.reduce(
    (sum, check) => sum + Math.abs(Number(check.СуммаДокумента || 0)),
    0,
  );
  const discounts = sales.reduce(
    (sum, check) => sum + checkDiscount(check),
    0,
  );
  const certificatePayments = sales.reduce(
    (sum, check) =>
      sum + checkCertificatePayment(check, certificatePaymentKeys),
    0,
  );
  const certificatesUsed = sales.reduce(
    (sum, check) =>
      sum +
      (check.ПогашениеПодарочныхСертификатов || []).reduce(
        (certificateSum, row) =>
          certificateSum + Number(row.Количество || 1),
        0,
      ),
    0,
  );

  return {
    checks: sales.length,
    revenue,
    netRevenue: revenue - returnsAmount,
    averageCheck: sales.length ? revenue / sales.length : 0,
    returns: returns.length,
    returnsAmount,
    grossRevenue: revenue + discounts,
    discounts,
    discountShare: revenue + discounts > 0
      ? (discounts / (revenue + discounts)) * 100
      : 0,
    certificatePayments,
    certificatesUsed,
  };
}

function buildBuckets(checks, rangeStart, rangeEnd, days) {
  const bucketCount = days === 1 ? 6 : days === 7 ? 7 : 30;
  const bucketSize = (rangeEnd - rangeStart) / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const start = rangeStart + index * bucketSize;

    return {
      label:
        days === 1
          ? `${index * 4}–${(index + 1) * 4}ч`
          : new Date(start).toLocaleDateString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
            }),
      checks: 0,
      revenue: 0,
      averageCheck: 0,
    };
  });

  for (const check of checks) {
    if (isReturnCheck(check)) continue;

    const timestamp = parseOnecDateTime(check.Date);
    const index = Math.min(
      Math.max(Math.floor((timestamp - rangeStart) / bucketSize), 0),
      buckets.length - 1,
    );
    buckets[index].checks += 1;
    buckets[index].revenue += Number(check.СуммаДокумента || 0);
  }

  return buckets.map((bucket) => ({
    ...bucket,
    averageCheck: bucket.checks ? bucket.revenue / bucket.checks : 0,
  }));
}

export function buildCheckAnalytics(
  checks,
  latestTimestamp,
  days,
  certificatePaymentKeys = new Set(),
) {
  const latestDate = new Date(latestTimestamp);
  latestDate.setHours(0, 0, 0, 0);
  const currentFrom = latestDate.getTime() - (days - 1) * DAY_MS;
  const currentTo = latestDate.getTime() + DAY_MS - 1;
  const previousTo = currentFrom - 1;
  const previousFrom = currentFrom - days * DAY_MS;
  const current = checks.filter((check) =>
    parseOnecDateTime(check.Date) >= currentFrom &&
    parseOnecDateTime(check.Date) <= currentTo,
  );
  const previous = checks.filter((check) =>
    parseOnecDateTime(check.Date) >= previousFrom &&
    parseOnecDateTime(check.Date) <= previousTo,
  );

  return {
    current: summarizeChecks(current, certificatePaymentKeys),
    previous: summarizeChecks(previous, certificatePaymentKeys),
    series: buildBuckets(current, currentFrom, currentTo + 1, days),
    periodStart: new Date(currentFrom).toISOString(),
    periodEnd: new Date(currentTo).toISOString(),
  };
}

async function loadCertificatePaymentKeys() {
  const now = Date.now();

  if (paymentKindsCache?.expiresAt > now) {
    return paymentKindsCache.keys;
  }

  try {
    const paymentKinds = await onecGet("Catalog_ВидыОплатЧекаККМ", {
      $top: 100,
      $select: "Ref_Key,Description,ТипОплаты",
      $orderby: "Description",
    });
    const keys = new Set(
      paymentKinds
        .filter((item) =>
          /сертификат/i.test(`${item.Description || ""} ${item.ТипОплаты || ""}`),
        )
        .map((item) => item.Ref_Key),
    );
    paymentKindsCache = { keys, expiresAt: now + 600_000 };
    return keys;
  } catch (error) {
    console.warn(
      "Не удалось определить виды оплаты сертификатами:",
      error instanceof Error ? error.message : error,
    );
    return new Set();
  }
}

async function loadChecks({ days, limit }) {
  const latest = await onecGet(CHECK_ENTITY, {
    $top: 20,
    $select: "Date",
    $filter: "Posted eq true",
    $orderby: "Date desc",
  });

  if (!latest.length) {
    return { checks: [], activity: null, truncated: false };
  }

  const activity = resolveActivityAnchor(latest, "Date");
  const latestTimestamp = activity.anchorDate.getTime();
  const fromTimestamp = latestTimestamp - days * 2 * DAY_MS;
  const pageSize = Math.min(
    Math.max(Number(process.env.ONEC_CHECK_PAGE_SIZE || 100), 1),
    100,
  );
  const dateFilter = [
    "Posted eq true",
    `Date ge datetime'${toOdataDateTime(fromTimestamp)}'`,
  ].join(" and ");

  async function load(filter) {
    const result = [];

    while (result.length < limit) {
      const currentPageSize = Math.min(pageSize, limit - result.length);
      const page = await onecGet(CHECK_ENTITY, {
        $top: currentPageSize,
        $skip: result.length,
        $select: CHECK_SELECT,
        $filter: filter,
        $orderby: "Date desc",
      });
      result.push(...page);
      if (page.length < currentPageSize) break;
    }

    return result;
  }

  const startDate = new Date(fromTimestamp);
  const endDate = new Date(latestTimestamp + 1000);
  let loaded;

  try {
    loaded = await load(dateFilter);
  } catch (error) {
    console.warn(
      "1С не приняла период аналитики чеков, используем локальный фильтр:",
      error instanceof Error ? error.message : error,
    );
    loaded = await load("Posted eq true");
  }

  return {
    checks: filterByPeriod(loaded, "Date", startDate, endDate),
    activity,
    truncated: loaded.length >= limit,
  };
}

async function loadChecksByRange({ fromTimestamp, toTimestamp, limit }) {
  const pageSize = Math.min(
    Math.max(Number(process.env.ONEC_CHECK_PAGE_SIZE || 100), 1),
    100,
  );
  const filter = [
    "Posted eq true",
    `Date ge datetime'${toOdataDateTime(fromTimestamp)}'`,
    `Date le datetime'${toOdataDateTime(toTimestamp)}'`,
  ].join(" and ");
  const result = [];

  while (result.length < limit) {
    const currentPageSize = Math.min(pageSize, limit - result.length);
    const page = await onecGet(CHECK_ENTITY, {
      $top: currentPageSize,
      $skip: result.length,
      $select: CHECK_SELECT,
      $filter: filter,
      $orderby: "Date desc",
    });
    result.push(...page);
    if (page.length < currentPageSize) break;
  }

  return { checks: result, truncated: result.length >= limit };
}

export async function loadCheckAnalyticsRange({ from, to, limit }) {
  const currentFrom = parseOnecDateTime(`${from}T00:00:00`);
  const currentTo = parseOnecDateTime(`${to}T23:59:59`);

  if (!Number.isFinite(currentFrom) || !Number.isFinite(currentTo) || currentFrom > currentTo) {
    throw new Error("Некорректный диапазон дат чеков");
  }

  const duration = currentTo - currentFrom + 1;
  const previousTo = currentFrom - 1;
  const previousFrom = previousTo - duration + 1;
  const [loaded, certificatePaymentKeys] = await Promise.all([
    loadChecksByRange({ fromTimestamp: previousFrom, toTimestamp: currentTo, limit }),
    loadCertificatePaymentKeys(),
  ]);

  const current = loaded.checks.filter((check) => {
    const timestamp = parseOnecDateTime(check.Date);
    return timestamp >= currentFrom && timestamp <= currentTo;
  });
  const previous = loaded.checks.filter((check) => {
    const timestamp = parseOnecDateTime(check.Date);
    return timestamp >= previousFrom && timestamp <= previousTo;
  });
  const days = Math.max(Math.round(duration / DAY_MS), 1);

  return {
    current: summarizeChecks(current, certificatePaymentKeys),
    previous: summarizeChecks(previous, certificatePaymentKeys),
    series: buildBuckets(current, currentFrom, currentTo + 1, days),
    periodStart: new Date(currentFrom).toISOString(),
    periodEnd: new Date(currentTo).toISOString(),
    latestDate: current.length
      ? new Date(Math.max(...current.map((check) => parseOnecDateTime(check.Date)))).toISOString()
      : null,
    loaded: loaded.checks.length,
    truncated: loaded.truncated,
    cache: "range",
  };
}

export async function loadCheckAnalytics({ days, limit }) {
  const key = `${days}:${limit}`;
  const now = Date.now();
  const cached = checkAnalyticsCache.get(key);

  if (cached?.value && cached.expiresAt > now) {
    return { ...cached.value, cache: "hit" };
  }
  if (cached?.promise) {
    return { ...(await cached.promise), cache: "shared" };
  }

  const ttlMs = Math.max(
    Number(process.env.ONEC_REPORT_CACHE_TTL_MS || 30_000),
    5_000,
  );
  const promise = (async () => {
    const [loaded, certificatePaymentKeys] = await Promise.all([
      loadChecks({ days, limit }),
      loadCertificatePaymentKeys(),
    ]);

    if (!loaded.activity) {
      return {
        current: summarizeChecks([], certificatePaymentKeys),
        previous: summarizeChecks([], certificatePaymentKeys),
        series: [],
        periodStart: null,
        periodEnd: null,
        latestDate: null,
        loaded: 0,
        truncated: false,
      };
    }

    return {
      ...buildCheckAnalytics(
        loaded.checks,
        loaded.activity.anchorDate.getTime(),
        days,
        certificatePaymentKeys,
      ),
      latestDate: loaded.activity.anchorDate.toISOString(),
      absoluteLatestDate:
        loaded.activity.absoluteLatestDate?.toISOString() || null,
      analysisAnchorAdjusted: loaded.activity.adjusted,
      ignoredIsolatedDocuments: loaded.activity.ignoredDocuments,
      loaded: loaded.checks.length,
      truncated: loaded.truncated,
    };
  })();

  checkAnalyticsCache.set(key, { promise, expiresAt: now + ttlMs });

  try {
    const value = await promise;
    checkAnalyticsCache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
    return { ...value, cache: "miss" };
  } catch (error) {
    checkAnalyticsCache.delete(key);
    throw error;
  }
}
