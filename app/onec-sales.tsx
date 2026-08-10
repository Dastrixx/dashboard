import { useEffect, useState } from "react";

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

type OnecResponse = {
  items: OnecRetailReport[];
};

const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:4000"
).replace(/\/$/, "");

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadReports() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          `${API_URL}/api/onec/retail-reports?top=1`,
          { signal: controller.signal },
        );

        const data = (await response.json()) as
          | OnecResponse
          | { message?: string };

        if (!response.ok) {
          throw new Error(
            "message" in data ? data.message : "Ошибка получения данных",
          );
        }

        setReports((data as OnecResponse).items);
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

  if (loading) {
    return (
      <section className="onec-card">
        <p>Получаем данные из 1С…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="onec-card onec-error">
        <strong>Не удалось получить данные 1С</strong>
        <p>{error}</p>
      </section>
    );
  }

  if (!reports.length) {
    return (
      <section className="onec-card">
        <p>В 1С не найдено отчётов о розничных продажах.</p>
      </section>
    );
  }

  return (
    <div className="onec-reports">
      {reports.map((report) => (
        <section className="onec-card" key={report.Ref_Key}>
          <header className="onec-header">
            <div>
              <span className="onec-label">Документ 1С</span>
              <h2>Отчёт №{report.Number}</h2>
              <p>{date.format(new Date(report.Date))}</p>
            </div>

            <div className="onec-document-values">
              <div>
                <span>Сумма документа</span>
                <strong>{money.format(report.СуммаДокумента)}</strong>
              </div>

              <div>
                <span>Возвраты</span>
                <strong>{money.format(report.СуммаВозвратов)}</strong>
              </div>
            </div>
          </header>

          <div className="onec-table-wrap">
            <table className="onec-table">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Номенклатура</th>
                  <th>Количество</th>
                  <th>Цена</th>
                  <th>Сумма</th>
                  <th>Склад</th>
                  <th>Продавец</th>
                </tr>
              </thead>

              <tbody>
                {report.Товары.map((item) => (
                  <tr key={`${report.Ref_Key}-${item.LineNumber}`}>
                    <td>{item.LineNumber}</td>
                    <td>
                      <code>{item.Номенклатура_Key}</code>
                    </td>
                    <td>{item.Количество}</td>
                    <td>{money.format(item.Цена)}</td>
                    <td>{money.format(item.Сумма)}</td>
                    <td>
                      <code>{item.Склад_Key}</code>
                    </td>
                    <td>
                      {item.Продавец_Key ===
                      "00000000-0000-0000-0000-000000000000"
                        ? "Не указан"
                        : item.Продавец_Key}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
