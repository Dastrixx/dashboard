import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashPassword, verifyPassword } from "./passwords.mjs";

const VALID_ROLES = new Set(["owner", "manager"]);
const DUMMY_PASSWORD_HASH =
  "scrypt$131072$8$1$RD3vd0vq57PPj9xbbWHcdw$U7yd6SULC9ZhuMuWnsO8_yCOKpOgeLvyH-GNRpj2_EzooI4bw0OrFzSXXStf2k47i95txCCPrKRYxb2XeI36Hw";

export class AuthStore {
  constructor({ databasePath, idleTimeoutMs, absoluteTimeoutMs }) {
    this.databasePath = databasePath === ":memory:"
      ? databasePath
      : resolve(databasePath);
    this.idleTimeoutMs = idleTimeoutMs;
    this.absoluteTimeoutMs = absoluteTimeoutMs;

    if (this.databasePath !== ":memory:") {
      mkdirSync(dirname(this.databasePath), { recursive: true });
    }

    this.db = new DatabaseSync(this.databasePath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'manager')),
        password_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        idle_expires_at INTEGER NOT NULL,
        absolute_expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx
        ON auth_sessions(user_id);
      CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx
        ON auth_sessions(idle_expires_at, absolute_expires_at);

      CREATE TABLE IF NOT EXISTS team_sales_plans (
        store_key TEXT NOT NULL,
        period_days INTEGER NOT NULL CHECK (period_days IN (1, 7, 30)),
        amount REAL NOT NULL CHECK (amount >= 0),
        updated_by TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (store_key, period_days)
      );
    `);
  }

  close() {
    this.db.close();
  }

  countUsers() {
    return Number(
      this.db.prepare("SELECT COUNT(*) AS count FROM auth_users").get().count,
    );
  }

  async createUser({ email, name, role, password }) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = String(name || "").trim();
    validateRole(role);
    if (!normalizedName) throw new Error("Укажите имя пользователя");
    if (role === "owner") {
      const owners = Number(
        this.db
          .prepare("SELECT COUNT(*) AS count FROM auth_users WHERE role = 'owner'")
          .get().count,
      );
      if (owners > 0) {
        throw new Error("Аккаунт владельца уже существует");
      }
    }

    const passwordHash = await hashPassword(password);
    const now = Date.now();
    const id = randomUUID();

    try {
      this.db.prepare(`
        INSERT INTO auth_users (
          id, email, name, role, password_hash, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).run(id, normalizedEmail, normalizedName, role, passwordHash, now, now);
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE")) {
        throw new Error(`Пользователь ${normalizedEmail} уже существует`);
      }
      throw error;
    }

    return { id, email: normalizedEmail, name: normalizedName, role };
  }

  deleteUser(id) {
    this.db.prepare("DELETE FROM auth_users WHERE id = ?").run(id);
  }

  async authenticate(email, password) {
    const normalizedEmail = normalizeEmail(email);
    const row = this.db.prepare(`
      SELECT id, email, name, role, password_hash AS passwordHash
      FROM auth_users
      WHERE email = ? AND active = 1
    `).get(normalizedEmail);

    if (!row) {
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      return null;
    }

    if (!(await verifyPassword(password, row.passwordHash))) {
      return null;
    }

    return publicUser(row);
  }

  createSession(userId) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const now = Date.now();
    const absoluteExpiresAt = now + this.absoluteTimeoutMs;
    const idleExpiresAt = Math.min(now + this.idleTimeoutMs, absoluteExpiresAt);

    this.cleanupExpiredSessions(now);
    this.db.prepare(`
      INSERT INTO auth_sessions (
        token_hash, user_id, created_at, last_seen_at,
        idle_expires_at, absolute_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      tokenHash,
      userId,
      now,
      now,
      idleExpiresAt,
      absoluteExpiresAt,
    );

    return { token, absoluteExpiresAt };
  }

  getSession(token) {
    if (!isValidToken(token)) return null;

    const tokenHash = hashToken(token);
    const now = Date.now();
    const row = this.db.prepare(`
      SELECT
        s.token_hash AS tokenHash,
        s.last_seen_at AS lastSeenAt,
        s.idle_expires_at AS idleExpiresAt,
        s.absolute_expires_at AS absoluteExpiresAt,
        u.id, u.email, u.name, u.role, u.active
      FROM auth_sessions s
      JOIN auth_users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `).get(tokenHash);

    if (
      !row ||
      !row.active ||
      row.idleExpiresAt <= now ||
      row.absoluteExpiresAt <= now
    ) {
      if (row) this.revokeSession(token);
      return null;
    }

    if (now - row.lastSeenAt >= 5 * 60_000) {
      const idleExpiresAt = Math.min(
        now + this.idleTimeoutMs,
        row.absoluteExpiresAt,
      );
      this.db.prepare(`
        UPDATE auth_sessions
        SET last_seen_at = ?, idle_expires_at = ?
        WHERE token_hash = ?
      `).run(now, idleExpiresAt, tokenHash);
    }

    return {
      user: publicUser(row),
      absoluteExpiresAt: row.absoluteExpiresAt,
    };
  }

  revokeSession(token) {
    if (!isValidToken(token)) return;
    this.db
      .prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
      .run(hashToken(token));
  }

  getTeamSalesPlan(storeKey, periodDays) {
    const row = this.db.prepare(`
      SELECT
        store_key AS storeKey,
        period_days AS periodDays,
        amount,
        updated_by AS updatedBy,
        updated_at AS updatedAt
      FROM team_sales_plans
      WHERE store_key = ? AND period_days = ?
    `).get(String(storeKey || "all"), Number(periodDays));

    return row || {
      storeKey: String(storeKey || "all"),
      periodDays: Number(periodDays),
      amount: 0,
      updatedBy: null,
      updatedAt: null,
    };
  }

  setTeamSalesPlan({ storeKey, periodDays, amount, updatedBy }) {
    const normalizedStoreKey = String(storeKey || "all");
    const normalizedPeriod = Number(periodDays);
    const normalizedAmount = Number(amount);
    if (![1, 7, 30].includes(normalizedPeriod)) {
      throw new Error("Период плана должен быть 1, 7 или 30 дней");
    }
    if (!Number.isFinite(normalizedAmount) || normalizedAmount < 0) {
      throw new Error("План продаж должен быть неотрицательным числом");
    }

    const updatedAt = Date.now();
    this.db.prepare(`
      INSERT INTO team_sales_plans (
        store_key, period_days, amount, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(store_key, period_days)
      DO UPDATE SET
        amount = excluded.amount,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      normalizedStoreKey,
      normalizedPeriod,
      normalizedAmount,
      updatedBy || null,
      updatedAt,
    );

    return this.getTeamSalesPlan(normalizedStoreKey, normalizedPeriod);
  }

  cleanupExpiredSessions(now = Date.now()) {
    this.db.prepare(`
      DELETE FROM auth_sessions
      WHERE idle_expires_at <= ? OR absolute_expires_at <= ?
    `).run(now, now);
  }
}

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254 || !email.includes("@")) {
    throw new Error("Укажите корректный email");
  }
  return email;
}

function validateRole(role) {
  if (!VALID_ROLES.has(role)) {
    throw new Error("Роль должна быть owner или manager");
  }
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
  };
}

function isValidToken(token) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(token);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
