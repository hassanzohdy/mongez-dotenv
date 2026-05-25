---
name: mongez-dotenv-overview
description: High-level mental model of @mongez/dotenv — what it does, its module-scoped state, scope boundaries, and known quirks.
when_to_use: User asks what @mongez/dotenv is or how it works; user is evaluating whether to use this package; user wants to understand the envData store, process.env mirroring, or the null-collapse / parse-time interpolation quirks; user imports from @mongez/dotenv for the first time.
---

# Overview

`@mongez/dotenv` is a small `.env` loader for Node.js. It parses `KEY=VALUE` lines, coerces values to typed primitives (number, boolean, `null`) when they look like one, supports `${VAR}` interpolation between keys, picks the right file based on `NODE_ENV`, and layers a `.env.shared` file of defaults underneath.

The package is intentionally narrow:

- One source file (`src/index.ts`).
- No runtime dependencies, no peer dependencies.
- Node-only — uses `fs` and `process`.

## Install

```sh
yarn add @mongez/dotenv
# or
npm i @mongez/dotenv
```

## Import pattern

```ts
import {
  loadEnv,
  loadEnvFile,
  parseLine,
  parseValue,
  env,
  resetEnv,
  type EnvLoaderOptions,
} from "@mongez/dotenv";
```

## Mental model

| Concept | Where it lives | What it is |
|---|---|---|
| Internal store | Module-level `envData` object | The typed view of every loaded key. Read via `env()` / `env.all()`. |
| `process.env` mirror | Real Node `process.env` | Optional write-through, controlled by the `override` option. Always stores strings. |
| Initial snapshot | Module-level `initialProcessEnvData` | Captured at first import. `resetEnv` restores keys from this snapshot. |

The loader is **stateful and module-scoped**. There is one store per Node process. Calling `loadEnv` twice merges the second file's keys into the first store rather than starting over.

## Scope boundaries

| Concern | Lives in | Why |
|---|---|---|
| Validation / schema | `zod`, `valibot`, your code | This package does not type-check loaded values. |
| Higher-level config (groups, dot-notation, defaults) | `@mongez/config` | This package is one slice — the file-loading slice. |
| Caching | `@mongez/cache` | Unrelated concern. |
| Browser/cookie/localStorage | Other packages | This is a Node filesystem reader. |

## Quirks worth knowing up front

1. **`env(key)` collapses `null` to `undefined`.** Internal: `envData[key] ?? defaultValue`. A deliberately-loaded `null` is indistinguishable from "missing" through `env()`. Workaround: read `env.all()[key]`.
2. **`process.env` always stringifies.** Even though the package writes `process.env.PORT = 3000`, Node's `process.env` setter coerces to `"3000"`. Use `env()` if you want the typed value.
3. **`${VAR}` is parse-time only.** Substitutions happen the moment the value is parsed. Later updates to the referenced key do not re-trigger substitution in earlier lines.
4. **`resetEnv` is partial.** It restores keys present at module-import time. It does NOT delete keys that have been added to `process.env` since.

All four quirks are reproduced as `.skip()`'d tests in `src/__tests__/known-bugs.test.ts`.
