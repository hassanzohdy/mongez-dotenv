---
description: "Typed Node.js .env loading with `loadEnv`, `loadEnvFile`, `resetEnv`, `env`, `parseLine`, and `parseValue`; resolves `.env.<NODE_ENV>` with optional `.env.shared`, performs narrow number/boolean/null coercion and `${VAR}` interpolation, and controls file-versus-platform precedence. Use for: loading configuration at startup, layered environment files, Docker/CI-injected values, typed config reads, interpolation, or test cleanup. Not this package → higher-level grouped application config and defaults: @mongez/config; schema validation: zod or valibot; browser environment variables: your bundler."
---

# @mongez/dotenv

Load Node.js environment configuration as typed values rather than strings. It resolves a shared defaults file and the active `NODE_ENV` file, maintains a module-scoped store, and can mirror results into `process.env`.

## The 80% path

1. Start at `overview.md` for the state model and package boundaries.
2. At application bootstrap, call `loadEnv()`; use `loader.md` for directory selection, `.env.shared` layering, explicit files, and the `process-wins` (default) vs `file-wins` precedence.
3. Read configuration with `env("KEY", fallback)`; use `parser.md` for coercion, quoted values, interpolation, and `env.all()`.
4. Copy startup, container, validation, read-only, and reset patterns from `recipes.md`.

## Conventions and pitfalls

- Use `env()` for typed reads: `process.env` always stores strings.
- The default `precedence` is `"process-wins"` (2.0): injected values stay authoritative. Pass `"file-wins"` only to restore the 1.x behaviour where the file replaces them.
- `${NAME}` references must already be loaded (earlier in the same file, or an earlier file) or present in `process.env`; forward references throw. Single-quoted values are never interpolated, and `${...}` that is not a valid name stays literal.
- Unquoted values accept inline comments (`PORT=3000 # dev`); `COLOR=#fff` keeps its `#`. Quote the value when it needs ` #`.
- Quoted values may span lines (PEM keys); an unterminated quote in a file throws and loads nothing from that file.
- `resetEnv()` empties the store (`env.all()` is `{}`) and puts back every `process.env` key the loader wrote; keys you set directly on `process.env` after import survive.
