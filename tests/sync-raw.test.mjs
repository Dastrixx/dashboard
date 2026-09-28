import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchRawSource } from '../server/sync/raw-source.mjs';

test('raw sources keep all pages when 1C ignores descending order and rejects Date', async () => {
  const checks = [
    { Ref_Key: 'old', Date: '2026-07-01T12:00:00' },
    { Ref_Key: 'one', Date: '2026-08-01T12:00:00' },
    { Ref_Key: 'two', Date: '2026-08-02T12:00:00' },
    { Ref_Key: 'three', Date: '2026-08-02T15:00:00' },
  ];
  const catalog = ['a', 'b', 'c'].map(Ref_Key => ({ Ref_Key }));
  let rejectedFilters = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const entity = decodeURIComponent(url.pathname);
    if (url.searchParams.has('$filter')) {
      rejectedFilters += 1;
      response.writeHead(500).end('Операция не разрешена в предложении "ГДЕ"');
      return;
    }
    const rows = entity.endsWith('Document_ЧекККМ') ? checks : catalog;
    const skip = Number(url.searchParams.get('$skip') || 0);
    const top = Number(url.searchParams.get('$top'));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ value: rows.slice(skip, skip + top) }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    process.env.ONEC_ODATA_URL = `http://127.0.0.1:${server.address().port}/odata/standard.odata`;
    process.env.ONEC_USER = 'test';
    process.env.ONEC_PASSWORD = 'test';
    process.env.SYNC_ONEC_PAGE_SIZE = '2';
    assert.deepEqual((await fetchRawSource('2026-08-02', 'Document_ЧекККМ')).map(row => row.Ref_Key), ['two', 'three']);
    assert.equal((await fetchRawSource('2026-08-01', 'Document_ЧекККМ')).length, 1);
    assert.equal(rejectedFilters, 1, 'the remaining days reuse the complete monthly scan');
    assert.equal((await fetchRawSource('2026-08-02', 'Catalog_Склады')).length, 3);
    assert.equal((await fetchRawSource('2026-08-02', 'Balance_ТоварыНаСкладах')).length, 3);
    assert.equal((await fetchRawSource('2026-08-02', 'SliceLast_СебестоимостьНоменклатуры')).length, 3);
  } finally {
    await new Promise(resolve => server.close(resolve));
    delete process.env.ONEC_ODATA_URL;
    delete process.env.ONEC_USER;
    delete process.env.ONEC_PASSWORD;
    delete process.env.SYNC_ONEC_PAGE_SIZE;
  }
});
