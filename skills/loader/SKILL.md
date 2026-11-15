---
name: mongez-dotenv-loader
description: |
  API reference and usage patterns for `loadEnv`, `loadEnvFile`, and `resetEnv` — the file-loading entry points of `@mongez/dotenv`.
---

# Loader

`loadEnv` and `loadEnvFile` are the two file-loading entry points. `resetEnv` undoes them.

## Signatures

```ts
function loadEnv(envPath?: string, options?: EnvLoaderOptions): void
function loadEnvFile(
  envPath: string,
  override: boolean,
  precedence?: EnvPrecedence,   // default "file-wins"
): void
function resetEnv(): void

type EnvPrecedence = "file-wins" | "process-wins";

type EnvLoaderOptions = {
  override?: boolean;           // default true — also write into process.env
  dir?: string;                 // default cwd() (read on every call) — search root
  loadSharedEnv?: boolean;      // default true — load .env.shared first
  precedence?: EnvPrecedence;   // default "file-wins" — who wins vs process.env
};
```

## File resolution (when `envPath` is omitted)

1. If `loadSharedEnv` is `true` and `${dir}/.env.shared` exists, load it first.
2. If `NODE_ENV` is set and non-empty, try `${dir}/.env.${process.env.NODE_ENV}` (e.g. `.env.development`).
3. If that file does not exist, or `NODE_ENV` is unset or empty (no `.env.<NODE_ENV>` is probed then), fall back to `${dir}/.env`.
4. If that does not exist either, do nothing — no throw. A project with no `.env` at all is a supported state.

```ts
process.env.NODE_ENV = "development";
loadEnv();
// → .env.shared    (if present)
// → .env.development
```

```ts
process.env.NODE_ENV = "test";  // no .env.test on disk
loadEnv();
// → .env.shared    (if present)
// → .env
```

```ts
loadEnv("/etc/secrets.env");    // explicit path skips the resolver,
                                 // but .env.shared is still loaded first
                                 // unless loadSharedEnv: false
```

An explicitly-passed `envPath` that does not exist still throws — the caller named it, so a typo must be loud. Only the paths `loadEnv` derives for itself (steps 2–3 above) are optional.

`dir` and `envPath` are also rejected outright when they contain a `..` segment, so a value derived from config or a CLI flag can't walk the loader outside its intended directory and pull an unrelated file into `process.env`. Absolute paths are accepted unless they contain a `..` segment; relative paths with `..` such as `../config` are rejected too (use `path.resolve(__dirname, "../config")`). The check runs on the resolved `dir`.

## Options merge and `cwd()`

Options are merged field by field, and an explicit `undefined` means "use the default": `{ dir: undefined }` searches `cwd()`, `{ override: undefined }` is `true`, `{ loadSharedEnv: undefined }` is `true`, `{ precedence: undefined }` is `"file-wins"`. An empty `dir: ""` also means `cwd()`. `process.cwd()` is resolved on every `loadEnv` call, not once at import, so `process.chdir()` before the call is honoured.

## Precedence semantics — file vs. the real environment

| Setting | A key in BOTH the file and `process.env` |
|---|---|
| `precedence: "file-wins"` (default) | The file value replaces the injected one, in the store and (when `override`) in `process.env`. |
| `precedence: "process-wins"` | The injected value is authoritative. The file does not replace it in the store and does not write over it. The decision is made on the key before the value is parsed, so the file's line for that key is never interpolated and cannot throw. |

```ts
// Docker / Kubernetes / CI: the platform owns the environment.
loadEnv(undefined, { precedence: "process-wins" });
```

- `"file-wins"` is still the default, so upgrading never changes what a running deployment reads. Select `"process-wins"` explicitly for containerised deploys.
- Keys the loader itself wrote earlier in the same run (`.env.shared`, or a previous `loadEnvFile`) are tracked in an internal `Set` and are NOT mistaken for platform-injected values — file layering keeps working under `"process-wins"`.
- Values taken from `process.env` are coerced to primitives the same way file values are (`"8080"` → `8080`), but WITHOUT quote stripping or `${VAR}` interpolation.

## Override semantics

| Setting | Internal store | `process.env` |
|---|---|---|
| `override: true` (default) | Typed value (number / boolean / null / string) | Written, then coerced to string by Node |
| `override: false` | Typed value | Untouched |

```ts
loadEnv(undefined, { override: false });

process.env.APP_PORT;  // undefined (not written)
env("APP_PORT");       // 3000      (in store anyway)
```

## Layering

```bash
# .env.shared
APP_NAME="My App"
APP_URL="https://example.com"

# .env.production
DB_HOST=prod-db.example.com
DEBUG=false
```

```ts
process.env.NODE_ENV = "production";
loadEnv();

env("APP_NAME");  // "My App"                  — from .env.shared
env("DB_HOST");   // "prod-db.example.com"     — from .env.production
env("DEBUG");     // false
```

If a key appears in both files, the environment-specific file wins (it loads second, and with `override: true` writes through).

## `loadEnvFile` — the low-level form

```ts
loadEnvFile("/abs/path/to/.env", /* override */ true);
loadEnvFile("/abs/path/to/.env", true, "process-wins");
```

Loads exactly one file. Always throws if the path does not exist — it is the primitive and never guesses:

```
Error: .env file not found at /abs/path/to/.env
```

A file loads **atomically**: it is parsed completely into a temporary ordered map first (the lookup for `${NAME}` references to earlier keys of the same file), and only when the whole file parsed without error are its keys written to the store, `process.env` and the tracked-keys set. A file that throws (an unterminated multiline quote, an unresolvable `${NAME}`) leaves the store and `process.env` exactly as they were. See `parser.md` for the line grammar.

Use this when you need to load a file outside the standard resolution chain (e.g. a `secrets.env` somewhere on disk, deferred loading, multiple env files at different paths).

## `resetEnv`

```ts
resetEnv();
```

Does:

1. Empties the internal store. The import-time snapshot is **not** copied into it, so `env.all()` is `{}` afterwards and `env("PORT")` falls through to `process.env` (with coercion), e.g. `3000` as a number.
2. Puts every `process.env` key the loader wrote back to the value it had before the loader first wrote it (deleting the key if it was absent). The previous value is remembered on the first write of each key.
3. Re-assigns every key in the import-time `process.env` snapshot back to `process.env`.

The net effect is a "back to t0" for anything the loader added. A variable the caller set directly on `process.env` after import survives the reset, even when the loader also wrote the same key later: step 2 restores the value the loader found, not the import-time one.

## Common loading patterns

```ts
// 1. Boot at startup, defaults.
import { loadEnv } from "@mongez/dotenv";
loadEnv();
```

```ts
// 2. Read-only — populate store but don't touch process.env.
loadEnv(undefined, { override: false });
```

```ts
// 3. Custom directory (monorepo with env files in a sibling).
loadEnv(undefined, { dir: path.resolve(__dirname, "../config") });
```

```ts
// 4. Skip the shared layer (rare).
loadEnv(undefined, { loadSharedEnv: false });
```

```ts
// 4b. Containerised deploy — injected values outrank the baked-in file.
loadEnv(undefined, { precedence: "process-wins" });
```

```ts
// 5. Multiple files with explicit ordering.
import { loadEnvFile } from "@mongez/dotenv";
loadEnvFile("/etc/myapp/base.env", true);
loadEnvFile("/etc/myapp/local.env", true);  // overrides keys from base
```
