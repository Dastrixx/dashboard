import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";

const pause = () => new Promise((resolve) => setTimeout(resolve, 50));

test("authenticated API reads persisted reports and margin when 1C is unavailable", { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "analytics-api-"));
  let offline = false;
  let reportsOffline = false;
  let rejectCheckDateFilter = false;
  let upstreamReads = 0;
  const augustChecks = Array.from({ length: 6_000 }, (_, index) => ({
    Ref_Key: `august-${index}`, Date: "2026-08-15T12:00:00", Posted: true,
    DeletionMark: false, СтатусЧекаККМ: "Архивный", ВидОперации: "Продажа",
    СуммаДокумента: 10, Товары: [{ Продавец_Key: "12345678-1234-1234-1234-123456789abc", Сумма: 10, Количество: 1 }],
  }));
  const upstream = createServer((request, response) => {
    upstreamReads += 1;
    response.setHeader("Content-Type", "application/json");
    if (offline) { response.statusCode = 503; response.end('{}'); return; }
    const path = decodeURIComponent(request.url);
    if (reportsOffline && path.includes("Document_ОтчетОРозничныхПродажах")) {
      response.statusCode = 503;
      response.end('{}');
      return;
    }
    if (rejectCheckDateFilter && path.includes("Document_ЧекККМ") &&
      new URL(request.url, "http://localhost").searchParams.get("$filter")?.includes("Date ge")) {
      response.statusCode = 400;
      response.end('{}');
      return;
    }
    const rows = path.includes("/Turnovers(")
      ? [{ Магазин_Key: "store", СтоимостьTurnover: 120, СтоимостьБезСкидокTurnover: 150, ор_СебестоимостьTurnover: 80 }]
      : path.includes("Document_ЧекККМ")
        ? new URL(request.url, "http://localhost").searchParams.get("$filter")?.includes(
            "ОтчетОРозничныхПродажах_Key eq guid",
          )
          ? [{ Ref_Key: "check", Date: "2025-12-31T12:00:00", Posted: true,
          DeletionMark: false, СтатусЧекаККМ: "Архивный", ВидОперации: "Продажа",
          СуммаДокумента: 120, ОтчетОРозничныхПродажах_Key: "12345678-1234-1234-1234-123456789abc" }]
          : reportsOffline
            ? augustChecks.slice(
                Number(new URL(request.url, "http://localhost").searchParams.get("$skip") || 0),
                Number(new URL(request.url, "http://localhost").searchParams.get("$skip") || 0) +
                  Number(new URL(request.url, "http://localhost").searchParams.get("$top") || 500),
              )
            : []
      : path.includes("Document_ОтчетОРозничныхПродажах")
        ? new URL(request.url, "http://localhost").searchParams.get("$filter")?.includes("2026-07-01")
          ? [{ Ref_Key: "july-report", Date: "2026-07-15T12:00:00", Posted: true, СуммаДокумента: 77, Товары: [] }]
          : [{ Ref_Key: "12345678-1234-1234-1234-123456789abc", Date: "2026-01-01T12:00:00", Posted: true, СуммаДокумента: 120, Товары: [{ Продавец_Key: "12345678-1234-1234-1234-123456789abc", Сумма: 120, Количество: 1 }] }]
        : [];
    response.end(JSON.stringify({ value: rows }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const portFinder = createServer();
  portFinder.listen(0, "127.0.0.1");
  await once(portFinder, "listening");
  const port = portFinder.address().port;
  await new Promise((resolve) => portFinder.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const dbPath = join(dir, "analytics.sqlite");
  let child;
  const start = async () => {
    child = spawn(process.execPath, ["server/index.mjs"], { env: {
      ...process.env, PORT: String(port), CLIENT_URL: base,
      AUTH_DB_PATH: join(dir, "auth.sqlite"),
      AUTH_BOOTSTRAP_USERS: JSON.stringify([
        { email: "owner@example.com", name: "Owner", role: "owner", password: "strong-test-password" },
        { email: "manager@example.com", name: "Manager", role: "manager", password: "strong-test-password" },
      ]),
      ONEC_LOCAL_ANALYTICS: "true", ONEC_ANALYTICS_DB_PATH: dbPath,
      ONEC_ODATA_URL: `http://127.0.0.1:${upstream.address().port}/odata`,
      ONEC_USER: "test", ONEC_PASSWORD: "test", ONEC_TIMEOUT_MS: "500", ONEC_RETRIES: "0",
    }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    for (let i = 0; i < 150; i++) {
      if (output.includes("3КВАДРАТА API:")) return;
      if (child.exitCode !== null) throw new Error(output);
      await pause();
    }
    throw new Error("API did not start: " + output);
  };
  const stop = async () => {
    if (child && child.exitCode === null) { child.kill(); await once(child, "exit"); }
  };
  try {
    await start();
    await pause();
    assert.equal(upstreamReads, 0, "startup must not flood 1C before a dashboard request");
    assert.equal((await fetch(`${base}/api/dashboard/sync-status`)).status, 401);
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@example.com", password: "strong-test-password" }),
    });
    assert.equal(login.status, 200);
    const headers = { Cookie: login.headers.get("set-cookie").split(";")[0] };
    const coldChecks = await fetch(
      `${base}/api/dashboard/onec-check-analytics?from=2026-02-01&to=2026-02-02`,
      { headers },
    );
    assert.equal(coldChecks.status, 200);
    assert.equal((await coldChecks.json()).items.requestedReports, 0);
    const reports = `${base}/api/dashboard/onec-reports?from=2026-01-01&to=2026-01-02&references=false`;
    const margin = `${base}/api/dashboard/onec-margin?from=2026-01-01&to=2026-01-02&includePrevious=false`;
    const ready = async (url) => {
      for (let i = 0; i < 100; i++) {
        const response = await fetch(url, { headers });
        const body = await response.json();
        if (response.ok) return body;
        assert.equal(body.code, "ANALYTICS_SYNC_PENDING");
        assert.equal(body.meta.localSync.error, null);
        await pause();
      }
      throw new Error("Snapshot not ready");
    };
    const original = await ready(reports);
    assert.equal(original.items[0].СуммаДокумента, 120);
    const checksResponse = await fetch(
      `${base}/api/dashboard/onec-check-analytics?from=2026-01-01&to=2026-01-02&includePrevious=false`,
      { headers },
    );
    assert.equal(checksResponse.status, 200);
    const checks = await checksResponse.json();
    assert.equal(checks.items.current.checks, 1);
    assert.equal(checks.items.requestedReports, 1);
    assert.equal(checks.items.current.revenue, 120);
    assert.equal(checks.items.documentDetailsAvailable, true);
    assert.equal(checks.items.scannedChecks, 0);
    assert.equal((await ready(margin)).items.current.profit, 40);
    const julyReports = `${base}/api/dashboard/onec-reports?from=2026-07-01&to=2026-07-31&references=false`;
    const july = await ready(julyReports);
    assert.equal(july.items[0].СуммаДокумента, 77);
    assert.equal(july.items[0].Date, "2026-07-15T06:00:00.000Z");
    reportsOffline = true;
    assert.equal((await fetch(julyReports, { headers })).status, 200);
    const augustResponse = await fetch(
      `${base}/api/dashboard/onec-check-analytics?from=2026-08-01&to=2026-08-31&includePrevious=false`,
      { headers },
    );
    assert.equal(augustResponse.status, 200);
    const august = await augustResponse.json();
    assert.equal(august.items.current.checks, 6_000);
    assert.equal(august.items.requestedReports, 0);
    assert.equal(august.items.scannedChecks, 6_000);
    assert.equal(august.items.absoluteLatestDate, "2026-08-15T06:00:00.000Z");
    assert.equal(august.items.series.reduce((sum, day) => sum + day.checks, 0), 6_000);
    const managerLogin = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "manager@example.com", password: "strong-test-password" }),
    });
    assert.equal(managerLogin.status, 200);
    const managerHeaders = { Cookie: managerLogin.headers.get("set-cookie").split(";")[0] };
    const janSellers = await fetch(
      `${base}/api/dashboard/onec-consultants?from=2026-01-01&to=2026-01-02`,
      { headers: managerHeaders },
    );
    assert.equal(janSellers.status, 200, "seller reports use the saved snapshot when report OData is offline");
    const janSellerPayload = await janSellers.json();
    assert.equal(janSellerPayload.meta.cache, "local");
    assert.equal(janSellerPayload.items[0].СтоимостьTurnover, 120);
    rejectCheckDateFilter = true;
    const sellersResponse = await fetch(
      `${base}/api/dashboard/onec-consultants?from=2026-08-01&to=2026-08-31`,
      { headers: managerHeaders },
    );
    assert.equal(sellersResponse.status, 200, "seller analytics must handle more than 1000 checks");
    const sellers = await sellersResponse.json();
    assert.equal(sellers.meta.diagnostics.scannedChecks, 6_000);
    assert.equal(sellers.items[0].СтоимостьTurnover, 60_000);
    const transfers = await fetch(
      `${base}/api/dashboard/onec-stock?operationsOnly=true&from=2026-08-01&to=2026-08-31`,
      { headers: managerHeaders },
    );
    assert.equal(transfers.status, 200, "warehouse documents do not depend on retail reports");
    offline = true;
    const missingTransfers = await fetch(
      `${base}/api/dashboard/onec-stock?operationsOnly=true&from=2026-08-01&to=2026-08-31`,
      { headers: managerHeaders },
    );
    assert.equal(missingTransfers.status, 502, "unavailable warehouse documents must not look like an empty period");
    await stop();
    const db = new DatabaseSync(dbPath);
    db.exec("UPDATE analytics_snapshots SET synced_at=1");
    db.close();
    await start();
    const response = await fetch(reports, { headers });
    assert.equal(response.status, 200);
    const cached = await response.json();
    assert.deepEqual(cached.items, original.items);
    assert.equal(cached.meta.localSync.stale, true);
    assert.equal((await (await fetch(margin, { headers })).json()).items.current.profit, 40);
    assert.equal((await fetch(`${base}/api/dashboard/sync-status`, { headers })).status, 200);
  } finally {
    await stop();
    await new Promise((resolve) => upstream.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
