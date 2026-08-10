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
  ТоварнаяГруппа_Key: string;
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
  Code: string;
  Description: string;
};

type OnecResponse = {
  items: OnecRetailReport[];
  references: {
    products: OnecProductReference[];
    warehouses: OnecWarehouseReference[];
    categories: OnecCategoryReference[];
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

const API_URL = "http://localhost:4000";
const DAY_MS = 86_400_000;

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

const shortDate = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
});

function inRange(value: string, from: number, to: number) {
  const timestamp = new Date(value).getTime();
  return timestamp >= from && timestamp <= to;
}

export function OnecSales() {
  const [reports, setReports] = useState<OnecRetailReport[]>([]);
  const [products, setProducts] = useState<OnecProductReference[]>([]);
  const [warehouses, setWarehouses] = useState<OnecWarehouseReference[]>([]);
  const [categories, setCategories] = useState<OnecCategoryReference[]>([]);
  const [period, setPeriod] = useState<AnalyticsPeriod>("month");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadReports() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          `${API_URL}/api/dashboard/onec-reports?top=500&days=60`,
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
        setProducts(
          Array.isArray(data.references?.products)
            ? data.references.products
            : [],
        );
        setWarehouses(
          Array.isArray(data.references?.warehouses)
            ? data.references.warehouses
            : [],
        );
        setCategories(
          Array.isArray(data.references?.categories)
            ? data.references.categories
            : [],
        );
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

    const productByKey = new Map(
      products.map((product) => [product.Ref_Key, product]),
    );
    const categoryByKey = new Map(
      categories.map((item) => [item.Ref_Key, item.Description]),
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

    const aggregate = new Map<
      string,
      { revenue: number; sold: number }
    >();

    lines.forEach((line) => {
      const current = aggregate.get(line.Номенклатура_Key) || {
        revenue: 0,
        sold: 0,
      };
      current.revenue += Number(line.Сумма || 0);
      current.sold += Number(line.Количество || 0);
      aggregate.set(line.Номенклатура_Key, current);
    });

    const totalProductRevenue =
      [...aggregate.values()].reduce(
        (sum, item) => sum + item.revenue,
        0,
      ) || 1;

    let cumulative = 0;
    const rows: ProductRow[] = [...aggregate.entries()]
      .map(([key, value]) => {
        const product = productByKey.get(key);
        const categoryName =
          categoryByKey.get(product?.ТоварнаяГруппа_Key || "") ||
          "Без категории";

        return {
          key,
          article: product?.Артикул || product?.Code || "—",
          name:
            product?.Description ||
            product?.НаименованиеПолное ||
            "Название не найдено",
          category: categoryName,
          revenue: value.revenue,
          sold: value.sold,
          share: 0,
          abc: "C" as const,
        };
      })
      .sort((left, right) => right.revenue - left.revenue)
      .map((row) => {
        const share = (row.revenue / totalProductRevenue) * 100;
        cumulative += share;
        return {
          ...row,
          share,
          abc:
            cumulative <= 80
              ? ("A" as const)
              : cumulative <= 95
                ? ("B" as const)
                : ("C" as const),
        };
      });

    const categoryMap = new Map<string, number>();
    rows.forEach((row) => {
      categoryMap.set(
        row.category,
        (categoryMap.get(row.category) || 0) + row.revenue,
      );
    });
    const categoryRows = [...categoryMap.entries()]
      .map(([label, value]) => ({
        label,
        value,
        share: (value / totalProductRevenue) * 100,
      }))
      .sort((left, right) => right.value - left.value);

    const bucketCount =
      period === "day" ? 6 : period === "week" ? 7 : 5;
    const bucketSize = duration / bucketCount;

    const makeBuckets = (
      source: OnecRetailReport[],
      rangeStart: number,
    ) =>
      Array.from({ length: bucketCount }, (_, index) => ({
        label:
          period === "month"
            ? `${index + 1} нед.`
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
      activeSku: aggregate.size,
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

  const visibleRows = useMemo(() => {
    if (!analytics) return [];

    const normalizedQuery = query.trim().toLowerCase();

    return analytics.rows.filter(
      (row) =>
        (!category || row.category === category) &&
        (!normalizedQuery ||
          `${row.name} ${row.article}`
            .toLowerCase()
            .includes(normalizedQuery)),
    );
  }, [analytics, category, query]);

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

  return (
    <div className="page-stack onec-product-analytics">
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
              onClick={() => setPeriod(key)}
            >
              {PERIODS[key].label}
            </button>
          ))}
        </div>
        <span className="onec-period-note">
          Данные по состоянию на{" "}
          {new Date(analytics.latestTimestamp).toLocaleDateString("ru-RU")}
        </span>
      </section>

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
          <div className="kpi-top"><span>Продано</span></div>
          <strong>{number.format(analytics.sold)} ед.</strong>
          <p>по товарным строкам документов</p>
        </article>

        <article className="kpi-card">
          <div className="kpi-top"><span>Средняя цена продажи</span></div>
          <strong>{money.format(analytics.averagePrice)}</strong>
          <p>выручка на проданную единицу</p>
        </article>

        <article className="kpi-card">
          <div className="kpi-top"><span>Активных SKU</span></div>
          <strong>{number.format(analytics.activeSku)}</strong>
          <p>были продажи за период</p>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Сравнительный анализ</h2>
            <p>Текущий период против предыдущего</p>
          </div>
          <div className="chart-key compact">
            <span><i className="actual" />Текущий</span>
            <span><i className="previous" />Предыдущий</span>
          </div>
        </div>
        <div className="onec-comparison">
          {analytics.currentBuckets.map((current, index) => {
            const previous = analytics.previousBuckets[index];
            return (
              <div className="onec-comparison-group" key={current.label}>
                <div className="onec-comparison-bars">
                  <div>
                    <b>{money.format(current.value)}</b>
                    <i
                      className="current"
                      style={{
                        height: `${Math.max((current.value / maxChartValue) * 100, current.value ? 3 : 0)}%`,
                      }}
                    />
                  </div>
                  <div>
                    <b>{money.format(previous.value)}</b>
                    <i
                      className="previous"
                      style={{
                        height: `${Math.max((previous.value / maxChartValue) * 100, previous.value ? 3 : 0)}%`,
                      }}
                    />
                  </div>
                </div>
                <span>{current.label}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="charts-grid">
        <article className="panel wide">
          <div className="panel-head">
            <div>
              <h2>Продажи по категориям</h2>
              <p>Доля в выручке за выбранный период</p>
            </div>
          </div>
          <div className="onec-category-list">
            {analytics.categoryRows.map((item) => (
              <div key={item.label}>
                <div>
                  <strong>{item.label}</strong>
                  <span>
                    {money.format(item.value)} · {item.share.toFixed(1)}%
                  </span>
                </div>
                <i><b style={{ width: `${item.share}%` }} /></i>
              </div>
            ))}
          </div>
        </article>

        <article className="panel insights">
          <div className="panel-head">
            <div>
              <h2>Источник расчёта</h2>
              <p>Без демонстрационных значений</p>
            </div>
          </div>
          <div className="insight good">
            <b>Выручка</b>
            <span>ОтчетОРозничныхПродажах.СуммаДокумента</span>
          </div>
          <div className="insight good">
            <b>Количество и товары</b>
            <span>Табличная часть документа «Товары»</span>
          </div>
          <div className="insight">
            <b>Категории</b>
            <span>Справочник «Товарные группы»; незаполненные — «Без категории»</span>
          </div>
        </article>
      </section>

      <section className="panel onec-abc-panel">
        <div className="inventory-head">
          <div>
            <h2>Таблица ABC-анализа</h2>
            <p>{visibleRows.length} позиций · реальные продажи 1С</p>
          </div>
          <label className="select-control">
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">Все категории</option>
              {analytics.categoryRows.map((item) => (
                <option value={item.label} key={item.label}>
                  {item.label}
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
              onChange={(event) => setQuery(event.target.value)}
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
              {visibleRows.map((row) => (
                <tr key={row.key}>
                  <td><code>{row.article}</code></td>
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
      </section>

      <section className="onec-document-footnote">
        <span>Получено документов: {analytics.currentReports.length}</span>
        <span>Складов в справочнике: {warehouses.length}</span>
      </section>
    </div>
  );
}
