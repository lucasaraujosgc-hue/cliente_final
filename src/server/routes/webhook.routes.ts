import { Express } from "express";
import fs from "fs";
import path from "path";
import { db } from "../db";
import { documents } from "../schema";
import { findClientByIntegrationToken } from "../services/integrationToken";
import {
  upload,
  UPLOADS_DIR,
  sanitizeFilename,
  isAllowedUploadName,
  validateUploadedFileContent,
  MAX_UPLOAD_BYTES,
} from "../services/upload";
import { contentMatchesExtension } from "../services/fileType";
import { triggerDebouncedDocumentNotification } from "../services/notificationSweeper";
import { webhookLimiter } from "../middleware/rateLimit";
import { validateBody } from "../middleware/validate";
import { webhookReceitasSchema, webhookDocumentosSchema } from "../schemas/validation";

// Routes used by external systems (accounting software, file providers, etc.)
// to push documents into the platform.
export function registerWebhookRoutes(app: Express) {
  // Webhook for receiving files from external systems
  app.post("/api/webhook/receitas", webhookLimiter, validateBody(webhookReceitasSchema), async (req, res) => {
    try {
      const {
        hash_empresa,
        vencimento, // DD/MM/YYYY
        competencia, // MM/YYYY
        categoria,
        nome_arquivo,
        arquivo_base64,
        dados_extraidos,
      } = req.body;

      // hash_empresa presence/shape is already guaranteed by validateBody().
      if (!arquivo_base64 && categoria !== "SITFIS_RECEITA") {
        return res
          .status(400)
          .json({ error: "arquivo_base64 is required for this category" });
      }

      // Find client
      const client = await findClientByIntegrationToken(hash_empresa);
      if (!client) {
        return res
          .status(404)
          .json({ error: "Client not found using provided hash" });
      }

      // Save file
      let safeFilename = "";
      let pixCode = null;
      let extractedValue = null;
      if (arquivo_base64) {
        const buffer = Buffer.from(arquivo_base64, "base64");
        if (buffer.length > MAX_UPLOAD_BYTES) {
          return res.status(413).json({ error: "Arquivo excede o limite de 10 MB." });
        }
        // Only enforce the extension allow-list when the caller gave a name.
        if (nome_arquivo && !isAllowedUploadName(nome_arquivo)) {
          return res.status(415).json({ error: "Tipo de arquivo não permitido." });
        }
        if (nome_arquivo && !contentMatchesExtension(buffer, nome_arquivo)) {
          return res.status(415).json({ error: "O conteúdo do arquivo não corresponde à sua extensão." });
        }
        safeFilename = `${Date.now()}_${sanitizeFilename(nome_arquivo || "documento")}`;
        const filePath = path.join(UPLOADS_DIR, safeFilename);
        await fs.promises.writeFile(filePath, buffer);

        // Extract Pix Code and Value if it's a PDF
        if (safeFilename.toLowerCase().endsWith(".pdf")) {
          const { extractPixCodeFromPdf, extractValueFromPdfBuffer } = await import("../qrExtractor");
          pixCode = await extractPixCodeFromPdf(buffer);
          extractedValue = await extractValueFromPdfBuffer(buffer, categoria || "");
        }
      }

      // Create document record
      let competence = competencia || "";
      if (!competence && vencimento) {
        // Assume format DD/MM/YYYY and extract MM/YYYY
        const parts = vencimento.split("/");
        if (parts.length >= 2) {
          competence = `${parts[1]}/${parts.length === 3 ? parts[2] : new Date().getFullYear()}`;
        }
      }

      let titleStr =
        categoria === "SITFIS_RECEITA"
          ? `SitFis Extração`
          : nome_arquivo || `Documento ${categoria}`;
      if (
        dados_extraidos &&
        Array.isArray(dados_extraidos) &&
        dados_extraidos.length > 0
      ) {
        titleStr += ` - ${dados_extraidos[0].orgao}: ${dados_extraidos[0].status}`;
      }

      let finalExtractedData: any = dados_extraidos || null;
      if (extractedValue !== null) {
         if (Array.isArray(finalExtractedData)) {
             finalExtractedData = { array: finalExtractedData, extractedValue };
         } else {
             finalExtractedData = finalExtractedData || {};
             finalExtractedData.extractedValue = extractedValue;
         }
      }

      const newDoc = await db
        .insert(documents)
        .values({
          clientId: client.id,
          title: titleStr,
          category: categoria || "webhook_doc",
          competence: competence || "00/0000",
          dueDate: vencimento || null,
          fileUrl: safeFilename ? `/uploads/${safeFilename}` : null,
          pixCode: pixCode,
          extractedData: finalExtractedData,

          status: "new",
          uploadedBy: "accountant", // As it comes from integration system
        })
        .returning();

      // Trigger on_file_available notification logic here for this document (with debounce).
      // NOTE: this used to be ~60 lines of duplicated logic inline; it's identical to
      // triggerDebouncedDocumentNotification, so we just call the shared implementation.
      triggerDebouncedDocumentNotification(newDoc[0]);

      res.status(200).json({ success: true, documentId: newDoc[0].id });
    } catch (e: any) {
      console.error("Webhook Error:", e);
      res.status(500).json({ error: e.message });
    }
  });


  // Webhook for External System Integration
  app.post(
    "/api/webhook/documentos",
    webhookLimiter,
    upload.single("arquivo"),
    validateUploadedFileContent,
    validateBody(webhookDocumentosSchema),
    async (req, res) => {
      try {
        const companyHash = req.body.companyHash;
        const categoria = req.body.categoria || "Outros";
        const dataVencimento = req.body.dataVencimento;
        // multer diskStorage populates req.file.path/.filename (not .buffer).
        const nomeArquivo =
          req.body.nomeArquivo ||
          (req.file ? req.file.originalname : "Documento Integrado");

        let arquivoBase64: string | null = null;
        if (!req.file && req.body.arquivo) {
          arquivoBase64 = String(req.body.arquivo).startsWith("data:")
            ? req.body.arquivo
            : "data:application/pdf;base64," + req.body.arquivo;
        }

        if (!companyHash) {
          // A rejected multipart upload already wrote a temp file — clean it.
          if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
          return res
            .status(400)
            .json({ error: "O parâmetro companyHash é obrigatório" });
        }

        const targetClient = await findClientByIntegrationToken(companyHash);
        if (!targetClient) {
          if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
          return res
            .status(404)
            .json({ error: "Empresa não encontrada para este hash" });
        }

        // multipart: multer already saved it and validateUploadedFileContent
        // verified the magic bytes.
        let finalFileUrl: string | null = req.file ? `/uploads/${req.file.filename}` : null;
        if (arquivoBase64) {
           const match = arquivoBase64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
           if (match) {
              const buffer = Buffer.from(match[2], 'base64');
              if (buffer.length > MAX_UPLOAD_BYTES) {
                return res.status(413).json({ error: "Arquivo excede o limite de 10 MB." });
              }
              if (nomeArquivo && !isAllowedUploadName(nomeArquivo)) {
                return res.status(415).json({ error: "Tipo de arquivo não permitido." });
              }
              if (nomeArquivo && !contentMatchesExtension(buffer, nomeArquivo)) {
                return res.status(415).json({ error: "O conteúdo do arquivo não corresponde à sua extensão." });
              }
              const safeFilename = `${Date.now()}_${sanitizeFilename(nomeArquivo || "documento.pdf")}`;
              const filePath = path.join(UPLOADS_DIR, safeFilename);
              await fs.promises.writeFile(filePath, buffer);
              finalFileUrl = `/uploads/${safeFilename}`;
           }
        }

        // Create document
        const [newDoc] = await db
          .insert(documents)
          .values({
            clientId: targetClient.id,
            title: nomeArquivo,
            category: categoria,
            dueDate: dataVencimento || null,
            status: "new",
            uploadedBy: "accountant",
            fileUrl: finalFileUrl,
          })
          .returning();

        return res.status(201).json({
          success: true,
          message: "Documento salvo com sucesso",
          documentId: newDoc.id,
        });
      } catch (e: any) {
        console.error("Webhook Erro:", e);
        return res
          .status(500)
          .json({ error: "Erro interno no servidor webhook: " + e.message });
      }
    },
  );
}
