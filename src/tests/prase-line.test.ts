import { parseLine } from "..";

describe("test _mongez_dotenv", () => {
  it("test @mongez/dotenv.parseLine", () => {
    const line = 'APP_NAME="Mongez"';
    const [key, value] = parseLine(line);

    expect(key).toBe("APP_NAME");
    expect(value).toBe("Mongez");
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
