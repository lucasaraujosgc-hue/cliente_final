import { Express } from "express";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { clients, documents } from "../schema";
import { upload, UPLOADS_DIR } from "../services/upload";
import { triggerDebouncedDocumentNotification } from "../services/notificationSweeper";

// Routes used by external systems (accounting software, file providers, etc.)
// to push documents into the platform.
export function registerWebhookRoutes(app: Express) {
  // Webhook for receiving files from external systems
  app.post("/api/webhook/receitas", async (req, res) => {
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

      if (!hash_empresa) {
        return res.status(400).json({ error: "hash_empresa is required" });
      }
      if (!arquivo_base64 && categoria !== "SITFIS_RECEITA") {
        return res
          .status(400)
          .json({ error: "arquivo_base64 is required for this category" });
      }

      // Find client
      const clientList = await db
        .select()
        .from(clients)
        .where(eq(clients.integrationHash, hash_empresa));
      if (clientList.length === 0) {
        return res
          .status(404)
          .json({ error: "Client not found using provided hash" });
      }
      const client = clientList[0];

      // Save file
      let safeFilename = "";
      let pixCode = null;
      let extractedValue = null;
      if (arquivo_base64) {
        const buffer = Buffer.from(arquivo_base64, "base64");
        safeFilename = `${Date.now()}_${nome_arquivo || "documento"}`;
        const filePath = path.join(UPLOADS_DIR, safeFilename);
        fs.writeFileSync(filePath, buffer);

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
    upload.single("arquivo"),
    async (req, res) => {
      try {
        let companyHash, categoria, nomeArquivo, dataVencimento;
        let arquivoBase64 = null;

        if (req.file) {
          // multipart/form-data
          companyHash = req.body.companyHash;
          categoria = req.body.categoria || "Outros";
          nomeArquivo = req.body.nomeArquivo || req.file.originalname;
          dataVencimento = req.body.dataVencimento;
          arquivoBase64 =
            "data:" +
            req.file.mimetype +
            ";base64," +
            req.file.buffer.toString("base64");
        } else {
          // JSON
          companyHash = req.body.companyHash;
          categoria = req.body.categoria || "Outros";
          nomeArquivo = req.body.nomeArquivo || "Documento Integrado";
          dataVencimento = req.body.dataVencimento;
          if (req.body.arquivo) {
            arquivoBase64 = String(req.body.arquivo).startsWith("data:")
              ? req.body.arquivo
              : "data:application/pdf;base64," + req.body.arquivo;
          }
        }

        if (!companyHash) {
          return res
            .status(400)
            .json({ error: "O parâmetro companyHash é obrigatório" });
        }

        const clientList = await db
          .select()
          .from(clients)
          .where(eq(clients.integrationHash, companyHash));
        if (clientList.length === 0) {
          return res
            .status(404)
            .json({ error: "Empresa não encontrada para este hash" });
        }

        const targetClient = clientList[0];

        let finalFileUrl = null;
        if (arquivoBase64) {
           const match = arquivoBase64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
           if (match) {
              const buffer = Buffer.from(match[2], 'base64');
              const safeFilename = `${Date.now()}_${nomeArquivo || "documento.pdf"}`;
              const filePath = path.join(UPLOADS_DIR, safeFilename);
              fs.writeFileSync(filePath, buffer);
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
