import { createHash } from 'node:crypto';
import { onecBalance, onecGet, onecSliceLast } from '../onec.mjs';
import { parseOnecDateTime } from '../dashboard/utils.mjs';
import { addDays } from './ranges.mjs';
import { CATALOG_SOURCES, DATED_SOURCES, SNAPSHOT_SOURCES } from './sources.mjs';
import { ascendingStartOffset } from './seek.mjs';

const MAX_PAGES = 2000;
const monthCache = new Map();
// A legacy local configuration used page size 1. Large real-world months then
// needed thousands of HTTP requests and could hit MAX_PAGES before completion.
const pageSize = () => Math.min(100, Math.max(25, Number(process.env.SYNC_ONEC_PAGE_SIZE || 50)));
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function rowKey(row, entity) {
  if (row.Ref_Key) return String(row.Ref_Key);
  if (row.Recorder && row.LineNumber !== undefined) {
    return `${row.Recorder_Type || entity}:${row.Recorder}:${row.LineNumber}`;
  }
  return fingerprint(row);
}

function checkPage(page, source) {
  if (!Array.isArray(page)) throw new Error(`${source}: 1С вернула некорректную страницу`);
  return page;
}

async function loadDated(from, toExclusive, { entity, field }, filterByDate,
  { startOffset = 0, initialDirection = null } = {}) {
  const size = pageSize();
  const start = `${from}T00:00:00`;
  const end = `${toExclusive}T00:00:00`;
  const items = [];
  const seen = new Set();
  let previous = null;
  let direction = initialDirection;
  let offset = startOffset;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const pageStarted = Date.now();
    const page = checkPage(await onecGet(entity, {
      $top: size,
      $skip: offset,
      ...(filterByDate ? { $filter: `${field} ge datetime'${start}' and ${field} lt datetime'${end}'` } : {}),
      $orderby: `${field} desc`,
    }), entity);
    if (!page.length) return items;
    offset += page.length;
    for (const row of page) {
      const value = String(row[field] || '');
      if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) throw new Error(`${entity}: документ без корректного ${field}`);
      if (previous && previous !== value) {
        const next = value > previous ? 'asc' : 'desc';
        if (direction && direction !== next) throw new Error(`${entity}: нестабильная сортировка ${field}`);
        direction = next;
      }
      previous = value;
      const key = rowKey(row, entity);
      if (seen.has(key)) throw new Error(`${entity}: повтор записи ${key} при пагинации`);
      seen.add(key);
    }
    for (const row of page) {
      const value = String(row[field]);
      if (value < start) {
        if (filterByDate) throw new Error(`${entity}: 1С нарушила фильтр ${field}`);
        if (direction === 'desc') return items;
      } else if (value >= end) {
        if (filterByDate) throw new Error(`${entity}: 1С нарушила фильтр ${field}`);
        if (direction === 'asc') return items;
      } else items.push(row);
    }
    if (index % 10 === 0 || Date.now() - pageStarted > 10_000) {
      console.log(`[SYNC][${entity}] страница=${index + 1} offset=${offset} найдено=${items.length}`);
    }
  }
  throw new Error(`${entity}: превышен лимит ${MAX_PAGES} страниц`);
}

async function loadCatalog(entity) {
  const size = pageSize();
  const rows = [];
  const seen = new Set();
  let offset = 0;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const page = checkPage(await onecGet(entity, {
      $top: size, $skip: offset, $orderby: 'Ref_Key asc',
    }), entity);
    if (!page.length) return rows;
    offset += page.length;
    for (const row of page) {
      if (!row.Ref_Key || seen.has(row.Ref_Key)) throw new Error(`${entity}: повтор/отсутствие Ref_Key`);
      seen.add(row.Ref_Key);
      rows.push(row);
    }
  }
  throw new Error(`${entity}: превышен лимит ${MAX_PAGES} страниц`);
}

async function loadSnapshot(day, source) {
  const size = pageSize();
  const period = new Date(parseOnecDateTime(`${addDays(day, 1)}T00:00:00`));
  const rows = [];
  const seen = new Set();
  let offset = 0;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const options = { period, top: size, skip: offset };
    const page = checkPage(source === SNAPSHOT_SOURCES[0]
      ? await onecBalance('AccumulationRegister_ТоварыНаСкладах', options)
      : await onecSliceLast('InformationRegister_СебестоимостьНоменклатуры', options), source);
    if (!page.length) return rows;
    offset += page.length;
    for (const row of page) {
      const key = fingerprint(row);
      if (seen.has(key)) throw new Error(`${source}: повтор записи при пагинации`);
      seen.add(key);
      rows.push(row);
    }
  }
  throw new Error(`${source}: превышен лимит ${MAX_PAGES} страниц`);
}

export async function fetchRawSource(day, source) {
  const dated = DATED_SOURCES.find(item => item.entity === source);
  if (dated) {
    const month = `${day.slice(0, 7)}-01`;
    const [year, number] = month.split('-').map(Number);
    const nextMonth = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10);
    const key = `${process.env.ONEC_ODATA_URL}:${source}:${month}`;
    const current = monthCache.get(key);
    if (current && current.expiresAt > Date.now()) {
      return current.rows.filter(row => String(row[dated.field]).slice(0, 10) === day);
    }
    try { return await loadDated(day, addDays(day, 1), dated, true); }
    catch (error) {
      if (!/Операция не разрешена в предложении|operation not allowed in (the )?where/i.test(String(error.message))) throw error;
      console.warn(`[SYNC][${source}][${day}] фильтр даты не поддержан, читаем месяц ${month} одним проходом`);
      const position = await ascendingStartOffset(source, dated.field, `${month}T00:00:00`);
      const rows = await loadDated(month, nextMonth, dated, false,
        { startOffset: position.offset, initialDirection: position.direction });
      monthCache.clear(); // Bound memory: only the current source/month is retained.
      monthCache.set(key, { rows, expiresAt: Date.now() + 30 * 60_000 });
      return rows.filter(row => String(row[dated.field]).slice(0, 10) === day);
    }
  }
  if (CATALOG_SOURCES.includes(source)) return loadCatalog(source);
  if (SNAPSHOT_SOURCES.includes(source)) return loadSnapshot(day, source);
  throw new Error(`Неизвестный источник ${source}`);
}

export function rawRecordKey(row, source) { return rowKey(row, source); }
