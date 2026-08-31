import { money } from "./format";
import type { OwnerCategory } from "./types";

export function CategorySales({
  categories,
  loading,
  error,
}: {
  categories: OwnerCategory[];
  loading: boolean;
  error: string;
}) {
  const maximum = Math.max(...categories.map((category) => category.revenue), 1);

  return (
    <article className="panel owner-category-panel">
      <div className="owner-panel-head">
        <div>
          <span className="onec-source-kicker">Структура продаж</span>
          <h2>Продажи по категориям</h2>
          <p>Доля категории в выручке периода</p>
        </div>
      </div>

      {loading ? (
        <div className="owner-category-state">
          <span className="onec-spinner" />
          <span>Определяем категории товаров…</span>
        </div>
      ) : error ? (
        <div className="owner-category-state error">
          <strong>Продажи загружены, категории временно недоступны</strong>
          <span>{error}</span>
        </div>
      ) : categories.length ? (
        <div className="owner-category-list">
          {categories.map((category) => (
            <div className="owner-category-row" key={category.label}>
              <div>
                <strong>{category.label}</strong>
                <b>{money.format(category.revenue)}</b>
              </div>
              <span>{category.share.toFixed(1)}% выручки</span>
              <i>
                <em
                  style={{ width: `${(category.revenue / maximum) * 100}%` }}
                />
              </i>
            </div>
          ))}
        </div>
      ) : (
        <p className="onec-no-data">
          В карточках проданных товаров категории пока не заполнены
        </p>
      )}
    </article>
  );
}
