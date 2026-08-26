import {
  RETAIL_REPORT_ENTITY,
  RETAIL_REPORT_SELECT,
} from "../server/dashboard/constants.mjs";
import {
  describeDataFreshness,
  normalizeOnecDateTime,
  resolveBusinessCategory,
} from "../server/dashboard/utils.mjs";
import { onecBalance, onecGet } from "../server/onec.mjs";

const sampleSize = Math.min(
  Math.max(Number(process.env.ONEC_AUDIT_SAMPLE_SIZE || 100), 10),
  500,
);
const warnings = [];
const errors = [];

function amount(value) {
  return Number(value || 0);
}

function sumLines(lines = []) {
  return lines.reduce((sum, line) => sum + amount(line.Сумма), 0);
}

function discrepancy(left, right) {
  return Math.abs(left - right) > 0.01;
}

function freshnessCheck(label, value) {
  const freshness = describeDataFreshness(value);
  if (freshness.status !== "fresh") {
    errors.push(
      `${label}: ${freshness.status}; возраст ${freshness.ageHours ?? "неизвестен"} ч.`,
    );
  }
  return freshness;
}

async function auditReports() {
  const reports = await onecGet(RETAIL_REPORT_ENTITY, {
    $top: sampleSize,
    $select: RETAIL_REPORT_SELECT,
    $filter: "Posted eq true",
    $orderby: "Date desc",
  });
  const salesMismatches = [];
  const returnMismatches = [];
  let salesLines = 0;
  let returnLines = 0;

  for (const report of reports) {
    const salesTotal = sumLines(report.Товары);
    const returnsTotal = sumLines(report.ВозвращенныеТовары);
    salesLines += (report.Товары || []).length;
    returnLines += (report.ВозвращенныеТовары || []).length;

    if (discrepancy(salesTotal, amount(report.СуммаДокумента))) {
      salesMismatches.push({
        number: report.Number,
        date: normalizeOnecDateTime(report.Date),
        header: amount(report.СуммаДокумента),
        lines: salesTotal,
      });
    }
    if (
      (report.ВозвращенныеТовары || []).length > 0 &&
      discrepancy(returnsTotal, amount(report.СуммаВозвратов))
    ) {
      returnMismatches.push({
        number: report.Number,
        date: normalizeOnecDateTime(report.Date),
        header: amount(report.СуммаВозвратов),
        lines: returnsTotal,
      });
    }
  }

  if (!reports.length) errors.push("Нет проведённых отчётов о розничных продажах.");
  if (salesMismatches.length) {
    warnings.push(
      `В ${salesMismatches.length} отчётах сумма шапки не совпадает с суммой товарных строк.`,
    );
  }
  if (returnMismatches.length) {
    warnings.push(
      `В ${returnMismatches.length} отчётах сумма возврата не совпадает со строками возврата.`,
    );
  }

  const latestDate = reports[0]?.Date || null;
  return {
    loaded: reports.length,
    sampleLimit: sampleSize,
    latestDate: latestDate ? normalizeOnecDateTime(latestDate) : null,
    freshness: freshnessCheck("Отчёты о продажах", latestDate),
    salesLines,
    returnLines,
    grossRevenue: reports.reduce(
      (sum, report) => sum + amount(report.СуммаДокумента),
      0,
    ),
    returns: reports.reduce(
      (sum, report) => sum + amount(report.СуммаВозвратов),
      0,
    ),
    salesMismatches: salesMismatches.slice(0, 10),
    returnMismatches: returnMismatches.slice(0, 10),
  };
}

async function auditChecks() {
  const checks = await onecGet("Document_ЧекККМ", {
    $top: sampleSize,
    $select: [
      "Ref_Key",
      "Number",
      "Date",
      "Posted",
      "ВидОперации",
      "СуммаДокумента",
      "Товары",
      "Оплата",
      "ПогашениеПодарочныхСертификатов",
    ].join(","),
    $filter: "Posted eq true",
    $orderby: "Date desc",
  });
  const returns = checks.filter((check) =>
    /возврат/i.test(String(check.ВидОперации || "")),
  );
  const sales = checks.filter((check) => !returns.includes(check));
  const latestDate = checks[0]?.Date || null;
  const lines = checks.flatMap((check) => check.Товары || []);

  if (!checks.length) errors.push("Нет проведённых чеков ККМ.");

  return {
    loaded: checks.length,
    sampleLimit: sampleSize,
    latestDate: latestDate ? normalizeOnecDateTime(latestDate) : null,
    freshness: freshnessCheck("Чеки ККМ", latestDate),
    salesChecks: sales.length,
    returnChecks: returns.length,
    salesAmount: sales.reduce(
      (sum, check) => sum + amount(check.СуммаДокумента),
      0,
    ),
    returnsAmount: returns.reduce(
      (sum, check) => sum + Math.abs(amount(check.СуммаДокумента)),
      0,
    ),
    lines: lines.length,
    linesWithProduct: lines.filter((line) => line.Номенклатура_Key).length,
    linesWithSeller: lines.filter(
      (line) =>
        line.Продавец_Key &&
        line.Продавец_Key !== "00000000-0000-0000-0000-000000000000",
    ).length,
    discountAmount: lines.reduce(
      (sum, line) =>
        sum +
        amount(line.СуммаАвтоматическойСкидки) +
        amount(line.СуммаРучнойСкидки) +
        amount(line.СуммаСкидкиОплатыБонусом),
      0,
    ),
    certificateRows: checks.reduce(
      (sum, check) =>
        sum + (check.ПогашениеПодарочныхСертификатов || []).length,
      0,
    ),
  };
}

async function auditCatalog() {
  const [products, kinds] = await Promise.all([
    onecGet("Catalog_Номенклатура", {
      $top: 500,
      $select: "Ref_Key,Description,Артикул,ВидНоменклатуры_Key",
    }),
    onecGet("Catalog_ВидыНоменклатуры", {
      $top: 500,
      $select: "Ref_Key,Description",
    }),
  ]);
  const kindByKey = new Map(kinds.map((kind) => [kind.Ref_Key, kind]));
  const categoryCounts = new Map();
  let withoutKind = 0;
  let unclassified = 0;

  for (const product of products) {
    const kind = kindByKey.get(product.ВидНоменклатуры_Key);
    if (!kind) withoutKind += 1;
    const category = resolveBusinessCategory(kind?.Description);
    if (!category) {
      unclassified += 1;
      continue;
    }
    categoryCounts.set(
      category.Description,
      (categoryCounts.get(category.Description) || 0) + 1,
    );
  }

  if (withoutKind) warnings.push(`${withoutKind} товаров не имеют найденного вида номенклатуры.`);
  if (unclassified) warnings.push(`${unclassified} товаров не сопоставлены с четырьмя бизнес-категориями.`);

  return {
    loadedProducts: products.length,
    loadedKinds: kinds.length,
    withoutKind,
    unclassified,
    categories: Object.fromEntries(categoryCounts),
  };
}

async function auditStock() {
  const balances = await onecBalance("AccumulationRegister_ТоварыНаСкладах", {
    period: new Date(),
    dimensions: "Склад,Номенклатура",
    top: 1000,
    select: "Склад_Key,Номенклатура_Key,КоличествоBalance,РезервBalance",
  });
  if (balances.length >= 1000) {
    warnings.push("Выборка остатков достигла лимита аудита 1000 строк.");
  }
  return {
    loaded: balances.length,
    sampleLimit: 1000,
    negativeQuantityRows: balances.filter(
      (row) => amount(row.КоличествоBalance) < 0,
    ).length,
    missingWarehouseRows: balances.filter((row) => !row.Склад_Key).length,
    missingProductRows: balances.filter((row) => !row.Номенклатура_Key).length,
  };
}

try {
  const result = {
    checkedAt: new Date().toISOString(),
    timezoneOffsetMinutes: Number(
      process.env.ONEC_TIMEZONE_OFFSET_MINUTES || 360,
    ),
    reports: await auditReports(),
    checks: await auditChecks(),
    catalog: await auditCatalog(),
    stock: await auditStock(),
  };

  console.log(JSON.stringify({ ok: errors.length === 0, ...result, warnings, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        warnings,
        errors,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
