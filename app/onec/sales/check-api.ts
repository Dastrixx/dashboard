import { API_URL } from "./config";
import { fetchSyncedJson } from "./sync-fetch";
import type { CheckAnalytics, CheckAnalyticsResponse } from "./types";

export async function loadCheckAnalytics(query: string, signal?: AbortSignal,
  onPartial?: (analytics: CheckAnalytics) => void): Promise<CheckAnalytics> {
  const payload = await fetchSyncedJson<CheckAnalyticsResponse>(
    `${API_URL}/api/dashboard/onec-check-analytics?${query}`,
    signal,
    undefined,
    partial => { if (partial.items) onPartial?.(partial.items); },
  );
  if (!payload.items) throw new Error("1С вернула пустой ответ по чекам");
  return payload.items;
}
