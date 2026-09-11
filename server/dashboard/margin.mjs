export function summarizeMarginRows(rows) {
  const totals = rows.reduce(
    (result, row) => ({
      revenue: result.revenue + Number(row.СтоимостьTurnover || 0),
      revenueBeforeDiscount:
        result.revenueBeforeDiscount +
        Number(row.СтоимостьБезСкидокTurnover || 0),
      cost:
        result.cost + Number(row.ор_СебестоимостьTurnover || 0),
    }),
    { revenue: 0, revenueBeforeDiscount: 0, cost: 0 },
  );
  const costAvailable =
    totals.revenue === 0 ||
    rows.some((row) => Number(row.ор_СебестоимостьTurnover || 0) !== 0);
  const discounts = Math.max(
    totals.revenueBeforeDiscount - totals.revenue,
    0,
  );
  const profit = costAvailable ? totals.revenue - totals.cost : 0;
  const efficiencyPercent =
    costAvailable && totals.cost > 0 ? (profit / totals.cost) * 100 : 0;

  return {
    ...totals,
    discounts,
    discountShare: totals.revenueBeforeDiscount > 0
      ? (discounts / totals.revenueBeforeDiscount) * 100
      : 0,
    profit,
    dataAvailable: costAvailable,
    marginPercent:
      costAvailable && totals.revenue > 0
        ? (profit / totals.revenue) * 100
        : 0,
    efficiencyPercent,
  };
}
