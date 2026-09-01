"use client";

import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../shared";
import type {
  CheckAnalytics,
  CheckAnalyticsResponse,
  OnecCategoryReference,
  OnecProductReference,
  OnecRetailReport,
} from "../sales/types";
import type { Period } from "../types";
import { buildOwnerOverview } from "./analytics";
import type {
  OwnerDateRange,
  OwnerOverviewState,
  OwnerReportsResponse,
} from "./types";

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message || `Ошибка HTTP ${response.status}`);
  }
  return payload;
}

function previousRangeStart(range: OwnerDateRange) {
  const from = new Date(`${range.from}T00:00:00`).getTime();
  const to = new Date(`${range.to}T23:59:59.999`).getTime();
  const duration = to - from + 1;
  return new Date(from - duration).toISOString().slice(0, 10);
}

export function useOwnerOverview(
  period: Period,
  dateRange?: OwnerDateRange | null,
): OwnerOverviewState {
  const [reports, setReports] = useState<OnecRetailReport[]>([]);
  const [products, setProducts] = useState<OnecProductReference[]>([]);
  const [categories, setCategories] = useState<OnecCategoryReference[]>([]);
  const [checks, setChecks] = useState<CheckAnalytics | null>(null);
  const [todayChecks, setTodayChecks] = useState<CheckAnalytics | null>(null);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [referencesLoading, setReferencesLoading] = useState(true);
  const [checksLoading, setChecksLoading] = useState(true);
  const [reportsError, setReportsError] = useState("");
  const [referencesError, setReferencesError] = useState("");
  const [checksError, setChecksError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadReports() {
      try {
        setReportsLoading(true);
        setReportsError("");
        const reportQuery = dateRange
          ? `from=${previousRangeStart(dateRange)}&to=${dateRange.to}`
          : `days=${period * 2}`;
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-reports?top=500&${reportQuery}&references=false`,
          { signal: controller.signal, credentials: "include" },
        );
        const payload = await readJson<OwnerReportsResponse>(response);
        setReports(Array.isArray(payload.items) ? payload.items : []);
      } catch (error) {
        if (isAbortError(error)) return;
        setReportsError(
          error instanceof Error ? error.message : "Не удалось загрузить отчёты 1С",
        );
      } finally {
        if (!controller.signal.aborted) setReportsLoading(false);
      }
    }

    async function loadReferences() {
      try {
        setReferencesLoading(true);
        setReferencesError("");
        const reportQuery = dateRange
          ? `from=${previousRangeStart(dateRange)}&to=${dateRange.to}`
          : `days=${period * 2}`;
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-reports?top=500&${reportQuery}`,
          { signal: controller.signal, credentials: "include" },
        );
        const payload = await readJson<OwnerReportsResponse>(response);
        setProducts(
          Array.isArray(payload.references?.products)
            ? payload.references.products
            : [],
        );
        setCategories(
          Array.isArray(payload.references?.categories)
            ? payload.references.categories
            : [],
        );
      } catch (error) {
        if (isAbortError(error)) return;
        setReferencesError(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить категории товаров",
        );
      } finally {
        if (!controller.signal.aborted) setReferencesLoading(false);
      }
    }

    async function loadChecks() {
      try {
        setChecksLoading(true);
        setChecksError("");
        const [periodResponse, todayResponse] = await Promise.all([
          fetch(
            dateRange
              ? `${API_URL}/api/dashboard/onec-check-analytics?from=${dateRange.from}&to=${dateRange.to}`
              : `${API_URL}/api/dashboard/onec-check-analytics?days=${period}`,
            { signal: controller.signal, credentials: "include" },
          ),
          fetch(
            dateRange
              ? `${API_URL}/api/dashboard/onec-check-analytics?from=${dateRange.to}&to=${dateRange.to}`
              : `${API_URL}/api/dashboard/onec-check-analytics?days=1`,
            {
              signal: controller.signal,
              credentials: "include",
            },
          ),
        ]);
        const [periodPayload, todayPayload] = await Promise.all([
          readJson<CheckAnalyticsResponse>(periodResponse),
          readJson<CheckAnalyticsResponse>(todayResponse),
        ]);
        setChecks(periodPayload.items || null);
        setTodayChecks(todayPayload.items || null);
      } catch (error) {
        if (isAbortError(error)) return;
        setChecks(null);
        setTodayChecks(null);
        setChecksError(
          error instanceof Error ? error.message : "Не удалось загрузить чеки 1С",
        );
      } finally {
        if (!controller.signal.aborted) setChecksLoading(false);
      }
    }

    loadReports();
    loadReferences();
    loadChecks();
    return () => controller.abort();
  }, [period, dateRange?.from, dateRange?.to]);

  const analytics = useMemo(
    () => buildOwnerOverview(reports, products, categories, period, dateRange),
    [reports, products, categories, period, dateRange],
  );

  return {
    analytics,
    checks,
    todayChecks,
    reportsLoading,
    referencesLoading,
    checksLoading,
    reportsError,
    referencesError,
    checksError,
  };
}
