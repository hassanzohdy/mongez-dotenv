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
 * Which side wins when a key is present in BOTH a .env file and the real
 * process environment.
 *
 * - `file-wins` — the .env file value replaces whatever the platform
 *   injected. This is the historical behaviour and stays the default for
 *   the whole v1.x line so no deployment changes on a minor bump.
 * - `process-wins` — an already-set `process.env` value is authoritative
 *   and the .env file acts as a fallback layer underneath it. This matches
 *   dotenv, dotenv-flow, Vite and Next, and is the correct setting for
 *   Docker / Kubernetes / CI, where the platform owns the environment and
 *   the `.env` file is usually just the one baked into the image.
 */
export type EnvPrecedence = "file-wins" | "process-wins";

/**
 * Check if the given value is a number
 * If it is a string but contains only number, it should return true
 */
function isNumeric(value: any) {
  return !isNaN(value);
}

/**
 * Coerce a raw `process.env` string into the same primitive shapes a .env
 * file value gets, so `env("APP_PORT")` returns the number 3000 whether the
 * value came from a file or from the platform.
 *
 * Deliberately narrower than `parseValue`: no quote stripping and no
 * `${VAR}` interpolation. A real environment variable is a literal value —
 * a quote or a `${` inside it belongs to the secret, not to the syntax.
 * Values carrying significant leading/trailing whitespace are returned
 * untouched for the same reason.
 */
function coerceProcessValue(value: string | undefined) {
  if (!value || value.trim() !== value) return value;

  if (isNumeric(value)) return Number(value);
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;

  return value;
}

/**
 * Whether the key was already in the real environment rather than written
 * there by this loader. Keys the loader mirrored into `process.env` are
 * tracked in `loadedKeys`, so an earlier file in the same run (e.g.
 * `.env.shared`) never masquerades as a platform-injected value.
 */
function isProcessProvided(key: string) {
  return key in process.env && !loadedKeys.has(key);
}

/**
 * Resolve one `${VAR}` reference: the internal store first, then the real
 * environment, then fail loudly.
 *
 * Returning `undefined` here (the pre-1.3.0 behaviour) let
 * `String.prototype.replace` coerce it to the four-character string
 * "undefined" and bake it into the value — `postgres://undefined/app`
 * starts fine and fails much later, far from the cause. A corrupted value
 * is never a better outcome than a named error.
 */
function resolveInterpolation(key: string): string {
  if (key in envData) return String(envData[key]);
  if (key in process.env) return String(process.env[key]);

  throw new Error(
    `Cannot resolve \${${key}}: "${key}" is not defined in the loaded env data or in process.env. ` +
      `Forward references are not supported — declare "${key}" before the line that references it, ` +
      `or in .env.shared, which loads first.`
  );
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
      (_match: string, key: string) => resolveInterpolation(key)
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
  precedence?: EnvPrecedence;
};

const defaultOptions = {
  override: true,
  dir: cwd(),
  loadSharedEnv: true,
  precedence: "file-wins" as EnvPrecedence,
};

/**
 * Load data from file and set the env data from that file
 */
export function loadEnv(envPath?: string, envOptions?: EnvLoaderOptions) {
  const options = { ...defaultOptions, ...(envOptions || {}) };

  if (options.loadSharedEnv && existsSync(options.dir + "/.env.shared")) {
    loadEnvFile(
      options.dir + "/.env.shared",
      options.override,
      options.precedence
    );
  }

  // An explicitly-passed path is the caller asserting the file exists, so a
  // missing one still throws — silently ignoring a path someone named would
  // hide a typo. A path we derived ourselves is only a guess, and a project
  // with no .env of any kind is a normal, supported state (containers inject
  // everything), so a missing derived file is a no-op.
  if (envPath) {
    loadEnvFile(envPath, options.override, options.precedence);
    return;
  }

  const rootPath = options.dir || cwd();

  const currentEnvPath = rootPath + `/.env.${process.env.NODE_ENV}`;

  const derivedPath = existsSync(currentEnvPath)
    ? currentEnvPath
    : rootPath + "/.env";

  if (!existsSync(derivedPath)) return;

  loadEnvFile(derivedPath, options.override, options.precedence);
}

export function loadEnvFile(
  envPath: string,
  override: boolean,
  precedence: EnvPrecedence = "file-wins"
) {
  if (!existsSync(envPath)) {
    throw new Error(`.env file not found at ${envPath}`);
  }

  const lines: string[] = readFileSync(envPath, "utf-8").split(/\n|\r\n/);

  for (const line of lines) {
    const [key, value] = parseLine(line);

    if (!key) continue;

    // Under `process-wins`, a value the platform injected outranks the file
    // and is left completely alone — the file neither replaces it in the
    // store nor writes over it in process.env.
    if (precedence === "process-wins" && isProcessProvided(key)) {
      envData[key] = coerceProcessValue(process.env[key]);
      continue;
    }

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
  if (key in envData) return envData[key];

  // Then the real environment, before the default. A variable the platform
  // injected but that no .env file happens to name is still a real value;
  // handing back `defaultValue` for it is simply the wrong answer, and it is
  // wrong even before loadEnv() has been called at all (the store is empty
  // until then, so every lookup used to fall through to its default).
  if (key in process.env) return coerceProcessValue(process.env[key]);

  return defaultValue;
}

// The loaded store only — deliberately NOT merged with process.env. Callers
// read env.all() to see "what my .env files declared"; folding the whole
// process environment into it would turn every iteration over the result
// into a dump of the machine's variables. Use env(key) for the fallback.
env.all = () => envData;
