import { onecGet } from '../onec.mjs';
import { RETAIL_REPORT_ENTITY, RETAIL_REPORT_SELECT } from '../dashboard/constants.mjs';
import { addDays } from './ranges.mjs';

const MAX_PAGES = 2000;

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

async function loadDay(day, { filterByDate }) {
  const size = Math.min(100, Math.max(1, Number(process.env.SYNC_ONEC_PAGE_SIZE || 50)));
  const start = `${day}T00:00:00`;
  const end = `${addDays(day, 1)}T00:00:00`;
  const items = [];
  let previousDate = null;

  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = await onecGet(RETAIL_REPORT_ENTITY, {
      $top: size,
      $skip: pageNumber * size,
      $select: `${RETAIL_REPORT_SELECT},DeletionMark`,
      ...(filterByDate ? { $filter: `Date ge datetime'${start}' and Date lt datetime'${end}'` } : {}),
      $orderby: 'Date desc',
    });
    if (!Array.isArray(page)) throw new Error('1С вернула некорректную страницу отчётов');

    for (const report of page) {
      const date = String(report.Date || '');
      if (!date || (previousDate && date > previousDate)) {
        throw new Error('1С вернула документы без стабильной сортировки Date desc');
      }
      previousDate = date;
      if (date < start) {
        if (filterByDate) throw new Error('1С вернула документы за пределами фильтра даты');
        return unique(items);
      }
      if (date >= end) {
        if (filterByDate) throw new Error('1С вернула документы за пределами фильтра даты');
        continue;
      }
      items.push(report);
    }
    if (page.length < size) return unique(items);
  }
  throw new Error(`Превышен лимит ${MAX_PAGES} страниц 1С; день не отмечен как синхронизированный`);
}

export async function fetchReportDay(day) {
  try {
    return await loadDay(day, { filterByDate: true });
  } catch (error) {
    if (!isUnsupportedDateFilter(error)) throw error;
    console.warn(`[SYNC][reports][${day}] 1С не поддерживает фильтр Date; сканируем страницы по Date desc`);
    return loadDay(day, { filterByDate: false });
  }
}
