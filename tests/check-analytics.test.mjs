import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCheckAnalytics,
  checkReportFilter,
  isCompletedCheck,
  summarizeCashShifts,
} from "../server/dashboard/checks.mjs";
import { summarizeSalesDocuments } from "../server/dashboard/sales-register.mjs";
import { parseOnecDateTime } from "../server/dashboard/utils.mjs";

test("check query links receipts to a retail report without Date filter", () => {
  const filter = checkReportFilter(
    "12345678-1234-1234-1234-123456789abc",
  );

  assert.equal(
    filter,
    "ОтчетОРозничныхПродажах_Key eq " +
      "guid'12345678-1234-1234-1234-123456789abc'",
  );
  assert.equal(filter.includes("Date"), false);
});

test("completed check filter keeps archived receipts", () => {
  assert.equal(
    isCompletedCheck({ Posted: false, СтатусЧекаККМ: "Архивный" }),
    true,
  );
  assert.equal(
    isCompletedCheck({ Posted: false, СтатусЧекаККМ: "Пробитый" }),
    true,
  );
  assert.equal(
    isCompletedCheck({ Posted: true, СтатусЧекаККМ: "Аннулированный" }),
    false,
  );
  assert.equal(
    isCompletedCheck({ Posted: true, СтатусЧекаККМ: "Отложенный" }),
    false,
  );
  assert.equal(
    isCompletedCheck({ Posted: false, СтатусЧекаККМ: "1" }),
    true,
  );
  assert.equal(isCompletedCheck({ Posted: false }), true);
});

test("cash shifts restore the number of archived checks", () => {
  const result = summarizeCashShifts([
    {
      Date: "2026-08-10T20:00:00",
      Posted: true,
      DeletionMark: false,
      КоличествоЧеков: 120,
    },
    {
      Date: "2026-08-11T20:00:00",
      Posted: true,
      DeletionMark: false,
      КоличествоЧеков: 80,
    },
    {
      Date: "2026-08-12T20:00:00",
      Posted: false,
      DeletionMark: false,
      КоличествоЧеков: 50,
    },
  ]);

  assert.equal(result.checks, 200);
  assert.equal(result.latestDate, "2026-08-11T20:00:00");
});

test("check analytics includes discounts, returns and gift certificates", () => {
  const latestTimestamp = parseOnecDateTime("2025-08-20T20:00:00");
  const certificatePaymentKey = "certificate-payment";
  const checks = [
    {
      Date: "2025-08-20T10:00:00",
      ВидОперации: "Продажа",
      СуммаДокумента: 900,
      Товары: [
        {
          СуммаАвтоматическойСкидки: 70,
          СуммаРучнойСкидки: 20,
          СуммаСкидкиОплатыБонусом: 10,
        },
      ],
      Оплата: [
        { ВидОплаты_Key: certificatePaymentKey, Сумма: 400 },
        { ВидОплаты_Key: "cash", Сумма: 500 },
      ],
      ПогашениеПодарочныхСертификатов: [
        { LineNumber: 1, Количество: 2 },
      ],
    },
    {
      Date: "2025-08-20T12:00:00",
      ВидОперации: "Продажа",
      СуммаДокумента: 1100,
      Товары: [],
      Оплата: [],
      ПогашениеПодарочныхСертификатов: [],
    },
    {
      Date: "2025-08-20T13:00:00",
      ВидОперации: "Возврат",
      СуммаДокумента: 250,
    },
    {
      Date: "2025-08-19T10:00:00",
      ВидОперации: "Продажа",
      СуммаДокумента: 500,
    },
  ];

  const result = buildCheckAnalytics(
    checks,
    latestTimestamp,
    1,
    new Set([certificatePaymentKey]),
  );

  assert.equal(result.current.checks, 2);
  assert.equal(result.current.totalChecks, 3);
  assert.equal(result.current.revenue, 2000);
  assert.equal(result.current.averageCheck, 1000);
  assert.equal(result.current.netRevenue, 1750);
  assert.equal(result.current.grossRevenue, 2100);
  assert.equal(result.current.discounts, 100);
  assert.equal(result.current.returns, 1);
  assert.equal(result.current.returnsAmount, 250);
  assert.equal(result.current.certificatePayments, 400);
  assert.equal(result.current.certificatesUsed, 2);
  assert.equal(result.previous.checks, 1);
});

test("archived checks are restored from sales register documents", () => {
  const result = summarizeSalesDocuments([
    {
      ДокументПродажи: "sale-1",
      ДокументПродажи_Type: "StandardODATA.Document_ЧекККМ",
      КоличествоTurnover: 2,
      СтоимостьTurnover: 2_800,
      СтоимостьБезСкидокTurnover: 3_000,
    },
    {
      ДокументПродажи: "sale-2",
      ДокументПродажи_Type: "StandardODATA.Document_ЧекККМ",
      КоличествоTurnover: 1,
      СтоимостьTurnover: 1_000,
      СтоимостьБезСкидокTurnover: 1_000,
    },
    {
      ДокументПродажи: "return-1",
      ДокументПродажи_Type: "StandardODATA.Document_ЧекККМ",
      КоличествоTurnover: -1,
      СтоимостьTurnover: -500,
      СтоимостьБезСкидокTurnover: -500,
    },
  ]);

  assert.equal(result.totalChecks, 3);
  assert.equal(result.checks, 2);
  assert.equal(result.returns, 1);
  assert.equal(result.revenue, 3_800);
  assert.equal(result.returnsAmount, 500);
  assert.equal(result.netRevenue, 3_300);
  assert.equal(result.averageCheck, 1_900);
  assert.equal(result.discounts, 200);
});
test("day period uses calendar date instead of rolling 24 hours", () => {
  const latestTimestamp = parseOnecDateTime("2025-12-25T19:49:13");
  const checks = [
    {
      Date: "2025-12-25T10:00:00",
      ВидОперации: "Продажа",
      СуммаДокумента: 1000,
    },
    {
      Date: "2025-12-24T19:50:53",
      ВидОперации: "Продажа",
      СуммаДокумента: 500,
    },
  ];

  const result = buildCheckAnalytics(checks, latestTimestamp, 1);

  assert.equal(result.current.checks, 1);
  assert.equal(result.current.revenue, 1000);
  assert.equal(result.previous.checks, 1);
  assert.equal(result.previous.revenue, 500);
});

test("current-only analytics ignores the previous period", () => {
  const latestTimestamp = parseOnecDateTime("2025-12-25T19:49:13");
  const checks = [
    {
      Date: "2025-12-25T10:00:00",
      ВидОперации: "Продажа",
      СуммаДокумента: 1000,
    },
    {
      Date: "2025-12-24T10:00:00",
      ВидОперации: "Продажа",
      СуммаДокумента: 500,
    },
  ];

  const result = buildCheckAnalytics(
    checks,
    latestTimestamp,
    1,
    new Set(),
    false,
  );

  assert.equal(result.current.checks, 1);
  assert.equal(result.current.revenue, 1000);
  assert.equal(result.previous.checks, 0);
  assert.equal(result.previous.revenue, 0);
});
