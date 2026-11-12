import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import QRCode from "qrcode";
import { formatCnpj } from "../../../lib/cnpj";
import { lerNfseDanfse, type EnderecoDanfse, type NfseDanfse } from "./nfseXml";
import { isCpf } from "./inscricao";

// Geração LOCAL do DANFSe a partir do XML da NFS-e.
//
// A NT-008 (v1.02, 14/07/2026) suspendeu a API de geração do DANFSe em
// 03/08/2026 e transferiu a responsabilidade para o software emissor. Layout em
// grade de 4 colunas (o mesmo do emissor do sistema INTER, aprovado pelo
// escritório): cabeçalho com a chave em blocos e o QR Code da consulta pública;
// identificação; prestador; tomador; serviço (código nacional/municipal, NBS,
// obra/evento, descrição); ISSQN; valores; informações complementares. Marca
// d'água para cancelada, substituída e homologação (sem valor fiscal).
//
// Helvetica (substituta aceita de Arial) e Courier para a chave.

const A4: [number, number] = [595.28, 841.89];
const M = 23; // ~8 mm
const W = A4[0] - 2 * M; // largura útil
const INK = rgb(0.07, 0.07, 0.07);
const LABEL = rgb(0.33, 0.33, 0.33);
const BORDA = rgb(0, 0, 0);
const DIVISAO = rgb(0.73, 0.73, 0.73);
const LINHA = rgb(0.87, 0.87, 0.87);
const FAIXA = rgb(0.914, 0.914, 0.914);

const CONSULTA_URL = "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=";

// Helvetica/Courier padrão só codificam WinAnsi: o resto vira "?" em vez de
// derrubar a geração.
const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function seguro(s: unknown): string {
  return Array.from(String(s ?? ""))
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.includes(ch)) return ch;
      if (ch === "\n" || ch === "\t") return " ";
      return "?";
    })
    .join("");
}

interface Ctx {
  pdf: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  y: number; // topo da próxima faixa
}

function clip(s: string, font: PDFFont, size: number, maxW: number): string {
  s = seguro(s);
  if (font.widthOfTextAtSize(s, size) <= maxW) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
  return s + "…";
}

function quebrar(s: string, font: PDFFont, size: number, maxW: number, maxLinhas: number): string[] {
  const linhas: string[] = [];
  for (const par of seguro(s).split(/\r?\n/)) {
    let cur = "";
    for (const palavra of par.split(/\s+/).filter(Boolean)) {
      const t = cur ? `${cur} ${palavra}` : palavra;
      if (font.widthOfTextAtSize(t, size) > maxW && cur) {
        linhas.push(cur);
        cur = palavra;
      } else {
        cur = t;
      }
    }
    linhas.push(cur);
  }
  if (linhas.length > maxLinhas) {
    const corte = linhas.slice(0, maxLinhas);
    corte[maxLinhas - 1] = clip(corte[maxLinhas - 1] + " …", font, size, maxW);
    return corte;
  }
  return linhas;
}

function linhaH(c: Ctx, y: number, cor: RGB = BORDA, esp = 0.8) {
  c.page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: esp, color: cor });
}

// Faixa cinza com o título da seção, entre linhas pretas.
function secao(c: Ctx, titulo: string) {
  const h = 12;
  c.page.drawRectangle({ x: M, y: c.y - h, width: W, height: h, color: FAIXA });
  linhaH(c, c.y);
  linhaH(c, c.y - h);
  c.page.drawText(seguro(titulo.toUpperCase()), { x: M + 5, y: c.y - 8.6, size: 6.8, font: c.bold, color: INK });
  c.y -= h;
}

type Celula = [rotulo: string, valor: string | null | undefined, span?: number];

// Linha da grade de 4 colunas: rótulo pequeno em cima, valor em negrito.
function linha(c: Ctx, celulas: Celula[], opts: { tamanho?: number } = {}) {
  const h = opts.tamanho ? 24 : 22;
  const col = W / 4;
  let x = M;
  celulas.forEach(([rotulo, valor, span = 1], i) => {
    const largura = col * span;
    if (rotulo) {
      c.page.drawText(clip(rotulo.toUpperCase(), c.font, 5.6, largura - 8), { x: x + 4, y: c.y - 7.5, size: 5.6, font: c.font, color: LABEL });
    }
    const v = String(valor ?? "").trim();
    if (v) {
      c.page.drawText(clip(v, c.bold, opts.tamanho ?? 7.6, largura - 8), {
        x: x + 4,
        y: c.y - 7.5 - (opts.tamanho ?? 7.6) - 2.6,
        size: opts.tamanho ?? 7.6,
        font: c.bold,
        color: INK,
      });
    }
    x += largura;
    if (i < celulas.length - 1) {
      c.page.drawLine({ start: { x, y: c.y }, end: { x, y: c.y - h }, thickness: 0.5, color: DIVISAO });
    }
  });
  linhaH(c, c.y - h, LINHA, 0.5);
  c.y -= h;
}

// Bloco de texto livre (descrição, informações complementares).
function texto(c: Ctx, s: string, opts: { minAltura?: number; maxLinhas?: number } = {}) {
  const size = 7.6;
  const linhas = quebrar(s || "-", c.font, size, W - 12, opts.maxLinhas ?? 24);
  const h = Math.max(opts.minAltura ?? 0, linhas.length * (size + 2.4) + 10);
  linhas.forEach((ln, i) => {
    c.page.drawText(ln, { x: M + 6, y: c.y - 10 - i * (size + 2.4), size, font: c.font, color: INK });
  });
  c.y -= h;
}

// --- formatação -----------------------------------------------------------------

function docFmt(v: string | null): string {
  const d = String(v ?? "").trim();
  if (!d) return "";
  if (d.length === 11 && isCpf(d)) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d.length === 14 ? formatCnpj(d) : d;
}

function moeda(v: string | number | null | undefined): string {
  const n = Number(String(v ?? "0").replace(",", "."));
  return (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// "2026-11-12T11:13:52-03:00" → "12/11/2026 11:13:52" (horário de quem gerou o XML).
function dataHora(s: string | null): string {
  if (!s) return "";
  const [d, t] = s.split("T");
  const [y, m, dia] = d.split("-");
  if (!dia) return s;
  return `${dia}/${m}/${y}${t ? " " + t.slice(0, 8) : ""}`;
}

const cepFmt = (c: string | null) => {
  const x = String(c ?? "").replace(/\D/g, "");
  return x.length === 8 ? `${x.slice(0, 5)}-${x.slice(5)}` : x;
};
const enderecoTexto = (e: EnderecoDanfse | null) =>
  e ? [e.logradouro, e.numero, e.complemento, e.bairro].filter(Boolean).join(", ") : "";
const pct = (v: string | null) => (v ? `${Number(v).toFixed(2)}%` : "");

const SN: Record<string, string> = { "1": "Não optante", "2": "Optante - MEI", "3": "Optante - ME/EPP" };
const REG_AP_SN: Record<string, string> = {
  "1": "Federais e ISSQN pelo SN",
  "2": "Federais pelo SN; ISSQN fora",
  "3": "Federais e ISSQN fora do SN",
};
const TRIB: Record<string, string> = { "1": "Operação tributável", "2": "Imunidade", "3": "Exportação de serviço", "4": "Não incidência" };
const RET: Record<string, string> = { "1": "Não retido", "2": "Retido pelo tomador", "3": "Retido pelo intermediário" };

export interface DanfseOptions {
  cancelada?: boolean;
  substituida?: boolean;
  // Título do documento ("NFS-e 43 - TOMADOR - 02-11-2026"): o leitor de PDF do
  // navegador mostra na aba, no lugar do código aleatório do endereço.
  titulo?: string;
}

export async function renderDanfsePdf(nfseXml: string, opts: DanfseOptions = {}): Promise<Buffer> {
  const n: NfseDanfse = lerNfseDanfse(nfseXml);
  const chave = n.chaveAcesso || "";
  const homolog = n.tpAmb === "2";

  const pdf = await PDFDocument.create();
  const page = pdf.addPage(A4);
  const c: Ctx = {
    pdf,
    page,
    font: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.Courier),
    y: A4[1] - M,
  };
  const topo = c.y;

  // --- cabeçalho: título, chave em blocos de 4 e QR Code -------------------------
  const hCab = 92;
  page.drawText("DANFSe v2.0 — Documento Auxiliar da NFS-e", { x: M + 8, y: c.y - 30, size: 11.5, font: c.bold, color: INK });
  page.drawText(
    seguro(`Nota Fiscal de Serviço eletrônica — padrão nacional${homolog ? " — PRODUÇÃO RESTRITA (homologação)" : ""}`),
    { x: M + 8, y: c.y - 40, size: 7, font: c.font, color: LABEL },
  );
  page.drawText("CHAVE DE ACESSO", { x: M + 8, y: c.y - 56, size: 5.6, font: c.font, color: LABEL });
  page.drawText(chave.replace(/(.{4})/g, "$1 ").trim() || "-", { x: M + 8, y: c.y - 67, size: 9.2, font: c.mono, color: INK });
  try {
    const png = await QRCode.toBuffer(CONSULTA_URL + chave, { type: "png", margin: 0, width: 240 });
    const qr = await pdf.embedPng(png);
    const lado = 64;
    const xq = M + W - lado - 10;
    page.drawImage(qr, { x: xq, y: c.y - 8 - lado, width: lado, height: lado });
    for (const [i, s] of ["Consulta pública", "www.nfse.gov.br"].entries()) {
      const w = c.font.widthOfTextAtSize(s, 5.6);
      page.drawText(s, { x: xq + (lado - w) / 2, y: c.y - lado - 16 - i * 7, size: 5.6, font: c.font, color: INK });
    }
  } catch {
    /* sem QR: a chave basta para a consulta */
  }
  c.y -= hCab;
  linhaH(c, c.y);

  // --- identificação -------------------------------------------------------------
  linha(c, [
    ["Número da NFS-e", n.nNFSe],
    ["Competência", dataHora(n.dps.dCompet)],
    ["Data/hora da emissão", dataHora(n.dps.dhEmi)],
    ["Data/hora do processamento", dataHora(n.dhProc)],
  ]);
  linha(c, [
    ["Número da DPS", n.dps.nDPS],
    ["Série da DPS", n.dps.serie ? String(Number(n.dps.serie) || n.dps.serie) : ""],
    ["Local de emissão", n.xLocEmi],
    ["Local da prestação", n.xLocPrestacao],
  ]);

  // --- prestador -----------------------------------------------------------------
  secao(c, "Prestador / Emitente");
  const e = n.emit;
  linha(c, [
    ["CNPJ / CPF", docFmt(e.doc)],
    ["Inscrição municipal", e.im],
    ["Telefone", e.fone],
    ["E-mail", e.email],
  ]);
  linha(c, [
    ["Nome / Razão social", e.nome, 2],
    ["Simples Nacional", SN[n.dps.opSimpNac ?? ""] || n.dps.opSimpNac],
    ["Regime de apuração SN", REG_AP_SN[n.dps.regApTribSN ?? ""] || n.dps.regApTribSN],
  ]);
  linha(c, [
    ["Endereço", enderecoTexto(e.end), 2],
    ["Município / UF", [n.xLocEmi, e.end.uf].filter(Boolean).join(" / ")],
    ["CEP", cepFmt(e.end.cep)],
  ]);

  // --- tomador -------------------------------------------------------------------
  secao(c, "Tomador do serviço");
  const t = n.toma;
  if (t && (t.doc || t.nome)) {
    linha(c, [
      ["CNPJ / CPF", docFmt(t.doc)],
      ["Inscrição municipal", t.im],
      ["Telefone", t.fone],
      ["E-mail", t.email],
    ]);
    linha(c, [
      ["Nome / Razão social", t.nome, 2],
      ["Endereço", enderecoTexto(t.end), 2],
    ]);
    if (t.end.cMun || t.end.cep) {
      linha(c, [
        ["Código do município (IBGE)", t.end.cMun],
        ["CEP", cepFmt(t.end.cep)],
        ["", "", 2],
      ]);
    }
  } else {
    linha(c, [["Tomador", "NÃO IDENTIFICADO NA NFS-e", 4]]);
  }

  // --- serviço -------------------------------------------------------------------
  secao(c, "Serviço prestado");
  linha(c, [
    ["Código de tributação nacional", [n.dps.cTribNac, n.xTribNac].filter(Boolean).join(" - "), 3],
    ["Código de tributação municipal", [n.dps.cTribMun, n.xTribMun].filter(Boolean).join(" - ")],
  ]);
  if (n.dps.cNBS) linha(c, [["NBS", [n.dps.cNBS, n.xNBS].filter(Boolean).join(" - "), 4]]);
  const ev = n.dps.evento;
  if (ev) {
    linha(c, [
      ["Evento", ev.xNome, 2],
      ["Período", [dataHora(ev.dtIni), dataHora(ev.dtFim)].filter(Boolean).join(" a ")],
      ["Identificação na prefeitura", ev.idAtvEvt],
    ]);
    if (ev.end) linha(c, [["Local do evento", [enderecoTexto(ev.end), cepFmt(ev.end.cep)].filter(Boolean).join(" — CEP "), 4]]);
  }
  const ob = n.dps.obra;
  if (ob) {
    linha(c, [
      ["Obra (CNO / CEI)", ob.cObra],
      ["Endereço da obra", ob.end ? [enderecoTexto(ob.end), cepFmt(ob.end.cep)].filter(Boolean).join(" — CEP ") : "", 3],
    ]);
  }
  texto(c, n.dps.xDescServ || "-", { minAltura: 52 });

  // --- ISSQN ---------------------------------------------------------------------
  secao(c, "Tributação municipal (ISSQN)");
  linha(c, [
    ["Tributação do ISSQN", TRIB[n.dps.tribISSQN ?? ""] || n.dps.tribISSQN],
    ["Retenção do ISSQN", RET[n.dps.tpRetISSQN ?? ""] || n.dps.tpRetISSQN],
    ["Município de incidência", n.xLocIncid || n.xLocPrestacao],
    ["Alíquota aplicada", pct(n.valores.pAliqAplic) || pct(n.dps.pAliq) || "-"],
  ]);
  linha(c, [
    ["Base de cálculo", n.valores.vBC ? moeda(n.valores.vBC) : "-"],
    ["ISSQN apurado", n.valores.vISSQN ? moeda(n.valores.vISSQN) : "-"],
    ["Total de retenções", moeda(n.valores.vTotalRet)],
    ["Tributos aprox. (SN)", pct(n.dps.pTotTribSN) || "-"],
  ]);

  // --- valores -------------------------------------------------------------------
  secao(c, "Valor total");
  const descontos = (Number(n.dps.vDescIncond) || 0) + (Number(n.dps.vDescCond) || 0);
  linha(
    c,
    [
      ["Valor do serviço", moeda(n.dps.vServ)],
      ["Descontos", moeda(descontos)],
      ["Retenções", moeda(n.valores.vTotalRet)],
      ["Valor líquido da NFS-e", moeda(n.valores.vLiq || n.dps.vServ)],
    ],
    { tamanho: 9 },
  );

  // --- informações complementares --------------------------------------------------
  const compl = [n.dps.xInfComp, n.xOutInf].filter(Boolean).join("\n");
  if (compl) {
    secao(c, "Informações complementares");
    texto(c, compl, { maxLinhas: 10 });
  }

  // --- rodapé + moldura --------------------------------------------------------------
  linhaH(c, c.y, BORDA, 0.8);
  const rodape = quebrar(
    "Documento auxiliar gerado pelo sistema emissor a partir do XML oficial da NFS-e. A autenticidade pode ser verificada na consulta pública em www.nfse.gov.br com a chave de acesso acima.",
    c.font,
    5.6,
    W - 12,
    3,
  );
  rodape.forEach((ln, i) => page.drawText(ln, { x: M + 6, y: c.y - 9 - i * 7, size: 5.6, font: c.font, color: LABEL }));
  c.y -= 6 + rodape.length * 7 + 4;
  page.drawRectangle({ x: M, y: c.y, width: W, height: topo - c.y, borderColor: BORDA, borderWidth: 0.9 });

  // --- marca d'água ----------------------------------------------------------------
  const wm = opts.cancelada ? "CANCELADA" : opts.substituida ? "SUBSTITUÍDA" : homolog ? "SEM VALOR FISCAL" : "";
  if (wm) {
    const size = wm.length > 12 ? 52 : 64;
    const w = c.bold.widthOfTextAtSize(wm, size);
    const ang = (24 * Math.PI) / 180;
    // centro da moldura, com o texto girado em torno do próprio centro
    const cx = M + W / 2;
    const cy = (topo + c.y) / 2;
    page.drawText(seguro(wm), {
      x: cx - (w / 2) * Math.cos(ang),
      y: cy - (w / 2) * Math.sin(ang),
      size,
      font: c.bold,
      color: rgb(0.78, 0, 0),
      opacity: 0.18,
      rotate: { type: "degrees", angle: 24 } as any,
    });
  }

  if (opts.titulo) {
    pdf.setTitle(opts.titulo, { showInWindowTitleBar: true });
    pdf.setSubject("DANFSe — Documento Auxiliar da NFS-e");
  }
  return Buffer.from(await pdf.save());
}
