import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SCRYPT_N = 131_072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;

export async function hashPassword(password) {
  validatePassword(password);

  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password, storedHash) {
  if (typeof password !== "string" || typeof storedHash !== "string") {
    return false;
  }

  const [algorithm, rawN, rawR, rawP, rawSalt, rawKey] = storedHash.split("$");
  if (algorithm !== "scrypt" || !rawSalt || !rawKey) return false;

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (![N, r, p].every(Number.isSafeInteger)) return false;

  try {
    const expected = Buffer.from(rawKey, "base64url");
    const actual = await deriveKey(password, Buffer.from(rawSalt, "base64url"), {
      N,
      r,
      p,
    });

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 12) {
    throw new Error("Пароль должен содержать не менее 12 символов");
  }
  if (password.length > 256) {
    throw new Error("Пароль слишком длинный");
  }
}

function deriveKey(password, salt, parameters) {
  return scrypt(password, salt, KEY_LENGTH, {
    ...parameters,
    maxmem: SCRYPT_MAX_MEMORY,
  });
}
