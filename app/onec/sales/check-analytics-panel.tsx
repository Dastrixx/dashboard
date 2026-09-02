import { percentageChange } from "./analytics";
import { money, number, PERIODS } from "./config";
import type { AnalyticsPeriod, CheckAnalytics } from "./types";

type Props = {
  period: AnalyticsPeriod;
  analytics: CheckAnalytics | null;
  loading: boolean;
  error: string;
};

export function CheckAnalyticsPanel({
  period,
  analytics,
  loading,
  error,
}: Props) {
  const chartMaximum = Math.max(
    ...(analytics?.series.map((item) => item.checks) || []),
    1,
  );
  const cards = analytics
    ? [
        {
          label: "Чеков продаж",
          value: number.format(analytics.current.checks),
          note: `предыдущий период: ${number.format(analytics.previous.checks)}`,
          change: percentageChange(
            analytics.current.checks,
            analytics.previous.checks,
          ),
        },
        {
          label: "Средний чек",
          value: money.format(analytics.current.averageCheck),
          note: `предыдущий: ${money.format(analytics.previous.averageCheck)}`,
          change: percentageChange(
            analytics.current.averageCheck,
            analytics.previous.averageCheck,
          ),
        },
        {
          label: "Выручка по чекам",
          value: money.format(analytics.current.revenue),
          note: "без чеков возврата",
          change: percentageChange(
            analytics.current.revenue,
            analytics.previous.revenue,
          ),
        },
        {
          label: "Возвраты",
          value: `${number.format(analytics.current.returns)} · ${money.format(analytics.current.returnsAmount)}`,
          note: "количество и сумма чеков возврата",
          change: null,
        },
        {
          label: "Скидки",
          value: money.format(analytics.current.discounts),
          note: `${analytics.current.discountShare.toFixed(1)}% от суммы до скидок · ${money.format(analytics.current.grossRevenue)}`,
          change: percentageChange(
            analytics.current.discounts,
            analytics.previous.discounts,
          ),
        },
        {
          label: "Оплата сертификатами",
          value: money.format(analytics.current.certificatePayments),
          note: `погашено сертификатов: ${number.format(analytics.current.certificatesUsed)}`,
          change: percentageChange(
            analytics.current.certificatePayments,
            analytics.previous.certificatePayments,
          ),
        },
      ]
    : [];

  return (
    <section className="panel onec-check-analytics">
      <div className="panel-head onec-check-head">
        <div>
          <span className="onec-source-kicker">Document_ЧекККМ</span>
          <h2>Аналитика по чекам</h2>
          <p>Количество, средний чек и возвраты {PERIODS[period].caption}</p>
        </div>
        {analytics?.periodEnd && (
          <span className="onec-period-note">
            Последний чек: {new Date(analytics.periodEnd).toLocaleString("ru-RU")}
          </span>
        )}
      </div>

      {loading ? (
        <div className="onec-check-state" aria-live="polite">
          <span className="onec-spinner" />
          <span>Загружаем чеки из 1С…</span>
        </div>
      ) : error ? (
        <div className="onec-check-state error" role="status">
          <strong>Продажи загружены, но чеки временно недоступны.</strong>
          <span>{error}</span>
        </div>
      ) : analytics ? (
        <>
          <div className="onec-check-kpis">
            {cards.map((item) => (
              <article key={item.label}>
                <div>
                  <span>{item.label}</span>
                  {item.change !== null && (
                    <b
                      className={
                        item.change >= 0 ? "trend" : "trend neutral"
                      }
                    >
                      {item.change >= 0 ? "+" : ""}
                      {item.change.toFixed(1)}%
                    </b>
                  )}
                </div>
                <strong>{item.value}</strong>
                <small>{item.note}</small>
              </article>
            ))}
          </div>

          <div className="onec-check-chart-wrap">
            <div className="onec-check-chart-title">
              <strong>Динамика количества чеков</strong>
              <span>Над столбцом — чеки, снизу — средний чек</span>
            </div>
            {analytics.series.some((item) => item.checks > 0) ? (
              <div className="onec-check-chart-outer">
                {/* Y-ось: количество чеков */}
                <div className="onec-check-y-axis" aria-hidden="true">
                  <span>{chartMaximum}</span>
                  <span>{Math.round(chartMaximum / 2)}</span>
                  <span>0</span>
                </div>
                <div
                  className="onec-check-chart"
                  style={{
                    gridTemplateColumns: `repeat(${analytics.series.length}, minmax(34px, 1fr))`,
                  }}
                >
                  {analytics.series.map((item, index) => (
                    <div
                      className="onec-check-column"
                      key={`${item.label}-${index}`}
                    >
                      <b>{item.checks || "—"}</b>
                      <i>
                        <span
                          style={{
                            height: `${Math.max(
                              (item.checks / chartMaximum) * 100,
                              item.checks ? 5 : 0,
                            )}%`,
                          }}
                        />
                      </i>
                      <small>{item.label}</small>
                      <em>
                        {item.checks ? money.format(item.averageCheck) : "—"}
                      </em>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="onec-no-data">
                За выбранный период чеков продаж нет
              </p>
            )}
          </div>

          {analytics.truncated && (
            <p className="onec-check-limit-warning">
              Достигнут лимит загрузки чеков. Увеличьте
              ONEC_CHECK_ANALYTICS_LIMIT в .env для полного расчёта.
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
