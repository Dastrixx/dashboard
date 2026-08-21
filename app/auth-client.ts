import type { Role } from "./dashboard-routes";

const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

type AuthResponse = {
  user: AuthUser;
  message?: string;
};

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function login(email: string, password: string) {
  return authRequest("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export async function getCurrentUser(signal?: AbortSignal) {
  return authRequest("/api/auth/me", { signal, cache: "no-store" });
}

export async function logout() {
  const response = await fetch(`${API_URL}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok && response.status !== 401) {
    const payload = (await safeJson(response)) as { message?: string };
    throw new AuthError(payload.message || "Не удалось завершить сессию", response.status);
  }
}

async function authRequest(path: string, init: RequestInit) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
  });
  const payload = (await safeJson(response)) as Partial<AuthResponse>;

  if (!response.ok || !payload.user) {
    throw new AuthError(
      payload.message || "Сессия недействительна",
      response.status,
    );
  }
  return payload.user;
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
