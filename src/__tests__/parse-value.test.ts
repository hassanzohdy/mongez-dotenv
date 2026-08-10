import { afterEach, describe, expect, it } from "vitest";
import { loadEnv, parseValue, resetEnv } from "../index";
import path from "node:path";

const FIXTURES = path.join(__dirname, "fixtures");

afterEach(() => {
  resetEnv();
});

describe("parseValue — passthrough", () => {
  it("returns plain string values untouched", () => {
    expect(parseValue("hello")).toBe("hello");
  });

  it("returns the falsy input as-is for empty string", () => {
    expect(parseValue("")).toBe("");
  });

  it("returns the falsy input as-is for undefined", () => {
    expect(parseValue(undefined)).toBeUndefined();
  });

  it("trims surrounding whitespace on plain values", () => {
    expect(parseValue("  hello  ")).toBe("hello");
  });
});

describe("parseValue — type coercion", () => {
  it("converts numeric strings to Number", () => {
    expect(parseValue("3000")).toBe(3000);
    expect(parseValue("3.14")).toBe(3.14);
    expect(parseValue("-7")).toBe(-7);
  });

  it("converts `true` / `false` to booleans", () => {
    expect(parseValue("true")).toBe(true);
    expect(parseValue("false")).toBe(false);
  });

  it("converts `null` to JavaScript null", () => {
    expect(parseValue("null")).toBeNull();
  });

  it("leaves non-coercible strings alone", () => {
    expect(parseValue("hello world")).toBe("hello world");
    expect(parseValue("True")).toBe("True"); // case-sensitive
  });
});

describe("parseValue — quoted strings", () => {
  it("strips wrapping double quotes", () => {
    expect(parseValue('"hello"')).toBe("hello");
  });

  it("preserves a `#` inside a fully-closed quoted value", () => {
    expect(parseValue('"AMFSDF#QWEWQE"')).toBe("AMFSDF#QWEWQE");
  });

  it("does NOT coerce a quoted numeric to Number", () => {
    expect(parseValue('"3000"')).toBe("3000");
  });

  it("unescapes `\\\"` inside the value", () => {
    expect(parseValue('"Hello \\"World\\""')).toBe('Hello "World"');
  });
});

describe("parseValue — `${...}` interpolation", () => {
  it("substitutes a previously-loaded variable", () => {
    loadEnv(undefined, { dir: FIXTURES, override: false });
    // APP_HOST=localhost, APP_PORT=3000 are loaded by .env; the test asserts
    // the substituted form is what env() returns.
    expect(parseValue("http://${APP_HOST}:${APP_PORT}")).toBe(
      "http://localhost:3000"
    );
  });

  it("throws naming the key when the reference resolves nowhere", () => {
    // Resolution order is the internal store, then process.env. A genuine
    // miss throws rather than baking the literal string "undefined" into
    // the value — see process-env.test.ts for the full D3 coverage.
    delete process.env.NOT_DEFINED;

    expect(() => parseValue("prefix:${NOT_DEFINED}:suffix")).toThrow(
      /NOT_DEFINED/
    );
  });
});
