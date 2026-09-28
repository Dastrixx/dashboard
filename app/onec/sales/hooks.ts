"use client";

import { useEffect, useState } from "react";
import {
  API_URL,
  dateRangeQuery,
  monthToDateRange,
  PERIODS,
  previousDateRange,
  rollingDateRange,
} from "./config";
import { loadCheckAnalytics } from "./check-api";
import { fetchSyncedJson } from './sync-fetch';
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
  const [syncProgress, setSyncProgress] = useState('');

  async function retryReports() {
    const range = dateRange || monthToDateRange();
    await Promise.all([range, previousDateRange(range)].map(item =>
      fetch(`${API_URL}/api/sync/retry`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item),
      }),
    ));
    setRefreshKey(value => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    let refreshTimer: number | undefined;
    let referencesStarted = false;
    let reportsPartiallyLoaded = false;
    const currentRange = dateRange || monthToDateRange();
    const currentQuery = salesHistoryQuery(currentRange);
    const previousQuery = salesHistoryQuery(previousDateRange(currentRange));

    async function loadReferences() {
      referencesStarted = true;
      setReferencesLoading(true);
      setReferenceError("");

      try {
        const data = await fetchSyncedJson<Partial<OnecSalesResponse>>(
          `${API_URL}/api/dashboard/onec-reports?${currentQuery}&references=only`,
          controller.signal,
        );

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
          return fetchSyncedJson<Partial<OnecSalesResponse>>(
            `${API_URL}/api/dashboard/onec-reports?${query}&references=false`,
            controller.signal, setSyncProgress,
            query === currentQuery ? partial => {
              if (controller.signal.aborted) return;
              reportsPartiallyLoaded = true;
              setReports((partial.items || []).filter(report => report.Posted));
              setLoadMeta(partial.meta);
              setAnalysisTimestamp(Date.now());
              setLoading(false);
              if (!referencesStarted) void loadReferences();
            } : undefined,
          );
        };
        const current = await loadRange(currentQuery);

        if (controller.signal.aborted) return;

        setReports((current.items || []).filter((report) => report.Posted));
        setLoadMeta(current.meta);
        setAnalysisTimestamp(Date.now());
        setLoading(false);
        void loadReferences();

        try {
          const previous = await loadRange(previousQuery);
          if (controller.signal.aborted) return;

          const reportsByKey = new Map<string, OnecRetailReport>();
          [...(current.items || []), ...(previous.items || [])]
            .filter((report) => report.Posted)
            .forEach((report) => reportsByKey.set(report.Ref_Key, report));
          setReports([...reportsByKey.values()]);
          setAnalysisTimestamp(Date.now());
        } catch (loadError) {
          if (!isAbortError(loadError)) setSyncProgress('Не удалось загрузить сравнение с предыдущим периодом');
        }
      } catch (loadError) {
        if (controller.signal.aborted || isAbortError(loadError)) return;

        const message = loadError instanceof Error ? loadError.message : "Не удалось загрузить данные 1С";
        if (reportsPartiallyLoaded) setSyncProgress(`Часть отчётов доступна. ${message}`);
        else setError(message);
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

    loadReports();
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
    syncProgress,
    retryReports,
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
    const controller = new AbortController();
    let receivedPartial = false;

    async function load() {
      try {
        setLoading(true);
        setError("");
        const range = dateRange || (period === 'month' ? monthToDateRange() : rollingDateRange(PERIODS[period].days));
        const query = new URLSearchParams(dateRangeQuery(range));
        query.set("includePrevious", "false");
        const analytics = await loadCheckAnalytics(query.toString(), controller.signal, partial => {
          if (!active) return;
          receivedPartial = true;
          setData(partial);
          setLoading(false);
        });
        if (active) setData(analytics);
      } catch (loadError) {
        if (!active) return;

        if (!receivedPartial) {
          setData(null);
          setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить аналитику чеков");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
      controller.abort();
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
    let receivedPartial = false;

    async function load() {
      try {
        setLoading(true);
        setError("");
        const range = dateRange || (period === 'month' ? monthToDateRange() : rollingDateRange(PERIODS[period].days));
        const query = new URLSearchParams(dateRangeQuery(range));
        query.set("includePrevious", "false");
        const payload = await fetchSyncedJson<MarginAnalyticsResponse>(
          `${API_URL}/api/dashboard/onec-margin?${query}`,
          controller.signal, undefined, partial => {
            if (controller.signal.aborted) return;
            receivedPartial = true;
            setData(partial.items || null);
            setLoading(false);
          },
        );
        setData(payload.items || null);
      } catch (loadError) {
        if (isAbortError(loadError)) return;
        if (!receivedPartial) {
          setData(null);
          setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить маржу");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [dateRange, period]);

  return { data, loading, error };
}
