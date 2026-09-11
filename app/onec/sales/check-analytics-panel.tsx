import { money, number, PERIODS } from "./config";
import type {
  AnalyticsPeriod,
  CheckAnalytics,
  SalesDateRange,
} from "./types";

type Props = {
  period: AnalyticsPeriod;
  analytics: CheckAnalytics | null;
  loading: boolean;
  error: string;
  dateRange?: SalesDateRange | null;
  reportRevenue?: number;
};

export function CheckAnalyticsPanel({
  period,
  analytics,
  loading,
  error,
  dateRange,
  reportRevenue,
}: Props) {
  const chartMaximum = Math.max(
    ...(analytics?.series.map((item) => item.checks) || []),
    1,
  );
  const reconciliationDifference =
    analytics && reportRevenue !== undefined
      ? Math.abs(analytics.current.netRevenue - reportRevenue)
      : null;
  const sourceLabel = analytics?.source?.startsWith(
    "AccumulationRegister_Продажи",
  )
    ? "РЕГИСТР ПРОДАЖ · ЧЕКИ"
    : "DOCUMENT_ЧЕКККМ";
  const cards = analytics
    ? [
        {
          label: "Всего чеков",
          value: number.format(analytics.current.totalChecks),
          note: [
            `продажи ${number.format(analytics.current.checks)}`,
            `возвраты ${number.format(analytics.current.returns)}`,
          ].join(" · "),
        },
        {
          label: "Средний чек",
          value: money.format(analytics.current.averageCheck),
          note: "по чекам выбранного периода",
        },
        {
          label: "Продажи по чекам",
          value: money.format(analytics.current.revenue),
          note: "сумма чеков продаж, без вычета возвратов",
        },
        {
          label: "Чистые продажи",
          value: money.format(analytics.current.netRevenue),
          note: "продажи по чекам минус возвраты",
        },
        {
          label: "Возвраты",
          value: [
            number.format(analytics.current.returns),
            money.format(analytics.current.returnsAmount),
          ].join(" · "),
          note: "количество и сумма чеков возврата",
        },
        {
          label: "Скидки",
          value: money.format(analytics.current.discounts),
          note: [
            `${analytics.current.discountShare.toFixed(1)}%`,
            "сумма товаров до скидок",
            money.format(analytics.current.grossRevenue),
          ].join(" · "),
        },
        {
          label: "Оплата сертификатами",
          value: analytics.documentDetailsAvailable === false
            ? "—"
            : money.format(analytics.current.certificatePayments),
          note: analytics.documentDetailsAvailable === false
            ? "детализация архивных чеков недоступна"
            : "погашено сертификатов: " +
              number.format(analytics.current.certificatesUsed),
        },
      ]
    : [];

  return (
    <section className="panel onec-check-analytics">
      <div className="panel-head onec-check-head">
        <div>
          <span className="onec-source-kicker">{sourceLabel}</span>
          <h2>Аналитика по чекам</h2>
          <p>
            Количество, средний чек и возвраты{" "}
            {dateRange
              ? `за ${dateRange.from} — ${dateRange.to}`
              : PERIODS[period].caption}
          </p>
        </div>
        {analytics?.latestDate && (
          <span className="onec-period-note">
            Последний чек:{" "}
            {new Date(analytics.latestDate).toLocaleString("ru-RU")}
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
          <strong>
            Продажи загружены, но чеки временно недоступны.
          </strong>
          <span>{error}</span>
        </div>
      ) : analytics?.dataAvailable === false ? (
        <div className="onec-check-state error" role="status">
          <strong>
            Количество чеков и средний чек сейчас недоступны.
          </strong>
          <span>
            В 1С есть розничные отчёты за выбранный период, но
            связанные документы ЧекККМ не опубликованы в OData.
            Продажи выше рассчитаны по проведённым отчётам и
            остаются актуальными.
          </span>
        </div>
      ) : analytics ? (
        <>
          {!analytics.latestDate && analytics.current.totalChecks === 0 && (
            <div className="onec-reference-warning" role="status">
              <strong>
                В Document_ЧекККМ нет чеков за выбранный диапазон.
              </strong>
              <span>
                Продажи продолжают отображаться по
                проведённым документам «Отчёт о розничных продажах».
              </span>
            </div>
          )}
          <div className="onec-check-kpis">
            {cards.map((item) => (
              <article key={item.label}>
                <div>
                  <span>{item.label}</span>
                </div>
                <strong>{item.value}</strong>
                <small>{item.note}</small>
              </article>
            ))}
          </div>

          {reconciliationDifference !== null &&
            reconciliationDifference > 0.5 && (
              <div className="onec-reference-warning" role="status">
                <strong>Сверка с розничным отчётом</strong>
                <span>
                  Расхождение чистых продаж: {money.format(
                    reconciliationDifference,
                  )}
                  . Финансовый итог берётся из проведённого
                  розничного отчёта.
                </span>
              </div>
            )}

          <div className="onec-check-chart-wrap">
            <div className="onec-check-chart-title">
              <strong>Динамика количества чеков</strong>
              <span>
                Над столбцом — чеки, снизу — средний чек
              </span>
            </div>
            {analytics.seriesAvailable === false ? (
              <p className="onec-no-data">
                Итоги чеков восстановлены из регистра продаж.
                Дневная разбивка для архивных чеков
                недоступна.
              </p>
            ) : analytics.series.some((item) => item.checks > 0) ? (
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
