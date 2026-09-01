import { change, money, number } from "./format";
import type { OwnerOverviewAnalytics } from "./types";
import type { CheckAnalytics } from "../sales/types";

function Trend({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="owner-kpi-badge neutral">нет базы</span>;
  }

  return (
    <span className={`owner-kpi-badge ${value < 0 ? "negative" : "positive"}`}>
      {value >= 0 ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

export function OwnerKpis({
  analytics,
  todayChecks,
  checksLoading,
}: {
  analytics: OwnerOverviewAnalytics;
  todayChecks: CheckAnalytics | null;
  checksLoading: boolean;
}) {
  const checkCurrent = todayChecks?.current;
  const checkPrevious = todayChecks?.previous;

  return (
    <section className="owner-kpi-grid" aria-label="Показатели на сегодня">
      <article className="owner-kpi-card featured">
        <div>
          <span>Чистая выручка за последний день</span>
          <Trend
            value={change(
              analytics.today.revenue,
              analytics.today.previousRevenue,
            )}
          />
        </div>
        <strong>{money.format(analytics.today.revenue)}</strong>
        <p>к предыдущему дню с продажами</p>
      </article>

      <article className="owner-kpi-card">
        <div>
          <span>Чеков за последний день</span>
          <Trend
            value={
              checkCurrent && checkPrevious
                ? change(checkCurrent.checks, checkPrevious.checks)
                : null
            }
          />
        </div>
        <strong>
          {checksLoading
            ? "…"
            : checkCurrent
              ? number.format(checkCurrent.checks)
              : "—"}
        </strong>
        <p>проведённые чеки продаж</p>
      </article>

      <article className="owner-kpi-card">
        <div>
          <span>Средний чек</span>
          <Trend
            value={
              checkCurrent && checkPrevious
                ? change(
                    checkCurrent.averageCheck,
                    checkPrevious.averageCheck,
                  )
                : null
            }
          />
        </div>
        <strong>
          {checksLoading
            ? "…"
            : checkCurrent
              ? money.format(checkCurrent.averageCheck)
              : "—"}
        </strong>
        <p>по чекам 1С за последний день</p>
      </article>

      <article className="owner-kpi-card">
        <div>
          <span>Продано за последний день</span>
          <Trend
            value={change(analytics.today.sold, analytics.today.previousSold)}
          />
        </div>
        <strong>{number.format(analytics.today.sold)} ед.</strong>
        <p>{number.format(analytics.period.activeSku)} активных SKU за период</p>
      </article>
    </section>
  );
}
