import { useState } from "react";
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
  const activeMargin =
    margin?.current?.dataAvailable === true ? margin.current : null;
  const previousMargin = margin?.previous;
  const hasMargin = activeMargin !== null;
  const marginChange =
    hasMargin &&
    previousMargin?.dataAvailable &&
    previousMargin.marginPercent > 0
      ? activeMargin.marginPercent - previousMargin.marginPercent
      : null;
  const efficiencyPercent = activeMargin?.efficiencyPercent ?? 0;

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
            Продажи {money.format(analytics.grossRevenue)} − возвраты {" "}
            {money.format(analytics.returns)} = чистые продажи {" "}
            {money.format(analytics.revenue)}
            {margin && (
              <> · скидки −{money.format(margin.current.discounts)}</>
            )}
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
            {marginChange !== null && (
              <b
                className={marginChange >= 0 ? "trend" : "trend neutral"}
              >
                {marginChange >= 0 ? "+" : ""}
                {marginChange.toFixed(1)} п.п.
              </b>
            )}
          </div>
          <strong>
            {marginLoading
              ? "…"
              : hasMargin
                ? `${activeMargin.marginPercent.toFixed(1)}%`
                : "—"}
          </strong>
          <p>
            {marginError
              ? "себестоимость временно недоступна"
              : hasMargin
                ? (
                  <>
                    валовая прибыль {money.format(activeMargin.profit)}
                    <br />
                    вычет себестоимости −{money.format(activeMargin.cost)}
                    <br />
                    эффективность продаж {efficiencyPercent.toFixed(1)}%
                  </>
                )
                : margin
                  ? "1С не вернула себестоимость за период"
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
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
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
  const xLabelStep = Math.max(1, Math.ceil(currentPoints.length / 8));
  const peakIndexes = new Set<number>();
  currentPoints
    .map((point, index) => ({ point, index }))
    .filter(({ point, index }) => point.value > 0 &&
      (index === 0 || point.value > currentPoints[index - 1].value) &&
      (index === currentPoints.length - 1 || point.value >= currentPoints[index + 1].value))
    .sort((left, right) => right.point.value - left.point.value)
    .forEach(({ point, index }) => {
      if (peakIndexes.size < 6 &&
        [...peakIndexes].every((other) => Math.abs(point.x - currentPoints[other].x) >= 88)) {
        peakIndexes.add(index);
      }
    });

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
            viewBox={`0 0 ${chartWidth} ${chartHeight + 30}`}
            role="img"
            aria-label="Динамика выручки за выбранный период"
            onMouseLeave={() => setHoveredIdx(null)}
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
            {currentPoints.map((point, index) =>
              index === 0 || index === currentPoints.length - 1 ||
              (index % xLabelStep === 0 &&
                currentPoints[currentPoints.length - 1].x - point.x >= 65) ? (
                <text key={`date-${index}`} x={Math.max(30, Math.min(point.x, chartWidth - 30))} y={chartHeight + 14}
                  textAnchor="middle" fontSize="10" fill="var(--muted)">
                  {point.label}
                </text>
              ) : null,
            )}
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
            {currentPoints.map((point, index) => (
              <g key={`point-${index}`} onMouseEnter={() => setHoveredIdx(index)}>
                <circle cx={point.x} cy={point.y} r="10" fill="transparent" />
                <circle className="onec-revenue-point" cx={point.x} cy={point.y}
                  r={hoveredIdx === index ? 5 : 3} />
                {peakIndexes.has(index) && (
                  <text x={Math.max(36, Math.min(point.x, chartWidth - 36))} y={Math.max(14, point.y - 12)} textAnchor="middle"
                    fontSize="10" fontWeight="700" fill="var(--green)"
                    style={{ pointerEvents: "none" }}>
                    {compactNumber.format(point.value)}
                  </text>
                )}
                <title>{point.label}: {money.format(point.value)}</title>
              </g>
            ))}
          </svg>
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
