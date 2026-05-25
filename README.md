# @mongez/dotenv

> A small `.env` loader for Node.js with type coercion, `${VAR}` interpolation, environment-specific files via `NODE_ENV`, and a shared-defaults layer.

`@mongez/dotenv` reads a `.env` file from disk, parses each line, coerces values to JavaScript types (number, boolean, `null`) when they look like one, and writes the result onto an internal store. From that store you can:

- Read typed values back through `env("KEY")` — keep `3000` as `3000`, not `"3000"`.
- Optionally write through to `process.env` for code that reaches for `process.env` directly.
- Layer multiple files: a `.env.shared` of defaults, then a `.env.${NODE_ENV}` for the environment.
- Reference earlier variables in later ones via `${VAR}`.

This package is intentionally small. It has no runtime dependencies and a single `src/index.ts` file.

## Install

```sh
yarn add @mongez/dotenv
# or
npm i @mongez/dotenv
```

No peer dependencies.

## A 30-second tour

```ts
// .env
APP_NAME="My App"
APP_PORT=3000
APP_HOST=localhost
APP_URL=http://${APP_HOST}:${APP_PORT}
DEBUG=true
```

```ts
import { loadEnv, env } from "@mongez/dotenv";

loadEnv();                       // walks NODE_ENV → fallback to .env

env("APP_NAME");                 // "My App"        (string)
env("APP_PORT");                 // 3000            (number)
env("DEBUG");                    // true            (boolean)
env("APP_URL");                  // "http://localhost:3000"
env("MISSING", "default");       // "default"
env.all();                       // { APP_NAME: ..., APP_PORT: 3000, ... }
```

## What's in the box

| Export | Purpose |
|---|---|
| `loadEnv(envPath?, options?)` | Auto-detects the env file from `NODE_ENV` (or a fallback `.env`), loads `.env.shared` first if present, and populates the internal store. |
| `loadEnvFile(envPath, override)` | Lower-level: loads one explicit file. Throws if the file does not exist. |
| `parseLine(line)` | Parses a single `KEY=VALUE` line. Returns `[key, value]` or `[]`. |
| `parseValue(value)` | Coerces one right-hand-side into its typed form. |
| `env(key, defaultValue?)` | Reads a value out of the store. |
| `env.all()` | Returns the full key/value record (by reference). |
| `resetEnv()` | Clears loaded values and restores `process.env` from its initial snapshot. |
| `EnvLoaderOptions` (type) | Options bag passed to `loadEnv`. |

## File resolution

```ts
loadEnv();                                 // pick a file automatically
loadEnv("/abs/path/to/.env");              // explicit
loadEnv(undefined, { dir: __dirname });    // override the search root
```

With no `envPath`, the resolver walks this fallback chain:

1. If `loadSharedEnv` is `true` (default), it loads `${dir}/.env.shared` first when present.
2. It then tries `${dir}/.env.${process.env.NODE_ENV}` (e.g. `.env.production`).
3. If that file does not exist, it falls back to `${dir}/.env`.

`dir` defaults to `process.cwd()`. `loadSharedEnv` and `override` default to `true`.

## `EnvLoaderOptions`

```ts
type EnvLoaderOptions = {
  override?: boolean;       // default true — also write into process.env
  dir?: string;             // default cwd() — search root for .env files
  loadSharedEnv?: boolean;  // default true — load .env.shared first
};
```

## Type coercion

`parseValue` is intentionally narrow about which strings it converts:

| Input | Output | Type |
|---|---|---|
| `"3000"` | `3000` | `number` |
| `"3.14"` | `3.14` | `number` |
| `"true"` | `true` | `boolean` |
| `"false"` | `false` | `boolean` |
| `"null"` | `null` | object |
| `'"3000"'` (quoted) | `"3000"` | `string` (quotes opt out of coercion) |
| `"My App"` | `"My App"` | `string` |
| `'"He said \\"hi\\""'` | `He said "hi"` | `string` (`\"` is unescaped) |

`true` and `false` are case-sensitive. Strings like `True`, `YES`, or `1` are not coerced to booleans.

## Variable interpolation

A value containing `${VAR}` substitutes another key previously loaded into the same store:

```ts
// .env
APP_HOST=localhost
APP_PORT=3000
APP_URL=http://${APP_HOST}:${APP_PORT}
```

```ts
env("APP_URL"); // "http://localhost:3000"
```

Substitution reads from `@mongez/dotenv`'s internal store, not `process.env`. Order in the file matters — a `${VAR}` reference resolves at parse time, so the referenced key must appear earlier in the file (or in `.env.shared`, which is loaded first).

## Shared defaults

`.env.shared` is loaded before the environment-specific file. Keys in the environment file overwrite keys from `.env.shared` when `override` is `true`.

```bash
# .env.shared
APP_NAME="My App"
APP_URL="https://example.com"

# .env.production
APP_MODE=production
DB_HOST=prod-db.example.com
```

To opt out:

```ts
loadEnv(undefined, { loadSharedEnv: false });
```

## process.env vs `env()`

When `override: true` (the default), the loader writes each parsed value back to `process.env[key]`. Because `process.env`'s setter coerces every assignment to a string, the value you read from `process.env` is always a string:

```ts
process.env.APP_PORT; // "3000"  — string
env("APP_PORT");      // 3000    — number
```

If you want the typed value, read through `env()`.

## Resetting

```ts
import { resetEnv } from "@mongez/dotenv";

resetEnv();
```

Clears the internal store and restores `process.env` from the snapshot the module captured when it was first imported. Keys added to `process.env` AFTER module-load are not deleted by `resetEnv` — see [Caveats](#caveats).

## Caveats

- **`env()` collapses `null`.** Internally `env(key, def)` returns `envData[key] ?? defaultValue`. The nullish-coalescing operator treats a deliberately-loaded `null` as "missing", so `env("EST_TIME")` returns `undefined` (or the default), not `null`. Use `env.all().EST_TIME` to see the actual stored value.
- **`resetEnv` is not a full reset.** It does not delete keys added to `process.env` after module load. Restoring snapshot values only restores keys that were present at module-load time.
- **Quoted-value comment edge case.** A value like `"https:${HTTP_HOST}#frag" # comment` (a quoted string that contains `#` AND has a trailing comment) is not parsed correctly today — the trailing character of the value gets stripped. Keep `#` out of quoted-with-trailing-comment values, or fully quote without a trailing comment.

## Examples

### Reading port + host into a server

```ts
import express from "express";
import { loadEnv, env } from "@mongez/dotenv";

loadEnv();

const app = express();
app.listen(env("APP_PORT", 3000), env("APP_HOST", "localhost"));
```

### Per-environment config

```bash
# .env.shared
APP_NAME="My App"

# .env.development
DB_URL="mongodb://localhost/dev"
DEBUG=true

# .env.production
DB_URL="mongodb+srv://prod-host/app?retryWrites=true&w=majority"
DEBUG=false
```

```ts
import { loadEnv, env } from "@mongez/dotenv";

// NODE_ENV=development → loads .env.shared + .env.development
loadEnv();

env("APP_NAME");  // "My App"
env("DEBUG");     // true (boolean)
env("DB_URL");    // "mongodb://localhost/dev"
```

### Lower-level: loading a single file by path

```ts
import { loadEnvFile, env } from "@mongez/dotenv";

loadEnvFile("/etc/myapp/secrets.env", /* override */ false);
const apiKey = env("API_KEY");
```

## Related packages

| Package | Purpose |
|---|---|
| [`@mongez/config`](https://github.com/hassanzohdy/mongez-config) | Higher-level config layer with dot-notation lookups, defaults, and groups. |
| [`@mongez/cache`](https://github.com/hassanzohdy/mongez-cache) | Pluggable caching layer (useful as a persistence adapter for other Mongez packages). |

## License

MIT
