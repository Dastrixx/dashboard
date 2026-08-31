import assert from "node:assert/strict";
import test from "node:test";

import { buildCheckAnalytics } from "../server/dashboard/checks.mjs";

test("check analytics includes discounts, returns and gift certificates", () => {
  const latestTimestamp = new Date("2025-08-20T20:00:00").getTime();
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
      ПогашениеПодарочныхСертификатов: [{ LineNumber: 1 }],
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
  assert.equal(result.current.revenue, 2000);
  assert.equal(result.current.averageCheck, 1000);
  assert.equal(result.current.grossRevenue, 2100);
  assert.equal(result.current.discounts, 100);
  assert.equal(result.current.returns, 1);
  assert.equal(result.current.returnsAmount, 250);
  assert.equal(result.current.certificatePayments, 400);
  assert.equal(result.current.certificatesUsed, 1);
  assert.equal(result.previous.checks, 1);
});
