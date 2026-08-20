# Дашборд аналитики продаж

Полный проект на React и Node.js. Интерфейс и API запускаются отдельно. Рабочие
экраны получают продажи, остатки, товары, склады и сотрудников через OData 1С.

## Стек

- React 19 + TypeScript
- Vinext/Vite
- Node.js + Express
- адаптивный CSS без UI-библиотеки

## Запуск

Нужен Node.js 22+.

```bash
npm install
npm run dev:full
```

Файл `.env` для первого запуска не обязателен. Если нужно изменить порты,
скопируй `.env.example` в `.env`. В Windows это можно сделать командой:

```powershell
Copy-Item .env.example .env
```

Папка `.openai` относится только к размещению демо-версии и для локального
запуска не нужна.

После запуска интерфейс обычно доступен на `http://localhost:5173`, а API —
на `http://localhost:4000`.

Можно запустить части отдельно:

```bash
npm run dev:client
npm run dev:server
```

## Структура

```text
app/
  dashboard.tsx          навигация и оболочка дашборда
  dashboard-data.ts      типы и резервные демонстрационные данные
  onec-workspaces.tsx    стабильная точка экспорта экранов 1С
  onec-sales.tsx         стабильная точка экспорта аналитики товаров
  onec/
    types.ts             типы ответов API и сущностей 1С
    shared.tsx           API URL, форматтеры и общие состояния
    overview.tsx         обзор продаж
    stock.tsx            склады, остатки и складские операции
    team.tsx             продавцы и консультанты
    procurement.tsx      экран закупа и перемещений
    sales/
      index.tsx           компоновка экрана «Товары и продажи»
      types.ts            типы продаж, чеков и справочников
      config.ts           периоды, форматтеры и URL API
      hooks.ts            загрузка отчётов, справочников и чеков
      analytics.ts        чистые формулы продаж, ABC и CSV
      overview.tsx        KPI, фильтр периода и графики выручки
      check-analytics-panel.tsx
                          чеки, средний чек, скидки и сертификаты
      product-ranking.tsx топ и антитоп товаров
      abc-analysis.tsx    ABC-сводка, поиск и пагинация
  globals.css            дизайн-система и адаптивные стили
server/
  index.mjs              Express-маршруты и orchestration
  onec.mjs               низкоуровневый клиент OData 1С
  dashboard/
    constants.mjs        имена сущностей, GUID и бизнес-категории
    utils.mjs            чистые функции дат и категоризации
    checks.mjs           загрузка и агрегация чеков 1С
  data.mjs               резервные демонстрационные данные
```

## API

- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/products?search=&category=`
- `GET /api/sellers`
- `POST /api/replenishment-requests`
- `GET /api/dashboard/onec-reports?top=&days=`
- `GET /api/dashboard/onec-check-analytics?days=1|7|30`
- `GET /api/dashboard/onec-stock?top=`
- `GET /api/dashboard/onec-sellers?days=`
- `GET /api/dashboard/onec-consultants?days=`

Доступ к 1С настраивается только на Node.js-сервере:

```env
ONEC_ODATA_URL=http://host/base/ru_RU/odata/standard.odata
ONEC_USER=odata.user
ONEC_PASSWORD=secret
```

Логин и пароль 1С не передаются в клиентский React-код.

Перед коммитом рекомендуется выполнить:

```bash
npm run typecheck
npm run lint
npm run build
```

Логика порога складской заявки сейчас находится в `locationMetrics` внутри
`app/dashboard.tsx`. Товар попадает в заявку при остатке не более 50% от
исходного запаса. Это место можно заменить будущим прогнозом на основе истории
продаж по дням, неделям и месяцам.

## Роли и права

- `owner` — один персональный аккаунт владельца; доступ только к вкладке «Обзор».
- `manager` — отдельный логин для каждого руководителя; одинаковый набор
  экранов: «Товары и продажи», «Склад и остатки», «Продавцы»,
  «Закуп / Перемещение» и будущий раздел «Онлайн».
# dashboard
