import { exists, getFile } from "@mongez/fs";
import { get, trim } from "@mongez/reinforcements";
import Is from "@mongez/supportive-is";
import { cwd } from "process";

let envData: any = {};

function parseLine(line: string): void {
  line = line.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) return;

  const [key, value] = line.split("=") as any;

  envData[key] = parseValue(value);
}

function parseValue(value: any): any {
  // trim any double quotes
  value = trim(value, '"');

  // Converting Env variables to values
  if (value.includes("${")) {
    value = value.replace(
      /\$\{([^{]+)\}/g,
      (_match: string, key: string) => envData[key],
    );
  }

  if (value.includes("#")) {
    const [val] = value.split("#");
    value = trim(val);
  }

  if (Is.numeric(value)) {
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

/**
 * Load data from file and set the env data from that file
 */
export function loadEnv(envPath?: string | undefined): void {
  if (!envPath) {
    const rootPath = cwd();

    if (exists(rootPath + `/.env.${process.env.NODE_ENV}`)) {
      envPath = rootPath + `/.env.${process.env.NODE_ENV}`;
    } else {
      envPath = rootPath + "/.env";
    }
  }

  if (!exists(envPath)) {
    throw new Error(`.env file not found at ${envPath}`);
  }

  const lines: string[] = getFile(envPath).split(/\n|\r\n/);
  envData = [];

  for (const line of lines) {
    parseLine(line);
  }

  for (const key in envData) {
    process.env[key] = envData[key];
  }

  console.log(envData);
}

export function env(key: string, defaultValue: any = null): any {
  return get(envData, key, defaultValue);
}
