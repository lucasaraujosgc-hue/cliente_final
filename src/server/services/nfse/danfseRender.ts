import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { formatCnpj } from "../../../lib/cnpj";
import { parseNfseXml, type NfseXmlInfo } from "./nfseXml";
import { parseChaveAcesso } from "./chave";
import { isCpf } from "./inscricao";

// Geração LOCAL do DANFSe a partir do XML da NFS-e.
//
// A NT-008 (v1.02, 14/07/2026) suspendeu a API de geração do DANFSe em
// 03/08/2026 e transferiu a responsabilidade para o software emissor. Este
// gerador cobre o conteúdo obrigatório da NT-008 §2.1 (todas as TAG relevantes
// do XML), a chave de acesso em bloco único de 50 posições, o QR Code para a
// consulta pública, e as marcações de teste/cancelamento/substituição.
//
// PENDENTE (não bloqueia o uso): posicionamento milimétrico e fontes exatas do
// Anexo I (Arial / Microsoft Sans Serif, tamanhos de 6–9 pt, coordenadas X/Y).
// Aqui usamos Helvetica (substituta aceita de Arial) e um layout em blocos.

const A4: [number, number] = [595.28, 841.89];
const M = 24; // margem
const INK = rgb(0.09, 0.1, 0.11);
const MUTED = rgb(0.36, 0.4, 0.45);
const LINE = rgb(0.75, 0.77, 0.8);
const SHADE = rgb(0.93, 0.93, 0.94);
const RED = rgb(0.7, 0.1, 0.1);

const CONSULTA_URL = "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=";

interface Ctx {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
  w: number;
}

function text(c: Ctx, s: string, x: number, size: number, opts: { bold?: boolean; color?: any } = {}) {
  c.page.drawText(s ?? "", {
    x,
    y: c.y,
    size,
    font: opts.bold ? c.bold : c.font,
    color: opts.color ?? INK,
  });
}

function hr(c: Ctx, yy = c.y) {
  c.page.drawLine({ start: { x: M, y: yy }, end: { x: c.w - M, y: yy }, thickness: 0.5, color: LINE });
}

function blockTitle(c: Ctx, label: string) {
  c.y -= 14;
  c.page.drawRectangle({ x: M, y: c.y - 3, width: c.w - 2 * M, height: 13, color: SHADE });
  text(c, label.toUpperCase(), M + 4, 7, { bold: true });
  c.y -= 10;
}

// linha de campos: [label, valor] pares distribuídos na largura
function fields(c: Ctx, pairs: [string, string][], cols = pairs.length) {
  c.y -= 13;
  const colW = (c.w - 2 * M) / cols;
  pairs.forEach(([label, value], i) => {
    const x = M + (i % cols) * colW + 2;
    text(c, label.toUpperCase(), x, 5.5, { bold: true, color: MUTED });
    c.page.drawText(clip(value || "-", c.font, 7, colW - 6), {
      x,
      y: c.y - 9,
      size: 7,
      font: c.font,
      color: INK,
    });
  });
  c.y -= 20;
}

function clip(s: string, font: PDFFont, size: number, maxW: number): string {
  s = String(s ?? "");
  if (font.widthOfTextAtSize(s, size) <= maxW) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s + "…";
}

function wrapText(c: Ctx, s: string, size: number, maxLines = 6) {
  const maxW = c.w - 2 * M - 8;
  const words = String(s ?? "").split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const t = cur ? `${cur} ${word}` : word;
    if (c.font.widthOfTextAtSize(t, size) > maxW && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = t;
    }
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  c.y -= 11;
  for (const ln of lines) {
    text(c, ln, M + 4, size);
    c.y -= size + 2.5;
  }
  c.y -= 2;
}

function money(v: string | null): string {
  const n = Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function docFmt(v: string | null): string {
  const d = String(v ?? "").trim();
  if (!d) return "-";
  if (isCpf(d)) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return formatCnpj(d);
}

function dtFmt(v: string | null): string {
  const d = new Date(String(v ?? ""));
  if (isNaN(d.getTime())) return String(v ?? "-");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const SITUACAO: Record<string, string> = {
  "100": "NFS-e Gerada",
  "102": "NFS-e de Decisão Judicial ou Administrativa",
  "103": "NFS-e Avulsa",
  "107": "NFS-e MEI",
};

export interface DanfseOptions {
  cancelada?: boolean;
  substituida?: boolean;
}

export async function renderDanfsePdf(nfseXml: string, opts: DanfseOptions = {}): Promise<Buffer> {
  const info: NfseXmlInfo = parseNfseXml(nfseXml);
  const chave = info.chaveAcesso || "";
  const parsed = parseChaveAcesso(chave);
  const homolog = info.tpAmb === "2";

  const pdf = await PDFDocument.create();
  const page = pdf.addPage(A4);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const c: Ctx = { page, font, bold, y: A4[1] - M, w: A4[0] };

  page.drawRectangle({
    x: M - 4,
    y: M - 4,
    width: A4[0] - 2 * (M - 4),
    height: A4[1] - 2 * (M - 4),
    borderColor: LINE,
    borderWidth: 1,
  });

  // --- cabeçalho ---
  page.drawRectangle({ x: M, y: c.y - 26, width: c.w - 2 * M, height: 34, color: SHADE });
  text(c, "DANFSe v2.0", M + 6, 11, { bold: true });
  c.y -= 12;
  text(c, "Documento Auxiliar da NFS-e", M + 6, 9, { bold: true });
  if (homolog) {
    c.y -= 11;
    text(c, "NFS-e SEM VALIDADE JURÍDICA", M + 6, 9, { bold: true, color: RED });
  }
  const munText = clip(info.xLocEmi || parsed?.codigoMunicipio || "-", font, 7, 200);
  page.drawText(`Município: ${munText}`, { x: c.w - M - 210, y: A4[1] - M - 6, size: 7, font });
  page.drawText(`Ambiente gerador: ${info.ambienteGerador === "2" ? "Sefin Nacional" : "Município"}`, {
    x: c.w - M - 210,
    y: A4[1] - M - 16,
    size: 6,
    font,
    color: MUTED,
  });
  page.drawText(`Tipo de ambiente: ${homolog ? "Homologação" : "Produção"}`, {
    x: c.w - M - 210,
    y: A4[1] - M - 25,
    size: 6,
    font,
    color: MUTED,
  });
  c.y -= 18;

  // --- QR Code ---
  try {
    const qrPng = await QRCode.toBuffer(CONSULTA_URL + chave, { type: "png", margin: 1, width: 220 });
    const qr = await pdf.embedPng(qrPng);
    page.drawImage(qr, { x: c.w - M - 70, y: c.y - 62, width: 62, height: 62 });
    page.drawText("Autenticidade: leia o QR Code ou consulte a chave", {
      x: c.w - M - 210,
      y: c.y - 72,
      size: 5.5,
      font,
      color: MUTED,
    });
    page.drawText("no portal nacional da NFS-e (www.nfse.gov.br).", {
      x: c.w - M - 210,
      y: c.y - 79,
      size: 5.5,
      font,
      color: MUTED,
    });
  } catch {
    /* QR opcional em caso de erro de geração */
  }

  // --- identificação ---
  text(c, "CHAVE DE ACESSO DA NFS-e", M, 5.5, { bold: true, color: MUTED });
  c.y -= 11;
  text(c, chave || "-", M, 10, { bold: true });
  c.y -= 4;
  fields(
    c,
    [
      ["Número da NFS-e", info.numeroNota || "-"],
      ["Competência", info.competencia || "-"],
      ["Emissão da NFS-e", dtFmt(info.dhProc)],
    ],
    3,
  );
  fields(
    c,
    [
      ["Número da DPS", info.numeroDps || "-"],
      ["Série da DPS", info.serieDps || "-"],
      ["Emissão da DPS", dtFmt(info.dhEmiDps)],
    ],
    3,
  );
  fields(
    c,
    [
      ["Emitente da NFS-e", "Prestador"],
      ["Situação", SITUACAO[info.cStat || ""] || info.cStat || "-"],
      ["Finalidade", "NFS-e regular"],
    ],
    3,
  );
  hr(c);

  // --- prestador ---
  blockTitle(c, "Prestador / Fornecedor");
  fields(c, [
    ["CNPJ / CPF", docFmt(info.prestadorDoc)],
    ["Nome / Nome Empresarial", info.prestadorNome || "-"],
  ], 2);

  // --- tomador ---
  blockTitle(c, "Tomador / Adquirente");
  if (info.tomadorDoc || info.tomadorNome) {
    fields(c, [
      ["CNPJ / CPF", docFmt(info.tomadorDoc)],
      ["Nome / Nome Empresarial", info.tomadorNome || "-"],
    ], 2);
  } else {
    c.y -= 12;
    text(c, "TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e", M + 4, 7);
    c.y -= 8;
  }

  // --- serviço ---
  blockTitle(c, "Serviço Prestado");
  fields(c, [
    ["Cód. Tributação Nacional", info.xTribNac || "-"],
    ["Local da Prestação", info.xLocPrestacao || info.xLocEmi || "-"],
  ], 2);
  text(c, "DESCRIÇÃO DO SERVIÇO", M + 4, 5.5, { bold: true, color: MUTED });
  wrapText(c, info.descServico || "-", 7, 6);

  // --- tributação municipal ---
  blockTitle(c, "Tributação Municipal (ISSQN)");
  fields(
    c,
    [
      ["Tipo de Tributação", "Operação Tributável"],
      ["Alíquota Aplicada (%)", info.aliquota || "-"],
      ["ISSQN Apurado (R$)", money(info.valorIssqn)],
    ],
    3,
  );

  // --- tributação federal ---
  blockTitle(c, "Tributação Federal (exceto CBS)");
  fields(
    c,
    [
      ["Total de Retenções (R$)", money(info.valorTotalRet)],
      ["Desconto Incondicionado (R$)", money(info.valorDescIncond)],
    ],
    2,
  );

  // --- valor total ---
  blockTitle(c, "Valor Total da NFS-e");
  fields(
    c,
    [
      ["Valor do Serviço (R$)", money(info.valorServico)],
      ["Valor Líquido da NFS-e (R$)", money(info.valorLiquido)],
    ],
    2,
  );

  // --- rodapé ---
  c.y = M + 28;
  hr(c, c.y + 8);
  text(
    c,
    "Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: conforme apuração do Simples Nacional / regime do prestador.",
    M,
    5.5,
    { color: MUTED },
  );
  c.y -= 8;
  text(c, "DANFSe gerado pelo emissor — representa o conteúdo do XML da NFS-e. Documento legal: XML assinado.", M, 5.5, {
    color: MUTED,
  });

  // --- marca d'água ---
  const wm = opts.cancelada ? "CANCELADA" : opts.substituida ? "SUBSTITUÍDA" : "";
  if (wm) {
    page.drawText(wm, {
      x: 90,
      y: 380,
      size: 70,
      font: bold,
      color: rgb(0.62, 0.62, 0.62),
      rotate: { type: "degrees", angle: 32 } as any,
      opacity: 0.35,
    });
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
