import { fetchLocalAnalytics } from "../local-api";
import { API_URL } from "../shared";
import type { MarginAnalyticsResponse } from "../sales/types";
import type { SalesDateRange } from "../sales/types";
import type { SellerPayload } from "../types";
import type { Period, SalesChannel } from "./types";

type TeamQuery = {
  storeKey: string;
  period: Period;
  channel: SalesChannel;
  dateRange?: SalesDateRange | null;
};

type TeamPlanPayload = {
  item?: {
    amount?: number;
  };
  message?: string;
};

export type TeamMarginResult = {
  margin: MarginAnalyticsResponse["items"] | null;
  marginError: string;
};

export async function fetchTeamPlan(
  query: TeamQuery,
  signal: AbortSignal,
) {
  const response = await fetch(buildUrl("/api/dashboard/team-plan", {
    storeKey: query.storeKey,
    period: query.period,
    channel: query.channel,
  }), {
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
): Promise<SellerPayload> {
  const sellerUrl = buildUrl("/api/dashboard/onec-consultants", {
    days: query.period,
    channel: query.channel,
    ...(query.dateRange ?? {}),
  });
  const sellerResponse = await fetch(sellerUrl, requestOptions(signal));
  const payload = await readJson<SellerPayload>(sellerResponse);
  ensureSuccessful(sellerResponse, payload.message);
  return payload;
}

export async function fetchTeamMargin(
  query: TeamQuery,
  signal: AbortSignal,
): Promise<TeamMarginResult> {
  const marginUrl = buildUrl("/api/dashboard/onec-margin", {
    days: query.period,
    storeKey: query.storeKey,
    channel: query.channel,
    ...(query.dateRange ?? {}),
  });

  const marginResponse = await fetchLocalAnalytics(marginUrl, requestOptions(signal));
  const marginPayload = await readJson<MarginAnalyticsResponse>(marginResponse);

  return {
    margin: marginResponse.ok ? marginPayload.items ?? null : null,
    marginError: marginResponse.ok
      ? ""
      : marginPayload.message ?? `Ошибка HTTP ${marginResponse.status}`,
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

function requestOptions(signal: AbortSignal): RequestInit {
  return {
    signal,
    credentials: "include",
    cache: "no-store",
  };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function ensureSuccessful(response: Response, message?: string) {
  if (!response.ok) {
    throw new Error(message ?? `Ошибка HTTP ${response.status}`);
  }
}
