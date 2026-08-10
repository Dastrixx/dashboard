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

app.get("/api/dashboard/onec-sellers", async (request, response) => {
  try {
    const days = [1, 7, 30].includes(Number(request.query.days))
      ? Number(request.query.days)
      : 30;
    const latestRecords = await onecGet(
      "AccumulationRegister_Продажи_RecordType",
      {
        $top: 1,
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

    const latestDate = new Date(latestRecords[0].Period);
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
    let validItems = items.filter(
      (item) =>
        item.Продавец_Key &&
        item.Продавец_Key !== "00000000-0000-0000-0000-000000000000",
    );
    let effectiveLatestDate = latestDate;
    let source = "AccumulationRegister_Продажи/Turnovers";
    let scannedChecks = 0;

    if (!validItems.length) {
      const latestChecks = await onecGet("Document_ЧекККМ", {
        $top: 1,
        $select: "Date",
        $filter: "Posted eq true",
        $orderby: "Date desc",
      });

      if (latestChecks.length) {
        effectiveLatestDate = new Date(latestChecks[0].Date);
        const checkStartDate = new Date(
          effectiveLatestDate.getTime() - days * 86_400_000,
        );
        const select = [
          "Ref_Key",
          "Date",
          "Posted",
          "ВидОперации",
          "Магазин_Key",
          "Продавец_Key",
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

        scannedChecks = checks.length;
        const groupedChecks = new Map();
        const addTurnover = ({ sellerKey, storeKey, quantity, revenue, fullPrice }) => {
          if (!sellerKey || sellerKey === "00000000-0000-0000-0000-000000000000") {
            return;
          }
          const key = `${sellerKey}:${storeKey}`;
          const current = groupedChecks.get(key) || {
            Продавец_Key: sellerKey,
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
          if (!lines.length) {
            addTurnover({
              sellerKey: check.Продавец_Key,
              storeKey: check.Магазин_Key,
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
            addTurnover({
              sellerKey:
                line.Продавец_Key && line.Продавец_Key !== "00000000-0000-0000-0000-000000000000"
                  ? line.Продавец_Key
                  : check.Продавец_Key,
              storeKey: check.Магазин_Key,
              quantity: sign * Number(line.Количество || 0),
              revenue: sign * revenue,
              fullPrice: sign * (revenue + discounts),
            });
          });
        });

        validItems = [...groupedChecks.values()];
        source = "Document_ЧекККМ (fallback)";
      }
    }
    const sellers = await loadReferencesByKeysBatched(
      "Catalog_ФизическиеЛица",
      validItems.map((item) => item.Продавец_Key),
      "Ref_Key,Description,Магазин_Key",
    );
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
        source,
        diagnostics: {
          turnoverRows: items.length,
          turnoverRowsWithSeller: items.filter(
            (item) =>
              item.Продавец_Key &&
              item.Продавец_Key !== "00000000-0000-0000-0000-000000000000",
          ).length,
          scannedChecks,
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
    const [products, warehouses, suppliers] = await Promise.all([
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
      loadReferencesByKeysBatched(
        "Catalog_Контрагенты",
        receipts.map((item) => item.Контрагент_Key),
        "Ref_Key,Code,Description,НаименованиеПолное",
      ),
    ]);
    const categories = await loadReferencesByKeysBatched(
      "Catalog_ТоварныеГруппы",
      products.map((item) => item.ТоварнаяГруппа_Key),
      "Ref_Key,Code,Description",
    );

    response.json({
      items: balances,
      references: { products, warehouses, categories, suppliers },
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
