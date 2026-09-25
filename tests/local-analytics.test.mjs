import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalAnalytics, normalizeAnalyticsQuery } from "../server/dashboard/local-analytics.mjs";

const query = { from: "2026-08-01", to: "2026-08-30", references: "false" };
const payload = { items: [{ Ref_Key: "first", amount: 120 }], meta: { truncated: false } };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("cold period is queued once, then persisted across restart and isolated by source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "analytics-"));
  let calls = 0;
  let finish;
  const options = { databasePath: join(dir, "data.sqlite"), namespace: "source-a", refreshMs: 300000 };
  const first = new LocalAnalytics({ ...options, loaders: { reports: async () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  } } });
  assert.equal(first.read("reports", query).payload, null);
  first.read("reports", { ...query });
  await tick();
  assert.equal(calls, 1);
  first.read("reports", query);
  finish(payload);
  await tick();
  assert.deepEqual(first.read("reports", query).payload, payload);
  first.db.close();
  const second = new LocalAnalytics({ ...options, loaders: {} });
  assert.deepEqual(second.read("reports", query).payload, payload);
  second.db.close();
  const other = new LocalAnalytics({ ...options, namespace: "source-b", loaders: { reports: async () => ({ items: [] }) } });
  assert.equal(other.read("reports", query).payload, null);
  await tick();
  other.db.close();
  rmSync(dir, { recursive: true });
});

test("checking for a report snapshot does not start a 1C download", async () => {
  let calls = 0;
  const store = new LocalAnalytics({ databasePath: ":memory:", namespace: "test", loaders: {
    reports: async () => { calls += 1; return { items: [], meta: { truncated: false } }; },
  } });
  assert.equal(store.read("reports", query, { refresh: false }).payload, null);
  await tick();
  assert.equal(calls, 0);
  store.read("reports", query);
  await tick();
  assert.equal(calls, 1);
  store.db.close();
});

test("failed refresh keeps the entire previous snapshot and backs off polling", async () => {
  let now = 100000;
  let fail = false;
  let calls = 0;
  const store = new LocalAnalytics({ databasePath: ":memory:", namespace: "test", refreshMs: 1000, now: () => now,
    loaders: { reports: async () => { calls++; if (fail) throw new Error("1C timeout"); return payload; } } });
  store.read("reports", query);
  await tick();
  now += 2000;
  fail = true;
  const stale = store.read("reports", query);
  assert.deepEqual(stale.payload, payload);
  assert.equal(stale.sync.stale, true);
  await tick();
  const result = store.read("reports", query);
  assert.deepEqual(result.payload, payload);
  assert.equal(result.sync.error, "1C timeout");
  await tick();
  assert.equal(calls, 2);
  store.db.close();
});

test("background refresh skips fresh snapshots and respects failure backoff", async () => {
  let now = 100000;
  let calls = 0;
  let fail = false;
  const store = new LocalAnalytics({
    databasePath: ":memory:", namespace: "test", refreshMs: 1000, now: () => now,
    loaders: { reports: async () => {
      calls += 1;
      if (fail) throw new Error("1C timeout");
      return payload;
    } },
  });
  store.read("reports", query);
  await tick();
  store.refreshRecent();
  await tick();
  assert.equal(calls, 1);

  now += 1001;
  fail = true;
  store.refreshRecent();
  await tick();
  assert.equal(calls, 2);
  now += 1001;
  store.refreshRecent();
  await tick();
  assert.equal(calls, 2);
  now += 60_000;
  store.refreshRecent();
  await tick();
  assert.equal(calls, 2);
  now += 240_000;
  store.refreshRecent();
  await tick();
  assert.equal(calls, 3);
  store.db.close();
});

test("queue runs periods sequentially and publishes empty successful periods", async () => {
  let active = 0;
  let maxActive = 0;
  const store = new LocalAnalytics({ databasePath: ":memory:", namespace: "test", loaders: {
    reports: async () => { active++; maxActive = Math.max(maxActive, active); await tick(); active--; return { items: [] }; },
  } });
  store.read("reports", query);
  const other = { ...query, from: "2026-07-01", to: "2026-07-31" };
  store.read("reports", other);
  while (store.running || store.queue.size) await tick();
  assert.equal(maxActive, 1);
  assert.deepEqual(store.read("reports", other).payload, { items: [] });
  store.db.close();
});

test("truncated range never replaces the last complete period", async () => {
  let now = 100000;
  let truncated = false;
  const store = new LocalAnalytics({ databasePath: ":memory:", namespace: "test", refreshMs: 1000, now: () => now,
    loaders: { reports: async () => truncated ? { items: [], meta: { truncated: true } } : payload } });
  store.read("reports", query);
  await tick();
  truncated = true;
  now += 2000;
  store.read("reports", query);
  await tick();
  assert.deepEqual(store.read("reports", query).payload, payload);
  store.db.close();
});

test("normalization rejects invalid ranges and keeps channel/store scopes separate", () => {
  assert.throws(() => normalizeAnalyticsQuery("reports", { from: "2026-02-30", to: "2026-03-01" }));
  assert.throws(() => normalizeAnalyticsQuery("reports", { from: "2020-01-01", to: "2026-01-01" }));
  assert.throws(() => normalizeAnalyticsQuery("margin", { storeKey: "bad" }));
  const all = normalizeAnalyticsQuery("margin", query);
  const online = normalizeAnalyticsQuery("margin", { ...query, channel: "online" });
  assert.notDeepEqual(all, online);
  assert.equal(all.includePrevious, "true");
});

test("sales date filters inside a downloaded period use local documents without fetching 1C", async () => {
  let calls = 0;
  const store = new LocalAnalytics({ databasePath: ":memory:", namespace: "test", loaders: {
    reports: async () => { calls++; return { items: [
      { Ref_Key: "outside", Date: "2026-08-20T10:00:00+06:00" },
      { Ref_Key: "end", Date: "2026-08-10T23:59:59+06:00" },
      { Ref_Key: "start", Date: "2026-08-05T00:00:00+06:00" },
    ], meta: { truncated: false } }; },
  } });
  store.read("reports", query);
  await tick();
  const range = store.read("reports", { ...query, from: "2026-08-05", to: "2026-08-10" });
  assert.deepEqual(range.payload.items.map((item) => item.Ref_Key), ["end", "start"]);
  assert.equal(range.payload.meta.loaded, 2);
  assert.equal(range.payload.meta.from, "2026-08-05");
  await tick();
  assert.equal(calls, 1);
  store.db.close();
});

test("sales filter combines adjacent local periods without a new 1C scan", async () => {
  let calls = 0;
  const store = new LocalAnalytics({ databasePath: ":memory:", namespace: "test", loaders: {
    reports: async (range) => {
      calls += 1;
      return { items: [{ Ref_Key: range.from, Date: `${range.to === "2026-08-30" ? range.to : range.from}T12:00:00` }],
        meta: { truncated: false } };
    },
  } });
  const first = { from: "2026-08-01", to: "2026-08-30", references: "false" };
  const second = { from: "2026-08-31", to: "2026-09-29", references: "false" };
  store.read("reports", first);
  store.read("reports", second);
  const range = { from: "2026-08-29", to: "2026-09-02", references: "false" };
  assert.equal(store.read("reports", range).payload, null);
  while (store.running || store.queue.size) await tick();
  const result = store.read("reports", range);
  assert.equal(result.payload.meta.cache, "local-range");
  assert.equal(result.payload.meta.from, range.from);
  assert.equal(result.payload.meta.to, range.to);
  assert.deepEqual(result.payload.items.map((item) => item.Ref_Key), [second.from, first.from]);
  assert.equal(calls, 2);
  store.db.close();
});

test("sales filter returns only covered dates and does not fill a gap", async () => {
  let calls = 0;
  const store = new LocalAnalytics({ databasePath: ":memory:", namespace: "test", loaders: {
    reports: async () => {
      calls += 1;
      return { items: [
        { Ref_Key: "in", Date: "2026-08-30T23:59:59.999" },
        { Ref_Key: "out", Date: "2026-09-05T12:00:00" },
      ], meta: { truncated: false } };
    },
  } });
  store.read("reports", { from: "2026-08-01", to: "2026-08-30", references: "false" });
  store.read("reports", { from: "2026-09-02", to: "2026-09-30", references: "false" });
  while (store.running || store.queue.size) await tick();
  const range = store.read("reports", { from: "2026-08-30", to: "2026-09-03", references: "false" });
  assert.equal(range.payload, null);
  while (store.running || store.queue.size) await tick();
  assert.equal(calls, 3);
  store.db.close();
});
