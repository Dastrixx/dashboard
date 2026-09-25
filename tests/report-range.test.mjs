import assert from "node:assert/strict";
import test from "node:test";

import { loadReportsByRange, scanReportsByRange } from "../server/dashboard/report-range.mjs";
import { parseOnecDateTime } from "../server/dashboard/utils.mjs";

test("report scan includes the last millisecond of the selected day and stops after the range", async () => {
  const pages = [
    [
      { Date: "2026-09-26T00:00:00", Ref_Key: "next" },
      { Date: "2026-09-25T23:59:59.999", Ref_Key: "end" },
    ],
    [
      { Date: "2026-09-25T00:00:00", Ref_Key: "start" },
      { Date: "2026-09-24T23:59:59.999", Ref_Key: "before" },
    ],
  ];
  const calls = [];
  const result = await scanReportsByRange({
    getPage: async (size, skip) => {
      calls.push([size, skip]);
      return pages[skip / size] || [];
    },
    fromTimestamp: parseOnecDateTime("2026-09-25T00:00:00"),
    endExclusive: parseOnecDateTime("2026-09-26T00:00:00"),
    pageSize: 2,
  });
  assert.deepEqual(result.map((item) => item.Ref_Key), ["end", "start"]);
  assert.deepEqual(calls, [[2, 0], [2, 2]]);
});

test("report scan rejects incomplete totals at the scan cap", async () => {
  await assert.rejects(
    scanReportsByRange({
      getPage: async () => [{ Date: "2026-09-25T10:00:00" }],
      fromTimestamp: parseOnecDateTime("2026-09-25T00:00:00"),
      endExclusive: parseOnecDateTime("2026-09-26T00:00:00"),
      pageSize: 1,
      maxScanned: 2,
    }),
    /более 2 документов/,
  );
});

test("July range starts with a server-side date filter instead of scanning recent months", async () => {
  const calls = [];
  const rows = await loadReportsByRange({
    getPage: async (filter, top, skip) => {
      calls.push({ filter, top, skip });
      return [{ Date: "2026-07-15T12:00:00", Ref_Key: "july" }];
    },
    fromTimestamp: parseOnecDateTime("2026-07-01T00:00:00"),
    endExclusive: parseOnecDateTime("2026-08-01T00:00:00"),
    pageSize: 25,
  });
  assert.deepEqual(rows.map((row) => row.Ref_Key), ["july"]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].filter, /Date ge datetime'2026-07-01T00:00:00'/);
  assert.match(calls[0].filter, /Date lt datetime'2026-08-01T00:00:00'/);
});

test("rejected 1C date predicate scans light headers and loads only selected documents", async () => {
  const calls = [];
  const hydrated = [];
  const pages = [
    [{ Date: "2026-08-01T00:00:00" }, { Date: "2026-07-31T12:00:00", Ref_Key: "july" }],
    [{ Date: "2026-06-30T12:00:00" }],
  ];
  const rows = await loadReportsByRange({
    getPage: async (filter) => {
      calls.push(filter);
      if (filter.includes("Date ge")) throw new Error("1С OData вернула HTTP 500: WHERE Date");
      throw new Error("Do not download full documents from other months");
    },
    getHeaderPage: async (_top, skip) => pages[skip / 2] || [],
    getByKey: async (key) => {
      hydrated.push(key);
      return { Date: "2026-07-31T12:00:00", Ref_Key: key, Posted: true, Товары: [] };
    },
    fromTimestamp: parseOnecDateTime("2026-07-01T00:00:00"),
    endExclusive: parseOnecDateTime("2026-08-01T00:00:00"),
    pageSize: 2,
  });
  assert.deepEqual(rows.map((row) => row.Ref_Key), ["july"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(hydrated, ["july"]);
});

test("header scan cap fails before publishing any incomplete month", async () => {
  let details = 0;
  await assert.rejects(loadReportsByRange({
    getPage: async () => { throw new Error("1С OData вернула HTTP 500: WHERE Date"); },
    getHeaderPage: async () => [
      { Date: "2026-08-15T10:00:00" },
      { Date: "2026-08-14T10:00:00" },
    ],
    getByKey: async () => { details += 1; return {}; },
    fromTimestamp: parseOnecDateTime("2026-07-01T00:00:00"),
    endExclusive: parseOnecDateTime("2026-08-01T00:00:00"),
    pageSize: 2,
    maxScanned: 2,
  }), /более 2 документов/);
  assert.equal(details, 0);
});

test("1C timeout does not start another full report scan", async () => {
  let calls = 0;
  await assert.rejects(loadReportsByRange({
    getPage: async () => {
      calls += 1;
      throw new Error("1С не ответила за 200 секунд");
    },
    fromTimestamp: parseOnecDateTime("2026-07-01T00:00:00"),
    endExclusive: parseOnecDateTime("2026-08-01T00:00:00"),
    pageSize: 25,
  }), /200 секунд/);
  assert.equal(calls, 1);
});

test("unrelated 1C failure does not start a second report scan", async () => {
  let calls = 0;
  await assert.rejects(loadReportsByRange({
    getPage: async () => {
      calls += 1;
      throw new Error("1С OData вернула HTTP 500: database unavailable");
    },
    fromTimestamp: parseOnecDateTime("2026-07-01T00:00:00"),
    endExclusive: parseOnecDateTime("2026-08-01T00:00:00"),
    pageSize: 25,
  }), /database unavailable/);
  assert.equal(calls, 1);
});
