// Small local OData fixture for exercising pagination and the background worker.
// Never use this process or its placeholder credentials in production.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const fixture = JSON.parse(await readFile(new URL('../onec-samples/retail-report-with-lines.json', import.meta.url)));
const source = fixture.items[0];
const rows = [
  { ...source, Date: '2026-08-01T12:00:00', Posted: true, DeletionMark: false },
  { ...source, Ref_Key: '068e3aae-e006-11f0-80c3-aa294801d716', Date: '2026-08-02T12:00:00', Posted: true, DeletionMark: false },
];

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (!decodeURIComponent(url.pathname).endsWith('/Document_ОтчетОРозничныхПродажах')) {
    response.writeHead(404).end(JSON.stringify({ error: 'Fixture entity unavailable' }));
    return;
  }
  const filter = url.searchParams.get('$filter') || '';
  const start = filter.match(/Date ge datetime'([^']+)'/)?.[1];
  const end = filter.match(/Date lt datetime'([^']+)'/)?.[1];
  const items = rows.filter(row => (!start || row.Date >= start) && (!end || row.Date < end));
  const skip = Number(url.searchParams.get('$skip') || 0);
  const top = Number(url.searchParams.get('$top') || 100);
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ value: items.slice(skip, skip + top) }));
});

const port = Number(process.env.MOCK_ONEC_PORT || 4100);
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Порт ${port} уже занят. Закройте другой процесс или запустите mock на другом порту: $env:MOCK_ONEC_PORT='4101'; npm run dev:mock-onec. Затем укажите порт 4101 в ONEC_ODATA_URL файла .env.`);
    process.exitCode = 1;
    return;
  }
  throw error;
});
server.listen(port, '127.0.0.1', () => console.log(`Mock 1C: http://127.0.0.1:${port}/odata/standard.odata`));
