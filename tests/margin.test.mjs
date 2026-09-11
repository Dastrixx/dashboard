import assert from "node:assert/strict";
import test from "node:test";

import { summarizeMarginWithSnapshotCosts } from "../server/dashboard/margin-loader.mjs";
import { summarizeMarginRows } from "../server/dashboard/margin.mjs";

test("margin uses every turnover row", () => {
  const result = summarizeMarginRows([
    {
      СтоимостьTurnover: 10_000_000,
      СтоимостьБезСкидокTurnover: 14_000_000,
      ор_СебестоимостьTurnover: 7_000_000,
    },
    {
      СтоимостьTurnover: 7_015_724.8,
      СтоимостьБезСкидокTurnover: 9_112_632,
      ор_СебестоимостьTurnover: 4_368_378.25,
    },
  ]);

  assert.equal(result.revenue, 17_015_724.8);
  assert.equal(result.revenueBeforeDiscount, 23_112_632);
  assert.ok(Math.abs(result.discounts - 6_096_907.2) < 0.001);
  assert.equal(result.cost, 11_368_378.25);
  assert.equal(result.profit, 5_647_346.550000001);
  assert.ok(Math.abs(result.marginPercent - 33.188986) < 0.000001);
  assert.ok(Math.abs(result.efficiencyPercent - 49.675921) < 0.000001);
  assert.equal(result.dataAvailable, true);
});

test("missing cost never becomes a false 100 percent margin", () => {
  const result = summarizeMarginRows([
    {
      СтоимостьTurnover: 17_015_724.8,
      СтоимостьБезСкидокTurnover: 23_112_632,
      ор_СебестоимостьTurnover: 0,
    },
  ]);

  assert.equal(result.dataAvailable, false);
  assert.equal(result.marginPercent, 0);
  assert.equal(result.efficiencyPercent, 0);
  assert.equal(result.profit, 0);
});

test("margin can be calculated from product cost snapshot", () => {
  const marginSummary = summarizeMarginRows([
    {
      СтоимостьTurnover: 1_700,
      СтоимостьБезСкидокTurnover: 2_000,
    },
  ]);
  const result = summarizeMarginWithSnapshotCosts(
    [
      {
        Магазин_Key: "store",
        Номенклатура_Key: "product-1",
        Характеристика_Key: "variant",
        КоличествоTurnover: 2,
      },
      {
        Магазин_Key: "store",
        Номенклатура_Key: "product-2",
        Характеристика_Key: "variant",
        КоличествоTurnover: 1,
      },
    ],
    [
      {
        Магазин_Key: "store",
        Номенклатура_Key: "product-1",
        Характеристика_Key: "variant",
        Цена: 500,
      },
      {
        Магазин_Key: "store",
        Номенклатура_Key: "product-2",
        Характеристика_Key: "variant",
        Цена: 200,
      },
    ],
    marginSummary,
  );

  assert.equal(result.cost, 1_200);
  assert.equal(result.profit, 500);
  assert.ok(Math.abs(result.marginPercent - 29.411765) < 0.000001);
  assert.ok(Math.abs(result.efficiencyPercent - 41.666667) < 0.000001);
  assert.equal(result.discounts, 300);
});

test("snapshot calculation stops when a product cost is missing", () => {
  const marginSummary = summarizeMarginRows([
    {
      СтоимостьTurnover: 1_700,
      СтоимостьБезСкидокTurnover: 2_000,
    },
  ]);
  const result = summarizeMarginWithSnapshotCosts(
    [
      {
        Магазин_Key: "store",
        Номенклатура_Key: "product-without-cost",
        КоличествоTurnover: 1,
      },
    ],
    [],
    marginSummary,
  );

  assert.equal(result, null);
});
