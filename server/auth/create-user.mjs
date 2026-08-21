import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";
import { AuthStore } from "./store.mjs";

const store = new AuthStore({
  databasePath: process.env.AUTH_DB_PATH || resolve("data/auth.sqlite"),
  idleTimeoutMs: 12 * 60 * 60_000,
  absoluteTimeoutMs: 7 * 24 * 60 * 60_000,
});
let terminal = createInterface({ input: stdin, output: stdout });

try {
  const email = await terminal.question("Email: ");
  const name = await terminal.question("Имя: ");
  const role = await terminal.question("Роль (owner/manager): ");
  terminal.close();
  terminal = null;
  const password = process.env.AUTH_NEW_USER_PASSWORD ||
    await readSecret("Пароль (минимум 12 символов): ");

  const user = await store.createUser({ email, name, role, password });
  console.log(`Пользователь создан: ${user.email} (${user.role})`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  terminal?.close();
  store.close();
}

function readSecret(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error(
      "Для неинтерактивного запуска передайте пароль через AUTH_NEW_USER_PASSWORD",
    );
  }

  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();

  return new Promise((resolvePassword, rejectPassword) => {
    let value = "";

    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    const onData = (chunk) => {
      const character = chunk.toString("utf8");
      if (character === "\u0003") {
        finish();
        rejectPassword(new Error("Создание пользователя отменено"));
        return;
      }
      if (character === "\r" || character === "\n") {
        finish();
        resolvePassword(value);
        return;
      }
      if (character === "\u007f") {
        if (value) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }
      if (/^[\x20-\x7E\u0080-\uFFFF]+$/u.test(character)) {
        value += character;
        stdout.write("*".repeat([...character].length));
      }
    };

    stdin.on("data", onData);
  });
}
