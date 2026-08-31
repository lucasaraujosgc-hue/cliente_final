import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { clients, nfseAtividades, nfseConfig, nfseEmissoes } from "../../schema";
import { normalizeCnpj } from "../../../lib/cnpj";
import type { NfseEmissaoRow } from "../../types";
import { loadClientCertContext } from "./cert";
import { buildDpsXml, type DpsTomador } from "./dps";
import { signDps } from "./sign";
import { emitirNfse as postNfse, type Ambiente } from "./client";
import { NfseError, notConfigured } from "./errors";

// Orquestra a emissão: carrega certificado + config + atividade, monta e assina
// a DPS, envia à Sefin Nacional (síncrono) e persiste o resultado em
// nfse_emissoes — seja "emitida" (com chave/número/XMLs) ou "rejeitada" (com
// código + motivo). Sempre grava uma linha.

export interface EmitirInput {
  atividadeId: string;
  tomador: {
    doc: string;
    nome: string;
    email?: string;
    telefone?: string;
    inscricaoMunicipal?: string;
    endereco?: DpsTomador["endereco"];
  };
  descricao: string;
  valor: number; // centavos
  competencia?: string;
}

// regEspTrib (regime especial de tributação municipal) é independente do
// opSimpNac. Sem configuração explícita do contador → "0" (nenhum). MEI e Simples
// já são sinalizados por opSimpNac em dps.ts.
const REG_ESP_TRIB_DEFAULT = "0";

export async function emitirNfse(clientId: string, input: EmitirInput): Promise<NfseEmissaoRow> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) throw new NfseError("Cliente não encontrado.", { status: 404 });

  const [config] = await db.select().from(nfseConfig).where(eq(nfseConfig.clientId, clientId));
  if (!config) throw notConfigured();
  if (!config.ativo) throw new NfseError("Emissão de NFS-e não está ativa para este cliente.", { status: 403 });

  const [atividade] = await db
    .select()
    .from(nfseAtividades)
    .where(and(eq(nfseAtividades.id, input.atividadeId), eq(nfseAtividades.clientId, clientId)));
  if (!atividade || !atividade.ativo) {
    throw new NfseError("Atividade inválida ou inativa.", { status: 400, reason: "atividade_invalida" });
  }

  const ambiente = (config.ambiente === "producao" ? "producao" : "homologacao") as Ambiente;
  const now = new Date();
  const competencia =
    input.competencia && /^\d{2}\/\d{4}$/.test(input.competencia)
      ? input.competencia
      : `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;

  // Certificado (mTLS + PEM p/ assinatura) — valida vencimento.
  const cert = await loadClientCertContext(clientId);

  // Consome o próximo número de DPS de forma atômica.
  const [bumped] = await db
    .update(nfseConfig)
    .set({ proxNumeroDps: sql`${nfseConfig.proxNumeroDps} + 1`, updatedAt: new Date() })
    .where(eq(nfseConfig.clientId, clientId))
    .returning({ prox: nfseConfig.proxNumeroDps });
  const numeroDps = (bumped?.prox ?? 1) - 1;
  const serie = config.serieDps || "00001";

  const dhEmi = new Date();
  const built = buildDpsXml({
    ambiente,
    serie,
    numero: numeroDps,
    competencia,
    dhEmi,
    cLocEmi: String(config.codigoMunicipio || ""),
    prestador: {
      cnpj: normalizeCnpj(client.cnpj),
      inscricaoMunicipal: null,
      nome: client.name,
      regimeTributario: (config.regimeTributario as any) || "simples_nacional",
      regEspTrib: config.regimeEspecialTrib || REG_ESP_TRIB_DEFAULT,
    },
    tomador: {
      doc: normalizeCnpj(input.tomador.doc),
      nome: input.tomador.nome,
      email: input.tomador.email || null,
      telefone: input.tomador.telefone || null,
      inscricaoMunicipal: input.tomador.inscricaoMunicipal || null,
      endereco: input.tomador.endereco || null,
    },
    servico: {
      cTribNac: atividade.codTributacaoNac,
      cTribMun: atividade.codTributacaoMun,
      itemListaServico: atividade.itemListaServico,
      descricao: input.descricao,
    },
    valores: {
      valorServicosCentavos: input.valor,
      aliquotaIss: atividade.aliquotaIss || 0,
      issRetido: atividade.issRetido,
      exigibilidadeIss: atividade.exigibilidadeIss || "1",
      retIrrf: atividade.retIrrf,
      retCsll: atividade.retCsll,
      retInss: atividade.retInss,
    },
  });

  const dpsAssinada = signDps(built.xml, built.idDps, cert.parsed.keyPem, cert.parsed.certPem);

  const baseRow = {
    clientId,
    atividadeId: atividade.id,
    ambiente,
    competencia,
    valorServicos: input.valor,
    aliquotaIss: atividade.aliquotaIss || 0,
    descricao: input.descricao,
    tomadorDoc: normalizeCnpj(input.tomador.doc),
    tomadorNome: input.tomador.nome,
    tomadorEmail: input.tomador.email || null,
    tomadorTelefone: input.tomador.telefone || null,
    tomadorEndereco: (input.tomador.endereco ?? null) as any,
    serieDps: serie,
    numeroDps,
    idDps: built.idDps,
    xmlDps: dpsAssinada,
    dataEmissao: dhEmi,
    updatedAt: new Date(),
  };

  try {
    const result = await postNfse(cert.agent, ambiente, dpsAssinada);
    const nNFSe = result.nfseXml.match(/<nNFSe>(\d+)<\/nNFSe>/)?.[1] ?? null;
    const valorIss = Math.round(((atividade.aliquotaIss || 0) / 100) * input.valor);

    const [row] = await db
      .insert(nfseEmissoes)
      .values({
        ...baseRow,
        status: "emitida",
        chaveAcesso: result.chaveAcesso || null,
        numeroNota: nNFSe,
        valorIss,
        xmlNfse: result.nfseXml || null,
      })
      .returning();
    return row;
  } catch (e) {
    const err = e instanceof NfseError ? e : new NfseError(String((e as any)?.message || e), { status: 502 });
    await db.insert(nfseEmissoes).values({
      ...baseRow,
      status: "rejeitada",
      rejeicaoCodigo: err.codigo || null,
      rejeicaoMotivo: err.motivo || err.message,
      erroMsg: err.message,
    });
    throw err;
  }
}
