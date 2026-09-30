import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "../upload";

describe("sanitizeFilename", () => {
  it("strips directory traversal components", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\windows\\system32\\cmd.exe")).toBe("cmd.exe");
    expect(sanitizeFilename("/absolute/path/file.pdf")).toBe("file.pdf");
  });

  it("replaces unsafe characters", () => {
    expect(sanitizeFilename("my file (1).pdf")).toBe("my_file_1_.pdf");
    expect(sanitizeFilename("relatório#2024$.xlsx")).toBe("relat_rio_2024_.xlsx");
  });

  it("keeps a leading dot from turning into a hidden file", () => {
    expect(sanitizeFilename("...secret")).toBe("secret");
  });

  it("falls back to a default when nothing usable remains", () => {
    expect(sanitizeFilename("")).toBe("arquivo");
    expect(sanitizeFilename(null)).toBe("arquivo");
    expect(sanitizeFilename("///")).toBe("arquivo");
  });

  it("caps the length", () => {
    expect(sanitizeFilename("a".repeat(500)).length).toBe(120);
  });
});
