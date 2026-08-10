"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  ChartNoAxesCombined,
  CheckCircle2,
  Download,
  Filter,
  Globe2,
  Home,
  LogOut,
  Menu,
  PackageSearch,
  Search,
  Users,
  X,
} from "lucide-react";
import {
  categories,
  defects,
  deliveries,
  hourLabels,
  hourlyActual,
  hourlyUsual,
  incomingWeeks,
  money,
  number,
  productPeriodAnalytics,
  productRevenueTotal,
  products,
  reconciliation,
  sellers,
  trendByPeriod,
  weekdayComparison,
  type Product,
  type ProductAnalyticsPeriod,
  type ProductStatus,
} from "./dashboard-data";
import { OnecSales } from "./onec-sales";

type Role = "owner" | "manager";
type Section =
  | "overview"
  | "products"
  | "stock"
  | "team"
  | "procurement"
  | "online";
type Session = { role: Role; name: string; email: string };
type Period = 7 | 30 | 90;
type TeamFilter = "all" | "online" | "offline";
type TeamPeriod = "hour" | "day" | "week" | "month";
type WarehouseFilter = "all" | "sales-floor" | "warehouse";

const WAREHOUSE_LABELS: Record<WarehouseFilter, string> = {
  all: "Все",
  "sales-floor": "Торговый зал",
  warehouse: "Склад",
};

const STATUS_OPTIONS: ("Все" | ProductStatus)[] = [
  "Все",
  "В наличии",
  "Мало",
  "Без движения",
  "Нет в наличии",
];

function Icon({ name }: { name: string }) {
  const icons: Record<string, typeof Home> = {
    overview: Home,
    products: PackageSearch,
    stock: Boxes,
    team: Users,
    procurement: ArrowLeftRight,
    online: Globe2,
    search: Search,
  };
  const Component = icons[name] || ChartNoAxesCombined;
  return <Component className="icon" aria-hidden strokeWidth={1.8} />;
}

function KpiCard({
  label,
  value,
  delta,
  note,
  tone = "good",
  progress,
}: {
  label: string;
  value: string;
  delta?: string;
  note?: string;
  tone?: "good" | "warn" | "neutral";
  progress?: number;
}) {
  return (
    <article className="kpi-card">
      <div className="kpi-top">
        <span>{label}</span>
        {delta && <b className={`trend ${tone}`}>{delta}</b>}
      </div>
      <strong>{value}</strong>
      {note && <p>{note}</p>}
      {progress !== undefined && (
        <div className="progress" aria-label={`Выполнено ${progress}%`}>
          <i style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
      )}
    </article>
  );
}

function TrendChart({
  current,
  previous,
  compact = false,
}: {
  current: number[];
  previous?: number[];
  compact?: boolean;
}) {
  const allValues = previous ? [...current, ...previous] : current;
  const min = Math.min(...allValues) * 0.88;
  const max = Math.max(...allValues) * 1.05;
  const points = (values: number[]) =>
    values
      .map((value, index) => {
        const x = (index / Math.max(values.length - 1, 1)) * 100;
        const y = 84 - ((value - min) / Math.max(max - min, 1)) * 70;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  const currentPoints = points(current);
  const previousPoints = previous ? points(previous) : "";
  const peakValue = Math.max(...current);

  return (
    <div className={compact ? "line-chart small" : "line-chart"}>
      <div
        className="trend-peak"
        aria-label={`Максимальная выручка ${money(peakValue)}`}
      >
        <span>Максимум</span>
        <strong>{money(peakValue)}</strong>
      </div>
      <div className="axis-labels">
        <span>{number(max / 1000)} тыс.</span>
        <span>{number((max + min) / 2000)} тыс.</span>
        <span>{number(min / 1000)} тыс.</span>
      </div>
      <svg
        viewBox="0 0 100 90"
        preserveAspectRatio="none"
        aria-label="График динамики выручки"
      >
        <defs>
          <linearGradient
            id={`trend-fill-${current.length}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0" stopColor="#0b7a55" stopOpacity=".2" />
            <stop offset="1" stopColor="#0b7a55" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[18, 40, 62, 84].map((y) => (
          <line key={y} x1="0" y1={y} x2="100" y2={y} className="gridline" />
        ))}
        <polygon
          points={`0,90 ${currentPoints} 100,90`}
          fill={`url(#trend-fill-${current.length})`}
        />
        {previous && (
          <polyline
            points={previousPoints}
            fill="none"
            stroke="#a8b4ae"
            strokeWidth="1.6"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline
          points={currentPoints}
          fill="none"
          stroke="#0b7a55"
          strokeWidth="2.2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="x-labels">
        <span>Начало</span>
        <span>Середина</span>
        <span>Сегодня</span>
      </div>
    </div>
  );
}

function ComparisonChart({
  data = weekdayComparison,
}: {
  data?: { label: string; current: number; previous: number }[];
}) {
  const max = Math.max(
    ...data.flatMap((item) => [item.current, item.previous]),
  );
  const compactMoney = (value: number) =>
    value >= 1_000_000
      ? `${(value / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн с`
      : `${number(Math.round(value / 1000))} тыс. с`;
  return (
    <div
      className="comparison-chart"
      style={{
        gridTemplateColumns: `repeat(${data.length}, minmax(70px, 1fr))`,
      }}
    >
      <span className="chart-y-title">Сумма, с</span>
      {data.map((item) => (
        <div className="comparison-day" key={item.label}>
          <div className="comparison-bars">
            <div
              className="comparison-bar current-bar"
              title={`Текущий период: ${money(item.current)}`}
            >
              <b>{compactMoney(item.current)}</b>
              <i
                className="current"
                style={{ height: `${(item.current / max) * 100}%` }}
              />
            </div>
            <div
              className="comparison-bar previous-bar"
              title={`Предыдущий период: ${money(item.previous)}`}
            >
              <b>{compactMoney(item.previous)}</b>
              <i
                className="previous"
                style={{ height: `${(item.previous / max) * 100}%` }}
              />
            </div>
          </div>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function HourlyChart({ actual = hourlyActual }: { actual?: number[] }) {
  const max = Math.max(...actual, ...hourlyUsual);
  return (
    <div className="hourly-chart">
      {hourLabels.map((label, index) => (
        <div className="hour-column" key={label}>
          <div className="hour-bars">
            <i
              className="usual"
              style={{ height: `${(hourlyUsual[index] / max) * 100}%` }}
            />
            {actual[index] > 0 && (
              <i
                className="actual"
                style={{ height: `${(actual[index] / max) * 100}%` }}
              />
            )}
          </div>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function HorizontalBars({
  items,
  valueFormatter = money,
  amber = false,
}: {
  items: { label: string; value: number; sub?: string }[];
  valueFormatter?: (value: number) => string;
  amber?: boolean;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="horizontal-list">
      {items.map((item) => (
        <div className="horizontal-item" key={item.label}>
          <div className="horizontal-head">
            <div>
              <strong>{item.label}</strong>
              {item.sub && <span>{item.sub}</span>}
            </div>
            <b>{valueFormatter(item.value)}</b>
          </div>
          <div className="horizontal-track">
            <i
              className={amber ? "amber" : ""}
              style={{ width: `${Math.max(3, (item.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function OwnerOverview({ period }: { period: Period }) {
  const trend = trendByPeriod[period];
  const revenue = trend.current.reduce((sum, value) => sum + value, 0);
  const previousRevenue = trend.previous.reduce((sum, value) => sum + value, 0);
  const growth = ((revenue - previousRevenue) / previousRevenue) * 100;
  const receipts = Math.round(revenue / 29840);
  const categoryItems = categories.map((category) => ({
    label: category.name,
    value: Math.round((revenue * category.share) / 100),
    sub: `${category.share}% выручки`,
  }));

  return (
    <div className="page-stack">
      <section className="today-hero">
        <div className="today-hero-head">
          <div>
            <span className="live-label">
              <i /> Сегодня, 23 июля · по состоянию на 16:00
            </span>
            <h2>Темп продаж сегодня</h2>
            <p>Факт по часам и обычный темп магазина</p>
          </div>
          <div className="chart-key">
            <span>
              <i className="actual" />
              Факт
            </span>
            <span>
              <i className="usual" />
              Обычно
            </span>
          </div>
        </div>
        <div className="hero-metrics">
          <div>
            <span>Выручка сегодня</span>
            <strong>486 240 с</strong>
            <small className="positive">+12,8% к вчера</small>
          </div>
          <div>
            <span>Чеков сегодня</span>
            <strong>31</strong>
            <small>на 4 больше</small>
          </div>
          <div>
            <span>Средний чек</span>
            <strong>15 685 с</strong>
            <small className="positive">+6,2%</small>
          </div>
          <div>
            <span>Прогноз на день</span>
            <strong>742 000 с</strong>
            <small>66% плана</small>
          </div>
        </div>
        <HourlyChart />
      </section>

      <section className="kpi-grid">
        <KpiCard
          label={`Выручка за ${period} дней`}
          value={money(revenue)}
          delta={`+${growth.toFixed(1)}%`}
          note="к предыдущему периоду"
        />
        <KpiCard
          label={`Чеков за ${period} дней`}
          value={number(receipts)}
          delta="+7,2%"
          note="к предыдущему периоду"
        />
        <KpiCard
          label="Средний чек"
          value={money(revenue / receipts)}
          delta="+3,1%"
          note="динамика за период"
        />
        <KpiCard
          label="Выполнение плана"
          value="104%"
          delta="План выполнен"
          note="по текущему темпу"
          progress={100}
        />
      </section>

      <section className="charts-grid">
        <article className="panel wide">
          <div className="panel-head">
            <div>
              <h2>Динамика выручки</h2>
              <p>Текущий период в сравнении с предыдущим</p>
            </div>
            <div className="chart-key compact">
              <span>
                <i className="actual" />
                Текущий
              </span>
              <span>
                <i className="previous" />
                Предыдущий
              </span>
            </div>
          </div>
          <TrendChart current={trend.current} previous={trend.previous} />
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>На чём зарабатываем</h2>
              <p>Продажи по категориям за выбранный период</p>
            </div>
          </div>
          <HorizontalBars items={categoryItems} />
        </article>
      </section>

      <section className="lower-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Средняя выручка по дням</h2>
              <p>Текущие 30 дней против предыдущих</p>
            </div>
            <div className="chart-key compact">
              <span>
                <i className="actual" />
                Сейчас
              </span>
              <span>
                <i className="previous" />
                Раньше
              </span>
            </div>
          </div>
          <ComparisonChart />
        </article>
        <article className="panel insights">
          <div className="panel-head">
            <div>
              <h2>Что важно знать</h2>
              <p>Короткая сводка без операционных деталей</p>
            </div>
          </div>
          <div className="insight good">
            <b>Продажи растут</b>
            <span>
              Выручка за период выше предыдущего на {growth.toFixed(1)}%
            </span>
          </div>
          <div className="insight warn">
            <b>Есть риск дефицита</b>
            <span>6 SKU закончились или скоро закончатся</span>
          </div>
          <div className="insight">
            <b>Качество под контролем</b>
            <span>За 30 дней зафиксировано 8 единиц брака</span>
          </div>
          <div className="insight good">
            <b>Команда выполняет план</b>
            <span>Средний показатель продавцов — 95%</span>
          </div>
        </article>
      </section>
    </div>
  );
}

function Products() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [period, setPeriod] = useState<ProductAnalyticsPeriod>("month");
  const [rankingPeriod, setRankingPeriod] =
    useState<ProductAnalyticsPeriod>("month");
  const [topLimit, setTopLimit] = useState(10);
  const [antiTopLimit, setAntiTopLimit] = useState(10);
  const analytics = productPeriodAnalytics[period];
  const rankingAnalytics = productPeriodAnalytics[rankingPeriod];
  const periodRevenue = Math.round(productRevenueTotal * analytics.factor);
  const periodSold = Math.round(
    products.reduce((sum, product) => sum + product.sold30, 0) *
      analytics.factor,
  );
  const currentTotal = analytics.comparison.reduce(
    (sum, item) => sum + item.current,
    0,
  );
  const previousTotal = analytics.comparison.reduce(
    (sum, item) => sum + item.previous,
    0,
  );
  const growth = ((currentTotal - previousTotal) / previousTotal) * 100;
  const pool = category
    ? products.filter((product) => product.category === category)
    : products;
  const topRanked = [...pool].sort((a, b) => b.revenue30 - a.revenue30);
  const antiTopRanked = [...pool]
    .filter((product) => product.stock > 0)
    .sort((a, b) => a.sold30 - b.sold30);
  const top = topRanked.slice(0, topLimit);
  const antiTop = antiTopRanked.slice(0, antiTopLimit);
  const filtered = [...pool]
    .sort((a, b) => b.revenue30 - a.revenue30)
    .filter((product) =>
      `${product.name} ${product.article}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  const poolRevenue =
    pool.reduce((sum, product) => sum + product.revenue30, 0) || 1;
  const abc = (["A", "B", "C"] as const).map((abcClass) => {
    const abcProducts = pool.filter((product) => product.abc === abcClass);
    return {
      abcClass,
      count: abcProducts.length,
      revenue: abcProducts.reduce((sum, product) => sum + product.revenue30, 0),
    };
  });
  const categoryItems = categories.map((item) => ({
    label: item.name,
    value: Math.round((periodRevenue * item.share) / 100),
    sub: `${item.share}% выручки`,
  }));
  const scaledRevenue = (product: Product) =>
    Math.round(product.revenue30 * analytics.factor);
  const scaledSold = (product: Product) =>
    Math.max(1, Math.round(product.sold30 * analytics.factor));
  const rankingRevenue = (product: Product) =>
    Math.round(product.revenue30 * rankingAnalytics.factor);
  const rankingSold = (product: Product) =>
    Math.max(1, Math.round(product.sold30 * rankingAnalytics.factor));

  useEffect(() => {
    setTopLimit(10);
    setAntiTopLimit(10);
  }, [category, rankingPeriod]);

  const exportRanking = (kind: "top" | "anti") => {
    const ranked = kind === "top" ? topRanked : antiTopRanked;
    const periodSlug = { day: "day", week: "week", month: "month" }[
      rankingPeriod
    ];
    const rows =
      kind === "top"
        ? [
            [
              "Место",
              "Артикул",
              "Товар",
              "Категория",
              "Продано",
              "Выручка, сом",
            ],
            ...ranked.map((product, index) => [
              index + 1,
              product.article,
              product.name,
              product.category,
              rankingSold(product),
              rankingRevenue(product),
            ]),
          ]
        : [
            ["Место", "Артикул", "Товар", "Категория", "Остаток", "Продано"],
            ...ranked.map((product, index) => [
              index + 1,
              product.article,
              product.name,
              product.category,
              product.stock,
              rankingSold(product),
            ]),
          ];
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n")}`;
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${kind === "top" ? "top-products" : "anti-top-products"}-${periodSlug}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <OnecSales />

      <div className="page-stack">
        <section
          className="analytics-filter-bar"
          aria-label="Фильтры аналитики"
        >
          <div className="filter-copy">
            <span>Период анализа</span>
            <strong>{analytics.label}</strong>
          </div>
          <div
            className="period-switch"
            role="group"
            aria-label="Выбрать период"
          >
            {(
              Object.keys(productPeriodAnalytics) as ProductAnalyticsPeriod[]
            ).map((key) => (
              <button
                key={key}
                className={period === key ? "active" : ""}
                aria-pressed={period === key}
                onClick={() => setPeriod(key)}
              >
                {productPeriodAnalytics[key].label}
              </button>
            ))}
          </div>
        </section>

        <section className="kpi-grid product-kpis">
          <KpiCard
            label={`Выручка ${analytics.caption}`}
            value={money(periodRevenue)}
            delta={`+${growth.toFixed(1)}%`}
            note="к предыдущему периоду"
          />
          <KpiCard
            label={`Продано ${analytics.caption}`}
            value={`${number(periodSold)} ед.`}
            delta="+6,4%"
            note="по всем категориям"
          />
          <KpiCard
            label="Средняя цена товара"
            value={money(periodRevenue / Math.max(periodSold, 1))}
            delta="+2,8%"
            note="за выбранный период"
          />
          <KpiCard
            label="Активных SKU"
            value={number(analytics.activeSku)}
            delta={`${products.length} всего`}
            tone="neutral"
            note="были продажи за период"
          />
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Сравнительный анализ</h2>
              <p>{analytics.comparisonText}</p>
            </div>
            <div className="chart-key compact">
              <span>
                <i className="actual" />
                Текущий
              </span>
              <span>
                <i className="previous" />
                Предыдущий
              </span>
            </div>
          </div>
          <ComparisonChart data={analytics.comparison} />
        </section>

        <section className="charts-grid product-charts">
          <article className="panel wide">
            <div className="panel-head">
              <div>
                <h2>Динамика выручки</h2>
                <p>
                  {analytics.caption.charAt(0).toUpperCase() +
                    analytics.caption.slice(1)}{" "}
                  в сравнении с предыдущим периодом
                </p>
              </div>
              <div className="chart-key compact">
                <span>
                  <i className="actual" />
                  Текущий
                </span>
                <span>
                  <i className="previous" />
                  Предыдущий
                </span>
              </div>
            </div>
            <TrendChart
              current={analytics.current}
              previous={analytics.previous}
            />
          </article>
          <article className="panel">
            <div className="panel-head">
              <div>
                <h2>Продажи по категориям</h2>
                <p>Структура выручки {analytics.caption}</p>
              </div>
            </div>
            <HorizontalBars items={categoryItems} />
          </article>
        </section>

        <div className="section-toolbar">
          <div>
            <h2>Рейтинг товаров</h2>
            <p>Выручка и спрос {rankingAnalytics.caption}</p>
          </div>
          <div className="ranking-toolbar-actions">
            <label className="select-control ranking-category">
              <Filter size={15} />
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                aria-label="Категория товаров"
              >
                <option value="">Все категории</option>
                {categories.map((item) => (
                  <option value={item.name} key={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div
              className="period-switch rating-period"
              role="group"
              aria-label="Период рейтинга товаров"
            >
              {(
                Object.keys(productPeriodAnalytics) as ProductAnalyticsPeriod[]
              ).map((key) => (
                <button
                  key={key}
                  className={rankingPeriod === key ? "active" : ""}
                  aria-pressed={rankingPeriod === key}
                  onClick={() => setRankingPeriod(key)}
                >
                  {productPeriodAnalytics[key].label}
                </button>
              ))}
            </div>
            <span className="period-result">
              {pool.length} SKU · {category || "все категории"}
            </span>
          </div>
        </div>

        <section className="split-cards">
          <article className="panel ranking">
            <div className="panel-head">
              <div>
                <h2>Топ товаров по выручке</h2>
                <p>Что приносит основные деньги {rankingAnalytics.caption}</p>
              </div>
              <div className="ranking-actions">
                <button
                  className="export-button"
                  onClick={() => exportRanking("top")}
                >
                  <Download size={14} />
                  Выгрузить
                </button>
                <span className="tag green">ТОП</span>
              </div>
            </div>
            {top.map((product, index) => (
              <div className="rank-row" key={product.article}>
                <b>{index + 1}</b>
                <div>
                  <strong>{product.name}</strong>
                  <span>
                    {product.article} · {rankingSold(product)} шт.
                  </span>
                </div>
                <em>{money(rankingRevenue(product))}</em>
              </div>
            ))}
            {topRanked.length > 10 && (
              <button
                className="show-more"
                onClick={() =>
                  setTopLimit(
                    topLimit >= topRanked.length
                      ? 10
                      : Math.min(topLimit + 10, topRanked.length),
                  )
                }
              >
                <span>
                  {topLimit >= topRanked.length
                    ? "Свернуть"
                    : `Ещё ${Math.min(10, topRanked.length - topLimit)}`}
                </span>
                <small>
                  Показано {Math.min(topLimit, topRanked.length)} из{" "}
                  {topRanked.length}
                </small>
              </button>
            )}
          </article>
          <article className="panel ranking">
            <div className="panel-head">
              <div>
                <h2>Антитоп: товары без спроса</h2>
                <p>
                  Есть в наличии, но почти не продаются{" "}
                  {rankingAnalytics.caption}
                </p>
              </div>
              <div className="ranking-actions">
                <button
                  className="export-button"
                  onClick={() => exportRanking("anti")}
                >
                  <Download size={14} />
                  Выгрузить
                </button>
                <span className="tag amber">НА АКЦИЮ</span>
              </div>
            </div>
            {antiTop.map((product, index) => (
              <div className="rank-row" key={product.article}>
                <b>{index + 1}</b>
                <div>
                  <strong>{product.name}</strong>
                  <span>{product.stock} шт. в наличии</span>
                </div>
                <em>{rankingSold(product)} продаж</em>
              </div>
            ))}
            {antiTopRanked.length > 10 && (
              <button
                className="show-more"
                onClick={() =>
                  setAntiTopLimit(
                    antiTopLimit >= antiTopRanked.length
                      ? 10
                      : Math.min(antiTopLimit + 10, antiTopRanked.length),
                  )
                }
              >
                <span>
                  {antiTopLimit >= antiTopRanked.length
                    ? "Свернуть"
                    : `Ещё ${Math.min(10, antiTopRanked.length - antiTopLimit)}`}
                </span>
                <small>
                  Показано {Math.min(antiTopLimit, antiTopRanked.length)} из{" "}
                  {antiTopRanked.length}
                </small>
              </button>
            )}
          </article>
        </section>

        <section className="panel abc">
          <div className="panel-head">
            <div>
              <h2>ABC-анализ ассортимента</h2>
              <p>A — ядро выручки, C — кандидаты на сокращение</p>
            </div>
          </div>
          <div className="abc-cards">
            {abc.map((item) => (
              <div className={item.abcClass.toLowerCase()} key={item.abcClass}>
                <b>{item.abcClass}</b>
                <strong>
                  {((item.revenue / poolRevenue) * 100).toFixed(0)}%
                </strong>
                <span>{item.count} SKU</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel table-panel">
          <div className="table-toolbar">
            <div>
              <h2>Таблица ABC-анализа</h2>
              <p>{filtered.length} позиций</p>
            </div>
            <label className="search">
              <Icon name="search" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по названию или артикулу"
              />
            </label>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Артикул</th>
                  <th>Товар</th>
                  <th>Категория</th>
                  <th>Выручка · {analytics.label}</th>
                  <th>Продано</th>
                  <th>Доля</th>
                  <th>ABC</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((product) => (
                  <tr key={product.article}>
                    <td>
                      <code>{product.article}</code>
                    </td>
                    <td>
                      <strong>{product.name}</strong>
                    </td>
                    <td>{product.category}</td>
                    <td>{money(scaledRevenue(product))}</td>
                    <td>{scaledSold(product)} шт.</td>
                    <td>
                      {((product.revenue30 / poolRevenue) * 100).toFixed(1)}%
                    </td>
                    <td>
                      <span
                        className={`abc-badge ${product.abc.toLowerCase()}`}
                      >
                        {product.abc}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: ProductStatus }) {
  const className =
    status === "В наличии"
      ? "success"
      : status === "Мало"
        ? "warning"
        : status === "Без движения"
          ? "stale"
          : "danger";
  return <span className={`status ${className}`}>{status}</span>;
}

function WarehouseSelector({
  value,
  onChange,
}: {
  value: WarehouseFilter;
  onChange: (value: WarehouseFilter) => void;
}) {
  return (
    <div
      className="warehouse-selector"
      role="group"
      aria-label="Фильтр по складам"
    >
      {(Object.entries(WAREHOUSE_LABELS) as [WarehouseFilter, string][]).map(
        ([key, label]) => (
          <button
            type="button"
            className={value === key ? "active" : ""}
            aria-pressed={value === key}
            onClick={() => onChange(key)}
            key={key}
          >
            {label}
          </button>
        ),
      )}
    </div>
  );
}

function locationMetrics(product: Product, warehouse: WarehouseFilter) {
  const stock =
    warehouse === "sales-floor"
      ? product.salesFloorStock
      : warehouse === "warehouse"
        ? product.warehouseStock
        : product.stock;
  const sold =
    warehouse === "sales-floor"
      ? product.salesFloorSold30
      : warehouse === "warehouse"
        ? product.warehouseIssued30
        : product.sold30;
  const initialStock = stock + sold;
  const remainingPercent =
    initialStock > 0 ? (stock / initialStock) * 100 : 100;
  const averageTarget = Math.ceil((initialStock + sold) / 2);
  const recommended = Math.max(0, averageTarget - stock);
  const status: ProductStatus =
    stock === 0
      ? "Нет в наличии"
      : stock < 15
        ? "Мало"
        : product.idleDays >= 15
          ? "Без движения"
          : "В наличии";
  return {
    stock,
    sold,
    initialStock,
    remainingPercent,
    averageTarget,
    recommended,
    status,
  };
}

function Stock() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("Все");
  const [warehouse, setWarehouse] = useState<WarehouseFilter>("all");
  const filtered = products
    .filter((product) => !category || product.category === category)
    .filter(
      (product) =>
        status === "Все" ||
        locationMetrics(product, warehouse).status === status,
    )
    .filter((product) =>
      `${product.name} ${product.article}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        locationMetrics(a, warehouse).stock -
        locationMetrics(b, warehouse).stock,
    );
  const warehouseMetrics = products.map((product) =>
    locationMetrics(product, warehouse),
  );
  const mismatches = reconciliation.filter(
    (item) => item.base !== item.fact,
  ).length;

  return (
    <div className="page-stack">
      <section className="kpi-grid">
        <KpiCard
          label="Всего SKU на складе"
          value={number(products.length)}
          note="активных позиций"
        />
        <KpiCard
          label="Нулевой остаток"
          value={number(
            warehouseMetrics.filter((item) => item.status === "Нет в наличии")
              .length,
          )}
          delta="Дозаказать"
          tone="warn"
          note={WAREHOUSE_LABELS[warehouse].toLowerCase()}
        />
        <KpiCard
          label="Осталось мало"
          value={number(
            warehouseMetrics.filter((item) => item.status === "Мало").length,
          )}
          delta="<15 шт."
          tone="warn"
          note="скоро закончатся"
        />
        <KpiCard
          label="Без движения"
          value={number(
            products.filter((item) => item.status === "Без движения").length,
          )}
          delta="15+ дней"
          tone="neutral"
          note="кандидаты на акцию"
        />
      </section>

      <section className="panel table-panel">
        <div className="inventory-head">
          <div>
            <h2>Остатки по SKU</h2>
            <p>Поиск, категория, место хранения и состояние запасов</p>
          </div>
          <div className="inventory-head-actions">
            <WarehouseSelector value={warehouse} onChange={setWarehouse} />
            <span>
              {filtered.length} из {products.length}
            </span>
          </div>
        </div>
        <div className="inventory-controls">
          <label className="search">
            <Icon name="search" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Название или артикул"
            />
          </label>
          <label className="select-control">
            <Filter size={15} />
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">Все категории</option>
              {categories.map((item) => (
                <option key={item.name}>{item.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="filter-chips">
          {STATUS_OPTIONS.map((item) => (
            <button
              className={status === item ? "active" : ""}
              onClick={() => setStatus(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Артикул</th>
                <th>Товар</th>
                <th>Место</th>
                <th>Категория</th>
                <th>Остаток</th>
                <th>Без движения</th>
                <th>Статус</th>
                <th>Рекомендация</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => {
                const metrics = locationMetrics(product, warehouse);
                return (
                  <tr key={product.article}>
                    <td>
                      <code>{product.article}</code>
                    </td>
                    <td>
                      <strong>{product.name}</strong>
                    </td>
                    <td>
                      <span className="location-badge">
                        {WAREHOUSE_LABELS[warehouse]}
                      </span>
                    </td>
                    <td>{product.category}</td>
                    <td>{metrics.stock} шт.</td>
                    <td>{product.idleDays} дн.</td>
                    <td>
                      <StatusBadge status={metrics.status} />
                    </td>
                    <td>
                      {metrics.remainingPercent <= 50
                        ? `Попадёт в заявку · ${metrics.remainingPercent.toFixed(0)}%`
                        : "Запас достаточный"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="section-toolbar">
        <div>
          <h2>Приход товара</h2>
          <p>Последние 8 недель и документы поставок</p>
        </div>
      </div>
      <section className="charts-grid">
        <article className="panel wide">
          <div className="panel-head">
            <div>
              <h2>SKU в приходе по неделям</h2>
              <p>Частота и объём поставок</p>
            </div>
          </div>
          <div className="supply-bars">
            {incomingWeeks.map((week) => (
              <div key={week.label}>
                <b>{week.sku}</b>
                <i style={{ height: `${(week.sku / 24) * 100}%` }} />
                <span>{week.label}</span>
                <small>{week.units} ед.</small>
              </div>
            ))}
          </div>
        </article>
        <article className="panel table-panel compact-table">
          <div className="panel-head">
            <div>
              <h2>Последние поставки</h2>
              <p>Данные из учётной системы</p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Поставщик</th>
                  <th>SKU</th>
                  <th>Единиц</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((item) => (
                  <tr key={`${item.date}-${item.supplier}`}>
                    <td>{item.date}</td>
                    <td>
                      <strong>{item.supplier}</strong>
                    </td>
                    <td>{item.sku}</td>
                    <td>{item.units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <div className="section-toolbar">
        <div>
          <h2>Контроль качества и учёта</h2>
          <p>Брак и сверка фактических остатков</p>
        </div>
      </div>
      <section className="split-cards">
        <article className="panel table-panel compact-table">
          <div className="panel-head">
            <div>
              <h2>Брак</h2>
              <p>За последние 30 дней</p>
            </div>
            <span className="tag amber">
              {defects.reduce((sum, item) => sum + item.qty, 0)} ЕД.
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Кол-во</th>
                  <th>Причина</th>
                  <th>Дата</th>
                </tr>
              </thead>
              <tbody>
                {defects.map((item) => (
                  <tr key={`${item.article}-${item.date}`}>
                    <td>
                      <strong>{item.name}</strong>
                      <small className="table-sub">{item.article}</small>
                    </td>
                    <td>{item.qty}</td>
                    <td>{item.reason}</td>
                    <td>{item.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        <article className="panel table-panel compact-table">
          <div className="panel-head">
            <div>
              <h2>Сверка остатков</h2>
              <p>
                {mismatches} расхождения из {reconciliation.length} SKU
              </p>
            </div>
            <span className="tag green">ПРОВЕРЕНО</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>По базе</th>
                  <th>Факт</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.map((item) => {
                  const delta = item.fact - item.base;
                  return (
                    <tr key={item.article}>
                      <td>
                        <strong>{item.name}</strong>
                        <small className="table-sub">{item.article}</small>
                      </td>
                      <td>{item.base}</td>
                      <td>{item.fact}</td>
                      <td>
                        {delta === 0 ? (
                          <span className="status success">Совпадает</span>
                        ) : (
                          <span className="status danger">
                            {delta > 0 ? "+" : ""}
                            {delta}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  );
}

function Team() {
  const [active, setActive] = useState<number | null>(null);
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("all");
  const [teamPeriod, setTeamPeriod] = useState<TeamPeriod>("month");
  const filterLabels: Record<TeamFilter, string> = {
    all: "Все",
    online: "Онлайн",
    offline: "Офлайн",
  };
  const periodLabels: Record<TeamPeriod, string> = {
    hour: "По часам",
    day: "За день",
    week: "За неделю",
    month: "За месяц",
  };
  const periodFactor: Record<TeamPeriod, number> = {
    hour: 1 / 240,
    day: 1 / 30,
    week: 7 / 30,
    month: 1,
  };
  const monthlyPlans: Record<TeamFilter, number> = {
    all: 24_000_000,
    online: 8_000_000,
    offline: 16_000_000,
  };
  const filteredSellers = sellers.filter(
    (item) =>
      teamFilter === "all" ||
      (teamFilter === "online"
        ? item.channel === "Онлайн"
        : item.channel === "Офлайн"),
  );
  const revenueForPeriod = (item: (typeof sellers)[number]) =>
    teamPeriod === "hour"
      ? item.todayRevenue / 7
      : teamPeriod === "day"
        ? item.todayRevenue
        : teamPeriod === "week"
          ? (item.revenue * 7) / 30
          : item.revenue;
  const receiptsForPeriod = (item: (typeof sellers)[number]) =>
    teamPeriod === "hour"
      ? item.todayReceipts / 7
      : teamPeriod === "day"
        ? item.todayReceipts
        : teamPeriod === "week"
          ? (item.receipts * 7) / 30
          : item.receipts;
  const teamPlan = monthlyPlans[teamFilter] * periodFactor[teamPeriod];
  const teamRevenue = filteredSellers.reduce(
    (sum, item) => sum + revenueForPeriod(item),
    0,
  );
  const teamReceipts = filteredSellers.reduce(
    (sum, item) => sum + receiptsForPeriod(item),
    0,
  );
  const teamCompletion = teamPlan ? (teamRevenue / teamPlan) * 100 : 0;
  const sorted = [...filteredSellers].sort(
    (a, b) => revenueForPeriod(b) - revenueForPeriod(a),
  );
  const seller = active === null ? null : sellers[active];

  useEffect(() => {
    if (active !== null && !filteredSellers.includes(sellers[active]))
      setActive(null);
  }, [active, teamFilter]);

  const detailSellers = seller ? [seller] : filteredSellers;
  const detailRevenue = detailSellers.reduce(
    (sum, item) => sum + revenueForPeriod(item),
    0,
  );
  const detailReceipts = detailSellers.reduce(
    (sum, item) => sum + receiptsForPeriod(item),
    0,
  );
  const detailName = seller?.name || "Все продавцы";
  const chartProfiles: Record<
    TeamPeriod,
    { labels: string[]; shares: number[] }
  > = {
    hour: {
      labels: ["00–15", "15–30", "30–45", "45–60"],
      shares: [0.18, 0.22, 0.27, 0.33],
    },
    day: {
      labels: ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"],
      shares: [0.07, 0.09, 0.12, 0.14, 0.17, 0.19, 0.22],
    },
    week: {
      labels: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
      shares: [0.11, 0.12, 0.12, 0.14, 0.15, 0.17, 0.19],
    },
    month: {
      labels: ["1 нед.", "2 нед.", "3 нед.", "4 нед."],
      shares: [0.22, 0.24, 0.25, 0.29],
    },
  };
  const chartProfile = chartProfiles[teamPeriod];
  const salesDynamics = chartProfile.labels.map((label, index) => ({
    label,
    current: Math.round(detailRevenue * chartProfile.shares[index]),
    previous: Math.round(
      detailRevenue * chartProfile.shares[index] * (0.84 + index * 0.018),
    ),
  }));
  const contributionItems = sorted.map((item) => ({
    label: item.name,
    value: (revenueForPeriod(item) / Math.max(teamPlan, 1)) * 100,
    sub: `${item.channel} · ${money(revenueForPeriod(item))}`,
  }));
  const topProducts = seller
    ? seller.topProducts.map((item) => ({
        ...item,
        value: Math.round(item.value * periodFactor[teamPeriod]),
      }))
    : [...products]
        .sort((a, b) => b.revenue30 - a.revenue30)
        .slice(0, 5)
        .map((product) => ({
          label: product.name,
          value: Math.round(
            (detailRevenue * product.revenue30) / productRevenueTotal,
          ),
        }));

  return (
    <div className="page-stack">
      <section className="team-plan-hero">
        <div className="team-plan-head">
          <div>
            <span className="team-plan-kicker">План продаж команды</span>
            <h2>
              {filterLabels[teamFilter]} · {periodLabels[teamPeriod]}
            </h2>
            <p>Общий ориентир команды и вклад каждого продавца в результат</p>
          </div>
          <div className="team-filter-groups">
            <div
              className="team-segment"
              role="group"
              aria-label="Команда продаж"
            >
              {(Object.keys(filterLabels) as TeamFilter[]).map((key) => (
                <button
                  key={key}
                  className={teamFilter === key ? "active" : ""}
                  aria-pressed={teamFilter === key}
                  onClick={() => setTeamFilter(key)}
                >
                  {filterLabels[key]}
                </button>
              ))}
            </div>
            <div
              className="team-segment period-team"
              role="group"
              aria-label="Период продаж команды"
            >
              {(Object.keys(periodLabels) as TeamPeriod[]).map((key) => (
                <button
                  key={key}
                  className={teamPeriod === key ? "active" : ""}
                  aria-pressed={teamPeriod === key}
                  onClick={() => setTeamPeriod(key)}
                >
                  {periodLabels[key]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="team-plan-metrics">
          <div>
            <span>План команды</span>
            <strong>{money(teamPlan)}</strong>
            <small>
              {filterLabels[teamFilter].toLowerCase()} ·{" "}
              {periodLabels[teamPeriod].toLowerCase()}
            </small>
          </div>
          <div>
            <span>Продажи команды</span>
            <strong>{money(teamRevenue)}</strong>
            <small>{number(teamReceipts)} чеков</small>
          </div>
          <div>
            <span>Выполнение</span>
            <strong>{teamCompletion.toFixed(1)}%</strong>
            <small>
              {teamCompletion >= 100 ? "план выполнен" : "текущий темп"}
            </small>
          </div>
          <div>
            <span>
              {teamCompletion >= 100 ? "Сверх плана" : "Осталось до плана"}
            </span>
            <strong>{money(Math.abs(teamRevenue - teamPlan))}</strong>
            <small>{sorted.length} продавцов в команде</small>
          </div>
        </div>
        <div className="team-plan-progress">
          <i style={{ width: `${Math.min(teamCompletion, 100)}%` }} />
          <span>{teamCompletion.toFixed(1)}%</span>
        </div>
      </section>

      <section className="team-layout">
        <article className="panel seller-list">
          <div className="panel-head">
            <div>
              <h2>Рейтинг продавцов</h2>
              <p>
                Доля в плане команды · {periodLabels[teamPeriod].toLowerCase()}
              </p>
            </div>
          </div>
          <button
            onClick={() => setActive(null)}
            className={
              active === null
                ? "seller active all-sellers"
                : "seller all-sellers"
            }
          >
            <span className="place">
              <Users size={13} />
            </span>
            <div>
              <strong>Все продавцы</strong>
              <small>
                {sorted.length} человек ·{" "}
                {filterLabels[teamFilter].toLowerCase()}
              </small>
            </div>
            <em>{money(teamRevenue)}</em>
            <span
              className={`plan ${teamCompletion >= 100 ? "green" : teamCompletion >= 80 ? "amber" : "gray"}`}
            >
              {teamCompletion.toFixed(0)}%
            </span>
          </button>
          {sorted.map((item, index) => {
            const originalIndex = sellers.findIndex(
              (sellerItem) => sellerItem.name === item.name,
            );
            const contribution =
              (revenueForPeriod(item) / Math.max(teamPlan, 1)) * 100;
            return (
              <button
                key={item.name}
                onClick={() => setActive(originalIndex)}
                className={
                  active === originalIndex ? "seller active" : "seller"
                }
              >
                <span className="place">{index + 1}</span>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {item.channel} · {number(receiptsForPeriod(item))} чеков
                  </small>
                </div>
                <em>{money(revenueForPeriod(item))}</em>
                <span
                  className={`plan ${contribution >= 50 ? "green" : contribution >= 25 ? "amber" : "gray"}`}
                >
                  {contribution.toFixed(1)}%
                </span>
              </button>
            );
          })}
        </article>
        <article className="panel seller-detail">
          <div className="person-head">
            <div className="avatar">
              {seller ? seller.name[0] : <Users size={18} />}
            </div>
            <div>
              <h2>{detailName}</h2>
              <p>
                {seller?.channel || filterLabels[teamFilter]} ·{" "}
                {periodLabels[teamPeriod]}
              </p>
            </div>
            <label className="seller-picker">
              <span>Продавец</span>
              <select
                value={active === null ? "all" : active}
                onChange={(event) =>
                  setActive(
                    event.target.value === "all"
                      ? null
                      : Number(event.target.value),
                  )
                }
              >
                <option value="all">Все продавцы</option>
                {filteredSellers.map((item) => {
                  const index = sellers.findIndex(
                    (sellerItem) => sellerItem.name === item.name,
                  );
                  return (
                    <option value={index} key={item.name}>
                      {item.name}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
          <div className="mini-kpis">
            <div>
              <span>Продажи</span>
              <b>{money(detailRevenue)}</b>
            </div>
            <div>
              <span>Средний чек</span>
              <b>{money(detailRevenue / Math.max(detailReceipts, 1))}</b>
            </div>
            <div>
              <span>Вклад в план команды</span>
              <b>
                {((detailRevenue / Math.max(teamPlan, 1)) * 100).toFixed(1)}%
              </b>
            </div>
          </div>
          <div className="panel-head inline">
            <div>
              <h3>Динамика продаж</h3>
              <p>
                Деньги в кыргызских сомах ·{" "}
                {periodLabels[teamPeriod].toLowerCase()}
              </p>
            </div>
            <div className="chart-key compact">
              <span>
                <i className="actual" />
                Текущий период
              </span>
              <span>
                <i className="previous" />
                Предыдущий
              </span>
            </div>
          </div>
          <ComparisonChart data={salesDynamics} />
        </article>
      </section>

      <section className="split-cards">
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Вклад продавцов в план команды</h2>
              <p>
                Процент от общего плана ·{" "}
                {filterLabels[teamFilter].toLowerCase()}
              </p>
            </div>
          </div>
          <HorizontalBars
            items={contributionItems}
            valueFormatter={(value) => `${value.toFixed(1)}%`}
          />
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Топ товаров</h2>
              <p>
                {detailName} · {periodLabels[teamPeriod].toLowerCase()}
              </p>
            </div>
          </div>
          <HorizontalBars items={topProducts} />
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-head">
          <div>
            <h2>Рейтинг по вкладу в план команды</h2>
            <p>Кто двигает команду к цели · суммы в кыргызских сомах</p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Продавец</th>
                <th>Команда</th>
                <th>Продажи</th>
                <th>Чеки</th>
                <th>Средний чек</th>
                <th>% от плана команды</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => {
                const revenue = revenueForPeriod(item);
                const receipts = receiptsForPeriod(item);
                const contribution = (revenue / Math.max(teamPlan, 1)) * 100;
                return (
                  <tr key={item.name}>
                    <td>
                      <strong>{item.name}</strong>
                    </td>
                    <td>
                      <span
                        className={`channel-badge ${item.channel === "Онлайн" ? "online" : "offline"}`}
                      >
                        {item.channel}
                      </span>
                    </td>
                    <td>{money(revenue)}</td>
                    <td>{number(receipts)}</td>
                    <td>{money(revenue / Math.max(receipts, 1))}</td>
                    <td>
                      <div className="plan-cell">
                        <div className="progress">
                          <i
                            style={{ width: `${Math.min(contribution, 100)}%` }}
                          />
                        </div>
                        <b>{contribution.toFixed(1)}%</b>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

type TransferItem = Product & {
  checked: boolean;
  qty: number;
  location: WarehouseFilter;
  currentStock: number;
  movement30: number;
  initialStock: number;
  remainingPercent: number;
  averageTarget: number;
  action: "Закупить" | "Переместить";
};

function Procurement() {
  const [warehouse, setWarehouse] = useState<WarehouseFilter>("all");
  const candidates = useMemo(
    () =>
      products
        .map((item) => ({ item, metrics: locationMetrics(item, warehouse) }))
        .filter(
          ({ metrics }) =>
            metrics.remainingPercent <= 50 && metrics.recommended > 0,
        )
        .sort(
          (a, b) => a.metrics.remainingPercent - b.metrics.remainingPercent,
        ),
    [warehouse],
  );
  const [items, setItems] = useState<TransferItem[]>([]);
  const [requestMessage, setRequestMessage] = useState("");
  useEffect(() => {
    setItems(
      candidates.map(({ item, metrics }) => {
        const action: TransferItem["action"] =
          warehouse === "sales-floor" && item.warehouseStock > 0
            ? "Переместить"
            : "Закупить";
        const recommendedQty =
          action === "Переместить"
            ? Math.min(item.warehouseStock, metrics.recommended)
            : metrics.recommended;
        return {
          ...item,
          checked: true,
          qty: Math.max(1, recommendedQty),
          location: warehouse,
          currentStock: metrics.stock,
          movement30: metrics.sold,
          initialStock: metrics.initialStock,
          remainingPercent: metrics.remainingPercent,
          averageTarget: metrics.averageTarget,
          action,
        };
      }),
    );
    setRequestMessage("");
  }, [candidates, warehouse]);
  const selected = items.filter((item) => item.checked);
  const total = selected.reduce((sum, item) => sum + item.qty, 0);
  const averageRemaining = selected.length
    ? selected.reduce((sum, item) => sum + item.remainingPercent, 0) /
      selected.length
    : 0;
  const update = (article: string, patch: Partial<TransferItem>) =>
    setItems((current) =>
      current.map((item) =>
        item.article === article ? { ...item, ...patch } : item,
      ),
    );
  const createRequest = () => {
    const requestNumber = `ПЕР-2307-${Math.floor(100 + total * 1.7)}`;
    setRequestMessage(
      `Заявка № ${requestNumber} сформирована: ${selected.length} позиций, ${total} единиц.`,
    );
  };
  const download = () => {
    const rows = selected
      .map(
        (item) =>
          `${item.article};${item.name};${WAREHOUSE_LABELS[item.location]};${item.action};${item.initialStock};${item.movement30};${item.currentStock};${item.remainingPercent.toFixed(1)}%;${item.qty}`,
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob(
        [
          `Артикул;Товар;Место;Действие;Было;Продано или выдано;Осталось;Процент остатка;Количество\n${rows}`,
        ],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "zayavka-na-zakup.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-stack">
      <section className="panel procurement-filter-panel">
        <div>
          <span className="filter-kicker">Место хранения</span>
          <h2>По какому остатку формировать заявку</h2>
          <p>
            Фильтр меняет остатки, расчёт порога и рекомендуемое количество
            только в этом разделе.
          </p>
        </div>
        <WarehouseSelector value={warehouse} onChange={setWarehouse} />
      </section>

      <section className="procurement-summary">
        <KpiCard
          label="Требуют дозаказа"
          value={`${candidates.length} SKU`}
          delta="≤50%"
          tone="warn"
          note={`по локации «${WAREHOUSE_LABELS[warehouse]}»`}
        />
        <KpiCard
          label="Средний остаток"
          value={`${averageRemaining.toFixed(0)}%`}
          delta="В заявке"
          tone="warn"
          note="от исходного запаса"
        />
        <KpiCard
          label="Рекомендуется заказать"
          value={`${total} шт.`}
          tone="neutral"
          note={`${selected.length} выбранных позиций`}
        />
      </section>

      <section className="panel order-panel">
        <div className="panel-head">
          <div>
            <h2>Заявка на закуп / перемещение</h2>
            <p>
              В заявку попадают позиции, у которых осталось 50% исходного запаса
              или меньше.
            </p>
          </div>
          <span className="tag amber">АВТОРАСЧЁТ</span>
        </div>
        <div className="table-scroll order-table-wrap">
          <table className="order-table">
            <thead>
              <tr>
                <th aria-label="Выбрать" />
                <th>Товар</th>
                <th>Место</th>
                <th>Действие</th>
                <th>Было</th>
                <th>
                  Продано / выдано
                  <br />
                  за 30 дней
                </th>
                <th>Осталось</th>
                <th>% остатка</th>
                <th>
                  Предлагаем
                  <br />
                  количество
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.article}>
                  <td>
                    <input
                      aria-label={`Выбрать ${item.name}`}
                      type="checkbox"
                      checked={item.checked}
                      onChange={(event) =>
                        update(item.article, { checked: event.target.checked })
                      }
                    />
                  </td>
                  <td>
                    <strong>{item.name}</strong>
                    <small className="table-sub">{item.article}</small>
                  </td>
                  <td>
                    <span className="location-badge">
                      {WAREHOUSE_LABELS[item.location]}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`action-badge ${item.action === "Переместить" ? "move" : "buy"}`}
                    >
                      {item.action}
                    </span>
                  </td>
                  <td>{item.initialStock} шт.</td>
                  <td>
                    <b>{item.movement30} шт.</b>
                  </td>
                  <td>{item.currentStock} шт.</td>
                  <td>
                    <span
                      className={`stock-percent ${item.remainingPercent <= 25 ? "critical" : "warning"}`}
                    >
                      {item.remainingPercent.toFixed(0)}%
                    </span>
                  </td>
                  <td>
                    <label className="qty-input">
                      <input
                        aria-label={`Количество для ${item.name}`}
                        type="number"
                        min="1"
                        value={item.qty}
                        onChange={(event) =>
                          update(item.article, {
                            qty: Math.max(1, Number(event.target.value)),
                          })
                        }
                      />
                      <span>шт.</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="order-footer">
          <p>
            <b>{selected.length}</b> позиций · <b>{total}</b> единиц товара
          </p>
          <div className="order-actions">
            <button
              className="secondary inline-button"
              disabled={!selected.length}
              onClick={download}
            >
              <Download size={15} />
              CSV
            </button>
            <button
              className="primary"
              disabled={!selected.length}
              onClick={createRequest}
            >
              Сформировать заявку
            </button>
          </div>
        </div>
        {requestMessage && (
          <div className="success-toast">
            <CheckCircle2 size={18} />
            <span>
              {requestMessage}
              <small>В рабочей версии документ будет отправлен в 1С.</small>
            </span>
          </div>
        )}
      </section>

      <section className="formula-panel">
        <div className="formula-copy">
          <span className="filter-kicker">Как считается сейчас</span>
          <h2>Прозрачная формула заявки</h2>
          <p>
            Система берёт среднее арифметическое между исходным запасом и
            расходом за 30 дней, затем вычитает текущий остаток. Для перемещения
            количество ограничено доступным запасом на складе; перед заявкой его
            можно изменить вручную.
          </p>
        </div>
        <div
          className="formula-flow"
          aria-label="Формула рекомендуемого заказа"
        >
          <div>
            <b>1</b>
            <span>Было</span>
            <strong>остаток + продажи</strong>
          </div>
          <i>→</i>
          <div>
            <b>2</b>
            <span>Целевой запас</span>
            <strong>(было + продажи) ÷ 2</strong>
          </div>
          <i>→</i>
          <div>
            <b>3</b>
            <span>Дозаказать</span>
            <strong>цель − остаток</strong>
          </div>
        </div>
        <div className="future-note">
          <ChartNoAxesCombined size={20} />
          <div>
            <b>Будущая доработка</b>
            <span>
              После накопления истории прогноз будет учитывать динамику продаж
              по дням, неделям и месяцам, сезонность и скорость оборачиваемости.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

function Online() {
  return (
    <section className="phase-card">
      <div className="phase-icon">↗</div>
      <span className="tag green">PHASE 2</span>
      <h2>Онлайн-продажи и посещаемость</h2>
      <p>
        Для этого раздела нужно подключить CRM, интернет-магазин или социальные
        сети. После интеграции появятся посетители, онлайн-заказы, конверсия и
        каналы трафика.
      </p>
      <div className="future-grid">
        <div>
          <b>—</b>
          <span>Посетители сайта</span>
        </div>
        <div>
          <b>—</b>
          <span>Заказы онлайн</span>
        </div>
        <div>
          <b>—</b>
          <span>Конверсия</span>
        </div>
        <div>
          <b>—</b>
          <span>Каналы трафика</span>
        </div>
      </div>
      <button className="secondary">Источники данных не подключены</button>
    </section>
  );
}

export function Dashboard({ initialRole }: { initialRole: Role }) {
  const role = initialRole;
  const [session, setSession] = useState<Session | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [section, setSection] = useState<Section>(
    initialRole === "owner" ? "overview" : "products",
  );
  const [period, setPeriod] = useState<Period>(30);

  useEffect(() => {
    const stored = window.localStorage.getItem("analytics-session");
    if (!stored) {
      window.location.replace("/login");
      return;
    }
    try {
      const parsed = JSON.parse(stored) as Session;
      if (parsed.role !== initialRole) {
        window.location.replace(
          parsed.role === "owner" ? "/owner" : "/manager",
        );
        return;
      }
      setSession(parsed);
    } catch {
      window.localStorage.removeItem("analytics-session");
      window.location.replace("/login");
    }
  }, [initialRole]);

  const activeSection: Section =
    role === "owner"
      ? "overview"
      : section === "overview"
        ? "products"
        : section;
  const nav = useMemo(
    () =>
      role === "owner"
        ? [{ id: "overview", label: "Обзор" }]
        : [
            { id: "products", label: "Товары и продажи" },
            { id: "stock", label: "Склад и остатки" },
            { id: "team", label: "Продавцы" },
            { id: "procurement", label: "Закуп / Перемещение" },
            { id: "online", label: "Онлайн" },
          ],
    [role],
  );
  const titles: Record<Section, [string, string]> = {
    overview: ["Обзор бизнеса", "Главные показатели и динамика"],
    products: ["Товары и продажи", "Спрос, оборачиваемость и ABC-анализ"],
    stock: ["Склад и остатки", "Поставки, качество и сверка учёта"],
    team: ["Продавцы", "Результаты команды и персональная динамика"],
    procurement: [
      "Закуп / Перемещение",
      "Дозаказ и перемещение товаров между точками",
    ],
    online: ["Онлайн", "Будущая аналитика цифровых каналов"],
  };
  const changeSection = (nextSection: Section) => {
    setSection(nextSection);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const logout = () => {
    window.localStorage.removeItem("analytics-session");
    window.location.replace("/login");
  };

  if (!session) {
    return (
      <div className="auth-loading">
        <div className="auth-spinner" />
        <span>Загружаем аналитику…</span>
      </div>
    );
  }

  return (
    <div className="app-shell" data-role={role}>
      {menuOpen && (
        <button
          className="drawer-backdrop"
          aria-label="Закрыть меню"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={menuOpen ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <div className="product-mark">
            <ChartNoAxesCombined size={22} strokeWidth={2} />
          </div>
          <div>
            <strong>Аналитика</strong>
            <span>продажи и остатки</span>
          </div>
          <button
            className="drawer-close"
            aria-label="Закрыть меню"
            onClick={() => setMenuOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={activeSection === item.id ? "active" : ""}
              onClick={() => changeSection(item.id as Section)}
            >
              <Icon name={item.id} />
              <span>{item.label}</span>
              {item.id === "online" && <small>Phase 2</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sync">
            <i />
            <div>
              <b>Данные актуальны</b>
              <span>Обновлено сегодня, 16:00</span>
            </div>
          </div>
          <button className="sidebar-logout" onClick={logout}>
            <LogOut size={17} />
            <span>Выйти из аккаунта</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="menu-toggle"
            aria-label="Открыть меню"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div className="topbar-spacer" />
          <span className="demo-badge">
            <AlertTriangle size={13} />
            Демо-данные
          </span>
          <span className="role-pill">
            {role === "owner" ? "Владелец" : "Менеджер"}
          </span>
          <div className="user">
            <div className="avatar small">{session.name[0]}</div>
            <div className="user-copy">
              <strong>{session.name}</strong>
              <span>{session.email}</span>
            </div>
          </div>
          <button className="logout-button" onClick={logout} aria-label="Выйти">
            <LogOut size={18} />
            <span>Выйти</span>
          </button>
        </header>

        <div className="content">
          <div className="role-workspace">
            <div className="title-row">
              <div>
                <p className="eyebrow">МАГАЗИН ТЕКСТИЛЯ · АСТАНА</p>
                <h1>{titles[activeSection][0]}</h1>
                <span>{titles[activeSection][1]}</span>
              </div>
              {role === "owner" && (
                <div className="period">
                  {([7, 30, 90] as Period[]).map((value) => (
                    <button
                      key={value}
                      onClick={() => setPeriod(value)}
                      className={period === value ? "active" : ""}
                    >
                      {value} дней
                    </button>
                  ))}
                </div>
              )}
            </div>
            {role === "owner" && <OwnerOverview period={period} />}
            {role === "manager" && activeSection === "products" && <Products />}
            {role === "manager" && activeSection === "stock" && <Stock />}
            {role === "manager" && activeSection === "team" && <Team />}
            {role === "manager" && activeSection === "procurement" && (
              <Procurement />
            )}
            {role === "manager" && activeSection === "online" && <Online />}
            <p className="demo-note">
              Показатели на экране демонстрационные. В рабочей версии данные
              загружаются из 1С Розница 8.3.
            </p>
          </div>
        </div>

        {role === "manager" && (
          <nav className="mobile-nav">
            {nav.map((item) => (
              <button
                key={item.id}
                className={activeSection === item.id ? "active" : ""}
                onClick={() => changeSection(item.id as Section)}
              >
                <Icon name={item.id} />
                <span>
                  {item.id === "products"
                    ? "Товары"
                    : item.id === "procurement"
                      ? "Закуп"
                      : item.label.split(" ")[0]}
                </span>
              </button>
            ))}
          </nav>
        )}
      </main>
    </div>
  );
}
