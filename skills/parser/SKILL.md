---
name: mongez-dotenv-parser
description: |
  API reference for `parseLine`, `parseValue`, `env`, and `env.all` — the parsing and value-reading layer of `@mongez/dotenv`.
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

Takes one line of file content, returns either `[key, parsedValue]` or `[]` for non-data lines (comments, blanks, lines without an `=`, lines whose key is invalid).

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

### Line grammar

1. Blank lines and lines whose first non-space character is `#` are skipped.
2. An optional `export ` prefix (`export` plus spaces or tabs) is removed.
3. The key is everything before the first `=`, trimmed: `APP_PORT = 3000` works.
4. The key must match `/^[A-Za-z_][A-Za-z0-9_.-]*$/`; otherwise the line is skipped (returns `[]`), like a line without `=`.
5. The raw value is everything after the first `=`, leading whitespace trimmed. (For inline-comment detection the whitespace right after `=` still counts, see below.)

In a file a leading UTF-8 BOM is ignored and both `\n` and `\r\n` line endings work.

```ts
parseLine("export APP_PORT = 3000"); // ["APP_PORT", 3000]
parseLine("1BAD=x");                 // []
parseLine("MY KEY=x");               // []
```

### Quoted values

A value opening with `"`, `'` or `` ` `` is quoted. The closing quote is the **first** occurrence of the same character not escaped by a backslash; anything after it (whitespace and/or a `# comment`) is discarded. Quoted values are never coerced.

| Quote | Behaviour |
|---|---|
| `'…'` | Literal: no interpolation, no escapes except `\'` giving `'`. |
| `"…"` | `\n` newline, `\r` CR, `\t` tab, `\"`, `\\` and `\$` (a literal `$`, so `\${X}` is the text `${X}`), and `${NAME}` interpolation, in one left-to-right pass. A backslash before any other character is kept. |
| `` `…` `` | Like `"…"` for interpolation and the `` \` ``, `\$`, `\\` escapes, but no `\n` / `\r` / `\t` expansion. |

```ts
parseLine("A='x ${B}'");           // ["A", "x ${B}"]      — literal
parseLine('A="a\\nb"');             // ["A", "a\nb"]        — real newline
parseLine('A="it is \\$5" # note'); // ["A", "it is $5"]
```

**Multiline.** In a file, an opening quote with no closing quote on its line continues over the following lines (joined with `\n`) until a line containing the closing quote:

```bash
PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASC...
-----END PRIVATE KEY-----"
```

If the file ends first, the loader throws `Unterminated "-quoted value for PRIVATE_KEY starting at line 3 of /path/.env` (1-based line where the value opened) and loads nothing from that file. `parseLine` / `parseValue` only see one line and do **not** throw on an unterminated quote: they return the raw value as given.

### Unquoted values and inline comments

An inline comment starts at the first `#` that is preceded by whitespace; it and the whitespace before it are removed. A `#` with no preceding whitespace is kept. The whitespace after `=` counts, so `KEY= # note` gives `""`. Then trailing whitespace is trimmed, `\$` becomes `$`, `${NAME}` is interpolated and the result is coerced. Comments are never interpolated.

```ts
parseLine("PORT=3000 # dev");              // ["PORT", 3000]
parseLine("COLOR=#fff");                   // ["COLOR", "#fff"]
parseLine("URL=https://x.com/#frag");      // ["URL", "https://x.com/#frag"]
parseLine("NAME=My App # trailing");       // ["NAME", "My App"]
parseLine("TODO= # fill in");              // ["TODO", ""]
```

Destructuring is safe on non-data lines — both elements come back as `undefined`:

```ts
const [key, value] = parseLine("# comment");
// key === undefined, value === undefined
```

## `parseValue` — the coercion table

| Input | Output | Notes |
|---|---|---|
| `"3000"` | `3000` (number) | Coerced only on an exact round trip |
| `"3.14"` | `3.14` (number) | Decimals supported |
| `"-7"` | `-7` (number) | Negatives supported |
| `"0123456789"` | `"0123456789"` (string) | Leading zero would be lost |
| `"1e5"` | `"1e5"` (string) | Exponent notation does not round-trip |
| `"+15551234567"` | `"+15551234567"` (string) | `+` would be stripped |
| `"Infinity"` / `"NaN"` | string | Never what a config file meant |
| `"true"` | `true` (boolean) | Case-sensitive |
| `"false"` | `false` (boolean) | Case-sensitive |
| `"null"` | `null` | Case-sensitive |
| `"My App"` | `"My App"` (string) | Stays as-is |
| `"True"` | `"True"` (string) | Wrong case — stays as a string |
| `'"3000"'` | `"3000"` (string) | Quotes opt OUT of coercion |
| `'"a \\"b\\" c"'` | `'a "b" c'` (string) | `\"` is unescaped |
| `"3000 # dev"` | `3000` (number) | Inline comment stripped before coercion |
| `"#fff"` | `"#fff"` (string) | `#` without preceding whitespace is kept |
| `""` | `""` | Empty input passes through |
| `undefined` | `undefined` | Falsy input passes through |

`true` / `false` / `null` matching is exact — case-sensitive, no whitespace tolerance beyond `String(value).trim()`.

### Numbers coerce only on an exact round trip

`isNumeric` is `Number.isFinite(n) && String(n) === value && Math.abs(n) <= Number.MAX_SAFE_INTEGER`, not `!isNaN(value)`. A value becomes a number only when converting it back to a string gives the original characters, so nothing that would lose information is ever converted:

```ts
parseValue("3000");                // 3000            — round-trips
parseValue("0123456789");          // "0123456789"    — leading zero would be lost
parseValue("1234567890123456789"); // string          — beyond MAX_SAFE_INTEGER (every such integer stays a string)
parseValue("0x1F");                // "0x1F"          — would become 31
parseValue("1e5");                 // "1e5"           — would become 100000
parseValue("+15551234567");        // "+15551234567"  — `+` would be stripped
parseValue("1.50");                // "1.50"          — trailing zero is significant
parseValue("Infinity");            // "Infinity"
parseValue("NaN");                 // "NaN"
```

The same rule governs values read from `process.env`. That symmetry is the point: in a `.env` file an author can opt out of coercion by quoting, but a platform-injected value is never quote-stripped, so the operator has no opt-out — and injected secrets, account IDs and tokens are exactly the values that look numeric.

## `${VAR}` interpolation

A value containing `${NAME}` substitutes another key. `NAME` must match `[A-Za-z_][A-Za-z0-9_.-]*`, optional spaces inside the braces are allowed (`${ NAME }`), and the match ends at the first `}`:

```ts
// In a file:
//   APP_HOST=localhost
//   APP_PORT=3000
//   APP_URL=http://${APP_HOST}:${APP_PORT}

env("APP_URL");
// "http://localhost:3000"
```

Resolution rules:

1. The substitution is read from keys parsed earlier in the **same file** first, then the internal store, then `process.env`. A key the platform injected resolves even though no file declares it. Only own keys count: `${constructor}` is unresolvable.
2. Substitution happens at parse time. Later mutations to the referenced key do not re-run substitution.
3. A reference that resolves nowhere **throws, naming the key**:

```ts
parseValue("prefix:${UNKNOWN}:suffix");
// Error: Cannot resolve ${UNKNOWN}: "UNKNOWN" is not defined in the loaded env
// data or in process.env. Forward references are not supported — declare
// "UNKNOWN" before the line that references it, or in .env.shared, which loads first.
```

   Before 1.3.0 this returned the literal string `"prefix:undefined:suffix"` — a corrupted value that starts the app and fails much later, far from the cause. Emitting a broken string is never better than a named error.

4. Text that does not match the pattern (`${not a name}`, an unclosed `${`) stays literal and never throws. Single-quoted values are never interpolated; `\${NAME}` in double-quoted or unquoted values is the literal text `${NAME}`. Interpolation runs after quote parsing, so substituted text can never become quote or comment syntax.
5. Inside a `loadEnvFile` run, lines are processed top-to-bottom, so **forward references are unsupported**. A `${VAR}` reference must point to a key from an earlier line, from `.env.shared` (which loads first), or from `process.env` — otherwise it throws.

## Reading values

Lookup order is **internal store → `process.env` → `defaultValue`**.

```ts
env("APP_PORT");                  // 3000     (number — typed, from .env)
env("APP_PORT", 8080);            // 3000     (loaded value wins over default)
env("NODE_ENV");                  // "test"   (from process.env — no file declares it)
env("MISSING");                   // undefined
env("MISSING", "default");        // "default"
env("MISSING", 0);                // 0
env("MISSING", false);            // false
env.all();                        // { APP_NAME: "...", APP_PORT: 3000, ... }
```

A value that comes from the `process.env` step is coerced to a primitive the same way a file value is — `"8080"` → `8080`, `"true"` → `true`, `"null"` → `null` — so a key's type does not depend on whether it arrived from a file or from the platform. That coercion is deliberately narrower than `parseValue`: no quote stripping and no `${VAR}` interpolation, because a real environment variable is a literal value (a quote or a `${` inside it belongs to the secret). Values with significant leading/trailing whitespace are returned untouched.

Before 1.3.0 `env()` never consulted `process.env`, so any platform-injected variable that no `.env` file happened to name returned its default forever — including `env("NODE_ENV")` before `loadEnv()` had run at all.

`env(key, default)` uses an own-property check on the store (`Object.hasOwn`, not `in` and not `??`; `env("toString", "d")` is `"d"`), so a deliberately-loaded `null` is preserved and distinguishable from a missing key:

```ts
// .env contains: EST_TIME=null
env("EST_TIME");                  // null
env("EST_TIME", "fallback");      // null  (loaded null wins over default)
env.all().EST_TIME;               // null
```

## `env.all()` is the store by reference

```ts
const all = env.all();
all.HACKED = "yes";

env("HACKED");   // "yes"  — mutations to env.all() leak into the store
```

Treat the return as read-only. It contains only what the `.env` files declared (so it is `{}` after `resetEnv()`, even though `env(key)` still falls through to `process.env`) — it is deliberately NOT merged with `process.env`, or every iteration over it would become a dump of the machine's variables. Use `env(key)` when you want the `process.env` fallback.

## Standalone `parseLine` / `parseValue`

You can call the parser without going through `loadEnv` / `loadEnvFile`:

```ts
parseLine('PORT=3000');           // ["PORT", 3000]
parseValue('"hello world"');      // "hello world"
```

But `${VAR}` substitution reads from the module's `envData` store (empty until something populates it), then from `process.env`. So `parseValue("${X}")` **throws** unless `X` was set by an earlier `loadEnv` / `loadEnvFile` call or exists in the real environment.
