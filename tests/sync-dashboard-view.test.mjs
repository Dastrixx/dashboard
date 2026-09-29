import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storedConsultants, storedMargin } from '../server/sync/dashboard-view.mjs';
import { summarizeStoredCheckRange } from '../server/dashboard/checks.mjs';

test('stored check analytics includes archived checks and excludes deferred checks outside the range', () => {
  const rows = [
    { Ref_Key: 'sale', Date: '2026-09-19T12:00:00', Posted: true, СуммаДокумента: 100,
      Товары: [{ СуммаАвтоматическойСкидки: 10 }] },
    { Ref_Key: 'return', Date: '2026-09-19T13:00:00', Posted: true,
      ВидОперации: 'Возврат', СуммаДокумента: 20 },
    { Ref_Key: 'draft', Date: '2026-09-19T14:00:00', Posted: false,
      СтатусЧекаККМ: 'Отложенный', СуммаДокумента: 500 },
    { Ref_Key: 'archive', Date: '2026-09-19T15:00:00', Posted: false,
      СтатусЧекаККМ: 'Архивный', СуммаДокумента: 30 },
    { Ref_Key: 'other', Date: '2026-09-18T12:00:00', Posted: true, СуммаДокумента: 200 },
  ];
  const result = summarizeStoredCheckRange(rows, '2026-09-19', '2026-09-19');
  assert.equal(result.current.totalChecks, 3);
  assert.equal(result.current.netRevenue, 110);
  assert.equal(result.current.discounts, 10);
  assert.equal(result.series.reduce((sum, item) => sum + item.checks, 0), 2);
});

test('stored consultants use check lines, returns and distinct check keys', () => {
  const checks = [
    { Ref_Key: 'sale', Date: '2026-09-19T12:00:00', Posted: true, Магазин_Key: 'store',
      Товары: [{ Продавец_Key: 'seller', Количество: 2, Цена: 60, Сумма: 100 }] },
    { Ref_Key: 'return', Date: '2026-09-19T13:00:00', Posted: true,
      ВидОперации: 'Возврат', Магазин_Key: 'store',
      Товары: [{ Продавец_Key: 'seller', Количество: 1, Цена: 60, Сумма: 50 }] },
  ];
  const { items, source } = storedConsultants(checks, [], 'all');
  assert.equal(source, 'Document_ЧекККМ.Товары.Продавец_Key');
  assert.equal(items.length, 1);
  assert.equal(items[0].СтоимостьTurnover, 50);
  assert.equal(items[0].Чеков, 1);
  assert.deepEqual(items[0].ИдентификаторыЧеков, ['sale']);
});

test('stored margin does not report a false 100 percent when cost is absent', () => {
  const summary = storedMargin([{ Active: true, Магазин_Key: 'store',
    Стоимость: 100, СтоимостьБезСкидок: 120, ор_Себестоимость: 0 }], 'store');
  assert.equal(summary.revenue, 100);
  assert.equal(summary.dataAvailable, false);
  assert.equal(summary.marginPercent, 0);
});

test('stored margin subtracts expense movements from receipts', () => {
  const summary = storedMargin([
    { RecordType: 'Receipt', Стоимость: 100, СтоимостьБезСкидок: 120, ор_Себестоимость: 60 },
    { RecordType: 'Expense', Стоимость: 20, СтоимостьБезСкидок: 24, ор_Себестоимость: 12 },
  ]);
  assert.equal(summary.revenue, 80);
  assert.equal(summary.cost, 48);
  assert.equal(summary.marginPercent, 40);
});
