import { cwd } from "process";
import { existsSync, readFileSync } from "fs";

let envData: any = {};

/**
 * Check if the given value is a number
 * If it is a string but contains only number, it should return true
 */
function isNumeric(value: any) {
  return !isNaN(value);
}

/**
 * Clear env data
 */
export function clearEnv() {
  envData = {};
}

export function parseLine(line: string): [string, any] | [] {
  line = line.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) return [];

  const [key, value] = line.split("=") as any;

  return [key, parseValue(value)];
}

export function parseValue(value: any) {
  if (!value) return value;

  value = String(value).trim();

  // trim any double quotes but keep the one with backslash escape
  if (value.startsWith('"') && value.endsWith('"')) {
    // Remove the first and last characters (i.e. the quotes)
    value = value.slice(1, -1);

    // Replace any escaped double quotes with a single double quote
    value = value.replace(/\\"/g, '"');
  }

  // Converting Env variables to values
  if (value.includes("${")) {
    value = value.replace(
      /\$\{([^{]+)\}/g,
      (_match: string, key: string) => envData[key]
    );
  }

  if (value.includes("#")) {
    const [val] = value.split("#");
    value = val.trim();
  }
  if (isNumeric(value)) {
    value = Number(value);
  } else if (value === "null") {
    value = null;
  } else if (value === "true") {
    value = true;
  } else if (value === "false") {
    value = false;
  }

  return value;
}

export type EnvLoaderOptions = {
  override?: boolean;
  dir?: string;
  loadSharedEnv?: boolean;
};

const defaultOptions = {
  override: true,
  dir: cwd(),
  loadSharedEnv: true,
};

/**
 * Load data from file and set the env data from that file
 */
export function loadEnv(envPath?: string, envOptions?: EnvLoaderOptions) {
  const options = { ...defaultOptions, ...(envOptions || {}) };

  if (!envPath) {
    const rootPath = options.dir || cwd();

    const currentEnvPath = rootPath + `/.env.${process.env.NODE_ENV}`;

    if (existsSync(currentEnvPath)) {
      envPath = currentEnvPath;
    } else {
      envPath = rootPath + "/.env";
    }
  }

  loadEnvFile(envPath, options.override);

  if (options.loadSharedEnv && existsSync(options.dir + "/.env.shared")) {
    loadEnvFile(options.dir + "/.env.shared", options.override);
  }
}

export function loadEnvFile(envPath: string, override: boolean) {
  if (!existsSync(envPath)) {
    throw new Error(`.env file not found at ${envPath}`);
  }

  const lines: string[] = readFileSync(envPath, "utf-8").split(/\n|\r\n/);
  envData = [];

  for (const line of lines) {
    const [key, value] = parseLine(line);

    if (!key) continue;

    envData[key] = parseValue(value);
    if (override) {
      process.env[key] = envData[key];
    }
  }
}

export function env(key: string, defaultValue?: any): any {
  return envData[key] ?? defaultValue;
}

env.all = () => envData;
