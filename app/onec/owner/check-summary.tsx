import type { CheckAnalytics } from "../sales/types";
import type { Period } from "../types";
import { money, number, periodLabel } from "./format";

export function OwnerCheckSummary({
  checks,
  loading,
  error,
  period,
}: {
  checks: CheckAnalytics | null;
  loading: boolean;
  error: string;
  period: Period;
}) {
  if (loading) {
    return (
      <section className="owner-check-strip loading" aria-live="polite">
        <span className="onec-spinner" /> Получаем чеки, скидки и сертификаты…
      </section>
    );
  }

  if (!checks) {
    return (
      <section className="owner-check-strip error">
        <strong>Данные чеков временно недоступны.</strong>
        <span>{error}</span>
      </section>
    );
  }

  return (
    <section className="owner-check-strip" aria-label="Показатели чеков за период">
      <div>
        <span>Чеков · {periodLabel[period]}</span>
        <strong>{number.format(checks.current.checks)}</strong>
      </div>
      <div>
        <span>Продажи по чекам</span>
        <strong>{money.format(checks.current.revenue)}</strong>
      </div>
      <div>
        <span>Чистые продажи</span>
        <strong>{money.format(checks.current.netRevenue)}</strong>
      </div>
      <div>
        <span>Скидки</span>
        <strong>{money.format(checks.current.discounts)}</strong>
        <small>{checks.current.discountShare.toFixed(1)}% · сумма до скидок {money.format(checks.current.grossRevenue)}</small>
      </div>
      <div>
        <span>Сертификаты</span>
        <strong>{money.format(checks.current.certificatePayments)}</strong>
        <small>{number.format(checks.current.certificatesUsed)} погашений</small>
      </div>
      <div>
        <span>Возвраты</span>
        <strong>{money.format(checks.current.returnsAmount)}</strong>
        <small>{number.format(checks.current.returns)} чеков</small>
      </div>
    </section>
  );
}
