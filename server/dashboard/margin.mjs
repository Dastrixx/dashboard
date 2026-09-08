export function summarizeMarginRows(rows) {
  const totals = rows.reduce(
    (result, row) => ({
      revenue: result.revenue + Number(row.СтоимостьTurnover || 0),
      cost:
        result.cost + Number(row.ор_СебестоимостьTurnover || 0),
    }),
    { revenue: 0, cost: 0 },
  );
  const profit = totals.revenue - totals.cost;

  return {
    ...totals,
    profit,
    marginPercent:
      totals.revenue > 0 ? (profit / totals.revenue) * 100 : 0,
  };
}
