import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { documents, guiasGeradas, paymentChecks } from "../../schema";
import { loadDocumentPdfBuffer } from "../files";
import { triggerDebouncedDocumentNotification } from "../notificationSweeper";
import { competenciaDeAAAAMM, parseData } from "./regras";

// Guias do cliente vistas pelo contador no painel fiscal — a mesma lista que o
// cliente vê no app (vencidas, a vencer, pagas) — e a publicação de uma guia
// gerada no Integra Contador para o app do cliente.

export type TipoGuia = "DAS_SIMPLES" | "DCTFWEB_INSS";

/** Mesmo critério das telas do cliente (Atrasados / Vencimentos) para o recálculo. */
export function tipoGuiaDoDocumento(d: { category?: string | null; title?: string | null }): TipoGuia | null {
  const cat = String(d.category || "").toUpperCase();
  const tit = String(d.title || "").toUpperCase();
  // Parcela de parcelamento não se recalcula pela DCTFWeb/PGDAS-D.
  if (cat.includes("PARCEL") || tit.includes("PARCEL")) return null;
  if (cat === "DCTFWEB" || cat.includes("INSS") || tit.includes("DCTFWEB") || tit.includes("INSS")) return "DCTFWEB_INSS";
  if (cat.includes("SIMPLES") || tit.includes("SIMPLES")) return "DAS_SIMPLES";
  return null;
}

const guiaIdDaUrl = (u: string | null) => u?.match(/^\/api\/pendencies\/guia\/(\d+)\/pdf$/)?.[1] ?? null;
const pago = (status: string) => status === "paid" || status === "ok";

/** Guias do cliente com vencimento: em aberto (qualquer data) + pagas dos últimos 6 meses. */
export async function guiasDoCliente(clientId: string, hoje = new Date()) {
  const docs = await db.select().from(documents).where(eq(documents.clientId, clientId));
  const guias = await db.select().from(guiasGeradas).where(eq(guiasGeradas.clientId, clientId));
  const guiaPorId = new Map(guias.map((g) => [String(g.id), g]));
  const checks = await db.select().from(paymentChecks).where(eq(paymentChecks.clientId, clientId));
  const checkPorDoc = new Map(checks.map((c) => [c.documentId, c]));
  const seisMeses = new Date(hoje.getFullYear(), hoje.getMonth() - 6, hoje.getDate());

  return docs
    .map((d) => {
      // Igual ao /api/client/dashboard: valor e vencimento caem para a guia gerada.
      const g = guiaPorId.get(guiaIdDaUrl(d.fileUrl) ?? "");
      const ed = d.extractedData && typeof d.extractedData === "object" && !Array.isArray(d.extractedData) ? (d.extractedData as Record<string, unknown>) : {};
      const valor = typeof ed.extractedValue === "number" && ed.extractedValue ? ed.extractedValue : (g?.valorTotal ?? null);
      return {
        id: d.id,
        title: d.title,
        category: d.category,
        competence: d.competence,
        dueDate: d.dueDate || g?.dataVencimento || null,
        status: d.status,
        valor,
        pixCode: d.pixCode,
        temArquivo: !!d.fileUrl,
        tipoGuia: tipoGuiaDoDocumento(d),
        paymentStatus: checkPorDoc.get(d.id)?.status ?? null,
        createdAt: d.createdAt,
      };
    })
    .filter((d) => {
      const venc = parseData(d.dueDate);
      if (!venc) return false;
      return !pago(d.status) || venc >= seisMeses;
    })
    .sort((a, b) => (parseData(a.dueDate)?.getTime() ?? 0) - (parseData(b.dueDate)?.getTime() ?? 0))
    .slice(-80);
}

/**
 * Coloca no app do cliente a guia gerada (guias_geradas.id): substitui a guia
 * em aberto da mesma competência e tipo — ou a indicada em `documentId` — ou
 * cria um documento novo. O aviso ao cliente segue as regras de "arquivo
 * disponível" (Notificações), como nos outros envios do contador.
 */
export async function publicarGuia(clientId: string, guiaId: number, documentId?: string | null) {
  const [guia] = await db
    .select()
    .from(guiasGeradas)
    .where(and(eq(guiasGeradas.id, guiaId), eq(guiasGeradas.clientId, clientId)));
  if (!guia || !guia.pdfPath) throw Object.assign(new Error("Guia não encontrada."), { status: 404 });
  const tipo = guia.tipoGuia as TipoGuia;
  if (tipo !== "DAS_SIMPLES" && tipo !== "DCTFWEB_INSS") throw Object.assign(new Error("Tipo de guia não suportado."), { status: 400 });

  const competencia = competenciaDeAAAAMM(guia.competencia) ?? guia.competencia;
  const fileUrl = `/api/pendencies/guia/${guia.id}/pdf`;

  let pixCode: string | null = null;
  try {
    const buffer = await loadDocumentPdfBuffer(fileUrl);
    if (buffer) {
      const { extractPixCodeFromPdf } = await import("../../qrExtractor");
      pixCode = await extractPixCodeFromPdf(buffer);
    }
  } catch {
    /* sem PIX: o cliente ainda baixa o PDF */
  }

  let alvo: typeof documents.$inferSelect | undefined;
  if (documentId) {
    [alvo] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.clientId, clientId)));
    if (!alvo) throw Object.assign(new Error("Documento não encontrado para este cliente."), { status: 404 });
  } else {
    const candidatos = await db
      .select()
      .from(documents)
      .where(and(eq(documents.clientId, clientId), eq(documents.competence, competencia)))
      .orderBy(desc(documents.createdAt));
    alvo = candidatos.find((d) => !pago(d.status) && tipoGuiaDoDocumento(d) === tipo);
  }

  const dados = { extractedValue: guia.valorTotal ?? undefined, numeroDocumento: guia.numeroDocumento ?? undefined, guiaId: guia.id };
  let doc: typeof documents.$inferSelect;
  if (alvo) {
    const ed = alvo.extractedData && typeof alvo.extractedData === "object" && !Array.isArray(alvo.extractedData) ? alvo.extractedData : { original: alvo.extractedData ?? null };
    [doc] = await db
      .update(documents)
      .set({ dueDate: guia.dataVencimento, fileUrl, pixCode, status: "GUIA_ATUALIZADA", extractedData: { ...(ed as object), ...dados } })
      .where(eq(documents.id, alvo.id))
      .returning();
  } else {
    [doc] = await db
      .insert(documents)
      .values({
        clientId,
        title: tipo === "DAS_SIMPLES" ? `DAS Simples Nacional ${competencia}` : `INSS (DCTFWeb) ${competencia}`,
        category: tipo === "DAS_SIMPLES" ? "Simples Nacional" : "INSS",
        competence: competencia,
        dueDate: guia.dataVencimento,
        fileUrl,
        pixCode,
        status: "new",
        uploadedBy: "accountant",
        extractedData: dados,
      })
      .returning();
  }
  triggerDebouncedDocumentNotification(doc);
  return { documentId: doc.id, substituiu: !!alvo, title: doc.title, competencia, dueDate: doc.dueDate, valor: guia.valorTotal, pixCode };
}
