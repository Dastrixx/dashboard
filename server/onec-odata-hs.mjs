// Источник данных для дашборда: HTTP-сервис расширения 1С «dashboard»
// (/hs/dashboard/v1/...). Модуль отвечает на те же OData-запросы, которые
// делает код дашборда (Document_*, Catalog_*, Turnovers, Balance), но данные
// берёт из HTTP-сервиса. Логика дашборда при этом не меняется — меняется
// только транспорт в server/onec.mjs (включается переменной ONEC_HS_URL).
//
// HTTP-сервис по ТЗ отдаёт уже сгруппированные данные (продажи по дням,
// чеки по часам), поэтому документы ЧекККМ и ОтчетОРозничныхПродажах здесь
// собираются из этих сводок: суммы, количество чеков, продавцы и товары
// совпадают с 1С, а разбивка товаров по конкретным чекам — условная.
//
// Нагрузка на 1С: запросы строго по одному, повтор через 5 и 15 с,
// периоды кусками до 31 дня, справочники и закрытые периоды кэшируются.

import { createHash } from "node:crypto";

const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";
const PAGE_LIMIT = 5000;
const MAX_RANGE_DAYS = { sales: 31, returns: 31, checks: 31 };
const DEFAULT_RANGE_DAYS = 366;

export function odataHsEnabled() {
  return Boolean(process.env.ONEC_HS_URL);
}

function getConfig() {
  return {
    baseUrl: String(process.env.ONEC_HS_URL || "").replace(/\/+$/, ""),
    username: process.env.ONEC_USER,
    password: process.env.ONEC_PASSWORD,
    timeoutMs: Number(process.env.ONEC_HS_TIMEOUT_MS || 180_000),
    retryDelaysMs: String(process.env.ONEC_HS_RETRY_DELAYS_MS || "5000,15000")
      .split(",")
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= 0),
    referenceTtlMs: Number(process.env.ONEC_HS_REFERENCE_TTL_MS || 600_000),
    recentTtlMs: Number(process.env.ONEC_HS_RECENT_TTL_MS || 120_000),
    closedTtlMs: Number(process.env.ONEC_HS_CLOSED_PERIOD_TTL_MS || 21_600_000),
    // Сколько дней истории отдавать на запросы без фильтра по дате
    // (например, «последние документы» или перебор чеков постранично).
    historyDays: Math.max(Number(process.env.ONEC_HS_HISTORY_DAYS || 120), 7),
  };
}

// ---------------------------------------------------------------------------
// Транспорт: последовательная очередь + повторы.

let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class HsError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function requestOnce(resource, params) {
  const { baseUrl, username, password, timeoutMs } = getConfig();
  if (!baseUrl || !username || !password) {
    throw new HsError("Заполни ONEC_HS_URL, ONEC_USER и ONEC_PASSWORD в файле .env");
  }

  const url = new URL(`${baseUrl}/${resource}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  let response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      throw new HsError(`1С не ответила за ${Math.round(timeoutMs / 1000)} с (${resource})`);
    }
    throw new HsError(`HTTP-сервис 1С недоступен (${resource}): ${error?.cause?.code || error?.message || error}`);
  }

  const body = await response.text();
  let data = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    // не JSON — например, страница ошибки веб-сервера
  }
  if (!response.ok) {
    const details = data?.error || body.replace(/\s+/g, " ").trim().slice(0, 300);
    throw new HsError(`HTTP-сервис 1С вернул ${response.status} (${resource})${details ? `: ${details}` : ""}`, response.status);
  }
  if (!data || typeof data !== "object") {
    throw new HsError(`HTTP-сервис 1С вернул некорректный JSON (${resource})`);
  }
  return data;
}

function isRetryable(error) {
  return !error.status || error.status >= 500 || [408, 429].includes(error.status);
}

function hsGet(resource, params = {}) {
  return enqueue(async () => {
    const delays = getConfig().retryDelaysMs;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await requestOnce(resource, params);
      } catch (error) {
        if (attempt >= delays.length || !isRetryable(error)) throw error;
        console.warn(`${error.message}; повтор через ${delays[attempt] / 1000} с`);
        await sleep(delays[attempt]);
      }
    }
  });
}

async function hsGetAll(resource, params = {}) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_LIMIT) {
    const page = await hsGet(resource, { ...params, limit: PAGE_LIMIT, offset });
    rows.push(...(page.data || []));
    if (!page.data?.length || rows.length >= Number(page.total || 0)) break;
  }
  return rows;
}

const cache = new Map();

async function cached(key, ttlMs, load) {
  const now = Date.now();
  const entry = cache.get(key);
  if (entry && "value" in entry && entry.expiresAt > now) return entry.value;
  if (entry?.promise) return entry.promise;

  const promise = load();
  cache.set(key, { promise, expiresAt: now + ttlMs });
  try {
    const value = await promise;
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Даты. Все даты — дни 1С в виде строк ГГГГ-ММ-ДД (без часовых поясов).

function addDays(day, days) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

function todayInOnec() {
  // toOdataDateTime в дашборде переводит время в пояс 1С; здесь только
  // ограничиваем запросы «не позже завтрашнего дня», точность не важна.
  return addDays(new Date().toISOString().slice(0, 10), 1);
}

export function splitRange(from, to, maxDays) {
  const chunks = [];
  for (let start = from; start <= to; start = addDays(start, maxDays)) {
    const end = addDays(start, maxDays - 1);
    chunks.push([start, end < to ? end : to]);
  }
  return chunks;
}

async function loadRange(resource, from, to) {
  const { recentTtlMs, closedTtlMs } = getConfig();
  const today = todayInOnec();
  const rows = [];
  for (const [start, end] of splitRange(from, to, MAX_RANGE_DAYS[resource] || DEFAULT_RANGE_DAYS)) {
    const ttl = end < addDays(today, -2) ? closedTtlMs : recentTtlMs;
    rows.push(
      ...(await cached(`${resource}:${start}:${end}`, ttl, () =>
        hsGetAll(resource, { from: start, to: end }),
      )),
    );
  }
  return rows;
}

// Последний день с чеками: ищем назад от сегодняшнего окнами по 31 дню
// (в копии базы данные могут обрываться раньше сегодняшнего дня).
function latestDay() {
  return cached("latest-day", getConfig().recentTtlMs, async () => {
    let to = todayInOnec();
    for (let step = 0; step < 12; step += 1) {
      const from = addDays(to, -30);
      const rows = await loadRange("checks", from, to);
      if (rows.length) {
        return rows.reduce((latest, row) => (row.date > latest ? row.date : latest), "");
      }
      to = addDays(from, -1);
    }
    return todayInOnec();
  });
}

// ---------------------------------------------------------------------------
// Разбор OData-запроса.

const DATE_CONDITION = /\b(Date|Period)\s+(ge|gt|le|lt|eq)\s+datetime'(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})'/g;

function endDay(day, time, operator) {
  // «lt 2026-10-05T00:00:00» — последний включённый день 2026-10-04.
  return operator === "lt" && time === "00:00:00" ? addDays(day, -1) : day;
}

function parseFilter(filter) {
  const text = String(filter || "");
  const result = { from: null, to: null, reportKey: null, hasDate: false };
  for (const [, , operator, day, time] of text.matchAll(DATE_CONDITION)) {
    result.hasDate = true;
    if (operator === "ge" || operator === "gt" || operator === "eq") {
      if (!result.from || day > result.from) result.from = day;
    }
    if (operator === "le" || operator === "lt" || operator === "eq") {
      const last = endDay(day, time, operator);
      if (!result.to || last < result.to) result.to = last;
    }
  }
  const report = text.match(/ОтчетОРозничныхПродажах_Key\s+eq\s+guid'([0-9a-f-]{36})'/i);
  if (report) result.reportKey = report[1].toLowerCase();
  return result;
}

async function resolvePeriod({ from, to }) {
  const { historyDays } = getConfig();
  const latest = await latestDay();
  let last = to || latest;
  if (last > todayInOnec()) last = todayInOnec();
  let first = from || addDays(last, -(historyDays - 1));
  if (first < addDays(last, -400)) first = addDays(last, -400);
  return { from: first, to: last };
}

function parseFunctionArguments(text) {
  const args = {};
  for (const [, name, value] of text.matchAll(/(\w+)=('(?:[^']|'')*'|datetime'[^']*')/g)) {
    args[name] = value.startsWith("datetime")
      ? value.slice(9, -1)
      : value.slice(1, -1).replace(/''/g, "'");
  }
  return args;
}

function page(rows, params) {
  const skip = Math.max(Number(params.$skip) || 0, 0);
  const top = params.$top === undefined || params.$top === "" ? undefined : Math.max(Number(params.$top) || 0, 0);
  return rows.slice(skip, top === undefined ? undefined : skip + top);
}

// ---------------------------------------------------------------------------
// Синтетические ключи (детерминированные GUID).

function guid(...parts) {
  const hash = createHash("md5").update(parts.join("|")).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

const ONLINE_ORDER_KEY = guid("hs", "online-order");
const CERTIFICATE_PAYMENT_KEY = guid("hs", "payment", "certificate");
const CASH_PAYMENT_KEY = guid("hs", "payment", "cash");
const reportKey = (storeKey, day) => guid("hs", "retail-report", storeKey || "none", day);

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
const byDateDesc = (left, right) => (left.Date < right.Date ? 1 : left.Date > right.Date ? -1 : 0);

// ---------------------------------------------------------------------------
// Справочники в формате OData.

const WAREHOUSE_TYPES = { sales_floor: "ТорговыйЗал", storage: "СкладскоеПомещение" };

function references() {
  return cached("references", getConfig().referenceTtlMs, async () => {
    const products = await hsGetAll("products");
    const stores = await hsGetAll("stores");
    const sellers = await hsGetAll("sellers");
    const suppliers = await hsGetAll("suppliers");

    const kinds = new Map();
    const groups = new Map();
    for (const product of products) {
      if (product.kind_guid && !kinds.has(product.kind_guid)) {
        kinds.set(product.kind_guid, {
          Ref_Key: product.kind_guid,
          Description: product.kind_name || "",
          ТоварнаяГруппа_Key: product.kind_group_guid || EMPTY_GUID,
          ТоварнаяКатегория_Key: EMPTY_GUID,
        });
      }
      for (const [key, name] of [
        [product.group_guid, product.group_name],
        [product.kind_group_guid, product.kind_group_name],
      ]) {
        if (key && !groups.has(key)) {
          groups.set(key, { Ref_Key: key, Code: "", Description: name || "", Parent_Key: EMPTY_GUID, IsFolder: false });
        }
      }
    }

    const storeMap = new Map();
    const warehouseMap = new Map();
    for (const row of stores) {
      if (row.store_guid && !storeMap.has(row.store_guid)) {
        storeMap.set(row.store_guid, {
          Ref_Key: row.store_guid,
          Code: row.store_code || "",
          Description: row.store_name || "",
          DeletionMark: false,
        });
      }
      if (row.warehouse_guid) {
        warehouseMap.set(row.warehouse_guid, {
          Ref_Key: row.warehouse_guid,
          Code: row.warehouse_code || "",
          Description: row.warehouse_name || "",
          ТипСклада: WAREHOUSE_TYPES[row.warehouse_type] || "",
          Магазин_Key: row.store_guid || EMPTY_GUID,
          DeletionMark: Boolean(row.deleted),
        });
      }
    }

    return {
      Catalog_Номенклатура: new Map(
        products.map((product) => [
          product.guid,
          {
            Ref_Key: product.guid,
            Code: product.code || "",
            Description: product.name || "",
            НаименованиеПолное: product.full_name || "",
            Артикул: product.article || "",
            Parent_Key: product.parent_guid || EMPTY_GUID,
            IsFolder: Boolean(product.is_group),
            DeletionMark: Boolean(product.deleted),
            ВидНоменклатуры_Key: product.kind_guid || EMPTY_GUID,
            ТоварнаяГруппа_Key: product.group_guid || EMPTY_GUID,
            ТоварнаяКатегория_Key: EMPTY_GUID,
          },
        ]),
      ),
      Catalog_ВидыНоменклатуры: kinds,
      Catalog_ТоварныеГруппы: groups,
      Catalog_Магазины: storeMap,
      Catalog_Склады: warehouseMap,
      Catalog_ФизическиеЛица: new Map(
        sellers.map((seller) => [
          seller.guid,
          {
            Ref_Key: seller.guid,
            Description: seller.name || "",
            Сотрудник: Boolean(seller.is_employee),
            Магазин_Key: seller.store_guid || EMPTY_GUID,
            DeletionMark: Boolean(seller.deleted),
          },
        ]),
      ),
      Catalog_Контрагенты: new Map(
        suppliers.map((supplier) => [
          supplier.guid,
          {
            Ref_Key: supplier.guid,
            Code: supplier.code || "",
            Description: supplier.name || "",
            НаименованиеПолное: supplier.name || "",
            DeletionMark: Boolean(supplier.deleted),
          },
        ]),
      ),
      Catalog_ВидыОплатЧекаККМ: new Map([
        [CASH_PAYMENT_KEY, { Ref_Key: CASH_PAYMENT_KEY, Description: "Наличные и прочие оплаты", ТипОплаты: "Наличные" }],
        [CERTIFICATE_PAYMENT_KEY, { Ref_Key: CERTIFICATE_PAYMENT_KEY, Description: "Подарочный сертификат", ТипОплаты: "ПодарочныйСертификат" }],
      ]),
    };
  });
}

// ---------------------------------------------------------------------------
// Документы продаж за период: отчёты о розничных продажах (магазин × день)
// и чеки, восстановленные из часовых сводок.

function salesLine(row, index, sign) {
  const quantity = Number(row.qty || 0);
  const amount = Number(row.sum || 0);
  const discount = Number(row.discount || 0);
  const full = amount + discount;
  return {
    LineNumber: String(index + 1),
    Номенклатура_Key: row.product_guid || EMPTY_GUID,
    Характеристика_Key: EMPTY_GUID,
    Склад_Key: row.warehouse_guid || EMPTY_GUID,
    Продавец_Key: row.seller_guid || EMPTY_GUID,
    ЗаказПокупателя_Key: row.online ? ONLINE_ORDER_KEY : EMPTY_GUID,
    Количество: quantity,
    Цена: quantity ? round2(full / quantity) : round2(full),
    Сумма: round2(amount),
    СуммаАвтоматическойСкидки: 0,
    СуммаРучнойСкидки: round2(discount),
    СуммаСкидкиОплатыБонусом: 0,
    ор_Себестоимость: round2(row.cost),
    _sign: sign,
  };
}

function stripLine({ _sign, ...line }) {
  return line;
}

function splitAmount(total, count) {
  const parts = [];
  const each = round2(total / count);
  for (let index = 0; index < count; index += 1) {
    parts.push(index === count - 1 ? round2(total - each * (count - 1)) : each);
  }
  return parts;
}

function buildDocuments(sales, returns, checkRows) {
  // Отчёты о розничных продажах: один на магазин и день.
  const reports = new Map();
  const reportFor = (storeKey, day) => {
    const key = `${storeKey || ""}:${day}`;
    if (!reports.has(key)) {
      reports.set(key, {
        Ref_Key: reportKey(storeKey, day),
        Number: `HS-${day.replace(/-/g, "")}`,
        Date: `${day}T23:00:00`,
        Posted: true,
        DeletionMark: false,
        СуммаДокумента: 0,
        СуммаВозвратов: 0,
        Магазин_Key: storeKey || EMPTY_GUID,
        КассаККМ_Key: EMPTY_GUID,
        Товары: [],
        ВозвращенныеТовары: [],
      });
    }
    return reports.get(key);
  };
  for (const row of sales) {
    const report = reportFor(row.store_guid, row.date);
    report.Товары.push(stripLine(salesLine(row, report.Товары.length, 1)));
    report.СуммаДокумента += Number(row.sum || 0);
  }
  for (const row of returns) {
    const report = reportFor(row.store_guid, row.date);
    report.ВозвращенныеТовары.push(stripLine(salesLine(row, report.ВозвращенныеТовары.length, -1)));
    report.СуммаВозвратов += Number(row.sum || 0);
  }

  // Чеки: количество и суммы — из часовых сводок (checks), товары
  // распределяются по чекам того же магазина и дня по кругу.
  const checks = [];
  const byStoreDay = new Map();
  const groupFor = (storeKey, day) => {
    const key = `${storeKey || ""}:${day}`;
    if (!byStoreDay.has(key)) byStoreDay.set(key, { sale: [], return: [], storeKey, day });
    return byStoreDay.get(key);
  };

  for (const row of checkRows) {
    const hour = String(row.hour ?? 12).padStart(2, "0");
    const group = groupFor(row.store_guid, row.date);
    for (const [kind, count, total] of [
      ["sale", Number(row.sale_checks || 0), Number(row.sales_sum || 0)],
      ["return", Number(row.return_checks || 0), Number(row.returns_sum || 0)],
    ]) {
      if (count <= 0) continue;
      const amounts = splitAmount(Math.abs(total), count);
      for (let index = 0; index < count; index += 1) {
        const check = {
          Ref_Key: guid("hs", "check", row.date, hour, row.store_guid, row.seller_guid, kind, index),
          Number: "",
          Date: `${row.date}T${hour}:${String(Math.min(59, Math.floor((index * 60) / count))).padStart(2, "0")}:00`,
          DeletionMark: false,
          Posted: true,
          ОтчетОРозничныхПродажах_Key: reportKey(row.store_guid, row.date),
          СтатусЧекаККМ: "Пробитый",
          ВидОперации: kind === "sale" ? "Продажа" : "Возврат",
          Магазин_Key: row.store_guid || EMPTY_GUID,
          Продавец_Key: row.seller_guid || EMPTY_GUID,
          Ответственный_Key: EMPTY_GUID,
          КассаККМ_Key: EMPTY_GUID,
          НомерСменыККМ: 0,
          ЗаказПокупателя_Key: EMPTY_GUID,
          СуммаДокумента: amounts[index],
          Товары: [],
          Оплата: [],
          ПогашениеПодарочныхСертификатов: [],
        };
        if (kind === "sale" && index === 0) {
          const certificate = Number(row.certificate_payment_sum || 0);
          if (certificate > 0) {
            check.Оплата.push({ LineNumber: "1", ВидОплаты_Key: CERTIFICATE_PAYMENT_KEY, Сумма: round2(certificate) });
          }
          const redeemed = Number(row.certificates_redeemed || 0);
          for (let item = 0; item < redeemed; item += 1) {
            check.ПогашениеПодарочныхСертификатов.push({ LineNumber: String(item + 1), Количество: 1 });
          }
        }
        group[kind].push(check);
        checks.push(check);
      }
    }
  }

  const distribute = (rows, kind, sign) => {
    const lines = new Map();
    for (const row of rows) {
      const key = `${row.store_guid || ""}:${row.date}`;
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push(row);
    }
    for (const [key, groupRows] of lines) {
      const [storeKey, day] = [groupRows[0].store_guid, groupRows[0].date];
      const group = byStoreDay.get(key) || groupFor(storeKey, day);
      if (!group[kind].length) {
        // Строки регистра есть, а сводки чеков нет — один условный чек.
        const check = {
          Ref_Key: guid("hs", "check", day, "fallback", storeKey, kind),
          Number: "",
          Date: `${day}T12:00:00`,
          DeletionMark: false,
          Posted: true,
          ОтчетОРозничныхПродажах_Key: reportKey(storeKey, day),
          СтатусЧекаККМ: "Пробитый",
          ВидОперации: kind === "sale" ? "Продажа" : "Возврат",
          Магазин_Key: storeKey || EMPTY_GUID,
          Продавец_Key: groupRows[0].seller_guid || EMPTY_GUID,
          Ответственный_Key: EMPTY_GUID,
          КассаККМ_Key: EMPTY_GUID,
          НомерСменыККМ: 0,
          ЗаказПокупателя_Key: EMPTY_GUID,
          СуммаДокумента: round2(groupRows.reduce((sum, row) => sum + Number(row.sum || 0), 0)),
          Товары: [],
          Оплата: [],
          ПогашениеПодарочныхСертификатов: [],
        };
        group[kind].push(check);
        checks.push(check);
      }
      groupRows.forEach((row, index) => {
        const check = group[kind][index % group[kind].length];
        check.Товары.push(salesLine(row, check.Товары.length, sign));
      });
    }
  };
  distribute(sales, "sale", 1);
  distribute(returns, "return", -1);

  // Движения регистра «Продажи» (для Turnovers и RecordType).
  // С версии 1.2.0 сервиса ресурс sales — это сам регистр «Продажи», уже за
  // вычетом возвратов, поэтому строки чеков возврата в движения не идут.
  const movements = [];
  for (const check of checks) {
    check.Товары.forEach((line, index) => {
      if (line._sign < 0) return;
      movements.push({
        Recorder: check.Ref_Key,
        Recorder_Type: "StandardODATA.Document_ЧекККМ",
        LineNumber: String(index + 1),
        Period: check.Date,
        Active: true,
        Магазин_Key: check.Магазин_Key,
        ДокументПродажи: check.Ref_Key,
        ДокументПродажи_Type: "StandardODATA.Document_ЧекККМ",
        sign: line._sign,
        line,
      });
    });
    check.Товары = check.Товары.map(stripLine);
  }

  return {
    reports: [...reports.values()]
      .map((report) => ({
        ...report,
        СуммаДокумента: round2(report.СуммаДокумента),
        СуммаВозвратов: round2(report.СуммаВозвратов),
      }))
      .sort(byDateDesc),
    checks: checks.sort(byDateDesc),
    movements,
  };
}

function documentsForPeriod(from, to) {
  const { recentTtlMs, closedTtlMs } = getConfig();
  const ttl = to < addDays(todayInOnec(), -2) ? closedTtlMs : recentTtlMs;
  return cached(`documents:${from}:${to}`, ttl, async () => {
    const sales = await loadRange("sales", from, to);
    const returns = await loadRange("returns", from, to);
    const checks = await loadRange("checks", from, to);
    return buildDocuments(sales, returns, checks);
  });
}

// ---------------------------------------------------------------------------
// Складские документы.

function groupDocuments(rows, mapDocument, mapLine) {
  const documents = new Map();
  for (const row of rows) {
    if (!documents.has(row.document_guid)) {
      documents.set(row.document_guid, { ...mapDocument(row), Товары: [] });
    }
    const document = documents.get(row.document_guid);
    document.Товары.push({ LineNumber: String(document.Товары.length + 1), ...mapLine(row) });
  }
  return [...documents.values()].sort(byDateDesc);
}

const WAREHOUSE_DOCUMENTS = {
  Document_ПоступлениеТоваров: async (from, to) =>
    groupDocuments(
      await loadRange("receipts", from, to),
      (row) => ({
        Ref_Key: row.document_guid,
        Number: row.number || "",
        Date: `${row.date}T12:00:00`,
        Posted: true,
        DeletionMark: false,
        Склад_Key: row.warehouse_guid || EMPTY_GUID,
        Контрагент_Key: row.supplier_guid || EMPTY_GUID,
      }),
      (row) => ({
        Номенклатура_Key: row.product_guid,
        Количество: Number(row.qty || 0),
        Сумма: round2(row.sum),
      }),
    ).map((document) => ({
      ...document,
      СуммаДокумента: round2(document.Товары.reduce((sum, line) => sum + line.Сумма, 0)),
    })),
  Document_СписаниеТоваров: async (from, to) =>
    groupDocuments(
      await loadRange("writeoffs", from, to),
      (row) => ({
        Ref_Key: row.document_guid,
        Number: row.number || "",
        Date: `${row.date}T12:00:00`,
        Posted: true,
        DeletionMark: false,
        Склад_Key: row.warehouse_guid || EMPTY_GUID,
        ОснованиеСписания: row.reason || "",
        Комментарий: "",
      }),
      (row) => ({ Номенклатура_Key: row.product_guid, Количество: Number(row.qty || 0) }),
    ),
  Document_ПересчетТоваров: async (from, to) =>
    groupDocuments(
      (await loadRange("recounts", from, to)).filter((row) => row.posted),
      (row) => ({
        Ref_Key: row.document_guid,
        Number: row.number || "",
        Date: `${row.date}T12:00:00`,
        Posted: true,
        DeletionMark: false,
        Склад_Key: row.warehouse_guid || EMPTY_GUID,
        Статус: row.status || "",
      }),
      (row) => ({
        Номенклатура_Key: row.product_guid,
        Количество: Number(row.qty_book || 0),
        КоличествоФакт: Number(row.qty_fact || 0),
      }),
    ),
};

// ---------------------------------------------------------------------------
// Регистры.

const TURNOVER_DIMENSIONS = {
  Магазин: (movement) => ({ Магазин_Key: movement.Магазин_Key }),
  Склад: (movement) => ({ Склад_Key: movement.line.Склад_Key }),
  Номенклатура: (movement) => ({ Номенклатура_Key: movement.line.Номенклатура_Key }),
  Характеристика: () => ({ Характеристика_Key: EMPTY_GUID }),
  Продавец: (movement) => ({ Продавец_Key: movement.line.Продавец_Key }),
  ЗаказПокупателя: (movement) => ({ ЗаказПокупателя_Key: movement.line.ЗаказПокупателя_Key }),
  ДокументПродажи: (movement) => ({
    ДокументПродажи: movement.ДокументПродажи,
    ДокументПродажи_Type: movement.ДокументПродажи_Type,
  }),
};

function periodFromArguments(start, end) {
  const [startDay] = String(start || "").split("T");
  const [endDayText, endTime = "23:59:59"] = String(end || "").split("T");
  return {
    from: /^\d{4}-\d{2}-\d{2}$/.test(startDay) ? startDay : null,
    to: /^\d{4}-\d{2}-\d{2}$/.test(endDayText) ? endDay(endDayText, endTime, "lt") : null,
  };
}

async function salesTurnovers(args) {
  const period = await resolvePeriod(periodFromArguments(args.StartPeriod, args.EndPeriod));
  if (period.from > period.to) return [];
  const { movements } = await documentsForPeriod(period.from, period.to);
  const dimensions = String(args.Dimensions || "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => TURNOVER_DIMENSIONS[name]);

  const grouped = new Map();
  for (const movement of movements) {
    const keyFields = Object.assign({}, ...dimensions.map((name) => TURNOVER_DIMENSIONS[name](movement)));
    const key = JSON.stringify(keyFields);
    const current = grouped.get(key) || {
      ...keyFields,
      КоличествоTurnover: 0,
      СтоимостьTurnover: 0,
      СтоимостьБезСкидокTurnover: 0,
      ор_СебестоимостьTurnover: 0,
    };
    const { line, sign } = movement;
    current.КоличествоTurnover += sign * line.Количество;
    current.СтоимостьTurnover += sign * line.Сумма;
    current.СтоимостьБезСкидокTurnover += sign * (line.Сумма + line.СуммаРучнойСкидки);
    current.ор_СебестоимостьTurnover += sign * line.ор_Себестоимость;
    grouped.set(key, current);
  }
  return [...grouped.values()].map((row) => ({
    ...row,
    КоличествоTurnover: round2(row.КоличествоTurnover),
    СтоимостьTurnover: round2(row.СтоимостьTurnover),
    СтоимостьБезСкидокTurnover: round2(row.СтоимостьБезСкидокTurnover),
    ор_СебестоимостьTurnover: round2(row.ор_СебестоимостьTurnover),
  }));
}

async function salesRecords(filter) {
  if (!filter.hasDate) {
    // Запрос «последние движения» — нужна только дата активности.
    const latest = await latestDay();
    return Array.from({ length: 20 }, () => ({ Period: `${latest}T23:00:00`, Active: true }));
  }
  const period = await resolvePeriod(filter);
  if (period.from > period.to) return [];
  const { movements } = await documentsForPeriod(period.from, period.to);
  return movements.map(({ line, sign, ДокументПродажи, ДокументПродажи_Type, ...movement }) => ({
    ...movement,
    Склад_Key: line.Склад_Key,
    Номенклатура_Key: line.Номенклатура_Key,
    Характеристика_Key: EMPTY_GUID,
    Продавец_Key: line.Продавец_Key,
    ЗаказПокупателя_Key: line.ЗаказПокупателя_Key,
    ДокументПродажи,
    ДокументПродажи_Type,
    Количество: sign * line.Количество,
    Стоимость: sign * line.Сумма,
    СтоимостьБезСкидок: sign * (line.Сумма + line.СуммаРучнойСкидки),
    ор_Себестоимость: sign * line.ор_Себестоимость,
  }));
}

async function stockBalance(args) {
  const [day] = String(args.Period || "").split("T");
  const params = /^\d{4}-\d{2}-\d{2}$/.test(day) && day < addDays(todayInOnec(), -1) ? { date: day } : {};
  const rows = await cached(`stock:${params.date || "now"}`, getConfig().recentTtlMs, () => hsGetAll("stock", params));
  return rows.map((row) => ({
    Склад_Key: row.warehouse_guid,
    Номенклатура_Key: row.product_guid,
    Характеристика_Key: EMPTY_GUID,
    КоличествоBalance: Number(row.qty || 0),
    РезервBalance: Number(row.reserve || 0),
    ор_СебестоимостьBalance: round2(row.cost),
  }));
}

// ---------------------------------------------------------------------------
// Точка входа: аналог onecRequest(path, params) из server/onec.mjs.

const unsupported = new Set();

function warnUnsupported(path) {
  const name = path.split(/[(/]/)[0];
  if (!unsupported.has(name)) {
    unsupported.add(name);
    console.warn(`HTTP-сервис 1С: ${name} не публикуется, отдаём пустой список`);
  }
  return [];
}

export async function odataHsRequest(path, params = {}) {
  const normalizedPath = decodeURIComponent(String(path).replace(/^\/+/, ""));

  if (normalizedPath === "$metadata") {
    throw new Error("Метаданные OData недоступны: дашборд подключён к HTTP-сервису 1С");
  }

  // Catalog_X(guid'...')
  const byKey = normalizedPath.match(/^(Catalog_[\p{L}\p{N}_]+)\(guid'([0-9a-f-]{36})'\)$/iu);
  if (byKey) {
    const refs = await references();
    const item = refs[byKey[1]]?.get(byKey[2].toLowerCase()) || refs[byKey[1]]?.get(byKey[2]);
    if (!item) throw new Error(`${byKey[1]}: запись ${byKey[2]} не найдена в HTTP-сервисе 1С`);
    return { ...item };
  }

  // Регистр/Turnovers(...), Регистр/Balance(...)
  const virtualTable = normalizedPath.match(/^(AccumulationRegister_[\p{L}\p{N}_]+)\/(Turnovers|Balance)\((.*)\)$/u);
  if (virtualTable) {
    const [, register, table, argsText] = virtualTable;
    const args = parseFunctionArguments(argsText);
    if (register === "AccumulationRegister_Продажи" && table === "Turnovers") {
      return page(await salesTurnovers(args), params);
    }
    if (register === "AccumulationRegister_ТоварыНаСкладах" && table === "Balance") {
      return page(await stockBalance(args), params);
    }
    return warnUnsupported(normalizedPath);
  }

  if (!/^[\p{L}\p{N}_]+$/u.test(normalizedPath)) {
    return warnUnsupported(normalizedPath);
  }

  const filter = parseFilter(params.$filter);

  if (normalizedPath.startsWith("Catalog_")) {
    const refs = await references();
    const map = refs[normalizedPath];
    if (!map) return warnUnsupported(normalizedPath);
    const items = [...map.values()].map((item) => ({ ...item }));
    if (String(params.$orderby || "").startsWith("Description")) {
      items.sort((left, right) => String(left.Description).localeCompare(String(right.Description), "ru"));
    }
    return page(items, params);
  }

  if (normalizedPath === "Document_ОтчетОРозничныхПродажах" || normalizedPath === "Document_ЧекККМ") {
    const period = await resolvePeriod(filter);
    if (period.from > period.to) return [];
    const documents = await documentsForPeriod(period.from, period.to);
    let rows = normalizedPath === "Document_ЧекККМ" ? documents.checks : documents.reports;
    if (filter.reportKey) {
      rows = rows.filter((row) => row.ОтчетОРозничныхПродажах_Key === filter.reportKey);
    }
    return page(rows, params);
  }

  if (WAREHOUSE_DOCUMENTS[normalizedPath]) {
    const period = await resolvePeriod(filter);
    if (period.from > period.to) return [];
    return page(await WAREHOUSE_DOCUMENTS[normalizedPath](period.from, period.to), params);
  }

  if (normalizedPath === "AccumulationRegister_Продажи_RecordType") {
    return page(await salesRecords(filter), params);
  }

  return warnUnsupported(normalizedPath);
}

// Для тестов.
export const __test = { buildDocuments, parseFilter, periodFromArguments, parseFunctionArguments, salesTurnovers };
