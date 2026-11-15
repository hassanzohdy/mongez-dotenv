import { cwd } from "process";
import { existsSync, readFileSync } from "fs";

// Rejects `..` traversal segments in any path fed to the filesystem so a
// caller wiring `dir`/`envPath` to untrusted input (e.g. per-tenant config)
// can't walk this loader outside its intended directory. Absolute paths are
// accepted unless they contain a `..` segment, and relative paths with `..`
// such as `../config` are rejected too — every `dir` / `envPath`, absolute or
// relative, is checked segment by segment.
function assertNoTraversal(candidate: string, label: string): void {
  const segments = candidate.split(/[\\/]/);
  if (segments.includes("..")) {
    throw new Error(
      `Refusing to load ${label}: path traversal ("..") is not allowed: ${candidate}`
    );
  }
}

// The store has no prototype on purpose: with a plain `{}` a lookup of
// `toString` or `constructor` found `Object.prototype` members, so
// `env("toString", "d")` returned a function and `${constructor}` "resolved".
// Every key check on the store and on `process.env` also uses `Object.hasOwn`
// rather than `in`, which walks the prototype chain.
const envData: Record<string, any> = Object.create(null);

const initialProcessEnvData = { ...process.env };

// Tracks every key written to process.env by loadEnvFile, so that
// `isProcessProvided` can tell the loader's own writes from platform-injected
// values. resetEnv() undoes those writes through `previousProcessValues`
// below before restoring the import-time snapshot.
const loadedKeys = new Set<string>();

// The value each loader-written key had in process.env just BEFORE the
// loader's first write to it (`undefined` = it was absent). resetEnv() puts
// these back first, so a variable the caller set directly on process.env after
// import survives a reset even when a .env file also named it. Without this,
// the reset deleted the key (it is in `loadedKeys`) and the snapshot restore
// could not bring it back (it was never in the import-time snapshot).
const previousProcessValues = new Map<string, string | undefined>();

/**
 * Which side wins when a key is present in BOTH a .env file and the real
 * process environment.
 *
 * - `file-wins` — the .env file value replaces whatever the platform
 *   injected. This is the historical behaviour and is still the default in
 *   2.0, so no deployment changes on upgrade.
 * - `process-wins` — an already-set `process.env` value is authoritative
 *   and the .env file acts as a fallback layer underneath it. This matches
 *   dotenv, dotenv-flow, Vite and Next, and is the correct setting for
 *   Docker / Kubernetes / CI, where the platform owns the environment and
 *   the `.env` file is usually just the one baked into the image.
 */
export type EnvPrecedence = "file-wins" | "process-wins";

/**
 * Whether the value should be coerced to a number.
 *
 * The test is an exact ROUND TRIP: only coerce when `String(Number(v))` gives
 * back the original characters. `!isNaN(v)` was far too permissive and
 * silently corrupted whole classes of identifier:
 *
 *   0123456789            → 123456789            leading zero destroyed
 *   1234567890123456789   → 1234567890123456800  past Number.MAX_SAFE_INTEGER
 *   0x1F                  → 31                   hex-shaped token
 *   1e5                   → 100000               exponent-shaped identifier
 *   +15551234567          → 15551234567          `+` stripped off an E.164 number
 *
 * That was survivable while only `.env` files were coerced, because an author
 * could opt out by quoting the value. Since 1.3.0 the same rule applies to
 * `process.env`, where quoting is not stripped and the operator therefore has
 * NO opt-out at all — and injected secrets, account IDs and tokens are exactly
 * the values that look numeric. Round-tripping restores the guarantee without
 * needing an escape hatch.
 *
 * `Number.isFinite` (not just a NaN check) keeps the strings "Infinity",
 * "-Infinity" and "NaN" as strings. They round-trip through `String(Number(v))`
 * but are never what a config file meant, and `NaN` in particular is poisonous
 * to leak into an app since it compares unequal to itself.
 *
 * The magnitude cap is needed on top of the round trip: a 19-digit id such as
 * `1234567890123456000` happens to round-trip exactly (its trailing zeros are
 * representable) yet is already past `Number.MAX_SAFE_INTEGER`, where
 * neighbouring ids collapse into the same double. Past that point a number
 * can no longer be trusted to be the identifier that was written.
 */
function isNumeric(value: any) {
  if (typeof value !== "string" || value === "") return false;

  const numeric = Number(value);

  return (
    Number.isFinite(numeric) &&
    String(numeric) === value &&
    Math.abs(numeric) <= Number.MAX_SAFE_INTEGER
  );
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
  return Object.hasOwn(process.env, key) && !loadedKeys.has(key);
}

/**
 * Resolve one `${VAR}` reference: keys parsed earlier in the SAME file
 * (`local`), then the loaded store, then the real environment, then fail
 * loudly.
 *
 * The same-file layer exists because a file is now parsed completely before
 * anything is written to the store (see `loadEnvFile`), so its own earlier
 * keys are not in the store yet while its later lines are being parsed.
 *
 * Returning `undefined` here (the pre-1.3.0 behaviour) let
 * `String.prototype.replace` coerce it to the four-character string
 * "undefined" and bake it into the value — `postgres://undefined/app`
 * starts fine and fails much later, far from the cause. A corrupted value
 * is never a better outcome than a named error.
 */
function resolveInterpolation(
  key: string,
  local?: Record<string, any>
): string {
  if (local && Object.hasOwn(local, key)) return String(local[key]);
  if (Object.hasOwn(envData, key)) return String(envData[key]);
  if (Object.hasOwn(process.env, key)) return String(process.env[key]);

  throw new Error(
    `Cannot resolve \${${key}}: "${key}" is not defined in the loaded env data or in process.env. ` +
      `Forward references are not supported — declare "${key}" before the line that references it, ` +
      `or in .env.shared, which loads first.`
  );
}

/**
 * Empty the store, undo every process.env write the loader made, then restore
 * the import-time process.env snapshot.
 */
export function resetEnv() {
  for (const key in envData) {
    delete envData[key];
  }

  // Put back what the loader overwrote or added, BEFORE the snapshot restore.
  // A key that was absent before the loader's first write is deleted; a key
  // that had a value (the platform's, or one the caller set directly after
  // import) gets that exact value back.
  for (const [key, previous] of previousProcessValues) {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  previousProcessValues.clear();
  loadedKeys.clear();

  // Only process.env goes back to the import-time snapshot. The store is NOT
  // refilled from it: the store means "what my .env files declared" (the
  // same contract as `env.all()`), and `env(key)` already falls through to
  // process.env with coercion, so a copy here only duplicated the raw strings
  // un-coerced (`env("PORT")` returned "3000" after a reset, 3000 before it).
  for (const key in initialProcessEnvData) {
    process.env[key] = initialProcessEnvData[key];
  }
}

// ---------------------------------------------------------------------------
// Line grammar
// ---------------------------------------------------------------------------

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

// `${NAME}` with optional spaces inside the braces. The sticky flag lets the
// expander test the pattern at exactly the `$` it is looking at. The match
// ends at the first `}`, so text like `${not a name}` simply does not match
// and stays literal.
const INTERPOLATION = /\$\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}/y;

type QuoteKind = '"' | "'" | "`";

function isQuote(char: string | undefined): char is QuoteKind {
  return char === '"' || char === "'" || char === "`";
}

/**
 * Index of the closing quote of a value that opens with `quote` at index 0:
 * the FIRST occurrence of the same character that is not escaped by a
 * backslash, or -1 when there is none.
 *
 * It used to be `lastIndexOf`, which made `A="x" B="y"` one value and let a
 * quote inside a trailing comment (`"x" # it's`) swallow everything up to it.
 */
function findClosingQuote(text: string, quote: QuoteKind): number {
  for (let index = 1; index < text.length; index++) {
    if (text[index] === "\\") {
      index++; // the next character is escaped, whatever it is
      continue;
    }

    if (text[index] === quote) return index;
  }

  return -1;
}

// Backslash escapes understood per value style. Anything else after a
// backslash is kept as written (`C:\path` stays `C:\path`).
const ESCAPES: Record<"double" | "backtick" | "bare", Record<string, string>> = {
  double: { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\", $: "$" },
  backtick: { "`": "`", "\\": "\\", $: "$" },
  bare: { $: "$" },
};

/**
 * Process escapes and `${VAR}` references in ONE left-to-right pass.
 *
 * One pass (rather than unescape-then-interpolate or the reverse) is what
 * makes `\${X}` a literal `${X}`: the escaped `$` is emitted as plain text and
 * never gets the chance to start a reference. It is also why substituted text
 * can never turn into quote or comment syntax — interpolation runs on text
 * that quote parsing and comment stripping have already finished with, and the
 * substituted value is appended to the output, never re-scanned.
 */
function expand(
  text: string,
  style: "double" | "backtick" | "bare",
  local?: Record<string, any>
): string {
  const escapes = ESCAPES[style];
  let output = "";

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (char === "\\" && index + 1 < text.length) {
      const mapped = escapes[text[index + 1]];
      if (mapped !== undefined) {
        output += mapped;
        index++;
        continue;
      }
    }

    if (char === "$" && text[index + 1] === "{") {
      INTERPOLATION.lastIndex = index;
      const match = INTERPOLATION.exec(text);
      if (match) {
        output += resolveInterpolation(match[1], local);
        index += match[0].length - 1;
        continue;
      }
    }

    output += char;
  }

  return output;
}

/**
 * Index of the `#` that starts an inline comment in an unquoted value: the
 * first one preceded by whitespace. A `#` glued to the text before it is data
 * (`COLOR=#fff`, `https://x.com/#frag`). `value` still carries the whitespace
 * that followed the `=`, so `KEY= # note` is a comment and `KEY=#fff` is not.
 */
function findInlineComment(value: string): number {
  for (let index = 1; index < value.length; index++) {
    if (value[index] === "#" && /\s/.test(value[index - 1])) return index;
  }

  return -1;
}

/**
 * Evaluate the raw right-hand side of an assignment (everything after the
 * first `=`) into its final value.
 *
 * - Quoted: the text between the quotes, never coerced. `'…'` is literal,
 *   `"…"` and `` `…` `` expand escapes and `${VAR}`.
 * - Unquoted: inline comment removed, trailing whitespace trimmed, escapes and
 *   `${VAR}` expanded, then coerced to number / boolean / null.
 * - A quote that never closes is returned as written (trimmed), without
 *   throwing — this is the single-line `parseLine` / `parseValue` contract.
 *   Only the file loader, which can tell a value runs on over several lines,
 *   reports an unterminated quote.
 */
function evaluateRaw(raw: string, local?: Record<string, any>): any {
  const text = raw.trimStart();
  const quote = text[0];

  if (isQuote(quote)) {
    const close = findClosingQuote(text, quote);

    // Anything after the closing quote (whitespace and/or a `# comment`) is
    // discarded.
    if (close === -1) return raw.trim();

    const body = text.slice(1, close);

    if (quote === "'") return body.replace(/\\'/g, "'");

    return expand(body, quote === '"' ? "double" : "backtick", local);
  }

  const commentIndex = findInlineComment(raw);
  const unquoted = (
    commentIndex === -1 ? raw : raw.slice(0, commentIndex)
  ).trim();

  const value = expand(unquoted, "bare", local);

  if (isNumeric(value)) return Number(value);
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;

  return value;
}

/**
 * Split one line into its key and the raw text after the first `=`, or
 * `null` when the line is not an assignment (blank, comment, no `=`, or a key
 * that is not a valid name — skipped the same way a line without `=` is).
 */
function splitAssignment(line: string): { key: string; rest: string } | null {
  let text = line.trimStart();

  if (!text || text.startsWith("#")) return null;

  // `export KEY=value` is what a file meant for `source .env` looks like. The
  // lookahead keeps a key that is itself named `export` (`export = 1`).
  text = text.replace(/^export[ \t]+(?=[^\s=])/, "");

  const equals = text.indexOf("=");
  if (equals === -1) return null;

  const key = text.slice(0, equals).trim();
  if (!KEY_PATTERN.test(key)) return null;

  return { key, rest: text.slice(equals + 1) };
}

/**
 * Collect the raw text of a value, following a quoted value over line breaks.
 *
 * `readMore` hands back the next line of the file (or `undefined` at the end).
 * `open` is set to the quote character when the value never closed, so the
 * caller decides whether that is an error.
 */
function readRaw(
  rest: string,
  readMore?: () => string | undefined
): { raw: string; open?: QuoteKind } {
  const text = rest.trimStart();
  const quote = text[0];

  if (!isQuote(quote)) return { raw: rest };

  let raw = text;

  while (findClosingQuote(raw, quote) === -1) {
    const next = readMore?.();
    if (next === undefined) return { raw, open: quote };

    raw += "\n" + next;
  }

  return { raw };
}

export function parseLine(line: string): [string, any] | [] {
  const assignment = splitAssignment(line);
  if (!assignment) return [];

  return [assignment.key, evaluateRaw(assignment.rest)];
}

export function parseValue(value: any) {
  if (!value) return value;

  return evaluateRaw(String(value));
}

type ParsedEntry = {
  key: string;
  value: any;
  /** 1-based line where the assignment starts. */
  line: number;
  /** The value is the platform's (`process-wins`), not the file's. */
  fromProcess: boolean;
};

/**
 * Parse a whole file into an ordered list of entries WITHOUT touching the
 * store or process.env, so a file that fails halfway leaves no trace.
 *
 * Working on the whole content (not line by line) is what allows a quoted
 * value to span lines — a PEM private key, a multi-line JSON blob.
 */
function parseEnvContent(
  content: string,
  envPath: string,
  precedence: EnvPrecedence
): ParsedEntry[] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const entries: ParsedEntry[] = [];

  // Keys parsed so far in this file; the "same file" layer of `${VAR}`
  // resolution. Null-prototype for the same reason as the store.
  const local: Record<string, any> = Object.create(null);

  for (let index = 0; index < lines.length; index++) {
    const assignment = splitAssignment(lines[index]);
    if (!assignment) continue;

    const { key, rest } = assignment;
    const startLine = index + 1;

    // The extent of a multi-line value must be consumed even for a key whose
    // value is then ignored, or its continuation lines would be read as
    // assignments of their own.
    const { raw, open } = readRaw(rest, () =>
      index + 1 < lines.length ? lines[++index] : undefined
    );

    if (open) {
      throw new Error(
        `Unterminated ${open}-quoted value for ${key} starting at line ${startLine} of ${envPath}`
      );
    }

    // Under `process-wins` the decision is made on the KEY, before the value
    // is parsed: a value that is going to be ignored must not be interpolated
    // either, or an unresolvable `${…}` in it would abort the load for a key
    // the platform already provides.
    const fromProcess =
      precedence === "process-wins" && isProcessProvided(key);

    const value = fromProcess
      ? coerceProcessValue(process.env[key])
      : evaluateRaw(raw, local);

    local[key] = value;
    entries.push({ key, value, line: startLine, fromProcess });
  }

  return entries;
}

export type EnvLoaderOptions = {
  override?: boolean;
  dir?: string;
  loadSharedEnv?: boolean;
  precedence?: EnvPrecedence;
};

/**
 * Load data from file and set the env data from that file
 */
export function loadEnv(envPath?: string, envOptions?: EnvLoaderOptions) {
  // Merged field by field with `??` (a spread would let an explicit
  // `{ dir: undefined }` overwrite the default with `undefined`), and `cwd()`
  // is read now rather than once at import, so a later `process.chdir()` is
  // honoured. `dir` uses `||` so an empty string also means `cwd()`: kept
  // as-is it would probe `/.env.shared` at the filesystem root.
  const options = {
    override: envOptions?.override ?? true,
    dir: envOptions?.dir || cwd(),
    loadSharedEnv: envOptions?.loadSharedEnv ?? true,
    precedence: envOptions?.precedence ?? ("file-wins" as EnvPrecedence),
  };

  assertNoTraversal(options.dir, "dir");
  if (envPath) assertNoTraversal(envPath, "envPath");

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

  const rootPath = options.dir;

  // An unset or empty NODE_ENV must not probe `.env.undefined` / `.env.`.
  const nodeEnv = process.env.NODE_ENV;
  const currentEnvPath = nodeEnv ? rootPath + `/.env.${nodeEnv}` : "";

  const derivedPath =
    currentEnvPath && existsSync(currentEnvPath)
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
  assertNoTraversal(envPath, "envPath");

  if (!existsSync(envPath)) {
    throw new Error(`.env file not found at ${envPath}`);
  }

  // Parse everything first; the store, process.env and the tracking state are
  // only written once the whole file parsed. A file that throws on line 40
  // therefore leaves lines 1–39 un-applied instead of a half-loaded
  // configuration that looks fine until the missing key is read.
  const entries = parseEnvContent(
    readFileSync(envPath, "utf-8"),
    envPath,
    precedence
  );

  for (const { key, value, fromProcess } of entries) {
    envData[key] = value;

    // Under `process-wins`, a value the platform injected outranks the file
    // and is left completely alone — the file neither replaces it in the
    // store nor writes over it in process.env.
    if (fromProcess || !override) continue;

    if (!previousProcessValues.has(key)) {
      previousProcessValues.set(key, process.env[key]);
    }

    process.env[key] = value;
    loadedKeys.add(key);
  }
}

export function env(key: string, defaultValue?: any): any {
  // Use `hasOwn` (not `??`) so a deliberately-loaded `null` is preserved and
  // distinguishable from a missing key. With `??`, `env("EST_TIME")` would
  // return the default whenever the stored value was JS null.
  if (Object.hasOwn(envData, key)) return envData[key];

  // Then the real environment, before the default. A variable the platform
  // injected but that no .env file happens to name is still a real value;
  // handing back `defaultValue` for it is simply the wrong answer, and it is
  // wrong even before loadEnv() has been called at all (the store is empty
  // until then, so every lookup used to fall through to its default).
  if (Object.hasOwn(process.env, key)) {
    return coerceProcessValue(process.env[key]);
  }

  return defaultValue;
}

// The loaded store only — deliberately NOT merged with process.env. Callers
// read env.all() to see "what my .env files declared"; folding the whole
// process environment into it would turn every iteration over the result
// into a dump of the machine's variables. Use env(key) for the fallback.
env.all = () => envData;
