"use client";

import { useEffect, useState } from "react";
import type { OnecPayload, OnecReport, Period } from "./types";

export const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "";
export const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

export const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "KGS",
  maximumFractionDigits: 0,
});

export const number = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
});

export function useOnecReports(period: Period | 10 = 10) {
  const [reports, setReports] = useState<OnecReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          `${API_URL}/api/dashboard/onec-reports?top=500&days=${period}&references=false`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as OnecPayload;

        if (!response.ok) {
          throw new Error(data.message || `Ошибка HTTP ${response.status}`);
        }

        setReports(Array.isArray(data.items) ? data.items : []);
      } catch (loadError) {
        if (
          loadError instanceof DOMException &&
          loadError.name === "AbortError"
        ) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось получить данные 1С",
        );
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [period]);

  return { reports, loading, error };
}
export function DataState({
  loading,
  error,
  empty,
}: {
  loading: boolean;
  error: string;
  empty: boolean;
}) {
  if (loading) {
    return (
      <section className="panel onec-state">
        <span className="onec-spinner" />
        <div>
          <strong>Получаем данные из 1С</strong>
          <p>Загрузка отчётов о розничных продажах…</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel onec-state onec-error">
        <div>
          <strong>Не удалось получить данные 1С</strong>
          <p>{error}</p>
        </div>
      </section>
    );
  }

  if (empty) {
    return (
      <section className="panel onec-state">
        <div>
          <strong>Нет данных</strong>
          <p>1С не вернула документы для выбранного периода.</p>
        </div>
      </section>
    );
  }

  return null;
}
export function MissingSource({
  title,
  description,
  source,
}: {
  title: string;
  description: string;
  source: string;
}) {
  return (
    <div className="page-stack">
      <section className="onec-source-panel">
        <div>
          <span className="onec-source-kicker">Данные из 1С</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="onec-draft">Нет данных</span>
      </section>
      <section className="panel onec-missing-source">
        <strong>Демо-значения отключены</strong>
        <p>{source}</p>
      </section>
    </div>
  );
}

