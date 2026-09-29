// A short, sequential connectivity check. Never print credentials or row data.
process.env.ONEC_TIMEOUT_MS = String(
  Math.min(Math.max(Number(process.env.ONEC_PROBE_TIMEOUT_MS) || 10_000, 1_000), 30_000),
);
process.env.ONEC_RETRIES = "0";

const { onecGet } = await import("../server/onec.mjs");
const { RETAIL_REPORT_ENTITY, RETAIL_REPORT_SELECT } = await import(
  "../server/dashboard/constants.mjs"
);

const probes = [
  ["Простое чтение справочника", "Catalog_Склады", {
    $top: 1,
    $select: "Ref_Key",
  }],
  ["Заголовок отчёта без сортировки", RETAIL_REPORT_ENTITY, {
    $top: 1,
    $select: "Ref_Key,Date",
  }],
  ["Текущий запрос отчёта с товарами", RETAIL_REPORT_ENTITY, {
    $top: 1,
    $select: RETAIL_REPORT_SELECT,
    $filter: "Posted eq true",
    $orderby: "Date desc",
  }],
];

for (const [name, entity, params] of probes) {
  const start = performance.now();
  try {
    const rows = await onecGet(entity, params);
    console.log(`${name}: OK ${Math.round(performance.now() - start)} мс, строк: ${rows.length}`);
  } catch (error) {
    console.error(`${name}: ОШИБКА ${Math.round(performance.now() - start)} мс`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    break;
  }
}
