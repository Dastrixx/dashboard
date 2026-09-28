"use client";

import { useEffect, useMemo, useState } from "react";
import { API_URL, DataState, number } from "./shared";
import { fetchSyncedJson } from "./sales/sync-fetch";
import { monthToDateRange } from "./sales/config";
import type { OnecRetailReport, OnecSalesResponse } from "./sales/types";
import type { StockPayload } from "./types";

const initialRange = monthToDateRange();

export function OnecProcurement() {
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [range, setRange] = useState(initialRange);
  const [warehouse, setWarehouse] = useState("all");
  const [stock, setStock] = useState<StockPayload | null>(null);
  const [reports, setReports] = useState<OnecRetailReport[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let currentStock: StockPayload | null = null;
    let currentReports: OnecRetailReport[] | null = null;
    const publish = () => {
      if (controller.signal.aborted || !currentStock || !currentReports) return;
      setStock(currentStock);
      setReports(currentReports);
      setLoading(false);
    };
    async function load() {
      setLoading(true);
      setError("");
      setStock(null);
      setReports(null);
      try {
        const query = new URLSearchParams({ from: range.from, to: range.to });
        const [stockData, reportData] = await Promise.all([
          fetchSyncedJson<StockPayload>(
            `${API_URL}/api/dashboard/onec-stock?period=${range.to}T12:00:00`,
            controller.signal, undefined, partial => { currentStock = partial; publish(); },
          ),
          fetchSyncedJson<OnecSalesResponse>(
            `${API_URL}/api/dashboard/onec-reports?${query}&references=false`,
            controller.signal, undefined, partial => { currentReports = partial.items || []; publish(); },
          ),
        ]);
        currentStock = stockData;
        currentReports = reportData.items || [];
        publish();
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (!currentStock || !currentReports) {
          setError(cause instanceof Error ? cause.message : "Не удалось получить данные для закупа");
        }
        setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [range]);

  const rows = useMemo(() => {
    if (!stock || !reports) return [];
    const products = new Map((stock.references?.products || []).map(item => [item.Ref_Key, item]));
    const warehouses = new Map((stock.references?.warehouses || []).map(item => [item.Ref_Key, item]));
    const balances = new Map<string, Map<string, number>>();
    for (const balance of stock.items || []) {
      const byWarehouse = balances.get(balance.Номенклатура_Key) || new Map<string, number>();
      byWarehouse.set(balance.Склад_Key, (byWarehouse.get(balance.Склад_Key) || 0) +
        Number(balance.КоличествоBalance || 0) - Number(balance.РезервBalance || 0));
      balances.set(balance.Номенклатура_Key, byWarehouse);
    }
    const sales = new Map<string, number>();
    for (const report of reports.filter(item => item.Posted)) {
      for (const [lines, sign] of [[report.Товары || [], 1], [report.ВозвращенныеТовары || [], -1]] as const) {
        for (const line of lines) {
          const key = `${line.Номенклатура_Key}:${line.Склад_Key}`;
          sales.set(key, (sales.get(key) || 0) + sign * Number(line.Количество || 0));
        }
      }
    }
    for (const key of sales.keys()) {
      const [productKey, warehouseKey] = key.split(":");
      const byWarehouse = balances.get(productKey) || new Map<string, number>();
      if (!byWarehouse.has(warehouseKey)) byWarehouse.set(warehouseKey, 0);
      balances.set(productKey, byWarehouse);
    }
    const result: Array<{ key: string; name: string; sku: string; location: string;
      sold: number; available: number; percent: number; suggest: number; action: string }> = [];
    for (const [productKey, byWarehouse] of balances) {
      for (const [warehouseKey, availableRaw] of byWarehouse) {
        if (warehouse !== "all" && warehouseKey !== warehouse) continue;
        const available = Math.max(availableRaw, 0);
        const sold = Math.max(sales.get(`${productKey}:${warehouseKey}`) || 0, 0);
        const percent = available + sold > 0 ? available / (available + sold) * 100 : 100;
        const suggest = sold > available ? Math.ceil(sold - available) : 0;
        const elsewhere = [...byWarehouse.entries()].some(([key, count]) => key !== warehouseKey && count > suggest);
        const product = products.get(productKey);
        result.push({ key: `${productKey}:${warehouseKey}`,
          name: product?.НаименованиеПолное || product?.Description || `Товар ${productKey.slice(0, 8)}`,
          sku: product?.Артикул || product?.Code || "—",
          location: warehouses.get(warehouseKey)?.Description || `Склад ${warehouseKey.slice(0, 8)}`,
          sold, available, percent, suggest,
          action: suggest ? (elsewhere ? "Переместить" : "Закупить") : "Запас достаточный",
        });
      }
    }
    return result.sort((a, b) => a.percent - b.percent || b.sold - a.sold);
  }, [reports, stock, warehouse]);

  if (loading && !stock) return <DataState loading error="" empty={false} progress="Загружаем продажи и остатки…" />;
  if (error && !stock) return <DataState loading={false} error={error} empty={false} />;

  return (
    <div className="page-stack">
      <section className="panel procurement-filter-panel">
        <div>
          <span className="filter-kicker">Закуп / Перемещение</span>
          <h2>Потребность по фактическим остаткам</h2>
          <p>Продано за период, доступно сейчас и доля оставшегося запаса.</p>
        </div>
        <div className="inventory-head-actions">
          <input aria-label="Начало периода" type="date" value={from} onChange={event => setFrom(event.target.value)} />
          <input aria-label="Конец периода" type="date" value={to} onChange={event => setTo(event.target.value)} />
          <button type="button" disabled={!from || !to || from > to} onClick={() => setRange({ from, to })}>Показать</button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div><h2>Товары по складам</h2><p>{range.from} — {range.to}</p></div>
          <select aria-label="Склад" value={warehouse} onChange={event => setWarehouse(event.target.value)}>
            <option value="all">Все склады</option>
            {(stock?.references?.warehouses || []).map(item =>
              <option key={item.Ref_Key} value={item.Ref_Key}>{item.Description || item.Ref_Key}</option>)}
          </select>
        </div>
        <div className="order-table-wrap">
          <table className="order-table"><thead><tr>
            <th>Артикул</th><th>Товар</th><th>Склад</th><th>Продано</th><th>Осталось</th><th>% остатка</th><th>Рекомендация</th>
          </tr></thead><tbody>
            {rows.map(item => <tr key={item.key}>
              <td>{item.sku}</td><td>{item.name}</td><td>{item.location}</td>
              <td>{number.format(item.sold)}</td><td>{number.format(item.available)}</td>
              <td><span className={`stock-percent ${item.percent < 50 ? "warning" : ""}`}>{item.percent.toFixed(0)}%</span></td>
              <td>{item.suggest ? `${item.action} ${number.format(item.suggest)} шт.` : item.action}</td>
            </tr>)}
          </tbody></table>
        </div>
        {!rows.length && <p>Пока нет загруженных остатков для выбранного склада.</p>}
      </section>
    </div>
  );
}
