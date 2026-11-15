<div align="center">

# @mongez/dotenv

A small `.env` loader for Node.js with type coercion, `${VAR}` interpolation, `NODE_ENV`-aware file selection, and a shared-defaults layer.

[![npm](https://img.shields.io/npm/v/@mongez/dotenv.svg)](https://www.npmjs.com/package/@mongez/dotenv)
[![license](https://img.shields.io/npm/l/@mongez/dotenv.svg)](LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@mongez/dotenv.svg)](https://bundlephobia.com/package/@mongez/dotenv)
[![downloads](https://img.shields.io/npm/dw/@mongez/dotenv.svg)](https://www.npmjs.com/package/@mongez/dotenv)

</div>

---

## Why @mongez/dotenv?

`dotenv` hands you string-only values and one file. `dotenv-flow` adds file layering but still leaves you parsing `"3000"` into `3000` by hand. `@mongez/dotenv` is the smallest layer that does both: it picks the right file based on `NODE_ENV`, layers a `.env.shared` of defaults underneath, parses `${VAR}` references between keys, and coerces values to real JavaScript primitives (`number`, `boolean`, `null`) so `env("APP_PORT")` returns `3000`, not `"3000"`. One source file, zero runtime dependencies.

```ts
import { loadEnv, env } from "@mongez/dotenv";

loadEnv();

const port: number = env("APP_PORT", 3000);
const debug: boolean = env("DEBUG", false);
const dbUrl: string = env("DB_URL");
```

---

## Features

| Feature | Description |
|---|---|
| **Typed coercion** | `"3000"` becomes `3000`, `"true"` becomes `true`, `"null"` becomes `null` — coercion is intentionally narrow and case-sensitive. |
| **`NODE_ENV` file resolution** | Auto-picks `.env.${NODE_ENV}` when present, falls back to `.env`. |
| **Shared defaults** | `.env.shared` loads first, environment-specific files override it. |
| **`${VAR}` interpolation** | Reference earlier keys — or platform-injected `process.env` values — inside later values. Unresolvable references throw instead of corrupting the value. |
| **Quoted values** | `"`, `'`, and `` ` `` all work; quotes opt out of coercion, allow `#` inside the value, and may span several lines (PEM keys). Single quotes are fully literal. |
| **Inline comments** | `PORT=3000 # dev` works for unquoted values; a `#` with no whitespace before it (`COLOR=#fff`) is kept. |
| **Atomic file loads** | A file is parsed completely before anything is written, so a file that throws leaves the store and `process.env` untouched. |
| **Typed reader** | `env(key, default)` returns the parsed JS type, not the stringified `process.env` form — and falls back to `process.env` before the default. |
| **Precedence control** | `precedence: "process-wins"` makes platform-injected values outrank the `.env` file, for Docker / Kubernetes / CI. |
| **Read-only mode** | Opt out of writing to `process.env` with `override: false`. |
| **Full reset** | `resetEnv()` clears loaded values and puts back every `process.env` key the loader wrote since import. |
| **Zero dependencies** | No runtime or peer deps. One file, Node-only. |

---

## Installation

```sh
npm install @mongez/dotenv
```

```sh
yarn add @mongez/dotenv
```

```sh
pnpm add @mongez/dotenv
```

---

## Quick start

Create a `.env` file at your project root:

```bash
APP_NAME="My App"
APP_HOST=localhost
APP_PORT=3000
APP_URL=http://${APP_HOST}:${APP_PORT}
DEBUG=true
DB_PASS="P@ss#word"
```

Boot it at process start and read typed values:

```ts
import { loadEnv, env } from "@mongez/dotenv";

loadEnv();

env("APP_NAME");           // "My App"                (string)
env("APP_PORT");           // 3000                    (number)
env("DEBUG");              // true                    (boolean)
env("APP_URL");            // "http://localhost:3000" (interpolated)
env("DB_PASS");            // "P@ss#word"             (# preserved inside quotes)
env("MISSING", "default"); // "default"
env.all();                 // { APP_NAME: "My App", APP_PORT: 3000, ... }
```

That's the entire happy path. Everything below is depth on the same nine exports.

---

## Loading .env files

`loadEnv(envPath?, options?)` is the entry point you call once at startup. With no arguments it resolves a file automatically:

1. If `loadSharedEnv` is `true` (default) and `${dir}/.env.shared` exists, load it first.
2. If `NODE_ENV` is set and non-empty, try `${dir}/.env.${process.env.NODE_ENV}` (e.g. `.env.production`).
3. If that file does not exist — or `NODE_ENV` is unset or empty, in which case no `.env.<NODE_ENV>` file is probed at all — fall back to `${dir}/.env`.
4. If *that* does not exist either, do nothing. A project with no `.env` of any kind is a supported state — containers inject everything.

```ts
import { loadEnv } from "@mongez/dotenv";

loadEnv();                                  // auto-resolve from cwd()
loadEnv("/etc/myapp/secrets.env");          // explicit path
loadEnv(undefined, { dir: __dirname });     // override the search root
loadEnv(undefined, { override: false });    // populate the store but skip process.env
loadEnv(undefined, { loadSharedEnv: false });
loadEnv(undefined, { precedence: "process-wins" }); // injected values outrank the file
```

A path you pass explicitly still throws when it is missing — you named it, so a typo should be loud. Only the paths `loadEnv` derives for itself are optional.

`process.cwd()` is read on every `loadEnv` call, not once at import, so a `process.chdir()` before the call is honoured.

**Path checks.** `dir` and `envPath` are rejected when they contain a `..` segment, so a path derived from config or a CLI flag cannot walk the loader out of its directory. Absolute paths are accepted unless they contain a `..` segment; relative paths with `..` such as `../config` are rejected too (use `path.resolve(__dirname, "../config")` to hand over an absolute path).

### `EnvLoaderOptions`

| Option | Default | Effect |
|---|---|---|
| `override` | `true` | Mirror parsed values into `process.env`. Set to `false` to keep `process.env` untouched. |
| `dir` | `process.cwd()` | Directory the resolver searches for `.env.shared`, `.env.${NODE_ENV}`, and `.env`. |
| `loadSharedEnv` | `true` | Whether to load `.env.shared` before the environment-specific file. |
| `precedence` | `"file-wins"` | Who wins when a key is in both the file and the real environment. See below. |

Options are merged field by field, and an explicit `undefined` means "use the default": `{ dir: undefined }` searches `cwd()`, `{ override: undefined }` writes to `process.env`, `{ loadSharedEnv: undefined }` loads `.env.shared`, `{ precedence: undefined }` is `"file-wins"`. An empty `dir: ""` also means `cwd()`. Config objects with optional fields can be passed straight through.

### `precedence` — who owns a key that exists in both places

> **Read this before deploying.** On the default, `"file-wins"`, a `.env` file baked into your image **replaces** the `DATABASE_URL`, port, or secret your platform injected — silently. That is the historical behaviour and it is still the default, so upgrading never changes what a running deployment reads. Pass `precedence: "process-wins"` explicitly for containerised deploys.

| Value | Behaviour |
|---|---|
| `"file-wins"` (default) | The `.env` file value replaces whatever was already in `process.env`, in both the store and `process.env` itself. |
| `"process-wins"` | A value already present in `process.env` is authoritative: the file does not replace it in the store and does not write over it. The file's line for that key is not even parsed, so it is never interpolated and cannot throw. The file becomes a fallback layer underneath the real environment — matching `dotenv`, `dotenv-flow`, Vite, and Next. |

```ts
// Docker / Kubernetes / CI — the platform owns the environment.
loadEnv(undefined, { precedence: "process-wins" });
```

Keys the loader itself wrote earlier in the same run (`.env.shared`, or a previous `loadEnvFile`) are tracked and are **not** mistaken for platform-injected values, so file layering keeps working under `"process-wins"`.

### `loadEnvFile(envPath, override, precedence?)` — load one explicit file

Use this when you need to load a file outside the standard resolution chain — multiple env files at different paths, host-specific overrides on disk, or deferred loading. Throws `Error: .env file not found at <path>` when the file is missing; it is the primitive, so it never guesses.

A file is loaded **atomically**: it is parsed completely into a temporary map first (that map is also where `${NAME}` looks up keys declared earlier in the same file), and only when the whole file parsed without error are its keys written to the store and `process.env`. A file that throws — an unterminated quote, an unresolvable `${NAME}` — leaves both exactly as they were.

```ts
import { loadEnvFile } from "@mongez/dotenv";

loadEnvFile("/etc/myapp/base.env",  true);   // load + write to process.env
loadEnvFile("/etc/myapp/local.env", true);   // overrides keys from base

loadEnvFile("/etc/myapp/base.env", true, "process-wins");
```

### `resetEnv()` — true revert to import time

Empties the internal store, puts every `process.env` key that `loadEnv` / `loadEnvFile` wrote back to the value it had before the loader first wrote it (deleting it if it was absent), then restores the import-time `process.env` snapshot. A variable you set directly on `process.env` after import survives the reset, even when the loader later wrote the same key: the loader restores the value it found, not the import-time one.

After a reset the store is empty: `env.all()` is `{}`, and `env("PORT")` falls through to `process.env` (with coercion), so it still returns `3000` if `PORT=3000` was present at import time.

```ts
import { resetEnv } from "@mongez/dotenv";

// Useful in test setup:
afterEach(() => {
  resetEnv();
});
```

---

## Line grammar

Each line of a `.env` file is parsed like this:

| Rule | Example |
|---|---|
| Blank lines and lines whose first non-space character is `#` are skipped. | `# database` |
| An optional `export ` prefix (`export` plus spaces or tabs) is removed. | `export APP_PORT=3000` |
| The key is everything before the first `=`, trimmed, so spaces around `=` are fine. | `APP_PORT = 3000` |
| The key must match `/^[A-Za-z_][A-Za-z0-9_.-]*$/`. A line with any other key is skipped, like a line with no `=`. | `1BAD=x`, `MY KEY=x` are skipped |
| The value is everything after the first `=`, leading whitespace trimmed. | `KEY=a=b=c` gives `a=b=c` |
| A leading UTF-8 BOM is ignored, and both `\n` and `\r\n` line endings work. | |

### Quoted values

A value that opens with `"`, `'` or `` ` `` is quoted. The closing quote is the **first** occurrence of the same character that is not escaped by a backslash. Anything after it (whitespace and/or a `# comment`) is discarded. Quoted values are never coerced: `"3000"` stays the string `"3000"`.

| Quote | Behaviour |
|---|---|
| `'…'` single | Fully literal. No `${NAME}` interpolation and no escape processing, except `\'` which gives `'`. |
| `"…"` double | Escapes `\n` (newline), `\r`, `\t`, `\"`, `\\` and `\$` are expanded and `${NAME}` is interpolated, in one left-to-right pass, so `\${X}` stays the literal text `${X}`. A backslash before any other character is kept as written. |
| `` `…` `` backtick | Like double quotes for interpolation and the `` \` ``, `\$` and `\\` escapes, but `\n`, `\r` and `\t` are **not** expanded. |

```bash
GREETING='Hello ${NAME}'          # literal: Hello ${NAME}
MOTD="line one\nline two"         # contains a real newline
PRICE="costs \$5"                 # costs $5
HOME_URL="https://${HOST}/a#top" # a "# comment" after the closing quote is dropped
```

#### Multiline values

If the closing quote is not on the opening line, the value continues on the following lines (joined with `\n`) until a line containing the closing quote. This is how you store a PEM key:

```bash
PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASC...
-----END PRIVATE KEY-----"
```

Reaching the end of the file without a closing quote throws an error naming the key, the line where the value opened and the file, for example `Unterminated "-quoted value for PRIVATE_KEY starting at line 3 of /path/.env`. Nothing from that file is loaded.

### Unquoted values and inline comments

An inline comment starts at the first `#` that is **preceded by whitespace**; the comment and the whitespace before it are removed. A `#` with no whitespace before it is part of the value. The whitespace right after the `=` counts, so `KEY= # note` is an empty value while `KEY=#fff` keeps its `#`:

```bash
APP_PORT=3000 # dev server      # → 3000 (number)
COLOR=#fff                      # → "#fff"
URL=https://x.com/#frag         # → "https://x.com/#frag"
TODO= # fill in later           # → "" (empty string)
```

After that, trailing whitespace is trimmed, `\$` becomes a literal `$` (other backslashes are kept as written), `${NAME}` is interpolated, and the result is coerced (number / `true` / `false` / `null`). Comments are never interpolated. If the value itself needs ` #`, quote it: `DB_PASS="P@ss #word"`.

## Parsing values

`parseValue` is intentionally narrow about which strings it converts. Coercion is case-sensitive — `"True"` stays a string.

**A value becomes a number only when it round-trips exactly** — that is, when `String(Number(v))` gives back the original characters. Anything that would lose information stays a string:

| Stays a string | Because |
|---|---|
| `0123456789` | leading zero destroyed — account IDs, zips, phone numbers |
| `1234567890123456789` | every integer beyond `Number.MAX_SAFE_INTEGER` stays a string, even one that would round-trip (such as `9007199254740992`) |
| `0x1F` | hex-shaped token would become `31` |
| `1e5` | exponent-shaped identifier would become `100000` |
| `+15551234567` | the `+` on an E.164 number would be stripped |
| `1.50` | the significant trailing zero would be dropped |
| `Infinity`, `NaN` | never what a config file meant |

This matters most for values arriving from `process.env`: in a `.env` file you can opt out of coercion by quoting, but a value injected by Docker or Kubernetes is never quote-stripped, so the operator has no opt-out. Round-tripping means none is needed.

| Input | Output | Note |
|---|---|---|
| `"3000"` | `3000` | Coerced only when the number **round-trips exactly** — see below. |
| `"3.14"` | `3.14` | Decimals supported. |
| `"-7"` | `-7` | Negatives supported. |
| `"0123456789"` | `"0123456789"` | Leading zero would be destroyed — stays a string. |
| `"1e5"` | `"1e5"` | Exponent notation does not round-trip — stays a string. |
| `"+15551234567"` | `"+15551234567"` | `+` would be stripped — stays a string. |
| `"true"` | `true` | Lowercase only — `"True"` stays a string. |
| `"false"` | `false` | Lowercase only. |
| `"null"` | `null` | Lowercase only. |
| `"My App"` | `"My App"` | Plain text passes through. |
| `'"3000"'` | `"3000"` | Wrapping quotes opt OUT of coercion. |
| `'"a \\"b\\" c"'` | `'a "b" c'` | `\"` inside quotes is unescaped. |
| `""` | `""` | Empty value passes through. |

### `${VAR}` interpolation

A value containing `${NAME}` substitutes another key at parse time. `NAME` must match `[A-Za-z_][A-Za-z0-9_.-]*` (optional spaces inside the braces are fine: `${ NAME }`), and the match ends at the first `}`. Resolution order is keys parsed earlier in the **same file**, then the loaded store, then `process.env`.

Text that does not match the pattern — `${not a name}`, an unclosed `${` — is left as literal text; it never throws. Single-quoted values are never interpolated, and `\${NAME}` in a double-quoted or unquoted value is the literal text `${NAME}`. Interpolation runs after quote parsing, so substituted text can never become quote or comment syntax.

```bash
APP_HOST=localhost
APP_PORT=3000
APP_URL=http://${APP_HOST}:${APP_PORT}
```

```ts
env("APP_URL"); // "http://localhost:3000"
```

```bash
# DB_HOST is injected by the platform and appears in no .env file
DB_URL=postgres://${DB_HOST}/app     # resolves from process.env; this inline comment is stripped
```

**A well-formed but unresolvable reference throws, naming the key.** Substitution is not best-effort: emitting `postgres://undefined/app` would start the app and fail much later, far from the cause.

```
Error: Cannot resolve ${DB_HOST}: "DB_HOST" is not defined in the loaded env data
or in process.env. Forward references are not supported — declare "DB_HOST" before
the line that references it, or in .env.shared, which loads first.
```

Forward references are unsupported: within a file, lines are processed top to bottom, so a referenced key must appear on an earlier line (or in `.env.shared`, which loads first, or in `process.env`).

### Standalone `parseLine` / `parseValue`

You can call the parser directly without a file:

```ts
import { parseLine, parseValue } from "@mongez/dotenv";

parseLine("APP_PORT=3000");        // ["APP_PORT", 3000]
parseLine('APP_NAME="My App"');    // ["APP_NAME", "My App"]
parseLine("# comment");            // []                — non-data
parseLine("NO_EQUALS_HERE");       // []                — non-data
parseLine("KEY=a=b=c");            // ["KEY", "a=b=c"]  — splits on FIRST = only
parseLine("export PORT = 3000");   // ["PORT", 3000]    — export prefix and spaces handled
parseLine("PORT=3000 # dev");      // ["PORT", 3000]    — inline comment stripped
parseLine("1BAD=x");               // []                — invalid key skipped

parseValue("3000");                // 3000
parseValue('"3000"');              // "3000"
```

They follow the same grammar as a file line, with one difference: on an unterminated quote they do **not** throw — they return the raw value as given. Only the file loader throws, because only it can read the following lines.

---

## Reading typed values

`env(key, defaultValue?)` is the typed reader. It returns the value as it was parsed — `number`, `boolean`, `string`, or `null` — not the stringified `process.env` form.

Lookup order is **loaded store → `process.env` → `defaultValue`**:

```ts
import { env } from "@mongez/dotenv";

env("APP_PORT");                 // 3000          (number, from .env)
env("APP_PORT", 8080);           // 3000          (loaded value wins)
env("NODE_ENV");                 // "production"  (from process.env — no file names it)
env("MISSING");                  // undefined
env("MISSING", "default");       // "default"
env("MISSING", 0);               // 0
env.all();                       // the loaded store, by reference
```

Values that come from `process.env` get the same narrow coercion a file value gets — `"8080"` reads back as `8080`, `"true"` as `true` — so a key's type does not depend on whether it arrived from a file or from the platform. Coercion is deliberately narrower there: no quote stripping and no `${VAR}` interpolation, because a real environment variable is a literal value.

> Treat `env.all()` as read-only. It returns the underlying store by reference — mutating it mutates the store. It contains only what the `.env` files declared; it is **not** merged with `process.env`, and it is `{}` again after `resetEnv()`. Use `env(key)` for the fallback.

Key checks are own-property checks, so inherited names never leak: `env("toString", "d")` returns `"d"`, and `${constructor}` is an unresolvable reference.

### `process.env` vs `env()`

When `override: true` (the default), the loader writes each parsed value back to `process.env[key]`. Node's `process.env` setter coerces every value to a string, so the typed view only survives through `env()`:

```ts
process.env.APP_PORT;  // "3000"  — string (Node coerced it)
env("APP_PORT");       // 3000    — number (typed)
```

---

## Recipes

### Boot at process start

Reach for this when you want a single import that guarantees env is loaded before any other module runs.

```ts
// src/bootstrap.ts — imported first by your entry point
import { loadEnv } from "@mongez/dotenv";

loadEnv();
```

```ts
// src/index.ts
import "./bootstrap"; // must run before any module that reads env
import express from "express";
import { env } from "@mongez/dotenv";

const app = express();
app.listen(env("APP_PORT", 3000), env("APP_HOST", "localhost"));
```

### Layer a shared base across dev and prod

Reach for this when most env values are the same across environments and only a handful (DB URL, debug flag, log level) need to change.

```bash
# config/.env.shared
APP_NAME="My App"
APP_DESCRIPTION="A web app"

# config/.env.development
DB_URL="mongodb://localhost/dev"
DEBUG=true
LOG_LEVEL=debug

# config/.env.production
DB_URL="mongodb+srv://prod-host/app?retryWrites=true&w=majority"
DEBUG=false
LOG_LEVEL=info
```

```ts
import path from "node:path";
import { loadEnv, env } from "@mongez/dotenv";

loadEnv(undefined, {
  dir: path.resolve(__dirname, "../config"),
});

env("APP_NAME"); // "My App"     — shared
env("DEBUG");    // true | false — per-environment
env("DB_URL");   // mongo URL    — per-environment
```

### Build a validated, typed config object

Reach for this when you want one place that names every env value your app needs and crashes loudly on startup if any are missing or wrong-typed. `env()` returns `any`, so layer `zod` on top for runtime validation.

```ts
import { z } from "zod";
import { loadEnv, env } from "@mongez/dotenv";

loadEnv();

const schema = z.object({
  APP_PORT: z.number().int().positive(),
  DEBUG: z.boolean(),
  DB_URL: z.string().url(),
});

export const config = schema.parse({
  APP_PORT: env("APP_PORT"),
  DEBUG: env("DEBUG"),
  DB_URL: env("DB_URL"),
});

// config.APP_PORT is `number`, config.DEBUG is `boolean`, etc.
```

### Let the platform's injected values win (Docker / Kubernetes / CI)

Reach for this when a parent process (Docker, systemd, CI) already populated `process.env` and the `.env` file baked into the image should be a fallback layer, not a replacement.

```ts
import { loadEnv, env } from "@mongez/dotenv";

loadEnv(undefined, { precedence: "process-wins" });

// DATABASE_URL injected by the platform → the .env line is ignored (not even parsed or interpolated).
// APP_NAME only in .env                 → the file value is used.
env("DATABASE_URL"); // the injected value
env("APP_NAME");     // the file value
```

Pair it with `override: false` if you also want `process.env` left completely untouched for keys the file *does* own:

```ts
loadEnv(undefined, { precedence: "process-wins", override: false });

process.env.APP_PORT; // whatever the orchestrator set (or undefined)
env("APP_PORT");      // typed value — injected if present, else from the file
```

### Full reset between tests

Reach for this when test suites need each test to start from the same `process.env` baseline. `resetEnv()` puts back every key the loader wrote since import and restores the import-time snapshot.

```ts
import { afterEach } from "vitest";
import { loadEnvFile, resetEnv } from "@mongez/dotenv";

afterEach(() => {
  resetEnv();
});

it("reads APP_PORT as 3000", () => {
  loadEnvFile("./fixtures/.env.test", true);
  // ...assertions...
}); // resetEnv() runs after — store cleared, process.env restored
```

---

## Upgrading from 1.x

2.0.0 tightens the `.env` grammar. Check your files for these changes:

| 1.x | 2.0.0 |
|---|---|
| `'${NAME}'` single-quoted values were interpolated. | Single quotes are literal: no interpolation, only `\'` is an escape. |
| `\n` inside double quotes stayed a backslash and an `n`. | `\n`, `\r`, `\t`, `\"`, `\\` and `\$` are expanded in double quotes (backticks expand `\$`, `\\` and `` \` `` only). |
| An unquoted `KEY=value # note` kept ` # note` in the value. | Inline comments (a `#` preceded by whitespace) are removed. `COLOR=#fff` is still `"#fff"`. |
| Keys were taken as-is. | Keys are trimmed, an `export ` prefix is stripped, and a line whose key does not match `/^[A-Za-z_][A-Za-z0-9_.-]*$/` is skipped. |
| A `${...}` that was not a valid name could throw. | It stays literal text. Only a well-formed `${NAME}` that cannot be resolved throws. |
| The closing quote was the last matching quote on the line. | It is the first unescaped matching quote; text after it is discarded. |
| A quote that never closed was kept as-is. | In a file, an unterminated multiline quoted value throws and loads nothing. `parseLine` / `parseValue` still return the raw value. |
| `resetEnv()` copied the import-time snapshot into `env.all()`. | `env.all()` is `{}` after a reset; `env(key)` still finds the value in `process.env`. |
| Some integers beyond `Number.MAX_SAFE_INTEGER` that happened to round-trip (such as `9007199254740992`) became numbers. | Every integer beyond it stays a string. |
| `{ dir: undefined }` and similar options overrode the defaults. | An explicit `undefined` means "use the default". |
| A file that threw halfway left its earlier keys loaded. | Files load atomically. |

Unchanged: the default `precedence` is still `"file-wins"`. Also new: keys you set directly on `process.env` after import survive `resetEnv()` even if the loader later wrote the same key.

---

## Related packages

| Package | Use when you need |
|---|---|
| [`@mongez/config`](https://github.com/hassanzohdy/mongez-config) | A higher-level app-config layer with dot-notation lookups, grouped namespaces, and defaults that sits on top of `env()`. |
| [`@mongez/cache`](https://github.com/hassanzohdy/mongez-cache) | A pluggable cache layer for memoizing the values you derive from env (DB clients, computed URLs, etc.). |

For the full API reference in a single LLM-friendly file, see [`llms-full.txt`](./llms-full.txt). For release history, see [`CHANGELOG.md`](./CHANGELOG.md).

---

## License

MIT
