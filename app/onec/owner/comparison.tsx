import { compactMoney, money, number } from "./format";
import type { OwnerOverviewAnalytics } from "./types";

export function RevenueComparison({
  analytics,
  periodCaption,
}: {
  analytics: OwnerOverviewAnalytics;
  periodCaption: string;
}) {
  const maximum = Math.max(
    ...analytics.comparison.flatMap((bucket) => [
      bucket.value,
      bucket.previousValue,
    ]),
    1,
  );

  return (
    <article className="panel owner-revenue-panel">
      <div className="owner-panel-head">
        <div>
          <span className="onec-source-kicker">Сравнительный анализ</span>
          <h2>Динамика выручки</h2>
          <p>Период {periodCaption} относительно предыдущего такой же длины</p>
        </div>
        <div className="owner-chart-legend" aria-label="Легенда графика">
          <span><i className="current" />Текущий</span>
          <span><i className="previous" />Предыдущий</span>
        </div>
      </div>

      <div className="owner-comparison-summary">
        <div>
          <span>Текущий период</span>
          <strong>{money.format(analytics.period.revenue)}</strong>
          <small>
            {analytics.period.revenueGrowth === null
              ? "Нет базы для сравнения"
              : `${analytics.period.revenueGrowth >= 0 ? "+" : ""}${analytics.period.revenueGrowth.toFixed(1)}% к предыдущему`}
          </small>
        </div>
        <div>
          <span>Предыдущий период</span>
          <strong>{money.format(analytics.period.previousRevenue)}</strong>
          <small>{number.format(analytics.period.previousSold)} ед. продано</small>
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
                    style={{ height: `${Math.max((bucket.value / maximum) * 100, bucket.value ? 4 : 0)}%` }}
                  />
                  <i
                    className="previous"
                    style={{ height: `${Math.max((bucket.previousValue / maximum) * 100, bucket.previousValue ? 4 : 0)}%` }}
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
