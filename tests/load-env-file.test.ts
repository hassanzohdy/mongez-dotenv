import { clearEnv, loadEnvFile } from "..";

describe("test _mongez_dotenv", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    clearEnv();
    jest.resetModules(); // Most important - it clears the cache
    process.env = { ...OLD_ENV }; // Make a copy
  });

  afterAll(() => {
    process.env = OLD_ENV; // Restore old environment
  });

  it("test @mongez/dotenv.loadEnvFile throws error for non existing file", () => {
    let envPath = "";
    let override = false;
    // throw error if file doesn't exist
    expect(() => loadEnvFile(envPath, override)).toThrow();
  });

  it("test @mongez/dotenv.loadEnvFile load .env file and override process.env", () => {
    const envPath = __dirname + "/.env";
    const override = true;
    loadEnvFile(envPath, override);

    expect(process.env.APP_TEST).toBe(true);
  });

  it("test @mongez/dotenv.loadEnvFile load .env file but not override process.env", () => {
    const envPath = __dirname + "/.env";
    const override = false;
    loadEnvFile(envPath, override);

    expect(process.env.APP_TEST).toBe(undefined);
  });
});
