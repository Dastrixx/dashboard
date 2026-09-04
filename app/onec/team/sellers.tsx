import { SellerDetails } from "./seller-details";
import { SellerRanking } from "./seller-ranking";
import type {
  SalesChannel,
  SellerChart,
  SellerRow,
  TeamView,
} from "./types";

type Props = {
  view: TeamView;
  selected?: SellerRow;
  selectedKey: string;
  chart: SellerChart;
  channel: SalesChannel;
  plan: number;
  onSellerChange: (key: string) => void;
};

export function SellerWorkspace({
  view,
  selected,
  selectedKey,
  chart,
  channel,
  plan,
  onSellerChange,
}: Props) {
  return (
    <section className="team-dashboard-grid">
      <SellerRanking
        rows={view.rows}
        selectedKey={selectedKey}
        channel={channel}
        plan={plan}
        onSellerChange={onSellerChange}
      />
      <SellerDetails
        rows={view.rows}
        selected={selected}
        chart={chart}
        channel={channel}
        onSellerChange={onSellerChange}
      />
    </section>
  );
}
