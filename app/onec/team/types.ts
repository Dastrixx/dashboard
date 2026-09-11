import type { SellerReference } from "../types";

export type Period = 1 | 7 | 30;
export type SalesChannel = "all" | "online" | "offline";

export type SellerRow = {
  key: string;
  name: string;
  storeKey: string;
  store: string;
  revenue: number;
  quantity: number;
  checks: number;
  checkKeys: string[];
  discounts: number;
  returns: number;
  daily: Record<string, number>;
  rank: number;
  share: number;
};
export type TeamView = {
  rows: SellerRow[];
  stores: SellerReference[];
  revenue: number;
  checks: number;
  averageCheck: number;
  quantity: number;
};

export type ChartPoint = {
  date: string;
  value: number;
  x: number;
  y: number;
};

export type SellerChart = {
  points: ChartPoint[];
  line: string;
  area: string;
};
