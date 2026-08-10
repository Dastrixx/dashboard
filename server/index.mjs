import cors from "cors";
import express from "express";
import { dashboardData } from "./data.mjs";
import { onecGet, onecGetByKey, onecMetadata } from "./onec.mjs";

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

const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  for (let index = 0; index < uniqueKeys.length; index += 5) {
    const chunk = uniqueKeys.slice(index, index + 5);
    const chunkResults = await Promise.all(
      chunk.map(async (key) => {
        try {
          return await onecGetByKey(entity, key, {
            $select: select,
          });
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

app.get("/api/dashboard/onec-reports", async (request, response) => {
  try {
    const top = Math.min(
      Math.max(Number(request.query.top) || 1, 1),
      10,
    );

    const items = await onecGet(
      "Document_ОтчетОРозничныхПродажах",
      {
        $top: top,
        $select: [
          "Ref_Key",
          "Number",
          "Date",
          "Posted",
          "СуммаДокумента",
          "СуммаВозвратов",
          "Магазин_Key",
          "КассаККМ_Key",
          "Товары",
        ].join(","),
        $orderby: "Date desc",
      },
    );

    if (request.query.references === "false") {
      return response.json({
        items,
        references: {
          products: [],
          warehouses: [],
        },
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

    response.json({
      items,
      references: {
        products,
        warehouses,
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
