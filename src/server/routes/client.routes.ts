import { Express } from "express";
import fs from "fs";
import path from "path";
import https from "https";
import { eq, desc, asc } from "drizzle-orm";
import { db } from "../db";
import {
  clients,
  documents,
  billingData,
  messages,
  serproConfig,
  guiasGeradas,
} from "../schema";
import { transporter } from "../services/mailer";
import { upload } from "../services/upload";
import { getSerproToken, serproPost, isUuid } from "../services/serpro";
import { hashPassword } from "../services/password";
import { verifyClientAuth, verifyAnyAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { billingUpdateSchema, billingBulkSchema } from "../schemas/validation";

// Routes used by the client-facing portal: dashboard, profile, billing,
// document acknowledgement, messages, and SERPRO "guia" (tax slip) generation.
export function registerClientRoutes(app: Express) {
  app.get("/api/client/dashboard", verifyClientAuth, async (req, res) => {
    const clientId = (req as any).user.clientId;
    const clientList = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId));
    if (clientList.length === 0)
      return res.status(404).json({ error: "Client not found" });

    const client = clientList[0];
    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.clientId, clientId));
    const billing = await db
      .select()
      .from(billingData)
      .where(eq(billingData.clientId, clientId))
      .orderBy(asc(billingData.month));
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.clientId, clientId))
      .orderBy(desc(messages.createdAt));

    const serproConf = await db.select().from(serproConfig).limit(1);
    const whatsappSupport = serproConf[0]?.whatsappSupport || "";

    res.json({
      client,
      whatsappSupport,
      documents: docs.map((d) => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
      })),
      billing,
      messages: msgs.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  });

  app.post("/api/client/setup-profile", verifyClientAuth, async (req, res) => {
    const clientId = (req as any).user.clientId;
    const { email, password } = req.body;

    const clientList = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId));
    if (clientList.length === 0)
      return res.status(404).json({ error: "Client not found" });

    const updateData: any = {
      email,
      firstAccessDone: true,
    };
    if (password) {
      updateData.passwordHash = await hashPassword(password);
    }

    const [client] = await db
      .update(clients)
      .set(updateData)
      .where(eq(clients.id, clientId))
      .returning();

    // Send Welcome Email
    if (process.env.EMAIL_USER && process.env.EMAIL_PASSWORD && email) {
      try {
        const fromName = process.env.EMAIL_FROM_NAME || "Vírgula Contábil";
        const alias = process.env.EMAIL_ALIAS || process.env.EMAIL_USER;

        await transporter.sendMail({
          from: `"${fromName}" <${alias}>`,
          to: email,
          subject:
            "Bem-vindo(a) à Vírgula Contábil - Primeiro Acesso Confirmado",
          html: `
             <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
               <div style="background-color: #1f2937; padding: 20px; border-radius: 12px; text-align: center; margin-bottom: 20px;">
                  <h1 style="color: #fff; margin: 0;">Vírgula <span style="color: #10b981;">Contábil</span></h1>
               </div>
               <h2>Olá, ${client.name}!</h2>
               <p>Seu primeiro acesso ao nosso portal foi realizado com sucesso.</p>
               <p>Seu login é: <strong>${client.cnpj}</strong></p>
               <p>Agora você pode acompanhar as guias, envios de documentos e mural de recados pelo nosso sistema centralizado.</p>
               <p>Atenciosamente,<br>Equipe Vírgula Contábil</p>
             </div>
           `,
        });
      } catch (err) {
        console.error("Error sending welcome email:", err);
      }
    }

    res.json({ success: true, client });
  });

  app.post("/api/client/update-billing", verifyClientAuth, validateBody(billingUpdateSchema), async (req, res) => {
    const clientId = (req as any).user.clientId;
    const {
      month,
      servicesRevenue,
      salesRevenue,
      totalIncomes,
      servicesTaken,
    } = req.body;

    try {
      const existing = await db
        .select()
        .from(billingData)
        .where(eq(billingData.clientId, clientId));
      const target = existing.find((b) => b.month === month);

      const updatePayload = {
        servicesRevenue: servicesRevenue || 0,
        salesRevenue: salesRevenue || 0,
        totalIncomes: totalIncomes || 0,
        servicesTaken: servicesTaken || 0,
        // Legacy fallback
        revenue: (servicesRevenue || 0) + (salesRevenue || 0),
        expenses: servicesTaken || 0,
        payroll: 0,
      };

      if (target) {
        await db
          .update(billingData)
          .set(updatePayload)
          .where(eq(billingData.id, target.id));
      } else {
        await db.insert(billingData).values({
          ...updatePayload,
          clientId,
          month,
        });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/client/bulk-billing", verifyClientAuth, validateBody(billingBulkSchema), async (req, res) => {
    const clientId = (req as any).user.clientId;
    const { data } = req.body; // Array of items

    try {
      for (const item of data) {
        const {
          month,
          servicesRevenue,
          salesRevenue,
          totalIncomes,
          servicesTaken,
        } = item;
        const existing = await db
          .select()
          .from(billingData)
          .where(eq(billingData.clientId, clientId));
        const target = existing.find((b) => b.month === month);

        const updatePayload = {
          servicesRevenue: servicesRevenue || 0,
          salesRevenue: salesRevenue || 0,
          totalIncomes: totalIncomes || 0,
          servicesTaken: servicesTaken || 0,
          // Legacy fallback
          revenue: (servicesRevenue || 0) + (salesRevenue || 0),
          expenses: servicesTaken || 0,
          payroll: 0,
        };

        if (target) {
          await db
            .update(billingData)
            .set(updatePayload)
            .where(eq(billingData.id, target.id));
        } else {
          await db.insert(billingData).values({
            ...updatePayload,
            clientId,
            month,
          });
        }
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Upload file by client
  // Gerar Guia (DCTFWEB / PGDASD) SERPRO
  app.post(
    "/api/pendencies/guia/:clienteId",
    verifyAnyAuth,
    async (req, res) => {
      try {
        const clientId = req.params.clienteId;
        
        // 1. Validação de UUID
        if (!isUuid(clientId)) {
          return res.status(400).json({ error: "ID do cliente no formato inválido." });
        }

        const tokenClientId = (req as any).user?.clientId || (req as any).user?.id;
        const tokenRole = (req as any).user?.role;
        if (tokenRole === "client" && tokenClientId !== clientId) {
          return res.status(403).json({ error: "Acesso negado." });
        }

        const { tipoGuia, competencia, documentId } = req.body;

        if (!tipoGuia || !competencia) {
          return res
            .status(400)
            .json({ error: "tipoGuia e competencia são obrigatórios." });
        }

        // Integra Contador só é acionado para guias de INSS (DCTFWEB_INSS)
        // e Simples Nacional (DAS_SIMPLES). Outras categorias não são suportadas.
        const CATEGORIAS_INTEGRA_CONTADOR = ["DCTFWEB_INSS", "DAS_SIMPLES"] as const;
        if (!CATEGORIAS_INTEGRA_CONTADOR.includes(tipoGuia as any)) {
          return res.status(400).json({
            error: `Integra Contador não suporta a categoria "${tipoGuia}". Apenas INSS (DCTFWEB_INSS) e Simples Nacional (DAS_SIMPLES) são permitidos.`,
          });
        }

        if (!/^\d{6}$/.test(competencia)) {
          return res
            .status(400)
            .json({ error: "competencia deve ter formato AAAAMM." });
        }

        console.log("Processando requisição Integra Contador:", {
          tipoGuia,
          competencia,
          documentId,
          clientId,
        });

        const clientList = await db
          .select()
          .from(clients)
          .where(eq(clients.id, clientId));
        if (clientList.length === 0) {
          return res.status(404).json({ error: "Cliente não encontrado." });
        }

        const serproList = await db.select().from(serproConfig).limit(1);
        if (serproList.length === 0 || !serproList[0].consumerKey) {
           return res.status(400).json({ error: "Integra Contador não configurado. Acesse as configurações." });
        }
        const config = serproList[0];
        const cnpjContrato = config.cnpjContratante
            ? config.cnpjContratante.replace(/\D/g, "")
            : "00000000000100";

        const client = clientList[0];
        const anoPA = competencia.substring(0, 4);
        const mesPA = competencia.substring(4, 6);

        let payload;
        if (tipoGuia === "DCTFWEB_INSS") {
          payload = {
            contratante: { numero: cnpjContrato, tipo: 2 },
            autorPedidoDados: { numero: cnpjContrato, tipo: 2 },
            contribuinte: { numero: client.cnpj.replace(/\D/g, ""), tipo: 2 },
            pedidoDados: {
              idSistema: "DCTFWEB",
              idServico: "GERARGUIA31",
              versaoSistema: "1.0",
              dados: JSON.stringify({
                categoria: "GERAL_MENSAL",
                anoPA,
                mesPA,
              }),
            },
          };
        } else {
          payload = {
            contratante: { numero: cnpjContrato, tipo: 2 },
            autorPedidoDados: { numero: cnpjContrato, tipo: 2 },
            contribuinte: { numero: client.cnpj.replace(/\D/g, ""), tipo: 2 },
            pedidoDados: {
              idSistema: "PGDASD",
              idServico: "GERARDAS12",
              versaoSistema: "1.0",
              dados: JSON.stringify({ periodoApuracao: competencia }),
            },
          };
        }

        console.log(`[SERPRO API] Enviando POST /Emitir para tipo ${tipoGuia}`);
        
        let certAgent;
        if (config.ambiente === "producao") {
          if (!config.certPath) {
            return res.status(400).json({
              error: "Certificado digital nao configurado. Reenvie o arquivo .pfx/.p12 nas configuracoes do Integra Contador.",
            });
          }

          try {
            const pfx = await fs.promises.readFile(config.certPath);
            certAgent = new https.Agent({
              pfx,
              passphrase: config.certSenha || "",
              rejectUnauthorized: true,
            });
          } catch (err: any) {
            console.error("Certificado SERPRO configurado nao pode ser lido:", {
              path: config.certPath,
              code: err?.code,
              message: err?.message,
            });
            return res.status(400).json({
              error: "Certificado digital nao encontrado no servidor. Reenvie o arquivo .pfx/.p12 nas configuracoes do Integra Contador.",
            });
          }
        }

        let pdfBase64;
        let vencFormatado;
        let valorTotal;
        try {
          const tokens = await getSerproToken(config, certAgent);
          const baseUrl = config.ambiente === "producao"
            ? "https://gateway.apiserpro.serpro.gov.br/integra-contador/v1"
            : "https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1";

          const apiResp = await serproPost(`${baseUrl}/Emitir`, tokens, payload, certAgent);
          if (!apiResp.ok) {
            const errBody = await apiResp.text();
            throw new Error(`SERPRO retornou ${apiResp.status}: ${errBody}`);
          }

          const text = await apiResp.text();
          const root = JSON.parse(text);

          // "dados" vem como string JSON escapada — faz parse duplo se necessário
          let dados = root.dados;
          if (typeof dados === "string") {
            try { dados = JSON.parse(dados); } catch (_) {}
          }

          if (tipoGuia === "DAS_SIMPLES") {
            // Resposta: array de objetos Das
            // { pdf, cnpjCompleto, detalhamentoDas: { dataVencimento, valores: { total } } }
            const das = Array.isArray(dados) ? dados[0] : dados;
            if (!das) throw new Error("SERPRO DAS: resposta sem dados.");
            pdfBase64 = das.pdf;
            const det = das.detalhamentoDas ?? das.detalhamento ?? {};
            // Data de vencimento da API é da guia original — ignora e usa data de emissão
            vencFormatado = null;
            valorTotal    = det.valores?.total ?? null;
          } else {
            // Resposta: { PDFByteArrayBase64: "..." }
            const dctf = typeof dados === "object" && dados !== null ? dados : {};
            pdfBase64  = dctf.PDFByteArrayBase64;
            if (!pdfBase64) throw new Error("SERPRO DCTFWEB: PDFByteArrayBase64 ausente na resposta.");
            // DCTFWEB não retorna vencimento/valor na resposta — mantém null para extrair do PDF
            vencFormatado = null;
            valorTotal    = null;
          }

          // Vencimento: usa a data de emissão (hoje), avança para próximo dia útil se cair em fds
          if (!vencFormatado) {
            const hoje = new Date();
            const dia = hoje.getDay(); // 0=dom, 6=sab
            const offset = dia === 6 ? 2 : dia === 0 ? 1 : 0;
            if (offset > 0) hoje.setDate(hoje.getDate() + offset);
            const yy = hoje.getFullYear();
            const mm = String(hoje.getMonth() + 1).padStart(2, "0");
            const dd = String(hoje.getDate()).padStart(2, "0");
            vencFormatado = `${yy}-${mm}-${dd}`;
            console.log(`[SERPRO API] Vencimento não retornado pela API, usando data de emissão: ${vencFormatado}`);
          }
          console.log(`[SERPRO API] Dados recebidos — vencimento: ${vencFormatado}, valor: ${valorTotal}`);
        } catch (e: any) {
          console.error("Erro ao comunicar com Integra Contador SERPRO:", e.message);
          throw e; // propaga — sem fallback mock para não enganar o usuário com dados falsos
        }

        if (!pdfBase64) {
          throw new Error("SERPRO não retornou PDF na resposta.");
        }

        const pdfBuffer = Buffer.from(pdfBase64, "base64");
        let pixCode: string | null = null;
        try {
          const { extractPixCodeFromPdf } = await import("../qrExtractor");
          pixCode = await extractPixCodeFromPdf(pdfBuffer);
        } catch (err) {
          console.warn("Nao foi possivel extrair o PIX do PDF da guia:", err);
        }

        if (!pixCode) {
          console.warn("[SERPRO API] Guia gerada sem PIX copia e cola extraido do PDF.");
        }

        let guiaId: number;
        let realFileUrl: string;

        // Executa escritas em transação Drizzle
        await db.transaction(async (tx) => {
          const insertedGuia = await tx
            .insert(guiasGeradas)
            .values({
              clientId: clientId,
              usuarioId: 1,
              tipoGuia: tipoGuia,
              competencia: competencia,
              status: "CONCLUIDO",
              dataVencimento: vencFormatado,
              valorTotal: valorTotal,
              pdfPath: "", // Atualizado abaixo
              createdAt: new Date(),
              concluidoAt: new Date(),
            })
            .returning();
            
          guiaId = insertedGuia[0].id;
          realFileUrl = `/api/pendencies/guia/${guiaId}/pdf`;

          // Salva PDF em disco de forma assíncrona
          const pdfDir = process.env.DATA_PATH 
            ? path.join(process.env.DATA_PATH, "guias_pdfs") 
            : path.join(process.cwd(), "data", "guias_pdfs");
          await fs.promises.mkdir(pdfDir, { recursive: true });
          
          const pdfFile = `guia_${tipoGuia}_${clientId}_${competencia}_${guiaId}.pdf`;
          const pdfPath = path.join(pdfDir, pdfFile);
          await fs.promises.writeFile(pdfPath, pdfBuffer);
          
          await tx
            .update(guiasGeradas)
            .set({ pdfPath: pdfPath })
            .where(eq(guiasGeradas.id, guiaId));

          // Atualiza o documento original associado
          if (documentId && isUuid(documentId)) {
            await tx
              .update(documents)
              .set({
                dueDate: vencFormatado,
                fileUrl: realFileUrl,
                pixCode,
                status: "GUIA_ATUALIZADA",
              })
              .where(eq(documents.id, documentId));
          }
        });

        console.log(
          `[SERPRO API] Resposta processada com sucesso. Retornando guia.`
        );

        res.json({
          status: "CONCLUIDO",
          guiaId: guiaId!,
          dataVencimento: vencFormatado,
          valorTotal: valorTotal,
          pdfPath: realFileUrl!,
          pixCode,
        });
      } catch (e: any) {
        console.error("Erro no Integra Contador:", e);
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.get("/api/pendencies/guia/:guiaId/pdf", verifyAnyAuth, async (req, res) => {
    try {
      const guiaId = parseInt(req.params.guiaId);
      if (isNaN(guiaId)) {
        return res.status(400).send("ID da guia inválido.");
      }
      
      const guia = await db
        .select()
        .from(guiasGeradas)
        .where(eq(guiasGeradas.id, guiaId));
      if (guia.length === 0 || !guia[0].pdfPath) {
        return res.status(404).send("PDF não encontrado.");
      }

      // Segurança contra IDOR/BOLA: Se for cliente, valida se a guia é dele
      const tokenClientId = (req as any).user?.clientId;
      const tokenRole = (req as any).user?.role;
      if (tokenRole === "client" && guia[0].clientId !== tokenClientId) {
        return res.status(403).send("Acesso negado. Esta guia pertence a outro cliente.");
      }

      const pdfData = guia[0].pdfPath;
      if (pdfData.startsWith("data:application/pdf;base64,")) {
        const base64Data = pdfData.replace("data:application/pdf;base64,", "");
        const buffer = Buffer.from(base64Data, "base64");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `inline; filename=guia_${guiaId}.pdf`,
        );
        return res.send(buffer);
      }
      
      // Valida assincronamente a existência do arquivo no disco
      try {
        await fs.promises.access(pdfData);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `inline; filename=${path.basename(pdfData)}`,
        );
        const stream = fs.createReadStream(pdfData);
        stream.pipe(res);
      } catch {
        // Redireciona apenas se for uma URL HTTP válida
        if (pdfData.startsWith("http://") || pdfData.startsWith("https://")) {
          res.redirect(pdfData);
        } else {
          res.status(404).send("PDF não encontrado no disco.");
        }
      }
    } catch (e: any) {
      console.error(e);
      res.status(500).send("Erro ao baixar PDF");
    }
  });

  app.get(
    "/api/pendencies/guia/:clienteId/historico",
    verifyAnyAuth,
    async (req, res) => {
      try {
        const clientId = req.params.clienteId;

        const tokenClientId = (req as any).user?.clientId || (req as any).user?.id;
        const tokenRole = (req as any).user?.role;
        if (tokenRole === "client" && tokenClientId !== clientId) {
          return res.status(403).json({ error: "Acesso negado." });
        }

        const historico = await db
          .select()
          .from(guiasGeradas)
          .where(eq(guiasGeradas.clientId, clientId))
          .orderBy(desc(guiasGeradas.id))
          .limit(20);
        res.json({ success: true, historico });
      } catch (e: any) {
        console.error(e);
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.post(
    "/api/client/upload",
    verifyClientAuth,
    upload.single("file"),
    async (req, res) => {
      const clientId = (req as any).user.clientId;
      const { title, category, competence } = req.body;

      const [newDoc] = await db
        .insert(documents)
        .values({
          clientId,
          title: title || `Documento ${category}`,
          category,
          competence,
          fileUrl: req.file ? `/uploads/${req.file.filename}` : null,
          status: "new",
          uploadedBy: "client",
        })
        .returning();

      res.json({
        success: true,
        document: { ...newDoc, createdAt: newDoc.createdAt.toISOString() },
      });
    },
  );

  app.post("/api/client/mark-doc/:id", verifyClientAuth, async (req, res) => {
    const clientId = (req as any).user.clientId;
    const docId = req.params.id;
    const { status } = req.body;

    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.id, docId));
    if (docs.length > 0 && docs[0].clientId === clientId) {
      await db.update(documents).set({ status }).where(eq(documents.id, docId));
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Doc not found" });
    }
  });

  app.post("/api/client/message", verifyClientAuth, async (req, res) => {
    try {
      const clientId = (req as any).user.clientId;
      const { content } = req.body;

      const [newMsg] = await db
        .insert(messages)
        .values({
          clientId,
          content,
          direction: "client_to_accountant",
          read: false,
        })
        .returning();

      res.json({
        success: true,
        message: { ...newMsg, createdAt: newMsg.createdAt.toISOString() },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/client/preferences", verifyClientAuth, async (req, res) => {
    try {
      const clientId = (req as any).user.clientId;
      const { notificationPreferences } = req.body;

      await db.update(clients)
        .set({ notificationPreferences })
        .where(eq(clients.id, clientId));

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

}
