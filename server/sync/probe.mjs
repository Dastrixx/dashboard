import { onecGet } from '../onec.mjs';
import { RETAIL_REPORT_ENTITY } from '../dashboard/constants.mjs';
import { daysInRange } from './ranges.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--') && arg.includes('='))
  .map(arg => arg.slice(2).split('=')));
if (args.from || args.to) daysInRange(args.from, args.to);

const endpoint = new URL(process.env.ONEC_ODATA_URL);
console.log(`[PROBE] 1C endpoint: ${endpoint.origin}${endpoint.pathname}`);
const page = await onecGet(RETAIL_REPORT_ENTITY, {
  $top: 10,
  $select: 'Ref_Key,Number,Date,Posted,DeletionMark',
  $orderby: 'Date desc',
});
if (!Array.isArray(page)) throw new Error('1С вернула некорректный список отчётов');
console.log(`[PROBE] Последние ${page.length} документов ${RETAIL_REPORT_ENTITY}:`);
for (const row of page) {
  console.log(`[PROBE] ${row.Date} number=${row.Number} posted=${row.Posted} deleted=${row.DeletionMark}`);
}
if (args.from && args.to) {
  console.log(`[PROBE] Запрошенный период: ${args.from}..${args.to}`);
  if (page.length === 0) console.warn('[PROBE] Сущность не вернула документы: проверьте базу 1С и права пользователя.');
  else if (page.length > 1 && String(page[0].Date) < String(page[page.length - 1].Date)) {
    console.warn('[PROBE] 1С вернула даты по возрастанию вопреки Date desc; первая страница не показывает последние отчёты.');
  } else if (String(page[0].Date).slice(0, 10) < args.from) {
    console.warn('[PROBE] Самый поздний отчёт старше запрошенного периода: проверьте год или базу 1С.');
  }
}
