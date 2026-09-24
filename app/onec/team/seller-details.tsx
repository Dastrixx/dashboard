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
  const labelStep = Math.max(1, Math.ceil(chart.points.length / 7));
  const lastIndex = chart.points.length - 1;
  const peakIndexes = new Set<number>();
  chart.points
    .map((point, index) => ({ point, index }))
    .filter(({ point, index }) => point.value > 0 &&
      (index === 0 || point.value > chart.points[index - 1].value) &&
      (index === lastIndex || point.value >= chart.points[index + 1].value))
    .sort((left, right) => right.point.value - left.point.value)
    .forEach(({ point, index }) => {
      if (peakIndexes.size < 5 &&
        [...peakIndexes].every((other) => Math.abs(point.x - chart.points[other].x) >= 110)) {
        peakIndexes.add(index);
      }
    });
  return (
    <div className="seller-sales-chart">
      <svg
        aria-label="Динамика продаж продавца"
        role="img"
        viewBox="0 0 720 245"
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
            <stop offset="0%" stopColor="var(--brand-turquoise)" stopOpacity=".24" />
            <stop offset="100%" stopColor="var(--brand-turquoise)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={chart.area} fill="url(#sellerArea)" />
        <polyline
          fill="none"
          points={chart.line}
          stroke="var(--brand-turquoise)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        {chart.points.map((point, index) => (
          <ChartPoint
            point={point}
            key={point.date}
            showDate={index === 0 || index === lastIndex || index % labelStep === 0}
            isPeak={peakIndexes.has(index)}
          />
        ))}
      </svg>
    </div>
  );
}

function ChartPoint({ point, showDate, isPeak }: {
  point: SellerChart["points"][number];
  showDate: boolean;
  isPeak: boolean;
}) {
  return (
    <g>
      <circle
        cx={point.x}
        cy={point.y}
        fill="#fff"
        r="4"
        stroke={isPeak ? "var(--brand-yellow)" : "var(--brand-turquoise)"}
        strokeWidth="2"
      >
        <title>
          {formatChartDate(point.date)} — {money.format(point.value)}
        </title>
      </circle>
      {isPeak && (
        <text className="seller-chart-value" textAnchor="middle"
          x={point.x} y={Math.max(point.y - 12, 17)}>
          {money.format(point.value)}
        </text>
      )}
      {showDate && (
        <text className="seller-chart-label" textAnchor="middle"
          x={Math.max(22, Math.min(point.x, 698))} y="225">
          {formatChartDate(point.date)}
        </text>
      )}
    </g>
  );
}
