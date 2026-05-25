import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, loadEnvFile, resetEnv } from "../index";

const FIXTURES = path.join(__dirname, "fixtures");

const TOUCHED_KEYS = [
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

describe("loadEnvFile", () => {
  it("throws when the path does not exist", () => {
    expect(() => loadEnvFile("/no/such/file.env", true)).toThrow(
      /\.env file not found/
    );
  });

  it("populates env() from a real file", () => {
    loadEnvFile(path.join(FIXTURES, ".env"), false);
    expect(env("APP_HOST")).toBe("localhost");
    expect(env("APP_PORT")).toBe(3000);
    expect(env("DEBUG")).toBe(true);
    expect(env("PRODUCTION")).toBe(false);
    // env() preserves a deliberately-loaded JS null (uses `key in envData`
    // rather than `??`); env.all() exposes the same value.
    expect(env("EST_TIME")).toBeNull();
    expect(env.all().EST_TIME).toBeNull();
  });

  it("override=true writes loaded values into process.env (Node coerces them to string)", () => {
    delete process.env.APP_TEST;
    delete process.env.APP_PORT;
    delete process.env.DEBUG;
    loadEnvFile(path.join(FIXTURES, ".env"), true);
    // process.env's setter coerces any assignment to string. env() still
    // returns the typed value; process.env returns the coerced string.
    expect(process.env.APP_TEST).toBe("true");
    expect(process.env.APP_PORT).toBe("3000");
    expect(process.env.DEBUG).toBe("true");
  });

  it("override=false leaves process.env untouched for new keys", () => {
    delete process.env.APP_TEST;
    loadEnvFile(path.join(FIXTURES, ".env"), false);
    expect(process.env.APP_TEST).toBeUndefined();
    // ...but env() still returns the parsed value.
    expect(env("APP_TEST")).toBe(true);
  });

  it("resolves `${VAR}` substitutions against already-loaded keys", () => {
    loadEnvFile(path.join(FIXTURES, ".env"), false);
    expect(env("APP_URL")).toBe("http://localhost:3000");
  });

  it("preserves `#` inside fully-closed quoted values", () => {
    loadEnvFile(path.join(FIXTURES, ".env"), false);
    expect(env("DB_PASS")).toBe("AMFSDF#QWEWQE");
  });

  it("preserves a complex quoted connection string verbatim", () => {
    loadEnvFile(path.join(FIXTURES, ".env"), false);
    expect(env("DB_URL")).toBe(
      "mongodb+srv://admin:admin@cluster0.zbdkfah.mongodb.net/?retryWrites=true&w=majority"
    );
  });
});
