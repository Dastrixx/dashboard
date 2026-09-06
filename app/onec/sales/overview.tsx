import { makeChartPoints } from "./analytics";
import { compactNumber, money, number, PERIODS } from "./config";
import type {
  AnalyticsPeriod,
  MarginAnalytics,
  SalesAnalytics,
  SalesDateRange,
} from "./types";
import { dataFreshness } from "../shared";
import {
  SalesDateFilter,
  type SalesDateFilterProps,
} from "./date-filter";

type SalesSummaryProps = {
  analytics: SalesAnalytics;
  period: AnalyticsPeriod;
  onPeriodChange: (period: AnalyticsPeriod) => void;
  dateFilter: SalesDateFilterProps;
  referencesLoading: boolean;
  referenceError: string;
  truncated?: boolean;
  margin: MarginAnalytics | null;
  marginLoading: boolean;
  marginError: string;
};

export function SalesSummary({
  analytics,
  period,
  onPeriodChange,
  dateFilter,
  referencesLoading,
  referenceError,
  truncated,
  margin,
  marginLoading,
  marginError,
}: SalesSummaryProps) {
  const freshness = dataFreshness(analytics.latestTimestamp);

  return (
    <>
      <section className="analytics-filter-bar">
        <div className="filter-copy">
          <span>Период анализа</span>
          <strong>
            {dateFilter.appliedRange
              ? `${dateFilter.appliedRange.from} — ${dateFilter.appliedRange.to}`
              : PERIODS[period].label}
          </strong>
        </div>
        <SalesDateFilter {...dateFilter} />
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
        <span className="onec-period-note">
          {referencesLoading
            ? "Аналитика готова · загружаем справочники…"
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
          <strong>
            Продажи загружены, справочники временно недоступны.
          </strong>
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
            Продажи {money.format(analytics.grossRevenue)} · возвраты −
            {money.format(analytics.returns)}
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

        <article className="kpi-card">
          <div className="kpi-top">
            <span>Маржа</span>
            {margin?.previous && margin.previous.marginPercent > 0 && (
              <b
                className={
                  margin.current.marginPercent >= margin.previous.marginPercent
                    ? "trend"
                    : "trend neutral"
                }
              >
                {margin.current.marginPercent >= margin.previous.marginPercent ? "+" : ""}
                {(margin.current.marginPercent - margin.previous.marginPercent).toFixed(1)} п.п.
              </b>
            )}
          </div>
          <strong>
            {marginLoading
              ? "…"
              : margin
                ? `${margin.current.marginPercent.toFixed(1)}%`
                : "—"}
          </strong>
          <p>
            {marginError
              ? "себестоимость временно недоступна"
              : margin
                ? `валовая прибыль ${money.format(margin.current.profit)}`
                : "по себестоимости из регистра продаж 1С"}
          </p>
        </article>
      </section>
    </>
  );
}

export function RevenueAnalysis({
  analytics,
  period,
  dateRange,
}: {
  analytics: SalesAnalytics;
  period: AnalyticsPeriod;
  dateRange?: SalesDateRange | null;
}) {
  const hasPreviousPeriod = analytics.previousBuckets.some(
    (item) => item.value !== 0,
  );
  const maximum = Math.max(
    ...analytics.currentBuckets.map((item) => item.value),
    ...(hasPreviousPeriod
      ? analytics.previousBuckets.map((item) => item.value)
      : []),
    1,
  );
  const currentPoints = makeChartPoints(analytics.currentBuckets, maximum);
  const previousPoints = makeChartPoints(analytics.previousBuckets, maximum);
  const chartWidth = 760;
  const chartHeight = 270;
  const chartPadding = 18;

  return (
    <section className="charts-grid onec-real-analysis-grid">
      <article className="panel onec-revenue-panel">
        <div className="panel-head">
          <div>
            <h2>Динамика выручки</h2>
            <p>
              {dateRange
                ? `Период ${dateRange.from} — ${dateRange.to}`
                : PERIODS[period].label}
            </p>
          </div>
          <div className="chart-key compact">
            <span>
              <i className="actual" />
              Текущий
            </span>
            {hasPreviousPeriod && (
              <span>
                <i className="previous" />
                Предыдущий
              </span>
            )}
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
            aria-label="Динамика выручки за выбранный период"
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
            {hasPreviousPeriod && (
              <polyline
                className="onec-revenue-line previous"
                points={previousPoints
                  .map((point) => `${point.x},${point.y}`)
                  .join(" ")}
              />
            )}
            <polyline
              className="onec-revenue-line current"
              points={currentPoints
                .map((point) => `${point.x},${point.y}`)
                .join(" ")}
            />
            {currentPoints.map((point) => (
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
            <span>{dateRange ? "Конец периода" : "Сегодня"}</span>
          </div>
        </div>
      </article>

      <article className="panel onec-category-panel">
        <div className="panel-head">
          <div>
            <h2>Продажи по категориям</h2>
            <p>
              Структура выручки{" "}
              {dateRange
                ? `за ${dateRange.from} — ${dateRange.to}`
                : PERIODS[period].caption}
            </p>
          </div>
        </div>
        <div className="onec-category-list">
          {analytics.categoryRows.map((item) => (
            <div className="onec-category-row" key={item.label}>
              <div>
                <strong>{item.label}</strong>
                <span>
                  {item.share.toFixed(1)}% · {money.format(item.value)}
                </span>
              </div>
              <i>
                <b style={{ width: `${item.share}%` }} />
              </i>
              {item.subcategories.length > 0 && (
                <details className="onec-subcategories">
                  <summary>
                    Подкатегории · {item.subcategories.length}
                  </summary>
                  <div>
                    {item.subcategories.map((subcategory) => (
                      <span key={subcategory.label}>
                        <b>{subcategory.label}</b>
                        <em>
                          {subcategory.share.toFixed(1)}% ·{" "}
                          {money.format(subcategory.value)}
                        </em>
                      </span>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
          {!analytics.categoryRows.length && (
            <p className="onec-no-data">
              Нет категорий за выбранный период
            </p>
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
          <p>
            Загружаем названия, артикулы, категории и подкатегории
            из 1С
          </p>
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
