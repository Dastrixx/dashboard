"use client";

import { useMemo, useState } from "react";
import { DataState, MissingSource } from "./shared";
import { rollingDateRange } from "./sales/config";
import { buildSellerChart, buildTeamView } from "./team/analytics";
import { TeamHeader } from "./team/header";
import { useTeamData, useTeamPlan } from "./team/hooks";
import { TeamPlanPanel } from "./team/plan-panel";
import { SellerWorkspace } from "./team/sellers";
import { TeamSummary } from "./team/summary";
import type { Period, SalesChannel } from "./team/types";
import type { SellerPayload } from "./types";

const DEFAULT_TEAM_RANGE = rollingDateRange(30);

export function OnecTeam() {
  const [period, setPeriod] = useState<Period>(30);
  const [storeKey, setStoreKey] = useState("all");
  const [channel, setChannel] = useState<SalesChannel>("all");
  const [selectedKey, setSelectedKey] = useState("");
  const [dateFrom, setDateFrom] = useState(DEFAULT_TEAM_RANGE.from);
  const [dateTo, setDateTo] = useState(DEFAULT_TEAM_RANGE.to);
  const [dateRange, setDateRange] = useState(DEFAULT_TEAM_RANGE);

  const data = useTeamData({ storeKey, channel, dateRange });
  const teamPlan = useTeamPlan({ storeKey, period, channel });

  const selectPeriod = (value: Period) => {
    const range = rollingDateRange(value);
    setPeriod(value);
    setDateFrom(range.from);
    setDateTo(range.to);
    setDateRange(range);
  };

  const canApplyDateRange = Boolean(
    dateFrom && dateTo && dateFrom <= dateTo,
  );

  const applyDateRange = () => {
    if (!canApplyDateRange) return;
    setDateRange({ from: dateFrom, to: dateTo });
  };

  const view = useMemo(
    () => buildTeamView(data.payload, storeKey),
    [data.payload, storeKey],
  );
  const selected =
    view.rows.find((seller) => seller.key === selectedKey) ?? view.rows[0];
  const chart = useMemo(() => buildSellerChart(selected), [selected]);
  const planPercent = teamPlan.plan
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
        channel={channel}
        dateFrom={dateFrom}
        dateTo={dateTo}
        dateRange={dateRange}
        canApplyDateRange={canApplyDateRange}
        onStoreChange={setStoreKey}
        onPeriodChange={selectPeriod}
        onChannelChange={setChannel}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onApplyDateRange={applyDateRange}
      />

      <TeamSummary
        view={view}
        channel={channel}
        plan={teamPlan.plan}
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
        plan={teamPlan.plan}
        onSellerChange={setSelectedKey}
      />

      <TeamPlanPanel
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
      />
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
