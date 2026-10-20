// Lightweight magic-byte sniffing so we don't trust the client's extension or
// Content-Type alone. Covers the formats the platform actually receives; text
// formats (.xml/.ofx/.csv/.txt/.p7s) have no reliable signature and are left
// to the extension allow-list.

import path from "path";

export type FileFamily =
  | "pdf" | "png" | "jpeg" | "gif" | "webp" | "bmp" | "tiff" | "heic"
  | "zip" | "ole2";

function startsWith(buf: Buffer, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[offset + i] !== sig[i]) return false;
  return true;
}

export function sniffFamily(buf: Buffer): FileFamily | null {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return "gif"; // GIF8
  if (startsWith(buf, [0x42, 0x4d])) return "bmp";
  if (startsWith(buf, [0x49, 0x49, 0x2a, 0x00]) || startsWith(buf, [0x4d, 0x4d, 0x00, 0x2a])) return "tiff";
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  if (startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4)) return "heic"; // ....ftyp (heic/heif/mif1)
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole2"; // legacy doc/xls
  if (
    startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(buf, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(buf, [0x50, 0x4b, 0x07, 0x08])
  ) return "zip"; // docx/xlsx/odt/ods/zip
  return null;
}

// Extensions whose content we can and do verify. Maps to the accepted families.
const EXT_FAMILIES: Record<string, FileFamily[]> = {
  ".pdf": ["pdf"],
  ".png": ["png"],
  ".jpg": ["jpeg"],
  ".jpeg": ["jpeg"],
  ".gif": ["gif"],
  ".webp": ["webp"],
  ".bmp": ["bmp"],
  ".tif": ["tiff"],
  ".tiff": ["tiff"],
  ".heic": ["heic"],
  ".zip": ["zip"],
  ".xlsx": ["zip"],
  ".docx": ["zip"],
  ".odt": ["zip"],
  ".ods": ["zip"],
  ".xls": ["ole2"],
  ".doc": ["ole2"],
};

// true  -> content is consistent with the extension (or the extension isn't
//          one we verify by magic bytes)
// false -> the extension IS verifiable and the bytes don't match
export function contentMatchesExtension(buf: Buffer, filename: string): boolean {
  const ext = path.extname(filename || "").toLowerCase();
  const expected = EXT_FAMILIES[ext];
  if (!expected) return true; // not magic-verifiable (text, p7s, ofx, xml, csv, txt)
  const fam = sniffFamily(buf);
  return fam != null && expected.includes(fam);
}
