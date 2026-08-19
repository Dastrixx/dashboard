"use client";

import { useEffect, useMemo, useState } from "react";

type AnalyticsPeriod = "day" | "week" | "month";

type OnecProductLine = {
  LineNumber: string;
  Номенклатура_Key: string;
  Количество: number;
  Цена: number;
  Сумма: number;
  Склад_Key: string;
  Продавец_Key: string;
};

type OnecRetailReport = {
  Ref_Key: string;
  Number: string;
  Date: string;
  Posted: boolean;
  СуммаДокумента: number;
  СуммаВозвратов: number;
  Магазин_Key: string;
  КассаККМ_Key: string;
  Товары: OnecProductLine[];
};

type OnecProductReference = {
  Ref_Key: string;
  Code: string;
  Description: string;
  НаименованиеПолное: string;
  Артикул: string;
  ВидНоменклатуры_Key: string;
  ВидНоменклатуры?: string | null;
  BusinessCategory_Key?: string | null;
  BusinessCategory?: string | null;
};

type OnecWarehouseReference = {
  Ref_Key: string;
  Code: string;
  Description: string;
  ТипСклада: string;
  Магазин_Key: string;
};

type OnecCategoryReference = {
  Ref_Key: string;
  Code?: string;
  Description: string;
};

type OnecResponse = {
  items: OnecRetailReport[];
  references: {
    products: OnecProductReference[];
    warehouses: OnecWarehouseReference[];
    categories: OnecCategoryReference[];
  };
  meta?: {
    loaded?: number;
    days?: number;
    cache?: "hit" | "miss" | "shared";
    durationMs?: number;
    referencesLoaded?: boolean;
  };
  message?: string;
};

type ProductRow = {
  key: string;
  article: string;
  name: string;
  category: string;
  revenue: number;
  sold: number;
  share: number;
  abc: "A" | "B" | "C";
};

const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "";
const DAY_MS = 86_400_000;
const TABLE_PAGE_SIZE = 20;

const PERIODS: Record<
  AnalyticsPeriod,
  { label: string; days: number; caption: string }
> = {
  day: { label: "День", days: 1, caption: "за день" },
  week: { label: "Неделя", days: 7, caption: "за неделю" },
  month: { label: "Месяц", days: 30, caption: "за 30 дней" },
};

const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "KGS",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
});

const compactNumber = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const shortDate = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
});

function inRange(value: string, from: number, to: number) {
  const timestamp = new Date(value).getTime();
  return timestamp >= from && timestamp <= to;
}

function buildProductRows(
  sourceReports: OnecRetailReport[],
  products: OnecProductReference[],
  categories: OnecCategoryReference[],
) {
  const productByKey = new Map(
    products.map((product) => [product.Ref_Key, product]),
  );
  const categoryByKey = new Map(
    categories.map((item) => [item.Ref_Key, item.Description]),
  );
  const aggregate = new Map<string, { revenue: number; sold: number }>();

  sourceReports
    .flatMap((report) => report.Товары || [])
    .forEach((line) => {
      const current = aggregate.get(line.Номенклатура_Key) || {
        revenue: 0,
        sold: 0,
      };
      current.revenue += Number(line.Сумма || 0);
      current.sold += Number(line.Количество || 0);
      aggregate.set(line.Номенклатура_Key, current);
    });

  const totalRevenue =
    [...aggregate.values()].reduce((sum, item) => sum + item.revenue, 0) || 1;
  let cumulative = 0;

  return [...aggregate.entries()]
    .map(([key, value]) => {
      const product = productByKey.get(key);

      return {
        key,
        article: product?.Артикул || product?.Code || "—",
        name:
          product?.Description ||
          product?.НаименованиеПолное ||
          "Название не найдено",
        category:
          product?.BusinessCategory ||
          categoryByKey.get(product?.BusinessCategory_Key || "") ||
          "Не классифицировано",
        revenue: value.revenue,
        sold: value.sold,
        share: 0,
        abc: "C" as const,
      };
    })
    .sort((left, right) => right.revenue - left.revenue)
    .map((row): ProductRow => {
      const share = (row.revenue / totalRevenue) * 100;
      cumulative += share;

      return {
        ...row,
        share,
        abc: cumulative <= 80 ? "A" : cumulative <= 95 ? "B" : "C",
      };
    });
}

function downloadRankingCsv(filename: string, rows: ProductRow[]) {
  const escape = (value: string | number) =>
    `"${String(value).replaceAll('"', '""')}"`;
  const csv = [
    ["Артикул", "Товар", "Категория", "Выручка, сом", "Продано"],
    ...rows.map((row) => [
      row.article,
      row.name,
      row.category,
      row.revenue,
      row.sold,
    ]),
  ]
    .map((line) => line.map(escape).join(";"))
    .join("\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function OnecSales() {
  const [reports, setReports] = useState<OnecRetailReport[]>([]);
  const [products, setProducts] = useState<OnecProductReference[]>([]);
  const [warehouses, setWarehouses] = useState<OnecWarehouseReference[]>([]);
  const [categories, setCategories] = useState<OnecCategoryReference[]>([]);
  const [period, setPeriod] = useState<AnalyticsPeriod>("month");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const [rankingPeriod, setRankingPeriod] = useState<AnalyticsPeriod>("month");
  const [rankingCategory, setRankingCategory] = useState("");
  const [topLimit, setTopLimit] = useState(10);
  const [antiLimit, setAntiLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [referenceError, setReferenceError] = useState("");
  const [loadMeta, setLoadMeta] = useState<OnecResponse["meta"]>();

  useEffect(() => {
    const controller = new AbortController();

    async function loadReports() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          `${API_URL}/api/dashboard/onec-reports?top=500&days=60&references=false`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as Partial<OnecResponse>;

        if (!response.ok) {
          throw new Error(data.message || `Ошибка HTTP ${response.status}`);
        }

        setReports(
          Array.isArray(data.items)
            ? data.items.filter((item) => item.Posted)
            : [],
        );
        setLoadMeta(data.meta);
        setLoading(false);

        setReferencesLoading(true);
        setReferenceError("");

        try {
          const referenceResponse = await fetch(
            `${API_URL}/api/dashboard/onec-reports?top=500&days=60`,
            { signal: controller.signal },
          );
          const referenceData =
            (await referenceResponse.json()) as Partial<OnecResponse>;

          if (!referenceResponse.ok) {
            throw new Error(
              referenceData.message ||
                `Ошибка HTTP ${referenceResponse.status}`,
            );
          }

          setProducts(
            Array.isArray(referenceData.references?.products)
              ? referenceData.references.products
              : [],
          );
          setWarehouses(
            Array.isArray(referenceData.references?.warehouses)
              ? referenceData.references.warehouses
              : [],
          );
          setCategories(
            Array.isArray(referenceData.references?.categories)
              ? referenceData.references.categories
              : [],
          );
          setLoadMeta(referenceData.meta);
        } catch (referenceLoadError) {
          if (
            referenceLoadError instanceof DOMException &&
            referenceLoadError.name === "AbortError"
          ) {
            return;
          }

          setReferenceError(
            referenceLoadError instanceof Error
              ? referenceLoadError.message
              : "Не удалось получить названия товаров",
          );
        } finally {
          setReferencesLoading(false);
        }
      } catch (loadError) {
        if (
          loadError instanceof DOMException &&
          loadError.name === "AbortError"
        ) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось загрузить данные 1С",
        );
      } finally {
        setLoading(false);
      }
    }

    loadReports();
    return () => controller.abort();
  }, []);

  const analytics = useMemo(() => {
    const latestTimestamp = Math.max(
      ...reports.map((report) => new Date(report.Date).getTime()),
      0,
    );

    if (!latestTimestamp) return null;

    const duration = PERIODS[period].days * DAY_MS;
    const currentFrom = latestTimestamp - duration + 1;
    const previousTo = currentFrom - 1;
    const previousFrom = previousTo - duration + 1;

    const currentReports = reports.filter((report) =>
      inRange(report.Date, currentFrom, latestTimestamp),
    );
    const previousReports = reports.filter((report) =>
      inRange(report.Date, previousFrom, previousTo),
    );

    const revenue = currentReports.reduce(
      (sum, report) => sum + Number(report.СуммаДокумента || 0),
      0,
    );
    const previousRevenue = previousReports.reduce(
      (sum, report) => sum + Number(report.СуммаДокумента || 0),
      0,
    );
    const lines = currentReports.flatMap((report) => report.Товары || []);
    const sold = lines.reduce(
      (sum, line) => sum + Number(line.Количество || 0),
      0,
    );

    const rows = buildProductRows(currentReports, products, categories);
    const categoryMap = new Map<string, number>(
      categories.map((item) => [item.Description, 0]),
    );
    rows.forEach((row) => {
      if (!categoryMap.has(row.category)) return;
      categoryMap.set(
        row.category,
        (categoryMap.get(row.category) || 0) + row.revenue,
      );
    });
    const categorizedRevenue =
      [...categoryMap.values()].reduce((sum, value) => sum + value, 0) || 1;
    const categoryRows = [...categoryMap.entries()]
      .map(([label, value]) => ({
        label,
        value,
        share: (value / categorizedRevenue) * 100,
      }))
      .sort((left, right) => right.value - left.value);

    const bucketCount = period === "day" ? 6 : period === "week" ? 7 : 30;
    const bucketSize = duration / bucketCount;

    const makeBuckets = (source: OnecRetailReport[], rangeStart: number) =>
      Array.from({ length: bucketCount }, (_, index) => ({
        label:
          period === "month"
            ? shortDate.format(new Date(rangeStart + index * bucketSize))
            : period === "week"
              ? shortDate.format(new Date(rangeStart + index * bucketSize))
              : `${index * 4}–${(index + 1) * 4}ч`,
        value: 0,
      })).map((bucket, index, buckets) => {
        source.forEach((report) => {
          const reportTime = new Date(report.Date).getTime();
          const bucketIndex = Math.min(
            Math.floor((reportTime - rangeStart) / bucketSize),
            buckets.length - 1,
          );
          if (bucketIndex === index) {
            bucket.value += Number(report.СуммаДокумента || 0);
          }
        });
        return bucket;
      });

    return {
      latestTimestamp,
      currentReports,
      revenue,
      previousRevenue,
      sold,
      averagePrice: sold ? revenue / sold : 0,
      activeSku: rows.length,
      rows,
      categoryRows,
      currentBuckets: makeBuckets(currentReports, currentFrom),
      previousBuckets: makeBuckets(previousReports, previousFrom),
      growth:
        previousRevenue > 0
          ? ((revenue - previousRevenue) / previousRevenue) * 100
          : null,
    };
  }, [categories, period, products, reports]);

  const rankingRows = useMemo(() => {
    const latestTimestamp = Math.max(
      ...reports.map((report) => new Date(report.Date).getTime()),
      0,
    );
    if (!latestTimestamp) return [];

    const from = latestTimestamp - PERIODS[rankingPeriod].days * DAY_MS + 1;
    const sourceReports = reports.filter((report) =>
      inRange(report.Date, from, latestTimestamp),
    );

    return buildProductRows(sourceReports, products, categories);
  }, [categories, products, rankingPeriod, reports]);

  const rankingCategories = useMemo(
    () =>
      categories
        .map((item) => item.Description)
        .filter((item) => rankingRows.some((row) => row.category === item)),
    [categories, rankingRows],
  );
  const filteredRankingRows = useMemo(
    () =>
      rankingRows.filter(
        (row) => !rankingCategory || row.category === rankingCategory,
      ),
    [rankingCategory, rankingRows],
  );
  const topRankingRows = filteredRankingRows.slice(0, topLimit);
  const antiRankingRows = [...filteredRankingRows]
    .sort(
      (left, right) => left.sold - right.sold || left.revenue - right.revenue,
    )
    .slice(0, antiLimit);

  const visibleRows = useMemo(() => {
    if (!analytics) return [];

    const normalizedQuery = query.trim().toLowerCase();

    return analytics.rows.filter(
      (row) =>
        (!category || row.category === category) &&
        (!normalizedQuery ||
          `${row.name} ${row.article}`.toLowerCase().includes(normalizedQuery)),
    );
  }, [analytics, category, query]);

  const tablePageCount = Math.max(
    1,
    Math.ceil(visibleRows.length / TABLE_PAGE_SIZE),
  );
  const currentTablePage = Math.min(tablePage, tablePageCount);
  const tableRows = visibleRows.slice(
    (currentTablePage - 1) * TABLE_PAGE_SIZE,
    currentTablePage * TABLE_PAGE_SIZE,
  );
  const firstVisibleRow = visibleRows.length
    ? (currentTablePage - 1) * TABLE_PAGE_SIZE + 1
    : 0;
  const lastVisibleRow = Math.min(
    currentTablePage * TABLE_PAGE_SIZE,
    visibleRows.length,
  );
  const firstPageButton = Math.max(
    1,
    Math.min(currentTablePage - 2, tablePageCount - 4),
  );
  const pageButtons = Array.from(
    { length: Math.min(5, tablePageCount) },
    (_, index) => firstPageButton + index,
  );

  if (loading) {
    return (
      <div className="page-stack">
        <section className="onec-state panel">
          <span className="onec-spinner" />
          <div>
            <strong>Формируем аналитику из 1С</strong>
            <p>Загружаем отчёты, номенклатуру и категории…</p>
          </div>
        </section>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-stack">
        <section className="onec-state onec-error panel">
          <div>
            <strong>Не удалось получить данные 1С</strong>
            <p>{error}</p>
          </div>
        </section>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="page-stack">
        <section className="onec-state panel">
          <div>
            <strong>Нет данных</strong>
            <p>1С не вернула проведённых отчётов о продажах.</p>
          </div>
        </section>
      </div>
    );
  }

  const maxChartValue = Math.max(
    ...analytics.currentBuckets.map((item) => item.value),
    ...analytics.previousBuckets.map((item) => item.value),
    1,
  );
  const chartWidth = 760;
  const chartHeight = 270;
  const chartPadding = 18;
  const makeChartPoints = (items: { label: string; value: number }[]) =>
    items.map((item, index) => ({
      ...item,
      x:
        chartPadding +
        (index / Math.max(items.length - 1, 1)) *
          (chartWidth - chartPadding * 2),
      y:
        chartHeight -
        chartPadding -
        (item.value / maxChartValue) * (chartHeight - chartPadding * 2),
    }));
  const currentChartPoints = makeChartPoints(analytics.currentBuckets);
  const previousChartPoints = makeChartPoints(analytics.previousBuckets);
  const abcSummary = (["A", "B", "C"] as const).map((group) => {
    const rows = analytics.rows.filter((row) => row.abc === group);
    return {
      group,
      count: rows.length,
      share: rows.reduce((sum, row) => sum + row.share, 0),
    };
  });
  const referencesReady =
    loadMeta?.referencesLoaded === true && !referenceError;

  return (
    <div
      className={`page-stack onec-product-analytics ${
        referencesReady ? "" : "references-pending"
      }`}
    >
      <section className="analytics-filter-bar">
        <div className="filter-copy">
          <span>Период анализа</span>
          <strong>{PERIODS[period].label}</strong>
        </div>
        <div className="period-switch" role="group" aria-label="Период анализа">
          {(Object.keys(PERIODS) as AnalyticsPeriod[]).map((key) => (
            <button
              key={key}
              className={period === key ? "active" : ""}
              onClick={() => {
                setPeriod(key);
                setTablePage(1);
              }}
            >
              {PERIODS[key].label}
            </button>
          ))}
        </div>
        <span className="onec-period-note">
          {referencesLoading
            ? "Аналитика готова · загружаем названия товаров…"
            : `Данные по состоянию на ${new Date(
                analytics.latestTimestamp,
              ).toLocaleDateString("ru-RU")}`}
        </span>
      </section>

      {referenceError && (
        <section className="onec-reference-warning" role="status">
          <strong>Продажи загружены, справочники временно недоступны.</strong>
          <span>{referenceError}</span>
        </section>
      )}

      <section className="kpi-grid product-kpis">
        <article className="kpi-card">
          <div className="kpi-top">
            <span>Выручка {PERIODS[period].caption}</span>
            {analytics.growth !== null && (
              <b className={analytics.growth >= 0 ? "trend" : "trend neutral"}>
                {analytics.growth >= 0 ? "+" : ""}
                {analytics.growth.toFixed(1)}%
              </b>
            )}
          </div>
          <strong>{money.format(analytics.revenue)}</strong>
          <p>по проведённым отчётам 1С</p>
        </article>

        <article className="kpi-card">
          <div className="kpi-top">
            <span>Продано</span>
          </div>
          <strong>{number.format(analytics.sold)} ед.</strong>
          <p>по товарным строкам документов</p>
        </article>

        <article className="kpi-card">
          <div className="kpi-top">
            <span>Средняя цена продажи</span>
          </div>
          <strong>{money.format(analytics.averagePrice)}</strong>
          <p>выручка на проданную единицу</p>
        </article>

        <article className="kpi-card">
          <div className="kpi-top">
            <span>Активных SKU</span>
          </div>
          <strong>{number.format(analytics.activeSku)}</strong>
          <p>были продажи за период</p>
        </article>
      </section>

      <section className="charts-grid onec-real-analysis-grid">
        <article className="panel onec-revenue-panel">
          <div className="panel-head">
            <div>
              <h2>Динамика выручки</h2>
              <p>{PERIODS[period].label} в сравнении с предыдущим периодом</p>
            </div>
            <div className="chart-key compact">
              <span>
                <i className="actual" />
                Текущий
              </span>
              <span>
                <i className="previous" />
                Предыдущий
              </span>
            </div>
          </div>

          <div className="onec-revenue-chart">
            <div className="onec-chart-maximum">
              <span>Максимум</span>
              <strong>{money.format(maxChartValue)}</strong>
            </div>
            <div className="onec-chart-y-axis" aria-hidden="true">
              <span>{compactNumber.format(maxChartValue)}</span>
              <span>{compactNumber.format(maxChartValue * 0.66)}</span>
              <span>{compactNumber.format(maxChartValue * 0.33)}</span>
              <span>0</span>
            </div>
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              role="img"
              aria-label="Динамика выручки текущего и предыдущего периода"
            >
              {[18, 96, 174, 252].map((y) => (
                <line
                  key={y}
                  className="onec-chart-gridline"
                  x1={chartPadding}
                  x2={chartWidth - chartPadding}
                  y1={y}
                  y2={y}
                />
              ))}
              <polyline
                className="onec-revenue-line previous"
                points={previousChartPoints
                  .map((point) => `${point.x},${point.y}`)
                  .join(" ")}
              />
              <polyline
                className="onec-revenue-line current"
                points={currentChartPoints
                  .map((point) => `${point.x},${point.y}`)
                  .join(" ")}
              />
              {currentChartPoints.map((point) => (
                <circle
                  key={point.label}
                  className="onec-revenue-point"
                  cx={point.x}
                  cy={point.y}
                  r="3"
                >
                  <title>
                    {point.label}: {money.format(point.value)}
                  </title>
                </circle>
              ))}
            </svg>
            <div className="onec-chart-x-axis" aria-hidden="true">
              <span>Начало</span>
              <span>Середина</span>
              <span>Сегодня</span>
            </div>
          </div>
        </article>

        <article className="panel onec-category-panel">
          <div className="panel-head">
            <div>
              <h2>Продажи по категориям</h2>
              <p>Структура выручки {PERIODS[period].caption}</p>
            </div>
          </div>
          <div className="onec-category-list">
            {analytics.categoryRows.map((item) => (
              <div key={item.label}>
                <div>
                  <strong>{item.label}</strong>
                  <span>
                    {item.share.toFixed(1)}% · {money.format(item.value)}
                  </span>
                </div>
                <i>
                  <b style={{ width: `${item.share}%` }} />
                </i>
              </div>
            ))}
            {!analytics.categoryRows.length && (
              <p className="onec-no-data">Нет категорий за выбранный период</p>
            )}
          </div>
        </article>
      </section>

      {referencesLoading && (
        <section
          className="panel onec-reference-skeleton"
          aria-busy="true"
          aria-label="Загрузка названий товаров"
        >
          <div className="panel-head">
            <div>
              <h2>Подготавливаем товары</h2>
              <p>Загружаем названия, артикулы и категории из 1С</p>
            </div>
            <span className="onec-spinner" />
          </div>
          <div className="onec-skeleton-list" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index}>
                <i />
                <span />
                <b />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="onec-ranking-section">
        <header className="onec-ranking-toolbar">
          <div>
            <span className="onec-source-kicker">Аналитика спроса</span>
            <h2>Рейтинг товаров</h2>
            <p>Выручка и количество продаж {PERIODS[rankingPeriod].caption}</p>
          </div>
          <div className="onec-ranking-filters">
            <label className="select-control">
              <select
                value={rankingCategory}
                onChange={(event) => {
                  setRankingCategory(event.target.value);
                  setTopLimit(10);
                  setAntiLimit(10);
                }}
              >
                <option value="">Все категории</option>
                {rankingCategories.map((item) => (
                  <option value={item} key={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <div
              className="period-switch"
              role="group"
              aria-label="Период рейтинга товаров"
            >
              {(Object.keys(PERIODS) as AnalyticsPeriod[]).map((key) => (
                <button
                  type="button"
                  key={key}
                  className={rankingPeriod === key ? "active" : ""}
                  onClick={() => {
                    setRankingPeriod(key);
                    setRankingCategory("");
                    setTopLimit(10);
                    setAntiLimit(10);
                  }}
                >
                  {PERIODS[key].label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="onec-ranking-grid">
          <article className="panel onec-ranking-card">
            <div className="panel-head">
              <div>
                <h2>Топ товаров по выручке</h2>
                <p>Что приносит основные деньги</p>
              </div>
              <div className="onec-ranking-actions">
                <button
                  type="button"
                  className="ranking-export"
                  disabled={!filteredRankingRows.length}
                  onClick={() =>
                    downloadRankingCsv(
                      `top-products-${rankingPeriod}.csv`,
                      filteredRankingRows,
                    )
                  }
                >
                  ↓ Выгрузить
                </button>
                <span className="tag green">ТОП</span>
              </div>
            </div>

            <div className="onec-rank-list">
              {topRankingRows.map((row, index) => (
                <div className="rank-row" key={row.key}>
                  <b>{index + 1}</b>
                  <div>
                    <strong>{row.name}</strong>
                    <span>
                      {row.article} · {number.format(row.sold)} ед.
                    </span>
                  </div>
                  <em>{money.format(row.revenue)}</em>
                </div>
              ))}
              {!topRankingRows.length && (
                <p className="onec-no-data">Нет продаж за выбранный период</p>
              )}
            </div>

            {topLimit < filteredRankingRows.length && (
              <button
                type="button"
                className="onec-rank-more"
                onClick={() => setTopLimit((value) => value + 10)}
              >
                Ещё {Math.min(10, filteredRankingRows.length - topLimit)}
                <small>
                  Показано {topRankingRows.length} из{" "}
                  {filteredRankingRows.length}
                </small>
              </button>
            )}
          </article>

          <article className="panel onec-ranking-card">
            <div className="panel-head">
              <div>
                <h2>Антитоп: низкий спрос</h2>
                <p>Товары с минимальным количеством продаж</p>
              </div>
              <div className="onec-ranking-actions">
                <button
                  type="button"
                  className="ranking-export"
                  disabled={!antiRankingRows.length}
                  onClick={() =>
                    downloadRankingCsv(
                      `low-demand-products-${rankingPeriod}.csv`,
                      [...filteredRankingRows].sort(
                        (left, right) =>
                          left.sold - right.sold ||
                          left.revenue - right.revenue,
                      ),
                    )
                  }
                >
                  ↓ Выгрузить
                </button>
                <span className="tag amber">НИЗКИЙ СПРОС</span>
              </div>
            </div>

            <div className="onec-rank-list">
              {antiRankingRows.map((row, index) => (
                <div className="rank-row" key={row.key}>
                  <b>{index + 1}</b>
                  <div>
                    <strong>{row.name}</strong>
                    <span>
                      {row.article} · {money.format(row.revenue)}
                    </span>
                  </div>
                  <em>{number.format(row.sold)} продаж</em>
                </div>
              ))}
              {!antiRankingRows.length && (
                <p className="onec-no-data">Нет продаж за выбранный период</p>
              )}
            </div>

            {antiLimit < filteredRankingRows.length && (
              <button
                type="button"
                className="onec-rank-more"
                onClick={() => setAntiLimit((value) => value + 10)}
              >
                Ещё {Math.min(10, filteredRankingRows.length - antiLimit)}
                <small>
                  Показано {antiRankingRows.length} из{" "}
                  {filteredRankingRows.length}
                </small>
              </button>
            )}
          </article>
        </div>

        <p className="onec-ranking-note">
          Антитоп рассчитан по фактическому количеству продаж. После подключения
          регистра остатков 1С сюда добавятся товары с нулевым спросом, но
          фактическим наличием на складе.
        </p>
      </section>

      <section className="panel onec-abc-summary">
        <div className="panel-head">
          <div>
            <h2>ABC-анализ ассортимента</h2>
            <p>A — ядро выручки, C — кандидаты для проверки спроса</p>
          </div>
        </div>
        <div className="onec-abc-summary-grid">
          {abcSummary.map((item) => (
            <article
              className={`onec-abc-summary-card ${item.group.toLowerCase()}`}
              key={item.group}
            >
              <b>{item.group}</b>
              <strong>{item.share.toFixed(1)}%</strong>
              <span>{item.count} SKU</span>
            </article>
          ))}
        </div>
      </section>

      <section className="panel onec-abc-panel">
        <div className="inventory-head">
          <div>
            <h2>Таблица ABC-анализа</h2>
            <p>
              {visibleRows.length} позиций · по {TABLE_PAGE_SIZE} на странице
            </p>
          </div>
          <label className="select-control">
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setTablePage(1);
              }}
            >
              <option value="">Все категории</option>
              {categories.map((item) => (
                <option value={item.Description} key={item.Ref_Key}>
                  {item.Description}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="inventory-controls">
          <label className="search onec-search">
            <span aria-hidden>⌕</span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setTablePage(1);
              }}
              placeholder="Поиск по названию или артикулу"
            />
          </label>
        </div>

        <div className="onec-table-wrap">
          <table className="onec-table onec-abc-table">
            <thead>
              <tr>
                <th>Артикул</th>
                <th>Товар</th>
                <th>Категория</th>
                <th>Выручка</th>
                <th>Продано</th>
                <th>Доля</th>
                <th>ABC</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <code>{row.article}</code>
                  </td>
                  <td>
                    <strong>{row.name}</strong>
                    <small className="onec-key">{row.key}</small>
                  </td>
                  <td>{row.category}</td>
                  <td>{money.format(row.revenue)}</td>
                  <td>{number.format(row.sold)} ед.</td>
                  <td>{row.share.toFixed(1)}%</td>
                  <td>
                    <span className={`abc-badge ${row.abc.toLowerCase()}`}>
                      {row.abc}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="onec-pagination">
          <span>
            Показано {firstVisibleRow}–{lastVisibleRow} из {visibleRows.length}
          </span>
          <nav aria-label="Пагинация таблицы ABC">
            <button
              type="button"
              aria-label="Предыдущая страница"
              disabled={currentTablePage === 1}
              onClick={() => setTablePage(currentTablePage - 1)}
            >
              ←
            </button>
            {pageButtons.map((pageNumber) => (
              <button
                type="button"
                key={pageNumber}
                className={pageNumber === currentTablePage ? "active" : ""}
                aria-label={`Страница ${pageNumber}`}
                aria-current={
                  pageNumber === currentTablePage ? "page" : undefined
                }
                onClick={() => setTablePage(pageNumber)}
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              aria-label="Следующая страница"
              disabled={currentTablePage === tablePageCount}
              onClick={() => setTablePage(currentTablePage + 1)}
            >
              →
            </button>
          </nav>
        </footer>
      </section>

      <section className="onec-document-footnote">
        <span>Получено документов: {reports.length}</span>
        <span>Складов в справочнике: {warehouses.length}</span>
        <span>
          Сервер:{" "}
          {loadMeta?.cache === "hit"
            ? "из кэша"
            : loadMeta?.cache === "shared"
              ? "общий запрос"
              : "из 1С"}
          {typeof loadMeta?.durationMs === "number"
            ? ` · ${loadMeta.durationMs} мс`
            : ""}
        </span>
      </section>
    </div>
  );
}
