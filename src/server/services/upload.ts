import fs from "fs";
import path from "path";
import multer from "multer";

export const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Strips any directory components and unsafe characters from a client- or
// webhook-supplied file name so it can't be used for path traversal
// ("../../etc/passwd") or to overwrite unrelated files.
export function sanitizeFilename(name: string | undefined | null): string {
  const base = path.basename(String(name || "").replace(/\\/g, "/"));
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  return cleaned.slice(0, 120) || "arquivo";
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + sanitizeFilename(file.originalname));
  },
});

// General file upload (documents, etc). 10 MB limit.
export const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
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
  limits: { fileSize: 5 * 1024 * 1024 },
});
