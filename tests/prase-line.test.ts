import { parseLine } from "..";

describe("@mongez/dotenv.parseLine", () => {
  it("should parse string", () => {
    const line = 'APP_NAME="Mongez"';
    const [key, value] = parseLine(line);

    expect(key).toBe("APP_NAME");
    expect(value).toBe("Mongez");
  });

  it("test @mongez/dotenv.parseLine escape double quote", () => {
    const line = 'APP_NAME="Mongez\\""';
    const [key, value] = parseLine(line);

    console.log(value, value.length);

    expect(key).toBe("APP_NAME");
    expect(value).toBe('Mongez\\"');
  });

  it("test @mongez/dotenv.parseLine with number", () => {
    const line = "APP_PORT=3000";
    const [key, value] = parseLine(line);

    expect(key).toBe("APP_PORT");
    expect(value).toBe(3000);
  });

  it("test @mongez/dotenv.parseLine with boolean", () => {
    const line = "APP_DEBUG=true";
    const [key, value] = parseLine(line);

    expect(key).toBe("APP_DEBUG");
    expect(value).toBe(true);
  });

  it("test @mongez/dotenv.parseLine with null", () => {
    const line = "APP_DEBUG=null";
    const [key, value] = parseLine(line);

    expect(key).toBe("APP_DEBUG");
    expect(value).toBe(null);
  });

  it("test @mongez/dotenv.parseLine with empty string", () => {
    const line = "APP_DEBUG=";
    const [key, value] = parseLine(line);

    expect(key).toBe("APP_DEBUG");
    expect(value).toBe("");
  });

  it("test @mongez/dotenv.parseLine with empty line", () => {
    const line = "";
    const [key, value] = parseLine(line);

    expect(key).toBe(undefined);
    expect(value).toBe(undefined);
  });
});
