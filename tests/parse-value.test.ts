import { parseLine, parseValue } from "../src";

describe("test @mongez/dotenv.parseValue", () => {
  it("should parse string", () => {
    const value = "test";
    expect(parseValue(value)).toBe(value);
  });
});
