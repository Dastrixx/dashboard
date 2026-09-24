"use client";

import { useEffect, useState } from "react";
import { API_URL } from "./shared";

type SyncStatus = {
  enabled: boolean;
  running?: boolean;
  queued?: number;
  periods?: Array<{
    kind: string;
    query: { from?: string; to?: string; days?: string; references?: string };
    syncedAt: string | null;
    error: string | null;
  }>;
};

export function AnalyticsSyncStatus() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`${API_URL}/api/dashboard/sync-status`, {
          credentials: "include", signal: controller.signal,
        });
        if (response.ok) setStatus(await response.json());
      } catch { /* The page request displays connection errors. */ }
      finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 10_000);
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  if (!status?.enabled) return null;
  const periods = status.periods || [];
  const pending = periods.filter((period) => !period.syncedAt).length;
  const failed = periods.filter((period) => period.error).length;
  return (
    <section className="panel" style={{ padding: "14px 20px", marginBottom: 20 }} aria-label="Обновление аналитики">
      <strong>Продажи и маржа · локальные данные</strong>
      <p role="status">
        {pending > 0 ? `Первая загрузка: ожидают ${pending} отчётов. ` : "Сохранённые отчёты доступны. "}
        {status.running ? "Обновляем данные из 1С в фоне. " : ""}
        {failed > 0 ? `Не удалось обновить ${failed} отчётов; ранее загруженные данные сохранены.` : ""}
      </p>
      <details>
        <summary>Периоды и время обновления</summary>
        <ul>
          {periods.map((period, index) => (
            <li key={index}>
              {period.kind === "margin" ? "Маржа" : period.query.references === "only" ? "Справочники продаж" : "Продажи"}
              {" · "}{period.query.from ? `${period.query.from} — ${period.query.to}` : `${period.query.days} дн.`}
              {" · "}{period.syncedAt ? `Обновлено ${new Date(period.syncedAt).toLocaleString("ru-RU")}` : "Ещё не загружено"}
              {period.error ? " · Ошибка обновления из 1С" : ""}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => window.location.reload()}>Показать последние данные</button>
      </details>
    </section>
  );
}
