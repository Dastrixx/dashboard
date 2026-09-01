import type {
  CheckAnalytics,
  OnecCategoryReference,
  OnecProductReference,
  OnecRetailReport,
  RevenueBucket,
} from "../sales/types";

export type OwnerReportsResponse = {
  items?: OnecRetailReport[];
  references?: {
    products?: OnecProductReference[];
    categories?: OnecCategoryReference[];
  };
  meta?: {
    loaded?: number;
    cache?: "hit" | "miss" | "shared";
    durationMs?: number;
  };
  message?: string;
};

export type OwnerDateRange = {
  from: string;
  to: string;
};

export type OwnerCategory = {
  label: string;
  revenue: number;
  share: number;
};

export type OwnerComparisonBucket = RevenueBucket & {
  previousValue: number;
};

export type OwnerOverviewAnalytics = {
  latestDate: string;
  today: {
    revenue: number;
    previousRevenue: number;
    sold: number;
    previousSold: number;
    returns: number;
  };
  period: {
    revenue: number;
    previousRevenue: number;
    sold: number;
    previousSold: number;
    returns: number;
    previousReturns: number;
    activeSku: number;
    revenueGrowth: number | null;
    soldGrowth: number | null;
  };
  comparison: OwnerComparisonBucket[];
  categories: OwnerCategory[];
};

export type OwnerOverviewState = {
  analytics: OwnerOverviewAnalytics | null;
  checks: CheckAnalytics | null;
  todayChecks: CheckAnalytics | null;
  reportsLoading: boolean;
  referencesLoading: boolean;
  checksLoading: boolean;
  reportsError: string;
  referencesError: string;
  checksError: string;
};
