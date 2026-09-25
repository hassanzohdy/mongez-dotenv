---
description: "Typed Node.js .env loading with `loadEnv`, `loadEnvFile`, `resetEnv`, `env`, `parseLine`, and `parseValue`; resolves `.env.<NODE_ENV>` with optional `.env.shared`, performs narrow number/boolean/null coercion and `${VAR}` interpolation, and controls file-versus-platform precedence. Use for: loading configuration at startup, layered environment files, Docker/CI-injected values, typed config reads, interpolation, or test cleanup. Not this package → higher-level grouped application config and defaults: @mongez/config; schema validation: zod or valibot; browser environment variables: your bundler."
---

# @mongez/dotenv

Load Node.js environment configuration as typed values rather than strings. It resolves a shared defaults file and the active `NODE_ENV` file, maintains a module-scoped store, and can mirror results into `process.env`.

## The 80% path

1. Start at `overview.md` for the state model and package boundaries.
2. At application bootstrap, call `loadEnv()`; use `loader.md` for directory selection, `.env.shared` layering, explicit files, and `process-wins` deployment precedence.
3. Read configuration with `env("KEY", fallback)`; use `parser.md` for coercion, quoted values, interpolation, and `env.all()`.
4. Copy startup, container, validation, read-only, and reset patterns from `recipes.md`.

## Conventions and pitfalls

- Use `env()` for typed reads: `process.env` always stores strings.
- In Docker, Kubernetes, or CI, select `precedence: "process-wins"` so injected values stay authoritative.
- `${VAR}` references must already be loaded or present in `process.env`; forward references throw.
- `resetEnv()` only reverts keys written by this loader; clean up direct `process.env` mutations yourself.
