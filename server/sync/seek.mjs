import { onecGet } from '../onec.mjs';

// Some 1C installations ignore `desc` and return the oldest documents first.
// Skip to the requested month in logarithmic requests instead of reading every
// document since the beginning of the database for each monthly scan.
export async function ascendingStartOffset(entity, field, start, limit = 100_000) {
  const read = async (skip, top = 1) => {
    const page = await onecGet(entity, {
      $top: top, $skip: skip, $select: field, $orderby: `${field} desc`,
    });
    if (!Array.isArray(page)) throw new Error(`${entity}: неверная страница при поиске ${field}`);
    for (const row of page) if (!row[field]) throw new Error(`${entity}: нет ${field} при поиске даты`);
    return page.map(row => String(row[field]));
  };
  const first = await read(0, 2);
  if (first.length < 2) return { offset: 0, direction: null };
  let firstDifferent = 1;
  let differentDate = first[1];
  while (differentDate === first[0]) {
    firstDifferent *= 2;
    if (firstDifferent > limit) return { offset: 0, direction: null };
    differentDate = (await read(firstDifferent))[0];
    if (!differentDate) return { offset: 0, direction: null };
  }
  if (first[0] > differentDate) return { offset: 0, direction: null };
  if (first[0] >= start) return { offset: 0, direction: 'asc' };

  let lower = 0;
  let lowerDate = first[0];
  let upper = firstDifferent;
  let upperDate = differentDate;
  while (upperDate && upperDate < start) {
    lower = upper;
    lowerDate = upperDate;
    upper *= 2;
    if (upper > limit) throw new Error(`${entity}: превышен лимит поиска начала периода`);
    upperDate = (await read(upper))[0];
    if (upperDate && upperDate < lowerDate) throw new Error(`${entity}: сортировка ${field} меняет направление`);
  }
  while (lower + 1 < upper) {
    const middle = Math.floor((lower + upper) / 2);
    const date = (await read(middle))[0];
    if (date && (date < lowerDate || (upperDate && date > upperDate))) {
      throw new Error(`${entity}: нестабильная пагинация при поиске даты`);
    }
    if (!date || date >= start) { upper = middle; upperDate = date; }
    else { lower = middle; lowerDate = date; }
  }
  console.log(`[SYNC][${entity}] начало периода ${start.slice(0, 10)}: пропускаем ${upper} старых записей`);
  return { offset: upper, direction: 'asc' };
}
