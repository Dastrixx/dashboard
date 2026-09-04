import { API_URL } from "./config";
import type { CheckAnalytics, CheckAnalyticsResponse } from "./types";

const CHECK_CACHE_TTL_MS = 30_000;

type CacheEntry = {
  expiresAt: number;
  promise: Promise<CheckAnalytics>;
};

const requestCache = new Map<string, CacheEntry>();

export function loadCheckAnalytics(query: string) {
  const cached = requestCache.get(query);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = fetch(
    `${API_URL}/api/dashboard/onec-check-analytics?${query}`,
    { credentials: "include" },
  )
    .then(async (response) => {
      const payload = (await response.json()) as CheckAnalyticsResponse;

      if (!response.ok) {
        throw new Error(payload.message || `Ошибка HTTP ${response.status}`);
      }
      if (!payload.items) {
        throw new Error("1С вернула пустой ответ по чекам");
      }

      return payload.items;
    })
    .catch((error) => {
      requestCache.delete(query);
      throw error;
    });

  requestCache.set(query, {
    expiresAt: now + CHECK_CACHE_TTL_MS,
    promise,
  });

  return promise;
}
