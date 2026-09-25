import { onecGet } from "../onec.mjs";
import {
  filterByPeriod,
  parseOnecDateTime,
  resolveActivityAnchor,
  startOfOnecDay,
  toOdataDateTime,
} from "./utils.mjs";
import {
  loadSalesDocuments,
  summarizeSalesDocuments,
} from "./sales-register.mjs";

const DAY_MS = 86_400_000;
const CHECK_ENTITY = "Document_ЧекККМ";
const CASH_SHIFT_ENTITY = "Document_КассоваяСмена";
const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHECK_SELECT = [
  "Ref_Key",
  "Number",
  "Date",
  "DeletionMark",
  "Posted",
  "ОтчетОРозничныхПродажах_Key",
  "СтатусЧекаККМ",
  "ВидОперации",
  "СуммаДокумента",
  "Товары",
  "Оплата",
  "ПогашениеПодарочныхСертификатов",
].join(",");
const CHECK_HEADER_SELECT = [
  "Ref_Key",
  "Number",
  "Date",
  "DeletionMark",
  "Posted",
  "ОтчетОРозничныхПродажах_Key",
  "СтатусЧекаККМ",
  "ВидОперации",
  "СуммаДокумента",
].join(",");

export function isCompletedCheck(check) {
  const status = String(check?.СтатусЧекаККМ || "").toLocaleLowerCase(
    "ru-RU",
  );

  if (check?.DeletionMark || status.includes("аннулирован")) return false;
  if (status.includes("отложен")) return false;

  return true;
}

export function checkReportFilter(reportKey) {
  if (!GUID_PATTERN.test(reportKey)) {
    throw new Error(
      "Некорректный ключ отчёта о розничных продажах",
    );
  }

  return `ОтчетОРозничныхПродажах_Key eq guid'${reportKey}'`;
}

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
    totalChecks: sales.length + returns.length,
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

export function summarizeCashShifts(shifts) {
  return shifts
    .filter((shift) => shift.Posted && !shift.DeletionMark)
    .reduce(
      (summary, shift) => ({
        checks: summary.checks + Number(shift.КоличествоЧеков || 0),
        latestDate:
          parseOnecDateTime(shift.Date) > summary.latestTimestamp
            ? shift.Date
            : summary.latestDate,
        latestTimestamp: Math.max(
          summary.latestTimestamp,
          parseOnecDateTime(shift.Date),
        ),
      }),
      {
        checks: 0,
        latestDate: null,
        latestTimestamp: Number.NEGATIVE_INFINITY,
      },
    );
}

async function loadCashShiftsForRange(startDate, endDate, limit) {
  const pageSize = Math.min(
    Math.max(Number(process.env.ONEC_PAGE_SIZE || 25), 1),
    100,
  );
  const filter = [
    "Posted eq true",
    `Date ge datetime'${toOdataDateTime(startDate.getTime())}'`,
    `Date lt datetime'${toOdataDateTime(endDate.getTime())}'`,
  ].join(" and ");
  const shifts = [];

  while (shifts.length < limit) {
    const currentPageSize = Math.min(pageSize, limit - shifts.length);
    const page = await onecGet(CASH_SHIFT_ENTITY, {
      $top: currentPageSize,
      $skip: shifts.length,
      $select: "Ref_Key,Date,DeletionMark,Posted,КоличествоЧеков",
      $filter: filter,
      $orderby: "Date desc",
    });
    shifts.push(...page);
    if (page.length < currentPageSize) break;
  }

  return {
    ...summarizeCashShifts(shifts),
    truncated: shifts.length >= limit,
  };
}

export function summarizeRetailReports(reports, checks) {
  const netRevenue = reports.reduce(
    (sum, report) => sum + Number(report.СуммаДокумента || 0),
    0,
  );
  const returnsAmount = reports.reduce(
    (sum, report) => sum + Number(report.СуммаВозвратов || 0),
    0,
  );
  const revenue = netRevenue + returnsAmount;
  const grossRevenue = reports.reduce(
    (sum, report) =>
      sum +
      (report.Товары || []).reduce(
        (lineSum, line) =>
          lineSum +
          Number(line.Цена || 0) * Number(line.Количество || 0),
        0,
      ),
    0,
  );
  const discounts = Math.max(grossRevenue - netRevenue, 0);

  return {
    totalChecks: checks,
    checks,
    revenue,
    netRevenue,
    averageCheck: checks ? revenue / checks : 0,
    returns: 0,
    returnsAmount,
    grossRevenue: Math.max(grossRevenue, revenue),
    discounts,
    discountShare: grossRevenue > 0
      ? (discounts / grossRevenue) * 100
      : 0,
    certificatePayments: 0,
    certificatesUsed: 0,
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
          : new Date(`${toOdataDateTime(start).slice(0, 10)}T00:00:00Z`).toLocaleDateString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              timeZone: "UTC",
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
  includePrevious = true,
) {
  const latestDayStart = startOfOnecDay(latestTimestamp);
  const currentFrom = latestDayStart - (days - 1) * DAY_MS;
  const currentTo = latestDayStart + DAY_MS - 1;
  const previousTo = currentFrom - 1;
  const previousFrom = currentFrom - days * DAY_MS;
  const current = checks.filter((check) =>
    parseOnecDateTime(check.Date) >= currentFrom &&
    parseOnecDateTime(check.Date) <= currentTo,
  );
  const previous = includePrevious
    ? checks.filter((check) =>
        parseOnecDateTime(check.Date) >= previousFrom &&
        parseOnecDateTime(check.Date) <= previousTo,
      )
    : [];

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
          /сертификат/i.test(
            `${item.Description || ""} ${item.ТипОплаты || ""}`,
          ),
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

async function loadChecks({ days, limit, includePrevious = true }) {
  const latestChecks = await onecGet(CHECK_ENTITY, {
    $top: 100,
    $select: "Date,DeletionMark,Posted,СтатусЧекаККМ",
    $orderby: "Date desc",
  });
  const latest = latestChecks.filter(isCompletedCheck);

  if (!latest.length) {
    return { checks: [], activity: null, truncated: false };
  }

  const activity = resolveActivityAnchor(latest, "Date");
  const latestTimestamp = activity.anchorDate.getTime();
  const loadedDays = includePrevious ? days * 2 : days;
  const fromTimestamp = latestTimestamp - loadedDays * DAY_MS;
  const pageSize = Math.min(
    Math.max(Number(process.env.ONEC_CHECK_PAGE_SIZE || 100), 1),
    100,
  );
  const dateFilter = `Date ge datetime'${toOdataDateTime(fromTimestamp)}'`;

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
      "1С не приняла период аналитики чеков, " +
        "используем локальный фильтр:",
      error instanceof Error ? error.message : error,
    );
    loaded = await load("");
  }

  return {
    checks: filterByPeriod(
      loaded.filter(isCompletedCheck),
      "Date",
      startDate,
      endDate,
    ),
    activity,
    truncated: loaded.length >= limit,
  };
}

async function scanCheckHeaders({
  reportRecords,
  currentFrom,
  currentTo,
  limit,
}) {
  const reportKeys = new Set(
    reportRecords.map((report) => report.Ref_Key).filter(Boolean),
  );
  const reportDates = new Map(
    reportRecords
      .filter((report) => report.Ref_Key && report.Date)
      .map((report) => [report.Ref_Key, report.Date]),
  );
  const pageSize = Math.min(
    Math.max(Number(process.env.ONEC_CHECK_SCAN_PAGE_SIZE || 100), 1),
    1_000,
  );
  const scanLimit = Math.max(
    Number(process.env.ONEC_CHECK_SCAN_LIMIT || 100_000),
    limit,
  );
  const matched = new Map();
  let scanned = 0;
  let reachedPastRange = false;

  while (scanned < scanLimit && matched.size < limit) {
    const page = await onecGet(CHECK_ENTITY, {
      $top: Math.min(pageSize, scanLimit - scanned),
      $skip: scanned,
      $select: CHECK_HEADER_SELECT,
      $orderby: "Date desc",
    });
    if (!page.length) break;

    page.forEach((check) => {
      const timestamp = parseOnecDateTime(check.Date);
      if (timestamp < currentFrom && !reportKeys.size) reachedPastRange = true;
      const matchesDate =
        timestamp >= currentFrom && timestamp <= currentTo;
      const matchesReport = reportKeys.has(
        check.ОтчетОРозничныхПродажах_Key,
      );

      if ((matchesDate || matchesReport) && isCompletedCheck(check)) {
        matched.set(check.Ref_Key, {
          ...check,
          Date: matchesReport
            ? reportDates.get(check.ОтчетОРозничныхПродажах_Key) ||
              check.Date
            : check.Date,
        });
      }
    });
    scanned += page.length;
    if (page.length < pageSize || reachedPastRange) break;
  }

  return {
    checks: [...matched.values()],
    scanned,
    truncated: scanned >= scanLimit,
  };
}

async function computeCheckAnalyticsRange({
  from,
  to,
  limit,
  includePrevious = true,
  reportRecords = [],
}) {
  const currentFrom = parseOnecDateTime(`${from}T00:00:00`);
  const currentTo = parseOnecDateTime(`${to}T00:00:00`) + 86_400_000 - 1;

  if (
    !Number.isFinite(currentFrom) ||
    !Number.isFinite(currentTo) ||
    currentFrom > currentTo
  ) {
    throw new Error("Некорректный диапазон дат чеков");
  }

  const duration = currentTo - currentFrom + 1;
  const previousTo = currentFrom - 1;
  const previousFrom = previousTo - duration + 1;
  const hasRetailReports = reportRecords.length > 0;
  let loadError = null;
  let loaded = {
    checks: [],
    truncated: false,
    matchedReports: 0,
    failedReports: 0,
    scanned: 0,
  };
  let registerSummary = null;
  let registerTruncated = false;
  let cashShiftSummary = null;
  try {
    loaded = {
      ...loaded,
      ...(await scanCheckHeaders({
        reportRecords,
        currentFrom,
        currentTo,
        limit,
      })),
    };
  } catch (error) {
    loadError = error;
    console.warn(
      "Не удалось загрузить документы чеков:",
      error instanceof Error ? error.message : error,
    );
  }

  // Reading the sales register and cash shifts is expensive on this 1C
  // installation. Only use them when check documents are unavailable.
  const needsFallback = loaded.checks.length === 0;
  const registerPromise = needsFallback
    ? loadSalesDocuments({
        startDate: new Date(currentFrom),
        endDate: new Date(currentTo + 1),
        limit,
      }).then(
        (result) => ({ result, error: null }),
        (error) => ({ result: null, error }),
      )
    : Promise.resolve({ result: null, error: null });
  const cashShiftPromise = needsFallback
    ? loadCashShiftsForRange(
        new Date(currentFrom),
        new Date(currentTo + 1),
        limit,
      ).then(
        (result) => ({ result, error: null }),
        (error) => ({ result: null, error }),
      )
    : Promise.resolve({ result: null, error: null });

  const registerLoad = await registerPromise;
  if (registerLoad.result) {
    registerSummary = summarizeSalesDocuments(registerLoad.result.rows);
    registerTruncated = registerLoad.result.truncated;
  } else if (registerLoad.error) {
    loadError ||= registerLoad.error;
    console.warn(
      "Не удалось восстановить чеки из регистра продаж:",
      registerLoad.error instanceof Error
        ? registerLoad.error.message
        : registerLoad.error,
    );
  }

  const cashShiftLoad = await cashShiftPromise;
  if (cashShiftLoad.result) {
    cashShiftSummary = cashShiftLoad.result;
  } else if (cashShiftLoad.error) {
    loadError ||= cashShiftLoad.error;
    console.warn(
      "Не удалось восстановить количество чеков из кассовых смен:",
      cashShiftLoad.error instanceof Error
        ? cashShiftLoad.error.message
        : cashShiftLoad.error,
    );
  }

  if (!loaded.checks.length && !registerLoad.result && !cashShiftLoad.result) {
    throw loadError || new Error("Не удалось получить чеки из 1С");
  }

  const current = loaded.checks.filter((check) => {
    const timestamp = parseOnecDateTime(check.Date);
    return timestamp >= currentFrom && timestamp <= currentTo;
  });
  const previous = includePrevious
    ? loaded.checks.filter((check) => {
        const timestamp = parseOnecDateTime(check.Date);
        return timestamp >= previousFrom && timestamp <= previousTo;
      })
    : [];
  const days = Math.max(Math.round(duration / DAY_MS), 1);

  // The header query does not contain payment rows; skip the extra catalog call.
  const documentSummary = summarizeChecks(current);
  const reportSummary = hasRetailReports
    ? summarizeRetailReports(reportRecords, documentSummary.checks)
    : null;
  const usedRegisterFallback =
    documentSummary.totalChecks === 0 &&
    Boolean(registerSummary?.totalChecks);
  const usedCashShiftFallback =
    !usedRegisterFallback && Number(cashShiftSummary?.checks) > 0;
  const documentDetailsAvailable = false;
  const seriesAvailable = documentSummary.totalChecks > 0 && !loaded.truncated;
  const currentSummary = documentSummary.totalChecks > 0
    ? {
        ...documentSummary,
        ...(reportSummary
          ? {
              revenue: reportSummary.revenue,
              netRevenue: reportSummary.netRevenue,
              returnsAmount: reportSummary.returnsAmount,
              averageCheck: documentSummary.checks
                ? reportSummary.revenue / documentSummary.checks
                : 0,
              grossRevenue: reportSummary.grossRevenue,
              discounts: reportSummary.discounts,
              discountShare: reportSummary.discountShare,
            }
          : {}),
      }
    : usedRegisterFallback
    ? {
        ...registerSummary,
        certificatePayments: documentDetailsAvailable
          ? documentSummary.certificatePayments
          : 0,
        certificatesUsed: documentDetailsAvailable
          ? documentSummary.certificatesUsed
          : 0,
      }
    : usedCashShiftFallback
      ? summarizeRetailReports(reportRecords, cashShiftSummary.checks)
      : documentSummary;
  const latestCheckTimestamp = current.length
    ? Math.max(
        ...current.map((check) => parseOnecDateTime(check.Date)),
      )
    : null;

  return {
    current: currentSummary,
    previous: summarizeChecks(previous),
    series: seriesAvailable
      ? buildBuckets(current, currentFrom, currentTo + 1, days)
      : [],
    periodStart: new Date(currentFrom).toISOString(),
    periodEnd: new Date(currentTo).toISOString(),
    latestDate: latestCheckTimestamp
      ? new Date(latestCheckTimestamp).toISOString()
      : null,
    loaded: usedRegisterFallback || usedCashShiftFallback
      ? currentSummary.totalChecks
      : loaded.checks.length,
    truncated:
      loaded.truncated ||
      registerTruncated ||
      Boolean(cashShiftSummary?.truncated),
    dataAvailable:
      Boolean(loaded.checks.length) ||
      Boolean(registerLoad.result) ||
      Boolean(cashShiftLoad.result) ||
      current.length > 0 ||
      usedRegisterFallback ||
      usedCashShiftFallback,
    seriesAvailable,
    documentDetailsAvailable,
    requestedReports: reportRecords.length,
    matchedReports: loaded.matchedReports,
    failedReports: loaded.failedReports,
    documentTypes: registerSummary?.documentTypes || [],
    scannedChecks: loaded.scanned,
    source: usedRegisterFallback
      ? documentDetailsAvailable
        ? "AccumulationRegister_Продажи + Document_ЧекККМ"
        : "AccumulationRegister_Продажи.ДокументПродажи"
      : usedCashShiftFallback
        ? "Document_КассоваяСмена + Document_ОтчетОРозничныхПродажах"
      : hasRetailReports
        ? "Document_ЧекККМ.ОтчетОРозничныхПродажах_Key"
        : "Document_ЧекККМ",
    unavailableReason: loadError instanceof Error
      ? loadError.message
      : hasRetailReports && current.length === 0 && !usedRegisterFallback
        ? "Связанные документы ЧекККМ " +
          "не опубликованы в OData"
        : null,
  };
}

export async function loadCheckAnalyticsRange({
  from,
  to,
  limit,
  includePrevious = true,
  reportRecords = [],
}) {
  const reportSignature = reportRecords
    .map((report) => report.Ref_Key)
    .filter(Boolean)
    .sort()
    .join(",");
  const key = [
    "range",
    from,
    to,
    limit,
    includePrevious,
    reportSignature,
  ].join(":");
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
  const promise = computeCheckAnalyticsRange({
    from,
    to,
    limit,
    includePrevious,
    reportRecords,
  });
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

export async function loadCheckAnalytics({
  days,
  limit,
  includePrevious = true,
}) {
  const key = `${days}:${limit}:${includePrevious}`;
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
      loadChecks({ days, limit, includePrevious }),
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
        includePrevious,
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
