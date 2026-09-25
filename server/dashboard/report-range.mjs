import { parseOnecDateTime } from "./utils.mjs";

// Scan in descending date order to avoid a costly date-range filter in 1C.
export async function scanReportsByRange({
  getPage,
  fromTimestamp,
  toTimestamp,
  pageSize,
  limit = null,
  maxScanned = 5_000,
}) {
  const result = [];
  let offset = 0;
  let lastTimestamp = Infinity;

  while (offset < maxScanned) {
    const size = Math.min(pageSize, maxScanned - offset);
    const page = await getPage(size, offset);
    if (!Array.isArray(page) || page.length > size) {
      throw new Error("1С вернула некорректную страницу документов");
    }

    for (const report of page) {
      const timestamp = parseOnecDateTime(report.Date);
      if (!Number.isFinite(timestamp) || timestamp > lastTimestamp) {
        throw new Error("1С нарушила сортировку документов по дате");
      }
      lastTimestamp = timestamp;
      if (timestamp < fromTimestamp) return result;
      if (timestamp <= toTimestamp) result.push(report);
      if (limit !== null && result.length >= limit) return result;
    }

    offset += page.length;
    if (page.length < size) return result;
  }

  throw new Error(
    `Для выбранного периода нужно проверить более ${maxScanned} документов 1С; ` +
      "увеличьте ONEC_REPORT_MAX_SCAN, чтобы загрузить полный диапазон",
  );
}
