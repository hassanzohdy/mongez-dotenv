---
name: mongez-dotenv-recipes
description: |
  Idiomatic patterns and worked examples for common `@mongez/dotenv` use cases — bootstrapping, layered env files, typed config objects, read-only mode, `process-wins` (default) precedence for containerised deploys, reading platform-injected variables, optional `.env`, `null` handling, and full reset.
---

# Recipes

Idiomatic compositions of `@mongez/dotenv` features.

## Boot at process start

```ts
// src/bootstrap.ts — imported first by your entry point
import { loadEnv } from "@mongez/dotenv";

loadEnv();
```

```ts
// src/index.ts
import "./bootstrap";        // make sure this runs before anything else
import { env } from "@mongez/dotenv";

const app = createApp();
app.listen(env("APP_PORT", 3000));
```

## Per-environment config with shared defaults

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

env("APP_NAME");   // "My App"           (from .env.shared, both envs)
env("DEBUG");      // true | false       (per-environment)
env("DB_URL");     // mongo URL          (per-environment)
```

## Reading typed values straight into a config object

```ts
import { env } from "@mongez/dotenv";

export const config = {
  app: {
    name: env("APP_NAME", "App"),
    port: env("APP_PORT", 3000) as number,
    debug: env("DEBUG", false) as boolean,
  },
  db: {
    url: env("DB_URL") as string,
  },
};
```

The `as` casts are because `env(...)` returns `any`. Layer `zod` / `valibot` on top if you want runtime validation:

```ts
import { z } from "zod";
import { env } from "@mongez/dotenv";

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
```

## Loading multiple files in a specific order

```ts
import { loadEnvFile } from "@mongez/dotenv";

loadEnvFile("/etc/myapp/base.env",  true);   // global base
loadEnvFile("/etc/myapp/local.env", true);   // host-specific overrides
loadEnvFile("./.env",               true);   // per-checkout overrides last
```

Each subsequent file with `override: true` overwrites keys from the previous one.

## Read-only mode (don't touch `process.env`)

```ts
import { loadEnv, env } from "@mongez/dotenv";

loadEnv(undefined, { override: false });

process.env.APP_PORT;   // unchanged
env("APP_PORT");        // typed value from the file
```

`override` controls only the write-back. It does **not** control precedence: with the default `precedence: "process-wins"` the injected value is kept, while with `precedence: "file-wins"` the file value replaces the injected one inside the store, so `env("APP_PORT")` returns the file's value even when the orchestrator set a different one. Use `precedence` for that.

## Let the platform's injected values win (Docker / Kubernetes / CI)

```ts
import { loadEnv, env } from "@mongez/dotenv";

loadEnv(); // "process-wins" is the 2.0 default

// DATABASE_URL injected by the platform → the .env line is ignored (not even
//                                         parsed or interpolated), process.env is left intact.
// APP_NAME only in .env                 → the file value is used.
env("DATABASE_URL");
env("APP_NAME");
```

This is the default since 2.0, matching `dotenv`, `dotenv-flow`, Vite and Next. In 1.x the default was `"file-wins"`, where a `.env` file baked into the image silently overwrote what the platform injected; pass `precedence: "file-wins"` explicitly only if you need that.

Combine with `override: false` when `process.env` should also be left untouched for the keys the file does own:

```ts
loadEnv(undefined, { override: false });
```

## Reading a variable that only the platform sets

```ts
import { env } from "@mongez/dotenv";

// No .env file declares NODE_ENV or PORT — the platform injected them.
env("NODE_ENV", "development");   // "production" (from process.env)
env("PORT", 3000);                // 8080         (coerced to a number)
```

`env()` reads **store → `process.env` → default**, so this works even before `loadEnv()` has been called. Values taken from `process.env` get the same narrow coercion a file value gets, without quote stripping or `${VAR}` interpolation.

## Optional `.env` (no file on disk)

```ts
import { loadEnv } from "@mongez/dotenv";

loadEnv();   // directory has no .env, .env.shared, or .env.<NODE_ENV> → no-op
```

`loadEnv()` skips the paths it derives when nothing is on disk, so a container that gets everything from injected variables needs no guard. A path you pass explicitly still throws when missing:

```ts
loadEnv("/etc/myapp/secrets.env");  // throws if absent — you named it
```

## Distinguishing a loaded `null` from a missing key

`env(key)` preserves a deliberately-loaded `null` (it checks the store's own keys rather than using `??`), so the loaded value passes through directly:

```ts
import { env } from "@mongez/dotenv";

// .env contains: EST_TIME=null
env("EST_TIME");                 // null
env("EST_TIME", "fallback");     // null  (loaded null wins over default)
env("MISSING");                  // undefined
env("MISSING", "fallback");      // "fallback"
```

## Reset in tests

`resetEnv` empties the internal store (`env.all()` is `{}`), puts back every `process.env` key the loader wrote since module load, and re-applies the import-time snapshot — so a single call is enough to undo a `loadEnv` between tests:

```ts
import { afterEach } from "vitest";
import { resetEnv } from "@mongez/dotenv";

afterEach(() => {
  resetEnv();
});
```

A key the test sets directly on `process.env` survives the reset, even if the loader also wrote that key: the reset puts back the value the loader found when it first wrote the key, so your later assignment is kept. Clean up what you set yourself if the next test should not see it.

## Quotes, comments and multiline values

The parser is quote-aware. When a value opens with `"`, `'`, or `` ` ``, the closing quote is the **first** occurrence of that character that is not escaped by a backslash, and anything after it (whitespace + a `# comment`) is discarded.

```bash
# Fully-quoted, contains #, no trailing comment
DB_PASS="AMFSDF#QWEWQE"
#   → "AMFSDF#QWEWQE"

# Fully-quoted, contains #, with a trailing comment
HTTP_URL2="https://${HOST}#fragment" # some comment
#   → "https://example.com#fragment"   (HOST=example.com)

# Unquoted with a real trailing comment: ` #` starts it, and it is stripped
APP_NAME=My App # shown in the title bar
#   → "My App"

# A # with no whitespace before it is part of the value
COLOR=#fff
#   → "#fff"
```

Quote kinds differ:

```bash
LITERAL='costs ${PRICE}'          # single quotes: literal, no interpolation → costs ${PRICE}
LINES="one\ntwo"                  # double quotes: \n expands → a real newline
ESCAPED="price: \$5, ref \${X}"   # \$ is a literal $ → price: $5, ref ${X}
TICKS=`path\nname ${HOST}`        # backticks: interpolate, but \n stays backslash + n
```

A `${...}` whose content is not a valid name (`${not a name}`) stays literal text instead of throwing. `export APP_PORT=3000` and `APP_PORT = 3000` are accepted, and a line with an invalid key (`1BAD=x`) is skipped.

### Multiline values (PEM keys)

```bash
PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASC...
-----END PRIVATE KEY-----"
```

```ts
env("PRIVATE_KEY"); // "-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----"
```

If the closing quote never appears, the file throws `Unterminated "-quoted value for PRIVATE_KEY starting at line 1 of /path/.env` and nothing from that file is loaded (the store and `process.env` stay untouched), so a typo fails at boot instead of silently swallowing the rest of the file.
