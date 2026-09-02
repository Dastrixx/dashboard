"use client";

import { useMemo, useState } from "react";
import { AbcAnalysis } from "./abc-analysis";
import { buildSalesAnalytics } from "./analytics";
import { CheckAnalyticsPanel } from "./check-analytics-panel";
import { useCheckAnalytics, useSalesData } from "./hooks";
import {
  ReferenceSkeleton,
  RevenueAnalysis,
  SalesSummary,
} from "./overview";
import { ProductRanking } from "./product-ranking";
import type { AnalyticsPeriod, CustomDateRange } from "./types";

function LoadingState() {
  return (
    <div className="page-stack">
      <section className="onec-state panel">
        <span className="onec-spinner" />
        <div>
          <strong>Формируем аналитику из 1С</strong>
          <p>Загружаем отчёты, номенклатуру и категории…</p>
        </div>
      </section>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="page-stack">
      <section className="onec-state onec-error panel">
        <div>
          <strong>Не удалось получить данные 1С</strong>
          <p>{message}</p>
        </div>
      </section>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="page-stack">
      <section className="onec-state panel">
        <div>
          <strong>Нет данных</strong>
          <p>1С не вернула проведённых отчётов о продажах.</p>
        </div>
      </section>
    </div>
  );
}

export function OnecSales() {
  const [period, setPeriod] = useState<AnalyticsPeriod>("month");
  const [customRange, setCustomRange] = useState<CustomDateRange>(null);
  const sales = useSalesData();
  const checks = useCheckAnalytics(period, customRange ?? undefined);
  const analytics = useMemo(
    () =>
      buildSalesAnalytics(
        sales.reports,
        sales.products,
        sales.categories,
        period,
        customRange ?? undefined,
      ),
    [period, customRange, sales.categories, sales.products, sales.reports],
  );

  if (sales.loading) return <LoadingState />;
  if (sales.error) return <ErrorState message={sales.error} />;
  if (!analytics) return <EmptyState />;

  const referencesReady =
    sales.loadMeta?.referencesLoaded === true && !sales.referenceError;

  return (
    <div
      className={`page-stack onec-product-analytics ${
        referencesReady ? "" : "references-pending"
      }`}
    >
      <SalesSummary
        analytics={analytics}
        period={period}
        onPeriodChange={(p) => {
          setPeriod(p);
          if (p !== "custom") setCustomRange(null);
        }}
        customRange={customRange}
        onCustomRangeChange={setCustomRange}
        referencesLoading={sales.referencesLoading}
        referenceError={sales.referenceError}
        truncated={sales.loadMeta?.truncated}
      />

      <CheckAnalyticsPanel
        period={period}
        analytics={checks.data}
        loading={checks.loading}
        error={checks.error}
      />

      <RevenueAnalysis analytics={analytics} period={period} />

      {sales.referencesLoading && <ReferenceSkeleton />}

      <ProductRanking
        reports={sales.reports}
        products={sales.products}
        categories={sales.categories}
        defaultPeriod={period}
        defaultCustomRange={customRange}
      />

      <AbcAnalysis
        rows={analytics.rows}
        categories={sales.categories}
        period={period}
      />

      <section className="onec-document-footnote">
        <span>Получено документов: {sales.reports.length}</span>
        <span>Складов в справочнике: {sales.warehouses.length}</span>
        <span>
          Сервер: {" "}
          {sales.loadMeta?.cache === "hit"
            ? "из кэша"
            : sales.loadMeta?.cache === "shared"
              ? "общий запрос"
              : "из 1С"}
          {typeof sales.loadMeta?.durationMs === "number"
            ? ` · ${sales.loadMeta.durationMs} мс`
            : ""}
        </span>
      </section>
    </div>
  );
}
