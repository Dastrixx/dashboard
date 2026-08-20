import {
  BUSINESS_CATEGORIES,
  EMPTY_GUID,
  GUID_PATTERN,
} from "./constants.mjs";

export function toOdataDateTime(timestamp) {
  return new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, "");
}

export function filterByPeriod(items, field, startDate, endDate) {
  const startTimestamp = new Date(startDate).getTime();
  const endTimestamp = new Date(endDate).getTime();

  return items.filter((item) => {
    const timestamp = new Date(item?.[field]).getTime();
    return (
      Number.isFinite(timestamp) &&
      timestamp >= startTimestamp &&
      timestamp <= endTimestamp
    );
  });
}

export function resolveActivityAnchor(items, field) {
  const timestamps = items
    .map((item) => new Date(item?.[field]).getTime())
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
