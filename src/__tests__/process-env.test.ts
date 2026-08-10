/**
 * Coverage for the four defects reported on 2026-08-10, all of which live at
 * the boundary between a `.env` file and the real process environment:
 *
 * - D1 — `.env` file values unconditionally beat container-injected env vars.
 *        Fixed in v1.x phase 1 by the `precedence` option (default unchanged).
 * - D2 — `env()` never consulted `process.env`, so a platform-injected value
 *        that no file named returned its default forever.
 * - D3 — an unresolvable `${VAR}` baked the literal string "undefined" into
 *        the value instead of failing.
 * - D4 — `loadEnv()` threw when the directory had no `.env` file at all.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, loadEnv, loadEnvFile, parseValue, resetEnv } from "../index";

const FIXTURES = path.join(__dirname, "fixtures");
const NO_ENV_DIR = path.join(FIXTURES, "no-env");

// Same discipline as the other suites: track and restore the keys this file
// mutates rather than replacing the live `process.env` binding.
const TOUCHED_KEYS = [
  "NODE_ENV",
  "APP_TEST",
  "APP_PORT",
  "APP_HOST",
  "APP_URL",
  "APP_NAME",
  "APP_MODE",
  "DB_PASS",
  "DB_URL",
  "DEBUG",
  "PRODUCTION",
  "EST_TIME",
  "HTTP_PORT",
  "HTTP_HOST",
  "HTTP_URL",
  "HTTP_URL2",
  "ONLY_IN_PROCESS",
  "FEATURE_FLAG",
  "FROM_PROCESS",
  "FORWARD_A",
  "FORWARD_B",
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

describe("D1 — precedence between the file and the real environment", () => {
  it("defaults to `file-wins`, keeping the historical behaviour", () => {
    process.env.APP_HOST = "injected-host";

    loadEnv(undefined, { dir: FIXTURES });

    // .env declares APP_HOST=localhost and, on the default, replaces the
    // injected value in both the store and process.env.
    expect(env("APP_HOST")).toBe("localhost");
    expect(process.env.APP_HOST).toBe("localhost");
  });

  it("`process-wins` keeps the injected value in the store", () => {
    process.env.APP_HOST = "injected-host";

    loadEnv(undefined, { dir: FIXTURES, precedence: "process-wins" });

    expect(env("APP_HOST")).toBe("injected-host");
  });

  it("`process-wins` leaves process.env itself untouched", () => {
    process.env.APP_HOST = "injected-host";

    loadEnv(undefined, { dir: FIXTURES, precedence: "process-wins" });

    expect(process.env.APP_HOST).toBe("injected-host");
  });

  it("`process-wins` still loads keys the environment does not provide", () => {
    delete process.env.APP_PORT;
    process.env.APP_HOST = "injected-host";

    loadEnv(undefined, { dir: FIXTURES, precedence: "process-wins" });

    expect(env("APP_PORT")).toBe(3000);
  });

  it("`process-wins` coerces the injected value to a primitive", () => {
    process.env.APP_PORT = "8080";

    loadEnv(undefined, { dir: FIXTURES, precedence: "process-wins" });

    expect(env("APP_PORT")).toBe(8080);
    expect(typeof env("APP_PORT")).toBe("number");
  });

  it("`process-wins` does not treat the loader's own writes as injected values", () => {
    // A key written by an earlier file in the same run must not masquerade as
    // a platform-injected value, or file layering would stop working the
    // moment `process-wins` was switched on.
    delete process.env.APP_MODE;

    loadEnvFile(path.join(FIXTURES, ".env.development"), true, "process-wins");
    expect(env("APP_MODE")).toBe("development");

    loadEnvFile(path.join(FIXTURES, ".env.production"), true, "process-wins");
    expect(env("APP_MODE")).toBe("production");
  });
});

describe("the loadedKeys invariant behind `process-wins`", () => {
  /**
   * `isProcessProvided` is `key in process.env && !loadedKeys.has(key)`. The
   * `loadedKeys` half is the load-bearing part: without it, `.env.shared`'s
   * own write-through would look like a platform-injected value to the next
   * file and silently break layering under `"process-wins"`.
   *
   * The precedence tests exercise it only indirectly. This one isolates it:
   * the two halves below leave `process.env.APP_MODE` in the SAME state
   * ("development") and differ only in WHO put it there — and the outcomes
   * are opposite. Anything that removes the `loadedKeys` check makes the two
   * halves agree, and this test fails.
   */
  it("distinguishes a value the loader wrote from one the platform injected", () => {
    delete process.env.APP_MODE;

    // Half A — the loader itself put APP_MODE into process.env.
    loadEnvFile(path.join(FIXTURES, ".env.development"), true, "process-wins");
    expect(process.env.APP_MODE).toBe("development");

    loadEnvFile(path.join(FIXTURES, ".env.production"), true, "process-wins");
    expect(env("APP_MODE")).toBe("production"); // layering still works

    resetEnv();

    // Half B — identical process.env state, but injected from outside.
    process.env.APP_MODE = "development";
    expect(process.env.APP_MODE).toBe("development");

    loadEnvFile(path.join(FIXTURES, ".env.production"), true, "process-wins");
    expect(env("APP_MODE")).toBe("development"); // the platform wins
    expect(process.env.APP_MODE).toBe("development"); // and is left intact
  });

  it("resetEnv clears the tracking, so a later run sees a clean slate", () => {
    delete process.env.APP_MODE;

    loadEnvFile(path.join(FIXTURES, ".env.development"), true, "process-wins");
    expect(process.env.APP_MODE).toBe("development");

    // resetEnv deletes what the loader wrote AND empties loadedKeys, so the
    // key is genuinely gone rather than lingering as an untracked value that
    // the next run would mistake for an injected one.
    resetEnv();
    expect(process.env.APP_MODE).toBeUndefined();

    loadEnvFile(path.join(FIXTURES, ".env.production"), true, "process-wins");
    expect(env("APP_MODE")).toBe("production");
  });
});

describe("D2 — env() falls back to process.env", () => {
  it("returns the injected value for a key no .env file names", () => {
    process.env.ONLY_IN_PROCESS = "from-process";

    loadEnv(undefined, { dir: FIXTURES, override: false });

    expect(env("ONLY_IN_PROCESS", "fallback")).toBe("from-process");
  });

  it("returns the injected value with an empty store (before any loadEnv)", () => {
    resetEnv();
    process.env.ONLY_IN_PROCESS = "from-process";

    expect(env("ONLY_IN_PROCESS", "fallback")).toBe("from-process");
  });

  it("coerces the fallback the same way a file value is coerced", () => {
    process.env.FEATURE_FLAG = "true";

    expect(env("FEATURE_FLAG")).toBe(true);
    expect(typeof env("FEATURE_FLAG")).toBe("boolean");
  });

  it("still returns the default when the key is in neither place", () => {
    loadEnv(undefined, { dir: FIXTURES, override: false });

    expect(env("NOT_ANYWHERE_AT_ALL", "fallback")).toBe("fallback");
    expect(env("NOT_ANYWHERE_AT_ALL")).toBeUndefined();
  });

  it("keeps the loaded value ahead of process.env", () => {
    loadEnv(undefined, { dir: FIXTURES, override: false });
    process.env.APP_HOST = "injected-host";

    expect(env("APP_HOST")).toBe("localhost");
  });

  it("env.all() still exposes only the loaded store", () => {
    process.env.ONLY_IN_PROCESS = "from-process";

    loadEnv(undefined, { dir: FIXTURES, override: false });

    expect(env.all().ONLY_IN_PROCESS).toBeUndefined();
  });
});

describe("D3 — ${VAR} interpolation", () => {
  it("throws an error naming the key when the reference cannot be resolved", () => {
    expect(() => parseValue("prefix:${NOT_DEFINED_ANYWHERE}:suffix")).toThrow(
      /NOT_DEFINED_ANYWHERE/
    );
  });

  it("never produces the literal string `undefined` (regression)", () => {
    // The pre-1.3.0 behaviour returned "prefix:undefined:suffix" — a corrupted
    // value that starts the app and fails much later. Pinned so it cannot
    // come back: nothing is returned at all.
    let result: any = "not-assigned";

    expect(() => {
      result = parseValue("prefix:${NOT_DEFINED_ANYWHERE}:suffix");
    }).toThrow();

    expect(result).toBe("not-assigned");
  });

  it("resolves a reference from process.env", () => {
    process.env.FROM_PROCESS = "platform-host";

    expect(parseValue("https://${FROM_PROCESS}/api")).toBe(
      "https://platform-host/api"
    );
  });

  it("prefers the loaded store over process.env", () => {
    loadEnv(undefined, { dir: FIXTURES, override: false });
    process.env.APP_HOST = "injected-host";

    expect(parseValue("http://${APP_HOST}")).toBe("http://localhost");
  });

  it("throws on a forward reference inside a file", () => {
    delete process.env.FORWARD_B;

    expect(() =>
      loadEnvFile(path.join(FIXTURES, ".env.forward-ref"), false)
    ).toThrow(/FORWARD_B/);
  });
});

describe("D4 — loadEnv() on a directory with no .env file", () => {
  it("resolves without throwing", () => {
    expect(() => loadEnv(undefined, { dir: NO_ENV_DIR })).not.toThrow();
  });

  it("leaves the store empty rather than half-populated", () => {
    resetEnv();
    loadEnv(undefined, { dir: NO_ENV_DIR });

    expect(env("APP_HOST")).toBeUndefined();
  });

  it("still throws for an explicitly-passed path that does not exist", () => {
    expect(() =>
      loadEnv("/no/such/file.env", { dir: NO_ENV_DIR, loadSharedEnv: false })
    ).toThrow(/\.env file not found/);
  });
});
