import { money } from "../shared";
import { formatChartDate, getChannelLabel } from "./config";
import { MiniKpi } from "./summary";
import type {
  SalesChannel,
  SellerChart,
  SellerRow,
} from "./types";

type Props = {
  rows: SellerRow[];
  selected?: SellerRow;
  chart: SellerChart;
  channel: SalesChannel;
  onSellerChange: (key: string) => void;
};

export function SellerDetails({
  rows,
  selected,
  chart,
  channel,
  onSellerChange,
}: Props) {
  return (
    <article className="panel seller-detail-panel">
      <SellerDetailsHeader
        rows={rows}
        selected={selected}
        channel={channel}
        onSellerChange={onSellerChange}
      />
      <SellerMetrics seller={selected} />
      <SellerSalesChart seller={selected} chart={chart} />
    </article>
  );
}
function SellerDetailsHeader({
  rows,
  selected,
  channel,
  onSellerChange,
}: {
  rows: SellerRow[];
  selected?: SellerRow;
  channel: SalesChannel;
  onSellerChange: (key: string) => void;
}) {
  return (
    <div className="seller-detail-head">
      <div>
        <span className="team-plan-kicker">Аналитика продавца</span>
        <h2>{selected?.name ?? "Нет продаж"}</h2>
        <p>{selected?.store ?? getChannelLabel(channel)}</p>
      </div>

      <label className="seller-picker">
        <span>Выбрать продавца</span>
        <select
          disabled={!rows.length}
          value={selected?.key ?? ""}
          onChange={(event) => onSellerChange(event.target.value)}
        >
          {rows.map((seller) => (
            <option key={seller.key} value={seller.key}>
              {seller.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function SellerMetrics({ seller }: { seller?: SellerRow }) {
  const averageCheck = seller?.checks
    ? money.format(seller.revenue / seller.checks)
    : "—";

  return (
    <div className="seller-mini-kpis">
      <MiniKpi label="Выручка" value={money.format(seller?.revenue ?? 0)} />
      <MiniKpi label="Средний чек" value={averageCheck} />
      <MiniKpi
        label="Скидки"
        value={money.format(seller?.discounts ?? 0)}
      />
      <MiniKpi label="Место" value={`#${seller?.rank ?? "—"}`} />
    </div>
  );
}

function SellerSalesChart({
  seller,
  chart,
}: {
  seller?: SellerRow;
  chart: SellerChart;
}) {
  const hasChart = seller && Object.keys(seller.daily).length > 0;

  return (
    <>
      <div className="seller-chart-head">
        <div>
          <h3>Динамика продаж</h3>
          <p>Продажи выбранного продавца за выбранный период</p>
        </div>
        <span className="legend-dot">Фактические продажи</span>
      </div>

      {hasChart ? (
        <ChartSvg chart={chart} />
      ) : (
        <div className="seller-chart-empty">
          График появится, когда в данных 1С заполнен продавец товарной
          строки.
        </div>
      )}
    </>
  );
}

function ChartSvg({ chart }: { chart: SellerChart }) {
  return (
    <div className="seller-sales-chart">
      <svg
        aria-label="Динамика продаж продавца"
        role="img"
        viewBox="0 0 720 220"
      >
        {[30, 70, 110, 150, 190].map((y) => (
          <line
            className="gridline"
            key={y}
            x1="10"
            x2="710"
            y1={y}
            y2={y}
          />
        ))}
        <defs>
          <linearGradient id="sellerArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#0b7a55" stopOpacity=".24" />
            <stop offset="100%" stopColor="#0b7a55" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={chart.area} fill="url(#sellerArea)" />
        <polyline
          fill="none"
          points={chart.line}
          stroke="#0b7a55"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        {chart.points.map((point) => (
          <ChartPoint point={point} key={point.date} />
        ))}
      </svg>
    </div>
  );
}

function ChartPoint({ point }: { point: SellerChart["points"][number] }) {
  return (
    <g>
      <circle
        cx={point.x}
        cy={point.y}
        fill="#fff"
        r="4"
        stroke="#0b7a55"
        strokeWidth="2"
      >
        <title>
          {formatChartDate(point.date)} — {money.format(point.value)}
        </title>
      </circle>
      <text
        className="seller-chart-label"
        textAnchor="middle"
        x={point.x}
        y="211"
      >
        {formatChartDate(point.date)}
      </text>
    </g>
  );
}
