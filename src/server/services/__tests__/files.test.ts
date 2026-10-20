import { describe, it, expect } from "vitest";
import path from "path";
import { resolveUploadPath, resolveGuiaPdfPath, contentTypeForPath, contentDisposition } from "../files";
import { UPLOADS_DIR, GUIAS_PDF_DIR } from "../upload";

describe("resolveUploadPath", () => {
  it("resolves a normal /uploads/<name> to a path inside UPLOADS_DIR", () => {
    const p = resolveUploadPath("/uploads/1700000000-abc-extrato.pdf");
    expect(p).toBe(path.join(UPLOADS_DIR, "1700000000-abc-extrato.pdf"));
  });

  it("collapses traversal attempts to the basename (stays inside the dir)", () => {
    const p = resolveUploadPath("/uploads/../../../../etc/passwd");
    expect(p).toBe(path.join(UPLOADS_DIR, "passwd"));
    expect(p!.startsWith(UPLOADS_DIR)).toBe(true);
  });

  it("never escapes UPLOADS_DIR, whatever separators are thrown at it", () => {
    for (const evil of [
      "/uploads/..%2f..%2fsecret",
      "/uploads/..\\..\\secret",
      "/uploads/....//....//secret",
      "/uploads/%2e%2e/secret",
    ]) {
      const p = resolveUploadPath(evil);
      if (p !== null) {
        expect(p.startsWith(UPLOADS_DIR + path.sep)).toBe(true);
      }
    }
  });

  it("rejects anything not under /uploads/", () => {
    expect(resolveUploadPath("/etc/passwd")).toBeNull();
    expect(resolveUploadPath("data:application/pdf;base64,AAAA")).toBeNull();
    expect(resolveUploadPath("/api/pendencies/guia/1/pdf")).toBeNull();
    expect(resolveUploadPath("")).toBeNull();
    expect(resolveUploadPath(null)).toBeNull();
    expect(resolveUploadPath("/uploads/")).toBeNull();
    expect(resolveUploadPath("/uploads/..")).toBeNull();
  });
});

describe("resolveGuiaPdfPath", () => {
  it("accepts an absolute path inside the guias dir", () => {
    const inside = path.join(GUIAS_PDF_DIR, "guia_DAS_SIMPLES_x_202601_5.pdf");
    expect(resolveGuiaPdfPath(inside)).toBe(inside);
  });

  it("rejects a path outside the guias dir", () => {
    expect(resolveGuiaPdfPath("/etc/passwd")).toBeNull();
    expect(resolveGuiaPdfPath(path.join(GUIAS_PDF_DIR, "..", "escape.pdf"))).toBeNull();
    expect(resolveGuiaPdfPath(null)).toBeNull();
  });
});

describe("contentTypeForPath", () => {
  it("maps known extensions", () => {
    expect(contentTypeForPath("/x/y.pdf")).toBe("application/pdf");
    expect(contentTypeForPath("a.PNG")).toBe("image/png");
    expect(contentTypeForPath("a.ofx")).toBe("application/x-ofx");
  });
  it("falls back to octet-stream", () => {
    expect(contentTypeForPath("a.weirdext")).toBe("application/octet-stream");
    expect(contentTypeForPath("noext")).toBe("application/octet-stream");
  });
});

describe("contentDisposition", () => {
  it("strips header-breaking characters and adds an RFC 5987 name", () => {
    const h = contentDisposition("attachment", 'evil"; drop\r\ntable — relatório.pdf');
    expect(h.startsWith("attachment; filename=")).toBe(true);
    expect(h).not.toContain("\r");
    expect(h).not.toContain("\n");
    expect(h).toContain("filename*=UTF-8''");
  });
});
