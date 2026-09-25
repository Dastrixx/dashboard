import type { MarginAnalyticsResponse } from "../sales/types";
import { money, number } from "../shared";
import { getChannelLabel } from "./config";
import type { SalesChannel, TeamView } from "./types";

type Props = {
  view: TeamView;
  channel: SalesChannel;
  plan: number;
  planPercent: number;
  showPlan?: boolean;
  margin: MarginAnalyticsResponse["items"] | null;
  marginError: string;
};

export function TeamSummary({
  view,
  channel,
  plan,
  planPercent,
  showPlan = true,
  margin,
  marginError,
}: Props) {
  const activeMargin =
    margin?.current?.dataAvailable === true ? margin.current : null;
  const hasMargin = activeMargin !== null;
  const efficiencyPercent = activeMargin?.efficiencyPercent ?? 0;
  const marginNote = hasMargin
    ? [
        `валовая прибыль ${money.format(activeMargin.profit)}`,
        `вычет себестоимости −${money.format(activeMargin.cost)}`,
        `эффективность продаж ${efficiencyPercent.toFixed(1)}%`,
        `скидки −${money.format(activeMargin.discounts)}`,
      ].join(" · ")
    : margin
      ? "1С не вернула себестоимость за период"
      : marginError || "данные регистра 1С";

  return (
    <section className="team-kpi-grid">
      <Kpi
        label="Продажи команды"
        value={money.format(view.revenue)}
        note={[
          `${number.format(view.quantity)} проданных единиц`,
          getChannelLabel(channel),
        ].join(" · ")}
      />
      <Kpi
        label="Чеков команды"
        value={view.checks ? number.format(view.checks) : "—"}
        note="чеки с указанным консультантом"
      />
      <Kpi
        label="Средний чек команды"
        value={view.checks ? money.format(view.averageCheck) : "—"}
        note="продажи / количество чеков"
      />
      {showPlan && <PlanKpi plan={plan} percent={planPercent} />}
      <Kpi
        label="Маржа"
        value={hasMargin ? `${activeMargin.marginPercent.toFixed(1)}%` : "—"}
        note={marginNote}
      />
    </section>
  );
}
export function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Kpi({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="kpi-card">
      <div className="kpi-top">
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

function PlanKpi({ plan, percent }: { plan: number; percent: number }) {
  return (
    <article className="kpi-card">
      <div className="kpi-top">
        <span>Выполнение плана</span>
      </div>
      <strong>{plan ? `${number.format(percent)}%` : "Не задан"}</strong>
      <div className="progress">
        <i style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </article>
  );
}
