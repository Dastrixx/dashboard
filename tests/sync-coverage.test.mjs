import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForCoverage } from '../server/sync/wait-for-coverage.mjs';

test('verification waits until an asynchronously queued range completes', async () => {
  const states = [
    { status: 'syncing', completedDays: 0, totalDays: 2 },
    { status: 'syncing', completedDays: 1, totalDays: 2 },
    { status: 'ready', completedDays: 2, totalDays: 2 },
  ];
  let index = 0;
  const result = await waitForCoverage({
    readStatus: async () => states[index++],
    waitMs: 1000, intervalMs: 1, sleep: async () => {}, log: () => {},
  });
  assert.equal(result.completedDays, 2);
  assert.equal(index, 3);
});

test('verification reports the failed day and source error', async () => {
  await assert.rejects(waitForCoverage({
    readStatus: async () => ({ status: 'failed', failedRanges: [{ from: '2026-08-01', error: 'OData timeout' }] }),
    log: () => {},
  }), /2026-08-01: OData timeout/);
});
