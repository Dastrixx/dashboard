import cors from "cors";
import express from "express";
import { dashboardData } from "./data.mjs";
import {
  onecBalance,
  onecGet,
  onecGetByKey,
  onecMetadata,
  onecTurnovers,
} from "./onec.mjs";

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors({ origin: process.env.CLIENT_URL || true }));
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "3kvadrata-api" });
});

app.get("/api/dashboard", (_request, response) => {
  response.json(dashboardData);
});

app.get("/api/products", (request, response) => {
  const query = String(request.query.search || "")
    .trim()
    .toLowerCase();
  const category = String(request.query.category || "")
    .trim()
    .toLowerCase();

  const result = dashboardData.products.filter((product) => {
    const matchesSearch =
      !query || `${product.sku} ${product.name}`.toLowerCase().includes(query);
    const matchesCategory =
      !category || product.category.toLowerCase() === category;

    return matchesSearch && matchesCategory;
  });

  response.json({ items: result, total: result.length });
});

app.get("/api/sellers", (_request, response) => {
  response.json({ items: dashboardData.sellers });
});

app.post("/api/replenishment-requests", (request, response) => {
  const { items } = request.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return response
      .status(400)
      .json({ message: "Добавьте хотя бы одну позицию" });
  }

  return response.status(201).json({
    id: `REQ-${Date.now()}`,
    status: "draft",
    items,
    createdAt: new Date().toISOString(),
  });
});

app.get("/api/onec/metadata", async (_request, response) => {
  try {
    const metadata = await onecMetadata();
    response.type("application/xml").send(metadata);
  } catch (error) {
    response.status(502).json({
      message: error instanceof Error ? error.message : "Ошибка получения метаданных 1С",
    });
  }
});

const referenceCache = new Map();
const reportCache = new Map();
let productKindsCache = null;

const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";
const BUSINESS_CATEGORIES = [
  {
    Ref_Key: "home-textile",
    Description: "Домашний текстиль",
    aliases: ["домашний текстиль", "плед"],
  },
  {
    Ref_Key: "tableware",
    Description: "Посуда",
    aliases: ["посуда", "посуда китай"],
  },
  {
    Ref_Key: "clothing",
    Description: "Одежда",
    aliases: ["одежда"],
  },
  {
    Ref_Key: "household-chemicals",
    Description: "Бытовая химия",
    aliases: ["детская химия", "мыломойка", "бытовая химия"],
  },
];

const RETAIL_REPORT_ENTITY = "Document_ОтчетОРозничныхПродажах";
const RETAIL_REPORT_SELECT = [
  "Ref_Key",
  "Number",
  "Date",
  "Posted",
  "СуммаДокумента",
  "СуммаВозвратов",
  "Магазин_Key",
  "КассаККМ_Key",
  "Товары",
  "ВозвращенныеТовары",
].join(",");

function toOdataDateTime(timestamp) {
  return new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, "");
}

function filterByPeriod(items, field, startDate, endDate) {
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

function resolveActivityAnchor(items, field) {
  const timestamps = items
    .map((item) => new Date(item?.[field]).getTime())
    .filter(Number.isFinite)
    .sort((left, right) => right - left);
  const absoluteLatestTimestamp = timestamps[0] || null;
  const isolationGapMs = Math.max(
    Number(process.env.ONEC_ACTIVITY_GAP_DAYS || 45),
    1,
  ) * 86_400_000;
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

async function loadReportPages({ limit, days }) {
  const configuredPageSize = Number(process.env.ONEC_PAGE_SIZE || 25);
  const pageSize = Math.min(Math.max(configuredPageSize, 1), 100);

  const latest = await onecGet(RETAIL_REPORT_ENTITY, {
    $top: 20,
    $select: "Date",
    $filter: "Posted eq true",
    $orderby: "Date desc",
  });

  if (!latest.length) {
    return [];
  }

  const activity = resolveActivityAnchor(latest, "Date");
  const latestTimestamp = activity.anchorDate.getTime();
  const fromTimestamp = latestTimestamp - days * 86_400_000;
  const dateFilter = [
    "Posted eq true",
    `Date ge datetime'${toOdataDateTime(fromTimestamp)}'`,
  ].join(" and ");

  async function load(filter) {
    const result = [];

    while (result.length < limit) {
      const currentPageSize = Math.min(pageSize, limit - result.length);
      const page = await onecGet(RETAIL_REPORT_ENTITY, {
        $top: currentPageSize,
        $skip: result.length,
        $select: RETAIL_REPORT_SELECT,
        $filter: filter,
        $orderby: "Date desc",
      });

      result.push(...page);

      if (page.length < currentPageSize) {
        break;
      }
    }

    return result;
  }

  const endDate = new Date(latestTimestamp + 1000);
  const startDate = new Date(fromTimestamp);

  try {
    return filterByPeriod(
      await load(dateFilter),
      "Date",
      startDate,
      endDate,
    );
  } catch (error) {
    console.warn(
      "1С не приняла фильтр по дате, используем постраничную загрузку:",
      error instanceof Error ? error.message : error,
    );
    return filterByPeriod(
      await load("Posted eq true"),
      "Date",
      startDate,
      endDate,
    );
  }
}

async function loadReportPagesCached({ limit, days }) {
  const key = `${limit}:${days}`;
  const now = Date.now();
  const cached = reportCache.get(key);

  if (cached?.items && cached.expiresAt > now) {
    return { items: cached.items, cache: "hit" };
  }

  if (cached?.promise) {
    return { items: await cached.promise, cache: "shared" };
  }

  const ttlMs = Math.max(
    Number(process.env.ONEC_REPORT_CACHE_TTL_MS || 120_000),
    10_000,
  );
  const promise = loadReportPages({ limit, days });
  reportCache.set(key, { promise, expiresAt: now + ttlMs });

  try {
    const items = await promise;
    reportCache.set(key, { items, expiresAt: Date.now() + ttlMs });
    return { items, cache: "miss" };
  } catch (error) {
    reportCache.delete(key);
    throw error;
  }
}

async function loadReferencesByKeys(entity, keys, select) {
  const uniqueKeys = [
    ...new Set(
      keys.filter(
        (key) =>
          typeof key === "string" &&
          GUID_PATTERN.test(key) &&
          key !== "00000000-0000-0000-0000-000000000000",
      ),
    ),
  ];

  const references = [];
  const missingKeys = [];

  for (const key of uniqueKeys) {
    const cacheKey = `${entity}:${key}`;

    if (referenceCache.has(cacheKey)) {
      references.push(referenceCache.get(cacheKey));
    } else {
      missingKeys.push(key);
    }
  }

  for (let index = 0; index < missingKeys.length; index += 5) {
    const chunk = missingKeys.slice(index, index + 5);
    const chunkResults = await Promise.all(
      chunk.map(async (key) => {
        try {
          const item = await onecGetByKey(entity, key, {
            $select: select,
          });
          referenceCache.set(`${entity}:${key}`, item);
          return item;
        } catch (error) {
          console.warn(
            `Не удалось получить ${entity} с ключом ${key}:`,
            error instanceof Error ? error.message : error,
          );
          return null;
        }
      }),
    );

    references.push(...chunkResults.filter(Boolean));
  }

  return references;
}

async function loadReferencesByKeysBatched(entity, keys, select) {
  // Эта конфигурация 1С не разрешает OR-фильтр по Ref_Key и отвечает HTTP 500.
  // Загружаем ссылки через адреса Catalog_*(guid'...') по пять параллельно.
  // loadReferencesByKeys дедуплицирует ключи и использует общий in-memory кэш.
  return loadReferencesByKeys(entity, keys, select);
}

function normalizeReferenceName(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/\s+/g, " ");
}

function resolveBusinessCategory(kindName) {
  const normalizedName = normalizeReferenceName(kindName);

  return (
    BUSINESS_CATEGORIES.find((category) =>
      category.aliases.some((alias) => normalizedName === alias),
    ) || null
  );
}

async function loadProductKindsCatalog() {
  const now = Date.now();

  if (productKindsCache?.items && productKindsCache.expiresAt > now) {
    return productKindsCache.items;
  }

  if (productKindsCache?.promise) {
    return productKindsCache.promise;
  }

  const promise = onecGet("Catalog_ВидыНоменклатуры", {
    $top: 500,
    $select: [
      "Ref_Key",
      "Description",
      "ТоварнаяГруппа_Key",
      "ТоварнаяКатегория_Key",
    ].join(","),
  });
  productKindsCache = { promise, expiresAt: now + 600_000 };

  try {
    const items = await promise;
    productKindsCache = { items, expiresAt: Date.now() + 600_000 };
    return items;
  } catch (error) {
    productKindsCache = null;
    throw error;
  }
}

function enrichProductsWithBusinessCategories(products, productKinds) {
  const kindByKey = new Map(
    productKinds.map((kind) => [kind.Ref_Key, kind]),
  );

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

function publicBusinessCategories() {
  return BUSINESS_CATEGORIES.map(({ Ref_Key, Description }) => ({
    Ref_Key,
    Description,
  }));
}

function summarizeProductReference(products, field, references = []) {
  const referenceByKey = new Map(
    references.map((reference) => [reference.Ref_Key, reference]),
  );
  const summaryByKey = new Map();

  for (const product of products) {
    const key = product[field];

    if (!GUID_PATTERN.test(key || "") || key === EMPTY_GUID) {
      continue;
    }

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

app.get("/api/dashboard/onec-product-categories", async (request, response) => {
  try {
    const top = Math.min(Math.max(Number(request.query.top) || 500, 1), 500);
    const products = await onecGet("Catalog_Номенклатура", {
      $top: top,
      $select: [
        "Ref_Key",
        "Code",
        "Description",
        "Артикул",
        "ВидНоменклатуры_Key",
        "ТоварнаяГруппа_Key",
        "ТоварнаяКатегория_Key",
      ].join(","),
    });

    const [productKinds, productGroups] = await Promise.all([
      // В этой базе запрос Catalog_*(guid'...') может не вернуть запись.
      // Справочник видов номенклатуры небольшой, поэтому надёжнее загрузить
      // его целиком и сопоставить ключи в памяти.
      loadProductKindsCatalog(),
      loadReferencesByKeys(
        "Catalog_ТоварныеГруппы",
        products.map((product) => product.ТоварнаяГруппа_Key),
        "Ref_Key,Code,Description,Parent_Key,IsFolder",
      ),
    ]);

    const kinds = summarizeProductReference(
      products,
      "ВидНоменклатуры_Key",
      productKinds,
    ).map((item) => ({
      ...item,
      businessCategory: resolveBusinessCategory(item.name)?.Description || null,
      businessCategoryKey: resolveBusinessCategory(item.name)?.Ref_Key || null,
    }));
    const groups = summarizeProductReference(
      products,
      "ТоварнаяГруппа_Key",
      productGroups,
    );
    const categoryKeys = summarizeProductReference(
      products,
      "ТоварнаяКатегория_Key",
    );

    response.json({
      items: {
        productKinds: kinds,
        availableProductKinds: productKinds
          .filter(
            (kind) =>
              kind.Ref_Key &&
              kind.Ref_Key !== EMPTY_GUID &&
              kind.Description,
          )
          .map((kind) => ({
            key: kind.Ref_Key,
            name: kind.Description,
            productCategoryKey: kind.ТоварнаяКатегория_Key,
            productGroupKey: kind.ТоварнаяГруппа_Key,
          })),
        productGroups: groups,
        productCategoryKeys: categoryKeys,
      },
      references: { productKinds, productGroups },
      meta: {
        loadedProducts: products.length,
        fields: {
          productKinds: "ВидНоменклатуры_Key",
          productGroups: "ТоварнаяГруппа_Key",
          productCategoryKeys: "ТоварнаяКатегория_Key",
        },
        note:
          "ТоварнаяКатегория_Key есть в карточке номенклатуры, но отдельный справочник товарных категорий не опубликован в standard.odata. Названия можно получить через ВидНоменклатуры, если именно там настроены четыре бизнес-категории.",
      },
    });
  } catch (error) {
    console.error("Ошибка определения категорий товаров 1С:", error);
    response.status(502).json({
      message:
        error instanceof Error
          ? error.message
          : "Не удалось определить категории товаров 1С",
    });
  }
});

app.get("/api/dashboard/onec-consultants", async (request, response) => {
  try {
    response.set("Cache-Control", "no-store");
    const days = [1, 7, 30].includes(Number(request.query.days))
      ? Number(request.query.days)
      : 30;
    const grouped = new Map();
    let salesLines = 0;
    let returnLines = 0;
    let linesWithConsultant = 0;
    let scannedChecks = 0;
    let loadedChecks = 0;
    let checkLines = 0;
    let checkLinesWithConsultant = 0;
    let historicalChecksScanned = 0;
    let historicalChecksWithConsultant = 0;
    let historicalChecksTruncated = false;
    let checksWithResponsible = 0;
    let cashShiftsWithCashier = 0;
    let usedEmployeeFallback = false;
    let reports = [];
    let cache = "not-used";
    let latestDate = null;
    let absoluteLatestDate = null;
    let analysisAnchorAdjusted = false;
    let ignoredIsolatedDocuments = 0;
    let periodStart = null;
    let periodEnd = null;
    let source = "Document_ЧекККМ.Товары.Продавец_Key";

    const addLine = ({
      storeKey,
      line,
      sign,
      documentSellerKey,
      documentEmployeeType = "person",
      origin,
    }) => {
      if (sign > 0) salesLines += 1;
      else returnLines += 1;

      const consultantKey =
        line.Продавец_Key && line.Продавец_Key !== EMPTY_GUID
          ? line.Продавец_Key
          : documentSellerKey;
      if (!consultantKey || consultantKey === EMPTY_GUID) return;
      const employeeType =
        line.Продавец_Key && line.Продавец_Key !== EMPTY_GUID
          ? "person"
          : documentEmployeeType;

      linesWithConsultant += 1;
      if (origin === "check") checkLinesWithConsultant += 1;
      const resolvedStoreKey = storeKey || EMPTY_GUID;
      const key = `${employeeType}:${consultantKey}:${resolvedStoreKey}`;
      const current = grouped.get(key) || {
        Продавец_Key: consultantKey,
        СотрудникТип: employeeType,
        Магазин_Key: resolvedStoreKey,
        КоличествоTurnover: 0,
        СтоимостьTurnover: 0,
        СтоимостьБезСкидокTurnover: 0,
        СтрокПродаж: 0,
        СтрокВозвратов: 0,
      };
      const quantity = Number(line.Количество || 0);
      const amount = Number(line.Сумма || 0);
      const fullPrice = Number(line.Цена || 0) * quantity;

      current.КоличествоTurnover += sign * quantity;
      current.СтоимостьTurnover += sign * amount;
      current.СтоимостьБезСкидокTurnover += sign * Math.max(fullPrice, amount);
      if (sign > 0) current.СтрокПродаж += 1;
      else current.СтрокВозвратов += 1;
      grouped.set(key, current);
    };

    // Это тот же запрос, на котором консультанты уже находились в рабочем
    // коммите Add consultant sales analytics from 1C. Для этой базы не
    // используем $skip: табличная часть Товары с ним возвращается нестабильно.
    // Период пока намеренно не передаём и не фильтруем локально.
    {
      const checks = await onecGet("Document_ЧекККМ", {
        $top: 1000,
        $select: [
          "Ref_Key",
          "Date",
          "Posted",
          "ВидОперации",
          "КассаККМ_Key",
          "НомерСменыККМ",
          "Магазин_Key",
          "Ответственный_Key",
          "Продавец_Key",
          "Товары",
        ].join(","),
        $filter: "Posted eq true",
        $orderby: "Date desc",
      });
      const checksWithConsultant = checks.filter((check) => {
        if (check.Продавец_Key && check.Продавец_Key !== EMPTY_GUID) {
          return true;
        }
        return (check.Товары || []).some(
          (line) =>
            line.Продавец_Key && line.Продавец_Key !== EMPTY_GUID,
        );
      });
      historicalChecksScanned = checks.length;
      historicalChecksWithConsultant = checksWithConsultant.length;
      historicalChecksTruncated = checks.length >= 1000;
      loadedChecks = checks.length;
      scannedChecks = checks.length;
      source = "Document_ЧекККМ.Товары.Продавец_Key · без периода";

      const timestamps = checks
        .map((check) => new Date(check.Date).getTime())
        .filter(Number.isFinite)
        .sort((left, right) => left - right);
      periodStart = timestamps.length
        ? new Date(timestamps[0]).toISOString()
        : null;
      periodEnd = timestamps.length
        ? new Date(timestamps[timestamps.length - 1]).toISOString()
        : null;
      latestDate = periodEnd;
      absoluteLatestDate = periodEnd;

      checks.forEach((check) => {
        const sign = /возврат/i.test(String(check.ВидОперации || ""))
          ? -1
          : 1;
        (check.Товары || []).forEach((line) => {
          checkLines += 1;
          addLine({
            storeKey: check.Магазин_Key,
            line,
            sign,
            documentSellerKey: check.Продавец_Key,
            documentEmployeeType: "person",
            origin: "check",
          });
        });
      });

      // Если личный продавец в чеках не заполнен, возвращаем тот источник,
      // из которого раньше строился отчёт сотрудников: кассир смены, затем
      // ответственный документа. Оба поля ссылаются на Catalog_Пользователи.
      if (!grouped.size) {
        const cashShifts = await onecGet("Document_КассоваяСмена", {
          $top: 1000,
          $select: [
            "Ref_Key",
            "Date",
            "КассаККМ_Key",
            "НомерСменыККТ",
            "Кассир_Key",
            "Магазин_Key",
          ].join(","),
          $filter: "Posted eq true",
          $orderby: "Date desc",
        });
        const cashiersByShift = new Map();
        cashShifts.forEach((shift) => {
          if (shift.Кассир_Key && shift.Кассир_Key !== EMPTY_GUID) {
            cashShiftsWithCashier += 1;
            cashiersByShift.set(
              `${shift.КассаККМ_Key}:${shift.НомерСменыККТ}`,
              shift,
            );
          }
        });
        checksWithResponsible = checks.filter(
          (check) =>
            check.Ответственный_Key &&
            check.Ответственный_Key !== EMPTY_GUID,
        ).length;
        salesLines = 0;
        returnLines = 0;
        linesWithConsultant = 0;
        checkLines = 0;
        checkLinesWithConsultant = 0;

        checks.forEach((check) => {
          const sign = /возврат/i.test(String(check.ВидОперации || ""))
            ? -1
            : 1;
          const shift = cashiersByShift.get(
            `${check.КассаККМ_Key}:${check.НомерСменыККМ}`,
          );
          const employeeKey =
            (shift?.Кассир_Key && shift.Кассир_Key !== EMPTY_GUID
              ? shift.Кассир_Key
              : null) ||
            (check.Ответственный_Key && check.Ответственный_Key !== EMPTY_GUID
              ? check.Ответственный_Key
              : null);

          (check.Товары || []).forEach((line) => {
            checkLines += 1;
            addLine({
              storeKey: check.Магазин_Key || shift?.Магазин_Key,
              line,
              sign,
              documentSellerKey: employeeKey,
              documentEmployeeType: "user",
              origin: "check",
            });
          });
        });

        if (grouped.size) {
          usedEmployeeFallback = true;
          source = cashShiftsWithCashier
            ? "Document_ЧекККМ + Document_КассоваяСмена · кассир/ответственный"
            : "Document_ЧекККМ.Ответственный_Key · без периода";
        }
      }
    }

    // В некоторых базах консультант переносится из чеков только при закрытии
    // смены. Тогда ищем его в строках отчёта о розничных продажах.
    if (!grouped.size) {
      const reportResult = await loadReportPagesCached({
        limit: 500,
        days: 36_500,
      });
      reports = reportResult.items;
      cache = reportResult.cache;
      const reportTimestamps = reports
        .map((report) => new Date(report.Date).getTime())
        .filter(Number.isFinite)
        .sort((left, right) => left - right);
      if (reportTimestamps.length) {
        periodStart = new Date(reportTimestamps[0]).toISOString();
        periodEnd = new Date(
          reportTimestamps[reportTimestamps.length - 1],
        ).toISOString();
        latestDate = periodEnd;
      }
      source =
        "Document_ОтчетОРозничныхПродажах.Товары.Продавец_Key · все доступные данные";

      reports.forEach((report) => {
        (report.Товары || []).forEach((line) =>
          addLine({
            storeKey: report.Магазин_Key,
            line,
            sign: 1,
            documentSellerKey: null,
            origin: "retail-report",
          }),
        );
        (report.ВозвращенныеТовары || []).forEach((line) =>
          addLine({
            storeKey: report.Магазин_Key,
            line,
            sign: -1,
            documentSellerKey: null,
            origin: "retail-report",
          }),
        );
      });
    }

    const items = [...grouped.values()].sort(
      (left, right) => right.СтоимостьTurnover - left.СтоимостьTurnover,
    );
    const [people, users] = await Promise.all([
      loadReferencesByKeysBatched(
        "Catalog_ФизическиеЛица",
        items
          .filter((item) => item.СотрудникТип !== "user")
          .map((item) => item.Продавец_Key),
        "Ref_Key,Description,Сотрудник,Магазин_Key",
      ),
      loadReferencesByKeysBatched(
        "Catalog_Пользователи",
        items
          .filter((item) => item.СотрудникТип === "user")
          .map((item) => item.Продавец_Key),
        "Ref_Key,Description,ФизическоеЛицо_Key,ФизЛицо_Key,Магазин_Key",
      ),
    ]);
    const consultants = [...people, ...users];
    const stores = await loadReferencesByKeysBatched(
      "Catalog_Магазины",
      [
        ...items.map((item) => item.Магазин_Key),
        ...consultants.map((item) => item.Магазин_Key),
      ],
      "Ref_Key,Code,Description",
    );

    response.json({
      items,
      references: { sellers: consultants, stores },
      meta: {
        days,
        scope: "all",
        loaded: items.length,
        latestDate,
        absoluteLatestDate,
        analysisAnchorAdjusted,
        ignoredIsolatedDocuments,
        periodStart,
        periodEnd,
        source,
        cache,
        diagnostics: {
          scannedChecks,
          loadedChecks,
          checkLines,
          checkLinesWithConsultant,
          historicalChecksScanned,
          historicalChecksWithConsultant,
          historicalChecksTruncated,
          checksWithResponsible,
          cashShiftsWithCashier,
          usedEmployeeFallback,
          reports: reports.length,
          salesLines,
          returnLines,
          linesWithConsultant,
          consultants: consultants.length,
        },
      },
    });
  } catch (error) {
    console.error("Ошибка загрузки продаж консультантов 1С:", error);
    response.status(502).json({
      message:
        error instanceof Error
          ? error.message
          : "Не удалось получить продажи консультантов из 1С",
    });
  }
});

app.get("/api/dashboard/onec-sellers", async (request, response) => {
  try {
    const days = [1, 7, 30].includes(Number(request.query.days))
      ? Number(request.query.days)
      : 30;
    const latestRecords = await onecGet(
      "AccumulationRegister_Продажи_RecordType",
      {
        $top: 20,
        $select: "Period",
        $filter: "Active eq true",
        $orderby: "Period desc",
      },
    );

    if (!latestRecords.length) {
      return response.json({
        items: [],
        references: { sellers: [], stores: [] },
        meta: { days, loaded: 0, latestDate: null },
      });
    }

    const registerActivity = resolveActivityAnchor(latestRecords, "Period");
    const latestDate = registerActivity.anchorDate;
    const startDate = new Date(latestDate.getTime() - days * 86_400_000);
    const items = await onecTurnovers("AccumulationRegister_Продажи", {
      startPeriod: startDate,
      endPeriod: new Date(latestDate.getTime() + 1000),
      dimensions: "Продавец,Магазин",
      top: 5000,
      select: [
        "Продавец_Key",
        "Магазин_Key",
        "КоличествоTurnover",
        "СтоимостьTurnover",
        "СтоимостьБезСкидокTurnover",
      ].join(","),
    });
    let validItems = items
      .filter(
        (item) =>
          item.Продавец_Key &&
          item.Продавец_Key !== "00000000-0000-0000-0000-000000000000",
      )
      .map((item) => ({ ...item, СотрудникТип: "person" }));
    let effectiveLatestDate = latestDate;
    let absoluteLatestDate = registerActivity.absoluteLatestDate;
    let analysisAnchorAdjusted = registerActivity.adjusted;
    let ignoredIsolatedDocuments = registerActivity.ignoredDocuments;
    let source = "AccumulationRegister_Продажи/Turnovers";
    let scannedChecks = 0;
    let loadedChecks = 0;
    let scannedCashShifts = 0;
    let loadedCashShifts = 0;
    let checksWithAssignedEmployee = 0;
    let scannedPremiumRows = 0;
    let scannedRealizations = 0;

    if (!validItems.length) {
      const latestPremiumRows = await onecGet(
        "AccumulationRegister_ПремииПоЛичнымПродажам_RecordType",
        {
          $top: 20,
          $select: "Period",
          $filter: "Active eq true",
          $orderby: "Period desc",
        },
      );

      if (latestPremiumRows.length) {
        const premiumActivity = resolveActivityAnchor(
          latestPremiumRows,
          "Period",
        );
        effectiveLatestDate = premiumActivity.anchorDate;
        absoluteLatestDate = premiumActivity.absoluteLatestDate;
        analysisAnchorAdjusted = premiumActivity.adjusted;
        ignoredIsolatedDocuments = premiumActivity.ignoredDocuments;
        const premiumStartDate = new Date(
          effectiveLatestDate.getTime() - days * 86_400_000,
        );
        const premiumRows = await onecGet(
          "AccumulationRegister_ПремииПоЛичнымПродажам_RecordType",
          {
            $top: 1000,
            $select: [
              "Period",
              "Active",
              "Продавец_Key",
              "МагазинПродаж_Key",
              "МагазинРасчетаПремий_Key",
              "Количество",
              "СуммаПродаж",
            ].join(","),
            $filter: [
              "Active eq true",
              `Period ge datetime'${toOdataDateTime(premiumStartDate)}'`,
            ].join(" and "),
            $orderby: "Period desc",
          },
        );
        scannedPremiumRows = premiumRows.length;
        validItems = premiumRows
          .filter(
            (item) =>
              item.Продавец_Key &&
              item.Продавец_Key !== "00000000-0000-0000-0000-000000000000",
          )
          .map((item) => ({
            Продавец_Key: item.Продавец_Key,
            СотрудникТип: "person",
            Магазин_Key:
              item.МагазинПродаж_Key || item.МагазинРасчетаПремий_Key,
            КоличествоTurnover: Number(item.Количество || 0),
            СтоимостьTurnover: Number(item.СуммаПродаж || 0),
            СтоимостьБезСкидокTurnover: Number(item.СуммаПродаж || 0),
          }));
        if (validItems.length) {
          source = "AccumulationRegister_ПремииПоЛичнымПродажам_RecordType";
        }
      }
    }

    if (!validItems.length) {
      const latestChecks = await onecGet("Document_ЧекККМ", {
        $top: 20,
        $select: "Date",
        $filter: "Posted eq true",
        $orderby: "Date desc",
      });

      if (latestChecks.length) {
        const checkActivity = resolveActivityAnchor(latestChecks, "Date");
        effectiveLatestDate = checkActivity.anchorDate;
        absoluteLatestDate = checkActivity.absoluteLatestDate;
        analysisAnchorAdjusted = checkActivity.adjusted;
        ignoredIsolatedDocuments = checkActivity.ignoredDocuments;
        const checkStartDate = new Date(
          effectiveLatestDate.getTime() - days * 86_400_000,
        );
        const select = [
          "Ref_Key",
          "Date",
          "Posted",
          "ВидОперации",
          "КассаККМ_Key",
          "НомерСменыККМ",
          "Магазин_Key",
          "Продавец_Key",
          "Ответственный_Key",
          "СуммаДокумента",
          "Товары",
        ].join(",");
        let checks;

        try {
          checks = await onecGet("Document_ЧекККМ", {
            $top: 500,
            $select: select,
            $filter: [
              "Posted eq true",
              `Date ge datetime'${toOdataDateTime(checkStartDate)}'`,
            ].join(" and "),
            $orderby: "Date desc",
          });
        } catch (error) {
          console.warn(
            "1С не приняла фильтр чеков по дате, загружаем последние чеки:",
            error instanceof Error ? error.message : error,
          );
          checks = await onecGet("Document_ЧекККМ", {
            $top: 500,
            $select: select,
            $filter: "Posted eq true",
            $orderby: "Date desc",
          });
        }

        loadedChecks = checks.length;
        checks = filterByPeriod(
          checks,
          "Date",
          checkStartDate,
          new Date(effectiveLatestDate.getTime() + 1000),
        );
        scannedChecks = checks.length;
        let cashShifts = [];
        const cashShiftSelect = [
          "Ref_Key",
          "Date",
          "Posted",
          "КассаККМ_Key",
          "НомерСменыККТ",
          "Кассир_Key",
          "Магазин_Key",
        ].join(",");

        try {
          cashShifts = await onecGet("Document_КассоваяСмена", {
            $top: 500,
            $select: cashShiftSelect,
            $filter: [
              "Posted eq true",
              `Date ge datetime'${toOdataDateTime(checkStartDate)}'`,
            ].join(" and "),
            $orderby: "Date desc",
          });
        } catch (error) {
          console.warn(
            "1С не приняла фильтр кассовых смен по дате, загружаем последние смены:",
            error instanceof Error ? error.message : error,
          );
          cashShifts = await onecGet("Document_КассоваяСмена", {
            $top: 500,
            $select: cashShiftSelect,
            $filter: "Posted eq true",
            $orderby: "Date desc",
          });
        }

        loadedCashShifts = cashShifts.length;
        cashShifts = filterByPeriod(
          cashShifts,
          "Date",
          checkStartDate,
          new Date(effectiveLatestDate.getTime() + 1000),
        );
        scannedCashShifts = cashShifts.length;
        const cashiersByShift = new Map();
        cashShifts.forEach((shift) => {
          if (
            shift.КассаККМ_Key &&
            shift.НомерСменыККТ !== undefined &&
            shift.Кассир_Key &&
            shift.Кассир_Key !== EMPTY_GUID
          ) {
            cashiersByShift.set(
              `${shift.КассаККМ_Key}:${shift.НомерСменыККТ}`,
              shift,
            );
          }
        });

        const groupedChecks = new Map();
        const addTurnover = ({
          sellerKey,
          employeeType,
          storeKey,
          quantity,
          revenue,
          fullPrice,
        }) => {
          if (!sellerKey || sellerKey === "00000000-0000-0000-0000-000000000000") {
            return;
          }
          const key = `${employeeType}:${sellerKey}:${storeKey}`;
          const current = groupedChecks.get(key) || {
            Продавец_Key: sellerKey,
            СотрудникТип: employeeType,
            Магазин_Key: storeKey,
            КоличествоTurnover: 0,
            СтоимостьTurnover: 0,
            СтоимостьБезСкидокTurnover: 0,
          };
          current.КоличествоTurnover += quantity;
          current.СтоимостьTurnover += revenue;
          current.СтоимостьБезСкидокTurnover += fullPrice;
          groupedChecks.set(key, current);
        };

        checks.forEach((check) => {
          const sign = /возврат/i.test(String(check.ВидОперации || "")) ? -1 : 1;
          const lines = check.Товары || [];
          const shift = cashiersByShift.get(
            `${check.КассаККМ_Key}:${check.НомерСменыККМ}`,
          );
          const directSellerKey =
            check.Продавец_Key && check.Продавец_Key !== EMPTY_GUID
              ? check.Продавец_Key
              : null;
          const cashierKey =
            shift?.Кассир_Key && shift.Кассир_Key !== EMPTY_GUID
              ? shift.Кассир_Key
              : null;
          const responsibleKey =
            check.Ответственный_Key && check.Ответственный_Key !== EMPTY_GUID
              ? check.Ответственный_Key
              : null;
          const fallbackEmployeeKey = directSellerKey || cashierKey || responsibleKey;
          const fallbackEmployeeType = directSellerKey ? "person" : "user";
          const resolvedStoreKey =
            check.Магазин_Key && check.Магазин_Key !== EMPTY_GUID
              ? check.Магазин_Key
              : shift?.Магазин_Key;

          if (fallbackEmployeeKey) {
            checksWithAssignedEmployee += 1;
          }

          if (!lines.length) {
            addTurnover({
              sellerKey: fallbackEmployeeKey,
              employeeType: fallbackEmployeeType,
              storeKey: resolvedStoreKey,
              quantity: 0,
              revenue: sign * Number(check.СуммаДокумента || 0),
              fullPrice: sign * Number(check.СуммаДокумента || 0),
            });
            return;
          }

          lines.forEach((line) => {
            const revenue = Number(line.Сумма || 0);
            const discounts =
              Number(line.СуммаАвтоматическойСкидки || 0) +
              Number(line.СуммаРучнойСкидки || 0) +
              Number(line.СуммаСкидкиОплатыБонусом || 0);
            const lineSellerKey =
              line.Продавец_Key && line.Продавец_Key !== EMPTY_GUID
                ? line.Продавец_Key
                : null;
            addTurnover({
              sellerKey: lineSellerKey || fallbackEmployeeKey,
              employeeType: lineSellerKey ? "person" : fallbackEmployeeType,
              storeKey: resolvedStoreKey,
              quantity: sign * Number(line.Количество || 0),
              revenue: sign * revenue,
              fullPrice: sign * (revenue + discounts),
            });
          });
        });

        validItems = [...groupedChecks.values()];
        source = cashiersByShift.size
          ? "Document_ЧекККМ + Document_КассоваяСмена (fallback)"
          : "Document_ЧекККМ (fallback)";
      }
    }

    if (!validItems.length) {
      const latestRealizations = await onecGet("Document_РеализацияТоваров", {
        $top: 20,
        $select: "Date",
        $filter: "Posted eq true",
        $orderby: "Date desc",
      });

      if (latestRealizations.length) {
        const realizationActivity = resolveActivityAnchor(
          latestRealizations,
          "Date",
        );
        effectiveLatestDate = realizationActivity.anchorDate;
        absoluteLatestDate = realizationActivity.absoluteLatestDate;
        analysisAnchorAdjusted = realizationActivity.adjusted;
        ignoredIsolatedDocuments = realizationActivity.ignoredDocuments;
        const realizationStartDate = new Date(
          effectiveLatestDate.getTime() - days * 86_400_000,
        );
        const realizations = await onecGet("Document_РеализацияТоваров", {
          $top: 500,
          $select: [
            "Ref_Key",
            "Date",
            "Posted",
            "Магазин_Key",
            "Продавец_Key",
            "СуммаДокумента",
            "Товары",
          ].join(","),
          $filter: [
            "Posted eq true",
            `Date ge datetime'${toOdataDateTime(realizationStartDate)}'`,
          ].join(" and "),
          $orderby: "Date desc",
        });
        scannedRealizations = realizations.length;
        const groupedRealizations = new Map();

        realizations.forEach((document) => {
          const lines = document.Товары || [];
          lines.forEach((line) => {
            const sellerKey =
              line.Продавец_Key && line.Продавец_Key !== "00000000-0000-0000-0000-000000000000"
                ? line.Продавец_Key
                : document.Продавец_Key;
            if (!sellerKey || sellerKey === "00000000-0000-0000-0000-000000000000") {
              return;
            }
            const key = `${sellerKey}:${document.Магазин_Key}`;
            const current = groupedRealizations.get(key) || {
              Продавец_Key: sellerKey,
              СотрудникТип: "person",
              Магазин_Key: document.Магазин_Key,
              КоличествоTurnover: 0,
              СтоимостьTurnover: 0,
              СтоимостьБезСкидокTurnover: 0,
            };
            const revenue = Number(line.Сумма || 0);
            const discounts =
              Number(line.СуммаАвтоматическойСкидки || 0) +
              Number(line.СуммаРучнойСкидки || 0);
            current.КоличествоTurnover += Number(line.Количество || 0);
            current.СтоимостьTurnover += revenue;
            current.СтоимостьБезСкидокTurnover += revenue + discounts;
            groupedRealizations.set(key, current);
          });
        });

        validItems = [...groupedRealizations.values()];
        if (validItems.length) {
          source = "Document_РеализацияТоваров (fallback)";
        }
      }
    }
    const personKeys = validItems
      .filter((item) => item.СотрудникТип !== "user")
      .map((item) => item.Продавец_Key);
    const userKeys = validItems
      .filter((item) => item.СотрудникТип === "user")
      .map((item) => item.Продавец_Key);
    const [people, users] = await Promise.all([
      loadReferencesByKeysBatched(
      "Catalog_ФизическиеЛица",
      personKeys,
      "Ref_Key,Description,Магазин_Key",
      ),
      loadReferencesByKeysBatched(
        "Catalog_Пользователи",
        userKeys,
        "Ref_Key,Description,ФизическоеЛицо_Key,ФизЛицо_Key,Магазин_Key",
      ),
    ]);
    const sellers = [...people, ...users];
    const stores = await loadReferencesByKeysBatched(
      "Catalog_Магазины",
      [
        ...validItems.map((item) => item.Магазин_Key),
        ...sellers.map((item) => item.Магазин_Key),
      ],
      "Ref_Key,Code,Description",
    );

    response.json({
      items: validItems,
      references: { sellers, stores },
      meta: {
        days,
        loaded: validItems.length,
        latestDate: effectiveLatestDate.toISOString(),
        absoluteLatestDate: absoluteLatestDate?.toISOString() || null,
        analysisAnchorAdjusted,
        ignoredIsolatedDocuments,
        periodStart: new Date(
          effectiveLatestDate.getTime() - days * 86_400_000,
        ).toISOString(),
        periodEnd: effectiveLatestDate.toISOString(),
        source,
        diagnostics: {
          turnoverRows: items.length,
          turnoverRowsWithSeller: items.filter(
            (item) =>
              item.Продавец_Key &&
              item.Продавец_Key !== "00000000-0000-0000-0000-000000000000",
          ).length,
          scannedChecks,
          loadedChecks,
          scannedCashShifts,
          loadedCashShifts,
          checksWithAssignedEmployee,
          scannedPremiumRows,
          scannedRealizations,
          resultRows: validItems.length,
        },
      },
    });
  } catch (error) {
    console.error("Ошибка загрузки продаж по продавцам 1С:", error);
    response.status(502).json({
      message:
        error instanceof Error
          ? error.message
          : "Не удалось получить продажи по продавцам из 1С",
    });
  }
});

app.get("/api/dashboard/onec-stock", async (request, response) => {
  try {
    const top = Math.min(
      Math.max(Number(request.query.top) || 5000, 1),
      10000,
    );
    const balances = await onecBalance(
      "AccumulationRegister_ТоварыНаСкладах",
      {
        period: request.query.period || new Date(),
        dimensions: "Склад,Номенклатура",
        top,
        select: [
          "Склад_Key",
          "Номенклатура_Key",
          "КоличествоBalance",
          "РезервBalance",
          "ор_СебестоимостьBalance",
        ].join(","),
      },
    );

    const operationRequests = await Promise.allSettled([
      onecGet("Document_ПоступлениеТоваров", {
        $top: 60,
        $select: [
          "Ref_Key",
          "Number",
          "Date",
          "Posted",
          "Контрагент_Key",
          "Склад_Key",
          "СуммаДокумента",
          "Товары",
        ].join(","),
        $filter: "Posted eq true",
        $orderby: "Date desc",
      }),
      onecGet("Document_СписаниеТоваров", {
        $top: 30,
        $select: [
          "Ref_Key",
          "Number",
          "Date",
          "Posted",
          "Склад_Key",
          "ОснованиеСписания",
          "Комментарий",
          "Товары",
        ].join(","),
        $filter: "Posted eq true",
        $orderby: "Date desc",
      }),
      onecGet("Document_ПересчетТоваров", {
        $top: 30,
        $select: [
          "Ref_Key",
          "Number",
          "Date",
          "Posted",
          "Склад_Key",
          "Статус",
          "Товары",
        ].join(","),
        $filter: "Posted eq true",
        $orderby: "Date desc",
      }),
    ]);
    const [receiptResult, writeOffResult, recountResult] = operationRequests;
    const receipts = receiptResult.status === "fulfilled" ? receiptResult.value : [];
    const writeOffs = writeOffResult.status === "fulfilled" ? writeOffResult.value : [];
    const recounts = recountResult.status === "fulfilled" ? recountResult.value : [];
    const operationErrors = {
      receipts:
        receiptResult.status === "rejected"
          ? receiptResult.reason?.message || "Источник недоступен"
          : "",
      writeOffs:
        writeOffResult.status === "rejected"
          ? writeOffResult.reason?.message || "Источник недоступен"
          : "",
      recounts:
        recountResult.status === "rejected"
          ? recountResult.reason?.message || "Источник недоступен"
          : "",
    };

    const operationLines = [...receipts, ...writeOffs, ...recounts].flatMap(
      (document) => document.Товары || [],
    );
    const productKeys = [
      ...balances.map((item) => item.Номенклатура_Key),
      ...operationLines.map((item) => item.Номенклатура_Key),
    ];
    const warehouseKeys = balances.map((item) => item.Склад_Key);
    warehouseKeys.push(
      ...[...receipts, ...writeOffs, ...recounts].map(
        (document) => document.Склад_Key,
      ),
    );
    const [rawProducts, warehouses, suppliers, productKinds] = await Promise.all([
      loadReferencesByKeysBatched(
        "Catalog_Номенклатура",
        productKeys,
        [
          "Ref_Key",
          "Code",
          "Description",
          "НаименованиеПолное",
          "Артикул",
          "ВидНоменклатуры_Key",
        ].join(","),
      ),
      loadReferencesByKeysBatched(
        "Catalog_Склады",
        warehouseKeys,
        "Ref_Key,Code,Description,ТипСклада,Магазин_Key",
      ),
      loadReferencesByKeysBatched(
        "Catalog_Контрагенты",
        receipts.map((item) => item.Контрагент_Key),
        "Ref_Key,Code,Description,НаименованиеПолное",
      ),
      loadProductKindsCatalog(),
    ]);
    const products = enrichProductsWithBusinessCategories(
      rawProducts,
      productKinds,
    );
    const categories = publicBusinessCategories();

    response.json({
      items: balances,
      references: {
        products,
        warehouses,
        categories,
        productKinds,
        suppliers,
      },
      operations: { receipts, writeOffs, recounts },
      meta: {
        loaded: balances.length,
        asOf: new Date().toISOString(),
        source: "AccumulationRegister_ТоварыНаСкладах/Balance",
        operationErrors,
      },
    });
  } catch (error) {
    console.error("Ошибка загрузки остатков 1С:", error);
    response.status(502).json({
      message:
        error instanceof Error
          ? error.message
          : "Не удалось получить остатки из 1С",
    });
  }
});

app.get("/api/dashboard/onec-reports", async (request, response) => {
  try {
    const top = Math.min(
      Math.max(Number(request.query.top) || 1, 1),
      500,
    );
    const days = Math.min(
      Math.max(Number(request.query.days) || 60, 1),
      365,
    );

    const startedAt = Date.now();
    const reportResult = await loadReportPagesCached({ limit: top, days });
    const items = reportResult.items;

    if (request.query.references === "false") {
      return response.json({
        items,
        references: {
          products: [],
          warehouses: [],
          categories: [],
        },
        meta: {
          loaded: items.length,
          days,
          cache: reportResult.cache,
          durationMs: Date.now() - startedAt,
          referencesLoaded: false,
        },
      });
    }

    const productKeys = items.flatMap((report) =>
      (report.Товары || []).map((line) => line.Номенклатура_Key),
    );
    const warehouseKeys = items.flatMap((report) =>
      (report.Товары || []).map((line) => line.Склад_Key),
    );

    const [rawProducts, warehouses, productKinds] = await Promise.all([
      loadReferencesByKeys(
        "Catalog_Номенклатура",
        productKeys,
        [
          "Ref_Key",
          "Code",
          "Description",
          "НаименованиеПолное",
          "Артикул",
          "ВидНоменклатуры_Key",
        ].join(","),
      ),
      loadReferencesByKeys(
        "Catalog_Склады",
        warehouseKeys,
        [
          "Ref_Key",
          "Code",
          "Description",
          "ТипСклада",
          "Магазин_Key",
        ].join(","),
      ),
      loadProductKindsCatalog(),
    ]);
    const products = enrichProductsWithBusinessCategories(
      rawProducts,
      productKinds,
    );
    const categories = publicBusinessCategories();

    response.json({
      items,
      references: {
        products,
        warehouses,
        categories,
        productKinds,
      },
      meta: {
        loaded: items.length,
        days,
        cache: reportResult.cache,
        durationMs: Date.now() - startedAt,
        referencesLoaded: true,
      },
    });
  } catch (error) {
    console.error("Ошибка загрузки отчётов 1С:", error);

    response.status(502).json({
      message:
        error instanceof Error
          ? error.message
          : "Не удалось получить отчёты 1С",
    });
  }
});

app.get("/api/onec/:entity", async (request, response) => {
  try {
    const data = await onecGet(request.params.entity, {
      $top: Math.min(Number(request.query.top) || 100, 500),
      $select: request.query.select,
      $filter: request.query.filter,
      $orderby: request.query.orderby,
      $expand: request.query.expand,
    });

    response.json({ items: data });
  } catch (error) {
    response.status(502).json({
      message: error instanceof Error ? error.message : "Ошибка 1С",
    });
  }
});

app.listen(port, () => {
  console.log(`3КВАДРАТА API: http://localhost:${port}`);
});
