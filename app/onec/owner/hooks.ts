"use client";

import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../shared";
import { loadCheckAnalytics } from "../sales/check-api";
import type {
  CheckAnalytics,
  OnecCategoryReference,
  OnecProductReference,
  OnecRetailReport,
  MarginAnalytics,
  MarginAnalyticsResponse,
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
  const rangeFrom = dateRange?.from;
  const rangeTo = dateRange?.to;
  const [reports, setReports] = useState<OnecRetailReport[]>([]);
  const [products, setProducts] = useState<OnecProductReference[]>([]);
  const [categories, setCategories] = useState<OnecCategoryReference[]>([]);
  const [checks, setChecks] = useState<CheckAnalytics | null>(null);
  const [margin, setMargin] = useState<MarginAnalytics | null>(null);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [referencesLoading, setReferencesLoading] = useState(true);
  const [checksLoading, setChecksLoading] = useState(true);
  const [marginLoading, setMarginLoading] = useState(true);
  const [reportsError, setReportsError] = useState("");
  const [referencesError, setReferencesError] = useState("");
  const [checksError, setChecksError] = useState("");
  const [marginError, setMarginError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadReports() {
      try {
        setReportsLoading(true);
        setReportsError("");
        const reportQuery =
          rangeFrom && rangeTo
            ? [
                `from=${previousRangeStart({
                  from: rangeFrom,
                  to: rangeTo,
                })}`,
                `to=${rangeTo}`,
              ].join("&")
            : `days=${period * 2}`;
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-reports?top=500&${reportQuery}&references=false`,
          { credentials: "include" },
        );
        const payload = await readJson<OwnerReportsResponse>(response);
        if (controller.signal.aborted) return;
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
        const reportQuery =
          rangeFrom && rangeTo
            ? [
                `from=${previousRangeStart({
                  from: rangeFrom,
                  to: rangeTo,
                })}`,
                `to=${rangeTo}`,
              ].join("&")
            : `days=${period * 2}`;
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-reports?top=500&${reportQuery}`,
          { credentials: "include" },
        );
        const payload = await readJson<OwnerReportsResponse>(response);
        if (controller.signal.aborted) return;
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

    async function loadMargin() {
      try {
        setMarginLoading(true);
        setMarginError("");
        const query = rangeFrom && rangeTo
          ? `from=${rangeFrom}&to=${rangeTo}`
          : `days=${period}`;
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-margin?${query}`,
          { signal: controller.signal, credentials: "include" },
        );
        const payload = await readJson<MarginAnalyticsResponse>(response);
        setMargin(payload.items || null);
      } catch (error) {
        if (isAbortError(error)) return;
        setMargin(null);
        setMarginError(
          error instanceof Error ? error.message : "Не удалось загрузить маржу 1С",
        );
      } finally {
        if (!controller.signal.aborted) setMarginLoading(false);
      }
    }

    async function loadChecks() {
      try {
        setChecksLoading(true);
        setChecksError("");
        const query = rangeFrom && rangeTo
          ? `from=${rangeFrom}&to=${rangeTo}`
          : `days=${period}`;
        const analytics = await loadCheckAnalytics(query);

        if (controller.signal.aborted) return;

        setChecks(analytics);
      } catch (error) {
        if (isAbortError(error)) return;
        setChecks(null);
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
    loadMargin();
    return () => controller.abort();
  }, [period, rangeFrom, rangeTo]);

  const analytics = useMemo(
    () => buildOwnerOverview(reports, products, categories, period, dateRange),
    [reports, products, categories, period, dateRange],
  );

  return {
    analytics,
    checks,
    reportsLoading,
    referencesLoading,
    checksLoading,
    reportsError,
    referencesError,
    checksError,
    margin,
    marginLoading,
    marginError,
  };
}
