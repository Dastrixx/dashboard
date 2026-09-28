import { onecGet } from '../onec.mjs';
import { RETAIL_REPORT_ENTITY, RETAIL_REPORT_SELECT } from '../dashboard/constants.mjs';
import { addDays } from './ranges.mjs';

const MAX_PAGES = 2000;
const monthCache = new Map();

function isUnsupportedDateFilter(error) {
  return /Операция не разрешена в предложении|operation not allowed in (the )?where/i.test(String(error?.message));
}

function unique(items) {
  const keys = new Set(items.map(item => item.Ref_Key));
  if (keys.size !== items.length || items.some(item => !item.Ref_Key)) {
    throw new Error('Неполная или нестабильная пагинация документов 1С: повторяющиеся/пустые Ref_Key');
  }
  return items;
}

async function loadRange(from, toExclusive, { filterByDate }) {
  const size = Math.min(100, Math.max(2, Number(process.env.SYNC_ONEC_PAGE_SIZE || 50)));
  const start = `${from}T00:00:00`;
  const end = `${toExclusive}T00:00:00`;
  const items = [];
  let previousDate = null;
  let direction = null;
  let offset = 0;

  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = await onecGet(RETAIL_REPORT_ENTITY, {
      $top: size,
      $skip: offset,
      $select: `${RETAIL_REPORT_SELECT},DeletionMark`,
      ...(filterByDate ? { $filter: `Date ge datetime'${start}' and Date lt datetime'${end}'` } : {}),
      $orderby: 'Date desc',
    });
    if (!Array.isArray(page)) throw new Error('1С вернула некорректную страницу отчётов');
    if (!page.length) return unique(items);
    offset += page.length;

    // Some 1C installations ignore the requested sort direction. Determine the
    // actual order before deciding that an older document ends the search.
    for (const report of page) {
      const date = String(report.Date || '');
      if (!date) throw new Error('1С вернула документ без Date');
      if (previousDate && date !== previousDate) {
        const nextDirection = date > previousDate ? 'asc' : 'desc';
        if (direction && direction !== nextDirection) {
          throw new Error('1С вернула документы без стабильной сортировки Date; день не отмечен как синхронизированный');
        }
        direction = nextDirection;
      }
      previousDate = date;
    }

    for (const report of page) {
      const date = String(report.Date);
      if (date < start) {
        if (filterByDate) throw new Error('1С вернула документы за пределами фильтра даты');
        if (direction === 'desc') return unique(items);
        continue;
      }
      if (date >= end) {
        if (filterByDate) throw new Error('1С вернула документы за пределами фильтра даты');
        if (direction === 'asc') return unique(items);
        continue;
      }
      items.push(report);
    }
  }
  throw new Error(`Превышен лимит ${MAX_PAGES} страниц 1С; день не отмечен как синхронизированный`);
}

export async function fetchReportDay(day) {
  const month = `${day.slice(0, 7)}-01`;
  const [year, number] = month.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10);
  const key = `${process.env.ONEC_ODATA_URL}:${month}`;
  const cached = monthCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.rows.filter(row => String(row.Date).slice(0, 10) === day);
  try {
    return await loadRange(day, addDays(day, 1), { filterByDate: true });
  } catch (error) {
    if (!isUnsupportedDateFilter(error)) throw error;
    console.warn(`[SYNC][reports][${day}] 1С не поддерживает фильтр Date; читаем месяц ${month} одним проходом`);
    const rows = await loadRange(month, nextMonth, { filterByDate: false });
    monthCache.clear();
    monthCache.set(key, { rows, expiresAt: Date.now() + 30 * 60_000 });
    return rows.filter(row => String(row.Date).slice(0, 10) === day);
  }
}
