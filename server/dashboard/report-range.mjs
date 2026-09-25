import { parseOnecDateTime, toOdataDateTime } from "./utils.mjs";

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

export async function loadReportsByRange({
  getPage,
  getHeaderPage,
  getByKey,
  fromTimestamp,
  endExclusive,
  pageSize,
  maxScanned = 10_000,
}) {
  const dateFilter = [
    "Posted eq true",
    `Date ge datetime'${toOdataDateTime(fromTimestamp)}'`,
    `Date lt datetime'${toOdataDateTime(endExclusive)}'`,
  ].join(" and ");
  const scan = (filter) => scanReportsByRange({
    getPage: (top, skip) => getPage(filter, top, skip),
    fromTimestamp,
    endExclusive,
    pageSize,
    maxScanned,
  });

  try {
    return await scan(dateFilter);
  } catch (error) {
    // Some 1C publications reject Date in OData WHERE. A timeout means the
    // service did not respond; retrying an even larger scan would double it.
    const message = String(error?.message || "");
    if (!/1С OData вернула HTTP (400|500)\b/.test(message) ||
        !/WHERE|Date|ORDER BY|datetime/i.test(message)) throw error;
    if (!getHeaderPage || !getByKey) return scan("Posted eq true");
    const headers = await scanReportsByRange({
      getPage: (top, skip) => getHeaderPage(top, skip),
      fromTimestamp,
      endExclusive,
      pageSize,
      maxScanned,
    });
    const reports = [];
    const concurrency = Math.min(
      Math.max(Number(process.env.ONEC_REPORT_HYDRATE_CONCURRENCY) || 3, 1),
      5,
    );
    for (let offset = 0; offset < headers.length; offset += concurrency) {
      const page = headers.slice(offset, offset + concurrency);
      const loaded = await Promise.all(page.map((header) => getByKey(header.Ref_Key)));
      reports.push(...loaded.filter((report) => {
        const timestamp = parseOnecDateTime(report.Date);
        return report.Posted && timestamp >= fromTimestamp && timestamp < endExclusive;
      }));
    }
    return reports;
  }
}
