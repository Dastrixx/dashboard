"use client";

import { useEffect, useMemo, useState } from "react";
import {
  API_URL,
  DataState,
  MissingSource,
  ZERO_GUID,
  money,
  number,
} from "./shared";
import type { SellerPayload } from "./types";

export function OnecTeam() {
  const [period, setPeriod] = useState<1 | 7 | 30>(30);
  const [payload, setPayload] = useState<SellerPayload>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [storeKey, setStoreKey] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        const response = await fetch(
          `${API_URL}/api/dashboard/onec-consultants?days=${period}`,
          {
            signal: controller.signal,
            cache: "no-store",
            credentials: "include",
          },
        );
        const data = (await response.json()) as SellerPayload;
        if (!response.ok) {
          throw new Error(data.message || `Ошибка HTTP ${response.status}`);
        }
        setPayload(data);
      } catch (loadError) {
        if (
          loadError instanceof DOMException &&
          loadError.name === "AbortError"
        )
          return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось получить продажи продавцов из 1С",
        );
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [period]);

  const view = useMemo(() => {
    const references = new Map(
      (payload.references?.sellers || []).map((item) => [item.Ref_Key, item]),
    );
    const stores = new Map(
      (payload.references?.stores || []).map((item) => [item.Ref_Key, item]),
    );
    const query = search.trim().toLowerCase();

    // Строим строки из строк чека (реальные продавцы, не кассиры)
    const allRows = (payload.items || [])
      .map((item) => {
        const seller = references.get(item.Продавец_Key);
        const resolvedStoreKey =
          item.Магазин_Key && item.Магазин_Key !== ZERO_GUID
            ? item.Магазин_Key
            : seller?.Магазин_Key || ZERO_GUID;
        return {
          key: `${item.Продавец_Key}:${resolvedStoreKey}`,
          sellerKey: item.Продавец_Key,
          seller:
            seller?.Description ||
            `Продавец ${item.Продавец_Key.slice(0, 8)}`,
          storeKey: resolvedStoreKey,
          store:
            stores.get(resolvedStoreKey)?.Description ||
            (resolvedStoreKey === ZERO_GUID
              ? "Филиал не указан"
              : "Филиал не найден"),
          revenue: Number(item.СтоимостьTurnover || 0),
          revenueWithoutDiscount: Number(
            item.СтоимостьБезСкидокTurnover || 0,
          ),
          quantity: Number(item.КоличествоTurnover || 0),
          returnLines: Number(item.СтрокВозвратов || 0),
          salesLines: Number(item.СтрокПродаж || 0),
        };
      })
      // Сортируем по фактической выручке (со скидками) — главная цифра
      .sort((left, right) => right.revenue - left.revenue);

    const rows = allRows.filter(
      (item) =>
        (storeKey === "all" || item.storeKey === storeKey) &&
        (!query ||
          `${item.seller} ${item.store}`.toLowerCase().includes(query)),
    );

    // Основная выручка — фактически полученная (со скидками)
    const totalRevenue = rows.reduce((sum, item) => sum + item.revenue, 0);
    // До скидок — справочно
    const totalGrossRevenue = rows.reduce(
      (sum, item) => sum + item.revenueWithoutDiscount,
      0,
    );
    const totalDiscount = Math.max(totalGrossRevenue - totalRevenue, 0);
    const totalQuantity = rows.reduce((sum, item) => sum + item.quantity, 0);

    const branchMap = new Map<
      string,
      { key: string; name: string; revenue: number }
    >();
    rows.forEach((item) => {
      const branch = branchMap.get(item.storeKey) || {
        key: item.storeKey,
        name: item.store,
        revenue: 0,
      };
      branch.revenue += item.revenue;
      branchMap.set(item.storeKey, branch);
    });

    return {
      rows: rows.map((item, index) => ({
        ...item,
        rank: index + 1,
        // Доля — от фактической выручки
        share: totalRevenue ? (item.revenue / totalRevenue) * 100 : 0,
        discount: Math.max(item.revenueWithoutDiscount - item.revenue, 0),
      })),
      stores: [...stores.values()].sort((left, right) =>
        (left.Description || "").localeCompare(right.Description || "", "ru"),
      ),
      branches: [...branchMap.values()].sort(
        (left, right) => right.revenue - left.revenue,
      ),
      totalRevenue,
      totalGrossRevenue,
      totalDiscount,
      totalQuantity,
      sellers: new Set(rows.map((item) => item.sellerKey)).size,
    };
  }, [payload, storeKey, search]);

  if (loading || error) {
    return (
      <div className="page-stack">
        <DataState loading={loading} error={error} empty={false} />
      </div>
    );
  }

  if (!(payload.items || []).length) {
    const diagnostics = payload.meta?.diagnostics;
    return (
      <MissingSource
        title="Продажи продавцов по филиалам"
        description="В документах 1С не удалось определить продавца в строках чека"
        source={`Проверено чеков: ${diagnostics?.scannedChecks || 0}, товарных строк: ${diagnostics?.checkLines || 0}, строк с продавцом: ${diagnostics?.checkLinesWithConsultant || 0}. Продавец определяется из поля Товары.Продавец_Key каждой строки чека ККМ.`}
      />
    );
  }

  const pageSize = 20;
  const pages = Math.max(Math.ceil(view.rows.length / pageSize), 1);
  const currentPage = Math.min(page, pages);
  const visibleRows = view.rows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const maxBranchRevenue = Math.max(
    ...view.branches.map((item) => item.revenue),
    1,
  );

  return (
    <div className="page-stack onec-team-workspace">
      <section className="team-plan-hero onec-team-hero">
        <div className="team-plan-head">
          <div>
            <span className="team-plan-kicker">Фактические данные 1С</span>
            <h2>Продажи продавцов по филиалам</h2>
            <p>
              {payload.meta?.source ||
                "Продавец из строк чека ККМ (Товары.Продавец_Key)"}{" "}
              · последние данные{" "}
              {payload.meta?.latestDate
                ? new Date(payload.meta.latestDate).toLocaleString("ru-RU")
                : "без даты"}
              {payload.meta?.periodStart && payload.meta?.periodEnd ? (
                <>
                  <br />
                  Период:{" "}
                  {new Date(payload.meta.periodStart).toLocaleString("ru-RU")}{" "}
                  —{" "}
                  {new Date(payload.meta.periodEnd).toLocaleString("ru-RU")}
                </>
              ) : null}
            </p>
          </div>
          <div className="team-filter-groups">
            <select
              value={storeKey}
              onChange={(event) => {
                setStoreKey(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">Все филиалы</option>
              {view.stores.map((item) => (
                <option key={item.Ref_Key} value={item.Ref_Key}>
                  {item.Description || item.Code || "Филиал без названия"}
                </option>
              ))}
            </select>
            <div className="team-segment period-team">
              {(
                [
                  [1, "День"],
                  [7, "Неделя"],
                  [30, "Месяц"],
                ] as const
              ).map(([value, label]) => (
                <button
                  className={period === value ? "active" : ""}
                  key={value}
                  onClick={() => {
                    setPeriod(value);
                    setPage(1);
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="team-plan-metrics">
          <div>
            <span>Выручка (факт)</span>
            <strong>{money.format(view.totalRevenue)}</strong>
            <small>
              до скидок: {money.format(view.totalGrossRevenue)}
            </small>
          </div>
          <div>
            <span>Скидки</span>
            <strong>{money.format(view.totalDiscount)}</strong>
            <small>
              {view.totalGrossRevenue > 0
                ? `${number.format((view.totalDiscount / view.totalGrossRevenue) * 100)}% от объёма`
                : "—"}
            </small>
          </div>
          <div>
            <span>Продавцов</span>
            <strong>{view.sellers}</strong>
            <small>с продажами за период</small>
          </div>
          <div>
            <span>Продано единиц</span>
            <strong>{number.format(view.totalQuantity)}</strong>
            <small>из строк чеков</small>
          </div>
        </div>
      </section>

      <section className="team-branch-grid">
        <article className="panel team-branch-panel">
          <div className="panel-head">
            <div>
              <h2>Продажи по филиалам</h2>
              <p>Доля филиала в общей выручке</p>
            </div>
          </div>
          <div className="team-branch-bars">
            {view.branches.map((branch) => (
              <div key={branch.key}>
                <div>
                  <strong>{branch.name}</strong>
                  <span>{money.format(branch.revenue)}</span>
                </div>
                <i>
                  <b
                    style={{
                      width: `${(branch.revenue / maxBranchRevenue) * 100}%`,
                    }}
                  />
                </i>
              </div>
            ))}
          </div>
        </article>
        <article className="panel team-leader-panel">
          <span className="team-plan-kicker">Лидер периода</span>
          <strong>{view.rows[0]?.seller || "Нет данных"}</strong>
          <p>{view.rows[0]?.store || "Филиал не указан"}</p>
          <b>{money.format(view.rows[0]?.revenue || 0)}</b>
          <small>
            до скидок: {money.format(view.rows[0]?.revenueWithoutDiscount || 0)} ·{" "}
            {number.format(view.rows[0]?.quantity || 0)} ед.
          </small>
        </article>
      </section>

      <section className="panel onec-team-table-panel">
        <div className="stock-toolbar">
          <div>
            <h2>Рейтинг продавцов</h2>
            <p>Кто и в каком филиале сделал продажи (из строк чека)</p>
          </div>
          <label className="search onec-stock-search">
            <span aria-hidden>⌕</span>
            <input
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Продавец или филиал"
              type="search"
              value={search}
            />
          </label>
        </div>
        <div className="onec-table-wrap">
          <table className="onec-table onec-team-table">
            <thead>
              <tr>
                <th>Место</th>
                <th>Продавец</th>
                <th>Филиал</th>
                <th>Продажи (факт)</th>
                <th>Продано</th>
                <th>Доля команды</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((item) => (
                <tr key={item.key}>
                  <td>
                    <span className="team-rank-place">{item.rank}</span>
                  </td>
                  <td>
                    <strong>{item.seller}</strong>
                  </td>
                  <td>{item.store}</td>
                  <td>
                    {/* Главная цифра — фактически полученное (со скидкой) */}
                    <strong>{money.format(item.revenue)}</strong>
                    {item.discount > 0 && (
                      <span className="team-actual-revenue">
                        до скидки: {money.format(item.revenueWithoutDiscount)}
                      </span>
                    )}
                  </td>
                  <td>{number.format(item.quantity)} ед.</td>
                  <td>
                    <div className="team-share-cell">
                      <span>{number.format(item.share)}%</span>
                      <i>
                        <b style={{ width: `${Math.min(item.share, 100)}%` }} />
                      </i>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="onec-pagination">
          <span>
            Показано {visibleRows.length} из {view.rows.length}
          </span>
          <nav aria-label="Пагинация продавцов">
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
    </div>
  );
}
