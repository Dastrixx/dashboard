"use client";

import { useEffect, useState } from "react";
import { API_URL, PERIODS } from "./config";
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
} from "./types";

const SALES_HISTORY_DAYS = 60;
const SALES_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function formatQueryDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function salesHistoryQuery(now = new Date()) {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (SALES_HISTORY_DAYS - 1));

  return new URLSearchParams({
    top: "500",
    from: formatQueryDate(from),
    to: formatQueryDate(now),
  }).toString();
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function useSalesData() {
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
    const refresh = () => setRefreshKey((value) => value + 1);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const interval = window.setInterval(
      refresh,
      SALES_REFRESH_INTERVAL_MS,
    );

    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const query = salesHistoryQuery();

    async function loadReferences() {
      setReferencesLoading(true);
      setReferenceError("");

      try {
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-reports?${query}`,
          {
            signal: controller.signal,
            credentials: "include",
            cache: "no-store",
          },
        );
        const data = (await response.json()) as Partial<OnecSalesResponse>;

        if (!response.ok) {
          throw new Error(data.message || `Ошибка HTTP ${response.status}`);
        }

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
        if (isAbortError(loadError)) return;

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
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-reports?${query}&references=false`,
          {
            signal: controller.signal,
            credentials: "include",
            cache: "no-store",
          },
        );
        const data = (await response.json()) as Partial<OnecSalesResponse>;

        if (!response.ok) {
          throw new Error(data.message || `Ошибка HTTP ${response.status}`);
        }

        setReports(
          Array.isArray(data.items)
            ? data.items.filter((report) => report.Posted)
            : [],
        );
        setLoadMeta(data.meta);
        setAnalysisTimestamp(Date.now());
        setLoading(false);
        await loadReferences();
      } catch (loadError) {
        if (isAbortError(loadError)) return;

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось загрузить данные 1С",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadReports();
    return () => controller.abort();
  }, [refreshKey]);

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

export function useCheckAnalytics(period: AnalyticsPeriod) {
  const [data, setData] = useState<CheckAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError("");
        const analytics = await loadCheckAnalytics(
          `days=${PERIODS[period].days}`,
        );
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
  }, [period]);

  return { data, loading, error };
}


export function useMarginAnalytics(period: AnalyticsPeriod) {
  const [data, setData] = useState<MarginAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-margin?days=${PERIODS[period].days}`,
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
  }, [period]);

  return { data, loading, error };
}
