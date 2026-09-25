import assert from "node:assert/strict";
import test from "node:test";

import { scanReportsByRange } from "../server/dashboard/report-range.mjs";
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
