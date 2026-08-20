import assert from "node:assert/strict";
import test from "node:test";

import {
  enrichProductsWithBusinessCategories,
  filterByPeriod,
  resolveActivityAnchor,
  summarizeProductReference,
} from "../server/dashboard/utils.mjs";

test("filterByPeriod keeps both range boundaries", () => {
  const rows = [
    { Date: "2025-07-01T00:00:00" },
    { Date: "2025-07-15T12:00:00" },
    { Date: "2025-07-31T23:59:59" },
    { Date: "2025-08-01T00:00:00" },
  ];

  assert.deepEqual(
    filterByPeriod(
      rows,
      "Date",
      "2025-07-01T00:00:00",
      "2025-07-31T23:59:59",
    ),
    rows.slice(0, 3),
  );
});

test("resolveActivityAnchor ignores an isolated late document", () => {
  const previousGap = process.env.ONEC_ACTIVITY_GAP_DAYS;
  process.env.ONEC_ACTIVITY_GAP_DAYS = "45";

  try {
    const activity = resolveActivityAnchor(
      [
        { Date: "2025-12-23T10:00:00Z" },
        { Date: "2025-07-31T10:00:00Z" },
        { Date: "2025-07-30T10:00:00Z" },
      ],
      "Date",
    );

    assert.equal(activity.adjusted, true);
    assert.equal(activity.ignoredDocuments, 1);
    assert.equal(activity.anchorDate?.toISOString(), "2025-07-31T10:00:00.000Z");
  } finally {
    if (previousGap === undefined) delete process.env.ONEC_ACTIVITY_GAP_DAYS;
    else process.env.ONEC_ACTIVITY_GAP_DAYS = previousGap;
  }
});

test("products receive the configured business category", () => {
  const products = [
    {
      Ref_Key: "product-1",
      ВидНоменклатуры_Key: "kind-1",
      Description: "Полотенце",
    },
  ];
  const kinds = [
    {
      Ref_Key: "kind-1",
      Description: "Домашний текстиль",
    },
  ];

  assert.deepEqual(enrichProductsWithBusinessCategories(products, kinds), [
    {
      ...products[0],
      ВидНоменклатуры: "Домашний текстиль",
      BusinessCategory_Key: "home-textile",
      BusinessCategory: "Домашний текстиль",
    },
  ]);
});

test("summarizeProductReference groups products by reference", () => {
  const key = "ea947e4c-d988-11f0-bf9e-74563ce62df2";
  const result = summarizeProductReference(
    [
      { Ref_Key: "p1", ВидНоменклатуры_Key: key, Description: "Товар 1" },
      { Ref_Key: "p2", ВидНоменклатуры_Key: key, Description: "Товар 2" },
    ],
    "ВидНоменклатуры_Key",
    [{ Ref_Key: key, Description: "Домашний текстиль" }],
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Домашний текстиль");
  assert.equal(result[0].productsCount, 2);
});
