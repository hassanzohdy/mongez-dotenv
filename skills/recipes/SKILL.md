---
name: mongez-dotenv-recipes
description: Idiomatic patterns and worked examples for common @mongez/dotenv use cases — bootstrapping, layered env files, typed config objects, read-only mode, null handling, and full reset.
when_to_use: User wants a concrete example of how to use @mongez/dotenv in a real project; user asks how to bootstrap env loading at startup, load multiple files, use per-environment config with shared defaults, integrate with zod/valibot validation, avoid touching process.env, work around the null-collapse edge case, or achieve a full process.env reset in tests.
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

Useful when a parent process / orchestrator already set `process.env` and you want the file as a fallback rather than a replacement.

## Working around the `null` collapse

`env(key)` returns `undefined` (or the default) when the loaded value is `null`. If you need to know "was this explicitly loaded as null?", go through `env.all()`:

```ts
import { env } from "@mongez/dotenv";

function getLoaded<T>(key: string): T | undefined {
  // env.all() exposes the raw store; missing keys are `undefined`,
  // loaded-as-null keys are `null`.
  const all = env.all();
  return key in all ? (all[key] as T) : undefined;
}

getLoaded("EST_TIME");   // null   (when the file had EST_TIME=null)
getLoaded("MISSING");    // undefined
```

## Full reset (deletes added keys too)

`resetEnv` only restores keys from the import-time snapshot — it does not delete keys added since. Roll your own if you need true isolation (e.g. test setup):

```ts
import { resetEnv } from "@mongez/dotenv";

const importTimeKeys = new Set(Object.keys(process.env));

export function hardReset() {
  for (const key of Object.keys(process.env)) {
    if (!importTimeKeys.has(key)) delete process.env[key];
  }
  resetEnv();
}
```

## Quoted values and `#`

Two rules to keep yourself out of the known parser edge case:

1. If your value contains `#`, fully quote it AND do not put a trailing comment on the same line.
2. Trailing comments are fine when the value is not quoted, or when the value is quoted and contains no `#`.

```bash
# OK — quoted, contains #, no trailing comment
DB_PASS="AMFSDF#QWEWQE"

# OK — unquoted, no #
APP_NAME=My App   # trailing comment is fine for unquoted values

# BROKEN today — quoted, contains #, AND trailing comment
HTTP_URL2="https://${HOST}#fragment" # some comment
#   → returns "https://example.com:300" (trims trailing char)
```
