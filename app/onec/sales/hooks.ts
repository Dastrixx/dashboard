"use client";

import { useEffect, useState } from "react";
import {
  API_URL,
  dateRangeQuery,
  PERIODS,
  previousDateRange,
  rollingDateRange,
} from "./config";
import { loadCheckAnalytics } from "./check-api";
import type {
  AnalyticsPeriod,
  CheckAnalytics,
  OnecCategoryReference,
  OnecProductReference,
  OnecRetailReport,
  OnecSalesResponse,
  OnecWarehouseReference,
  SalesLoadMeta,
  MarginAnalytics,
  MarginAnalyticsResponse,
  SalesDateRange,
} from "./types";

const SALES_HISTORY_DAYS = 30;
const SALES_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function salesHistoryQuery(range: SalesDateRange) {
  const query = new URLSearchParams(dateRangeQuery(range));

  return query.toString();
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function useSalesData(dateRange?: SalesDateRange | null) {
  const [reports, setReports] = useState<OnecRetailReport[]>([]);
  const [products, setProducts] = useState<OnecProductReference[]>([]);
  const [warehouses, setWarehouses] = useState<OnecWarehouseReference[]>([]);
  const [categories, setCategories] = useState<OnecCategoryReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [referenceError, setReferenceError] = useState("");
  const [loadMeta, setLoadMeta] = useState<SalesLoadMeta>();
  const [analysisTimestamp, setAnalysisTimestamp] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let refreshTimer: number | undefined;
    const currentRange = dateRange || rollingDateRange(SALES_HISTORY_DAYS);
    const currentQuery = salesHistoryQuery(currentRange);
    const previousQuery = salesHistoryQuery(previousDateRange(currentRange));

    async function loadReferences() {
      setReferencesLoading(true);
      setReferenceError("");

      try {
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-reports?${currentQuery}&references=only`,
          {
            credentials: "include",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const data = (await response.json()) as Partial<OnecSalesResponse>;

        if (!response.ok) {
          throw new Error(data.message || `Ошибка HTTP ${response.status}`);
        }

        if (controller.signal.aborted) return;

        setProducts(
          Array.isArray(data.references?.products)
            ? data.references.products
            : [],
        );
        setWarehouses(
          Array.isArray(data.references?.warehouses)
            ? data.references.warehouses
            : [],
        );
        setCategories(
          Array.isArray(data.references?.categories)
            ? data.references.categories
            : [],
        );
        setLoadMeta(data.meta);
      } catch (loadError) {
        if (controller.signal.aborted || isAbortError(loadError)) return;

        setReferenceError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось получить названия товаров",
        );
      } finally {
        if (!controller.signal.aborted) setReferencesLoading(false);
      }
    }

    async function loadReports() {
      try {
        setLoading(true);
        setError("");
        const loadRange = async (query: string) => {
          const response = await fetch(
            `${API_URL}/api/dashboard/onec-reports?${query}&references=false`,
            {
              credentials: "include",
              cache: "no-store",
              signal: controller.signal,
            },
          );
          const data = (await response.json()) as Partial<OnecSalesResponse>;
          if (!response.ok) {
            throw new Error(data.message || `Ошибка HTTP ${response.status}`);
          }
          return data;
        };
        const [current, previous] = await Promise.all([
          loadRange(currentQuery),
          loadRange(previousQuery),
        ]);

        if (controller.signal.aborted) return;

        const reportsByKey = new Map<string, OnecRetailReport>();
        [...(current.items || []), ...(previous.items || [])]
          .filter((report) => report.Posted)
          .forEach((report) => reportsByKey.set(report.Ref_Key, report));
        setReports([...reportsByKey.values()]);
        setLoadMeta(current.meta);
        setAnalysisTimestamp(Date.now());
        setLoading(false);
      } catch (loadError) {
        if (controller.signal.aborted || isAbortError(loadError)) return;

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось загрузить данные 1С",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          refreshTimer = window.setTimeout(
            () => setRefreshKey((value) => value + 1),
            SALES_REFRESH_INTERVAL_MS,
          );
        }
      }
    }

    void loadReports();
    void loadReferences();
    return () => {
      controller.abort();
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, [dateRange, refreshKey]);

  return {
    reports,
    products,
    warehouses,
    categories,
    loading,
    error,
    referencesLoading,
    referenceError,
    loadMeta,
    analysisTimestamp,
  };
}

export function useCheckAnalytics(
  period: AnalyticsPeriod,
  dateRange?: SalesDateRange | null,
) {
  const [data, setData] = useState<CheckAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError("");
        const range = dateRange || rollingDateRange(PERIODS[period].days);
        const query = new URLSearchParams(dateRangeQuery(range));
        query.set("includePrevious", "false");
        const analytics = await loadCheckAnalytics(query.toString());
        if (active) setData(analytics);
      } catch (loadError) {
        if (!active) return;

        setData(null);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось загрузить аналитику чеков",
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [dateRange, period]);

  return { data, loading, error };
}


export function useMarginAnalytics(
  period: AnalyticsPeriod,
  dateRange?: SalesDateRange | null,
) {
  const [data, setData] = useState<MarginAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        const range = dateRange || rollingDateRange(PERIODS[period].days);
        const query = new URLSearchParams(dateRangeQuery(range));
        query.set("includePrevious", "false");
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-margin?${query}`,
          { signal: controller.signal, credentials: "include" },
        );
        const payload = (await response.json()) as MarginAnalyticsResponse;
        if (!response.ok) {
          throw new Error(payload.message || `Ошибка HTTP ${response.status}`);
        }
        setData(payload.items || null);
      } catch (loadError) {
        if (isAbortError(loadError)) return;
        setData(null);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось загрузить маржу",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [dateRange, period]);

  return { data, loading, error };
}
