export type AnalyticsPeriod = "day" | "week" | "month";

export type OnecProductLine = {
  LineNumber: string;
  Номенклатура_Key: string;
  Количество: number;
  Цена: number;
  Сумма: number;
  Склад_Key: string;
  Продавец_Key: string;
};

export type OnecReturnLine = OnecProductLine;

export type OnecRetailReport = {
  Ref_Key: string;
  Number: string;
  Date: string;
  Posted: boolean;
  СуммаДокумента: number;
  СуммаВозвратов: number;
  Магазин_Key: string;
  КассаККМ_Key: string;
  Товары: OnecProductLine[];
  ВозвращенныеТовары?: OnecReturnLine[];
};

export type OnecProductReference = {
  Ref_Key: string;
  Code: string;
  Description: string;
  НаименованиеПолное: string;
  Артикул: string;
  ВидНоменклатуры_Key: string;
  ВидНоменклатуры?: string | null;
  BusinessCategory_Key?: string | null;
  BusinessCategory?: string | null;
};

export type OnecWarehouseReference = {
  Ref_Key: string;
  Code: string;
  Description: string;
  ТипСклада: string;
  Магазин_Key: string;
};

export type OnecCategoryReference = {
  Ref_Key: string;
  Code?: string;
  Description: string;
};

export type SalesLoadMeta = {
  loaded?: number;
  days?: number;
  cache?: "hit" | "miss" | "shared";
  durationMs?: number;
  referencesLoaded?: boolean;
  latestDate?: string | null;
  truncated?: boolean;
  freshness?: {
    status: "fresh" | "stale" | "future" | "unknown";
    ageHours: number | null;
    maxAgeHours: number | null;
  };
};

export type OnecSalesResponse = {
  items: OnecRetailReport[];
  references: {
    products: OnecProductReference[];
    warehouses: OnecWarehouseReference[];
    categories: OnecCategoryReference[];
  };
  meta?: SalesLoadMeta;
  message?: string;
};

export type CheckSummary = {
  checks: number;
  revenue: number;
  netRevenue: number;
  averageCheck: number;
  returns: number;
  returnsAmount: number;
  grossRevenue: number;
  discounts: number;
  discountShare: number;
  certificatePayments: number;
  certificatesUsed: number;
};

export type CheckSeriesItem = {
  label: string;
  checks: number;
  revenue: number;
  averageCheck: number;
};

export type CheckAnalytics = {
  current: CheckSummary;
  previous: CheckSummary;
  series: CheckSeriesItem[];
  periodStart: string | null;
  periodEnd: string | null;
  latestDate: string | null;
  loaded: number;
  truncated: boolean;
};

export type CheckAnalyticsResponse = {
  items?: CheckAnalytics;
  message?: string;
};

export type ProductRow = {
  key: string;
  article: string;
  name: string;
  category: string;
  revenue: number;
  sold: number;
  share: number;
  abc: "A" | "B" | "C";
};

export type RevenueBucket = {
  label: string;
  value: number;
};

export type CategoryRevenue = RevenueBucket & {
  share: number;
};

export type SalesAnalytics = {
  latestTimestamp: number;
  currentReports: OnecRetailReport[];
  revenue: number;
  previousRevenue: number;
  grossRevenue: number;
  previousGrossRevenue: number;
  returns: number;
  previousReturns: number;
  sold: number;
  averagePrice: number;
  activeSku: number;
  rows: ProductRow[];
  categoryRows: CategoryRevenue[];
  currentBuckets: RevenueBucket[];
  previousBuckets: RevenueBucket[];
  growth: number | null;
};

export type ChartPoint = RevenueBucket & {
  x: number;
  y: number;
};
