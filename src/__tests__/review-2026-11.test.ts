/**
 * Regression tests for the November 2026 review (findings C1–C15) and for
 * GitHub issue #1 (the same defect as C6). One `describe` per finding; the
 * contract each one pins is the 2.0.0 fix spec.
 *
 * File-based cases use fixtures named `.env.cN-…` so the scenario is readable
 * next to the assertion.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  env,
  loadEnv,
  loadEnvFile,
  parseLine,
  parseValue,
  resetEnv,
} from "../index";

const FIXTURES = path.join(__dirname, "fixtures");

// Keys this file touches on process.env. Tracked and restored one by one
// instead of replacing the live `process.env` binding (see the other suites).
const TOUCHED_KEYS = [
  "NODE_ENV",
  "DB_HOST",
  "APP_TEST",
  "APP_NAME",
  "APP_HOST",
  "C5_KEY",
  "C5_OTHER",
  "C7_EXPORTED",
  "C7_SPACED",
  "C7_TAB_EXPORT",
  "C7-DASH.KEY",
  "C8_BEFORE",
  "C8_PRIVATE_KEY",
  "C8_AFTER",
  "C8_OK",
  "C8_TOP",
  "PRIVATE_KEY",
  "C10_FIRST",
  "C10_SECOND",
  "C10_BROKEN",
  "C13_KEY",
  "C14_SOURCE",
  "C1_PORT",
  "C11_BIG",
  "C11_SAFE",
  "C11_UNSAFE",
];

const baseline: Record<string, string | undefined> = {};
const originalCwd = process.cwd();

beforeEach(() => {
  for (const k of TOUCHED_KEYS) baseline[k] = process.env[k];
});

afterEach(() => {
  process.chdir(originalCwd);
  resetEnv();
  for (const k of TOUCHED_KEYS) {
    if (baseline[k] === undefined) delete process.env[k];
    else process.env[k] = baseline[k] as string;
  }
});

describe("C1 resetEnv() empties the store", () => {
  it("does not copy the import-time snapshot into the store", () => {
    resetEnv();

    // The store means "what my .env files declared"; before the fix it was
    // refilled with every process.env variable of the machine.
    expect(Object.keys(env.all())).toHaveLength(0);
  });

  it("lets env() fall through to process.env (with coercion) after a reset", async () => {
    // The key must be in the IMPORT-TIME snapshot for this to pin C1 (1.x
    // copied the snapshot into the store as raw strings, so the reset made
    // `env("C1_PORT")` the string "3000"). A fresh module instance takes its
    // snapshot now, after the key is set.
    process.env.C1_PORT = "3000";
    vi.resetModules();
    const fresh = await import("../index");

    fresh.resetEnv();

    expect(Object.keys(fresh.env.all())).toHaveLength(0);
    expect(fresh.env("C1_PORT")).toBe(3000);
  });
});

describe("C2 closing quote is the first unescaped one", () => {
  it("does not merge two quoted assignments on one line", () => {
    expect(parseLine('A="x" B="y"')).toEqual(["A", "x"]);
  });

  it("ignores quote characters inside a trailing comment", () => {
    expect(parseValue('"x" # say "hi"')).toBe("x");
  });

  it("still honours an escaped quote inside the value", () => {
    // The quote inside the comment makes a last-quote scan pick the wrong one.
    expect(parseValue('"say \\"hi\\" now" # "c"')).toBe('say "hi" now');
  });

  it("closes at a quote preceded by an escaped backslash", () => {
    // `"a\\"` is `a` plus one backslash; the backslash pair does not escape
    // the quote after it.
    expect(parseValue('"a\\\\" # "x"')).toBe("a\\");
  });
});

describe("C3a single-quoted values are literal", () => {
  it("does not interpolate", () => {
    process.env.DB_HOST = "db.internal";

    expect(parseValue("'${DB_HOST}'")).toBe("${DB_HOST}");
  });

  it("does not process escapes other than \\'", () => {
    expect(parseValue("'a\\nb'")).toBe("a\\nb");
    expect(parseValue("'it\\'s'")).toBe("it's");
  });
});

describe("C3b double-quoted escapes", () => {
  it("expands \\n \\r \\t \\\" \\\\", () => {
    expect(parseValue('"a\\nb\\rc\\td\\"e\\\\f"')).toBe('a\nb\rc\td"e\\f');
  });

  it("keeps \\$ as a literal dollar so \\${X} is not interpolated", () => {
    process.env.DB_HOST = "db.internal";

    expect(parseValue('"\\${DB_HOST} ${DB_HOST}"')).toBe(
      "${DB_HOST} db.internal"
    );
  });

  it("makes \\$ literal in an unquoted value too", () => {
    process.env.DB_HOST = "db.internal";

    expect(parseValue("\\${DB_HOST}")).toBe("${DB_HOST}");
  });

  it("backticks interpolate and unescape \\` but do not expand \\n", () => {
    process.env.DB_HOST = "db.internal";

    expect(parseValue("`${DB_HOST}\\`\\n`")).toBe("db.internal`\\n");
    // `\$` and `\\` are escapes inside backticks too.
    expect(parseValue("`\\${DB_HOST} \\\\ ${DB_HOST}`")).toBe(
      "${DB_HOST} \\ db.internal"
    );
  });
});

describe("C3c comments are never interpolated", () => {
  it("does not resolve ${…} inside an unquoted inline comment", () => {
    expect(parseLine("K=v # see ${C3_DEFINED_NOWHERE}")).toEqual(["K", "v"]);
  });

  it("does not resolve ${…} inside a comment after a quoted value", () => {
    expect(parseLine('K="v" # see ${C3_DEFINED_NOWHERE}')).toEqual(["K", "v"]);
  });
});

describe("C4 interpolation pattern", () => {
  beforeEach(() => {
    process.env.DB_HOST = "db.internal";
  });

  it("allows spaces inside the braces", () => {
    expect(parseValue("h=${ DB_HOST }")).toBe("h=db.internal");
  });

  it("ends the match at the first }", () => {
    expect(parseValue("${DB_HOST} and }")).toBe("db.internal and }");
    expect(parseValue("${DB_HOST}}")).toBe("db.internal}");
  });

  it("leaves text that is not a reference as literal text", () => {
    expect(parseValue("${not a name}")).toBe("${not a name}");
    expect(parseValue("price ${ then")).toBe("price ${ then");
  });
});

describe("C5 process-wins decides on the key before parsing the value", () => {
  it("does not interpolate a file value the platform already overrides", () => {
    process.env.C5_KEY = "7";

    expect(() =>
      loadEnvFile(path.join(FIXTURES, ".env.c5-process-wins"), true, "process-wins")
    ).not.toThrow();

    expect(env("C5_KEY")).toBe(7);
    expect(process.env.C5_KEY).toBe("7");
    expect(env("C5_OTHER")).toBe("fine");
  });

  it("file-wins still reports the unresolvable reference", () => {
    process.env.C5_KEY = "7";

    expect(() =>
      loadEnvFile(path.join(FIXTURES, ".env.c5-process-wins"), true, "file-wins")
    ).toThrow(/C5_REFERENCE_DEFINED_NOWHERE/);
  });
});

describe("C6 unquoted inline comments (issue #1)", () => {
  it("strips a ` # comment` from an unquoted value", () => {
    expect(parseLine("APP_NAME=Mongez   # the name")).toEqual([
      "APP_NAME",
      "Mongez",
    ]);
  });

  it("keeps a # that is not preceded by whitespace", () => {
    expect(parseLine("COLOR=#fff")).toEqual(["COLOR", "#fff"]);
    expect(parseLine("URL=https://x.com/#frag")).toEqual([
      "URL",
      "https://x.com/#frag",
    ]);
  });

  it("treats a comment right after the `=` as a comment", () => {
    expect(parseLine("EMPTY= # nothing here")).toEqual(["EMPTY", ""]);
  });
});

describe("issue #1 exact repro", () => {
  it("resolves, strips the comment and still coerces", () => {
    process.env.DB_HOST = "db.internal";

    expect(
      parseLine("DB_URL=postgres://${DB_HOST}/app     # resolves from process.env")
    ).toEqual(["DB_URL", "postgres://db.internal/app"]);
    expect(parseLine("APP_PORT=3000 # http port")).toEqual(["APP_PORT", 3000]);
    expect(parseLine("DEBUG=true # debug mode")).toEqual(["DEBUG", true]);
  });
});

describe("C7 key grammar", () => {
  it("accepts `export`, spaces around `=` and dotted/dashed keys; skips invalid keys", () => {
    loadEnvFile(path.join(FIXTURES, ".env.c7"), false);

    expect(env("C7_EXPORTED")).toBe("yes");
    expect(env("C7_SPACED")).toBe(3000);
    expect(env("C7_TAB_EXPORT")).toBe("value");
    expect(env("C7-DASH.KEY")).toBe("ok");

    const keys = Object.keys(env.all());
    expect(keys).not.toContain("1BAD");
    expect(keys).not.toContain("BAD KEY");
    expect(keys.some((k) => k.startsWith("export"))).toBe(false);
  });

  it("parseLine applies the same grammar", () => {
    expect(parseLine("export A=1")).toEqual(["A", 1]);
    expect(parseLine("A = 1")).toEqual(["A", 1]);
    expect(parseLine("export = 1")).toEqual(["export", 1]);
    expect(parseLine("1A=1")).toEqual([]);
    expect(parseLine("A B=1")).toEqual([]);
  });
});

describe("C8 multiline quoted values", () => {
  it("reads a PEM private key spanning several lines", () => {
    loadEnvFile(path.join(FIXTURES, ".env.c8-pem"), false);

    expect(env("C8_PRIVATE_KEY")).toBe(
      "-----BEGIN PRIVATE KEY-----\n" +
        "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n" +
        "line with # hash and = sign\n" +
        "-----END PRIVATE KEY-----"
    );
    // The lines inside the value are not read as assignments, and the file
    // carries on normally after the closing quote.
    expect(env("C8_BEFORE")).toBe(1);
    expect(env("C8_AFTER")).toBe(2);
    expect(Object.keys(env.all())).toHaveLength(3);
  });

  it("throws naming the key, the opening line and the file for an unterminated quote", () => {
    const file = path.join(FIXTURES, ".env.c8-unterminated");

    expect(() => loadEnvFile(file, false)).toThrow(
      `Unterminated "-quoted value for PRIVATE_KEY starting at line 3 of ${file}`
    );
  });

  it("parseLine does not throw for an unterminated quote; it returns the raw value", () => {
    expect(parseLine('KEY="abc')).toEqual(["KEY", '"abc']);
  });
});

describe("C9 explicit undefined options mean the default", () => {
  it("applies override, loadSharedEnv and precedence defaults", () => {
    delete process.env.NODE_ENV;
    delete process.env.APP_TEST;
    delete process.env.APP_NAME;
    process.env.APP_HOST = "platform";

    loadEnv(undefined, {
      dir: FIXTURES,
      override: undefined,
      loadSharedEnv: undefined,
      precedence: undefined,
    });

    expect(process.env.APP_TEST).toBe("true"); // override -> true
    expect(env("APP_NAME")).toBe("Hello"); // loadSharedEnv -> true
    expect(env("APP_HOST")).toBe("platform"); // precedence -> "process-wins"
  });

  it("`dir: undefined` means the current working directory", () => {
    delete process.env.NODE_ENV;
    process.chdir(FIXTURES);

    expect(() => loadEnv(undefined, { dir: undefined, override: false })).not.toThrow();
    expect(env("APP_HOST")).toBe("localhost");
  });
});

describe("C10 a file is applied atomically", () => {
  it("leaves the store and process.env untouched when a reference cannot be resolved", () => {
    delete process.env.C10_FIRST;

    expect(() =>
      loadEnvFile(path.join(FIXTURES, ".env.c10-partial"), true)
    ).toThrow(/C10_REFERENCE_DEFINED_NOWHERE/);

    expect(env("C10_FIRST")).toBeUndefined();
    expect(process.env.C10_FIRST).toBeUndefined();
    expect(Object.keys(env.all())).toHaveLength(0);
  });

  it("leaves everything untouched when a quote is unterminated", () => {
    delete process.env.C8_OK;

    expect(() =>
      loadEnvFile(path.join(FIXTURES, ".env.c8-unterminated"), true)
    ).toThrow(/Unterminated/);

    expect(env("C8_OK")).toBeUndefined();
    expect(process.env.C8_OK).toBeUndefined();
  });

  it("records no reset bookkeeping for a file that threw", () => {
    delete process.env.C10_FIRST;

    expect(() =>
      loadEnvFile(path.join(FIXTURES, ".env.c10-partial"), true)
    ).toThrow(/C10_REFERENCE_DEFINED_NOWHERE/);

    // Set after the failed load. Had the loader remembered C10_FIRST as
    // "absent before my write", the reset would delete the caller's value.
    process.env.C10_FIRST = "mine";
    resetEnv();

    expect(process.env.C10_FIRST).toBe("mine");
  });
});

describe("C11 numeric coercion stops at Number.MAX_SAFE_INTEGER", () => {
  it("keeps an unsafe integer that happens to round-trip as a string (file values)", () => {
    expect(parseValue("1234567890123456000")).toBe("1234567890123456000");
    expect(parseValue("9007199254740992")).toBe("9007199254740992");
    expect(parseValue("-1234567890123456000")).toBe("-1234567890123456000");
  });

  it("still coerces the largest safe integer", () => {
    expect(parseValue("9007199254740991")).toBe(9007199254740991);
  });

  it("applies the same cap to process.env values", () => {
    process.env.C11_BIG = "1234567890123456000";
    process.env.C11_SAFE = "9007199254740991";

    expect(env("C11_BIG")).toBe("1234567890123456000");
    expect(env("C11_SAFE")).toBe(9007199254740991);
  });
});

describe("C12 the store has no prototype", () => {
  it("env() returns the default for names inherited from Object.prototype", () => {
    expect(env("toString", "d")).toBe("d");
    expect(env("constructor", "d")).toBe("d");
    expect(env("hasOwnProperty")).toBeUndefined();
  });

  it("${constructor} does not resolve", () => {
    expect(() => parseValue("${constructor}")).toThrow(/Cannot resolve/);
    expect(() => parseValue("${toString}")).toThrow(/Cannot resolve/);
  });

  it("env.all() is a null-prototype object", () => {
    expect(Object.getPrototypeOf(env.all())).toBeNull();
  });
});

describe("C13 resetEnv() keeps variables the caller set directly", () => {
  it("restores the caller's value when the loader also wrote the key", () => {
    // Set AFTER import, so it is not in the import-time snapshot.
    process.env.C13_KEY = "mine";

    loadEnvFile(path.join(FIXTURES, ".env.c13"), true, "file-wins");
    expect(process.env.C13_KEY).toBe("from-file");

    resetEnv();

    expect(process.env.C13_KEY).toBe("mine");
  });

  it("remembers the value from before the FIRST loader write, not a later one", () => {
    process.env.C13_KEY = "mine";

    loadEnvFile(path.join(FIXTURES, ".env.c13"), true, "file-wins");
    loadEnvFile(path.join(FIXTURES, ".env.c13"), true, "file-wins");
    resetEnv();

    expect(process.env.C13_KEY).toBe("mine");
  });

  it("restores the import-time snapshot AFTER the remembered values", async () => {
    // A fresh module instance so C13_KEY is in its import-time snapshot.
    process.env.C13_KEY = "snapshot";
    vi.resetModules();
    const fresh = await import("../index");

    process.env.C13_KEY = "mine";
    fresh.loadEnvFile(path.join(FIXTURES, ".env.c13"), true, "file-wins");
    fresh.resetEnv();

    expect(process.env.C13_KEY).toBe("snapshot");
  });

  it("still deletes a key that was absent before the loader wrote it", () => {
    delete process.env.C13_KEY;

    loadEnvFile(path.join(FIXTURES, ".env.c13"), true, "file-wins");
    resetEnv();

    expect(process.env.C13_KEY).toBeUndefined();
  });
});

describe("C14 loadEnv() resolves its inputs per call", () => {
  // Built at run time, not committed: Windows cannot check out a file named
  // `.env.` (a trailing dot), which failed the Windows CI checkout. There the
  // name resolves to `.env`, so the probe it guards against reads `.env` anyway.
  let emptyNodeEnvDir = "";

  beforeAll(() => {
    emptyNodeEnvDir = fs.mkdtempSync(path.join(os.tmpdir(), "dotenv-c14-"));
    fs.writeFileSync(path.join(emptyNodeEnvDir, ".env.undefined"), "C14_SOURCE=dot-env-undefined\n");
    if (process.platform !== "win32") {
      fs.writeFileSync(path.join(emptyNodeEnvDir, ".env."), "C14_SOURCE=dot-env-empty-suffix\n");
    }
    fs.writeFileSync(path.join(emptyNodeEnvDir, ".env"), "C14_SOURCE=dot-env\n");
  });

  afterAll(() => {
    fs.rmSync(emptyNodeEnvDir, { recursive: true, force: true });
  });

  it("reads cwd() on every call, not once at import", () => {
    delete process.env.NODE_ENV;
    process.chdir(FIXTURES);

    loadEnv(undefined, { override: false });

    expect(env("APP_HOST")).toBe("localhost");
  });

  it("does not probe `.env.` when NODE_ENV is empty", () => {
    process.env.NODE_ENV = "";

    loadEnv(undefined, {
      dir: emptyNodeEnvDir,
      override: false,
      loadSharedEnv: false,
    });

    expect(env("C14_SOURCE")).toBe("dot-env");
  });

  it("goes straight to `.env` when NODE_ENV is unset", () => {
    // The directory also holds `.env.undefined`, which 1.x probed.
    delete process.env.NODE_ENV;

    loadEnv(undefined, {
      dir: emptyNodeEnvDir,
      override: false,
      loadSharedEnv: false,
    });

    expect(env("C14_SOURCE")).toBe("dot-env");
  });
});

describe("C15 stray quotes after the closing quote", () => {
  it("drops everything after the first closing quote", () => {
    expect(parseValue('"value""')).toBe("value");
    expect(parseLine('APP_NAME="Mongez""')).toEqual(["APP_NAME", "Mongez"]);
  });

  it("is not fooled by an apostrophe in a comment after a single-quoted value", () => {
    expect(parseValue("'a' # don't")).toBe("a");
  });
});

describe("2.0 default precedence", () => {
  it("loadEnv() keeps a process.env value over the file's; `file-wins` still overrides it", () => {
    delete process.env.NODE_ENV;
    process.env.APP_HOST = "platform";

    loadEnv(undefined, { dir: FIXTURES });

    expect(env("APP_HOST")).toBe("platform");
    expect(process.env.APP_HOST).toBe("platform");

    resetEnv();
    process.env.APP_HOST = "platform";

    loadEnv(undefined, { dir: FIXTURES, precedence: "file-wins" });

    expect(env("APP_HOST")).toBe("localhost");
    expect(process.env.APP_HOST).toBe("localhost");
  });
});
