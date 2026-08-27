import { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { documents, guiasGeradas } from "../schema";
import { verifyAnyAuth } from "../middleware/auth";
import { getAuth } from "../types";
import { isUuid } from "../services/serpro";
import {
  resolveUploadPath,
  resolveGuiaPdfPath,
  sendDiskFile,
  sendDataUri,
  isReadableFile,
} from "../services/files";

// Authenticated document download / view. Replaces the old public
// `express.static("/uploads")` mount — a contábil document must never be
// reachable just by knowing its URL.
export function registerFileRoutes(app: Express) {
  app.get("/api/documents/:id/file", verifyAnyAuth, async (req, res) => {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: "ID de documento inválido." });
    }

    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    if (!doc) {
      return res.status(404).json({ error: "Documento não encontrado." });
    }

    // Authorization: a client may only read its own documents; the accountant
    // (single admin account) may read any client's documents.
    const auth = getAuth(req);
    if (auth.role === "client" && doc.clientId !== auth.clientId) {
      return res.status(403).json({ error: "Acesso negado a este documento." });
    }

    // NEVER trust a file path from the request. Everything below is derived
    // from `doc.fileUrl`, which is written server-side by the upload handlers.
    const stored = doc.fileUrl;
    if (!stored) {
      return res.status(404).json({ error: "Documento sem arquivo associado." });
    }

    const disposition = req.query.download ? "attachment" : "inline";
    const downloadName = `${(doc.title || "documento").replace(/[/\\]+/g, "-")}`;

    // 1. Inline data: URI stored directly in the DB (some webhook payloads).
    if (stored.startsWith("data:")) {
      return sendDataUri(res, stored, { disposition, downloadName });
    }

    // 2. Pointer to a SERPRO-generated guia PDF.
    const guiaMatch = stored.match(/^\/api\/pendencies\/guia\/(\d+)\/pdf$/);
    if (guiaMatch) {
      const [guia] = await db
        .select()
        .from(guiasGeradas)
        .where(eq(guiasGeradas.id, Number(guiaMatch[1])));
      if (!guia || !guia.pdfPath) {
        return res.status(404).json({ error: "Guia não encontrada." });
      }
      if (auth.role === "client" && guia.clientId !== auth.clientId) {
        return res.status(403).json({ error: "Acesso negado a esta guia." });
      }
      if (guia.pdfPath.startsWith("data:")) {
        return sendDataUri(res, guia.pdfPath, {
          disposition,
          downloadName: `${downloadName}.pdf`,
        });
      }
      const guiaAbs = resolveGuiaPdfPath(guia.pdfPath);
      if (!guiaAbs || !(await isReadableFile(guiaAbs))) {
        return res.status(404).json({ error: "PDF da guia não encontrado." });
      }
      return sendDiskFile(res, guiaAbs, {
        disposition,
        downloadName: `${downloadName}.pdf`,
      });
    }

    // 3. Regular /uploads/<name> file on disk.
    const abs = resolveUploadPath(stored);
    if (!abs || !(await isReadableFile(abs))) {
      return res.status(404).json({ error: "Arquivo não encontrado." });
    }
    return sendDiskFile(res, abs, { disposition, downloadName });
  });
}
