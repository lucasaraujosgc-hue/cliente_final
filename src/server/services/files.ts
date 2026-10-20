import fs from "fs";
import path from "path";
import type { Response } from "express";
import { UPLOADS_DIR, GUIAS_PDF_DIR } from "./upload";

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".ofx": "application/x-ofx",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".zip": "application/zip",
  ".p7s": "application/pkcs7-signature",
};

export function contentTypeForPath(p: string): string {
  return MIME_BY_EXT[path.extname(p).toLowerCase()] || "application/octet-stream";
}

// True iff `candidate` resolves to a location inside `dir` (no traversal).
function isInside(dir: string, candidate: string): boolean {
  const rel = path.relative(dir, candidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

// Resolves a stored `documents.file_url` of the form "/uploads/<name>" to a
// safe absolute path inside UPLOADS_DIR. Only the basename is honoured, so a
// stored value like "/uploads/../../etc/passwd" collapses to "passwd" and then
// fails the containment check if it still isn't inside the dir.
export function resolveUploadPath(storedUrl: string | null | undefined): string | null {
  if (!storedUrl) return null;
  const prefix = "/uploads/";
  if (!storedUrl.startsWith(prefix)) return null;
  // Normalise backslashes first so "\" is treated as a separator on every OS,
  // then keep only the last path segment.
  const name = path.basename(storedUrl.slice(prefix.length).replace(/\\/g, "/"));
  if (!name || name === "." || name === ".." || name.includes("/")) return null;
  const abs = path.join(UPLOADS_DIR, name);
  return isInside(UPLOADS_DIR, abs) ? abs : null;
}

// Resolves a `guias_geradas.pdf_path` (an absolute path written server-side) to
// a safe absolute path inside GUIAS_PDF_DIR, or null.
export function resolveGuiaPdfPath(pdfPath: string | null | undefined): string | null {
  if (!pdfPath) return null;
  const abs = path.resolve(pdfPath);
  return isInside(GUIAS_PDF_DIR, abs) ? abs : null;
}

// Loads the bytes of a document's file for server-side processing (PDF text
// extraction for the payment query). Mirrors the resolution in
// files.routes.ts: an inline data: URI, a pointer to a SERPRO-generated guia
// (guias_geradas.pdf_path), or a regular /uploads/<name> file. Returns null
// when the file can't be resolved or read. Buffers the whole file — only call
// it for the small guia PDFs, never on a hot request path.
export async function loadDocumentPdfBuffer(
  fileUrl: string | null | undefined,
): Promise<Buffer | null> {
  if (!fileUrl) return null;

  if (fileUrl.startsWith("data:")) {
    const m = fileUrl.match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/);
    if (!m) return null;
    try {
      return m[2]
        ? Buffer.from(m[3], "base64")
        : Buffer.from(decodeURIComponent(m[3]));
    } catch {
      return null;
    }
  }

  const guiaMatch = fileUrl.match(/^\/api\/pendencies\/guia\/(\d+)\/pdf$/);
  if (guiaMatch) {
    const { eq } = await import("drizzle-orm");
    const { db } = await import("../db");
    const { guiasGeradas } = await import("../schema");
    const [guia] = await db
      .select()
      .from(guiasGeradas)
      .where(eq(guiasGeradas.id, Number(guiaMatch[1])));
    if (!guia?.pdfPath) return null;
    if (guia.pdfPath.startsWith("data:")) return loadDocumentPdfBuffer(guia.pdfPath);
    const guiaAbs = resolveGuiaPdfPath(guia.pdfPath);
    if (!guiaAbs || !(await isReadableFile(guiaAbs))) return null;
    try {
      return await fs.promises.readFile(guiaAbs);
    } catch {
      return null;
    }
  }

  const abs = resolveUploadPath(fileUrl);
  if (!abs || !(await isReadableFile(abs))) return null;
  try {
    return await fs.promises.readFile(abs);
  } catch {
    return null;
  }
}

// Header-safe filename for Content-Disposition (ASCII fallback + RFC 5987).
export function contentDisposition(
  disposition: "inline" | "attachment",
  rawName: string,
): string {
  const ascii = (rawName || "arquivo")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .slice(0, 120) || "arquivo";
  const utf8 = encodeURIComponent(rawName || "arquivo");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

interface SendOpts {
  disposition: "inline" | "attachment";
  downloadName: string;
}

function baseHeaders(res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

// Streams a file from disk — never buffers it whole. Caller must have already
// validated `absPath` (resolveUploadPath / resolveGuiaPdfPath) and confirmed
// it exists (isReadableFile).
export async function sendDiskFile(res: Response, absPath: string, opts: SendOpts) {
  let size = 0;
  try {
    size = (await fs.promises.stat(absPath)).size;
  } catch {
    if (!res.headersSent) res.status(404).json({ error: "Arquivo não encontrado." });
    return;
  }

  baseHeaders(res);
  res.setHeader("Content-Type", contentTypeForPath(absPath));
  res.setHeader("Content-Disposition", contentDisposition(opts.disposition, opts.downloadName));
  res.setHeader("Content-Length", String(size));

  const stream = fs.createReadStream(absPath);
  stream.on("error", () => {
    if (!res.headersSent) res.status(500).end();
    else res.destroy();
  });
  stream.pipe(res);
}

// Decodes a `data:` URI stored in the DB and sends it (small, already in memory).
export function sendDataUri(res: Response, dataUri: string, opts: SendOpts) {
  const m = dataUri.match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/);
  if (!m) {
    res.status(415).json({ error: "Formato de arquivo inválido." });
    return;
  }
  const mime = m[1] || "application/octet-stream";
  const buf = m[2]
    ? Buffer.from(m[3], "base64")
    : Buffer.from(decodeURIComponent(m[3]));
  baseHeaders(res);
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", contentDisposition(opts.disposition, opts.downloadName));
  res.setHeader("Content-Length", String(buf.length));
  res.end(buf);
}

// Checks a disk file exists and is a regular file.
export async function isReadableFile(absPath: string): Promise<boolean> {
  try {
    const st = await fs.promises.stat(absPath);
    return st.isFile();
  } catch {
    return false;
  }
}
