import { cwd } from "process";
import { existsSync, readFileSync } from "fs";

const envData: Record<string, any> = {};

const initialProcessEnvData = { ...process.env };

// Tracks every key written to process.env by loadEnvFile so that resetEnv()
// can be a true "back to t0" — deleting later additions before restoring
// the initial snapshot. Keys present in the initial snapshot get put back
// during the restore step; keys that were never in the snapshot stay
// deleted, which is the desired behaviour.
const loadedKeys = new Set<string>();

/**
 * Check if the given value is a number
 * If it is a string but contains only number, it should return true
 */
function isNumeric(value: any) {
  return !isNaN(value);
}

/**
 * Clear env data and reset it to the initial process env data
 */
export function resetEnv() {
  for (const key in envData) {
    delete envData[key];
  }

  // Delete any process.env keys that loadEnvFile wrote since module load.
  // Done BEFORE the snapshot restore so that keys that existed at t0 get
  // re-populated by the restore loop below, and keys that did not just stay
  // deleted.
  for (const key of loadedKeys) {
    delete process.env[key];
  }
  loadedKeys.clear();

  for (const key in initialProcessEnvData) {
    process.env[key] = initialProcessEnvData[key];
    envData[key] = initialProcessEnvData[key];
  }
}

export function parseLine(line: string): [string, any] | [] {
  line = line.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) return [];

  const [key, ...value] = line.split("=") as any;

  return [key, parseValue(value.join("="))];
}

export function parseValue(value: any) {
  if (!value) return value;

  value = String(value).trim();

  // Converting Env variables to values
  if (value.includes("${")) {
    value = value.replace(
      /\$\{([^{]+)\}/g,
      (_match: string, key: string) => envData[key]
    );
  }

  // Quoted-value handling. Supports ", ', and ` as the wrapping quote.
  // The opening quote determines which character closes the value, and the
  // closing quote is the LAST occurrence of that same character in the
  // string (so a `#` inside the quotes is preserved, and any trailing
  // text after the closing quote — typically a `# comment` — is dropped).
  // Using lastIndexOf rather than the first unescaped match also keeps the
  // long-standing behaviour for inputs like `"value""` (closing quote = the
  // final `"`, value retains the inner stray `"`).
  const quote = value[0];
  if (quote === '"' || quote === "'" || quote === "`") {
    const closeIndex = value.lastIndexOf(quote);
    if (closeIndex > 0) {
      // Found a real closing quote — take the substring between the two
      // quotes and unescape any \<quote> sequences. Anything that followed
      // the closing quote (whitespace + comment) is discarded.
      const escaped = new RegExp("\\\\" + quote, "g");
      return value.slice(1, closeIndex).replace(escaped, quote);
    }
    // No closing quote found: fall through to type-coercion so the raw
    // value is returned as-is (matches prior behaviour for malformed
    // inputs).
  }

  if (isNumeric(value)) {
    value = Number(value);
  } else if (value === "null") {
    value = null;
  } else if (value === "true") {
    value = true;
  } else if (value === "false") {
    value = false;
  }

  return value;
}

export type EnvLoaderOptions = {
  override?: boolean;
  dir?: string;
  loadSharedEnv?: boolean;
};

const defaultOptions = {
  override: true,
  dir: cwd(),
  loadSharedEnv: true,
};

/**
 * Load data from file and set the env data from that file
 */
export function loadEnv(envPath?: string, envOptions?: EnvLoaderOptions) {
  const options = { ...defaultOptions, ...(envOptions || {}) };

  if (options.loadSharedEnv && existsSync(options.dir + "/.env.shared")) {
    loadEnvFile(options.dir + "/.env.shared", options.override);
  }

  if (!envPath) {
    const rootPath = options.dir || cwd();

    const currentEnvPath = rootPath + `/.env.${process.env.NODE_ENV}`;

    if (existsSync(currentEnvPath)) {
      envPath = currentEnvPath;
    } else {
      envPath = rootPath + "/.env";
    }
  }

  loadEnvFile(envPath, options.override);
}

export function loadEnvFile(envPath: string, override: boolean) {
  if (!existsSync(envPath)) {
    throw new Error(`.env file not found at ${envPath}`);
  }

  const lines: string[] = readFileSync(envPath, "utf-8").split(/\n|\r\n/);

  for (const line of lines) {
    const [key, value] = parseLine(line);

    if (!key) continue;

    // parseLine already ran parseValue on the right-hand side; assigning
    // the result directly avoids a redundant second pass (idempotent for
    // current value shapes, but a footgun if parseValue ever grows
    // non-idempotent branches like JSON.parse or Date coercion).
    envData[key] = value;
    if (override) {
      process.env[key] = envData[key];
      loadedKeys.add(key);
    }
  }
}

export function env(key: string, defaultValue?: any): any {
  // Use `in` (not `??`) so a deliberately-loaded `null` is preserved and
  // distinguishable from a missing key. With `??`, `env("EST_TIME")` would
  // return the default whenever the stored value was JS null.
  return key in envData ? envData[key] : defaultValue;
}

env.all = () => envData;
