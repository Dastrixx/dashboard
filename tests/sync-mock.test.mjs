import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fetchReportDay } from '../server/sync/onec-reports.mjs';

test('report sync paginates a one-day range and keeps empty days', async () => {
  const port = 4101;
  const child = spawn(process.execPath, ['scripts/mock-onec.mjs'], {
    env: { ...process.env, MOCK_ONEC_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      once(child, 'exit').then(() => { throw new Error('Mock 1C stopped early'); }),
    ]);
    process.env.ONEC_ODATA_URL = `http://127.0.0.1:${port}/odata/standard.odata`;
    process.env.ONEC_USER = 'mock';
    process.env.ONEC_PASSWORD = 'mock';
    process.env.SYNC_ONEC_PAGE_SIZE = '1';
    assert.equal((await fetchReportDay('2026-08-01')).length, 1);
    assert.equal((await fetchReportDay('2026-08-02')).length, 1);
    assert.deepEqual(await fetchReportDay('2026-08-03'), []);
  } finally {
    child.kill();
    await once(child, 'exit').catch(() => {});
    delete process.env.ONEC_ODATA_URL;
    delete process.env.ONEC_USER;
    delete process.env.ONEC_PASSWORD;
    delete process.env.SYNC_ONEC_PAGE_SIZE;
  }
});
