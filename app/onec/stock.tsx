"use client";

import { useEffect, useMemo, useState } from "react";
import { API_URL, DataState, number } from "./shared";
import type { StockOperation, StockPayload } from "./types";

function uniqueSubcategories(
  rows: Array<{ subcategoryKey: string; subcategory: string }>,
) {
  const values = new Map<string, string>();

  rows.forEach((row) => {
    if (row.subcategoryKey) {
      values.set(row.subcategoryKey, row.subcategory);
    }
  });

  return [...values.entries()]
    .map(([key, name]) => ({ key, name }))
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

export function OnecStock() {
  const [payload, setPayload] = useState<StockPayload>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warehouseMode, setWarehouseMode] = useState("all");
  const [warehouseKey, setWarehouseKey] = useState("all");
  const [category, setCategory] = useState("all");
  const [subcategory, setSubcategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [writeOffPage, setWriteOffPage] = useState(1);
  const [recountPage, setRecountPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-stock?top=5000`,
          { signal: controller.signal, credentials: "include" },
        );
        const data = (await response.json()) as StockPayload;
        if (!response.ok) {
          throw new Error(data.message || `Ошибка HTTP ${response.status}`);
        }
        setPayload(data);
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
            : "Не удалось получить остатки из 1С",
        );
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, []);

  const view = useMemo(() => {
    const balances = payload.items || [];
    const products = new Map(
      (payload.references?.products || []).map((item) => [item.Ref_Key, item]),
    );
    const warehouses = new Map(
      (payload.references?.warehouses || []).map((item) => [
        item.Ref_Key,
        item,
      ]),
    );
    const categories = new Map(
      (payload.references?.categories || []).map((item) => [
        item.Ref_Key,
        item,
      ]),
    );
    const suppliers = new Map(
      (payload.references?.suppliers || []).map((item) => [item.Ref_Key, item]),
    );

    const matchesWarehouseType = (key: string) => {
      if (warehouseMode === "all") return true;
      const kind = warehouses.get(key)?.ТипСклада || "";
      if (warehouseMode === "sales-floor") return kind === "ТорговыйЗал";
      return kind === "СкладскоеПомещение";
    };
    const matchesWarehouse = (key: string) => {
      if (warehouseKey !== "all" && key !== warehouseKey) return false;
      return matchesWarehouseType(key);
    };

    const grouped = new Map<
      string,
      {
        key: string;
        sku: string;
        name: string;
        categoryKey: string;
        category: string;
        subcategoryKey: string;
        subcategory: string;
        quantity: number;
        reserved: number;
        cost: number;
        locations: Set<string>;
      }
    >();

    balances
      .filter((item) => matchesWarehouse(item.Склад_Key))
      .forEach((item) => {
        const product = products.get(item.Номенклатура_Key);
        const categoryKey = product?.BusinessCategory_Key || "";
        const subcategoryKey = product?.Subcategory_Key || "";
        const current = grouped.get(item.Номенклатура_Key) || {
          key: item.Номенклатура_Key,
          sku: product?.Артикул || product?.Code || "Без артикула",
          name:
            product?.НаименованиеПолное ||
            product?.Description ||
            `Товар ${item.Номенклатура_Key.slice(0, 8)}`,
          categoryKey,
          category:
            product?.BusinessCategory ||
            categories.get(categoryKey)?.Description ||
            "Не классифицировано",
          subcategoryKey,
          subcategory: product?.Subcategory || "Без подкатегории",
          quantity: 0,
          reserved: 0,
          cost: 0,
          locations: new Set<string>(),
        };
        current.quantity += Number(item.КоличествоBalance || 0);
        current.reserved += Number(item.РезервBalance || 0);
        current.cost += Number(item.ор_СебестоимостьBalance || 0);
        current.locations.add(
          warehouses.get(item.Склад_Key)?.Description || "Склад не определён",
        );
        grouped.set(item.Номенклатура_Key, current);
      });

    const rows = [...grouped.values()].map((item) => {
      const available = Math.max(item.quantity - item.reserved, 0);
      const itemStatus =
        item.quantity <= 0 ? "zero" : available <= 5 ? "low" : "available";
      const recommendation =
        item.quantity <= 0
          ? "Проверить закуп"
          : available <= 5
            ? "Дозаказать"
            : item.reserved / item.quantity >= 0.5
              ? "Высокий резерв"
              : "Запас достаточный";
      return {
        ...item,
        locations: [...item.locations].join(", "),
        available,
        status: itemStatus,
        recommendation,
      };
    });
    const query = search.trim().toLowerCase();
    const filtered = rows
      .filter((item) => category === "all" || item.categoryKey === category)
      .filter(
        (item) =>
          subcategory === "all" || item.subcategoryKey === subcategory,
      )
      .filter((item) => status === "all" || item.status === status)
      .filter(
        (item) =>
          !query ||
          `${item.sku} ${item.name} ${item.subcategory} ${item.locations}`
            .toLowerCase()
            .includes(query),
      )
      .sort((left, right) => left.available - right.available);

    const operationMatches = (document: StockOperation) =>
      !document.Склад_Key || matchesWarehouse(document.Склад_Key);
    const receipts = (payload.operations?.receipts || []).filter(
      operationMatches,
    );
    const writeOffs = (payload.operations?.writeOffs || []).filter(
      operationMatches,
    );
    const recounts = (payload.operations?.recounts || []).filter(
      operationMatches,
    );
    const latestReceiptTime = Math.max(
      ...receipts.map((item) => new Date(item.Date).getTime()),
      0,
    );
    const receiptWeeks = Array.from({ length: 8 }, (_, index) => ({
      label: index === 7 ? "текущая" : `нед. −${7 - index}`,
      sku: new Set<string>(),
      units: 0,
    }));
    if (latestReceiptTime) {
      receipts.forEach((document) => {
        const distance = Math.floor(
          (latestReceiptTime - new Date(document.Date).getTime()) /
            (7 * 86_400_000),
        );
        const bucket = 7 - distance;
        if (bucket < 0 || bucket > 7) return;
        (document.Товары || []).forEach((line) => {
          if (line.Номенклатура_Key)
            receiptWeeks[bucket].sku.add(line.Номенклатура_Key);
          receiptWeeks[bucket].units += Number(line.Количество || 0);
        });
      });
    }
    const receiptChart = receiptWeeks.map((item) => ({
      label: item.label,
      sku: item.sku.size,
      units: item.units,
    }));
    const maxReceiptSku = Math.max(...receiptChart.map((item) => item.sku), 1);

    const writeOffRows = writeOffs.flatMap((document) =>
      (document.Товары || []).map((line) => {
        const product = products.get(line.Номенклатура_Key);
        return {
          key: `${document.Ref_Key}-${line.LineNumber}`,
          sku: product?.Артикул || product?.Code || "Без артикула",
          name:
            product?.НаименованиеПолное ||
            product?.Description ||
            "Товар не найден",
          quantity: Number(line.Количество || 0),
          reason:
            document.ОснованиеСписания ||
            document.Комментарий ||
            "Причина не заполнена",
        };
      }),
    );
    const recountRows = recounts.flatMap((document) =>
      (document.Товары || []).map((line) => {
        const product = products.get(line.Номенклатура_Key);
        const accounting = Number(line.Количество || 0);
        const actual = Number(line.КоличествоФакт || 0);
        return {
          key: `${document.Ref_Key}-${line.LineNumber}`,
          sku: product?.Артикул || product?.Code || "Без артикула",
          name:
            product?.НаименованиеПолное ||
            product?.Description ||
            "Товар не найден",
          accounting,
          actual,
          difference: actual - accounting,
        };
      }),
    );

    return {
      rows,
      filtered,
      categories: [...categories.values()].sort((left, right) =>
        (left.Description || "").localeCompare(right.Description || "", "ru"),
      ),
      subcategories: uniqueSubcategories(
        rows.filter(
          (item) =>
            category === "all" || item.categoryKey === category,
        ),
      ),
      totalQuantity: rows.reduce((sum, item) => sum + item.quantity, 0),
      totalReserved: rows.reduce((sum, item) => sum + item.reserved, 0),
      zero: rows.filter((item) => item.status === "zero").length,
      low: rows.filter((item) => item.status === "low").length,
      availableWarehouses: [...warehouses.values()]
        .filter((item) => matchesWarehouseType(item.Ref_Key))
        .sort((left, right) =>
          (left.Description || "").localeCompare(right.Description || "", "ru"),
        ),
      receiptChart,
      maxReceiptSku,
      recentReceipts: receipts.slice(0, 5).map((document) => ({
        ...document,
        supplier:
          suppliers.get(document.Контрагент_Key || "")?.НаименованиеПолное ||
          suppliers.get(document.Контрагент_Key || "")?.Description ||
          "Поставщик не указан",
        warehouse:
          warehouses.get(document.Склад_Key || "")?.Description ||
          "Склад не указан",
        sku: new Set(
          (document.Товары || [])
            .map((line) => line.Номенклатура_Key)
            .filter(Boolean),
        ).size,
      })),
      writeOffRows,
      recountRows,
    };
  }, [
    payload,
    warehouseMode,
    warehouseKey,
    category,
    subcategory,
    status,
    search,
  ]);

  if (loading || error || !(payload.items || []).length) {
    return (
      <div className="page-stack">
        <DataState
          loading={loading}
          error={error}
          empty={!loading && !error && !(payload.items || []).length}
        />
      </div>
    );
  }

  const pageSize = 20;
  const pages = Math.max(Math.ceil(view.filtered.length / pageSize), 1);
  const currentPage = Math.min(page, pages);
  const visibleRows = view.filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const qualityPageSize = 10;
  const writeOffPages = Math.max(
    Math.ceil(view.writeOffRows.length / qualityPageSize),
    1,
  );
  const currentWriteOffPage = Math.min(writeOffPage, writeOffPages);
  const visibleWriteOffRows = view.writeOffRows.slice(
    (currentWriteOffPage - 1) * qualityPageSize,
    currentWriteOffPage * qualityPageSize,
  );
  const recountPages = Math.max(
    Math.ceil(view.recountRows.length / qualityPageSize),
    1,
  );
  const currentRecountPage = Math.min(recountPage, recountPages);
  const visibleRecountRows = view.recountRows.slice(
    (currentRecountPage - 1) * qualityPageSize,
    currentRecountPage * qualityPageSize,
  );

  return (
    <div className="page-stack onec-stock-workspace">
      <section className="onec-source-panel">
        <div>
          <span className="onec-source-kicker">Фактические данные 1С</span>
          <h2>Остатки по складам</h2>
          <p>
            Виртуальная таблица «Товары на складах / Balance» · обновлено{" "}
            {payload.meta?.asOf
              ? new Date(payload.meta.asOf).toLocaleString("ru-RU")
              : "только что"}
          </p>
        </div>
        <div className="stock-warehouse-controls">
          <label className="stock-warehouse-select">
            <span>Выберите склад</span>
            <select
              onChange={(event) => {
                setWarehouseKey(event.target.value);
                setPage(1);
                setWriteOffPage(1);
                setRecountPage(1);
              }}
              value={warehouseKey}
            >
              <option value="all">
                {warehouseMode === "sales-floor"
                  ? "Все торговые залы"
                  : warehouseMode === "warehouse"
                    ? "Все склады"
                    : "Все помещения"}
              </option>
              {view.availableWarehouses.map((item) => (
                <option key={item.Ref_Key} value={item.Ref_Key}>
                  {item.Description || item.Code || "Склад без названия"}
                </option>
              ))}
            </select>
          </label>
          <div className="stock-warehouse-type">
            <span>Тип помещения</span>
            <div
              className="warehouse-selector"
              aria-label="Выбор типа помещения"
            >
              {[
                ["all", "Все"],
                ["sales-floor", "Торговый зал"],
                ["warehouse", "Склад"],
              ].map(([value, label]) => (
                <button
                  className={warehouseMode === value ? "active" : ""}
                  key={value}
                  onClick={() => {
                    setWarehouseMode(value);
                    setWarehouseKey("all");
                    setPage(1);
                    setWriteOffPage(1);
                    setRecountPage(1);
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="kpi-grid stock-kpis">
        <article className="kpi-card">
          <div className="kpi-top">
            <span>SKU с остатком</span>
          </div>
          <strong>{number.format(view.rows.length)}</strong>
          <p>позиций вернул регистр 1С</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-top">
            <span>Остаток, единиц</span>
          </div>
          <strong>{number.format(view.totalQuantity)}</strong>
          <p>по выбранным складам</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-top">
            <span>Осталось мало</span>
          </div>
          <strong>{number.format(view.low)}</strong>
          <p>доступно не более 5 единиц</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-top">
            <span>В резерве</span>
          </div>
          <strong>{number.format(view.totalReserved)}</strong>
          <p>{view.zero} позиций с нулевым остатком</p>
        </article>
      </section>

      <section className="panel onec-stock-panel">
        <div className="stock-toolbar">
          <div>
            <h2>Остатки по номенклатуре</h2>
            <p>{view.filtered.length} позиций после фильтрации</p>
          </div>
          <div className="stock-controls">
            <label className="search onec-stock-search">
              <span aria-hidden>⌕</span>
              <input
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Название, артикул или склад"
                type="search"
                value={search}
              />
            </label>
            <select
              aria-label="Категория остатка"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setSubcategory("all");
                setPage(1);
              }}
            >
              <option value="all">Все категории</option>
              {view.categories.map((item) => (
                <option key={item.Ref_Key} value={item.Ref_Key}>
                  {item.Description || "Без названия"}
                </option>
              ))}
            </select>
            <select
              aria-label="Подкатегория остатка"
              value={subcategory}
              disabled={!view.subcategories.length}
              onChange={(event) => {
                setSubcategory(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">Все подкатегории</option>
              {view.subcategories.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Статус остатка"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">Все статусы</option>
              <option value="available">В наличии</option>
              <option value="low">Мало</option>
              <option value="zero">Нет в наличии</option>
            </select>
          </div>
        </div>

        <div className="onec-table-wrap">
          <table className="onec-table stock-table">
            <thead>
              <tr>
                <th>Артикул</th>
                <th>Товар</th>
                <th>Расположение</th>
                <th>Категория</th>
                <th>Подкатегория</th>
                <th>Остаток</th>
                <th>Резерв</th>
                <th>Доступно</th>
                <th>Статус</th>
                <th>Рекомендация</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((item) => (
                <tr key={item.key}>
                  <td>
                    <code>{item.sku}</code>
                  </td>
                  <td>
                    <strong>{item.name}</strong>
                  </td>
                  <td>{item.locations}</td>
                  <td>{item.category}</td>
                  <td>{item.subcategory}</td>
                  <td>{number.format(item.quantity)}</td>
                  <td>{number.format(item.reserved)}</td>
                  <td>
                    <strong>{number.format(item.available)}</strong>
                  </td>
                  <td>
                    <span className={`stock-status ${item.status}`}>
                      {item.status === "zero"
                        ? "Нет в наличии"
                        : item.status === "low"
                          ? "Мало"
                          : "В наличии"}
                    </span>
                  </td>
                  <td>{item.recommendation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="onec-pagination stock-pagination">
          <span>
            Показано {visibleRows.length} из {view.filtered.length}
          </span>
          <nav aria-label="Пагинация остатков">
            <button
              disabled={currentPage === 1}
              onClick={() => setPage((value) => Math.max(value - 1, 1))}
              type="button"
            >
              ←
            </button>
            <span>
              {currentPage} / {pages}
            </span>
            <button
              disabled={currentPage === pages}
              onClick={() => setPage((value) => Math.min(value + 1, pages))}
              type="button"
            >
              →
            </button>
          </nav>
        </div>
      </section>

      <section className="stock-section-heading">
        <h2>Приход товара</h2>
        <p>Последние 8 недель и проведённые документы поставок</p>
      </section>

      <section className="stock-operations-grid">
        <article className="panel stock-operation-card">
          <div className="panel-head">
            <div>
              <h2>SKU в приходе по неделям</h2>
              <p>Частота и объём фактических поставок</p>
            </div>
          </div>
          {view.receiptChart.some((item) => item.sku || item.units) ? (
            <div className="stock-receipt-chart">
              {view.receiptChart.map((item) => (
                <div className="stock-receipt-column" key={item.label}>
                  <div className="stock-receipt-bar-wrap">
                    <b>{item.sku}</b>
                    <i
                      style={{
                        height: `${Math.max(
                          (item.sku / view.maxReceiptSku) * 100,
                          item.sku ? 8 : 0,
                        )}%`,
                      }}
                    />
                  </div>
                  <span>{item.label}</span>
                  <small>{number.format(item.units)} ед.</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="stock-operation-empty">
              <strong>Нет проведённых поступлений</strong>
              <span>
                {payload.meta?.operationErrors?.receipts ||
                  "1С не вернула документы поступления для выбранного склада."}
              </span>
            </div>
          )}
        </article>

        <article className="panel stock-operation-card">
          <div className="panel-head">
            <div>
              <h2>Последние поставки</h2>
              <p>Документы «Поступление товаров» из 1С</p>
            </div>
          </div>
          {view.recentReceipts.length ? (
            <div className="stock-compact-table-wrap">
              <table className="stock-compact-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Поставщик</th>
                    <th>Склад</th>
                    <th>SKU</th>
                  </tr>
                </thead>
                <tbody>
                  {view.recentReceipts.map((document) => (
                    <tr key={document.Ref_Key}>
                      <td>
                        {new Date(document.Date).toLocaleDateString("ru-RU")}
                      </td>
                      <td>
                        <strong>{document.supplier}</strong>
                      </td>
                      <td>{document.warehouse}</td>
                      <td>{document.sku}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="stock-operation-empty compact">
              <strong>Поставок нет</strong>
              <span>Для выбранного склада документы не найдены.</span>
            </div>
          )}
        </article>
      </section>

      <section className="stock-section-heading">
        <h2>Контроль качества и учёта</h2>
        <p>Списания и сверка фактических остатков</p>
      </section>

      <section className="stock-quality-grid">
        <article className="panel stock-operation-card">
          <div className="panel-head">
            <div>
              <h2>Брак и списания</h2>
              <p>Фактические документы списания с причиной из 1С</p>
            </div>
            <span className="tag amber">
              {number.format(
                view.writeOffRows.reduce((sum, item) => sum + item.quantity, 0),
              )}{" "}
              ед.
            </span>
          </div>
          {view.writeOffRows.length ? (
            <div className="stock-compact-table-wrap">
              <table className="stock-compact-table">
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th>Кол-во</th>
                    <th>Причина</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleWriteOffRows.map((item) => (
                    <tr key={item.key}>
                      <td>
                        <strong>{item.name}</strong>
                        <small>{item.sku}</small>
                      </td>
                      <td>{number.format(item.quantity)}</td>
                      <td>{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="stock-operation-empty compact">
              <strong>Списаний нет</strong>
              <span>
                {payload.meta?.operationErrors?.writeOffs ||
                  "Проведённые документы списания не найдены."}
              </span>
            </div>
          )}
          {view.writeOffRows.length > qualityPageSize && (
            <div className="onec-pagination stock-quality-pagination">
              <span>
                Показано {visibleWriteOffRows.length} из{" "}
                {view.writeOffRows.length}
              </span>
              <nav aria-label="Пагинация брака и списаний">
                <button
                  disabled={currentWriteOffPage === 1}
                  onClick={() =>
                    setWriteOffPage((value) => Math.max(value - 1, 1))
                  }
                  type="button"
                >
                  ←
                </button>
                <span>
                  {currentWriteOffPage} / {writeOffPages}
                </span>
                <button
                  disabled={currentWriteOffPage === writeOffPages}
                  onClick={() =>
                    setWriteOffPage((value) =>
                      Math.min(value + 1, writeOffPages),
                    )
                  }
                  type="button"
                >
                  →
                </button>
              </nav>
            </div>
          )}
        </article>

        <article className="panel stock-operation-card">
          <div className="panel-head">
            <div>
              <h2>Сверка остатков</h2>
              <p>Учётное количество против фактического</p>
            </div>
            <span className="tag green">
              {view.recountRows.filter((item) => item.difference !== 0).length}{" "}
              расхожд.
            </span>
          </div>
          {view.recountRows.length ? (
            <div className="stock-compact-table-wrap">
              <table className="stock-compact-table">
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th>По базе</th>
                    <th>Факт</th>
                    <th>Разница</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecountRows.map((item) => (
                    <tr key={item.key}>
                      <td>
                        <strong>{item.name}</strong>
                        <small>{item.sku}</small>
                      </td>
                      <td>{number.format(item.accounting)}</td>
                      <td>{number.format(item.actual)}</td>
                      <td>
                        <span
                          className={`stock-difference ${item.difference === 0 ? "ok" : "bad"}`}
                        >
                          {item.difference > 0 ? "+" : ""}
                          {number.format(item.difference)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="stock-operation-empty compact">
              <strong>Пересчётов нет</strong>
              <span>
                {payload.meta?.operationErrors?.recounts ||
                  "Документы пересчёта для выбранного склада не найдены."}
              </span>
            </div>
          )}
          {view.recountRows.length > qualityPageSize && (
            <div className="onec-pagination stock-quality-pagination">
              <span>
                Показано {visibleRecountRows.length} из{" "}
                {view.recountRows.length}
              </span>
              <nav aria-label="Пагинация сверки остатков">
                <button
                  disabled={currentRecountPage === 1}
                  onClick={() =>
                    setRecountPage((value) => Math.max(value - 1, 1))
                  }
                  type="button"
                >
                  ←
                </button>
                <span>
                  {currentRecountPage} / {recountPages}
                </span>
                <button
                  disabled={currentRecountPage === recountPages}
                  onClick={() =>
                    setRecountPage((value) => Math.min(value + 1, recountPages))
                  }
                  type="button"
                >
                  →
                </button>
              </nav>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
