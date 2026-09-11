import { compactMoney, money } from "./format";
import type { MarginAnalytics } from "../sales/types";
import type { OwnerOverviewAnalytics } from "./types";

export function RevenueComparison({
  analytics,
  periodCaption,
  margin,
  marginLoading,
  marginError,
}: {
  analytics: OwnerOverviewAnalytics;
  periodCaption: string;
  margin: MarginAnalytics | null;
  marginLoading: boolean;
  marginError: string;
}) {
  const maximum = Math.max(
    ...analytics.comparison.map((bucket) => bucket.value),
    1,
  );
  const activeMargin =
    margin?.current?.dataAvailable === true ? margin.current : null;
  const hasMargin = activeMargin !== null;
  const efficiencyPercent = activeMargin?.efficiencyPercent ?? 0;

  return (
    <article className="panel owner-revenue-panel">
      <div className="owner-panel-head">
        <div>
          <span className="onec-source-kicker">Продажи за период</span>
          <h2>Динамика выручки</h2>
          <p>Изменение выручки внутри периода {periodCaption}</p>
        </div>
        <div className="owner-chart-legend" aria-label="Легенда графика">
          <span><i className="current" />Текущий</span>
        </div>
      </div>

      <div className="owner-comparison-summary">
        <div>
          <span>Текущий период</span>
          <strong>{money.format(analytics.period.revenue)}</strong>
          <small>Только выбранный диапазон дат</small>
        </div>
      </div>

      <div className="owner-margin-dynamics">
        <div>
          <span>Маржа текущего периода</span>
          <strong>
            {marginLoading
              ? "…"
              : hasMargin
                ? `${activeMargin.marginPercent.toFixed(1)}%`
                : "—"}
          </strong>
          <small>
            {hasMargin
              ? [
                  `валовая прибыль ${money.format(activeMargin.profit)}`,
                  `вычет себестоимости −${money.format(activeMargin.cost)}`,
                  `эффективность продаж ${efficiencyPercent.toFixed(1)}%`,
                  `скидки −${money.format(activeMargin.discounts)}`,
                ].join(" · ")
              : margin
                ? "1С не вернула себестоимость за период"
                : marginError || "Себестоимость из регистра продаж 1С"}
          </small>
        </div>
      </div>

      <div className="owner-chart-scroll">
        <div
          className="owner-revenue-chart"
          style={{
            gridTemplateColumns: `repeat(${analytics.comparison.length}, minmax(46px, 1fr))`,
          }}
        >
          {analytics.comparison.map((bucket, index) => (
            <div className="owner-chart-column" key={`${bucket.label}-${index}`}>
              <div className="owner-chart-value">
                <b>{bucket.value ? compactMoney.format(bucket.value) : "—"}</b>
                <div className="owner-chart-bars">
                  <i
                    className="current"
                    style={{
                      height: `${Math.max(
                        (bucket.value / maximum) * 100,
                        bucket.value ? 4 : 0,
                      )}%`,
                    }}
                  />
                </div>
              </div>
              <span>{bucket.label}</span>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
