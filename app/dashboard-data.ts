export type ProductStatus = "В наличии" | "Мало" | "Без движения" | "Нет в наличии";
export type AbcClass = "A" | "B" | "C";

export type Product = {
  article: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  salesFloorStock: number;
  warehouseStock: number;
  idleDays: number;
  sold30: number;
  salesFloorSold30: number;
  warehouseIssued30: number;
  revenue30: number;
  status: ProductStatus;
  abc: AbcClass;
  revenueShare: number;
  cumulativeShare: number;
  recommended: number;
};

export type Seller = {
  name: string;
  channel: "Онлайн" | "Офлайн";
  revenue: number;
  receipts: number;
  avgCheck: number;
  plan: number;
  todayRevenue: number;
  todayReceipts: number;
  hourly: number[];
  topProducts: { label: string; value: number }[];
};

export const money = (value: number) =>
  `${new Intl.NumberFormat("ru-RU").format(Math.round(value))} с`;

export const number = (value: number) =>
  new Intl.NumberFormat("ru-RU").format(Math.round(value));

export const categories = [
  { name: "Постельное бельё", share: 32, color: "#0b7a55" },
  { name: "Полотенца", share: 18, color: "#27a879" },
  { name: "Шторы и тюль", share: 22, color: "#6c9b87" },
  { name: "Пледы и покрывала", share: 12, color: "#d49a3a" },
  { name: "Кухонный текстиль", share: 9, color: "#aab8b1" },
  { name: "Ткани отрезные", share: 7, color: "#cfd7d3" },
];

const productTemplates = [
  ["КПБ «Сатин Люкс» 1.5-сп", "Постельное бельё"],
  ["КПБ «Ранфорс Премиум» 2-сп", "Постельное бельё"],
  ["КПБ детское «Мишки» 1.5-сп", "Постельное бельё"],
  ["Простыня на резинке 160×200", "Постельное бельё"],
  ["Пододеяльник «Страйп» 2-сп", "Постельное бельё"],
  ["Наволочка «Сатин» 70×70 (2 шт)", "Постельное бельё"],
  ["Полотенце махровое 50×90", "Полотенца"],
  ["Полотенце махровое 70×140", "Полотенца"],
  ["Набор полотенец «Бамбук» 3 пр.", "Полотенца"],
  ["Полотенце банное «Велюр» 100×150", "Полотенца"],
  ["Тюль-сетка белая 300×270", "Шторы и тюль"],
  ["Штора блэкаут «Гранд» 200×270", "Шторы и тюль"],
  ["Комплект штор «Софт» 2 полотна", "Шторы и тюль"],
  ["Ламбрекен «Классик»", "Шторы и тюль"],
  ["Плед флисовый 150×200", "Пледы и покрывала"],
  ["Покрывало стёганое 220×240", "Пледы и покрывала"],
  ["Плед «Мех» 130×160", "Пледы и покрывала"],
  ["Скатерть «Прованс» 150×220", "Кухонный текстиль"],
  ["Набор кухонных полотенец 5 шт", "Кухонный текстиль"],
  ["Фартук + прихватка «Уют»", "Кухонный текстиль"],
  ["Бязь набивная (за метр)", "Ткани отрезные"],
  ["Сатин однотонный (за метр)", "Ткани отрезные"],
  ["Флис (за метр)", "Ткани отрезные"],
  ["Лён костюмный (за метр)", "Ткани отрезные"],
] as const;

const prices = [
  28900, 36700, 19800, 11900, 15600, 5900, 3900, 7200,
  12800, 9800, 15900, 24600, 33400, 19700, 8900, 21800,
  14500, 9400, 5200, 4300, 1900, 2700, 2300, 3900,
];
const stocks = [
  0, 42, 8, 11, 36, 67, 28, 0, 53, 9, 21, 72,
  13, 31, 0, 46, 18, 7, 64, 25, 82, 12, 48, 5,
];
const idleDays = [
  2, 5, 18, 4, 6, 34, 3, 2, 19, 4, 8, 5,
  3, 27, 1, 7, 21, 5, 4, 17, 3, 6, 23, 4,
];
const sold = [
  82, 68, 54, 47, 43, 28, 96, 77, 61, 48, 39, 45,
  32, 14, 58, 34, 23, 29, 72, 31, 118, 93, 66, 41,
];

function productStatus(stock: number, days: number): ProductStatus {
  if (stock === 0) return "Нет в наличии";
  if (stock < 15) return "Мало";
  if (days >= 15) return "Без движения";
  return "В наличии";
}

const rawProducts = productTemplates.map(([name, category], index) => {
  const salesFloorStock = Math.round(stocks[index] * (0.38 + (index % 4) * 0.06));
  const salesFloorSold30 = Math.round(sold[index] * (0.68 + (index % 3) * 0.05));
  return {
    article: `TXT-${1000 + index}`,
    name,
    category,
    price: prices[index],
    stock: stocks[index],
    salesFloorStock,
    warehouseStock: stocks[index] - salesFloorStock,
    idleDays: idleDays[index],
    sold30: sold[index],
    salesFloorSold30,
    warehouseIssued30: sold[index] - salesFloorSold30,
    revenue30: prices[index] * sold[index],
    status: productStatus(stocks[index], idleDays[index]),
    abc: "C" as AbcClass,
    revenueShare: 0,
    cumulativeShare: 0,
    recommended: Math.max(8, Math.ceil((sold[index] / 30) * 21) - stocks[index] + 5),
  };
});

const totalProductRevenue = rawProducts.reduce((sum, item) => sum + item.revenue30, 0);
let cumulativeRevenue = 0;
[...rawProducts]
  .sort((a, b) => b.revenue30 - a.revenue30)
  .forEach((item) => {
    cumulativeRevenue += item.revenue30;
    item.revenueShare = (item.revenue30 / totalProductRevenue) * 100;
    item.cumulativeShare = (cumulativeRevenue / totalProductRevenue) * 100;
    item.abc =
      item.cumulativeShare <= 80 ? "A" : item.cumulativeShare <= 95 ? "B" : "C";
  });

export const products: Product[] = rawProducts;
export const productsByRevenue = [...products].sort((a, b) => b.revenue30 - a.revenue30);
export const productRevenueTotal = totalProductRevenue;

const weekdayMultiplier = [0.86, 0.93, 0.9, 1.02, 0.98, 1.18, 1.3];

function makeTrend(days: number, previous = false) {
  return Array.from({ length: days }, (_, index) => {
    const base = previous ? 655000 : 715000;
    const growth = previous ? 1150 : 2450;
    const wave = weekdayMultiplier[index % weekdayMultiplier.length];
    const pulse = index % 11 === 7 ? 1.18 : index % 13 === 2 ? 0.91 : 1;
    return Math.round((base + growth * index) * wave * pulse);
  });
}

export const trendByPeriod = {
  7: { current: makeTrend(7), previous: makeTrend(7, true) },
  30: { current: makeTrend(30), previous: makeTrend(30, true) },
  90: { current: makeTrend(90), previous: makeTrend(90, true) },
};

export const weekdayComparison = [
  { label: "Пн", current: 724000, previous: 681000 },
  { label: "Вт", current: 768000, previous: 703000 },
  { label: "Ср", current: 742000, previous: 716000 },
  { label: "Чт", current: 831000, previous: 764000 },
  { label: "Пт", current: 866000, previous: 809000 },
  { label: "Сб", current: 1048000, previous: 942000 },
  { label: "Вс", current: 1124000, previous: 998000 },
];

export type ProductAnalyticsPeriod = "day" | "week" | "month";

export const productPeriodAnalytics = {
  day: {
    label: "День",
    caption: "сегодня",
    factor: 1 / 30,
    activeSku: 18,
    current: [21000, 49000, 91000, 142000, 204000, 258000, 326000],
    previous: [18000, 44000, 83000, 130000, 186000, 238000, 289000],
    comparison: [
      { label: "10:00", current: 21000, previous: 18000 },
      { label: "11:00", current: 28000, previous: 26000 },
      { label: "12:00", current: 42000, previous: 39000 },
      { label: "13:00", current: 51000, previous: 47000 },
      { label: "14:00", current: 62000, previous: 56000 },
      { label: "15:00", current: 54000, previous: 52000 },
      { label: "16:00", current: 68000, previous: 51000 },
    ],
    comparisonText: "Выручка по часам: сегодня против вчера",
  },
  week: {
    label: "Неделя",
    caption: "за 7 дней",
    factor: 7 / 30,
    activeSku: 22,
    current: trendByPeriod[7].current,
    previous: trendByPeriod[7].previous,
    comparison: weekdayComparison,
    comparisonText: "Текущая неделя против предыдущей",
  },
  month: {
    label: "Месяц",
    caption: "за 30 дней",
    factor: 1,
    activeSku: 24,
    current: trendByPeriod[30].current,
    previous: trendByPeriod[30].previous,
    comparison: [
      { label: "1 нед.", current: 4860000, previous: 4430000 },
      { label: "2 нед.", current: 5210000, previous: 4780000 },
      { label: "3 нед.", current: 5630000, previous: 5090000 },
      { label: "4 нед.", current: 6080000, previous: 5460000 },
    ],
    comparisonText: "Текущий месяц против предыдущего по неделям",
  },
} satisfies Record<ProductAnalyticsPeriod, {
  label: string;
  caption: string;
  factor: number;
  activeSku: number;
  current: number[];
  previous: number[];
  comparison: { label: string; current: number; previous: number }[];
  comparisonText: string;
}>;

export const hourLabels = [
  "10:00", "11:00", "12:00", "13:00", "14:00", "15:00",
  "16:00", "17:00", "18:00", "19:00", "20:00",
];
export const hourlyActual = [21000, 28000, 42000, 51000, 62000, 54000, 68000, 0, 0, 0, 0];
export const hourlyUsual = [18000, 26000, 39000, 47000, 56000, 59000, 64000, 72000, 86000, 78000, 49000];

export const incomingWeeks = [
  { label: "нед. −7", sku: 12, units: 294 },
  { label: "нед. −6", sku: 18, units: 486 },
  { label: "нед. −5", sku: 11, units: 253 },
  { label: "нед. −4", sku: 23, units: 644 },
  { label: "нед. −3", sku: 16, units: 416 },
  { label: "нед. −2", sku: 20, units: 580 },
  { label: "нед. −1", sku: 24, units: 720 },
  { label: "текущая", sku: 17, units: 459 },
];

export const deliveries = [
  { date: "22.07", supplier: "ТОО «Текстиль Трейд»", sku: 18, units: 486, status: "Принято" },
  { date: "18.07", supplier: "Turkish Textile Group", sku: 14, units: 378, status: "Принято" },
  { date: "12.07", supplier: "ИП Ахметов Р.К.", sku: 9, units: 216, status: "Принято" },
  { date: "08.07", supplier: "ТОО «Домашний Текстиль KZ»", sku: 16, units: 512, status: "Принято" },
  { date: "03.07", supplier: "Bravo Tekstil", sku: 11, units: 297, status: "Принято" },
];

export const defects = [
  { article: "TXT-1002", name: "КПБ детское «Мишки» 1.5-сп", qty: 2, reason: "Брак пошива", date: "20.07" },
  { article: "TXT-1007", name: "Полотенце махровое 70×140", qty: 1, reason: "Затяжка нити", date: "18.07" },
  { article: "TXT-1011", name: "Штора блэкаут «Гранд» 200×270", qty: 1, reason: "Пятно на ткани", date: "15.07" },
  { article: "TXT-1015", name: "Покрывало стёганое 220×240", qty: 2, reason: "Несоответствие размера", date: "11.07" },
  { article: "TXT-1018", name: "Набор кухонных полотенец 5 шт", qty: 1, reason: "Повреждение упаковки", date: "06.07" },
  { article: "TXT-1023", name: "Лён костюмный (за метр)", qty: 1, reason: "Дефект полотна", date: "02.07" },
];

export const reconciliation = [
  { article: "TXT-1001", name: "КПБ «Ранфорс Премиум» 2-сп", base: 42, fact: 42 },
  { article: "TXT-1004", name: "Пододеяльник «Страйп» 2-сп", base: 36, fact: 34 },
  { article: "TXT-1008", name: "Набор полотенец «Бамбук» 3 пр.", base: 53, fact: 53 },
  { article: "TXT-1010", name: "Тюль-сетка белая 300×270", base: 21, fact: 22 },
  { article: "TXT-1013", name: "Ламбрекен «Классик»", base: 31, fact: 31 },
  { article: "TXT-1016", name: "Плед «Мех» 130×160", base: 18, fact: 16 },
  { article: "TXT-1019", name: "Фартук + прихватка «Уют»", base: 25, fact: 25 },
  { article: "TXT-1022", name: "Флис (за метр)", base: 48, fact: 48 },
];

const sellerBase = [
  ["Айгерим Т.", "Онлайн", 4820000, 158, 112, 132000],
  ["Данияр С.", "Онлайн", 4380000, 149, 104, 119000],
  ["Жанна К.", "Офлайн", 3960000, 137, 98, 108000],
  ["Ерлан М.", "Офлайн", 3580000, 126, 91, 94000],
  ["Сауле Б.", "Офлайн", 3290000, 119, 86, 83000],
  ["Алия Н.", "Офлайн", 3010000, 112, 79, 74000],
] as const;

export const sellers: Seller[] = sellerBase.map(
  ([name, channel, revenue, receipts, plan, todayRevenue], index) => {
    const todayReceipts = Math.max(1, Math.round(todayRevenue / (revenue / receipts)));
    const hourly = hourlyUsual.map((value, hourIndex) =>
      Math.round(value * (0.13 + index * 0.012) * (hourIndex <= 6 ? 0.96 + index * 0.025 : 1)),
    );
    return {
      name,
      channel,
      revenue,
      receipts,
      avgCheck: Math.round(revenue / receipts),
      plan,
      todayRevenue,
      todayReceipts,
      hourly,
      topProducts: productsByRevenue
        .slice(index, index + 5)
        .map((product, productIndex) => ({
          label: product.name,
          value: Math.round(product.revenue30 * (0.18 - productIndex * 0.018)),
        })),
    };
  },
);
