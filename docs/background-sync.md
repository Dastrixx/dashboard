# Фоновая синхронизация 1С: первый этап — отчёты о продажах

На этом этапе PostgreSQL хранит документы `Document_ОтчетОРозничныхПродажах` и их строки. Отдельный worker последовательно загружает дни из 1С, сохраняет покрытие и задачи в БД. `GET /api/dashboard/onec-reports?from=...&to=...&references=false` может читать локальную БД при `SYNC_REPORTS_FROM_DB=true`. Для отсутствующих дат он возвращает HTTP 202, а React повторяет запрос с интервалом 3 секунды. После четырёх неудачных попыток возвращается 503 с кнопкой «Повторить».

**Не включайте переключатель для всей production панели:** `references=only`, чеки, маржа, остатки, продавцы и категории всё ещё обращаются к 1С. Они требуют собственной миграции входных сущностей, сверки расчётов и проверки августовских чеков. Этот этап не решает 502 для этих маршрутов. Текущий production flow сохраняется при `SYNC_REPORTS_FROM_DB=false`.

## Установка на Ubuntu/VDS

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres createuser --pwprompt dashboard
sudo -u postgres createdb --owner=dashboard dashboard
cd /path/to/dashboard
npm ci
```

В `.env` добавьте `DATABASE_URL=postgres://dashboard:<password>@127.0.0.1:5432/dashboard`, `SYNC_TIMEZONE=Asia/Almaty`, существующие `ONEC_*`. Пароль с символами `@`, `:` или `/` закодируйте как URL component. Миграция идемпотентна:

```bash
npm run db:migrate:sync
npm run sync:initial
pm2 start ecosystem.sync.config.cjs
pm2 save
```

`sync:initial` ставит в очередь три завершённых месяца и текущий (например 1 июня — 26 сентября). Задачи остаются в PostgreSQL после рестарта. Одновременно работает один worker: он удерживает PostgreSQL advisory lock, следующий процесс не начнёт параллельную загрузку. Worker каждый день после 05:00 `Asia/Almaty` ставит на повторную загрузку последние восемь календарных дат, включая сегодня. Отдельный системный cron не требуется.

Ручная постановка диапазона:

```bash
npm run sync:range -- --from=2026-08-01 --to=2026-08-31
npm run sync:range -- --from=2026-08-01 --to=2026-08-31 --refresh
npm run sync:daily
pm2 logs dashboard-sync-worker --lines 100
```

`sync:range` переоткрывает только отсутствующие и неудачные дни; `sync:daily` обновляет готовые дни. Worker запрашивает документы целыми днями, страницами по 50, с ограничением времени из `ONEC_TIMEOUT_MS`; нагрузка на 1С последовательная. При успешной транзакции он заменяет полный набор за день, включая отменённые и удалённые документы. API показывает только `Posted=true` и `DeletionMark=false`. Если документ перенесён на другой день, он удаляется по `source_id` при обработке нового дня. Для старой даты вне rolling window потребуется `sync:daily` для затронутого дня или отдельная команда обновления диапазона.

## Проверка и включение для одного маршрута

Авторизуйтесь в панели и сохраните cookie сессии в файл, например `curl -c /tmp/dashboard.cookies -X POST .../api/auth/login ...`. Не записывайте cookie в репозиторий. Затем:

```bash
curl -b /tmp/dashboard.cookies 'http://127.0.0.1:4000/api/sync/health'
curl -b /tmp/dashboard.cookies 'http://127.0.0.1:4000/api/sync/status?from=2026-08-01&to=2026-08-31'
```

Дождитесь `ready` для тестового диапазона, сверьте число документов, сумму и строковые позиции с 1С. Только после сверки временно включите `SYNC_REPORTS_FROM_DB=true` в `.env` и перезапустите API через `pm2 restart dashboard-api --update-env`; сборка React не нужна. Проверка:

```bash
curl -i -b /tmp/dashboard.cookies 'http://127.0.0.1:4000/api/dashboard/onec-reports?from=2026-08-01&to=2026-08-31&references=false'
curl -i -b /tmp/dashboard.cookies 'http://127.0.0.1:4000/api/dashboard/onec-reports?from=2026-03-01&to=2026-03-31&references=false'
```

Первый запрос должен вернуть 200 из PostgreSQL, второй — 202 и поставить фоновую задачу. При недоступности 1С уже готовые дни читаются из БД, но остальные endpoints первого этапа зависят от 1С. После изменений кода: `npm ci && npm run build && pm2 restart dashboard-api dashboard-web dashboard-sync-worker --update-env`.

Rollback: верните `SYNC_REPORTS_FROM_DB=false`, выполните `pm2 restart dashboard-api --update-env`. Очередь и таблицы можно оставить; старый API маршрут продолжит использовать прежнюю логику. Не удаляйте данные PostgreSQL, пока не завершена сверка.
