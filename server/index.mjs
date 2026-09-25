import cors from "cors";
import express from "express";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { LocalAnalytics, normalizeAnalyticsQuery } from "./dashboard/local-analytics.mjs";
import {
  authenticateRequest,
  authStore,
  authorizeDashboardApi,
  createAuthRouter,
  initializeAuth,
  isAllowedCorsOrigin,
  verifyRequestOrigin,
} from "./auth/index.mjs";
import { dashboardData } from "./data.mjs";
import {
  EMPTY_GUID,
  GUID_PATTERN,
  RETAIL_REPORT_ENTITY,
  RETAIL_REPORT_SELECT,
} from "./dashboard/constants.mjs";
import {
  describeDataFreshness,
  enrichProductsWithBusinessCategories,
  filterByPeriod,
  normalizeOnecDateTime,
  parseOnecDateTime,
  publicBusinessCategories,
  resolveActivityAnchor,
  startOfOnecDay,
  summarizeProductReference,
  toOdataDateTime,
} from "./dashboard/utils.mjs";
import {
  onecBalance,
  onecGet,
  onecGetByKey,
  onecMetadata,
  onecTurnovers,
} from "./onec.mjs";
import {
  loadCheckAnalytics,
  loadCheckAnalyticsRange,
} from "./dashboard/checks.mjs";
import { loadMarginPeriod } from "./dashboard/margin-loader.mjs";
import { scanReportsByRange } from "./dashboard/report-range.mjs";
import { summarizeMarginRows } from "./dashboard/margin.mjs";
import {
  parseSalesChannel,
  salesChannelFromOrder,
} from "./dashboard/sales-channels.mjs";

const app = express();
const port = Number(process.env.PORT || 4000);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_, response, next) => {
  response.set("X-Content-Type-Options", "nosniff");
  response.set("X-Frame-Options", "DENY");
  response.set("Referrer-Policy", "same-origin");
  next();
});
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(origin) ? origin || false : false);
    },
  }),
);
app.use(express.json({ limit: "32kb" }));
app.use("/api/auth", createAuthRouter());

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "3kvadrata-api" });
});

app.use(
  "/api",
  authenticateRequest,
  (_request, response, next) => {
    response.set("Cache-Control", "no-store, max-age=0");
    response.set("Pragma", "no-cache");
    next();
  },
  (request, response, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
    return verifyRequestOrigin(request, response, next);
  },
  authorizeDashboardApi,
);

app.get("/api/dashboard", (_request, response) => {
  response.json(dashboardData);
});
app.get("/api/dashboard/team-plan", (request, response) => {
  const period = [1, 7, 30].includes(Number(request.query.period))
    ? Number(request.query.period)
    : 30;
  const storeKey = String(request.query.storeKey || "all");
  const channel = parseSalesChannel(request.query.channel);
  response.json({ item: authStore.getTeamSalesPlan(storeKey, period, channel) });
});

app.put("/api/dashboard/team-plan", (request, response) => {
  if (request.auth.user.role !== "manager") {
    return response.status(403).json({ message: "Только руководитель может менять план команды" });
  }

  try {
    const item = authStore.setTeamSalesPlan({
      storeKey: request.body?.storeKey || "all",
      periodDays: request.body?.period,
      channel: parseSalesChannel(request.body?.channel),
      amount: request.body?.amount,
      updatedBy: request.auth.user.id,
    });
    return response.json({ item });
  } catch (error) {
    return response.status(400).json({
      message: error instanceof Error ? error.message : "Не удалось сохранить план",
    });
  }
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

const localAnalytics = process.env.ONEC_LOCAL_ANALYTICS !== "false"
  ? new LocalAnalytics({
      databasePath: resolve(process.env.ONEC_ANALYTICS_DB_PATH || "data/analytics.sqlite"),
      namespace: createHash("sha256").update([
        "v1", process.env.ONEC_ODATA_URL || "", process.env.ONEC_USER || "",
        process.env.ONEC_TIMEZONE_OFFSET_MINUTES || "360",
      ].join("|")).digest("hex"),
      loaders: { reports: buildReportsPayload, margin: buildMarginPayload },
      refreshMs: Math.max(Number(process.env.ONEC_SYNC_INTERVAL_MS) || 300_000, 60_000),
    })
  : null;

function analyticsHandler(kind) {
  return async (request, response) => {
    let query;
    try {
      query = normalizeAnalyticsQuery(kind, request.query);
    } catch (error) {
      return response.status(400).json({ message: error.message });
    }
    try {
      if (!localAnalytics) {
        const loader = kind === "reports" ? buildReportsPayload : buildMarginPayload;
        return response.json(await loader(query));
      }
      const { payload, sync } = localAnalytics.read(kind, query);
      if (!payload) {
        response.set("Retry-After", "10");
        return response.status(503).json({
          code: "ANALYTICS_SYNC_PENDING",
          message: sync.error
            ? "Не удалось обновить локальные данные: " + sync.error
            : "Период загружается из 1С в локальную базу. Повторная загрузка страницы не требуется.",
          meta: { localSync: sync },
        });
      }
      return response.json({ ...payload, meta: { ...payload.meta, localSync: sync } });
    } catch (error) {
      console.error(`Ошибка аналитики ${kind}:`, error);
      return response.status(502).json({ message: error instanceof Error ? error.message : "Ошибка аналитики" });
    }
  };
}

app.get("/api/dashboard/sync-status", (_request, response) => {
  response.json(localAnalytics?.status() || { enabled: false });
});

function warmLocalAnalytics() {
  if (!localAnalytics || !process.env.ONEC_ODATA_URL || !process.env.ONEC_USER || !process.env.ONEC_PASSWORD) return;
  const today = toOdataDateTime(Date.now()).slice(0, 10);
  const dateAt = (offset) => new Date(Date.parse(today) + offset * 86_400_000).toISOString().slice(0, 10);
  const current = { from: dateAt(-29), to: today };
  const previous = { from: dateAt(-59), to: dateAt(-30) };
  for (const range of [current, previous]) {
    localAnalytics.read("reports", normalizeAnalyticsQuery("reports", { ...range, references: "false" }));
  }
  localAnalytics.read("margin", normalizeAnalyticsQuery("margin", { ...current, includePrevious: "false" }));
  localAnalytics.read("reports", normalizeAnalyticsQuery("reports", { ...current, references: "only" }));
}

function uniqueReports(reports) {
  const seen = new Set();
  return reports.filter((report) => {
    const key = report.Ref_Key;
    if (!key || seen.has(key)) return !key;
    seen.add(key);
    return true;
  });
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


async function loadReportPagesByRange({ limit, from, to }) {
  const configuredPageSize = Number(process.env.ONEC_PAGE_SIZE || 25);
  const pageSize = Math.min(Math.max(configuredPageSize, 1), 100);
  const fromTimestamp = parseOnecDateTime(`${from}T00:00:00`);
  const endExclusive = parseOnecDateTime(`${to}T00:00:00`) + 86_400_000;

  if (
    !Number.isFinite(fromTimestamp) ||
    !Number.isFinite(endExclusive) ||
    fromTimestamp >= endExclusive
  ) {
    throw new Error("Некорректный диапазон дат");
  }

  const maxScanned = Math.min(
    Math.max(Number(process.env.ONEC_REPORT_MAX_SCAN) || 10_000, 100),
    100_000,
  );
  const reports = await scanReportsByRange({
    fromTimestamp,
    endExclusive,
    pageSize,
    maxScanned,
    getPage: (top, skip) => onecGet(RETAIL_REPORT_ENTITY, {
      $top: top,
      $skip: skip,
      $select: RETAIL_REPORT_SELECT,
      $filter: "Posted eq true",
      $orderby: "Date desc",
    }),
  });
  return limit === null ? reports : reports.slice(0, limit);
}

async function loadReportPagesByRangeCached({ limit, from, to }) {
  const key = `range:${limit ?? "all"}:${from}:${to}`;
  const now = Date.now();
  const cached = reportCache.get(key);

  if (cached?.items && cached.expiresAt > now) {
    return { items: cached.items, cache: "hit" };
  }
  if (cached?.promise) {
    return { items: await cached.promise, cache: "shared" };
  }

  const ttlMs = Math.max(
    Number(process.env.ONEC_REPORT_CACHE_TTL_MS || 30_000),
    5_000,
  );
  const promise = loadReportPagesByRange({ limit, from, to });
  reportCache.set(key, { promise, expiresAt: now + ttlMs });

  try {
    const items = await promise;
    reportCache.set(key, {
      items,
      expiresAt: Date.now() + ttlMs,
    });
    return { items, cache: "miss" };
  } catch (error) {
    reportCache.delete(key);
    throw error;
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
    Number(process.env.ONEC_REPORT_CACHE_TTL_MS || 30_000),
    5_000,
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

// Совместимый загрузчик для блока консультантов из коммита ec34f5a.
// Важное отличие: если 1С отклоняет фильтр по Date, здесь возвращаются все
// загруженные отчёты без повторной локальной фильтрации. Именно на этом
// fallback в исходной реализации находились заполненные строки продавцов.
async function loadConsultantReportPagesLegacy({ limit, days }) {
  const configuredPageSize = Number(process.env.ONEC_PAGE_SIZE || 25);
  const pageSize = Math.min(Math.max(configuredPageSize, 1), 100);
  const latest = await onecGet(RETAIL_REPORT_ENTITY, {
    $top: 1,
    $select: "Date",
    $filter: "Posted eq true",
    $orderby: "Date desc",
  });

  if (!latest.length) return [];

  const latestTimestamp = parseOnecDateTime(latest[0].Date);
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
      if (page.length < currentPageSize) break;
    }

    return result;
  }

  try {
    return await load(dateFilter);
  } catch (error) {
    console.warn(
      [
        "1С не приняла период консультантов в розничных отчётах,",
        "используем совместимый fallback ec34f5a:",
      ].join(" "),
      error instanceof Error ? error.message : error,
    );
    return load("Posted eq true");
  }
}

async function loadConsultantReportPagesLegacyCached({ limit, days }) {
  const key = `consultants-ec34:${limit}:${days}`;
  const now = Date.now();
  const cached = reportCache.get(key);

  if (cached?.items && cached.expiresAt > now) {
    return { items: cached.items, cache: "hit" };
  }
  if (cached?.promise) {
    return { items: await cached.promise, cache: "shared" };
  }

  const ttlMs = Math.max(
    Number(process.env.ONEC_REPORT_CACHE_TTL_MS || 30_000),
    5_000,
  );
  const promise = loadConsultantReportPagesLegacy({ limit, days });
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
  const concurrency = Math.min(
    Math.max(Number(process.env.ONEC_REFERENCE_CONCURRENCY || 15), 1),
    25,
  );
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

  for (let index = 0; index < missingKeys.length; index += concurrency) {
    const chunk = missingKeys.slice(index, index + concurrency);
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

function loadProductSubcategories(products) {
  return loadReferencesByKeysBatched(
    "Catalog_Номенклатура",
    products.map((product) => product.Parent_Key),
    "Ref_Key,Code,Description,Parent_Key,IsFolder",
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
        "Parent_Key",
        "ВидНоменклатуры_Key",
        "ТоварнаяГруппа_Key",
        "ТоварнаяКатегория_Key",
      ].join(","),
    });

    const [productKinds, productGroups, productSubcategories] =
      await Promise.all([
        // В этой базе запрос Catalog_*(guid'...') может не вернуть запись.
        // Справочник видов номенклатуры небольшой, поэтому надёжнее загрузить
        // его целиком и сопоставить ключи в памяти.
        loadProductKindsCatalog(),
        loadReferencesByKeys(
          "Catalog_ТоварныеГруппы",
          products.map((product) => product.ТоварнаяГруппа_Key),
          "Ref_Key,Code,Description,Parent_Key,IsFolder",
        ),
        loadProductSubcategories(products),
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
    const subcategories = summarizeProductReference(
      products,
      "Parent_Key",
      productSubcategories,
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
        subcategories,
      },
      references: {
        productKinds,
        productGroups,
        subcategories: productSubcategories,
      },
      meta: {
        loadedProducts: products.length,
        fields: {
          productKinds: "ВидНоменклатуры_Key",
          productGroups: "ТоварнаяГруппа_Key",
          productCategoryKeys: "ТоварнаяКатегория_Key",
          subcategories: "Catalog_Номенклатура.Parent_Key",
        },
        note: [
          "ТоварнаяКатегория_Key есть в карточке номенклатуры,",
          "но отдельный справочник товарных категорий не опубликован",
          "в standard.odata. Названия можно получить через",
          "ВидНоменклатуры, если там настроены бизнес-категории.",
        ].join(" "),
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
    const from = typeof request.query.from === "string" ? request.query.from : "";
    const to = typeof request.query.to === "string" ? request.query.to : "";
    const customRange = Boolean(from || to);
    if (customRange && (!/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)) {
      return response.status(400).json({ message: "Некорректный диапазон дат продавцов" });
    }
    const rangeStart = customRange ? parseOnecDateTime(`${from}T00:00:00`) : null;
    const rangeEnd = customRange ? parseOnecDateTime(`${to}T00:00:00`) + 86_400_000 : null;
    if (customRange && (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) ||
      rangeEnd - rangeStart > 366 * 86_400_000)) {
      return response.status(400).json({ message: "Некорректный диапазон дат продавцов" });
    }
    const days = [1, 7, 30].includes(Number(request.query.days))
      ? Number(request.query.days)
      : 30;
    const channel = parseSalesChannel(request.query.channel);
    const grouped = new Map();
    let salesLines = 0;
    let returnLines = 0;
    let linesWithConsultant = 0;
    let scannedChecks = 0;
    let checkLines = 0;
    let checkLinesWithConsultant = 0;
    let reports = [];
    let cache = "not-used";
    let latestDate = null;
    let source = "Document_ЧекККМ.Товары.Продавец_Key";

    const addLine = ({
      storeKey,
      line,
      sign,
      documentSellerKey,
      origin,
      documentKey,
      documentDate,
      orderKey,
    }) => {
      const lineOrderKey =
        line.ЗаказПокупателя_Key && line.ЗаказПокупателя_Key !== EMPTY_GUID
          ? line.ЗаказПокупателя_Key
          : orderKey;
      const lineChannel = salesChannelFromOrder(lineOrderKey);
      if (channel !== "all" && channel !== lineChannel) return;
      if (sign > 0) salesLines += 1;
      else returnLines += 1;

      const consultantKey =
        line.Продавец_Key && line.Продавец_Key !== EMPTY_GUID
          ? line.Продавец_Key
          : documentSellerKey;
      if (!consultantKey || consultantKey === EMPTY_GUID) return;

      linesWithConsultant += 1;
      if (origin === "check") checkLinesWithConsultant += 1;
      const resolvedStoreKey = storeKey || EMPTY_GUID;
      const key = `${consultantKey}:${resolvedStoreKey}`;
      const current = grouped.get(key) || {
        Продавец_Key: consultantKey,
        СотрудникТип: "consultant",
        Магазин_Key: resolvedStoreKey,
        КоличествоTurnover: 0,
        СтоимостьTurnover: 0,
        СтоимостьБезСкидокTurnover: 0,
        СтрокПродаж: 0,
        СтрокВозвратов: 0,
        СуммаСкидок: 0,
        ПродажиПоДатам: {},
        _checkKeys: new Set(),
      };
      const quantity = Number(line.Количество || 0);
      const amount = Number(line.Сумма || 0);
      const fullPrice = Number(line.Цена || 0) * quantity;
      const discount =
        Number(line.СуммаАвтоматическойСкидки || 0) +
        Number(line.СуммаРучнойСкидки || 0) +
        Number(line.СуммаСкидкиОплатыБонусом || 0);

      current.КоличествоTurnover += sign * quantity;
      current.СтоимостьTurnover += sign * amount;
      current.СтоимостьБезСкидокTurnover += sign * Math.max(fullPrice, amount);
      current.СуммаСкидок += sign * Math.max(discount, fullPrice - amount, 0);
      if (origin === "check" && sign > 0 && documentKey) {
        current._checkKeys.add(documentKey);
      }
      if (documentDate) {
        const dateMatch = String(documentDate).match(/^(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch?.[1];
        if (date) {
          current.ПродажиПоДатам[date] =
            Number(current.ПродажиПоДатам[date] || 0) + sign * amount;
        }
      }
      if (sign > 0) current.СтрокПродаж += 1;
      else current.СтрокВозвратов += 1;
      grouped.set(key, current);
    };

    const latestChecks = await onecGet("Document_ЧекККМ", {
      $top: 1,
      $select: "Date",
      $filter: "Posted eq true",
      $orderby: "Date desc",
    });

    if (latestChecks.length) {
      latestDate = latestChecks[0].Date;
      const checkStartDate = new Date(customRange
        ? rangeStart
        : startOfOnecDay(latestDate) - (days - 1) * 86_400_000);
      const checkEndDate = new Date(customRange
        ? rangeEnd
        : startOfOnecDay(latestDate) + 86_400_000);
      const checkQuery = {
        $top: 1000,
        $select: [
          "Ref_Key",
          "Date",
          "Posted",
          "ВидОперации",
          "Магазин_Key",
          "Продавец_Key",
          "ЗаказПокупателя_Key",
          "Товары",
        ].join(","),
        $orderby: "Date desc",
      };
      let checks;

      try {
        const filter = [
            "Posted eq true",
            `Date ge datetime'${toOdataDateTime(checkStartDate)}'`,
            `Date lt datetime'${toOdataDateTime(checkEndDate)}'`,
          ].join(" and ");
        if (customRange) {
          checks = [];
          const pageSize = 100;
          while (checks.length < 1000) {
            const page = await onecGet("Document_ЧекККМ", {
              ...checkQuery, $top: pageSize, $skip: checks.length, $filter: filter,
            });
            checks.push(...page);
            if (page.length < pageSize) break;
          }
          if (checks.length >= 1000) {
            throw new Error("Лимит 1000 чеков за выбранный период; аналитика продавцов может быть неполной");
          }
        } else {
          checks = await onecGet("Document_ЧекККМ", {
            ...checkQuery, $filter: filter,
          });
        }
      } catch (error) {
        if (/Лимит 1000 чеков/.test(String(error?.message || ""))) throw error;
        console.warn(
          "1С не приняла период консультантов по чекам, загружаем последние чеки:",
          error instanceof Error ? error.message : error,
        );
        checks = customRange
          ? []
          : await onecGet("Document_ЧекККМ", {
              ...checkQuery,
              $filter: "Posted eq true",
            });
      }
      checks = filterByPeriod(checks, "Date", checkStartDate,
        new Date(checkEndDate.getTime() - 1));
      scannedChecks = checks.length;
      if (customRange) latestDate = checks[0]?.Date || null;

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
            origin: "check",
            documentKey: check.Ref_Key,
            documentDate: check.Date,
            orderKey: check.ЗаказПокупателя_Key,
          });
        });
      });
    }

    // В некоторых базах консультант переносится из чеков только при закрытии
    // смены. Тогда ищем его в строках отчёта о розничных продажах.
    if (!grouped.size) {
      const reportResult = customRange
        ? await loadReportPagesByRangeCached({ limit: null, from, to })
        : await loadConsultantReportPagesLegacyCached({ limit: 500, days });
      // Совместимый источник уже применяет период на стороне 1С, а при отказе
      // фильтра 1С возвращает доступные отчёты целиком. Повторная локальная
      // фильтрация исключала старые строки с заполненными продавцами.
      reports = reportResult.items;
      cache = reportResult.cache;
      latestDate = reports[0]?.Date || latestDate;
      source = "Document_ОтчетОРозничныхПродажах.Товары.Продавец_Key";

      reports.forEach((report) => {
        (report.Товары || []).forEach((line) =>
          addLine({
            storeKey: report.Магазин_Key,
            line,
            sign: 1,
            documentSellerKey: null,
            origin: "retail-report",
            documentDate: report.Date,
            orderKey: line.ЗаказПокупателя_Key,
          }),
        );
        (report.ВозвращенныеТовары || []).forEach((line) =>
          addLine({
            storeKey: report.Магазин_Key,
            line,
            sign: -1,
            documentSellerKey: null,
            origin: "retail-report",
            documentDate: report.Date,
            orderKey: line.ЗаказПокупателя_Key,
          }),
        );
      });
    }

    const items = [...grouped.values()].map(({ _checkKeys, ...item }) => ({
      ...item,
      Чеков: _checkKeys.size,
      ИдентификаторыЧеков: [..._checkKeys],
    })).sort(
      (left, right) => right.СтоимостьTurnover - left.СтоимостьTurnover,
    );
    const fallbackDates = !customRange && reports.length
      ? items.flatMap((item) => Object.keys(item.ПродажиПоДатам || {})).sort()
      : [];
    const consultants = await loadReferencesByKeysBatched(
      "Catalog_ФизическиеЛица",
      items.map((item) => item.Продавец_Key),
      "Ref_Key,Description,Сотрудник,Магазин_Key",
    );
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
        periodStart: customRange ? new Date(rangeStart).toISOString() : fallbackDates[0] || null,
        periodEnd: customRange ? new Date(rangeEnd).toISOString() : fallbackDates.at(-1) || null,
        scope: fallbackDates.length ? "all" : "period",
        channel,
        loaded: items.length,
        latestDate: latestDate ? normalizeOnecDateTime(latestDate) : null,
        freshness: describeDataFreshness(latestDate),
        source,
        cache,
        diagnostics: {
          scannedChecks,
          checkLines,
          checkLinesWithConsultant,
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
        freshness: describeDataFreshness(effectiveLatestDate),
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

async function buildMarginPayload(query) {
  const from = typeof query.from === "string" ? query.from : "";
  const to = typeof query.to === "string" ? query.to : "";
  const hasCustomRange =
    /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to);
  const days = [1, 7, 30, 90].includes(Number(query.days))
    ? Number(query.days)
    : 30;
  const storeKey = typeof query.storeKey === "string"
    ? query.storeKey
    : "all";
  const channel = parseSalesChannel(query.channel);
  const includePrevious = query.includePrevious !== "false";

  let currentFrom;
  let currentTo;

  if (hasCustomRange) {
    currentFrom = new Date(parseOnecDateTime(`${from}T00:00:00`));
    currentTo = new Date(parseOnecDateTime(`${to}T23:59:59`) + 1000);
  } else {
    const latest = await onecGet("AccumulationRegister_Продажи_RecordType", {
      $top: 20,
      $select: "Period",
      $filter: "Active eq true",
      $orderby: "Period desc",
    });
    if (!latest.length) {
      return ({
        items: {
          current: summarizeMarginRows([]),
          previous: summarizeMarginRows([]),
        },
        meta: { source: "AccumulationRegister_Продажи/Turnovers" },
      });
    }
    const activity = resolveActivityAnchor(latest, "Period");
    const anchor = activity.anchorDate;
    const dayStart = startOfOnecDay(anchor);
    currentFrom = new Date(dayStart - (days - 1) * 86_400_000);
    currentTo = new Date(dayStart + 86_400_000);
  }

  const duration = currentTo.getTime() - currentFrom.getTime();
  const previousTo = new Date(currentFrom.getTime());
  const previousFrom = new Date(previousTo.getTime() - duration);

  const currentPromise = loadMarginPeriod(
    currentFrom,
    currentTo,
    storeKey,
    channel,
  );
  const previousPromise = includePrevious
    ? loadMarginPeriod(previousFrom, previousTo, storeKey, channel)
    : Promise.resolve(summarizeMarginRows([]));
  const [current, previous] = await Promise.all([
    currentPromise,
    previousPromise,
  ]);

  return ({
    items: { current, previous },
    meta: {
      source: "AccumulationRegister_Продажи/Turnovers",
      revenueField: "СтоимостьTurnover",
      revenueBeforeDiscountField: "СтоимостьБезСкидокTurnover",
      costSource: current.costSource,
      previousCostSource: previous.costSource,
      calculation:
        "profit = revenue - cost; " +
        "marginPercent = profit / revenue * 100; " +
        "efficiencyPercent = profit / cost * 100",
      storeKey,
      channel,
      periodStart: currentFrom.toISOString(),
      periodEnd: currentTo.toISOString(),
    },
  });
}

app.get("/api/dashboard/onec-margin", analyticsHandler("margin"));

app.get("/api/dashboard/onec-stock", async (request, response) => {
  try {
    const operationsOnly = request.query.operationsOnly === "true";
    const from = typeof request.query.from === "string" ? request.query.from : "";
    const to = typeof request.query.to === "string" ? request.query.to : "";
    const hasRange = Boolean(from || to);
    if (hasRange && (!/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)) {
      return response.status(400).json({ message: "Некорректный диапазон дат склада" });
    }
    const rangeFrom = hasRange ? parseOnecDateTime(`${from}T00:00:00`) : null;
    const rangeTo = hasRange ? parseOnecDateTime(`${to}T00:00:00`) + 86_400_000 : null;
    if (hasRange && (!Number.isFinite(rangeFrom) || !Number.isFinite(rangeTo) ||
      rangeTo - rangeFrom > 366 * 86_400_000)) {
      return response.status(400).json({ message: "Некорректный диапазон дат склада" });
    }
    const top = Math.min(
      Math.max(Number(request.query.top) || 5000, 1),
      10000,
    );
    const balancePeriod = hasRange
      ? new Date(rangeTo - 1)
      : request.query.period
      ? new Date(String(request.query.period))
      : new Date();
    const balances = operationsOnly ? [] : await onecBalance(
      "AccumulationRegister_ТоварыНаСкладах",
      {
        period: balancePeriod,
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

    const loadOperation = async (entity, select, top) => {
      const dateFilter = [
        "Posted eq true",
        `Date ge datetime'${toOdataDateTime(rangeFrom)}'`,
        `Date lt datetime'${toOdataDateTime(rangeTo)}'`,
      ].join(" and ");
      const query = (filter, pageTop, skip = 0) => onecGet(entity, {
        $top: pageTop,
        $skip: skip,
        $select: select.join(","),
        $filter: filter,
        $orderby: "Date desc",
      });
      if (!hasRange) return query("Posted eq true", top);

      async function loadPages(filter) {
        const items = [];
        const pageSize = 100;
        const maxRows = 500;
        while (items.length < maxRows) {
          const page = await query(filter, pageSize, items.length);
          items.push(...page);
          if (page.length < pageSize) return items;
        }
        if ((await query(filter, 1, items.length)).length) {
          throw new Error(`Слишком много документов ${entity}: выборка превышает 500 записей`);
        }
        return items;
      }

      let items;
      try {
        items = await loadPages(dateFilter);
      } catch (error) {
        if (!/WHERE|Date|ORDER BY|datetime/i.test(String(error?.message || ""))) throw error;
        console.warn(`1С не приняла фильтр дат для ${entity}; проверяем документы локально`);
        items = await loadPages("Posted eq true");
      }
      return filterByPeriod(items, "Date", new Date(rangeFrom), new Date(rangeTo - 1));
    };
    const operationRequests = await Promise.allSettled([
      loadOperation("Document_ПоступлениеТоваров", [
          "Ref_Key", "Number", "Date", "Posted", "Контрагент_Key",
          "Склад_Key", "СуммаДокумента", "Товары",
        ], 60),
      loadOperation("Document_СписаниеТоваров", [
          "Ref_Key", "Number", "Date", "Posted", "Склад_Key",
          "ОснованиеСписания", "Комментарий", "Товары",
        ], 30),
      loadOperation("Document_ПересчетТоваров", [
          "Ref_Key", "Number", "Date", "Posted", "Склад_Key", "Статус", "Товары",
        ], 30),
      loadOperation("Document_ПеремещениеТоваров", [
          "Ref_Key", "Number", "Date", "Posted", "СкладОтправитель_Key",
          "СкладПолучатель_Key", "Товары",
        ], 60),
    ]);
    const [receiptResult, writeOffResult, recountResult, transferResult] = operationRequests;
    const receipts = receiptResult.status === "fulfilled" ? receiptResult.value : [];
    const writeOffs = writeOffResult.status === "fulfilled" ? writeOffResult.value : [];
    const recounts = recountResult.status === "fulfilled" ? recountResult.value : [];
    const transfers = transferResult.status === "fulfilled" ? transferResult.value : [];
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
      transfers:
        transferResult.status === "rejected"
          ? transferResult.reason?.message || "Источник недоступен"
          : "",
    };

    const operationLines = [...receipts, ...writeOffs, ...recounts, ...transfers].flatMap(
      (document) => document.Товары || [],
    );
    const productKeys = operationsOnly ? [] : [
      ...balances.map((item) => item.Номенклатура_Key),
      ...operationLines.map((item) => item.Номенклатура_Key),
    ];
    const warehouseKeys = balances.map((item) => item.Склад_Key);
    warehouseKeys.push(
      ...[...receipts, ...writeOffs, ...recounts].map(
        (document) => document.Склад_Key,
      ),
      ...transfers.flatMap((document) => [
        document.СкладОтправитель_Key, document.СкладПолучатель_Key,
      ]),
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
          "Parent_Key",
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
      ).catch((error) => {
        if (!operationsOnly) throw error;
        console.warn("Не удалось загрузить контрагентов для документов склада:", error);
        return [];
      }),
      operationsOnly ? Promise.resolve([]) : loadProductKindsCatalog(),
    ]);
    const productSubcategories = operationsOnly ? [] : await loadProductSubcategories(rawProducts);
    const products = enrichProductsWithBusinessCategories(
      rawProducts,
      productKinds,
      productSubcategories,
    );
    const categories = publicBusinessCategories();
    const latestOperationTimestamp = Math.max(
      ...[...receipts, ...writeOffs, ...recounts, ...transfers]
        .map((document) => parseOnecDateTime(document.Date))
        .filter(Number.isFinite),
      0,
    );
    const latestOperationDate = latestOperationTimestamp
      ? new Date(latestOperationTimestamp).toISOString()
      : null;

    response.json({
      items: balances,
      references: {
        products,
        warehouses,
        categories,
        productKinds,
        subcategories: productSubcategories,
        suppliers,
      },
      operations: { receipts, writeOffs, recounts, transfers },
      meta: {
        loaded: balances.length,
        requestedAt: new Date().toISOString(),
        asOf: balancePeriod.toISOString(),
        balancePeriod: balancePeriod.toISOString(),
        latestOperationDate,
        operationFreshness: describeDataFreshness(latestOperationDate),
        source: operationsOnly
          ? "Document_ПоступлениеТоваров, Document_ПеремещениеТоваров"
          : "AccumulationRegister_ТоварыНаСкладах/Balance",
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

async function buildReportsPayload(query) {
  const maxTop = Math.min(
    Math.max(Number(process.env.ONEC_REPORT_MAX_TOP) || 5000, 1),
    10000,
  );
  const requestedTop = Math.min(
    Math.max(Number(query.top) || 1, 1),
    maxTop,
  );
  const days = Math.min(
    Math.max(Number(query.days) || 60, 1),
    365,
  );
  const from = typeof query.from === "string" ? query.from : "";
  const to = typeof query.to === "string" ? query.to : "";
  const hasCustomRange =
    /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to);

  const startedAt = Date.now();
  const reportResult = hasCustomRange
    ? await loadReportPagesByRangeCached({
        limit: null,
        from,
        to,
      })
    : await loadReportPagesCached({
        limit: requestedTop + 1,
        days,
      });
  const reportLoadMs = Date.now() - startedAt;
  const uniqueItems = uniqueReports(reportResult.items);
  const truncated = hasCustomRange
    ? false
    : reportResult.items.length > requestedTop;
  const items = uniqueItems
    .slice(0, hasCustomRange ? undefined : requestedTop)
    .map((report) => ({
      ...report,
      Date: normalizeOnecDateTime(report.Date),
    }));
  const latestDate = items[0]?.Date || null;
  const commonMeta = {
    loaded: items.length,
    uniqueDocuments: uniqueItems.length,
    duplicatesRemoved: reportResult.items.length - uniqueItems.length,
    days: hasCustomRange ? undefined : days,
    from: hasCustomRange ? from : undefined,
    to: hasCustomRange ? to : undefined,
    latestDate,
    freshness: describeDataFreshness(latestDate),
    truncated,
    cache: reportResult.cache,
    durationMs: Date.now() - startedAt,
    reportLoadMs,
  };

  if (query.references === "false") {
    return ({
      items,
      references: {
        products: [],
        warehouses: [],
        categories: [],
      },
      meta: {
        ...commonMeta,
        referencesLoaded: false,
      },
    });
  }

  const productKeys = items.flatMap((report) =>
    [...(report.Товары || []), ...(report.ВозвращенныеТовары || [])].map(
      (line) => line.Номенклатура_Key,
    ),
  );
  const warehouseKeys = items.flatMap((report) =>
    [...(report.Товары || []), ...(report.ВозвращенныеТовары || [])].map(
      (line) => line.Склад_Key,
    ),
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
        "Parent_Key",
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
  const productSubcategories = await loadProductSubcategories(rawProducts);
  const products = enrichProductsWithBusinessCategories(
    rawProducts,
    productKinds,
    productSubcategories,
  );
  const referenceLoadMs = Date.now() - startedAt - reportLoadMs;
  const categories = publicBusinessCategories();

  return ({
    items: query.references === "only" ? [] : items,
    references: {
      products,
      warehouses,
      categories,
      productKinds,
      subcategories: productSubcategories,
    },
    meta: {
      ...commonMeta,
      referencesLoaded: true,
      referenceLoadMs,
      durationMs: Date.now() - startedAt,
    },
  });
}

app.get("/api/dashboard/onec-reports", analyticsHandler("reports"));

app.get("/api/dashboard/onec-check-analytics", async (request, response) => {
  try {
    const days = [1, 7, 30, 90].includes(Number(request.query.days))
      ? Number(request.query.days)
      : 30;
    const limit = Math.min(
      Math.max(
        Number(request.query.limit) ||
          Number(process.env.ONEC_CHECK_ANALYTICS_LIMIT || 20_000),
        100,
      ),
      50_000,
    );
    const from = typeof request.query.from === "string" ? request.query.from : "";
    const to = typeof request.query.to === "string" ? request.query.to : "";
    const hasCustomRange =
      /^\d{4}-\d{2}-\d{2}$/.test(from) &&
      /^\d{4}-\d{2}-\d{2}$/.test(to);
    const includePrevious = request.query.includePrevious !== "false";
    const startedAt = Date.now();
    // Checks should not wait for a full report scan. Reuse reports only when
    // the reports endpoint already fetched them for this exact range.
    const reportCacheEntry = hasCustomRange
      ? reportCache.get(`range:all:${from}:${to}`)
      : null;
    const reportRecords = reportCacheEntry?.items &&
      reportCacheEntry.expiresAt > Date.now()
      ? uniqueReports(reportCacheEntry.items)
      : [];
    const analytics = hasCustomRange
      ? await loadCheckAnalyticsRange({
          from,
          to,
          limit,
          includePrevious,
          reportRecords,
        })
      : await loadCheckAnalytics({ days, limit, includePrevious });

    response.json({
      items: analytics,
      meta: {
        days: hasCustomRange ? undefined : days,
        from: hasCustomRange ? from : undefined,
        to: hasCustomRange ? to : undefined,
        loaded: analytics.loaded,
        latestDate: analytics.latestDate,
        absoluteLatestDate: analytics.absoluteLatestDate,
        analysisAnchorAdjusted: analytics.analysisAnchorAdjusted,
        ignoredIsolatedDocuments: analytics.ignoredIsolatedDocuments,
        freshness: describeDataFreshness(analytics.latestDate),
        truncated: analytics.truncated,
        cache: analytics.cache,
        durationMs: Date.now() - startedAt,
        source: analytics.source || "Document_ЧекККМ",
        requestedReports: analytics.requestedReports,
        matchedReports: analytics.matchedReports,
        failedReports: analytics.failedReports,
        documentTypes: analytics.documentTypes,
        scannedChecks: analytics.scannedChecks,
      },
    });
  } catch (error) {
    console.error("Ошибка загрузки аналитики чеков 1С:", error);
    response.status(502).json({
      message:
        error instanceof Error
          ? error.message
          : "Не удалось получить аналитику чеков из 1С",
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

await initializeAuth();

if (authStore.countUsers() === 0) {
  console.warn(
    "В базе авторизации нет пользователей. Выполните npm run auth:create-user",
  );
}

app.listen(port, () => {
  console.log(`3КВАДРАТА API: http://localhost:${port}`);
  warmLocalAnalytics();
  if (localAnalytics) {
    const timer = setInterval(() => {
      warmLocalAnalytics();
      localAnalytics.refreshRecent();
    }, localAnalytics.refreshMs);
    timer.unref();
  }
});
