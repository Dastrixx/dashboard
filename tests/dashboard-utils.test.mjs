import assert from "node:assert/strict";
import test from "node:test";

import {
  enrichProductsWithBusinessCategories,
  filterByPeriod,
  normalizeOnecDateTime,
  parseOnecDateTime,
  resolveActivityAnchor,
  summarizeProductReference,
} from "../server/dashboard/utils.mjs";
import {
  normalizeSalesChannel,
  parseSalesChannel,
  salesChannelFromOrder,
} from "../server/dashboard/sales-channels.mjs";

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
  const previousMode = process.env.ONEC_IGNORE_ISOLATED_DOCUMENTS;
  process.env.ONEC_ACTIVITY_GAP_DAYS = "45";
  process.env.ONEC_IGNORE_ISOLATED_DOCUMENTS = "true";

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
    if (previousMode === undefined) {
      delete process.env.ONEC_IGNORE_ISOLATED_DOCUMENTS;
    } else {
      process.env.ONEC_IGNORE_ISOLATED_DOCUMENTS = previousMode;
    }
  }
});

test("resolveActivityAnchor uses the actual newest document by default", () => {
  const previousMode = process.env.ONEC_IGNORE_ISOLATED_DOCUMENTS;
  delete process.env.ONEC_IGNORE_ISOLATED_DOCUMENTS;

  try {
    const activity = resolveActivityAnchor(
      [
        { Date: "2025-12-23T10:00:00Z" },
        { Date: "2025-07-31T10:00:00Z" },
      ],
      "Date",
    );

    assert.equal(activity.adjusted, false);
    assert.equal(activity.anchorDate?.toISOString(), "2025-12-23T10:00:00.000Z");
  } finally {
    if (previousMode === undefined) {
      delete process.env.ONEC_IGNORE_ISOLATED_DOCUMENTS;
    } else {
      process.env.ONEC_IGNORE_ISOLATED_DOCUMENTS = previousMode;
    }
  }
});

test("1C date without timezone is interpreted in configured timezone", () => {
  const previousOffset = process.env.ONEC_TIMEZONE_OFFSET_MINUTES;
  process.env.ONEC_TIMEZONE_OFFSET_MINUTES = "360";

  try {
    const timestamp = parseOnecDateTime("2025-12-23T19:48:15");
    assert.equal(new Date(timestamp).toISOString(), "2025-12-23T13:48:15.000Z");
    assert.equal(
      normalizeOnecDateTime("2025-12-23T19:48:15"),
      "2025-12-23T13:48:15.000Z",
    );
  } finally {
    if (previousOffset === undefined) {
      delete process.env.ONEC_TIMEZONE_OFFSET_MINUTES;
    } else {
      process.env.ONEC_TIMEZONE_OFFSET_MINUTES = previousOffset;
    }
  }
});

test("products receive category and subcategory from 1C references", () => {
  const products = [
    {
      Ref_Key: "product-1",
      ВидНоменклатуры_Key: "kind-1",
      Parent_Key: "subcategory-1",
      Description: "Полотенце",
    },
  ];
  const kinds = [
    {
      Ref_Key: "kind-1",
      Description: "Домашний текстиль",
    },
  ];
  const subcategories = [
    {
      Ref_Key: "subcategory-1",
      Description: "Полотенца",
      IsFolder: true,
    },
  ];

  assert.deepEqual(
    enrichProductsWithBusinessCategories(products, kinds, subcategories),
    [
      {
        ...products[0],
        ВидНоменклатуры: "Домашний текстиль",
        BusinessCategory_Key: "home-textile",
        BusinessCategory: "Домашний текстиль",
        Subcategory_Key: "subcategory-1",
        Subcategory: "Полотенца",
      },
    ],
  );
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

test("sales channel is derived from the customer order", () => {
  assert.equal(salesChannelFromOrder("customer-order-key"), "online");
  assert.equal(
    salesChannelFromOrder("00000000-0000-0000-0000-000000000000"),
    "offline",
  );
  assert.equal(salesChannelFromOrder(undefined), "offline");
});

test("sales channel input is normalized safely", () => {
  assert.equal(normalizeSalesChannel("ONLINE"), "online");
  assert.equal(parseSalesChannel("unsupported"), "all");
  assert.throws(
    () => normalizeSalesChannel("unsupported"),
    /Канал продаж должен быть/,
  );
});
