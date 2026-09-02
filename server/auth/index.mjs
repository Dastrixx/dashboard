import { resolve } from "node:path";
import { Router } from "express";
import { AuthStore } from "./store.mjs";

export const AUTH_COOKIE_NAME = "analytics_session";

const idleTimeoutMs = hoursToMs(process.env.AUTH_IDLE_TIMEOUT_HOURS, 12);
const absoluteTimeoutMs = hoursToMs(
  process.env.AUTH_ABSOLUTE_TIMEOUT_HOURS,
  168,
);

export const authStore = new AuthStore({
  databasePath: process.env.AUTH_DB_PATH || resolve("data/auth.sqlite"),
  idleTimeoutMs,
  absoluteTimeoutMs,
});

const loginAttempts = new Map();

export async function initializeAuth() {
  const rawUsers = process.env.AUTH_BOOTSTRAP_USERS;
  if (!rawUsers || authStore.countUsers() > 0) return;

  let users;
  try {
    users = JSON.parse(rawUsers);
  } catch {
    throw new Error("AUTH_BOOTSTRAP_USERS должен содержать корректный JSON");
  }
  if (!Array.isArray(users) || !users.length) {
    throw new Error("AUTH_BOOTSTRAP_USERS должен быть непустым массивом");
  }

  const createdUsers = [];
  try {
    for (const user of users) {
      createdUsers.push(await authStore.createUser(user));
    }
  } catch (error) {
    createdUsers.forEach((user) => authStore.deleteUser(user.id));
    throw error;
  }
  console.log(`Созданы начальные пользователи: ${users.length}`);
}

export function createAuthRouter() {
  const router = Router();

  router.post("/login", verifyRequestOrigin, async (request, response) => {
    const email = String(request.body?.email || "").trim().toLowerCase();
    const password = String(request.body?.password || "");
    const attemptKeys = [
      { key: `ip:${request.ip}`, limit: 20 },
      { key: `account:${email}`, limit: 5 },
    ];

    if (attemptKeys.some(({ key, limit }) => isRateLimited(key, limit))) {
      response.set("Retry-After", "900");
      return response.status(429).json({
        message: "Слишком много попыток. Повторите вход через 15 минут",
      });
    }

    try {
      const user = await authStore.authenticate(email, password);
      if (!user) {
        attemptKeys.forEach(({ key }) => registerFailedAttempt(key));
        return response.status(401).json({ message: "Неверный логин или пароль" });
      }

      attemptKeys.forEach(({ key }) => loginAttempts.delete(key));
      const session = authStore.createSession(user.id);
      response.setHeader(
        "Set-Cookie",
        serializeSessionCookie(request, session.token, session.absoluteExpiresAt),
      );
      response.set("Cache-Control", "no-store");
      return response.json({ user });
    } catch (error) {
      console.error("Ошибка авторизации:", error);
      return response.status(400).json({
        message: error instanceof Error ? error.message : "Не удалось выполнить вход",
      });
    }
  });

  router.get("/me", authenticateRequest, (request, response) => {
    response.set("Cache-Control", "no-store");
    response.json({ user: request.auth.user });
  });

  router.post("/logout", verifyRequestOrigin, (request, response) => {
    const token = readSessionToken(request);
    if (token) authStore.revokeSession(token);
    response.setHeader("Set-Cookie", clearSessionCookie(request));
    response.set("Cache-Control", "no-store");
    response.status(204).end();
  });

  return router;
}

export function authenticateRequest(request, response, next) {
  const token = readSessionToken(request);
  const session = token ? authStore.getSession(token) : null;

  if (!session) {
    if (token) response.setHeader("Set-Cookie", clearSessionCookie(request));
    return response.status(401).json({ message: "Требуется вход в систему" });
  }

  request.auth = session;
  return next();
}

export function authorizeDashboardApi(request, response, next) {
  if (request.auth.user.role === "manager") return next();

  const ownerGetRoutes = new Set([
    "/api/dashboard/onec-reports",
    "/api/dashboard/onec-check-analytics",
    "/api/dashboard/onec-product-categories",
    "/api/dashboard/onec-margin",
  ]);
  const pathname = request.originalUrl.split("?", 1)[0];
  if (request.method === "GET" && ownerGetRoutes.has(pathname)) {
    return next();
  }

  return response.status(403).json({ message: "Недостаточно прав" });
}

export function verifyRequestOrigin(request, response, next) {
  const origin = request.get("origin");
  if (!origin) return next();

  const fetchSite = request.get("sec-fetch-site");
  if (fetchSite === "same-origin") return next();

  const configuredOrigins = String(process.env.CLIENT_URL || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const forwardedHost = request.get("x-forwarded-host");
  const host = forwardedHost || request.get("host");

  try {
    const originUrl = new URL(origin);
    if (originUrl.host === host || configuredOrigins.includes(originUrl.origin)) {
      return next();
    }
  } catch {
    // Некорректный Origin отклоняется ниже.
  }

  return response.status(403).json({ message: "Недопустимый источник запроса" });
}

export function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  const configured = String(process.env.CLIENT_URL || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return configured.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin);
}

function readSessionToken(request) {
  const cookie = request.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === AUTH_COOKIE_NAME) {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return null;
}

function serializeSessionCookie(request, token, expiresAt) {
  const attributes = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (usesSecureCookies(request)) attributes.push("Secure");
  return attributes.join("; ");
}

function clearSessionCookie(request) {
  const attributes = [
    `${AUTH_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
  ];
  if (usesSecureCookies(request)) attributes.push("Secure");
  return attributes.join("; ");
}

function usesSecureCookies(request) {
  const configured = String(process.env.AUTH_COOKIE_SECURE || "auto").toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return (
    request.secure ||
    request.get("x-forwarded-proto") === "https" ||
    String(request.get("origin") || "").startsWith("https://")
  );
}

function isRateLimited(key, limit) {
  const state = loginAttempts.get(key);
  if (!state) return false;
  if (state.resetAt <= Date.now()) {
    loginAttempts.delete(key);
    return false;
  }
  return state.count >= limit;
}

function registerFailedAttempt(key) {
  const now = Date.now();
  if (loginAttempts.size >= 10_000) {
    for (const [attemptKey, state] of loginAttempts) {
      if (state.resetAt <= now) loginAttempts.delete(attemptKey);
    }
    if (loginAttempts.size >= 10_000) {
      loginAttempts.delete(loginAttempts.keys().next().value);
    }
  }
  const state = loginAttempts.get(key);
  if (!state || state.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
    return;
  }
  state.count += 1;
}

function hoursToMs(rawValue, fallbackHours) {
  const hours = Number(rawValue || fallbackHours);
  return Math.max(hours, 1) * 60 * 60_000;
}
