export const dashboardData = {
  meta: {
    store: "3КВАДРАТА",
    city: "Астана",
    updatedAt: new Date().toISOString(),
    source: "demo",
  },
  access: {
    owner: {
      label: "Владелец",
      accountMode: "single",
      sections: ["overview"],
    },
    manager: {
      label: "Менеджер",
      accountMode: "personal",
      sections: ["products", "stock", "team", "procurement", "online"],
    },
  },
  overview: {
    kpis: {
      revenueToday: 486240,
      checksToday: 31,
      averageCheck: 15685,
      dayForecast: 742000,
      planCompletion: 66,
    },
    revenue: [420000, 480000, 450000, 580000, 510000, 670000, 720000, 640000, 780000, 810000, 760000, 910000, 880000, 1040000],
    categories: [
      { name: "Домашний текстиль", share: 48 },
      { name: "Посуда", share: 31 },
      { name: "Одежда", share: 13 },
      { name: "Бытовая химия", share: 8 },
    ],
  },
  products: [
    { sku: "PB-2401", name: "Комплект «Муслин», евро", category: "Домашний текстиль", revenue: 842000, sold: 48, stock: 12, abc: "A" },
    { sku: "DS-1042", name: "Набор столовой посуды", category: "Посуда", revenue: 719000, sold: 31, stock: 8, abc: "A" },
    { sku: "CL-0811", name: "Комплект одежды", category: "Одежда", revenue: 586000, sold: 42, stock: 21, abc: "A" },
    { sku: "HC-3405", name: "Средство для уборки", category: "Бытовая химия", revenue: 428000, sold: 64, stock: 35, abc: "B" },
    { sku: "PB-2167", name: "Комплект «Сатин», 2-сп.", category: "Домашний текстиль", revenue: 391000, sold: 25, stock: 4, abc: "B" },
    { sku: "DS-0918", name: "Набор чашек", category: "Посуда", revenue: 267000, sold: 37, stock: 58, abc: "B" },
  ],
  sellers: [
    { id: 1, name: "Аружан С.", revenue: 3210000, checks: 194, averageCheck: 16546, plan: 108 },
    { id: 2, name: "Диана К.", revenue: 2890000, checks: 182, averageCheck: 15879, plan: 96 },
    { id: 3, name: "Мадина А.", revenue: 2520000, checks: 173, averageCheck: 14566, plan: 84 },
    { id: 4, name: "Алия Н.", revenue: 2140000, checks: 156, averageCheck: 13718, plan: 71 },
  ],
};
