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
  const [consultantPayload, setConsultantPayload] = useState<SellerPayload>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [storeKey, setStoreKey] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [teamPlan, setTeamPlan] = useState(0);
  const [planInput, setPlanInput] = useState("");
  const [planLoading, setPlanLoading] = useState(true);
  const [planSaving, setPlanSaving] = useState(false);
  const [planMessage, setPlanMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadPlan() {
      try {
        setPlanLoading(true);
        setPlanMessage("");
        const response = await fetch(
          `${API_URL}/api/dashboard/team-plan?storeKey=${encodeURIComponent(storeKey)}&period=${period}`,
          { signal: controller.signal, credentials: "include", cache: "no-store" },
        );
        const data = (await response.json()) as {
          item?: { amount?: number };
          message?: string;
        };
        if (!response.ok) {
          throw new Error(data.message || `Ошибка HTTP ${response.status}`);
        }
        const amount = Number(data.item?.amount || 0);
        setTeamPlan(amount);
        setPlanInput(amount ? String(amount) : "");
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setPlanMessage(
          loadError instanceof Error ? loadError.message : "Не удалось загрузить план команды",
        );
      } finally {
        if (!controller.signal.aborted) setPlanLoading(false);
      }
    }

    loadPlan();
    return () => controller.abort();
  }, [period, storeKey]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        const [sellerResponse, consultantResponse] = await Promise.all([
          fetch(`${API_URL}/api/dashboard/onec-sellers?days=${period}`, {
            signal: controller.signal,
            credentials: "include",
          }),
          fetch(`${API_URL}/api/dashboard/onec-consultants?days=${period}`, {
            signal: controller.signal,
            cache: "no-store",
            credentials: "include",
          }),
        ]);
        const [sellerData, consultantData] = (await Promise.all([
          sellerResponse.json(),
          consultantResponse.json(),
        ])) as [SellerPayload, SellerPayload];
        if (!sellerResponse.ok) {
          throw new Error(
            sellerData.message || `Ошибка HTTP ${sellerResponse.status}`,
          );
        }
        if (!consultantResponse.ok) {
          throw new Error(
            consultantData.message ||
              `Ошибка HTTP ${consultantResponse.status}`,
          );
        }
        setPayload(sellerData);
        setConsultantPayload(consultantData);
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
    const sellerReferences = new Map(
      (payload.references?.sellers || []).map((item) => [item.Ref_Key, item]),
    );
    const stores = new Map(
      (payload.references?.stores || []).map((item) => [item.Ref_Key, item]),
    );
    const grouped = new Map<
      string,
      {
        key: string;
        sellerKey: string;
        seller: string;
        storeKey: string;
        store: string;
        revenue: number;
        revenueWithoutDiscount: number;
        quantity: number;
      }
    >();

    (payload.items || []).forEach((item) => {
      const seller = sellerReferences.get(item.Продавец_Key);
      const resolvedStoreKey =
        item.Магазин_Key && item.Магазин_Key !== ZERO_GUID
          ? item.Магазин_Key
          : seller?.Магазин_Key || ZERO_GUID;
      const key = `${item.Продавец_Key}:${resolvedStoreKey}`;
      const current = grouped.get(key) || {
        key,
        sellerKey: item.Продавец_Key,
        seller:
          seller?.Description || `Продавец ${item.Продавец_Key.slice(0, 8)}`,
        storeKey: resolvedStoreKey,
        store:
          stores.get(resolvedStoreKey)?.Description ||
          (resolvedStoreKey === ZERO_GUID
            ? "Филиал не указан"
            : "Филиал не найден"),
        revenue: 0,
        revenueWithoutDiscount: 0,
        quantity: 0,
      };
      current.revenue += Number(item.СтоимостьTurnover || 0);
      current.revenueWithoutDiscount += Number(
        item.СтоимостьБезСкидокTurnover || 0,
      );
      current.quantity += Number(item.КоличествоTurnover || 0);
      grouped.set(key, current);
    });

    const allRows = [...grouped.values()].sort(
      (left, right) => right.revenue - left.revenue,
    );
    const query = search.trim().toLowerCase();
    const rows = allRows.filter(
      (item) =>
        (storeKey === "all" || item.storeKey === storeKey) &&
        (!query ||
          `${item.seller} ${item.store}`.toLowerCase().includes(query)),
    );
    const totalRevenue = rows.reduce((sum, item) => sum + item.revenue, 0);
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
        share: totalRevenue ? (item.revenue / totalRevenue) * 100 : 0,
        discount:
          item.revenueWithoutDiscount > 0
            ? Math.max(item.revenueWithoutDiscount - item.revenue, 0)
            : 0,
      })),
      stores: [...stores.values()].sort((left, right) =>
        (left.Description || "").localeCompare(right.Description || "", "ru"),
      ),
      branches: [...branchMap.values()].sort(
        (left, right) => right.revenue - left.revenue,
      ),
      totalRevenue,
      totalQuantity,
      sellers: new Set(rows.map((item) => item.sellerKey)).size,
    };
  }, [payload, storeKey, search]);

  const consultantView = useMemo(() => {
    const references = new Map(
      (consultantPayload.references?.sellers || []).map((item) => [
        item.Ref_Key,
        item,
      ]),
    );
    const stores = new Map(
      (consultantPayload.references?.stores || []).map((item) => [
        item.Ref_Key,
        item,
      ]),
    );
    const query = search.trim().toLowerCase();
    const rows = (consultantPayload.items || [])
      .map((item) => {
        const consultant = references.get(item.Продавец_Key);
        const resolvedStoreKey =
          item.Магазин_Key && item.Магазин_Key !== ZERO_GUID
            ? item.Магазин_Key
            : consultant?.Магазин_Key || ZERO_GUID;

        return {
          key: `${item.Продавец_Key}:${resolvedStoreKey}`,
          consultantKey: item.Продавец_Key,
          consultant:
            consultant?.Description ||
            `Консультант ${item.Продавец_Key.slice(0, 8)}`,
          storeKey: resolvedStoreKey,
          store:
            stores.get(resolvedStoreKey)?.Description ||
            (resolvedStoreKey === ZERO_GUID
              ? "Филиал не указан"
              : "Филиал не найден"),
          revenue: Number(item.СтоимостьTurnover || 0),
          quantity: Number(item.КоличествоTurnover || 0),
          salesLines: Number(item.СтрокПродаж || 0),
          returnLines: Number(item.СтрокВозвратов || 0),
        };
      })
      .filter(
        (item) =>
          (storeKey === "all" || item.storeKey === storeKey) &&
          (!query ||
            `${item.consultant} ${item.store}`.toLowerCase().includes(query)),
      )
      .sort((left, right) => right.revenue - left.revenue);
    const totalRevenue = rows.reduce((sum, item) => sum + item.revenue, 0);

    return {
      rows: rows.map((item, index) => ({
        ...item,
        rank: index + 1,
        share: totalRevenue ? (item.revenue / totalRevenue) * 100 : 0,
      })),
      stores: [...stores.values()],
      totalRevenue,
      totalQuantity: rows.reduce((sum, item) => sum + item.quantity, 0),
      consultants: new Set(rows.map((item) => item.consultantKey)).size,
    };
  }, [consultantPayload, storeKey, search]);

  const saveTeamPlan = async () => {
    const amount = Number(planInput.replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0) {
      setPlanMessage("Укажите корректную сумму плана");
      return;
    }

    try {
      setPlanSaving(true);
      setPlanMessage("");
      const response = await fetch(`${API_URL}/api/dashboard/team-plan`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeKey,
          period,
          amount,
        }),
      });
      const data = (await response.json()) as {
        item?: { amount?: number };
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message || `Ошибка HTTP ${response.status}`);
      }
      const savedAmount = Number(data.item?.amount || amount);
      setTeamPlan(savedAmount);
      setPlanInput(savedAmount ? String(savedAmount) : "");
      setPlanMessage("План команды сохранён");
    } catch (saveError) {
      setPlanMessage(
        saveError instanceof Error ? saveError.message : "Не удалось сохранить план команды",
      );
    } finally {
      setPlanSaving(false);
    }
  };

  const teamStores = useMemo(() => {
    const stores = new Map(
      [...view.stores, ...consultantView.stores].map((item) => [
        item.Ref_Key,
        item,
      ]),
    );
    return [...stores.values()].sort((left, right) =>
      (left.Description || "").localeCompare(right.Description || "", "ru"),
    );
  }, [view.stores, consultantView.stores]);

  if (loading || error) {
    return (
      <div className="page-stack">
        <DataState loading={loading} error={error} empty={false} />
      </div>
    );
  }

  if (
    !(payload.items || []).length &&
    !(consultantPayload.items || []).length
  ) {
    const diagnostics = payload.meta?.diagnostics;
    return (
      <MissingSource
        title="Продажи продавцов по филиалам"
        description="В документах 1С не удалось определить сотрудника продажи"
        source={`Проверены: регистр продаж — ${diagnostics?.turnoverRows || 0} строк (${diagnostics?.turnoverRowsWithSeller || 0} с продавцом), личные продажи — ${diagnostics?.scannedPremiumRows || 0}, чеки ККМ — ${diagnostics?.scannedChecks || 0} (${diagnostics?.checksWithAssignedEmployee || 0} с сотрудником), кассовые смены — ${diagnostics?.scannedCashShifts || 0}, реализации — ${diagnostics?.scannedRealizations || 0}. Для чека сотрудник определяется по продавцу строки, продавцу чека, кассиру смены или ответственному пользователю.`}
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
  const teamPlanActual = consultantView.totalRevenue;
  const teamPlanPercent = teamPlan > 0 ? (teamPlanActual / teamPlan) * 100 : 0;
  const maxConsultantRevenue = Math.max(
    ...consultantView.rows.map((item) => item.revenue),
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
              {payload.meta?.source || "Данные 1С"} · последние данные{" "}
              {payload.meta?.latestDate
                ? new Date(payload.meta.latestDate).toLocaleString("ru-RU")
                : "без даты"}
              {payload.meta?.periodStart && payload.meta?.periodEnd ? (
                <>
                  <br />Период: {new Date(payload.meta.periodStart).toLocaleString("ru-RU")} — {new Date(payload.meta.periodEnd).toLocaleString("ru-RU")}
                </>
              ) : null}
              {payload.meta?.analysisAnchorAdjusted &&
              payload.meta?.absoluteLatestDate ? (
                <>
                  <br />Последний одиночный документ: {new Date(payload.meta.absoluteLatestDate).toLocaleString("ru-RU")}; для аналитики взят последний период регулярных продаж
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
              {teamStores.map((item) => (
                <option key={item.Ref_Key} value={item.Ref_Key}>
                  {item.Description || item.Code || "Филиал без названия"}
                </option>
              ))}
            </select>
            <div className="team-segment period-team">
              {[
                [1, "День"],
                [7, "Неделя"],
                [30, "Месяц"],
              ].map(([value, label]) => (
                <button
                  className={period === value ? "active" : ""}
                  key={value}
                  onClick={() => {
                    setPeriod(value as 1 | 7 | 30);
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
            <span>Продажи продавцов</span>
            <strong>{money.format(consultantView.totalRevenue)}</strong>
            <small>только консультанты, без кассиров</small>
          </div>
          <div>
            <span>План команды</span>
            <strong>{planLoading ? "…" : teamPlan ? money.format(teamPlan) : "Не задан"}</strong>
            <small>{teamPlan ? `${number.format(teamPlanPercent)}% выполнено` : "задайте план ниже"}</small>
          </div>
          <div>
            <span>Продавцов</span>
            <strong>{consultantView.consultants}</strong>
            <small>с личными продажами за период</small>
          </div>
          <div>
            <span>Продано единиц</span>
            <strong>{number.format(consultantView.totalQuantity)}</strong>
            <small>по личным продажам продавцов</small>
          </div>
        </div>

        <div className="team-plan-editor">
          <div className="team-plan-editor-copy">
            <span className="team-plan-kicker">План продаж команды</span>
            <strong>
              {storeKey === "all"
                ? "Общий план команды"
                : teamStores.find((item) => item.Ref_Key === storeKey)?.Description || "План филиала"}
            </strong>
            <small>План считается только по консультантам/продавцам, кассиры не участвуют.</small>
          </div>
          <label>
            <span>Сумма плана, KGS</span>
            <input
              type="number"
              min="0"
              step="1000"
              value={planInput}
              onChange={(event) => setPlanInput(event.target.value)}
              placeholder="Например, 1 500 000"
            />
          </label>
          <button
            type="button"
            onClick={saveTeamPlan}
            disabled={planSaving || planLoading}
          >
            {planSaving ? "Сохраняем…" : "Сохранить план"}
          </button>
          {planMessage && <small className="team-plan-message">{planMessage}</small>}
        </div>

        <div className="team-plan-progress-block">
          <div className="team-plan-progress-head">
            <div>
              <span>Выполнение командного плана</span>
              <strong>{money.format(teamPlanActual)} / {teamPlan ? money.format(teamPlan) : "—"}</strong>
            </div>
            <b>{teamPlan ? `${number.format(teamPlanPercent)}%` : "План не задан"}</b>
          </div>
          <div className="team-plan-progress">
            <i style={{ width: `${Math.min(teamPlanPercent, 100)}%` }} />
          </div>
        </div>
      </section>

      <section className="panel team-plan-sellers-panel">
        <div className="panel-head">
          <div>
            <span className="team-plan-kicker">Выполнение плана</span>
            <h2>План команды среди продавцов</h2>
            <p>Доля каждого консультанта в командном плане и фактических продажах</p>
          </div>
          <strong className="team-plan-total-percent">
            {teamPlan ? `${number.format(teamPlanPercent)}%` : "План не задан"}
          </strong>
        </div>

        {consultantView.rows.length ? (
          <div className="team-plan-seller-bars">
            {consultantView.rows.slice(0, 20).map((item) => {
              const planShare = teamPlan > 0 ? (item.revenue / teamPlan) * 100 : 0;
              const salesShare = consultantView.totalRevenue > 0
                ? (item.revenue / consultantView.totalRevenue) * 100
                : 0;
              return (
                <div className="team-plan-seller-row" key={item.key}>
                  <div className="team-plan-seller-head">
                    <div>
                      <strong>{item.consultant}</strong>
                      <span>{item.store}</span>
                    </div>
                    <div>
                      <b>{money.format(item.revenue)}</b>
                      <small>
                        {teamPlan
                          ? `${number.format(planShare)}% от плана`
                          : `${number.format(salesShare)}% продаж команды`}
                      </small>
                    </div>
                  </div>
                  <i>
                    <b
                      style={{
                        width: `${Math.max(
                          (item.revenue / maxConsultantRevenue) * 100,
                          item.revenue ? 3 : 0,
                        )}%`,
                      }}
                    />
                  </i>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="onec-no-data">Нет личных продаж продавцов за период</p>
        )}
      </section>

      <section className="panel consultant-analytics-panel">
        <div className="panel-head consultant-panel-head">
          <div>
            <span className="team-plan-kicker">Консультанты 1С</span>
            <h2>Личные продажи консультантов</h2>
            <p>
              {consultantPayload.meta?.source ||
                "Продавец в товарной строке розничного отчёта"}
              {consultantPayload.meta?.scope === "all" ? (
                <>
                  <br />Периодические фильтры временно отключены — показана вся
                  доступная история 1С
                </>
              ) : null}
              {consultantPayload.meta?.periodStart &&
              consultantPayload.meta?.periodEnd ? (
                <>
                  <br />Период: {new Date(consultantPayload.meta.periodStart).toLocaleString("ru-RU")} — {new Date(consultantPayload.meta.periodEnd).toLocaleString("ru-RU")}
                </>
              ) : null}
              {consultantPayload.meta?.analysisAnchorAdjusted &&
              consultantPayload.meta?.absoluteLatestDate ? (
                <>
                  <br />Последний одиночный документ: {new Date(consultantPayload.meta.absoluteLatestDate).toLocaleString("ru-RU")}; он не сдвигает весь период анализа
                </>
              ) : null}
            </p>
          </div>
          <div className="consultant-kpis">
            <div>
              <span>Консультантов</span>
              <strong>{consultantView.consultants}</strong>
            </div>
            <div>
              <span>Выручка</span>
              <strong>{money.format(consultantView.totalRevenue)}</strong>
            </div>
            <div>
              <span>Продано</span>
              <strong>{number.format(consultantView.totalQuantity)} ед.</strong>
            </div>
          </div>
        </div>
        {consultantView.rows.length ? (
          <div className="onec-table-wrap">
            <table className="onec-table consultant-table">
              <thead>
                <tr>
                  <th>Место</th>
                  <th>Консультант</th>
                  <th>Филиал</th>
                  <th>Выручка</th>
                  <th>Продано</th>
                  <th>Доля продаж</th>
                  <th>% плана команды</th>
                  <th>Возвраты</th>
                </tr>
              </thead>
              <tbody>
                {consultantView.rows.slice(0, 20).map((item) => (
                  <tr key={item.key}>
                    <td>
                      <span className="team-rank-place">{item.rank}</span>
                    </td>
                    <td>
                      <strong>{item.consultant}</strong>
                    </td>
                    <td>{item.store}</td>
                    <td>
                      <strong>{money.format(item.revenue)}</strong>
                    </td>
                    <td>{number.format(item.quantity)} ед.</td>
                    <td>{number.format(item.share)}%</td>
                    <td>
                      {teamPlan
                        ? `${number.format((item.revenue / teamPlan) * 100)}%`
                        : "—"}
                    </td>
                    <td>{number.format(item.returnLines)} строк</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="consultant-empty-state">
            <strong>В товарных строках консультант пока не заполнен</strong>
            <p>
              Проверено чеков:{" "}
              {consultantPayload.meta?.diagnostics?.scannedChecks || 0},
              товарных строк чеков:{" "}
              {consultantPayload.meta?.diagnostics?.checkLines || 0}, строк
              чеков с консультантом:{" "}
              {consultantPayload.meta?.diagnostics?.checkLinesWithConsultant ||
                0}
              . Проверено розничных отчётов:{" "}
              {consultantPayload.meta?.diagnostics?.reports || 0}, всего строк с
              консультантом:{" "}
              {consultantPayload.meta?.diagnostics?.linesWithConsultant || 0}.
            </p>
          </div>
        )}
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
            {number.format(view.rows[0]?.quantity || 0)} проданных единиц
          </small>
        </article>
      </section>

      <section className="panel onec-team-table-panel">
        <div className="stock-toolbar">
          <div>
            <h2>Рейтинг продавцов</h2>
            <p>Кто и в каком филиале сделал продажи</p>
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
                <th>Продажи</th>
                <th>Продано</th>
                <th>Доля команды</th>
                <th>Скидка</th>
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
                    <strong>{money.format(item.revenue)}</strong>
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
                  <td>{money.format(item.discount)}</td>
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
