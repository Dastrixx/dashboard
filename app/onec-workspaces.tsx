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
          `${API_URL}/api/dashboard/onec-reports?top=${period}&references=false`,
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
  return (
    <MissingSource
      title="Склад и остатки"
      description="Раздел ожидает текущие остатки из регистра накопления"
      source="Нужно подключить виртуальную таблицу AccumulationRegister_ТоварыНаСкладах/Balance. Обычные движения регистра не используются как текущий остаток."
    />
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
