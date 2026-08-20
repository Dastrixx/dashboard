"use client";

import { useEffect, useState } from "react";
import { API_URL, PERIODS } from "./config";
import type {
  AnalyticsPeriod,
  CheckAnalytics,
  CheckAnalyticsResponse,
  OnecCategoryReference,
  OnecProductReference,
  OnecRetailReport,
  OnecSalesResponse,
  OnecWarehouseReference,
  SalesLoadMeta,
} from "./types";

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

  useEffect(() => {
    const controller = new AbortController();

    async function loadReferences() {
      setReferencesLoading(true);
      setReferenceError("");

      try {
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-reports?top=500&days=60`,
          { signal: controller.signal },
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
          `${API_URL}/api/dashboard/onec-reports?top=500&days=60&references=false`,
          { signal: controller.signal },
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
  }, []);

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
  };
}

export function useCheckAnalytics(period: AnalyticsPeriod) {
  const [data, setData] = useState<CheckAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-check-analytics?days=${PERIODS[period].days}`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as CheckAnalyticsResponse;

        if (!response.ok) {
          throw new Error(payload.message || `Ошибка HTTP ${response.status}`);
        }
        if (!payload.items) {
          throw new Error("1С вернула пустой ответ по чекам");
        }

        setData(payload.items);
      } catch (loadError) {
        if (isAbortError(loadError)) return;

        setData(null);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось загрузить аналитику чеков",
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
