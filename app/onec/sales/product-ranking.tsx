"use client";

import { useMemo, useState } from "react";
import { buildRankingRows, downloadRankingCsv } from "./analytics";
import { money, number, PERIODS } from "./config";
import type {
  AnalyticsPeriod,
  OnecCategoryReference,
  OnecProductReference,
  OnecRetailReport,
} from "./types";

type Props = {
  reports: OnecRetailReport[];
  products: OnecProductReference[];
  categories: OnecCategoryReference[];
  anchorTimestamp: number;
};

export function ProductRanking({
  reports,
  products,
  categories,
  anchorTimestamp,
}: Props) {
  const [period, setPeriod] = useState<AnalyticsPeriod>("month");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [topLimit, setTopLimit] = useState(10);
  const [antiLimit, setAntiLimit] = useState(10);
  const rows = useMemo(
    () =>
      buildRankingRows(
        reports,
        products,
        categories,
        period,
        anchorTimestamp,
      ),
    [anchorTimestamp, categories, period, products, reports],
  );
  const availableCategories = useMemo(
    () =>
      categories
        .map((item) => item.Description)
        .filter((item) => rows.some((row) => row.category === item)),
    [categories, rows],
  );
  const availableSubcategories = useMemo(() => {
    const options = new Map<string, string>();

    rows
      .filter((row) => row.category === category)
      .forEach((row) => {
        if (row.subcategoryKey) {
          options.set(row.subcategoryKey, row.subcategory);
        }
      });

    return [...options.entries()].sort((left, right) =>
      left[1].localeCompare(right[1], "ru"),
    );
  }, [category, rows]);
  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!category || row.category === category) &&
          (!subcategory || row.subcategoryKey === subcategory),
      ),
    [category, rows, subcategory],
  );
  const topRows = filteredRows.slice(0, topLimit);
  const lowDemandRows = useMemo(
    () =>
      [...filteredRows].sort(
        (left, right) =>
          left.sold - right.sold || left.revenue - right.revenue,
      ),
    [filteredRows],
  );
  const antiRows = lowDemandRows.slice(0, antiLimit);

  function resetLimits() {
    setTopLimit(10);
    setAntiLimit(10);
  }

  return (
    <section className="onec-ranking-section">
      <header className="onec-ranking-toolbar">
        <div>
          <span className="onec-source-kicker">Аналитика спроса</span>
          <h2>Рейтинг товаров</h2>
          <p>Выручка и количество продаж {PERIODS[period].caption}</p>
        </div>
        <div className="onec-ranking-filters">
          <label className="select-control">
            <select
              aria-label="Категория товаров"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setSubcategory("");
                resetLimits();
              }}
            >
              <option value="">Все категории</option>
              {availableCategories.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="select-control">
            <select
              aria-label="Подкатегория товаров"
              value={subcategory}
              disabled={!category || !availableSubcategories.length}
              onChange={(event) => {
                setSubcategory(event.target.value);
                resetLimits();
              }}
            >
              <option value="">Все подкатегории</option>
              {availableSubcategories.map(([key, name]) => (
                <option value={key} key={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div
            className="period-switch"
            role="group"
            aria-label="Период рейтинга товаров"
          >
            {(Object.keys(PERIODS) as AnalyticsPeriod[]).map((key) => (
              <button
                type="button"
                key={key}
                className={period === key ? "active" : ""}
                onClick={() => {
                  setPeriod(key);
                  setCategory("");
                  setSubcategory("");
                  resetLimits();
                }}
              >
                {PERIODS[key].label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="onec-ranking-grid">
        <article className="panel onec-ranking-card">
          <div className="panel-head">
            <div>
              <h2>Топ товаров по выручке</h2>
              <p>Что приносит основные деньги</p>
            </div>
            <div className="onec-ranking-actions">
              <button
                type="button"
                className="ranking-export"
                disabled={!filteredRows.length}
                onClick={() =>
                  downloadRankingCsv(`top-products-${period}.csv`, filteredRows)
                }
              >
                ↓ Выгрузить
              </button>
              <span className="tag green">ТОП</span>
            </div>
          </div>

          <div className="onec-rank-list">
            {topRows.map((row, index) => (
              <div className="rank-row" key={row.key}>
                <b>{index + 1}</b>
                <div>
                  <strong>{row.name}</strong>
                  <span>
                    {row.category} · {row.subcategory} ·{" "}
                    {number.format(row.sold)} ед.
                  </span>
                </div>
                <em>{money.format(row.revenue)}</em>
              </div>
            ))}
            {!topRows.length && (
              <p className="onec-no-data">Нет продаж за выбранный период</p>
            )}
          </div>

          {topLimit < filteredRows.length && (
            <button
              type="button"
              className="onec-rank-more"
              onClick={() => setTopLimit((value) => value + 10)}
            >
              Ещё {Math.min(10, filteredRows.length - topLimit)}
              <small>
                Показано {topRows.length} из {filteredRows.length}
              </small>
            </button>
          )}
        </article>

        <article className="panel onec-ranking-card">
          <div className="panel-head">
            <div>
              <h2>Антитоп: низкий спрос</h2>
              <p>Товары с минимальным количеством продаж</p>
            </div>
            <div className="onec-ranking-actions">
              <button
                type="button"
                className="ranking-export"
                disabled={!antiRows.length}
                onClick={() =>
                  downloadRankingCsv(
                    `low-demand-products-${period}.csv`,
                    lowDemandRows,
                  )
                }
              >
                ↓ Выгрузить
              </button>
              <span className="tag amber">НИЗКИЙ СПРОС</span>
            </div>
          </div>

          <div className="onec-rank-list">
            {antiRows.map((row, index) => (
              <div className="rank-row" key={row.key}>
                <b>{index + 1}</b>
                <div>
                  <strong>{row.name}</strong>
                  <span>
                    {row.category} · {row.subcategory} ·{" "}
                    {money.format(row.revenue)}
                  </span>
                </div>
                <em>{number.format(row.sold)} продаж</em>
              </div>
            ))}
            {!antiRows.length && (
              <p className="onec-no-data">Нет продаж за выбранный период</p>
            )}
          </div>

          {antiLimit < filteredRows.length && (
            <button
              type="button"
              className="onec-rank-more"
              onClick={() => setAntiLimit((value) => value + 10)}
            >
              Ещё {Math.min(10, filteredRows.length - antiLimit)}
              <small>
                Показано {antiRows.length} из {filteredRows.length}
              </small>
            </button>
          )}
        </article>
      </div>

      <p className="onec-ranking-note">
        Антитоп рассчитан по фактическому количеству продаж. После подключения
        регистра остатков 1С сюда добавятся товары с нулевым спросом, но
        фактическим наличием на складе.
      </p>
    </section>
  );
}
