import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { clients, nfseAtividades, nfseEmissoes } from "../../schema";
import { loadClientCertContext } from "./cert";
import { lookupCnpj } from "./cnpjLookup";
import { CNAE_SERVICO, DESCRICAO_TRIB_NAC } from "./cnaeServico";
import { getClientConfig } from "./config";
import { getAliquotaParametrizada } from "./params";

// Sugere as atividades de NFS-e de um cliente, criadas DESLIGADAS e marcadas
// (`nfse_atividades.sugestao`) até o contador conferir:
//   1) pelas notas que ele já emitiu (trazidas do portal nacional) — os códigos
//      que a prefeitura já aceitou, com código municipal, NBS e a descrição
//      mais usada;
//   2) sem notas, pelo CNAE (principal + secundários) na tabela de referência
//      CNAE → cTribNac (cnaeServico.ts — não existe tabela oficial).
// Valores do escritório para os clientes (empresas pequenas do Simples): ISS
// 2,01% e 6% de tributos aproximados do Simples. A alíquota parametrizada pela
// prefeitura, quando existe, vai junto para conferência.

export const ALIQUOTA_ISS_PADRAO = 2.01;
export const P_TOT_TRIB_SN_PADRAO = 6;

export interface SugestaoAtividade {
  cTribNac: string;
  nome: string;
  origem: "notas" | "cnae";
  cTribMun?: string | null;
  cNbs?: string | null;
  descricao?: string;
  notas?: number;
  cnae?: string;
  conferir?: string | null;
}

const ent = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
const tag = (xml: string, nome: string) => {
  const m = xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`));
  return m ? ent(m[1]).replace(/\s+/g, " ").trim() : null;
};
const maisFrequente = (valores: (string | null | undefined)[]): string | null => {
  const n = new Map<string, number>();
  for (const v of valores) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  let melhor: string | null = null;
  let max = 0;
  for (const [v, c] of n) if (c > max) [melhor, max] = [v, c];
  return melhor;
};

/** Pelas NFS-e já emitidas: um código por cTribNac, do mais usado ao menos usado. */
export function sugestoesDasNotas(xmls: string[]): SugestaoAtividade[] {
  const porCodigo = new Map<string, { nomes: string[]; mun: (string | null)[]; nbs: (string | null)[]; desc: (string | null)[]; n: number }>();
  for (const xml of xmls) {
    const c = tag(xml, "cTribNac");
    if (!c || !/^\d{6}$/.test(c)) continue;
    const g = porCodigo.get(c) ?? { nomes: [], mun: [], nbs: [], desc: [], n: 0 };
    g.n++;
    g.nomes.push(tag(xml, "xTribNac") ?? "");
    g.mun.push(tag(xml, "cTribMun"));
    g.nbs.push(tag(xml, "cNBS"));
    g.desc.push(tag(xml, "xDescServ"));
    porCodigo.set(c, g);
  }
  return [...porCodigo]
    .sort((a, b) => b[1].n - a[1].n)
    .map(([c, g]) => ({
      cTribNac: c,
      nome: maisFrequente(g.nomes) || DESCRICAO_TRIB_NAC[c] || `Serviço ${itemDoCodigo(c)}`,
      origem: "notas" as const,
      cTribMun: maisFrequente(g.mun),
      cNbs: maisFrequente(g.nbs),
      descricao: maisFrequente(g.desc) ?? "",
      notas: g.n,
      conferir: null,
    }));
}

/** Pelo CNAE (principal primeiro). CNAE sem serviço de ISS não gera nada. */
export function sugestoesDoCnae(cnaes: string[]): SugestaoAtividade[] {
  const out: SugestaoAtividade[] = [];
  const vistos = new Set<string>();
  for (const cnae of cnaes) {
    const s = CNAE_SERVICO[String(cnae).replace(/\D/g, "").padStart(7, "0")];
    if (!s || vistos.has(s.cTribNac)) continue;
    vistos.add(s.cTribNac);
    out.push({
      cTribNac: s.cTribNac,
      nome: DESCRICAO_TRIB_NAC[s.cTribNac] ?? `Serviço ${itemDoCodigo(s.cTribNac)}`,
      origem: "cnae",
      cnae,
      descricao: "",
      conferir: s.conferir,
    });
  }
  return out;
}

/** "040802" → "4.08" (item da LC 116). */
export const itemDoCodigo = (c: string) => `${Number(c.slice(0, 2))}.${c.slice(2, 4)}`;

export interface ResultadoSugestao {
  criadas: { cTribNac: string; nome: string; origem: "notas" | "cnae"; conferir: string | null; aliqMunicipal: number | null }[];
  jaExistiam: number;
  motivo: string | null; // por que nada foi criado
}

export async function sugerirAtividades(clientId: string): Promise<ResultadoSugestao> {
  const res: ResultadoSugestao = { criadas: [], jaExistiam: 0, motivo: null };
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) return { ...res, motivo: "cliente não encontrado" };
  const config = await getClientConfig(clientId);
  if (!config) return { ...res, motivo: "sem configuração de NFS-e — rode “Configurar e buscar” antes" };
  if (config.regimeTributario === "mei") return { ...res, motivo: "MEI — cadastre a atividade à mão" };

  const notas = await db
    .select({ xml: nfseEmissoes.xmlNfse })
    .from(nfseEmissoes)
    .where(
      and(
        eq(nfseEmissoes.clientId, clientId),
        eq(nfseEmissoes.papel, "prestador"),
        eq(nfseEmissoes.status, "emitida"),
        eq(nfseEmissoes.ambiente, "producao"),
        isNotNull(nfseEmissoes.xmlNfse),
      ),
    )
    .orderBy(desc(nfseEmissoes.createdAt))
    .limit(500);

  let sugestoes = sugestoesDasNotas(notas.map((n) => n.xml!));
  if (!sugestoes.length) {
    const t = await lookupCnpj(client.cnpj).catch(() => null);
    if (!t) return { ...res, motivo: "não foi possível consultar o CNAE na Receita agora" };
    if (t.mei) return { ...res, motivo: "MEI — cadastre a atividade à mão" };
    sugestoes = sugestoesDoCnae([t.cnaePrincipal, ...t.cnaesSecundarios].filter(Boolean) as string[]);
    if (!sugestoes.length) return { ...res, motivo: "nenhum CNAE de serviço com ISS (comércio/indústria)" };
  }

  const existentes = await db.select({ c: nfseAtividades.codTributacaoNac }).from(nfseAtividades).where(eq(nfseAtividades.clientId, clientId));
  const jaTem = new Set(existentes.map((e) => String(e.c ?? "").replace(/\D/g, "")).filter(Boolean));

  // Alíquota que a prefeitura parametrizou para o código (só para conferência).
  const agora = new Date();
  const competencia = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-01`;
  const cert = await loadClientCertContext(clientId).catch(() => null);
  const municipio = String(config.codigoMunicipio || "").replace(/\D/g, "");

  let ordem = existentes.length;
  for (const s of sugestoes) {
    if (jaTem.has(s.cTribNac)) {
      res.jaExistiam++;
      continue;
    }
    const aliqMunicipal =
      cert && municipio.length === 7
        ? await getAliquotaParametrizada(cert.agent, config.ambiente === "producao" ? "producao" : "homologacao", municipio, s.cTribNac, competencia).catch(() => null)
        : null;
    await db.insert(nfseAtividades).values({
      clientId,
      nome: s.nome.slice(0, 120),
      itemListaServico: itemDoCodigo(s.cTribNac),
      codTributacaoNac: s.cTribNac,
      codTributacaoMun: s.cTribMun ?? null,
      cnae: s.cnae ?? null,
      cNbs: s.cNbs ?? null,
      descricaoPadrao: (s.descricao ?? "").slice(0, 2000),
      aliquotaIss: ALIQUOTA_ISS_PADRAO,
      issRetido: false,
      tribIssqn: "1",
      exigibilidadeIss: "1",
      regApTribSn: "1",
      pTotTribSn: P_TOT_TRIB_SN_PADRAO,
      ativo: false,
      ordem: ordem++,
      sugestao: { origem: s.origem, conferir: s.conferir ?? null, notas: s.notas ?? null, cnae: s.cnae ?? null, aliqMunicipal, criadaEm: new Date().toISOString() } as any,
    });
    res.criadas.push({ cTribNac: s.cTribNac, nome: s.nome, origem: s.origem, conferir: s.conferir ?? null, aliqMunicipal });
    jaTem.add(s.cTribNac);
  }
  return res;
}
