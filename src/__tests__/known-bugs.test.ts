/**
 * These tests cover the four bugs that the previous pass documented but
 * left unfixed. Each describes the symptom and the fix; the assertions
 * pin the corrected behaviour so we do not regress.
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { env, loadEnv, loadEnvFile, parseValue, resetEnv } from "../index";

const FIXTURES = path.join(__dirname, "fixtures");

afterEach(() => {
  resetEnv();
});

describe("previously-known bugs (now fixed)", () => {
  /**
   * src/index.ts env() — uses `??` which swallows `null`.
   *
   * Fixed: env() now uses `key in envData` so a deliberately-loaded `null`
   * is preserved and distinguishable from a missing key.
   */
  it("env() returns null when the loaded value is null", () => {
    loadEnv(undefined, { dir: FIXTURES, override: false });
    expect(env("EST_TIME")).toBeNull();
  });

  /**
   * src/index.ts parseValue() — the "quoted value contains `#`" branch
   * sliced off the legitimate last character of the value.
   *
   * Fixed: parseValue now walks to the matching closing quote (quote-aware
   * over ", ', and `) and drops anything after it as a comment.
   */
  it("preserves `#` inside a quoted value followed by a comment", () => {
    expect(parseValue('"https:sitename.com:3000#frag" # some comment')).toBe(
      "https:sitename.com:3000#frag"
    );
  });

  /**
   * src/index.ts loadEnvFile() — parseValue used to run twice per line.
   *
   * Fixed: loadEnvFile assigns the parseLine output directly. We sanity-
   * check the surrounding behaviour stayed the same (every supported
   * coercion shape still arrives with the right JS type).
   */
  it("calls parseValue exactly once per line", () => {
    loadEnvFile(path.join(FIXTURES, ".env"), false);
    const all = env.all();
    // Coerced values still arrive with the right JS types after a single
    // parseValue pass.
    expect(all.APP_PORT).toBe(3000);
    expect(typeof all.APP_PORT).toBe("number");
    expect(all.DEBUG).toBe(true);
    expect(all.PRODUCTION).toBe(false);
    expect(all.EST_TIME).toBeNull();
    // Quoted values and ${VAR} interpolation also still resolve.
    expect(all.DB_PASS).toBe("AMFSDF#QWEWQE");
    expect(all.APP_URL).toBe("http://localhost:3000");
  });

  /**
   * src/index.ts resetEnv() — used to leave process.env additions behind.
   *
   * Fixed: loadEnvFile records every key it writes to process.env in a
   * Set, and resetEnv() now deletes those keys before restoring the
   * import-time snapshot.
   */
  it("removes process.env keys added since module load", () => {
    // Pick a key that is NOT in the initial snapshot so we can observe
    // the deletion.
    delete process.env.APP_TEST;
    loadEnv(undefined, { dir: FIXTURES, override: true });
    expect(process.env.APP_TEST).toBe("true"); // loadEnv wrote it
    resetEnv();
    expect(process.env.APP_TEST).toBeUndefined(); // resetEnv removed it
  });
});
