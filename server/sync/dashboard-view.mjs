import { salesChannelFromOrder } from '../dashboard/sales-channels.mjs';
import { summarizeMarginRows } from '../dashboard/margin.mjs';
import { isCompletedCheck } from '../dashboard/checks.mjs';

const ZERO = '00000000-0000-0000-0000-000000000000';

export function storedConsultants(checks, reports, channel = 'all') {
  const grouped = new Map();
  let source = 'Document_ЧекККМ.Товары.Продавец_Key';
  const add = (document, line, sign, checkKey) => {
    const orderKey = line.ЗаказПокупателя_Key || document.ЗаказПокупателя_Key;
    if (channel !== 'all' && salesChannelFromOrder(orderKey) !== channel) return;
    const seller = line.Продавец_Key && line.Продавец_Key !== ZERO
      ? line.Продавец_Key : document.Продавец_Key;
    if (!seller || seller === ZERO) return;
    const store = document.Магазин_Key || ZERO;
    const key = `${seller}:${store}`;
    const item = grouped.get(key) || {
      Продавец_Key: seller, СотрудникТип: 'consultant', Магазин_Key: store,
      КоличествоTurnover: 0, СтоимостьTurnover: 0, СтоимостьБезСкидокTurnover: 0,
      СтрокПродаж: 0, СтрокВозвратов: 0, СуммаСкидок: 0, ПродажиПоДатам: {},
      ИдентификаторыЧеков: new Set(),
    };
    const quantity = Number(line.Количество || 0);
    const amount = Number(line.Сумма || 0);
    const beforeDiscount = Math.max(Number(line.Цена || 0) * quantity, amount);
    item.КоличествоTurnover += sign * quantity;
    item.СтоимостьTurnover += sign * amount;
    item.СтоимостьБезСкидокTurnover += sign * beforeDiscount;
    item.СуммаСкидок += sign * Math.max(beforeDiscount - amount, 0);
    if (sign > 0) item.СтрокПродаж += 1;
    else item.СтрокВозвратов += 1;
    if (checkKey && sign > 0) item.ИдентификаторыЧеков.add(checkKey);
    const day = String(document.Date || '').slice(0, 10);
    if (day) item.ПродажиПоДатам[day] = (item.ПродажиПоДатам[day] || 0) + sign * amount;
    grouped.set(key, item);
  };
  for (const check of checks.filter(isCompletedCheck)) {
    const sign = /возврат/i.test(String(check.ВидОперации || '')) ? -1 : 1;
    for (const line of check.Товары || []) add(check, line, sign, check.Ref_Key);
  }
  if (!grouped.size) {
    source = 'Document_ОтчетОРозничныхПродажах.Товары.Продавец_Key';
    for (const report of reports.filter(row => row.Posted && !row.DeletionMark)) {
      for (const line of report.Товары || []) add(report, line, 1, null);
      for (const line of report.ВозвращенныеТовары || []) add(report, line, -1, null);
    }
  }
  const items = [...grouped.values()].map(item => ({ ...item,
    Чеков: item.ИдентификаторыЧеков.size,
    ИдентификаторыЧеков: [...item.ИдентификаторыЧеков],
  })).sort((a, b) => b.СтоимостьTurnover - a.СтоимостьTurnover);
  return { items, source };
}

export function storedMargin(rows, storeKey = 'all', channel = 'all') {
  return { ...summarizeMarginRows(rows.filter(row => row.Active !== false &&
    (storeKey === 'all' || row.Магазин_Key === storeKey) &&
    (channel === 'all' || salesChannelFromOrder(row.ЗаказПокупателя_Key) === channel))
    .map(row => {
      const expense = /расход|expense/i.test(String(row.RecordType || ''));
      const value = amount => expense ? -Math.abs(Number(amount || 0)) : Number(amount || 0);
      return {
        СтоимостьTurnover: value(row.Стоимость),
        СтоимостьБезСкидокTurnover: value(row.СтоимостьБезСкидок),
        ор_СебестоимостьTurnover: value(row.ор_Себестоимость),
      };
    })), costSource: 'raw-sales-movements' };
}
