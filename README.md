# Dot ENV Parser

A simple and lightweight `.env` parser for Node.js.

## Installation

```bash
npm i @mongez/dotenv
```

OR

```bash
yarn add @mongez/dotenv
```

## Features

- Automatically detects the environment file based on `NODE_ENV` variable.
- Supports dynamic variables.
- Supports comments.
- Supports shared env file.
- Supports data types.
- Supports default value.
- Supports loading env file from a custom path.
- Supports `env` function to get the value of the variable.
- Optionally overrides `process.env` object.

## Usage

```ts
import { loadEnv } from "@mongez/dotenv";

loadEnv();
```

By default it will load `.env` file from the root of your project, but you can pass a path to the file as an argument.

```ts
loadEnv("/path/to/.env");
```

## Override process.env

Any loaded variables from env files will automatically overrides `process.env` object, but you can disable this feature by passing `override` to false in the second argument.

```ts
// disable overriding process.env but auto detect env file
loadEnv(undefined, { override: false });

// with custom .env path
loadEnv("/path/to/.env", { override: false });
```

## Parse Env Based On Current Environment

If not arguments passed, the parser will try to load the proper `.env` file, for example of process.env.NODE_ENV is `production`, it will try to load `.env.production` file and so on.

If none of the files exists, it will load `.env` file.

## Environment Variables

You can use environment variables in your `.env` file, for example:

```bash
APP_NAME=My App
APP_URL=https://myapp.com
```

## Getting Environment Variables Values

Once the `.env` file is loaded, you can access the environment variables values using `process.env` object directly or you can use `env` function.

```ts
import { env } from "@mongez/dotenv";

console.log(env("APP_NAME")); // My App

console.log(env("APP_URL")); // https://myapp.com
```

You can pass a default value as a second argument, in case the variable is not defined.

```ts
console.log(env("APP_NAME", "My App")); // My App

console.log(env("DEBUG", false)); // false
```

## Dynamic Environment Variables

If text contains `${` and `}` it will be treated as a dynamic variable, and it will be replaced with the value of the variable.

```bash
APP_NAME=My App
APP_URL=https://myapp.com
APP_URL_WITH_NAME="${APP_URL}/${APP_NAME}"
```

You can use them in your code like this:

```ts
import { env } from "@mongez/dotenv";

console.log(env("APP_URL_WITH_NAME")); // https://myapp.com/My App
```

If the value contains whitespace, then it should be wrapped in double quotes

```properties
APP_NAME="My App"
```

## Data Types

The parser will try to parse the value of the variable to the proper data type, for example:

```bash
APP_NAME=My App
APP_URL=https://myapp.com
APP_URL_WITH_NAME="${APP_URL}/${APP_NAME}"
DEBUG=true
PORT=3001
```

You can use them in your code like this:

```ts
import { env } from "@mongez/dotenv";

console.log(env("APP_NAME")); // My App

console.log(env("APP_URL")); // https://myapp.com

console.log(env("APP_URL_WITH_NAME")); // https://myapp.com/My App

console.log(env("DEBUG")); // true boolean

console.log(env("PORT")); // 3001 number
```

## Comments

You can add comments to your `.env` file, for example by adding # at the beginning of the line.

```bash
# This is a comment
APP_NAME=My App
```

## Get All Environment Variables

You can get all environment variables using `env.all()` function.

```ts
import { env } from "@mongez/dotenv";

console.log(env.all());
```

## Set environment file directory

You can set the directory of the environment file using by passing the directory to the second argument in `dir` property.

```ts
loadEnv("/path/to/.env", { dir: "/path/to/directory" });
```

## Shared env

Sometimes env files (i.e .env.development and env.production) contain same variables with same values, for example `APP_NAME="My App"`, in this case we'd have to write that variable in all environment files.

Luckily, we can use shared env files, for example we can create a file called `.env.shared` and add all shared variables there, and then we can load it in all environment files.

```bash
# .env.shared
APP_NAME="My App"
APP_URL="https://myapp.com"
```

This feature is set to true by default, if you want to disable it, set in the second argument `loadSharedEnv` to false.

```ts
loadEnv("/path/to/.env", { loadSharedEnv: false });
```
