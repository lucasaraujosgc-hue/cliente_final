// Leitura do Relatório de Situação Fiscal (SITFIS). O Integra Contador entrega
// só o PDF (RELATORIOSITFIS92 → dados.pdf em base64), sem os débitos em dados
// estruturados — então o texto é extraído do PDF e lido por regras.
//
// O relatório vem em paisagem (página girada 90°): a extração considera a
// rotação para montar as linhas na ordem de leitura. Colunas separadas por
// espaço grande viram " | ".
//
// É leitura de melhor esforço sobre um layout da Receita: o PDF original fica
// sempre disponível no painel para conferência.

export type TipoSecao = "omissao" | "debito" | "parcelamento" | "divida_ativa" | "processo" | "outra";

// Sobe quando a leitura muda: relatórios já guardados são relidos do PDF.
export const VERSAO_LEITOR = 2;

export interface SitfisItem {
  texto: string; // linha original, para exibir
  receita?: string | null; // "4406-01 - MAED - PGDAS-D"
  codigoReceita?: string | null; // "4406-01"
  pa?: string | null; // período de apuração / exercício como veio ("21/06/2024", "07/2026", "2026")
  vencimento?: string | null; // DD/MM/AAAA
  valorOriginal?: number | null;
  saldoDevedor?: number | null;
  multa?: number | null;
  juros?: number | null;
  saldoConsolidado?: number | null;
  situacao?: string | null;
  referencia?: string | null; // nº da notificação / inscrição
  parcelasEmAtraso?: number | null;
}

export interface SitfisSecao {
  orgao: "RFB" | "PGFN";
  tipo: TipoSecao;
  titulo: string; // "Débito (SIEF)", "Omissão de PGDAS-D", "Inscrição (SIDA)"…
  periodos: string[]; // omissões: "AGO/2026"…
  itens: SitfisItem[];
  total: number; // soma do saldo consolidado
}

export interface SitfisResultado {
  versao?: number; // VERSAO_LEITOR que leu o PDF
  emitidoEm: string | null; // "19/10/2026 16:06:58"
  cnpj: string | null;
  razaoSocial: string | null;
  situacaoCadastral: string | null;
  secoes: SitfisSecao[];
  semPendencias: boolean; // nenhuma pendência lida e o relatório diz que não há
  inconclusivo: boolean; // nem pendências nem a frase de "sem pendências"
}

// ---------------------------------------------------------------------------
// Extração do texto (pdf.js)

export async function extrairLinhasPdf(pdf: Buffer | Uint8Array): Promise<string[]> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0, isEvalSupported: false }).promise;
  const linhas: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    linhas.push(...montarLinhas(tc.items));
  }
  await doc.destroy?.();
  return linhas;
}

interface ItemTexto {
  str: string;
  transform: number[];
}

/** Agrupa os itens de texto de uma página em linhas, considerando rotação de 90°. */
export function montarLinhas(itens: ItemTexto[]): string[] {
  const porLinha = new Map<number, { pos: number; s: string }[]>();
  for (const it of itens) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, , , e, f] = it.transform;
    const girado = Math.abs(a) < 0.01 && Math.abs(b) > 0.01;
    const linha = Math.round(girado ? e : -f);
    const pos = girado ? f : e;
    const arr = porLinha.get(linha) ?? [];
    arr.push({ pos, s: it.str.trim() });
    porLinha.set(linha, arr);
  }
  const out: string[] = [];
  for (const k of [...porLinha.keys()].sort((x, y) => x - y)) {
    let txt = "";
    let fim: number | null = null;
    for (const i of porLinha.get(k)!.sort((x, y) => x.pos - y.pos)) {
      if (fim !== null && i.pos - fim > 25) txt += "  |  ";
      else if (txt) txt += " ";
      txt += i.s;
      fim = i.pos + i.s.length * 4.5;
    }
    out.push(txt);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Leitura

const DINHEIRO = /\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/g;
const MESES: Record<string, string> = { JAN: "01", FEV: "02", MAR: "03", ABR: "04", MAI: "05", JUN: "06", JUL: "07", AGO: "08", SET: "09", OUT: "10", NOV: "11", DEZ: "12" };

export const valorBR = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const limpar = (s: string) => s.replace(/_{3,}/g, " ").replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim();

// Linhas do cabeçalho de página, que se repetem e não são conteúdo.
const CABECALHO = [
  /^MINIST[ÉE]RIO DA (FAZENDA|ECONOMIA)/i,
  /^SECRETARIA ESPECIAL DA RECEITA/i,
  /^PROCURADORIA-GERAL DA FAZENDA NACIONAL(?!.*Diagn)/i,
  /^INFORMA[ÇC][ÕO]ES DE APOIO/i,
  /^P[áa]gina:\s*\d+/i,
];

export function classificarSecao(titulo: string, orgao: "RFB" | "PGFN"): TipoSecao {
  if (/omiss/i.test(titulo)) return "omissao";
  if (/parcelamento/i.test(titulo)) return "parcelamento";
  if (orgao === "PGFN" || /inscri|sida|d[íi]vida ativa/i.test(titulo)) return "divida_ativa";
  if (/processo/i.test(titulo)) return "processo";
  if (/d[ée]bito|exigib|pend[êe]ncia/i.test(titulo)) return "debito";
  return "outra";
}

/** Linha de tabela com valores: receita, período, vencimento e 4–5 valores. */
function lerLinhaValores(linha: string): SitfisItem | null {
  const valores = linha.match(DINHEIRO) ?? [];
  if (valores.length < 4) return null;
  const antes = linha.slice(0, linha.search(DINHEIRO));
  const datas = antes.match(/\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{4}|\b\d{4}\b(?!-)/g) ?? [];
  const venc = [...datas].reverse().find((d) => /^\d{2}\/\d{2}\/\d{4}$/.test(d)) ?? null;
  const pa = datas.length >= 2 ? datas[datas.length - 2] : null;
  const corte = pa ? antes.lastIndexOf(pa, venc ? antes.lastIndexOf(venc) : undefined) : -1;
  const receita = limpar(corte > 0 ? antes.slice(0, corte) : antes) || null;
  const n = valores.map(valorBR);
  const depois = limpar(linha.slice(linha.lastIndexOf(valores[valores.length - 1]) + valores[valores.length - 1].length));
  return {
    texto: limpar(linha),
    receita,
    codigoReceita: receita?.match(/^\d{4}-{1,2}\d{0,2}/)?.[0]?.replace(/-+$/, "") ?? null,
    pa,
    vencimento: venc,
    valorOriginal: n.length >= 5 ? n[n.length - 5] : null,
    saldoDevedor: n.length >= 4 ? n[n.length - 4] : null,
    multa: n[n.length - 3] ?? null,
    juros: n[n.length - 2] ?? null,
    saldoConsolidado: n[n.length - 1] ?? null,
    situacao: depois || null,
  };
}

export function lerSitfis(linhasBrutas: string[]): SitfisResultado {
  const linhas = linhasBrutas.map((l) => l.trim()).filter(Boolean);
  const texto = linhas.join("\n");

  const res: SitfisResultado = {
    versao: VERSAO_LEITOR,
    emitidoEm: texto.match(/\b(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2})\b/)?.[1] ?? null,
    cnpj: texto.match(/CNPJ:\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/)?.[1] ?? null,
    razaoSocial: texto.match(/CNPJ:\s*\d{2}\.\d{3}\.\d{3}\s*-\s*([^\n|]+)/)?.[1]?.trim() ?? null,
    situacaoCadastral: texto.match(/^Situa[çc][ãa]o:\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ ]+)$/m)?.[1]?.trim() ?? null,
    secoes: [],
    semPendencias: false,
    inconclusivo: false,
  };

  let orgao: "RFB" | "PGFN" = "RFB";
  let atual: SitfisSecao | null = null;
  let iniciou = false; // só depois de "Diagnóstico Fiscal" começam as pendências
  // Detalhe de inscrição da PGFN: o gerador do PDF desenha essa sub-tabela
  // (colunas "... Sdo. Dev. Cons. Situação") fora do lugar, dentro dos débitos
  // da Receita — guarda e anexa à próxima inscrição. Só é ela quando a seção
  // já tinha a tabela própria SEM a coluna Situação: há relatórios em que a
  // própria tabela de débitos da Receita traz "Situação" no fim da linha.
  let tabelaComSituacao = false;
  let cabecalhoSemSituacao = false;
  const detalhesPgfn: { item: SitfisItem; secao: SitfisSecao }[] = [];
  // Nome da receita da inscrição quebra em linhas ("4834-- MULTA" / "ISOLADA").
  let continuacaoReceita: { item: SitfisItem; inicio: string } | null = null;

  const novaSecao = (titulo: string) => {
    const t = limpar(titulo).replace(/^Pend[êe]ncia\s*-\s*/i, "").replace(/\*+$/, "").trim();
    atual = { orgao, tipo: classificarSecao(t, orgao), titulo: t, periodos: [], itens: [], total: 0 };
    res.secoes.push(atual);
    tabelaComSituacao = false;
    cabecalhoSemSituacao = false;
  };

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (CABECALHO.some((r) => r.test(l))) continue;

    if (/Diagn[óo]stico Fiscal na Receita/i.test(l)) {
      orgao = "RFB";
      iniciou = true;
      atual = null;
      continue;
    }
    if (/Diagn[óo]stico Fiscal na Procuradoria/i.test(l)) {
      orgao = "PGFN";
      iniciou = true;
      atual = null;
      continue;
    }
    if (/Final do Relat[óo]rio/i.test(l)) break;
    if (!iniciou) continue;

    // Cabeçalho de seção: "Pendência - Débito (SIEF) ____", "Omissão de | PGDAS-D ____"
    if (/_{3,}/.test(l) && /(Pend[êe]ncia|Omiss[ãa]o|Exigibilidade|Processo|Inscri)/i.test(l)) {
      novaSecao(l);
      continue;
    }
    const sec = atual as SitfisSecao | null;
    if (/^Receita\b.*Sdo\.?\s*Dev\.?\s*Cons/i.test(l)) {
      if (/Sdo\.?\s*Dev\.?\s*Cons\.?\s*\|?\s*Situa/i.test(l)) {
        tabelaComSituacao = orgao === "RFB" && cabecalhoSemSituacao;
      } else {
        cabecalhoSemSituacao = true;
        tabelaComSituacao = false;
      }
      continue;
    }

    // Linha de valores
    const item = lerLinhaValores(l);
    if (item) {
      if (tabelaComSituacao && sec) {
        detalhesPgfn.push({ item, secao: sec });
        continue;
      }
      if (sec) sec.itens.push(item);
      continue;
    }
    if (!sec) continue;

    const ultimo = sec.itens[sec.itens.length - 1];
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^Situa[çc][ãa]o:\s*(.+)$/i))) {
      if (ultimo && !ultimo.situacao) ultimo.situacao = limpar(m[1]);
    } else if ((m = l.match(/Notifica[çc][ãa]o de lan[çc]amento:\s*(\d+)/i))) {
      // A notificação vem depois do item a que pertence.
      const semRef = [...sec.itens].reverse().find((x) => !x.referencia);
      if (semRef) semRef.referencia = m[1];
    } else if ((m = l.match(/\b(\d{2}\.\d\.\d{2}\.\d{6}-\d{2})\b/))) {
      // Inscrição em dívida ativa (PGFN)
      const det = detalhesPgfn.shift()?.item;
      const partes = l.split("|").map((x) => x.trim());
      const inscricao: SitfisItem = {
        ...(det ?? {}),
        texto: limpar(l),
        referencia: m[1],
        receita: det?.receita ? `${partes[1] ?? ""} ${det.receita}`.trim() : partes[1] ?? null,
        codigoReceita: (partes[1] ?? "").match(/^\d{4}/)?.[0] ?? null,
        situacao: null,
      };
      sec.itens.push(inscricao);
      continuacaoReceita = partes[1] ? { item: inscricao, inicio: partes[1] } : null;
      continue;
    } else if (continuacaoReceita && /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ. ]{3,40}$/.test(l)) {
      const { item, inicio } = continuacaoReceita;
      item.receita = (item.receita ?? inicio).replace(inicio, `${inicio} ${l}`);
      continuacaoReceita = { item, inicio: `${inicio} ${l}` };
      continue;
    } else if (/Parcelas em atraso/i.test(l)) {
      const n = Number(l.match(/Parcelas em atraso\s*\|?\s*(\d+)/i)?.[1] ?? linhas[i + 1]?.match(/^\d+$/)?.[0]);
      sec.itens.push({
        texto: limpar(l.replace(/\|?\s*Parcelas em atraso.*/i, "")) || sec.titulo,
        situacao: limpar(l.replace(/\|?\s*Parcelas em atraso.*/i, "")) || null,
        parcelasEmAtraso: Number.isFinite(n) ? n : null,
      });
    } else if (sec.tipo === "omissao") {
      // "(Período de Apuração) | 2026 - AGO" / "2025 - JAN, FEV" / "09/2026"
      for (const pm of l.matchAll(/(\d{4})\s*-\s*((?:[A-Z]{3}(?:\s*,\s*)?)+)/g)) {
        for (const mes of pm[2].split(/\s*,\s*/)) if (MESES[mes]) sec.periodos.push(`${mes}/${pm[1]}`);
      }
      for (const pm of l.matchAll(/\b(\d{2})\/(\d{4})\b/g)) sec.periodos.push(`${pm[1]}/${pm[2]}`);
      if (/^\d{4}$/.test(l)) sec.periodos.push(l); // exercício (declaração anual)
    }
  }

  // Sub-tabela que não encontrou inscrição: era da própria seção — não se perde.
  for (const { item, secao } of detalhesPgfn) secao.itens.push(item);

  for (const s of res.secoes) {
    s.periodos = [...new Set(s.periodos)];
    s.total = Math.round(s.itens.reduce((acc, it) => acc + (it.saldoConsolidado ?? 0), 0) * 100) / 100;
  }
  // "Omissão de PGDAS-D" sem período identificado ainda é uma omissão.
  res.secoes = res.secoes.filter((s) => s.itens.length || s.periodos.length || s.tipo === "omissao" || s.tipo === "parcelamento");
  // A frase "não foram detectadas pendências" vem por órgão (Receita e/ou
  // Procuradoria): só vale para o relatório todo quando nada foi lido.
  const fraseSemPendencias = /n[ãa]o foram detectadas pend[êe]ncias/i.test(texto);
  res.semPendencias = fraseSemPendencias && res.secoes.length === 0;
  res.inconclusivo = !fraseSemPendencias && res.secoes.length === 0;
  return res;
}
