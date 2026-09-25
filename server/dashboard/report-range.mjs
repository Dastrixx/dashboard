import { parseOnecDateTime } from "./utils.mjs";

// Read posted reports in date order without the 1C date predicate that some
// installations reject. A scan limit must fail explicitly, never return
// incomplete sales totals for the selected period.
export async function scanReportsByRange({
  getPage,
  fromTimestamp,
  endExclusive,
  pageSize,
  maxScanned = 10_000,
}) {
  const result = [];
  let scanned = 0;
  let lastTimestamp = Infinity;

  while (scanned < maxScanned) {
    const size = Math.min(pageSize, maxScanned - scanned);
    const page = await getPage(size, scanned);
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
      if (timestamp < endExclusive) result.push(report);
    }
    scanned += page.length;
    if (page.length < size) return result;
  }
  throw new Error(
    `Для выбранного периода нужно проверить более ${maxScanned} документов 1С; ` +
      "увеличьте ONEC_REPORT_MAX_SCAN, чтобы загрузить полный диапазон",
  );
}
