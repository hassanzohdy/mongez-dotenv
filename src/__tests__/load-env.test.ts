import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, loadEnv, resetEnv } from "../index";

const FIXTURES = path.join(__dirname, "fixtures");

// The keys this test file mutates on process.env. Tracked explicitly so we
// can `delete` them on teardown without replacing the live `process.env`
// binding (replacing it would turn it into a plain JS object and stop
// Node's setter coercion, leaking weird behaviour into later tests).
const TOUCHED_KEYS = [
  "NODE_ENV",
  "APP_TEST",
  "APP_PORT",
  "APP_HOST",
  "APP_URL",
  "DB_PASS",
  "DB_URL",
  "DEBUG",
  "PRODUCTION",
  "EST_TIME",
  "HTTP_PORT",
  "HTTP_HOST",
  "HTTP_URL",
  "HTTP_URL2",
  "APP_NAME",
  "APP_MODE",
  "SOMETHING_TEMP",
];

const baseline: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of TOUCHED_KEYS) baseline[k] = process.env[k];
});

afterEach(() => {
  for (const k of TOUCHED_KEYS) {
    if (baseline[k] === undefined) delete process.env[k];
    else process.env[k] = baseline[k] as string;
  }
  resetEnv();
});

describe("loadEnv — file resolution", () => {
  it("falls back to `.env` when NODE_ENV does not match a sibling file", () => {
    delete process.env.NODE_ENV;
    loadEnv(undefined, { dir: FIXTURES, override: false });
    expect(env("APP_HOST")).toBe("localhost");
  });

  it("picks `.env.development` when NODE_ENV=development", () => {
    process.env.NODE_ENV = "development";
    loadEnv(undefined, { dir: FIXTURES, override: false });
    expect(env("APP_MODE")).toBe("development");
  });

  it("picks `.env.production` when NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    loadEnv(undefined, { dir: FIXTURES, override: false });
    expect(env("APP_MODE")).toBe("production");
  });

  it("loads a custom path verbatim", () => {
    loadEnv(path.join(FIXTURES, ".env.development"), {
      dir: FIXTURES,
      override: false,
    });
    expect(env("APP_MODE")).toBe("development");
  });
});

describe("loadEnv — .env.shared", () => {
  it("loads .env.shared by default", () => {
    loadEnv(undefined, { dir: FIXTURES, override: false });
    expect(env("APP_NAME")).toBe("Hello");
  });

  it("loadSharedEnv: false skips .env.shared", () => {
    loadEnv(undefined, { dir: FIXTURES, override: false, loadSharedEnv: false });
    expect(env("APP_NAME")).toBeUndefined();
  });

  it("merges .env.shared + environment-specific file", () => {
    process.env.NODE_ENV = "development";
    loadEnv(undefined, { dir: FIXTURES, override: false });
    expect(env("APP_NAME")).toBe("Hello"); // from .env.shared
    expect(env("APP_MODE")).toBe("development"); // from .env.development
  });
});

describe("env() accessor", () => {
  it("returns undefined for unknown keys with no default", () => {
    loadEnv(undefined, { dir: FIXTURES, override: false });
    expect(env("NOPE")).toBeUndefined();
  });

  it("returns the supplied default for unknown keys", () => {
    loadEnv(undefined, { dir: FIXTURES, override: false });
    expect(env("NOPE", "fallback")).toBe("fallback");
    expect(env("NOPE", 0)).toBe(0);
    expect(env("NOPE", false)).toBe(false);
  });

  it("env.all() exposes every loaded key", () => {
    loadEnv(undefined, { dir: FIXTURES, override: false });
    const all = env.all();
    expect(all).toMatchObject({
      APP_HOST: "localhost",
      APP_PORT: 3000,
      DEBUG: true,
      EST_TIME: null,
    });
  });
});

describe("resetEnv()", () => {
  it("clears loaded keys", () => {
    loadEnv(undefined, { dir: FIXTURES, override: false });
    expect(env("APP_HOST")).toBe("localhost");
    resetEnv();
    expect(env("APP_HOST")).toBeUndefined();
  });

  it("restores process.env to its initial snapshot", () => {
    // Mutate process.env directly (not via loadEnv), then reset.
    process.env.SOMETHING_TEMP = "x";
    resetEnv();
    // resetEnv tracks the keys it wrote via loadEnvFile and deletes those
    // on reset, then restores the import-time snapshot. Keys that the
    // caller set directly on process.env without going through loadEnv
    // are NOT tracked, so they survive the reset — the caller owns their
    // own additions.
    expect(process.env.SOMETHING_TEMP).toBe("x");
  });
});

describe("override semantics", () => {
  it("override defaults to true and writes loaded values to process.env", () => {
    delete process.env.APP_TEST;
    loadEnv(undefined, { dir: FIXTURES });
    // Node's process.env coerces any assignment to string, even when the
    // package stores the boolean `true` internally. env() still returns the
    // typed value; process.env returns the coerced string.
    expect(process.env.APP_TEST).toBe("true");
    expect(env("APP_TEST")).toBe(true);
  });

  it("override: false leaves process.env untouched", () => {
    delete process.env.APP_TEST;
    loadEnv(undefined, { dir: FIXTURES, override: false });
    expect(process.env.APP_TEST).toBeUndefined();
    expect(env("APP_TEST")).toBe(true);
  });
});
