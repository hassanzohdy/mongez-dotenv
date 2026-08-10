/**
 * Numeric coercion must be an exact round trip, from BOTH sources.
 *
 * Background (@Ion review of 1.3.0, 2026-08-10): `isNumeric` used to be
 * `!isNaN(value)`, which converts a long list of identifier-shaped strings
 * into wrong numbers. That was survivable while only `.env` files were
 * coerced — an author could opt out by quoting the value — but 1.3.0 applied
 * the same rule to `process.env`, where quotes are deliberately NOT stripped
 * and the operator therefore has no opt-out at all. Injected secrets, account
 * IDs and tokens are exactly the values that look numeric.
 *
 * Every row below is asserted from a `.env` file AND from `process.env`, so
 * the two sources can never drift apart again.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, loadEnvFile, parseValue, resetEnv } from "../index";

const FIXTURES = path.join(__dirname, "fixtures");
const NUMERIC_ENV = path.join(FIXTURES, ".env.numeric");

/** Values that must survive as strings — coercing any of them corrupts data. */
const MUST_STAY_STRING: Array<{ key: string; raw: string; why: string }> = [
  { key: "ACCOUNT_ID",    raw: "0123456789",          why: "leading zero destroyed — account IDs, zips" },
  { key: "SNOWFLAKE_ID",  raw: "1234567890123456789", why: "past 2^53 — snowflake IDs, ledger refs" },
  { key: "HEX_TOKEN",     raw: "0x1F",                why: "hex-shaped token" },
  { key: "EXPONENT_ID",   raw: "1e5",                 why: "exponent-shaped identifier" },
  { key: "E164_PHONE",    raw: "+15551234567",        why: "`+` stripped from an E.164 number" },
  { key: "INFINITE",      raw: "Infinity",            why: "would stop being a string entirely" },
  { key: "NOT_A_NUMBER",  raw: "NaN",                 why: "NaN compares unequal to itself" },
  { key: "TRAILING_ZERO", raw: "1.50",                why: "significant trailing zero dropped" },
];

/** Values that are genuinely numbers and must keep coercing. */
const MUST_COERCE: Array<{ key: string; raw: string; value: number }> = [
  { key: "GOOD_PORT",     raw: "3000", value: 3000 },
  { key: "GOOD_FLOAT",    raw: "1.5",  value: 1.5 },
  { key: "GOOD_NEGATIVE", raw: "-2",   value: -2 },
  { key: "GOOD_ZERO",     raw: "0",    value: 0 },
];

const TOUCHED_KEYS = [...MUST_STAY_STRING, ...MUST_COERCE].map(r => r.key);

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

describe("numeric coercion — values that must stay strings", () => {
  describe("from a .env file", () => {
    for (const { key, raw, why } of MUST_STAY_STRING) {
      it(`${key}=${raw} stays a string (${why})`, () => {
        loadEnvFile(NUMERIC_ENV, false);

        expect(env(key)).toBe(raw);
        expect(typeof env(key)).toBe("string");
      });
    }
  });

  describe("from process.env", () => {
    for (const { key, raw, why } of MUST_STAY_STRING) {
      it(`${key}=${raw} stays a string (${why})`, () => {
        process.env[key] = raw;

        expect(env(key)).toBe(raw);
        expect(typeof env(key)).toBe("string");
      });
    }
  });

  it("regression: 0123456789 is never converted — the operator cannot defend against it", () => {
    // Pinned on its own because it is the case with no opt-out: quoting works
    // in a .env file but there is no way to quote a Kubernetes-injected value.
    process.env.ACCOUNT_ID = "0123456789";
    expect(env("ACCOUNT_ID")).toBe("0123456789");

    resetEnv();
    delete process.env.ACCOUNT_ID;

    loadEnvFile(NUMERIC_ENV, false);
    expect(env("ACCOUNT_ID")).toBe("0123456789");

    // And the raw parser agrees, so no future call site can reintroduce it.
    expect(parseValue("0123456789")).toBe("0123456789");
  });
});

describe("numeric coercion — values that must keep coercing", () => {
  describe("from a .env file", () => {
    for (const { key, value } of MUST_COERCE) {
      it(`${key} coerces to ${value}`, () => {
        loadEnvFile(NUMERIC_ENV, false);

        expect(env(key)).toBe(value);
        expect(typeof env(key)).toBe("number");
      });
    }
  });

  describe("from process.env", () => {
    for (const { key, raw, value } of MUST_COERCE) {
      it(`${key} coerces to ${value}`, () => {
        process.env[key] = raw;

        expect(env(key)).toBe(value);
        expect(typeof env(key)).toBe("number");
      });
    }
  });
});

describe("numeric coercion — the two sources agree", () => {
  it("produces an identical value and type for every row, whichever side it came from", () => {
    // The whole point of the package is that a key's JS type does not depend
    // on where the value arrived from. Assert that directly rather than
    // trusting the two describe blocks above to stay in sync.
    loadEnvFile(NUMERIC_ENV, false);
    const fromFile = Object.fromEntries(
      TOUCHED_KEYS.map(k => [k, env(k)])
    );

    resetEnv();

    const rows = [...MUST_STAY_STRING, ...MUST_COERCE];
    for (const { key, raw } of rows) process.env[key] = raw;
    const fromProcess = Object.fromEntries(
      TOUCHED_KEYS.map(k => [k, env(k)])
    );

    expect(fromProcess).toEqual(fromFile);
  });
});
