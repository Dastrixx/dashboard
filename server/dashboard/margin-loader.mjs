import {
  onecGet,
  onecSliceLast,
  onecTurnovers,
} from "../onec.mjs";
import { summarizeMarginRows } from "./margin.mjs";
import { loadSalesDocuments } from "./sales-register.mjs";
import { salesChannelFromOrder } from "./sales-channels.mjs";
import { toOdataDateTime } from "./utils.mjs";

const SALES_REGISTER = "AccumulationRegister_Продажи";
const RAW_SALES_REGISTER = `${SALES_REGISTER}_RecordType`;
const COST_REGISTER = "InformationRegister_СебестоимостьНоменклатуры";
const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";
const MAX_GROUPED_ROWS = 50_000;

function filterRows(rows, storeKey, channel) {
  return rows.filter((row) => {
    const matchesStore =
      storeKey === "all" || row.Магазин_Key === storeKey;
    const matchesChannel =
      channel === "all" ||
      salesChannelFromOrder(row.ЗаказПокупателя_Key) === channel;

    return matchesStore && matchesChannel;
  });
}

function rawRowKey(row) {
  return [row.Recorder_Type, row.Recorder, row.LineNumber].join(":");
}

function costKey(row) {
  return [
    row.Магазин_Key || EMPTY_GUID,
    row.Номенклатура_Key || EMPTY_GUID,
    row.Характеристика_Key || EMPTY_GUID,
  ].join(":");
}

function summaryWithSource(summary, costSource) {
  return { ...summary, costSource };
}

async function tryMarginSource(source, load) {
  try {
    return await load();
  } catch (error) {
    console.warn(
      `Не удалось рассчитать маржу из источника ${source}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export function summarizeMarginWithSnapshotCosts(
  salesRows,
  costRows,
  marginSummary,
) {
  const costByProduct = new Map(
    costRows.map((row) => [costKey(row), Number(row.Цена || 0)]),
  );
  const missingCost = salesRows.some(
    (row) => !costByProduct.has(costKey(row)),
  );
  if (missingCost) return null;

  const cost = salesRows.reduce(
    (total, row) =>
      total +
      Number(row.КоличествоTurnover || 0) *
        costByProduct.get(costKey(row)),
    0,
  );
  if (marginSummary.revenue > 0 && cost <= 0) return null;

  return summarizeMarginRows([
    {
      СтоимостьTurnover: marginSummary.revenue,
      СтоимостьБезСкидокTurnover:
        marginSummary.revenueBeforeDiscount,
      ор_СебестоимостьTurnover: cost,
    },
  ]);
}

async function calculateCostFromSnapshot({
  startDate,
  endDate,
  storeKey,
  channel,
  marginSummary,
}) {
  const dimensions = [
    "Магазин",
    "Номенклатура",
    "Характеристика",
    ...(channel === "all" ? [] : ["ЗаказПокупателя"]),
  ];
  const salesRows = await onecTurnovers(SALES_REGISTER, {
    startPeriod: startDate,
    endPeriod: endDate,
    dimensions: dimensions.join(","),
    top: MAX_GROUPED_ROWS + 1,
    select: [
      "Магазин_Key",
      "Номенклатура_Key",
      "Характеристика_Key",
      ...(channel === "all" ? [] : ["ЗаказПокупателя_Key"]),
      "КоличествоTurnover",
    ].join(","),
  });

  if (salesRows.length > MAX_GROUPED_ROWS) {
    throw new Error(
      "Слишком много товарных строк для расчёта маржи",
    );
  }

  const scopedSalesRows = filterRows(salesRows, storeKey, channel)
    .filter((row) => Number(row.КоличествоTurnover || 0) !== 0);
  if (!scopedSalesRows.length) return null;

  const costRows = await onecSliceLast(COST_REGISTER, {
    period: new Date(endDate.getTime() - 1),
    top: MAX_GROUPED_ROWS + 1,
    select: [
      "Магазин_Key",
      "Номенклатура_Key",
      "Характеристика_Key",
      "Цена",
    ].join(","),
  });

  if (costRows.length > MAX_GROUPED_ROWS) {
    throw new Error(
      "Слишком много записей себестоимости для расчёта маржи",
    );
  }

  return summarizeMarginWithSnapshotCosts(
    scopedSalesRows,
    costRows,
    marginSummary,
  );
}

async function loadRawMarginRows(startDate, endDate) {
  const pageSize = Math.min(
    Math.max(Number(process.env.ONEC_PAGE_SIZE || 100), 1),
    100,
  );
  const maxRows = Math.max(
    Number(process.env.ONEC_MARGIN_RAW_LIMIT || 100_000),
    pageSize,
  );
  const filter = [
    "Active eq true",
    `Period ge datetime'${toOdataDateTime(startDate.getTime())}'`,
    `Period lt datetime'${toOdataDateTime(endDate.getTime())}'`,
  ].join(" and ");
  const rowsByKey = new Map();
  let offset = 0;

  while (offset < maxRows) {
    const page = await onecGet(RAW_SALES_REGISTER, {
      $top: pageSize,
      $skip: offset,
      $select: [
        "Recorder",
        "Recorder_Type",
        "LineNumber",
        "Period",
        "Active",
        "Магазин_Key",
        "Склад_Key",
        "Номенклатура_Key",
        "ЗаказПокупателя_Key",
        "Стоимость",
        "СтоимостьБезСкидок",
        "ор_Себестоимость",
      ].join(","),
      $filter: filter,
    });

    page.forEach((row) => rowsByKey.set(rawRowKey(row), row));
    offset += page.length;

    if (page.length < pageSize) break;
  }

  if (offset >= maxRows) {
    throw new Error(
      `Достигнут лимит исходных движений маржи: ${maxRows}`,
    );
  }

  return [...rowsByKey.values()].map((row) => ({
    ...row,
    СтоимостьTurnover: row.Стоимость,
    СтоимостьБезСкидокTurnover: row.СтоимостьБезСкидок,
    ор_СебестоимостьTurnover: row.ор_Себестоимость,
  }));
}

export async function loadMarginPeriod(
  startDate,
  endDate,
  storeKey = "all",
  channel = "all",
) {
  const dimensions = [
    "Магазин",
    "Склад",
    "Номенклатура",
    "Характеристика",
    ...(channel === "all" ? [] : ["ЗаказПокупателя"]),
  ];
  const rows = await onecTurnovers(SALES_REGISTER, {
    startPeriod: startDate,
    endPeriod: endDate,
    dimensions: dimensions.join(","),
    top: MAX_GROUPED_ROWS,
    select: [
      "Магазин_Key",
      "Склад_Key",
      "Номенклатура_Key",
      "Характеристика_Key",
      ...(channel === "all" ? [] : ["ЗаказПокупателя_Key"]),
      "СтоимостьTurnover",
      "СтоимостьБезСкидокTurnover",
      "ор_СебестоимостьTurnover",
    ].join(","),
  });
  const scopedRows = filterRows(rows, storeKey, channel);
  const summary = summarizeMarginRows(scopedRows);

  if (summary.dataAvailable || !scopedRows.length) {
    return summaryWithSource(summary, "sales-turnovers");
  }

  const rawSummary = await tryMarginSource(
    "движения регистра Продажи",
    async () => {
      const rawRows = await loadRawMarginRows(startDate, endDate);
      return summarizeMarginRows(
        filterRows(rawRows, storeKey, channel),
      );
    },
  );
  if (rawSummary?.dataAvailable) {
    return summaryWithSource(rawSummary, "raw-sales-movements");
  }

  const documentSummary = await tryMarginSource(
    "обороты по документам продаж",
    async () => {
      const documentResult = await loadSalesDocuments({
        startDate,
        endDate,
        includeSalesChannel: channel !== "all",
      });
      const documentRows = filterRows(
        documentResult.rows,
        storeKey,
        channel,
      );
      return summarizeMarginRows(documentRows);
    },
  );
  if (documentSummary?.dataAvailable) {
    return summaryWithSource(documentSummary, "sales-documents");
  }

  const calculatedSummary = await tryMarginSource(
    "срез последних цен себестоимости",
    () =>
      calculateCostFromSnapshot({
        startDate,
        endDate,
        storeKey,
        channel,
        marginSummary: summary,
      }),
  );
  if (calculatedSummary?.dataAvailable) {
    return summaryWithSource(calculatedSummary, "cost-snapshot");
  }

  return summaryWithSource(summary, "unavailable");
}
