"use client";

import { DataState } from "../shared";
import type { Period } from "../types";
import { CategorySales } from "./categories";
import { OwnerCheckSummary } from "./check-summary";
import { RevenueComparison } from "./comparison";
import { useOwnerOverview } from "./hooks";
import { ImportantInsights } from "./insights";
import { OwnerKpis } from "./kpis";

export function OnecOverview({ period }: { period: Period }) {
  const state = useOwnerOverview(period);

  if (state.reportsLoading || state.reportsError || !state.analytics) {
    return (
      <div className="page-stack">
        <DataState
          loading={state.reportsLoading}
          error={state.reportsError}
          empty={!state.reportsLoading && !state.reportsError && !state.analytics}
        />
      </div>
    );
  }

  const { analytics } = state;

  return (
    <div className="page-stack owner-overview">
      <section className="onec-source-panel owner-source-panel">
        <div>
          <span className="onec-source-kicker">Реальные данные 1С</span>
          <h2>Состояние бизнеса на сегодня</h2>
          <p>
            Последний документ: {new Date(analytics.latestDate).toLocaleString("ru-RU")}
          </p>
        </div>
        <span className="onec-posted">OData подключена</span>
      </section>

      <OwnerKpis
        analytics={analytics}
        todayChecks={state.todayChecks}
        checksLoading={state.checksLoading}
      />

      <OwnerCheckSummary
        checks={state.checks}
        loading={state.checksLoading}
        error={state.checksError}
        period={period}
      />

      <section className="owner-main-grid">
        <RevenueComparison analytics={analytics} period={period} />
        <CategorySales
          categories={analytics.categories}
          loading={state.referencesLoading}
          error={state.referencesError}
        />
      </section>

      <ImportantInsights
        analytics={analytics}
        checks={state.checks}
        checksError={state.checksError}
        period={period}
      />
    </div>
  );
}
