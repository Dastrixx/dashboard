import { API_URL } from "../shared";
import type { MarginAnalyticsResponse } from "../sales/types";
import type { SellerPayload } from "../types";
import type { Period, SalesChannel } from "./types";
import { fetchSyncedJson } from "../sales/sync-fetch";

type TeamQuery = {
  storeKey: string;
  period: Period;
  channel: SalesChannel;
};

type TeamPlanPayload = {
  item?: {
    amount?: number;
  };
  message?: string;
};

export type TeamDataResult = {
  payload: SellerPayload;
  margin: MarginAnalyticsResponse["items"] | null;
  marginError: string;
};

export async function fetchTeamPlan(
  query: TeamQuery,
  signal: AbortSignal,
) {
  const response = await fetch(buildUrl("/api/dashboard/team-plan", query), {
    signal,
    credentials: "include",
    cache: "no-store",
  });
  const data = await readJson<TeamPlanPayload>(response);

  ensureSuccessful(response, data.message);
  return Number(data.item?.amount ?? 0);
}
export async function fetchTeamData(
  query: TeamQuery,
  signal: AbortSignal,
  onPartial?: (payload: SellerPayload) => void,
): Promise<TeamDataResult> {
  const sellerUrl = buildUrl("/api/dashboard/onec-consultants", {
    days: query.period,
    channel: query.channel,
  });
  const marginUrl = buildUrl("/api/dashboard/onec-margin", {
    days: query.period,
    storeKey: query.storeKey,
    channel: query.channel,
  });

  const [payload, marginResult] = await Promise.all([
    fetchSyncedJson<SellerPayload>(sellerUrl, signal, undefined, onPartial),
    fetchSyncedJson<MarginAnalyticsResponse>(marginUrl, signal)
      .then(value => ({ value, error: "" }))
      .catch(cause => ({ value: null, error: cause instanceof Error ? cause.message : "Маржа недоступна" })),
  ]);

  return {
    payload,
    margin: marginResult.value?.items ?? null,
    marginError: marginResult.error,
  };
}

export async function updateTeamPlan(
  query: TeamQuery,
  amount: number,
) {
  const response = await fetch(`${API_URL}/api/dashboard/team-plan`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...query, amount }),
  });
  const data = await readJson<TeamPlanPayload>(response);

  ensureSuccessful(response, data.message);
  return Number(data.item?.amount ?? amount);
}

function buildUrl(
  pathname: string,
  query: Record<string, string | number>,
) {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    params.set(key, String(value));
  });

  return `${API_URL}${pathname}?${params.toString()}`;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function ensureSuccessful(response: Response, message?: string) {
  if (!response.ok) {
    throw new Error(message ?? `Ошибка HTTP ${response.status}`);
  }
}
