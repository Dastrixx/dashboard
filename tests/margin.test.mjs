import assert from "node:assert/strict";
import test from "node:test";

import { summarizeMarginRows } from "../server/dashboard/margin.mjs";

test("margin uses every turnover row", () => {
  const result = summarizeMarginRows([
    {
      СтоимостьTurnover: 10_000_000,
      ор_СебестоимостьTurnover: 7_000_000,
    },
    {
      СтоимостьTurnover: 7_015_724.8,
      ор_СебестоимостьTurnover: 4_368_378.25,
    },
  ]);

  assert.equal(result.revenue, 17_015_724.8);
  assert.equal(result.cost, 11_368_378.25);
  assert.equal(result.profit, 5_647_346.550000001);
  assert.ok(Math.abs(result.marginPercent - 33.188986) < 0.000001);
});
