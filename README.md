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
| **Quoted values** | `"`, `'`, and `` ` `` all work; quotes opt out of coercion and allow `#` inside the value. |
| **Typed reader** | `env(key, default)` returns the parsed JS type, not the stringified `process.env` form — and falls back to `process.env` before the default. |
| **Precedence control** | `precedence: "process-wins"` makes platform-injected values outrank the `.env` file, for Docker / Kubernetes / CI. |
| **Read-only mode** | Opt out of writing to `process.env` with `override: false`. |
| **Full reset** | `resetEnv()` clears loaded values and removes process.env keys the loader wrote since import. |
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
2. Try `${dir}/.env.${process.env.NODE_ENV}` (e.g. `.env.production`).
3. If that file does not exist, fall back to `${dir}/.env`.
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

### `EnvLoaderOptions`

| Option | Default | Effect |
|---|---|---|
| `override` | `true` | Mirror parsed values into `process.env`. Set to `false` to keep `process.env` untouched. |
| `dir` | `process.cwd()` | Directory the resolver searches for `.env.shared`, `.env.${NODE_ENV}`, and `.env`. |
| `loadSharedEnv` | `true` | Whether to load `.env.shared` before the environment-specific file. |
| `precedence` | `"file-wins"` | Who wins when a key is in both the file and the real environment. See below. |

### `precedence` — who owns a key that exists in both places

> **Read this before deploying.** On the default, `"file-wins"`, a `.env` file baked into your image **replaces** the `DATABASE_URL`, port, or secret your platform injected — silently. That is the historical behaviour and it stays the default for all of v1.x so a minor bump never changes what a running deployment reads. **v2.0 will flip the default to `"process-wins"`.**

| Value | Behaviour |
|---|---|
| `"file-wins"` (default) | The `.env` file value replaces whatever was already in `process.env`, in both the store and `process.env` itself. |
| `"process-wins"` | A value already present in `process.env` is authoritative: the file does not replace it in the store and does not write over it. The file becomes a fallback layer underneath the real environment — matching `dotenv`, `dotenv-flow`, Vite, and Next. |

```ts
// Docker / Kubernetes / CI — the platform owns the environment.
loadEnv(undefined, { precedence: "process-wins" });
```

Keys the loader itself wrote earlier in the same run (`.env.shared`, or a previous `loadEnvFile`) are tracked and are **not** mistaken for platform-injected values, so file layering keeps working under `"process-wins"`.

### `loadEnvFile(envPath, override, precedence?)` — load one explicit file

Use this when you need to load a file outside the standard resolution chain — multiple env files at different paths, host-specific overrides on disk, or deferred loading. Throws `Error: .env file not found at <path>` when the file is missing; it is the primitive, so it never guesses.

```ts
import { loadEnvFile } from "@mongez/dotenv";

loadEnvFile("/etc/myapp/base.env",  true);   // load + write to process.env
loadEnvFile("/etc/myapp/local.env", true);   // overrides keys from base

loadEnvFile("/etc/myapp/base.env", true, "process-wins");
```

### `resetEnv()` — true revert to import time

Clears the internal store, deletes every `process.env` key that `loadEnv` / `loadEnvFile` wrote since module load, and restores the import-time `process.env` snapshot. Keys you set directly on `process.env` outside this loader are not tracked and survive reset.

```ts
import { resetEnv } from "@mongez/dotenv";

// Useful in test setup:
afterEach(() => {
  resetEnv();
});
```

---

## Parsing values

`parseValue` is intentionally narrow about which strings it converts. Coercion is case-sensitive — `"True"` stays a string.

| Input | Output | Note |
|---|---|---|
| `"3000"` | `3000` | Anything where `!isNaN(x)` is true becomes a number. |
| `"3.14"` | `3.14` | Decimals supported. |
| `"-7"` | `-7` | Negatives supported. |
| `"true"` | `true` | Lowercase only — `"True"` stays a string. |
| `"false"` | `false` | Lowercase only. |
| `"null"` | `null` | Lowercase only. |
| `"My App"` | `"My App"` | Plain text passes through. |
| `'"3000"'` | `"3000"` | Wrapping quotes opt OUT of coercion. |
| `'"a \\"b\\" c"'` | `'a "b" c'` | `\"` inside quotes is unescaped. |
| `""` | `""` | Empty value passes through. |

### `${VAR}` interpolation

A value containing `${VAR}` substitutes another key at parse time. Resolution order is the internal store first, then `process.env`.

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
DB_URL=postgres://${DB_HOST}/app     # resolves from process.env
```

**An unresolvable reference throws, naming the key.** Substitution is not best-effort: emitting `postgres://undefined/app` would start the app and fail much later, far from the cause.

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

parseValue("3000");                // 3000
parseValue('"3000"');              // "3000"
```

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

> Treat `env.all()` as read-only. It returns the underlying store by reference — mutating it mutates the store. It contains only what the `.env` files declared; it is **not** merged with `process.env`. Use `env(key)` for the fallback.

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

// DATABASE_URL injected by the platform → the .env line is ignored.
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

Reach for this when test suites need each test to start from the same `process.env` baseline. `resetEnv()` deletes every key the loader wrote since import and restores the import-time snapshot.

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

## Related packages

| Package | Use when you need |
|---|---|
| [`@mongez/config`](https://github.com/hassanzohdy/mongez-config) | A higher-level app-config layer with dot-notation lookups, grouped namespaces, and defaults that sits on top of `env()`. |
| [`@mongez/cache`](https://github.com/hassanzohdy/mongez-cache) | A pluggable cache layer for memoizing the values you derive from env (DB clients, computed URLs, etc.). |

For the full API reference in a single LLM-friendly file, see [`llms-full.txt`](./llms-full.txt). For release history, see [`CHANGELOG.md`](./CHANGELOG.md).

---

## License

MIT
