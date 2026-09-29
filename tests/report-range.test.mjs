import assert from "node:assert/strict";
import test from "node:test";
import { scanReportsByRange } from "../server/dashboard/report-range.mjs";

test("range scan skips newer reports and stops after the requested dates", async () => {
  const pages = [
    [{ Date: "2026-09-25T09:00:00" }, { Date: "2026-09-24T08:00:00" }],
    [{ Date: "2026-09-23T08:00:00" }, { Date: "2026-08-25T08:00:00" }],
  ];
  const calls = [];
  const reports = await scanReportsByRange({
    getPage: async (top, skip) => {
      calls.push([top, skip]);
      return pages[skip / 2] ?? [];
    },
    fromTimestamp: Date.parse("2026-08-26T00:00:00Z"),
    toTimestamp: Date.parse("2026-09-24T23:59:59Z"),
    pageSize: 2,
  });
  assert.deepEqual(reports.map((report) => report.Date), [
    "2026-09-24T08:00:00",
    "2026-09-23T08:00:00",
  ]);
  assert.deepEqual(calls, [[2, 0], [2, 2]]);
});

test("range scan fails instead of returning an incomplete period", async () => {
  await assert.rejects(
    scanReportsByRange({
      getPage: async (_top, skip) => [
        { Date: `2026-09-${String(24 - skip).padStart(2, "0")}T12:00:00` },
      ],
      fromTimestamp: Date.parse("2026-09-01T00:00:00Z"),
      toTimestamp: Date.parse("2026-09-30T23:59:59Z"),
      pageSize: 1,
      maxScanned: 2,
    }),
    /ONEC_REPORT_MAX_SCAN/,
  );
});

test("range scan rejects out-of-order pages", async () => {
  await assert.rejects(
    scanReportsByRange({
      getPage: async () => [
        { Date: "2026-09-22T00:00:00" },
        { Date: "2026-09-23T00:00:00" },
      ],
      fromTimestamp: Date.parse("2026-09-01T00:00:00Z"),
      toTimestamp: Date.parse("2026-09-30T23:59:59Z"),
      pageSize: 2,
    }),
    /сортировку/,
  );
});
