"use client";

import { useMemo, useState } from "react";
import { rollingDateRange } from "./sales/config";
import type { SalesDateRange } from "./sales/types";
import { DataState, MissingSource } from "./shared";
import { buildSellerChart, buildTeamView } from "./team/analytics";
import { TeamHeader } from "./team/header";
import { useTeamData, useTeamPlan } from "./team/hooks";
import { TeamPlanPanel } from "./team/plan-panel";
import { SellerWorkspace } from "./team/sellers";
import { TeamSummary } from "./team/summary";
import type { Period, SalesChannel } from "./team/types";
import type { SellerPayload } from "./types";

export function OnecTeam() {
  const [period, setPeriod] = useState<Period>(30);
  const [dateFrom, setDateFrom] = useState(() => rollingDateRange(30).from);
  const [dateTo, setDateTo] = useState(() => rollingDateRange(30).to);
  const [dateRange, setDateRange] = useState<SalesDateRange | null>(null);
  const [storeKey, setStoreKey] = useState("all");
  const [channel, setChannel] = useState<SalesChannel>("all");
  const [selectedKey, setSelectedKey] = useState("");

  const query = { storeKey, period, channel, dateRange };
  const data = useTeamData(query);
  const teamPlan = useTeamPlan({ storeKey, period, channel });

  const view = useMemo(
    () => buildTeamView(data.payload, storeKey),
    [data.payload, storeKey],
  );
  const selected =
    view.rows.find((seller) => seller.key === selectedKey) ?? view.rows[0];
  const chart = useMemo(() => buildSellerChart(selected), [selected]);
  const planPercent = !dateRange && teamPlan.plan
    ? (view.revenue / teamPlan.plan) * 100
    : 0;

  if (data.loading || data.error) {
    return (
      <DataState loading={data.loading} error={data.error} empty={false} />
    );
  }

  if (channel === "all" && !data.payload.items?.length) {
    return <MissingSellerSource payload={data.payload} />;
  }

  return (
    <div className="page-stack onec-team-workspace">
      <TeamHeader
        stores={view.stores}
        storeKey={storeKey}
        period={period}
        dateFilter={{
          from: dateFrom,
          to: dateTo,
          appliedRange: dateRange,
          canApply: Boolean(dateFrom && dateTo && dateFrom <= dateTo),
          onFromChange: setDateFrom,
          onToChange: setDateTo,
          onApply: () => setDateRange({ from: dateFrom, to: dateTo }),
        }}
        channel={channel}
        onStoreChange={setStoreKey}
        onPeriodChange={(value) => { setPeriod(value); setDateRange(null); }}
        onChannelChange={setChannel}
      />

      <TeamSummary
        view={view}
        channel={channel}
        plan={dateRange ? 0 : teamPlan.plan}
        showPlan={!dateRange}
        planPercent={planPercent}
        margin={data.margin}
        marginError={data.marginError}
      />

      <SellerWorkspace
        view={view}
        selected={selected}
        selectedKey={selected?.key ?? ""}
        chart={chart}
        channel={channel}
        plan={dateRange ? 0 : teamPlan.plan}
        onSellerChange={setSelectedKey}
      />

      {!dateRange && <TeamPlanPanel
        view={view}
        storeKey={storeKey}
        channel={channel}
        plan={teamPlan.plan}
        planPercent={planPercent}
        planInput={teamPlan.planInput}
        planLoading={teamPlan.loading}
        planSaving={teamPlan.saving}
        planMessage={teamPlan.message}
        source={data.payload.meta?.source}
        onPlanInputChange={teamPlan.setPlanInput}
        onSave={teamPlan.save}
      />}
    </div>
  );
}

function MissingSellerSource({ payload }: { payload: SellerPayload }) {
  const diagnostics = payload.meta?.diagnostics;
  const scannedChecks = diagnostics?.scannedChecks ?? 0;
  const consultantLines = diagnostics?.checkLinesWithConsultant ?? 0;

  return (
    <MissingSource
      title="Продажи продавцов"
      description={
        "В чеках 1С не удалось определить консультанта"
      }
      source={[
        `Проверено чеков: ${scannedChecks}`,
        `строк с консультантом: ${consultantLines}`,
      ].join("; ")}
    />
  );
}
