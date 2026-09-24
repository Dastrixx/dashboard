"use client";

import { useEffect, useState } from "react";
import { rollingDateRange, dateRangeQuery } from "./sales/config";
import { SalesDateFilter } from "./sales/date-filter";
import type { SalesDateRange } from "./sales/types";
import { API_URL, DataState } from "./shared";
import type { StockPayload } from "./types";

export function OnecProcurement() {
  const [dateFrom, setDateFrom] = useState(() => rollingDateRange(30).from);
  const [dateTo, setDateTo] = useState(() => rollingDateRange(30).to);
  const [dateRange, setDateRange] = useState<SalesDateRange | null>(null);
  const [data, setData] = useState<StockPayload>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const url = `${API_URL}/api/dashboard/onec-stock?operationsOnly=true${dateRange ? `&${dateRangeQuery(dateRange)}` : ""}`;
        const response = await fetch(url, { signal: controller.signal, credentials: "include" });
        const payload = (await response.json()) as StockPayload;
        if (!response.ok) throw new Error(payload.message || `Ошибка HTTP ${response.status}`);
        setData(payload);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Ошибка загрузки документов");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [dateRange]);

  const stores = new Map((data.references?.warehouses || []).map((store) => [store.Ref_Key, store.Description]));
  const suppliers = new Map((data.references?.suppliers || []).map((supplier) => [supplier.Ref_Key, supplier.НаименованиеПолное || supplier.Description]));
  const transfers = data.operations?.transfers || [];
  const receipts = data.operations?.receipts || [];

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-head"><div><h2>Закуп и перемещения</h2><p>Поступления от поставщиков и внутренние перемещения из 1С</p></div></div>
        <SalesDateFilter from={dateFrom} to={dateTo} appliedRange={dateRange}
          canApply={Boolean(dateFrom && dateTo && dateFrom <= dateTo)}
          onFromChange={setDateFrom} onToChange={setDateTo}
          onApply={() => setDateRange({ from: dateFrom, to: dateTo })} />
      </section>
      {loading || error ? <DataState loading={loading} error={error} empty={false} /> : (
        <>
          <section className="panel">
            <div className="panel-head"><div><h2>Поступления от поставщиков</h2><p>Документы «Поступление товаров»</p></div></div>
            {data.meta?.operationErrors?.receipts && <p role="status">Источник недоступен: {data.meta.operationErrors.receipts}</p>}
            <OperationTable rows={receipts.map((item) => ({
              key: item.Ref_Key, date: item.Date, number: item.Number,
              origin: suppliers.get(item.Контрагент_Key || "") || "Поставщик не указан",
              destination: stores.get(item.Склад_Key || "") || "Склад не указан",
              sku: new Set((item.Товары || []).map((line) => line.Номенклатура_Key)).size,
            }))} empty="Поступлений за выбранный период нет" />
          </section>
          <section className="panel">
            <div className="panel-head"><div><h2>Внутренние перемещения</h2><p>Отдельный источник «Перемещение товаров»; перемещение не является закупкой</p></div></div>
            {data.meta?.operationErrors?.transfers && <p role="status">Источник недоступен: {data.meta.operationErrors.transfers}</p>}
            <OperationTable rows={transfers.map((item) => ({
              key: item.Ref_Key, date: item.Date, number: item.Number,
              origin: stores.get(item.СкладОтправитель_Key || "") || "Склад не указан",
              destination: stores.get(item.СкладПолучатель_Key || "") || "Склад не указан",
              sku: new Set((item.Товары || []).map((line) => line.Номенклатура_Key)).size,
            }))} empty="Перемещений за выбранный период нет" />
          </section>
        </>
      )}
    </div>
  );
}

type OperationRow = { key: string; date: string; number?: string; origin: string; destination: string; sku: number };

function OperationTable({ rows, empty }: { rows: OperationRow[]; empty: string }) {
  if (!rows.length) return <p className="onec-no-data">{empty}</p>;
  return (
    <div className="stock-compact-table-wrap"><table className="stock-compact-table">
      <thead><tr><th>Дата</th><th>Документ</th><th>Откуда</th><th>Куда</th><th>SKU</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key}>
        <td>{new Date(row.date).toLocaleDateString("ru-RU")}</td>
        <td>{row.number || "—"}</td><td>{row.origin}</td><td>{row.destination}</td><td>{row.sku}</td>
      </tr>)}</tbody>
    </table></div>
  );
}
