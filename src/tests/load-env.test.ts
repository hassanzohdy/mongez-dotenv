import { clearEnv, loadEnv, loadEnvFile } from "..";

describe("@mongez/dotenv.loadEnv", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    clearEnv();
    jest.resetModules(); // Most important - it clears the cache
    process.env = { ...OLD_ENV }; // Make a copy
  });

  afterAll(() => {
    process.env = OLD_ENV; // Restore old environment
  });

  it("test @mongez/dotenv.loadEnv load env file automatically", () => {
    loadEnv(undefined, {
      dir: __dirname,
    });

    expect(process.env.APP_TEST).toBe(true);
  });

  it("test @mongez/dotenv.loadEnv load .env.development file based on current env", () => {
    process.env.NODE_ENV = "development";

    loadEnv(undefined, {
      dir: __dirname,
    });

    expect(process.env.APP_MODE).toBe("development");

    process.env.NODE_ENV = "production";

    loadEnv(undefined, {
      dir: __dirname,
    });

    expect(process.env.APP_MODE).toBe("production");
  });

  it("test @mongez/dotenv.loadEnv load shared env file", () => {
    loadEnv(undefined, {
      dir: __dirname,
    });

    expect(process.env.APP_NAME).toBe("Hello");
  });

  it("test @mongez/dotenv.loadEnv disabled shared env file", () => {
    loadEnv(undefined, {
      dir: __dirname,
      loadSharedEnv: false,
    });

    expect(process.env.APP_NAME).toBe(undefined);
  });

  it("test @mongez/dotenv.loadEnv set proper type based on its value type", () => {
    loadEnv(undefined, {
      dir: __dirname,
    });

    expect(typeof process.env.APP_TEST).toBe("boolean");
    expect(typeof process.env.APP_PORT).toBe("number");
  });

  it("test @mongez/dotenv.loadEnv use dynamic variables", () => {
    loadEnv(undefined, {
      dir: __dirname,
    });

    expect(process.env.APP_URL).toBe("http://localhost:3000");
  });
});
