import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("CSV export", () => {
  it("neutralises spreadsheet formulas in text cells but keeps numbers", () => {
    const csv = toCsv(["name", "value"], [["=HYPERLINK(\"x\")", -3.5], ["+cmd", 2], ["@sum", 1], ["plain, text", 0]]);
    const lines = csv.split("\n");
    expect(lines[1]).toBe(`"'=HYPERLINK(""x"")",-3.5`);
    expect(lines[2]).toBe("'+cmd,2");
    expect(lines[3]).toBe("'@sum,1");
    expect(lines[4]).toBe('"plain, text",0');
  });
});
