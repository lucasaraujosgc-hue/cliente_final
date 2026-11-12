import { describe, it, expect } from "vitest";
import { sanitizeDecimalText, decimalTextToNumber, numberToDecimalText } from "./decimalInput";

describe("sanitizeDecimalText", () => {
  it("keeps the comma while typing — the bug was losing it", () => {
    expect(sanitizeDecimalText("2,")).toBe("2,");
    expect(sanitizeDecimalText("2,5")).toBe("2,5");
  });

  it("turns a typed dot into a comma", () => {
    expect(sanitizeDecimalText("2.5")).toBe("2,5");
  });

  it("allows a single separator and drops anything else", () => {
    expect(sanitizeDecimalText("2,5,1")).toBe("2,51");
    expect(sanitizeDecimalText("2,5%")).toBe("2,5");
    expect(sanitizeDecimalText("abc")).toBe("");
  });

  it("caps the decimals", () => {
    expect(sanitizeDecimalText("2,123456")).toBe("2,1234");
    expect(sanitizeDecimalText("2,123456", 2)).toBe("2,12");
  });
});

describe("decimalTextToNumber", () => {
  it.each([
    ["2,5", 2.5],
    ["2.5", 2.5],
    ["2,", 2],
    [",5", 0.5],
    ["", 0],
    ["05", 5],
    ["3,65", 3.65],
  ])("%s → %s", (text, n) => {
    expect(decimalTextToNumber(text)).toBe(n);
  });
});

describe("numberToDecimalText", () => {
  it("shows the value the Brazilian way", () => {
    expect(numberToDecimalText(2.5)).toBe("2,5");
    expect(numberToDecimalText(5)).toBe("5");
  });

  it("falls back to 0", () => {
    expect(numberToDecimalText(null)).toBe("0");
    expect(numberToDecimalText(undefined)).toBe("0");
    expect(numberToDecimalText(NaN)).toBe("0");
  });
});
