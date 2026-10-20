import { describe, it, expect } from "vitest";
import { sniffFamily, contentMatchesExtension } from "../fileType";

const PDF = Buffer.from("%PDF-1.7\n...");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]); // xlsx/docx container
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const GIF = Buffer.from("GIF89a");
const TEXT = Buffer.from("<?xml version='1.0'?><OFX></OFX>");
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ

describe("sniffFamily", () => {
  it("recognises the formats we care about", () => {
    expect(sniffFamily(PDF)).toBe("pdf");
    expect(sniffFamily(PNG)).toBe("png");
    expect(sniffFamily(JPEG)).toBe("jpeg");
    expect(sniffFamily(ZIP)).toBe("zip");
    expect(sniffFamily(OLE2)).toBe("ole2");
    expect(sniffFamily(GIF)).toBe("gif");
    expect(sniffFamily(TEXT)).toBeNull();
    expect(sniffFamily(EXE)).toBeNull();
  });
});

describe("contentMatchesExtension", () => {
  it("accepts content that matches the extension", () => {
    expect(contentMatchesExtension(PDF, "guia.pdf")).toBe(true);
    expect(contentMatchesExtension(PNG, "logo.PNG")).toBe(true);
    expect(contentMatchesExtension(JPEG, "foto.jpeg")).toBe(true);
    expect(contentMatchesExtension(ZIP, "planilha.xlsx")).toBe(true);
    expect(contentMatchesExtension(ZIP, "contrato.docx")).toBe(true);
    expect(contentMatchesExtension(OLE2, "antigo.xls")).toBe(true);
    expect(contentMatchesExtension(OLE2, "antigo.doc")).toBe(true);
  });

  it("rejects a spoofed extension (e.g. an EXE named .pdf, HTML named .png)", () => {
    expect(contentMatchesExtension(EXE, "malware.pdf")).toBe(false);
    expect(contentMatchesExtension(Buffer.from("<html><script>"), "x.png")).toBe(false);
    expect(contentMatchesExtension(PDF, "notreally.xlsx")).toBe(false);
    expect(contentMatchesExtension(JPEG, "photo.png")).toBe(false);
  });

  it("passes non-sniffable text formats through (allow-list handles them)", () => {
    expect(contentMatchesExtension(TEXT, "extrato.ofx")).toBe(true);
    expect(contentMatchesExtension(TEXT, "nota.xml")).toBe(true);
    expect(contentMatchesExtension(Buffer.from("a,b,c"), "dados.csv")).toBe(true);
    expect(contentMatchesExtension(Buffer.from("assinatura"), "doc.p7s")).toBe(true);
  });
});
