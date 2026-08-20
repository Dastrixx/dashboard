export type Role = "owner" | "manager";

export type Section =
  | "overview"
  | "products"
  | "stock"
  | "team"
  | "procurement"
  | "online";

export type NavigationItem = {
  id: Section;
  label: string;
};

export const OWNER_SECTIONS = ["overview"] as const;
export const MANAGER_SECTIONS = [
  "products",
  "stock",
  "team",
  "procurement",
  "online",
] as const;

export const DASHBOARD_ROUTES: Record<Role, Record<string, string>> = {
  owner: {
    overview: "/owner/overview",
  },
  manager: {
    products: "/manager/products",
    stock: "/manager/stock",
    team: "/manager/team",
    procurement: "/manager/procurement",
    online: "/manager/online",
  },
};

export const DEFAULT_DASHBOARD_ROUTE: Record<Role, string> = {
  owner: DASHBOARD_ROUTES.owner.overview,
  manager: DASHBOARD_ROUTES.manager.products,
};

export const NAVIGATION: Record<Role, NavigationItem[]> = {
  owner: [{ id: "overview", label: "Обзор" }],
  manager: [
    { id: "products", label: "Товары и продажи" },
    { id: "stock", label: "Склад и остатки" },
    { id: "team", label: "Продавцы" },
    { id: "procurement", label: "Закуп / Перемещение" },
    { id: "online", label: "Онлайн" },
  ],
};

export function isManagerSection(value: string): value is Section {
  return (MANAGER_SECTIONS as readonly string[]).includes(value);
}

export function dashboardRoute(role: Role, section: Section) {
  return DASHBOARD_ROUTES[role][section] || DEFAULT_DASHBOARD_ROUTE[role];
}
