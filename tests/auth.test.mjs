import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
