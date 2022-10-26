# Dot ENV Parser

Yet another dot env `.env` parser, with simple usage.

## Installation

```bash
npm i @mongez/dotenv
```

OR

```bash
yarn add @mongez/dotenv
```

## Usage

```ts
import { loadEnv } from '@mongez/dotenv';

loadEnv();
```

By default it will load `.env` file from the root of your project, but you can pass a path to the file as an argument.

```ts
loadEnv('/path/to/.env');
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
import { env } from '@mongez/dotenv';

console.log(env('APP_NAME')); // My App

console.log(env('APP_URL')); // https://myapp.com
```

You can pass a default value as a second argument, in case the variable is not defined.

```ts
console.log(env('APP_NAME', 'My App')); // My App

console.log(env('DEBUG', false)); // false
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
import { env } from '@mongez/dotenv';

console.log(env('APP_URL_WITH_NAME')); // https://myapp.com/My App
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
import { env } from '@mongez/dotenv';

console.log(env('APP_NAME')); // My App

console.log(env('APP_URL')); // https://myapp.com

console.log(env('APP_URL_WITH_NAME')); // https://myapp.com/My App

console.log(env('DEBUG')); // true boolean

console.log(env('PORT')); // 3001 number
```

## Comments

You can add comments to your `.env` file, for example by adding # at the beginning of the line.

```bash
# This is a comment
APP_NAME=My App
```
