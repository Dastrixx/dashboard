# Локальная проверка фоновой синхронизации

Нужны Node.js не ниже 22.13 и Docker Desktop (Windows/macOS) либо Docker Engine с Compose (Linux). На Windows запускайте команды в PowerShell из корня проекта. Порт 5432 должен быть свободен.

## 1. PostgreSQL

```bash
docker compose -f compose.sync.yaml up -d
docker compose -f compose.sync.yaml ps
```

В PowerShell выполните **из корня проекта**:

```powershell
Test-Path .env
```

Если результат `False`, скопируйте готовую локальную конфигурацию:

```powershell
Copy-Item .env.sync.local.example .env
```

Если результат `True`, **не перезаписывайте существующий `.env`**. Откройте его через `notepad .env` и приведите перечисленные ниже переменные к локальным значениям (каждая переменная должна встречаться один раз). Для теста на фикстуре нужны:

```env
DATABASE_URL=postgres://dashboard:dashboard_local_only@127.0.0.1:5432/dashboard
ONEC_ODATA_URL=http://127.0.0.1:4100/odata/standard.odata
ONEC_USER=mock
ONEC_PASSWORD=mock
ONEC_PAGE_SIZE=25
SYNC_ONEC_PAGE_SIZE=1
SYNC_REPORTS_FROM_DB=true
SYNC_TIMEZONE=Asia/Almaty
```

Проверьте только наличие настройки, не выводя пароль в терминал:

```powershell
node --env-file-if-exists=.env -e "console.log('DATABASE_URL:', Boolean(process.env.DATABASE_URL))"
```

Должно вывести `DATABASE_URL: true`. Если `False`, миграция и worker не запустятся. Перед миграцией проверьте контейнер:

```powershell
docker compose -f compose.sync.yaml ps
```

Пароль `dashboard_local_only` предназначен только для локальной тестовой базы. При запуске на VDS создайте другой пароль и не публикуйте `.env`.

## 2. Миграция и фоновые процессы

```bash
npm ci
npm run db:migrate:sync
```

Откройте три терминала в корне проекта:

```bash
npm run dev:mock-onec
```

Если порт 4100 занят, сначала посмотрите, какой процесс его использует:

```powershell
Get-NetTCPConnection -LocalPort 4100 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Get-Process -Id $_.OwningProcess | Select-Object Id,ProcessName,Path }
```

Если это уже запущенный mock 1С, второй экземпляр не нужен. В остальных случаях используйте свободный порт, например 4101: в `.env` поменяйте `ONEC_ODATA_URL` на `http://127.0.0.1:4101/odata/standard.odata`, а в терминале mock выполните:

```powershell
$env:MOCK_ONEC_PORT='4101'
npm run dev:mock-onec
```

```bash
npm run sync:worker
```

```bash
npm run dev:full
```

Поставьте в очередь два тестовых дня:

```bash
npm run sync:range -- --from=2026-08-01 --to=2026-08-02
```

`sync:range` только ставит задачи в очередь. Worker должен вывести `completed fetched=1` для каждого дня. `sync:verify` теперь ждёт завершения (до 15 минут), а затем сверяет источник с БД. Посмотрите строки в базе:

```bash
docker compose -f compose.sync.yaml exec postgres psql -U dashboard -d dashboard -c "SELECT sync_date,status,records_count FROM sync_days ORDER BY sync_date"
docker compose -f compose.sync.yaml exec postgres psql -U dashboard -d dashboard -c "SELECT sync_date,source_id,net_amount FROM retail_reports ORDER BY sync_date"
npm run sync:verify -- --from=2026-08-01 --to=2026-08-02
```

API защищён авторизацией. Создайте локального пользователя через `npm run auth:create-user` и войдите в интерфейс `http://localhost:5173/login`. Затем откройте в той же вкладке `http://localhost:4000/api/sync/health` и `http://localhost:4000/api/dashboard/onec-reports?from=2026-08-01&to=2026-08-02&references=false`. Готовый диапазон вернёт HTTP 200 с двумя документами и `cache: postgres`.

Запрос за `2026-08-03` сперва вернёт HTTP 202, затем worker сохранит пустой день, и следующий запрос вернёт HTTP 200 с пустым `items`. Перезапуск `sync:worker` не должен терять очередь. Для выключения локальной базы: `docker compose -f compose.sync.yaml down`; для полного удаления тестовых данных дополнительно `-v`.

**Ограничение:** эта проверка охватывает только маршрут отчётов. Остальные маршруты пока работают с реальной 1С и не проверяются фикстурой. Не используйте эту инструкцию как подтверждение готовности всего dashboard.
