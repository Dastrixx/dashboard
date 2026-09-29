import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, businessDate, daysInRange } from '../server/sync/ranges.mjs';

test('range includes month boundary and leap day exactly once', () => {
  assert.deepEqual(daysInRange('2024-02-28', '2024-03-01'), [
    '2024-02-28', '2024-02-29', '2024-03-01',
  ]);
  assert.equal(addDays('2026-09-01', -1), '2026-08-31');
  assert.throws(() => daysInRange('2026-02-30', '2026-03-01'));
  assert.throws(() => daysInRange('2026-09-05', '2026-09-01'));
});

test('daily scheduler uses Kazakhstan business date around UTC midnight', () => {
  assert.deepEqual(businessDate(new Date('2026-09-25T19:01:00Z')), {
    day: '2026-09-26', hour: 0,
  });
  assert.deepEqual(businessDate(new Date('2026-09-26T00:01:00Z')), {
    day: '2026-09-26', hour: 5,
  });
});
