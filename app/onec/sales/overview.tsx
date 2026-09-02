import { useState, useRef } from "react";
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
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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

  // Шаг X-оси подписей дат: не больше 8 меток (чтобы даты не слипались)
  const xLabelStep = Math.max(1, Math.ceil(currentPoints.length / 8));
  // Подписи значений: вращаем при большом количестве точек
  const rotateTip = currentPoints.length > 14;

  // Подкатегории (ВидНоменклатуры) внутри категории
  const subcategoriesInCategory = (categoryLabel: string) => {
    const rows = analytics.rows.filter(
      (row) => row.category === categoryLabel && row.revenue > 0,
    );
    const totalCatRevenue = rows.reduce((s, r) => s + r.revenue, 0) || 1;
    const subMap = new Map<string, { revenue: number; sold: number; skuCount: number }>();
    rows.forEach((r) => {
      const sub = r.subcategory || "Без подкатегории";
      const cur = subMap.get(sub) ?? { revenue: 0, sold: 0, skuCount: 0 };
      cur.revenue += r.revenue;
      cur.sold += r.sold;
      cur.skuCount += 1;
      subMap.set(sub, cur);
    });
    return [...subMap.entries()]
      .map(([name, data]) => ({
        name,
        revenue: data.revenue,
        sold: data.sold,
        skuCount: data.skuCount,
        share: (data.revenue / totalCatRevenue) * 100,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  };

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
            ref={svgRef}
            viewBox={`0 0 ${chartWidth} ${chartHeight + 30}`}
            role="img"
            aria-label="Динамика выручки текущего и предыдущего периода"
            style={{ overflow: "visible" }}
            onMouseLeave={() => setHoveredIdx(null)}
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

            {/* Подписи дат X-оси — каждые N точек */}
            {currentPoints.map((point, i) =>
              i % xLabelStep === 0 ? (
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
                .map((p) => `${p.x},${p.y}`)
                .join(" ")}
            />
            <polyline
              className="onec-revenue-line current"
              points={currentPoints
                .map((p) => `${p.x},${p.y}`)
                .join(" ")}
            />

            {/* Точки с подписями суммы — ВСЕ точки */}
            {currentPoints.map((point, i) => {
              const isHovered = hoveredIdx === i;
              const labelAnchor = rotateTip ? "end" : "middle";
              const labelX = point.x + (rotateTip ? 4 : 0);
              const labelY = point.y - (rotateTip ? 6 : 11);
              const rotate = rotateTip
                ? `rotate(-45 ${labelX} ${labelY})`
                : undefined;

              return (
                <g
                  key={`pt-${i}`}
                  style={{ cursor: "default" }}
                  onMouseEnter={() => setHoveredIdx(i)}
                >
                  {/* Зона захвата hover шире самой точки */}
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r="10"
                    fill="transparent"
                  />
                  <circle
                    className="onec-revenue-point"
                    cx={point.x}
                    cy={point.y}
                    r={isHovered ? 5 : 3.5}
                    style={{ transition: "r 0.1s" }}
                  />
                  {/* Подпись суммы у каждой точки */}
                  {point.value > 0 && (
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor={labelAnchor}
                      fontSize="8"
                      fontWeight={isHovered ? "700" : "500"}
                      fill={isHovered ? "var(--accent, #3b82f6)" : "var(--text-secondary, #888)"}
                      transform={rotate}
                      style={{ pointerEvents: "none" }}
                    >
                      {compactNumber.format(point.value)}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Hover-подсказка с полной суммой */}
            {hoveredIdx !== null && currentPoints[hoveredIdx] && (() => {
              const pt = currentPoints[hoveredIdx];
              const tooltipW = 148;
              const tooltipH = 40;
              const tx = Math.max(
                chartPadding,
                Math.min(pt.x - tooltipW / 2, chartWidth - chartPadding - tooltipW),
              );
              const ty = Math.max(4, pt.y - tooltipH - 12);
              return (
                <g style={{ pointerEvents: "none" }}>
                  <rect
                    x={tx} y={ty}
                    width={tooltipW} height={tooltipH}
                    rx="7"
                    fill="rgba(15,23,42,0.82)"
                  />
                  <text
                    x={tx + tooltipW / 2} y={ty + 14}
                    textAnchor="middle"
                    fontSize="10"
                    fill="rgba(255,255,255,0.7)"
                  >
                    {pt.label}
                  </text>
                  <text
                    x={tx + tooltipW / 2} y={ty + 30}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="700"
                    fill="#7dd3fc"
                  >
                    {money.format(pt.value)}
                  </text>
                </g>
              );
            })()}
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
                {isOpen && (() => {
                  const subs = subcategoriesInCategory(item.label);
                  return (
                    <div className="onec-category-detail">
                      {subs.length > 0 ? (
                        <table className="onec-category-detail-table">
                          <thead>
                            <tr>
                              <th>Подкатегория</th>
                              <th>Выручка</th>
                              <th>Продано</th>
                              <th>SKU</th>
                              <th>Доля</th>
                            </tr>
                          </thead>
                          <tbody>
                            {subs.map((sub) => (
                              <tr key={sub.name}>
                                <td><strong>{sub.name}</strong></td>
                                <td>{money.format(sub.revenue)}</td>
                                <td>{number.format(sub.sold)} ед.</td>
                                <td>{sub.skuCount}</td>
                                <td>
                                  <span className="onec-sub-share-bar">
                                    <b style={{ width: `${sub.share}%` }} />
                                    <em>{sub.share.toFixed(1)}%</em>
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="onec-no-data">Нет подкатегорий</p>
                      )}
                    </div>
                  );
                })()}
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
