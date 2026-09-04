import { money, number } from "../shared";
import { getChannelLabel } from "./config";
import { MiniKpi } from "./summary";
import type { SalesChannel, SellerRow, TeamView } from "./types";

type Props = {
  view: TeamView;
  storeKey: string;
  channel: SalesChannel;
  plan: number;
  planPercent: number;
  planInput: string;
  planLoading: boolean;
  planSaving: boolean;
  planMessage: string;
  source?: string;
  onPlanInputChange: (value: string) => void;
  onSave: () => void;
};

export function TeamPlanPanel({
  view,
  storeKey,
  channel,
  plan,
  planPercent,
  planInput,
  planLoading,
  planSaving,
  planMessage,
  source,
  onPlanInputChange,
  onSave,
}: Props) {
  const maxRevenue = Math.max(
    ...view.rows.map((seller) => seller.revenue),
    1,
  );

  return (
    <section className="panel team-plan-panel">
      <div className="team-plan-panel-head">
        <PlanHeading
          view={view}
          storeKey={storeKey}
          channel={channel}
        />
        <PlanEditor
          value={planInput}
          loading={planLoading}
          saving={planSaving}
          onChange={onPlanInputChange}
          onSave={onSave}
        />
      </div>

      {planMessage && <p className="team-plan-message">{planMessage}</p>}

      <PlanSummary view={view} plan={plan} percent={planPercent} />
      <div className="team-plan-progress large">
        <i style={{ width: `${Math.min(planPercent, 100)}%` }} />
      </div>

      <div className="team-contribution-head">
        <h3>Вклад продавцов в план команды</h3>
        <span>{view.rows.length} продавцов</span>
      </div>
      <div className="team-contribution-list">
        {view.rows.map((seller) => (
          <ContributionRow
            seller={seller}
            plan={plan}
            maxRevenue={maxRevenue}
            key={seller.key}
          />
        ))}
      </div>

      <small className="team-data-source">
        Источник: {source ?? "Document_ЧекККМ.Товары.Продавец_Key"}
      </small>
    </section>
  );
}

function PlanHeading({
  view,
  storeKey,
  channel,
}: {
  view: TeamView;
  storeKey: string;
  channel: SalesChannel;
}) {
  const selectedStore = view.stores.find((store) => store.Ref_Key === storeKey);
  const title =
    storeKey === "all"
      ? "Общий план команды"
      : selectedStore?.Description ?? "План филиала";

  return (
    <div>
      <span className="team-plan-kicker">
        План продаж команды · {getChannelLabel(channel)}
      </span>
      <h2>{title}</h2>
      <p>
        Факт складывается только из личных продаж консультантов
        выбранного канала.
      </p>
    </div>
  );
}

function PlanEditor({
  value,
  loading,
  saving,
  onChange,
  onSave,
}: {
  value: string;
  loading: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="team-plan-editor compact">
      <label>
        <span>Сумма плана, KGS</span>
        <input
          min="0"
          onChange={(event) => onChange(event.target.value)}
          placeholder="1 500 000"
          step="1000"
          type="number"
          value={value}
        />
      </label>
      <button disabled={saving || loading} onClick={onSave} type="button">
        {saving ? "Сохраняем…" : "Сохранить"}
      </button>
    </div>
  );
}

function PlanSummary({
  view,
  plan,
  percent,
}: {
  view: TeamView;
  plan: number;
  percent: number;
}) {
  return (
    <div className="team-plan-summary-grid">
      <MiniKpi label="План" value={plan ? money.format(plan) : "Не задан"} />
      <MiniKpi label="Факт" value={money.format(view.revenue)} />
      <MiniKpi
        label="Выполнение"
        value={plan ? `${number.format(percent)}%` : "—"}
      />
      <MiniKpi
        label="Осталось"
        value={plan ? money.format(Math.max(plan - view.revenue, 0)) : "—"}
      />
    </div>
  );
}

function ContributionRow({
  seller,
  plan,
  maxRevenue,
}: {
  seller: SellerRow;
  plan: number;
  maxRevenue: number;
}) {
  const width = Math.max(
    (seller.revenue / maxRevenue) * 100,
    seller.revenue ? 2 : 0,
  );
  const result = plan
    ? `${number.format((seller.revenue / plan) * 100)}% плана`
    : `${number.format(seller.share)}% команды`;

  return (
    <div className="team-contribution-row">
      <div>
        <strong>{seller.name}</strong>
        <small>{seller.store}</small>
      </div>
      <i>
        <b style={{ width: `${width}%` }} />
      </i>
      <div>
        <strong>{money.format(seller.revenue)}</strong>
        <small>{result}</small>
      </div>
    </div>
  );
}
