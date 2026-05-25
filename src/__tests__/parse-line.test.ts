import { afterEach, describe, expect, it } from "vitest";
import { parseLine, resetEnv } from "../index";

afterEach(() => {
  resetEnv();
});

describe("parseLine — well-formed lines", () => {
  it("parses a bare key=value pair", () => {
    const [key, value] = parseLine("APP_NAME=Mongez");
    expect(key).toBe("APP_NAME");
    expect(value).toBe("Mongez");
  });

  it("strips wrapping double quotes", () => {
    const [key, value] = parseLine('APP_NAME="Mongez"');
    expect(key).toBe("APP_NAME");
    expect(value).toBe("Mongez");
  });

  it("preserves whitespace inside quoted values", () => {
    const [key, value] = parseLine('APP_NAME="My App"');
    expect(key).toBe("APP_NAME");
    expect(value).toBe("My App");
  });

  it("keeps `=` and special characters intact when value contains them", () => {
    const [key, value] = parseLine(
      'DB_URL="mongodb+srv://admin:admin@cluster0.zbdkfah.mongodb.net/?retryWrites=true&w=majority"'
    );
    expect(key).toBe("DB_URL");
    expect(value).toBe(
      "mongodb+srv://admin:admin@cluster0.zbdkfah.mongodb.net/?retryWrites=true&w=majority"
    );
  });

  it("trims surrounding whitespace before parsing", () => {
    const [key, value] = parseLine("   APP_NAME=Mongez   ");
    expect(key).toBe("APP_NAME");
    expect(value).toBe("Mongez");
  });
});

describe("parseLine — type coercion", () => {
  it("coerces numeric strings to Number", () => {
    const [, value] = parseLine("APP_PORT=3000");
    expect(value).toBe(3000);
    expect(typeof value).toBe("number");
  });

  it("coerces the literal `true` to boolean true", () => {
    const [, value] = parseLine("APP_DEBUG=true");
    expect(value).toBe(true);
    expect(typeof value).toBe("boolean");
  });

  it("coerces the literal `false` to boolean false", () => {
    const [, value] = parseLine("APP_DEBUG=false");
    expect(value).toBe(false);
    expect(typeof value).toBe("boolean");
  });

  it("coerces the literal `null` to JavaScript null", () => {
    const [, value] = parseLine("EST_TIME=null");
    expect(value).toBeNull();
  });

  it("returns an empty string for `KEY=` with nothing on the right", () => {
    const [key, value] = parseLine("APP_DEBUG=");
    expect(key).toBe("APP_DEBUG");
    expect(value).toBe("");
  });
});

describe("parseLine — escapes inside quoted values", () => {
  it("unescapes `\\\"` inside a quoted value", () => {
    const [, value] = parseLine('GREETING="Hello \\"world\\""');
    expect(value).toBe('Hello "world"');
  });

  it("keeps a trailing escaped quote and treats it as one literal `\"`", () => {
    const [key, value] = parseLine('APP_NAME="Mongez""');
    expect(key).toBe("APP_NAME");
    expect(value).toBe('Mongez"');
  });
});

describe("parseLine — non-data lines", () => {
  it("returns [] for an empty line", () => {
    expect(parseLine("")).toEqual([]);
  });

  it("returns [] for a whitespace-only line", () => {
    expect(parseLine("   \t  ")).toEqual([]);
  });

  it("returns [] for a comment line", () => {
    expect(parseLine("# this is a comment")).toEqual([]);
  });

  it("returns [] for a line without an `=`", () => {
    expect(parseLine("JUST_A_KEY")).toEqual([]);
  });

  it("destructures cleanly when the line is non-data", () => {
    const [key, value] = parseLine("# comment");
    expect(key).toBeUndefined();
    expect(value).toBeUndefined();
  });
});
