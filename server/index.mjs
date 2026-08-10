import cors from "cors";
import express from "express";
import { dashboardData } from "./data.mjs";
import {
  onecBalance,
  onecGet,
  onecGetByKey,
  onecMetadata,
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

const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
].join(",");

function toOdataDateTime(timestamp) {
  return new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, "");
}

async function loadReportPages({ limit, days }) {
  const configuredPageSize = Number(process.env.ONEC_PAGE_SIZE || 25);
  const pageSize = Math.min(Math.max(configuredPageSize, 1), 100);

  const latest = await onecGet(RETAIL_REPORT_ENTITY, {
    $top: 1,
    $select: "Date",
    $filter: "Posted eq true",
    $orderby: "Date desc",
  });

  if (!latest.length) {
    return [];
  }

  const latestTimestamp = new Date(latest[0].Date).getTime();
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

  try {
    return await load(dateFilter);
  } catch (error) {
    console.warn(
      "1С не приняла фильтр по дате, используем постраничную загрузку:",
      error instanceof Error ? error.message : error,
    );
    return load("Posted eq true");
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
  const result = [];
  const missing = [];

  uniqueKeys.forEach((key) => {
    const cached = referenceCache.get(`${entity}:${key}`);
    if (cached) result.push(cached);
    else missing.push(key);
  });

  for (let index = 0; index < missing.length; index += 15) {
    const chunk = missing.slice(index, index + 15);
    const filter = chunk
      .map((key) => `Ref_Key eq guid'${key}'`)
      .join(" or ");

    try {
      const items = await onecGet(entity, {
        $top: chunk.length,
        $select: select,
        $filter: filter,
      });

      for (const item of items) {
        referenceCache.set(`${entity}:${item.Ref_Key}`, item);
        result.push(item);
      }
    } catch (error) {
      console.warn(
        `1С не приняла пакетный запрос ${entity}, используем запросы по ключам:`,
        error instanceof Error ? error.message : error,
      );
      result.push(...(await loadReferencesByKeys(entity, chunk, select)));
    }
  }

  return result;
}

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

    const productKeys = balances.map((item) => item.Номенклатура_Key);
    const warehouseKeys = balances.map((item) => item.Склад_Key);
    const [products, warehouses] = await Promise.all([
      loadReferencesByKeysBatched(
        "Catalog_Номенклатура",
        productKeys,
        [
          "Ref_Key",
          "Code",
          "Description",
          "НаименованиеПолное",
          "Артикул",
          "ТоварнаяГруппа_Key",
        ].join(","),
      ),
      loadReferencesByKeysBatched(
        "Catalog_Склады",
        warehouseKeys,
        "Ref_Key,Code,Description,ТипСклада,Магазин_Key",
      ),
    ]);
    const categories = await loadReferencesByKeysBatched(
      "Catalog_ТоварныеГруппы",
      products.map((item) => item.ТоварнаяГруппа_Key),
      "Ref_Key,Code,Description",
    );

    response.json({
      items: balances,
      references: { products, warehouses, categories },
      meta: {
        loaded: balances.length,
        asOf: new Date().toISOString(),
        source: "AccumulationRegister_ТоварыНаСкладах/Balance",
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

    const items = await loadReportPages({ limit: top, days });

    if (request.query.references === "false") {
      return response.json({
        items,
        references: {
          products: [],
          warehouses: [],
          categories: [],
        },
        meta: { loaded: items.length, days },
      });
    }

    const productKeys = items.flatMap((report) =>
      (report.Товары || []).map((line) => line.Номенклатура_Key),
    );
    const warehouseKeys = items.flatMap((report) =>
      (report.Товары || []).map((line) => line.Склад_Key),
    );

    const [products, warehouses] = await Promise.all([
      loadReferencesByKeys(
        "Catalog_Номенклатура",
        productKeys,
        [
          "Ref_Key",
          "Code",
          "Description",
          "НаименованиеПолное",
          "Артикул",
          "ТоварнаяГруппа_Key",
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
    ]);

    const categoryKeys = products.map(
      (product) => product.ТоварнаяГруппа_Key,
    );
    const categories = await loadReferencesByKeys(
      "Catalog_ТоварныеГруппы",
      categoryKeys,
      "Ref_Key,Code,Description",
    );

    response.json({
      items,
      references: {
        products,
        warehouses,
        categories,
      },
      meta: { loaded: items.length, days },
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
