"use client";

import { useEffect, useMemo, useState } from "react";

type OnecProductLine = {
  LineNumber: string;
  Номенклатура_Key: string;
  Количество: number;
  Цена: number;
  Сумма: number;
  Склад_Key: string;
  Продавец_Key: string;
};

type OnecRetailReport = {
  Ref_Key: string;
  Number: string;
  Date: string;
  Posted: boolean;
  СуммаДокумента: number;
  СуммаВозвратов: number;
  Магазин_Key: string;
  КассаККМ_Key: string;
  Товары: OnecProductLine[];
};

type OnecProductReference = {
  Ref_Key: string;
  Code: string;
  Description: string;
  НаименованиеПолное: string;
  Артикул: string;
};

type OnecWarehouseReference = {
  Ref_Key: string;
  Code: string;
  Description: string;
  ТипСклада: string;
  Магазин_Key: string;
};

type OnecResponse = {
  items: OnecRetailReport[];
  references: {
    products: OnecProductReference[];
    warehouses: OnecWarehouseReference[];
  };
  message?: string;
};

const API_URL = "http://localhost:4000";
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "KGS",
  maximumFractionDigits: 2,
});

const date = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function OnecSales() {
  const [reports, setReports] = useState<OnecRetailReport[]>([]);
  const [products, setProducts] = useState<OnecProductReference[]>([]);
  const [warehouses, setWarehouses] = useState<OnecWarehouseReference[]>([]);
  const [selectedReportKey, setSelectedReportKey] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadReports() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          `${API_URL}/api/dashboard/onec-reports?top=1`,
          { signal: controller.signal },
        );

        const data = (await response.json()) as Partial<OnecResponse>;

        if (!response.ok) {
          throw new Error(data.message || `Ошибка HTTP ${response.status}`);
        }

        const loadedReports = Array.isArray(data.items) ? data.items : [];
        setReports(loadedReports);
        setProducts(
          Array.isArray(data.references?.products)
            ? data.references.products
            : [],
        );
        setWarehouses(
          Array.isArray(data.references?.warehouses)
            ? data.references.warehouses
            : [],
        );
        setSelectedReportKey(loadedReports[0]?.Ref_Key ?? "");
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
            : "Не удалось загрузить данные 1С",
        );
      } finally {
        setLoading(false);
      }
    }

    loadReports();

    return () => controller.abort();
  }, []);

  const productByKey = useMemo(
    () => new Map(products.map((item) => [item.Ref_Key, item])),
    [products],
  );

  const warehouseByKey = useMemo(
    () => new Map(warehouses.map((item) => [item.Ref_Key, item])),
    [warehouses],
  );

  const report =
    reports.find((item) => item.Ref_Key === selectedReportKey) ?? reports[0];

  const lines = useMemo(() => {
    if (!report) return [];

    const normalizedQuery = query.trim().toLowerCase();

    return (report.Товары ?? []).filter((item) => {
      if (!normalizedQuery) return true;

      const product = productByKey.get(item.Номенклатура_Key);
      const warehouse = warehouseByKey.get(item.Склад_Key);

      return [
        product?.Description,
        product?.НаименованиеПолное,
        product?.Артикул,
        product?.Code,
        warehouse?.Description,
        item.Номенклатура_Key,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value).toLowerCase().includes(normalizedQuery),
        );
    });
  }, [productByKey, query, report, warehouseByKey]);

  if (loading) {
    return (
      <div className="page-stack">
        <section className="onec-state panel">
          <span className="onec-spinner" />
          <div>
            <strong>Получаем данные из 1С</strong>
            <p>Загружаем последние отчёты и справочники…</p>
          </div>
        </section>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-stack">
        <section className="onec-state onec-error panel">
          <div>
            <strong>Не удалось получить данные 1С</strong>
            <p>{error}</p>
          </div>
        </section>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="page-stack">
        <section className="onec-state panel">
          <div>
            <strong>Отчётов пока нет</strong>
            <p>В 1С не найдено отчётов о розничных продажах.</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack onec-workspace">
      <section className="onec-source-panel">
        <div>
          <span className="onec-source-kicker">Данные из 1С</span>
          <h2>Отчёт о розничных продажах</h2>
          <p>
            Документ №{report.Number} · {date.format(new Date(report.Date))}
          </p>
        </div>

        <div className="onec-source-actions">
          <span className={report.Posted ? "onec-posted" : "onec-draft"}>
            {report.Posted ? "Проведён" : "Не проведён"}
          </span>

          {reports.length > 1 && (
            <label className="onec-report-select">
              <span>Документ</span>
              <select
                value={report.Ref_Key}
                onChange={(event) =>
                  setSelectedReportKey(event.target.value)
                }
              >
                {reports.map((item) => (
                  <option value={item.Ref_Key} key={item.Ref_Key}>
                    №{item.Number} · {date.format(new Date(item.Date))}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      <section className="kpi-grid product-kpis">
        <article className="kpi-card">
          <div className="kpi-top">
            <span>Сумма документа</span>
          </div>
          <strong>{money.format(report.СуммаДокумента)}</strong>
          <p>поле 1С «СуммаДокумента»</p>
        </article>

        <article className="kpi-card">
          <div className="kpi-top">
            <span>Возвраты</span>
          </div>
          <strong>{money.format(report.СуммаВозвратов)}</strong>
          <p>поле 1С «СуммаВозвратов»</p>
        </article>

        <article className="kpi-card">
          <div className="kpi-top">
            <span>Строк товаров</span>
          </div>
          <strong>{report.Товары?.length ?? 0}</strong>
          <p>табличная часть документа</p>
        </article>

        <article className="kpi-card">
          <div className="kpi-top">
            <span>Источник</span>
          </div>
          <strong className="onec-source-value">1С OData</strong>
          <p>реальные данные без расчётов</p>
        </article>
      </section>

      <section className="panel onec-products-panel">
        <div className="inventory-head">
          <div>
            <h2>Товары документа</h2>
            <p>
              Номенклатура, количество, цена и склад непосредственно из 1С
            </p>
          </div>
          <span>{lines.length} позиций</span>
        </div>

        <div className="inventory-controls">
          <label className="search onec-search">
            <span aria-hidden>⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по товару, артикулу или складу"
            />
          </label>
        </div>

        <div className="onec-table-wrap">
          <table className="onec-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Товар</th>
                <th>Артикул</th>
                <th>Количество</th>
                <th>Цена</th>
                <th>Сумма</th>
                <th>Склад</th>
                <th>Продавец</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((item) => {
                const product = productByKey.get(item.Номенклатура_Key);
                const warehouse = warehouseByKey.get(item.Склад_Key);

                return (
                  <tr key={`${report.Ref_Key}-${item.LineNumber}`}>
                    <td>{item.LineNumber}</td>
                    <td>
                      <strong>
                        {product?.Description ||
                          product?.НаименованиеПолное ||
                          "Название не найдено в справочнике"}
                      </strong>
                      <small className="onec-key">
                        {item.Номенклатура_Key}
                      </small>
                    </td>
                    <td>{product?.Артикул || product?.Code || "—"}</td>
                    <td>{item.Количество}</td>
                    <td>{money.format(item.Цена)}</td>
                    <td>
                      <strong>{money.format(item.Сумма)}</strong>
                    </td>
                    <td>
                      {warehouse?.Description || item.Склад_Key}
                    </td>
                    <td>
                      {item.Продавец_Key &&
                      item.Продавец_Key !== ZERO_GUID
                        ? item.Продавец_Key
                        : "Не указан"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
