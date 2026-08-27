import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";

export const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Where SERPRO-generated guia PDFs are written (see client.routes.ts). Kept
// here so the download endpoint and the generator agree on the location.
export const GUIAS_PDF_DIR = process.env.DATA_PATH
  ? path.join(process.env.DATA_PATH, "guias_pdfs")
  : path.join(process.cwd(), "data", "guias_pdfs");

// Extensions accepted for client / accountant / webhook document uploads.
// Anything executable or script-like (.exe, .sh, .js, .html, .svg, .php...) is
// rejected — these are contábil documents, not code.
export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  ".pdf",
  ".ofx", ".xml", ".p7s",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic",
  ".txt", ".csv",
  ".xls", ".xlsx", ".ods",
  ".doc", ".docx", ".odt",
  ".zip",
]);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// Strips any directory components and unsafe characters from a client- or
// webhook-supplied file name so it can't be used for path traversal
// ("../../etc/passwd") or to overwrite unrelated files.
export function sanitizeFilename(name: string | undefined | null): string {
  const base = path.basename(String(name || "").replace(/\\/g, "/"));
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  return cleaned.slice(0, 120) || "arquivo";
}

// For non-multer writers (webhooks that accept base64): is this filename's
// extension on the allow-list?
export function isAllowedUploadName(name: string | undefined | null): boolean {
  return ALLOWED_UPLOAD_EXTENSIONS.has(path.extname(String(name || "")).toLowerCase());
}

function uploadFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipo de arquivo não permitido: ${ext || "sem extensão"}`));
  }
}

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (_req, file, cb) {
    // Random, collision-proof name → no overwrite of an existing file and no
    // way for a crafted originalname to control the stored path. The original
    // name is preserved (sanitised) only as a readable suffix.
    const unique = `${Date.now()}-${crypto.randomUUID()}`;
    cb(null, `${unique}-${sanitizeFilename(file.originalname)}`);
  },
});

// General file upload (documents, bank statements, etc). 10 MB, one file.
export const upload = multer({
  storage,
  fileFilter: uploadFileFilter,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

const certStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dest = process.env.DATA_PATH
      ? path.join(process.env.DATA_PATH, "certs")
      : path.join(process.cwd(), "data", "certs");
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    cb(null, dest);
  },
  filename: (_req, file, cb) =>
    cb(null, `cert_${Date.now()}_${sanitizeFilename(file.originalname)}`),
});

// Digital certificate upload (.pfx / .p12) used for SERPRO integration. 5 MB limit.
export const uploadCert = multer({
  storage: certStorage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".pfx" || ext === ".p12") cb(null, true);
    else cb(new Error("Apenas arquivos .pfx ou .p12 são aceitos."));
  },
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
