---
name: mongez-dotenv-parser
description: API reference for parseLine, parseValue, and env — the parsing and value-reading layer of @mongez/dotenv.
when_to_use: User calls or asks about parseLine, parseValue, or the env() function; user needs to understand value coercion rules (string-to-number, boolean, null); user asks about ${VAR} interpolation behaviour; user hits the null-collapse edge case with env(); user wants to use parseLine or parseValue standalone without loading a file.
---

# Parser

`parseLine` and `parseValue` are the two parser entry points. `env` / `env.all` read from the store the parser populates.

## Signatures

```ts
function parseLine(line: string): [string, any] | []
function parseValue(value: any): any

const env: {
  (key: string, defaultValue?: any): any;
  all(): Record<string, any>;
};
```

## `parseLine`

Takes one line of file content, returns either `[key, parsedValue]` or `[]` for non-data lines (comments, blanks, lines without an `=`).

```ts
parseLine("APP_PORT=3000");        // ["APP_PORT", 3000]
parseLine('APP_NAME="My App"');    // ["APP_NAME", "My App"]
parseLine("DEBUG=true");           // ["DEBUG", true]
parseLine("EST_TIME=null");        // ["EST_TIME", null]
parseLine("# comment");            // []
parseLine("");                     // []
parseLine("NO_EQUALS_HERE");       // []
parseLine("APP_DEBUG=");           // ["APP_DEBUG", ""]
```

The split happens on the FIRST `=`; remaining `=` characters stay in the value:

```ts
parseLine("KEY=a=b=c");            // ["KEY", "a=b=c"]
```

Destructuring is safe on non-data lines — both elements come back as `undefined`:

```ts
const [key, value] = parseLine("# comment");
// key === undefined, value === undefined
```

## `parseValue` — the coercion table

| Input | Output | Notes |
|---|---|---|
| `"3000"` | `3000` (number) | Any string `isNaN(x)` false |
| `"3.14"` | `3.14` (number) | Decimals supported |
| `"-7"` | `-7` (number) | Negatives supported |
| `"true"` | `true` (boolean) | Case-sensitive |
| `"false"` | `false` (boolean) | Case-sensitive |
| `"null"` | `null` | Case-sensitive |
| `"My App"` | `"My App"` (string) | Stays as-is |
| `"True"` | `"True"` (string) | Wrong case — stays as a string |
| `'"3000"'` | `"3000"` (string) | Quotes opt OUT of coercion |
| `'"a \\"b\\" c"'` | `'a "b" c'` (string) | `\"` is unescaped |
| `""` | `""` | Empty input passes through |
| `undefined` | `undefined` | Falsy input passes through |

`true` / `false` / `null` matching is exact — case-sensitive, no whitespace tolerance beyond `String(value).trim()`.

## `${VAR}` interpolation

A value containing `${VAR}` substitutes another key from the internal store:

```ts
// In a file:
//   APP_HOST=localhost
//   APP_PORT=3000
//   APP_URL=http://${APP_HOST}:${APP_PORT}

env("APP_URL");
// "http://localhost:3000"
```

Resolution rules:

1. The substitution is read from the internal store (`envData`), NOT from `process.env`.
2. Substitution happens at parse time. Later mutations to the referenced key do not re-run substitution.
3. Unresolved references substitute the literal string `"undefined"`:

```ts
parseValue("prefix:${UNKNOWN}:suffix");
// "prefix:undefined:suffix"
```

4. Inside a `loadEnvFile` run, lines are processed top-to-bottom. A `${VAR}` reference must point to a key that appeared in an earlier line (or in `.env.shared`, which loads first).

## Reading values

```ts
env("APP_PORT");                  // 3000     (number — typed)
env("APP_PORT", 8080);            // 3000     (loaded value wins over default)
env("MISSING");                   // undefined
env("MISSING", "default");        // "default"
env("MISSING", 0);                // 0
env("MISSING", false);            // false
env.all();                        // { APP_NAME: "...", APP_PORT: 3000, ... }
```

**Sharp edge:** `env(key, default)` returns `envData[key] ?? defaultValue`. The `??` collapses `null`:

```ts
// .env contains: EST_TIME=null
env("EST_TIME");                  // undefined  (NOT null!)
env("EST_TIME", "fallback");      // "fallback"
env.all().EST_TIME;               // null       (correct value, via the store directly)
```

If you need to distinguish a loaded `null` from a missing key, read through `env.all()`.

## `env.all()` is the store by reference

```ts
const all = env.all();
all.HACKED = "yes";

env("HACKED");   // "yes"  — mutations to env.all() leak into the store
```

Treat the return as read-only.

## Standalone `parseLine` / `parseValue`

You can call the parser without going through `loadEnv` / `loadEnvFile`:

```ts
parseLine('PORT=3000');           // ["PORT", 3000]
parseValue('"hello world"');      // "hello world"
```

But `${VAR}` substitution still reads from the module's `envData` store, which is empty until something populates it. So `parseValue("${X}")` returns `"undefined"` unless `X` was previously set by some earlier `loadEnv` / `loadEnvFile` call (or you call `parseLine` after one).
