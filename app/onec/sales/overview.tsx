import { useState } from "react";
import { makeChartPoints } from "./analytics";
import { compactNumber, money, number, PERIODS } from "./config";
import type {
  AnalyticsPeriod,
  CustomDateRange,
  SalesAnalytics,
} from "./types";
import { dataFreshness } from "../shared";

type SalesSummaryProps = {
  analytics: SalesAnalytics;
  period: AnalyticsPeriod;
  onPeriodChange: (period: AnalyticsPeriod) => void;
  customRange: CustomDateRange;
  onCustomRangeChange: (range: CustomDateRange) => void;
  referencesLoading: boolean;
  referenceError: string;
  truncated?: boolean;
};

// Сегодняшняя дата и 30 дней назад для дефолтов датапикера
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function thirtyDaysAgoStr() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

export function SalesSummary({
  analytics,
  period,
  onPeriodChange,
  customRange,
  onCustomRangeChange,
  referencesLoading,
  referenceError,
  truncated,
}: SalesSummaryProps) {
  const freshness = dataFreshness(analytics.latestTimestamp);
  const [localFrom, setLocalFrom] = useState(
    customRange?.from ?? thirtyDaysAgoStr(),
  );
  const [localTo, setLocalTo] = useState(customRange?.to ?? todayStr());

  const periodCaption =
    period === "custom" && customRange
      ? `${customRange.from} — ${customRange.to}`
      : PERIODS[period].label;

  function applyCustomRange() {
    if (localFrom && localTo && localFrom <= localTo) {
      onCustomRangeChange({ from: localFrom, to: localTo });
    }
  }

  return (
    <>
      <section className="analytics-filter-bar">
        <div className="filter-copy">
          <span>Период анализа</span>
          <strong>{periodCaption}</strong>
        </div>
        <div className="period-switch" role="group" aria-label="Период анализа">
          {(Object.keys(PERIODS) as AnalyticsPeriod[]).map((key) => (
            <button
              key={key}
              className={period === key ? "active" : ""}
              onClick={() => onPeriodChange(key)}
            >
              {PERIODS[key].label}
            </button>
          ))}
        </div>

        {period === "custom" && (
          <div className="custom-date-range">
            <label>
              <span>С</span>
              <input
                type="date"
                value={localFrom}
                max={localTo}
                onChange={(e) => setLocalFrom(e.target.value)}
              />
            </label>
            <label>
              <span>По</span>
              <input
                type="date"
                value={localTo}
                min={localFrom}
                max={todayStr()}
                onChange={(e) => setLocalTo(e.target.value)}
              />
            </label>
            <button
              className="custom-range-apply"
              onClick={applyCustomRange}
              disabled={!localFrom || !localTo || localFrom > localTo}
            >
              Применить
            </button>
          </div>
        )}

        <span className="onec-period-note">
          {referencesLoading
            ? "Аналитика готова · загружаем названия товаров…"
            : `Данные по состоянию на ${new Date(
                analytics.latestTimestamp,
              ).toLocaleDateString("ru-RU")}`}
        </span>
        <span className={freshness.fresh ? "onec-posted" : "onec-draft"}>
          {freshness.label}
        </span>
        {truncated && (
          <span className="onec-draft">Выборка ограничена сервером</span>
        )}
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
            <span>Чистая выручка {PERIODS[period].caption}</span>
            {analytics.growth !== null && (
              <b
                className={
                  analytics.growth >= 0 ? "trend" : "trend neutral"
                }
              >
                {analytics.growth >= 0 ? "+" : ""}
                {analytics.growth.toFixed(1)}%
              </b>
            )}
          </div>
          <strong>{money.format(analytics.revenue)}</strong>
          <p>
            Продажи {money.format(analytics.grossRevenue)} · возвраты −{money.format(analytics.returns)}
          </p>
        </article>

        <article className="kpi-card">
          <div className="kpi-top">
            <span>Продано после возвратов</span>
          </div>
          <strong>{number.format(analytics.sold)} ед.</strong>
          <p>продажи минус возвращённые единицы</p>
        </article>

        <article className="kpi-card">
          <div className="kpi-top">
            <span>Средняя чистая цена</span>
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
    </>
  );
}

export function RevenueAnalysis({
  analytics,
  period,
}: {
  analytics: SalesAnalytics;
  period: AnalyticsPeriod;
}) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const maximum = Math.max(
    ...analytics.currentBuckets.map((item) => item.value),
    ...analytics.previousBuckets.map((item) => item.value),
    1,
  );
  const currentPoints = makeChartPoints(analytics.currentBuckets, maximum);
  const previousPoints = makeChartPoints(analytics.previousBuckets, maximum);
  const chartWidth = 760;
  const chartHeight = 270;
  const chartPadding = 18;

  // Шаг подписей X-оси: не больше 8 меток
  const labelStep = Math.max(1, Math.ceil(currentPoints.length / 8));

  // Топ-3 товара в категории для drill-down
  const topProductsInCategory = (categoryLabel: string) =>
    analytics.rows
      .filter((row) => row.category === categoryLabel && row.revenue > 0)
      .slice(0, 5);

  return (
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
            <strong>{money.format(maximum)}</strong>
          </div>
          <div className="onec-chart-y-axis" aria-hidden="true">
            <span>{compactNumber.format(maximum)}</span>
            <span>{compactNumber.format(maximum * 0.66)}</span>
            <span>{compactNumber.format(maximum * 0.33)}</span>
            <span>0</span>
          </div>
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label="Динамика выручки текущего и предыдущего периода"
            style={{ overflow: "visible" }}
          >
            {/* Горизонтальные линии сетки */}
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

            {/* Подписи X-оси — реальные даты из бакетов */}
            {currentPoints.map((point, i) =>
              i % labelStep === 0 ? (
                <text
                  key={`xl-${i}`}
                  x={point.x}
                  y={chartHeight + 14}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--text-secondary, #888)"
                >
                  {point.label}
                </text>
              ) : null,
            )}

            <polyline
              className="onec-revenue-line previous"
              points={previousPoints
                .map((point) => `${point.x},${point.y}`)
                .join(" ")}
            />
            <polyline
              className="onec-revenue-line current"
              points={currentPoints
                .map((point) => `${point.x},${point.y}`)
                .join(" ")}
            />

            {/* Точки текущего периода с подписями сумм */}
            {currentPoints.map((point, i) => (
              <g key={point.label} className="onec-revenue-point-group">
                <circle
                  className="onec-revenue-point"
                  cx={point.x}
                  cy={point.y}
                  r="4"
                />
                {(point.value > 0 && i % labelStep === 0) && (
                  <text
                    x={point.x}
                    y={point.y - 9}
                    textAnchor="middle"
                    fontSize="9"
                    className="onec-revenue-point-label"
                    fill="var(--accent, #3b82f6)"
                  >
                    {compactNumber.format(point.value)}
                  </text>
                )}
                <title>
                  {point.label}: {money.format(point.value)}
                </title>
              </g>
            ))}
          </svg>
        </div>
      </article>

      {/* Продажи по категориям с раскрытием */}
      <article className="panel onec-category-panel">
        <div className="panel-head">
          <div>
            <h2>Продажи по категориям</h2>
            <p>Структура выручки {PERIODS[period].caption} · нажми категорию для детализации</p>
          </div>
        </div>
        <div className="onec-category-list">
          {analytics.categoryRows.map((item) => {
            const isOpen = expandedCategory === item.label;
            const products = isOpen ? topProductsInCategory(item.label) : [];
            return (
              <div key={item.label} className="onec-category-item">
                <div
                  className={`onec-category-row${isOpen ? " open" : ""}`}
                  onClick={() =>
                    setExpandedCategory(isOpen ? null : item.label)
                  }
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) =>
                    e.key === "Enter" &&
                    setExpandedCategory(isOpen ? null : item.label)
                  }
                >
                  <div>
                    <strong>{item.label}</strong>
                    <span>
                      {item.share.toFixed(1)}% · {money.format(item.value)}
                    </span>
                  </div>
                  <span className="onec-category-arrow">{isOpen ? "▲" : "▼"}</span>
                </div>
                <i className="onec-category-bar">
                  <b style={{ width: `${item.share}%` }} />
                </i>
                {isOpen && (
                  <div className="onec-category-detail">
                    {products.length > 0 ? (
                      <table className="onec-category-detail-table">
                        <thead>
                          <tr>
                            <th>Товар</th>
                            <th>Выручка</th>
                            <th>Продано</th>
                            <th>Доля</th>
                          </tr>
                        </thead>
                        <tbody>
                          {products.map((row) => (
                            <tr key={row.key}>
                              <td>
                                <span className={`abc-badge ${row.abc.toLowerCase()}`}>
                                  {row.abc}
                                </span>{" "}
                                {row.name}
                              </td>
                              <td>{money.format(row.revenue)}</td>
                              <td>{number.format(row.sold)} ед.</td>
                              <td>{row.share.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="onec-no-data">Нет позиций в этой категории</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!analytics.categoryRows.length && (
            <p className="onec-no-data">Нет категорий за выбранный период</p>
          )}
        </div>
      </article>
    </section>
  );
}

export function ReferenceSkeleton() {
  return (
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
  );
}
