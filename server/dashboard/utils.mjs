import {
  BUSINESS_CATEGORIES,
  EMPTY_GUID,
  GUID_PATTERN,
} from "./constants.mjs";

export function toOdataDateTime(timestamp) {
  const offsetMinutes = onecTimezoneOffsetMinutes();
  return new Date(Number(timestamp) + offsetMinutes * 60_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "");
}

export function parseOnecDateTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;

  const text = String(value || "").trim();
  if (!text) return Number.NaN;
  if (/Z$|[+-]\d{2}:?\d{2}$/i.test(text)) return Date.parse(text);

  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/,
  );
  if (!match) return Date.parse(text);

  const [, year, month, day, hour, minute, second, milliseconds = "0"] = match;
  const localAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(milliseconds.padEnd(3, "0")),
  );
  return localAsUtc - onecTimezoneOffsetMinutes() * 60_000;
}

export function normalizeOnecDateTime(value) {
  const timestamp = parseOnecDateTime(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
}

export function describeDataFreshness(value, now = Date.now()) {
  const timestamp = parseOnecDateTime(value);
  if (!Number.isFinite(timestamp)) {
    return { status: "unknown", ageHours: null, maxAgeHours: null };
  }

  const maxAgeHours = Math.max(
    Number(process.env.ONEC_FRESHNESS_MAX_HOURS || 36),
    1,
  );
  const ageHours = (now - timestamp) / 3_600_000;
  const status = ageHours < -0.25
    ? "future"
    : ageHours <= maxAgeHours
      ? "fresh"
      : "stale";

  return {
    status,
    ageHours: Number(ageHours.toFixed(1)),
    maxAgeHours,
  };
}

export function filterByPeriod(items, field, startDate, endDate) {
  const startTimestamp = parseOnecDateTime(startDate);
  const endTimestamp = parseOnecDateTime(endDate);

  return items.filter((item) => {
    const timestamp = parseOnecDateTime(item?.[field]);
    return (
      Number.isFinite(timestamp) &&
      timestamp >= startTimestamp &&
      timestamp <= endTimestamp
    );
  });
}

export function resolveActivityAnchor(items, field) {
  const timestamps = items
    .map((item) => parseOnecDateTime(item?.[field]))
    .filter(Number.isFinite)
    .sort((left, right) => right - left);
  const absoluteLatestTimestamp = timestamps[0] || null;
  const isolationGapMs =
    Math.max(Number(process.env.ONEC_ACTIVITY_GAP_DAYS || 45), 1) *
    86_400_000;
  const maxIsolatedDocuments = Math.max(
    Number(process.env.ONEC_MAX_ISOLATED_DOCUMENTS || 3),
    1,
  );
  let anchorTimestamp = absoluteLatestTimestamp;
  let ignoredDocuments = 0;

  if (process.env.ONEC_IGNORE_ISOLATED_DOCUMENTS !== "true") {
    return {
      anchorDate: anchorTimestamp ? new Date(anchorTimestamp) : null,
      absoluteLatestDate: absoluteLatestTimestamp
        ? new Date(absoluteLatestTimestamp)
        : null,
      adjusted: false,
      ignoredDocuments: 0,
    };
  }

  for (
    let index = 0;
    index < Math.min(timestamps.length - 1, maxIsolatedDocuments);
    index += 1
  ) {
    if (timestamps[index] - timestamps[index + 1] > isolationGapMs) {
      anchorTimestamp = timestamps[index + 1];
      ignoredDocuments = index + 1;
      break;
    }
  }

  return {
    anchorDate: anchorTimestamp ? new Date(anchorTimestamp) : null,
    absoluteLatestDate: absoluteLatestTimestamp
      ? new Date(absoluteLatestTimestamp)
      : null,
    adjusted: Boolean(
      anchorTimestamp && absoluteLatestTimestamp !== anchorTimestamp,
    ),
    ignoredDocuments,
  };
}

function onecTimezoneOffsetMinutes() {
  const value = Number(process.env.ONEC_TIMEZONE_OFFSET_MINUTES || 360);
  return Number.isFinite(value) ? value : 360;
}

export function normalizeReferenceName(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/\s+/g, " ");
}

export function resolveBusinessCategory(kindName) {
  const normalizedName = normalizeReferenceName(kindName);

  return (
    BUSINESS_CATEGORIES.find((category) =>
      category.aliases.some((alias) => normalizedName === alias),
    ) || null
  );
}

export function enrichProductsWithBusinessCategories(products, productKinds) {
  const kindByKey = new Map(productKinds.map((kind) => [kind.Ref_Key, kind]));

  return products.map((product) => {
    const kind = kindByKey.get(product.ВидНоменклатуры_Key);
    const category = resolveBusinessCategory(kind?.Description);

    return {
      ...product,
      ВидНоменклатуры: kind?.Description || null,
      BusinessCategory_Key: category?.Ref_Key || null,
      BusinessCategory: category?.Description || null,
    };
  });
}

export function publicBusinessCategories() {
  return BUSINESS_CATEGORIES.map(({ Ref_Key, Description }) => ({
    Ref_Key,
    Description,
  }));
}

export function summarizeProductReference(products, field, references = []) {
  const referenceByKey = new Map(
    references.map((reference) => [reference.Ref_Key, reference]),
  );
  const summaryByKey = new Map();

  for (const product of products) {
    const key = product[field];

    if (!GUID_PATTERN.test(key || "") || key === EMPTY_GUID) continue;

    const current = summaryByKey.get(key) || {
      key,
      name: referenceByKey.get(key)?.Description || null,
      productsCount: 0,
      productExamples: [],
    };

    current.productsCount += 1;
    if (current.productExamples.length < 5) {
      current.productExamples.push({
        key: product.Ref_Key,
        code: product.Code,
        article: product.Артикул,
        name: product.Description,
      });
    }
    summaryByKey.set(key, current);
  }

  return [...summaryByKey.values()].sort(
    (left, right) => right.productsCount - left.productsCount,
  );
}
