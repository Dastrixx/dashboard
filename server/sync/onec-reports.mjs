import { onecGet } from '../onec.mjs';
import { RETAIL_REPORT_ENTITY, RETAIL_REPORT_SELECT } from '../dashboard/constants.mjs';
import { addDays } from './ranges.mjs';

export async function fetchReportDay(day) {
  const size = Math.min(100, Math.max(1, Number(process.env.SYNC_ONEC_PAGE_SIZE || 50)));
  const select = `${RETAIL_REPORT_SELECT},DeletionMark`;
  const filter = `Date ge datetime'${day}T00:00:00' and Date lt datetime'${addDays(day, 1)}T00:00:00'`;
  const items = [];
  for (let pageNumber = 0; pageNumber < 2000; pageNumber += 1) {
    const page = await onecGet(RETAIL_REPORT_ENTITY, {
      $format: 'json', $top: size, $skip: items.length,
      $select: select, $filter: filter, $orderby: 'Date asc,Ref_Key asc',
    });
    if (!Array.isArray(page)) throw new Error('1С вернула некорректную страницу отчётов');
    items.push(...page);
    if (page.length < size) {
      const keys = new Set(items.map(item => item.Ref_Key));
      if (keys.size !== items.length) throw new Error('Повторяющиеся документы при пагинации 1С');
      return items;
    }
  }
  throw new Error('Лимит страниц отчётов 1С превышен');
}
