import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  DEFAULT_DASHBOARD_ROUTE,
  type Role,
} from "./dashboard-routes";

export type DashboardUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export async function requireDashboardUser(
  requiredRole: Role,
): Promise<DashboardUser> {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie") || "";
  const apiUrl = (
    process.env.AUTH_API_INTERNAL_URL || "http://localhost:4000"
  ).replace(/\/$/, "");

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/auth/me`, {
      headers: { cookie },
      cache: "no-store",
    });
  } catch {
    throw new Error("Сервер авторизации недоступен");
  }

  if (response.status === 401) redirect("/login");
  if (!response.ok) throw new Error(`Ошибка авторизации HTTP ${response.status}`);

  const payload = (await response.json()) as { user?: DashboardUser };
  if (!payload.user) redirect("/login");
  if (payload.user.role !== requiredRole) {
    redirect(DEFAULT_DASHBOARD_ROUTE[payload.user.role]);
  }

  return payload.user;
}
