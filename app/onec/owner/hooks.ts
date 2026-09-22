"use client";

import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../shared";
import { loadCheckAnalytics } from "../sales/check-api";
import { previousDateRange } from "../sales/config";
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

const OWNER_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

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

function formatQueryDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function rollingDateRange(days: Period, timestamp: number): OwnerDateRange {
  const to = new Date(timestamp);
  const from = new Date(to);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));

  return {
    from: formatQueryDate(from),
    to: formatQueryDate(to),
  };
}

export function useOwnerOverview(
  period: Period,
  dateRange?: OwnerDateRange | null,
): OwnerOverviewState {
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
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

  const effectiveRange = useMemo(
    () => dateRange || rollingDateRange(period, refreshedAt),
    [dateRange, period, refreshedAt],
  );

  useEffect(() => {
    const controller = new AbortController();
    let refreshTimer: number | undefined;

    async function loadReports() {
      try {
        setReportsLoading(true);
        setReportsError("");
        const loadRange = async (range: OwnerDateRange) => {
          const reportQuery = new URLSearchParams(range);
          const response = await fetch(
            `${API_URL}/api/dashboard/onec-reports?${reportQuery}&references=false`,
            { credentials: "include", signal: controller.signal },
          );
          return readJson<OwnerReportsResponse>(response);
        };
        const [current, previous] = await Promise.all([
          loadRange(effectiveRange),
          loadRange(previousDateRange(effectiveRange)),
        ]);
        if (controller.signal.aborted) return;
        const reportsByKey = new Map<string, OnecRetailReport>();
        [...(current.items || []), ...(previous.items || [])].forEach(
          (report) => reportsByKey.set(report.Ref_Key, report),
        );
        setReports([...reportsByKey.values()]);
      } catch (error) {
        if (isAbortError(error)) return;
        setReportsError(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить отчёты 1С",
        );
      } finally {
        if (!controller.signal.aborted) setReportsLoading(false);
      }
    }

    async function loadReferences() {
      try {
        setReferencesLoading(true);
        setReferencesError("");
        const reportQuery = new URLSearchParams({
          from: effectiveRange.from,
          to: effectiveRange.to,
        });
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-reports?${reportQuery}&references=only`,
          { credentials: "include", signal: controller.signal },
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
        const query = new URLSearchParams({
          from: effectiveRange.from,
          to: effectiveRange.to,
          includePrevious: "false",
        });
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
          error instanceof Error
            ? error.message
            : "Не удалось загрузить маржу 1С",
        );
      } finally {
        if (!controller.signal.aborted) setMarginLoading(false);
      }
    }

    async function loadChecks() {
      try {
        setChecksLoading(true);
        setChecksError("");
        const query = new URLSearchParams({
          from: effectiveRange.from,
          to: effectiveRange.to,
          includePrevious: "false",
        });
        const analytics = await loadCheckAnalytics(query.toString());

        if (controller.signal.aborted) return;

        setChecks(analytics);
      } catch (error) {
        if (isAbortError(error)) return;
        setChecks(null);
        setChecksError(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить чеки 1С",
        );
      } finally {
        if (!controller.signal.aborted) setChecksLoading(false);
      }
    }

    void Promise.allSettled([
      loadReports(),
      loadReferences(),
      loadChecks(),
      loadMargin(),
    ]).then(() => {
      if (controller.signal.aborted) return;

      refreshTimer = window.setTimeout(
        () => setRefreshedAt(Date.now()),
        OWNER_REFRESH_INTERVAL_MS,
      );
    });

    return () => {
      controller.abort();
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, [effectiveRange]);

  const analytics = useMemo(
    () =>
      buildOwnerOverview(
        reports,
        products,
        categories,
        period,
        effectiveRange,
      ),
    [reports, products, categories, period, effectiveRange],
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
