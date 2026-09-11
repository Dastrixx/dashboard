"use client";

import { useMemo, useState } from "react";
import { summarizeAbc } from "./analytics";
import { money, number, TABLE_PAGE_SIZE } from "./config";
import type {
  AnalyticsPeriod,
  OnecCategoryReference,
  ProductRow,
} from "./types";

type Props = {
  rows: ProductRow[];
  categories: OnecCategoryReference[];
  period: AnalyticsPeriod;
};

export function AbcAnalysis({ rows, categories, period }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [pagination, setPagination] = useState({ period, page: 1 });
  const summary = useMemo(() => summarizeAbc(rows), [rows]);
  const subcategories = useMemo(() => {
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
  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return rows.filter(
      (row) =>
        (!category || row.category === category) &&
        (!subcategory || row.subcategoryKey === subcategory) &&
        (!normalizedQuery ||
          `${row.name} ${row.article} ${row.subcategory}`
            .toLowerCase()
            .includes(normalizedQuery)),
    );
  }, [category, query, rows, subcategory]);
  const pageCount = Math.max(
    1,
    Math.ceil(visibleRows.length / TABLE_PAGE_SIZE),
  );
  const requestedPage = pagination.period === period ? pagination.page : 1;
  const currentPage = Math.min(requestedPage, pageCount);
  const tableRows = visibleRows.slice(
    (currentPage - 1) * TABLE_PAGE_SIZE,
    currentPage * TABLE_PAGE_SIZE,
  );
  const firstVisibleRow = visibleRows.length
    ? (currentPage - 1) * TABLE_PAGE_SIZE + 1
    : 0;
  const lastVisibleRow = Math.min(
    currentPage * TABLE_PAGE_SIZE,
    visibleRows.length,
  );
  const firstPageButton = Math.max(
    1,
    Math.min(currentPage - 2, pageCount - 4),
  );
  const pageButtons = Array.from(
    { length: Math.min(5, pageCount) },
    (_, index) => firstPageButton + index,
  );

  return (
    <>
      <section className="panel onec-abc-summary">
        <div className="panel-head">
          <div>
            <h2>ABC-анализ ассортимента</h2>
            <p>A — ядро выручки, C — кандидаты для проверки спроса</p>
          </div>
        </div>
        <div className="onec-abc-summary-grid">
          {summary.map((item) => (
            <article
              className={`onec-abc-summary-card ${item.group.toLowerCase()}`}
              key={item.group}
            >
              <b>{item.group}</b>
              <strong>{item.share.toFixed(1)}%</strong>
              <span>{item.count} SKU</span>
            </article>
          ))}
        </div>
      </section>

      <section className="panel onec-abc-panel">
        <div className="inventory-head">
          <div>
            <h2>Таблица ABC-анализа</h2>
            <p>
              {visibleRows.length} позиций · по {TABLE_PAGE_SIZE} на странице
            </p>
          </div>
          <div className="onec-category-filters">
            <label className="select-control">
              <select
                aria-label="Категория ABC-анализа"
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setSubcategory("");
                  setPagination({ period, page: 1 });
                }}
              >
                <option value="">Все категории</option>
                {categories.map((item) => (
                  <option value={item.Description} key={item.Ref_Key}>
                    {item.Description}
                  </option>
                ))}
              </select>
            </label>
            <label className="select-control">
              <select
                aria-label="Подкатегория ABC-анализа"
                value={subcategory}
                disabled={!category || !subcategories.length}
                onChange={(event) => {
                  setSubcategory(event.target.value);
                  setPagination({ period, page: 1 });
                }}
              >
                <option value="">Все подкатегории</option>
                {subcategories.map(([key, name]) => (
                  <option value={key} key={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="inventory-controls">
          <label className="search onec-search">
            <span aria-hidden>⌕</span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPagination({ period, page: 1 });
              }}
              placeholder="Название, артикул или подкатегория"
            />
          </label>
        </div>

        <div className="onec-table-wrap">
          <table className="onec-table onec-abc-table">
            <thead>
              <tr>
                <th>Артикул</th>
                <th>Товар</th>
                <th>Категория</th>
                <th>Подкатегория</th>
                <th>Выручка</th>
                <th>Продано</th>
                <th>Доля</th>
                <th>ABC</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <code>{row.article}</code>
                  </td>
                  <td>
                    <strong>{row.name}</strong>
                    <small className="onec-key">{row.key}</small>
                  </td>
                  <td>{row.category}</td>
                  <td>{row.subcategory}</td>
                  <td>{money.format(row.revenue)}</td>
                  <td>{number.format(row.sold)} ед.</td>
                  <td>{row.share.toFixed(1)}%</td>
                  <td>
                    <span className={`abc-badge ${row.abc.toLowerCase()}`}>
                      {row.abc}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="onec-pagination">
          <span>
            Показано {firstVisibleRow}–{lastVisibleRow} из {visibleRows.length}
          </span>
          <nav aria-label="Пагинация таблицы ABC">
            <button
              type="button"
              aria-label="Предыдущая страница"
              disabled={currentPage === 1}
              onClick={() =>
                setPagination({ period, page: currentPage - 1 })
              }
            >
              ←
            </button>
            {pageButtons.map((pageNumber) => (
              <button
                type="button"
                key={pageNumber}
                className={pageNumber === currentPage ? "active" : ""}
                aria-label={`Страница ${pageNumber}`}
                aria-current={pageNumber === currentPage ? "page" : undefined}
                onClick={() => setPagination({ period, page: pageNumber })}
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              aria-label="Следующая страница"
              disabled={currentPage === pageCount}
              onClick={() =>
                setPagination({ period, page: currentPage + 1 })
              }
            >
              →
            </button>
          </nav>
        </footer>
      </section>
    </>
  );
}
