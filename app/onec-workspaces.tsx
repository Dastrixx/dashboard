"use client";

import { useEffect, useMemo, useState } from "react";

type Period = 7 | 30 | 90;

type OnecLine = {
  LineNumber: string;
  Номенклатура_Key: string;
  Количество: number;
  Цена: number;
  Сумма: number;
  Склад_Key: string;
  Продавец_Key: string;
};

type OnecReport = {
  Ref_Key: string;
  Number: string;
  Date: string;
  Posted: boolean;
  СуммаДокумента: number;
  СуммаВозвратов: number;
  Магазин_Key: string;
  Товары: OnecLine[];
};

type OnecPayload = {
  items?: OnecReport[];
  message?: string;
};

type StockBalance = {
  Склад_Key: string;
  Номенклатура_Key: string;
  КоличествоBalance: number;
  РезервBalance: number;
  ор_СебестоимостьBalance?: number;
};

type StockReference = {
  Ref_Key: string;
  Code?: string;
  Description?: string;
  НаименованиеПолное?: string;
  Артикул?: string;
  ТоварнаяГруппа_Key?: string;
  ТипСклада?: string;
};

type StockPayload = {
  items?: StockBalance[];
  references?: {
    products?: StockReference[];
    warehouses?: StockReference[];
    categories?: StockReference[];
  };
  meta?: { loaded?: number; asOf?: string; source?: string };
  message?: string;
};

const API_URL = "http://localhost:4000";
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "KGS",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
});

function useOnecReports(period: Period | 10 = 10) {
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

function DataState({
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
          <div className="kpi-top"><span>Сумма документов</span></div>
          <strong>{money.format(view.revenue)}</strong>
          <p>проведённые отчёты 1С</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-top"><span>Возвраты</span></div>
          <strong>{money.format(view.returns)}</strong>
          <p>поле «СуммаВозвратов»</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-top"><span>Продано единиц</span></div>
          <strong>{number.format(view.quantity)}</strong>
          <p>по товарным строкам отчётов</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-top"><span>Товаров в продажах</span></div>
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
            <span>Нет данных: без количества чеков показатель не рассчитывается</span>
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

function MissingSource({
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

export function OnecStock() {
  const [payload, setPayload] = useState<StockPayload>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warehouseMode, setWarehouseMode] = useState("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-stock?top=5000`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as StockPayload;
        if (!response.ok) {
          throw new Error(data.message || `Ошибка HTTP ${response.status}`);
        }
        setPayload(data);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
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
      (payload.references?.warehouses || []).map((item) => [item.Ref_Key, item]),
    );
    const categories = new Map(
      (payload.references?.categories || []).map((item) => [item.Ref_Key, item]),
    );

    const matchesWarehouse = (key: string) => {
      if (warehouseMode === "all") return true;
      const kind = warehouses.get(key)?.ТипСклада || "";
      if (warehouseMode === "sales-floor") return kind === "ТорговыйЗал";
      return kind === "СкладскоеПомещение";
    };

    const grouped = new Map<
      string,
      {
        key: string;
        sku: string;
        name: string;
        categoryKey: string;
        category: string;
        quantity: number;
        reserved: number;
        cost: number;
        locations: Set<string>;
      }
    >();

    balances.filter((item) => matchesWarehouse(item.Склад_Key)).forEach((item) => {
      const product = products.get(item.Номенклатура_Key);
      const categoryKey = product?.ТоварнаяГруппа_Key || "";
      const current = grouped.get(item.Номенклатура_Key) || {
        key: item.Номенклатура_Key,
        sku: product?.Артикул || product?.Code || "Без артикула",
        name:
          product?.НаименованиеПолное ||
          product?.Description ||
          `Товар ${item.Номенклатура_Key.slice(0, 8)}`,
        categoryKey,
        category: categories.get(categoryKey)?.Description || "Без категории",
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
      .filter((item) => status === "all" || item.status === status)
      .filter(
        (item) =>
          !query ||
          `${item.sku} ${item.name} ${item.locations}`.toLowerCase().includes(query),
      )
      .sort((left, right) => left.available - right.available);

    return {
      rows,
      filtered,
      categories: [...categories.values()].sort((left, right) =>
        (left.Description || "").localeCompare(right.Description || "", "ru"),
      ),
      totalQuantity: rows.reduce((sum, item) => sum + item.quantity, 0),
      totalReserved: rows.reduce((sum, item) => sum + item.reserved, 0),
      zero: rows.filter((item) => item.status === "zero").length,
      low: rows.filter((item) => item.status === "low").length,
    };
  }, [payload, warehouseMode, category, status, search]);

  useEffect(() => setPage(1), [warehouseMode, category, status, search]);

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
        <div className="warehouse-selector" aria-label="Выбор типа склада">
          {[
            ["all", "Все"],
            ["sales-floor", "Торговый зал"],
            ["warehouse", "Склад"],
          ].map(([value, label]) => (
            <button
              className={warehouseMode === value ? "active" : ""}
              key={value}
              onClick={() => setWarehouseMode(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="kpi-grid stock-kpis">
        <article className="kpi-card">
          <div className="kpi-top"><span>SKU с остатком</span></div>
          <strong>{number.format(view.rows.length)}</strong>
          <p>позиций вернул регистр 1С</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-top"><span>Остаток, единиц</span></div>
          <strong>{number.format(view.totalQuantity)}</strong>
          <p>по выбранным складам</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-top"><span>Осталось мало</span></div>
          <strong>{number.format(view.low)}</strong>
          <p>доступно не более 5 единиц</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-top"><span>В резерве</span></div>
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
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Название, артикул или склад"
                type="search"
                value={search}
              />
            </label>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">Все категории</option>
              {view.categories.map((item) => (
                <option key={item.Ref_Key} value={item.Ref_Key}>
                  {item.Description || "Без названия"}
                </option>
              ))}
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
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
                  <td><code>{item.sku}</code></td>
                  <td><strong>{item.name}</strong></td>
                  <td>{item.locations}</td>
                  <td>{item.category}</td>
                  <td>{number.format(item.quantity)}</td>
                  <td>{number.format(item.reserved)}</td>
                  <td><strong>{number.format(item.available)}</strong></td>
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
            <span>{currentPage} / {pages}</span>
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

      <section className="stock-next-grid">
        <article className="panel stock-next-card">
          <span>Следующий источник</span>
          <h3>Поступления товаров</h3>
          <p>Подключим документы «ПоступлениеТоваров» для графика приходов и последних поставок.</p>
        </article>
        <article className="panel stock-next-card">
          <span>Следующий источник</span>
          <h3>Пересчёт и расхождения</h3>
          <p>Подключим «ПересчетТоваров» и акты расхождений. До этого значения не подменяются демо-данными.</p>
        </article>
      </section>
    </div>
  );
}

export function OnecTeam() {
  const { reports, loading, error } = useOnecReports(10);
  const sellerKeys = useMemo(
    () =>
      [
        ...new Set(
          reports
            .flatMap((report) => report.Товары || [])
            .map((line) => line.Продавец_Key)
            .filter((key) => key && key !== ZERO_GUID),
        ),
      ],
    [reports],
  );

  if (loading || error) {
    return (
      <div className="page-stack">
        <DataState loading={loading} error={error} empty={false} />
      </div>
    );
  }

  if (!sellerKeys.length) {
    return (
      <MissingSource
        title="Продавцы"
        description="В полученных документах продавец не заполнен"
        source="Поле Продавец_Key содержит нулевой GUID. Рейтинг и вклад продавцов не показываются, чтобы не подменять реальные данные демонстрационными."
      />
    );
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Продавцы из документов 1С</h2>
            <p>Получены реальные ключи продавцов</p>
          </div>
        </div>
        <div className="onec-key-list">
          {sellerKeys.map((key) => <code key={key}>{key}</code>)}
        </div>
      </section>
    </div>
  );
}

export function OnecProcurement() {
  return (
    <MissingSource
      title="Закуп / Перемещение"
      description="Заявка должна строиться только по фактическим остаткам"
      source="Пока виртуальная таблица остатков 1С не подключена, система не предлагает количество к закупу и не создаёт фиктивные заявки."
    />
  );
}
