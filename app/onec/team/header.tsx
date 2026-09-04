import type { SellerReference } from "../types";
import { CHANNEL_OPTIONS, PERIOD_OPTIONS } from "./config";
import type { Period, SalesChannel } from "./types";

type Props = {
  stores: SellerReference[];
  storeKey: string;
  period: Period;
  channel: SalesChannel;
  onStoreChange: (value: string) => void;
  onPeriodChange: (value: Period) => void;
  onChannelChange: (value: SalesChannel) => void;
};

export function TeamHeader({
  stores,
  storeKey,
  period,
  channel,
  onStoreChange,
  onPeriodChange,
  onChannelChange,
}: Props) {
  return (
    <section className="team-dashboard-head">
      <div>
        <span className="team-plan-kicker">Команда продаж</span>
        <h2>Продавцы</h2>
        <p>
          Рейтинг консультантов, динамика продаж и выполнение плана
          команды
        </p>
      </div>

      <div className="team-filter-groups">
        <StoreSelect
          stores={stores}
          value={storeKey}
          onChange={onStoreChange}
        />
        <PeriodFilter value={period} onChange={onPeriodChange} />
        <ChannelFilter value={channel} onChange={onChannelChange} />
      </div>
    </section>
  );
}

function StoreSelect({
  stores,
  value,
  onChange,
}: {
  stores: SellerReference[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="team-store-select">
      <span>Филиал</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="all">Все филиалы</option>
        {stores.map((store) => (
          <option key={store.Ref_Key} value={store.Ref_Key}>
            {store.Description ?? store.Code ?? "Филиал без названия"}
          </option>
        ))}
      </select>
    </label>
  );
}

function PeriodFilter({
  value,
  onChange,
}: {
  value: Period;
  onChange: (value: Period) => void;
}) {
  return (
    <div
      className="team-segment"
      role="group"
      aria-label="Период плана команды"
    >
      {PERIOD_OPTIONS.map((option) => (
        <button
          className={value === option.value ? "active" : ""}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ChannelFilter({
  value,
  onChange,
}: {
  value: SalesChannel;
  onChange: (value: SalesChannel) => void;
}) {
  return (
    <div
      className="team-segment channel-team"
      role="group"
      aria-label="Канал продаж"
    >
      {CHANNEL_OPTIONS.map((option) => (
        <button
          className={value === option.value ? "active" : ""}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
