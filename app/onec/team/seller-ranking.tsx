import { money, number } from "../shared";
import { getChannelLabel } from "./config";
import type { SalesChannel, SellerRow } from "./types";

type Props = {
  rows: SellerRow[];
  selectedKey: string;
  channel: SalesChannel;
  plan: number;
  onSellerChange: (key: string) => void;
};

export function SellerRanking({
  rows,
  selectedKey,
  channel,
  plan,
  onSellerChange,
}: Props) {
  return (
    <article className="panel team-ranking-panel">
      <div className="panel-head">
        <div>
          <h2>Рейтинг продавцов</h2>
          <p>Только консультанты, без кассиров</p>
        </div>
      </div>

      <div className="team-ranking-list">
        {rows.length ? (
          rows.map((seller) => (
            <SellerRankingRow
              seller={seller}
              selected={selectedKey === seller.key}
              plan={plan}
              onSelect={onSellerChange}
              key={seller.key}
            />
          ))
        ) : (
          <div className="team-channel-empty">
            За выбранный период продаж в канале «{getChannelLabel(channel)}»
            нет.
          </div>
        )}
      </div>
    </article>
  );
}
function SellerRankingRow({
  seller,
  selected,
  plan,
  onSelect,
}: {
  seller: SellerRow;
  selected: boolean;
  plan: number;
  onSelect: (key: string) => void;
}) {
  const result = plan
    ? `${number.format((seller.revenue / plan) * 100)}% плана`
    : `${number.format(seller.share)}% команды`;

  return (
    <button
      className={`team-rank-button ${selected ? "active" : ""}`}
      onClick={() => onSelect(seller.key)}
      type="button"
    >
      <span className="team-rank-place">{seller.rank}</span>
      <span className="team-rank-person">
        <strong>{seller.name}</strong>
        <small>{seller.store}</small>
      </span>
      <span className="team-rank-result">
        <strong>{money.format(seller.revenue)}</strong>
        <small>{result}</small>
      </span>
    </button>
  );
}
