import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { AuthStore } from "../server/auth/store.mjs";
import { hashPassword, verifyPassword } from "../server/auth/passwords.mjs";

test("пароль хранится как scrypt-хеш и корректно проверяется", async () => {
  const hash = await hashPassword("correct horse battery staple");

  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("wrong password", hash), false);
  assert.equal(hash.includes("correct horse battery staple"), false);
});

test("сессия создаётся, возвращает пользователя и отзывается", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-auth-"));
  const store = new AuthStore({
    databasePath: join(directory, "auth.sqlite"),
    idleTimeoutMs: 60_000,
    absoluteTimeoutMs: 120_000,
  });

  try {
    const user = await store.createUser({
      email: "Owner@Example.com",
      name: "Владелец",
      role: "owner",
      password: "a strong owner password",
    });

    assert.equal(await store.authenticate(user.email, "wrong password"), null);
    assert.deepEqual(
      await store.authenticate("owner@example.com", "a strong owner password"),
      user,
    );

    const session = store.createSession(user.id);
    assert.equal(store.getSession(session.token)?.user.email, "owner@example.com");

    store.revokeSession(session.token);
    assert.equal(store.getSession(session.token), null);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("планы команды хранятся отдельно для всех, онлайн и офлайн продаж", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-team-plan-"));
  const store = new AuthStore({
    databasePath: join(directory, "auth.sqlite"),
    idleTimeoutMs: 60_000,
    absoluteTimeoutMs: 120_000,
  });

  try {
    store.setTeamSalesPlan({
      storeKey: "all",
      periodDays: 30,
      channel: "all",
      amount: 3_000_000,
    });
    store.setTeamSalesPlan({
      storeKey: "all",
      periodDays: 30,
      channel: "online",
      amount: 1_200_000,
    });
    store.setTeamSalesPlan({
      storeKey: "all",
      periodDays: 30,
      channel: "offline",
      amount: 1_800_000,
    });

    assert.equal(store.getTeamSalesPlan("all", 30, "all").amount, 3_000_000);
    assert.equal(store.getTeamSalesPlan("all", 30, "online").amount, 1_200_000);
    assert.equal(store.getTeamSalesPlan("all", 30, "offline").amount, 1_800_000);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("старый общий план сохраняется при добавлении каналов продаж", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-plan-migration-"));
  const databasePath = join(directory, "auth.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE team_sales_plans (
      store_key TEXT NOT NULL,
      period_days INTEGER NOT NULL,
      amount REAL NOT NULL,
      updated_by TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (store_key, period_days)
    );
    INSERT INTO team_sales_plans VALUES ('all', 30, 2500000, NULL, 1);
  `);
  legacy.close();

  const store = new AuthStore({
    databasePath,
    idleTimeoutMs: 60_000,
    absoluteTimeoutMs: 120_000,
  });

  try {
    assert.equal(store.getTeamSalesPlan("all", 30, "all").amount, 2_500_000);
    assert.equal(store.getTeamSalesPlan("all", 30, "online").amount, 0);
    assert.equal(store.getTeamSalesPlan("all", 30, "offline").amount, 0);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
