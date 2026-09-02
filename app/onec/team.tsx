sed: -e expression #1, char 7: missing command
"use client";

import { useEffect, useMemo, useState } from "react";
import { API_URL, DataState, MissingSource, ZERO_GUID, money, number } from "./shared";
import type { MarginAnalyticsResponse } from "./sales/types";
import type { SellerPayload } from "./types";

type Period = 1 | 7 | 30;
const periods: Array<[Period, string]> = [[1, "День"], [7, "Неделя"], [30, "Месяц"]];

export function OnecTeam() {
  const [period, setPeriod] = useState<Period>(30);
  const [payload, setPayload] = useState<SellerPayload>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [storeKey, setStoreKey] = useState("all");
  const [selectedKey, setSelectedKey] = useState("");
  const [plan, setPlan] = useState(0);
  const [planInput, setPlanInput] = useState("");
  const [planLoading, setPlanLoading] = useState(true);
  const [planSaving, setPlanSaving] = useState(false);
  const [planMessage, setPlanMessage] = useState("");
  const [margin, setMargin] = useState<MarginAnalyticsResponse["items"] | null>(null);
  const [marginError, setMarginError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        setPlanLoading(true);
        setPlanMessage("");
        const response = await fetch(`${API_URL}/api/dashboard/team-plan?storeKey=${encodeURIComponent(storeKey)}&period=${period}`, {
          signal: controller.signal, credentials: "include", cache: "no-store",
        });
        const data = (await response.json()) as { item?: { amount?: number }; message?: string };
        if (!response.ok) throw new Error(data.message || `Ошибка HTTP ${response.status}`);
        const amount = Number(data.item?.amount || 0);
        setPlan(amount);
        setPlanInput(amount ? String(amount) : "");
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setPlanMessage(cause instanceof Error ? cause.message : "Не удалось загрузить план команды");
        }
      } finally {
        if (!controller.signal.aborted) setPlanLoading(false);
      }
    })();
    return () => controller.abort();
  }, [period, storeKey]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        setLoading(true);
        setError("");
        setMarginError("");
        const [sellersResponse, marginResponse] = await Promise.all([
          fetch(`${API_URL}/api/dashboard/onec-consultants?days=${period}`, { signal: controller.signal, credentials: "include", cache: "no-store" }),
          fetch(`${API_URL}/api/dashboard/onec-margin?days=${period}&storeKey=${encodeURIComponent(storeKey)}`, { signal: controller.signal, credentials: "include", cache: "no-store" }),
        ]);
        const [sellersData, marginData] = (await Promise.all([sellersResponse.json(), marginResponse.json()])) as [SellerPayload, MarginAnalyticsResponse];
        if (!sellersResponse.ok) throw new Error(sellersData.message || `Ошибка HTTP ${sellersResponse.status}`);
        setPayload(sellersData);
        if (marginResponse.ok) setMargin(marginData.items || null);
        else {
          setMargin(null);
          setMarginError(marginData.message || `Ошибка HTTP ${marginResponse.status}`);
        }
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(cause instanceof Error ? cause.message : "Не удалось получить продажи продавцов из 1С");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [period, storeKey]);

  const view = useMemo(() => {
    const people = new Map((payload.references?.sellers || []).map((item) => [item.Ref_Key, item]));
    const stores = new Map((payload.references?.stores || []).map((item) => [item.Ref_Key, item]));
    const rows = (payload.items || []).map((item) => {
      const person = people.get(item.Продавец_Key);
      const branchKey = item.Магазин_Key && item.Магазин_Key !== ZERO_GUID ? item.Магазин_Key : person?.Магазин_Key || ZERO_GUID;
      return {
        key: `${item.Продавец_Key}:${branchKey}`,
        name: person?.Description || `Продавец ${item.Продавец_Key.slice(0, 8)}`,
        storeKey: branchKey,
        store: stores.get(branchKey)?.Description || (branchKey === ZERO_GUID ? "Филиал не указан" : "Филиал не найден"),
        revenue: Number(item.СтоимостьTurnover || 0), quantity: Number(item.КоличествоTurnover || 0),
        checks: Number(item.Чеков || 0), checkKeys: item.ИдентификаторыЧеков || [], discounts: Math.max(Number(item.СуммаСкидок || 0), 0),
        returns: Number(item.СтрокВозвратов || 0), daily: item.ПродажиПоДатам || {},
      };
    }).filter((item) => storeKey === "all" || item.storeKey === storeKey).sort((a, b) => b.revenue - a.revenue);
    const revenue = rows.reduce((sum, item) => sum + item.revenue, 0);
    const uniqueChecks = new Set(rows.flatMap((item) => item.checkKeys));
    const checks = uniqueChecks.size || rows.reduce((sum, item) => sum + item.checks, 0);
    return {
      rows: rows.map((item, index) => ({ ...item, rank: index + 1, share: revenue ? item.revenue / revenue * 100 : 0 })),
      stores: [...stores.values()].sort((a, b) => (a.Description || "").localeCompare(b.Description || "", "ru")),
      revenue, checks, averageCheck: checks ? revenue / checks : 0,
      quantity: rows.reduce((sum, item) => sum + item.quantity, 0),
    };
  }, [payload, storeKey]);

  const selected = view.rows.find((item) => item.key === selectedKey) || view.rows[0];
  const planPercent = plan ? view.revenue / plan * 100 : 0;
  const maxRevenue = Math.max(...view.rows.map((item) => item.revenue), 1);
  const chart = useMemo(() => {
    const dates = Object.keys(selected?.daily || {}).sort();
    const values = dates.map((date) => Math.max(Number(selected?.daily[date] || 0), 0));
    const max = Math.max(...values, 1);
    const points = values.map((value, index) => ({
      date: dates[index],
      value,
      x: dates.length === 1 ? 360 : index / (dates.length - 1) * 700 + 10,
      y: 190 - value / max * 160,
    }));
    return {
      points,
      line: points.map((point) => `${point.x},${point.y}`).join(" "),
      area: points.length ? `M ${points[0].x} 190 L ${points.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${points.at(-1)?.x} 190 Z` : "",
    };
  }, [selected]);

  const savePlan = async () => {
    const amount = Number(planInput.replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0) return setPlanMessage("Укажите корректную сумму плана");
    try {
      setPlanSaving(true); setPlanMessage("");
      const response = await fetch(`${API_URL}/api/dashboard/team-plan`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeKey, period, amount }),
      });
      const data = (await response.json()) as { item?: { amount?: number }; message?: string };
      if (!response.ok) throw new Error(data.message || `Ошибка HTTP ${response.status}`);
      const saved = Number(data.item?.amount || amount);
      setPlan(saved); setPlanInput(saved ? String(saved) : ""); setPlanMessage("План команды сохранён");
    } catch (cause) {
      setPlanMessage(cause instanceof Error ? cause.message : "Не удалось сохранить план команды");
    } finally { setPlanSaving(false); }
  };

  if (loading || error) return <DataState loading={loading} error={error} empty={false} />;
  if (!(payload.items || []).length) {
    const diagnostics = payload.meta?.diagnostics;
    return <MissingSource title="Продажи продавцов" description="В чеках 1С не удалось определить консультанта" source={`Проверено чеков: ${diagnostics?.scannedChecks || 0}; строк с консультантом: ${diagnostics?.checkLinesWithConsultant || 0}.`} />;
  }

  return <div className="page-stack onec-team-workspace">
    <section className="team-dashboard-head">
      <div><span className="team-plan-kicker">Команда продаж</span><h2>Продавцы</h2><p>Рейтинг консультантов, динамика продаж и выполнение плана команды</p></div>
      <div className="team-filter-groups">
        <label className="team-store-select"><span>Филиал</span><select value={storeKey} onChange={(event) => setStoreKey(event.target.value)}><option value="all">Все филиалы</option>{view.stores.map((item) => <option key={item.Ref_Key} value={item.Ref_Key}>{item.Description || item.Code || "Филиал без названия"}</option>)}</select></label>
        <div className="team-segment">{periods.map(([value, label]) => <button className={period === value ? "active" : ""} key={value} onClick={() => setPeriod(value)} type="button">{label}</button>)}</div>
      </div>
    </section>

    <section className="team-kpi-grid">
      <Kpi label="Продажи команды" value={money.format(view.revenue)} note={`${number.format(view.quantity)} проданных единиц`} />
      <Kpi label="Чеков команды" value={view.checks ? number.format(view.checks) : "—"} note="чеки с указанным консультантом" />
      <Kpi label="Средний чек команды" value={view.checks ? money.format(view.averageCheck) : "—"} note="продажи / количество чеков" />
      <article className="kpi-card"><div className="kpi-top"><span>Выполнение плана</span></div><strong>{plan ? `${number.format(planPercent)}%` : "Не задан"}</strong><div className="progress"><i style={{ width: `${Math.min(planPercent, 100)}%` }} /></div></article>
      <Kpi label="Маржа" value={margin ? `${margin.current.marginPercent.toFixed(1)}%` : "—"} note={margin ? `валовая прибыль ${money.format(margin.current.profit)}` : marginError || "данные регистра 1С"} />
    </section>

    <section className="team-dashboard-grid">
      <article className="panel team-ranking-panel">
        <div className="panel-head"><div><h2>Рейтинг продавцов</h2><p>Только консультанты, без кассиров</p></div></div>
        <div className="team-ranking-list">{view.rows.map((item) => <button className={`team-rank-button ${selected?.key === item.key ? "active" : ""}`} key={item.key} onClick={() => setSelectedKey(item.key)} type="button"><span className="team-rank-place">{item.rank}</span><span className="team-rank-person"><strong>{item.name}</strong><small>{item.store}</small></span><span className="team-rank-result"><strong>{money.format(item.revenue)}</strong><small>{plan ? `${number.format(item.revenue / plan * 100)}% плана` : `${number.format(item.share)}% команды`}</small></span></button>)}</div>
      </article>

      <article className="panel seller-detail-panel">
        <div className="seller-detail-head"><div><span className="team-plan-kicker">Аналитика продавца</span><h2>{selected?.name}</h2><p>{selected?.store}</p></div><label className="seller-picker"><span>Выбрать продавца</span><select value={selected?.key || ""} onChange={(event) => setSelectedKey(event.target.value)}>{view.rows.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label></div>
        <div className="seller-mini-kpis"><Mini label="Выручка" value={money.format(selected?.revenue || 0)} /><Mini label="Средний чек" value={selected?.checks ? money.format(selected.revenue / selected.checks) : "—"} /><Mini label="Скидки" value={money.format(selected?.discounts || 0)} /><Mini label="Место" value={`#${selected?.rank || "—"}`} /></div>
        <div className="seller-chart-head"><div><h3>Динамика продаж</h3><p>Продажи выбранного продавца за выбранный период</p></div><span className="legend-dot">Фактические продажи</span></div>
        {selected && Object.keys(selected.daily).length ? <div className="seller-sales-chart"><svg aria-label="Динамика продаж продавца" role="img" viewBox="0 0 720 220">{[30, 70, 110, 150, 190].map((y) => <line className="gridline" key={y} x1="10" x2="710" y1={y} y2={y} />)}<defs><linearGradient id="sellerArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#0b7a55" stopOpacity=".24" /><stop offset="100%" stopColor="#0b7a55" stopOpacity="0" /></linearGradient></defs><path d={chart.area} fill="url(#sellerArea)" /><polyline fill="none" points={chart.line} stroke="#0b7a55" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />{chart.points.map((point) => <g key={point.date}><circle cx={point.x} cy={point.y} fill="#fff" r="4" stroke="#0b7a55" strokeWidth="2"><title>{`${formatChartDate(point.date)} — ${money.format(point.value)}`}</title></circle><text className="seller-chart-label" textAnchor="middle" x={point.x} y="211">{formatChartDate(point.date)}</text></g>)}</svg></div> : <div className="seller-chart-empty">График появится, когда в данных 1С заполнен продавец товарной строки.</div>}
      </article>
    </section>

    <section className="panel team-plan-panel">
      <div className="team-plan-panel-head"><div><span className="team-plan-kicker">План продаж команды</span><h2>{storeKey === "all" ? "Общий план команды" : view.stores.find((item) => item.Ref_Key === storeKey)?.Description || "План филиала"}</h2><p>Факт складывается только из личных продаж консультантов.</p></div><div className="team-plan-editor compact"><label><span>Сумма плана, KGS</span><input min="0" onChange={(event) => setPlanInput(event.target.value)} placeholder="1 500 000" step="1000" type="number" value={planInput} /></label><button disabled={planSaving || planLoading} onClick={savePlan} type="button">{planSaving ? "Сохраняем…" : "Сохранить"}</button></div></div>
      {planMessage && <p className="team-plan-message">{planMessage}</p>}
      <div className="team-plan-summary-grid"><Mini label="План" value={plan ? money.format(plan) : "Не задан"} /><Mini label="Факт" value={money.format(view.revenue)} /><Mini label="Выполнение" value={plan ? `${number.format(planPercent)}%` : "—"} /><Mini label="Осталось" value={plan ? money.format(Math.max(plan - view.revenue, 0)) : "—"} /></div>
      <div className="team-plan-progress large"><i style={{ width: `${Math.min(planPercent, 100)}%` }} /></div>
      <div className="team-contribution-head"><h3>Вклад продавцов в план команды</h3><span>{view.rows.length} продавцов</span></div>
      <div className="team-contribution-list">{view.rows.map((item) => <div className="team-contribution-row" key={item.key}><div><strong>{item.name}</strong><small>{item.store}</small></div><i><b style={{ width: `${Math.max(item.revenue / maxRevenue * 100, item.revenue ? 2 : 0)}%` }} /></i><div><strong>{money.format(item.revenue)}</strong><small>{plan ? `${number.format(item.revenue / plan * 100)}% плана` : `${number.format(item.share)}% команды`}</small></div></div>)}</div>
      <small className="team-data-source">Источник: {payload.meta?.source || "Document_ЧекККМ.Товары.Продавец_Key"}</small>
    </section>
  </div>;
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="kpi-card"><div className="kpi-top"><span>{label}</span></div><strong>{value}</strong><p>{note}</p></article>;
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function formatChartDate(value: string) {
  const [, month = "", day = ""] = value.split("-");
  return `${day}.${month}`;
}
