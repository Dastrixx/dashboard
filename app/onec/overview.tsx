"use client";

import { useMemo } from "react";
import { DataState, money, number, useOnecReports } from "./shared";
import type { Period } from "./types";

export function OnecOverview({ period }: { period: Period }) {
  const { reports, loading, error } = useOnecReports(period);

  const view = useMemo(() => {
    const posted = reports.filter((report) => report.Posted);
    const revenue = posted.reduce(
      (sum, report) => sum + Number(report.СуммаДокумента || 0),
      0,
    );
    const returns = posted.reduce(
      (sum, report) => sum + Number(report.СуммаВозвратов || 0),
      0,
    );
    const lines = posted.flatMap((report) => report.Товары || []);
    const quantity = lines.reduce(
      (sum, line) => sum + Number(line.Количество || 0),
      0,
    );
    const uniqueProducts = new Set(
      lines.map((line) => line.Номенклатура_Key).filter(Boolean),
    ).size;

    const byDate = new Map<string, number>();
    posted.forEach((report) => {
      const key = report.Date.slice(0, 10);
      byDate.set(
        key,
        (byDate.get(key) || 0) + Number(report.СуммаДокумента || 0),
      );
    });

    const daily = [...byDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, value]) => ({ label, value }));

    return {
      revenue,
      returns,
      quantity,
      uniqueProducts,
      daily,
      lastDate: posted[0]?.Date,
    };
  }, [reports]);

  const maxDaily = Math.max(...view.daily.map((item) => item.value), 1);

  if (loading || error || reports.length === 0) {
    return (
      <div className="page-stack">
        <DataState
          loading={loading}
          error={error}
          empty={!loading && !error && reports.length === 0}
        />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="onec-source-panel">
        <div>
          <span className="onec-source-kicker">Реальные данные 1С</span>
          <h2>Обзор продаж</h2>
          <p>
            {view.lastDate
              ? `Последний документ: ${new Date(view.lastDate).toLocaleString("ru-RU")}`
              : "Дата документа отсутствует"}
          </p>
        </div>
        <span className="onec-posted">OData подключена</span>
      </section>

      <section className="kpi-grid">
        <article className="kpi-card">
          <div className="kpi-top">
            <span>Сумма документов</span>
          </div>
          <strong>{money.format(view.revenue)}</strong>
          <p>проведённые отчёты 1С</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-top">
            <span>Возвраты</span>
          </div>
          <strong>{money.format(view.returns)}</strong>
          <p>поле «СуммаВозвратов»</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-top">
            <span>Продано единиц</span>
          </div>
          <strong>{number.format(view.quantity)}</strong>
          <p>по товарным строкам отчётов</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-top">
            <span>Товаров в продажах</span>
          </div>
          <strong>{number.format(view.uniqueProducts)}</strong>
          <p>уникальная номенклатура</p>
        </article>
      </section>

      <section className="charts-grid">
        <article className="panel wide">
          <div className="panel-head">
            <div>
              <h2>Динамика документов</h2>
              <p>Сумма проведённых отчётов по датам</p>
            </div>
          </div>
          {view.daily.length ? (
            <div className="onec-daily-chart">
              {view.daily.map((item) => (
                <div className="onec-daily-column" key={item.label}>
                  <b>{money.format(item.value)}</b>
                  <i
                    style={{
                      height: `${Math.max((item.value / maxDaily) * 100, 4)}%`,
                    }}
                  />
                  <span>
                    {new Date(`${item.label}T00:00:00`).toLocaleDateString(
                      "ru-RU",
                      { day: "2-digit", month: "2-digit" },
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="onec-no-data">Нет данных для графика</p>
          )}
        </article>

        <article className="panel insights">
          <div className="panel-head">
            <div>
              <h2>Доступность показателей</h2>
              <p>Что фактически заполнено в 1С</p>
            </div>
          </div>
          <div className="insight good">
            <b>Продажи и возвраты</b>
            <span>Данные получены из отчётов о розничных продажах</span>
          </div>
          <div className="insight">
            <b>Количество чеков</b>
            <span>Нет данных: в кассовых сменах значение равно нулю</span>
          </div>
          <div className="insight">
            <b>Средний чек</b>
            <span>
              Нет данных: без количества чеков показатель не рассчитывается
            </span>
          </div>
          <div className="insight">
            <b>Продавцы</b>
            <span>Нет данных: в документах указан нулевой GUID продавца</span>
          </div>
        </article>
      </section>
    </div>
  );
}

