import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { clients, nfseAtividades, nfseConfig, nfseEmissoes } from "../../schema";
import { normalizeInscricao, isChaveAcesso } from "./inscricao";
import type { NfseEmissaoRow } from "../../types";
import { loadClientCertContext } from "./cert";
import { buildDpsXml, type DpsTomador } from "./dps";
import { signDps } from "./sign";
import { validateDps } from "./validate";
import { emitirNfse as postNfse, type Ambiente } from "./client";
import { getConvenio, getAliquotaParametrizada } from "./params";
import { parseNfseXml } from "./nfseXml";
import { reconcileEmissao, pendingEmissoes } from "./reconcile";
import { nfseLog } from "./log";
import { NfseError, notConfigured } from "./errors";

// Orquestra a emissão: carrega certificado + config + atividade, monta, valida e
// assina a DPS, envia à Sefin Nacional (POST /nfse — síncrono, sucesso = 201) e
// persiste o resultado em nfse_emissoes:
//   'emitida'      — 201 com a NFS-e no corpo, chave de 50 posições e cStat 100
//   'processando'  — envio ambíguo (timeout / rede / HTTP 500 / 201 sem NFS-e);
//                    reconciliado depois por GET /dps/{id} + GET /nfse/{chave}
//   'rejeitada'    — 400 (regra de negócio / esquema) ou certificado inválido
// Nunca reenvia a DPS automaticamente.

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

const REG_ESP_TRIB_DEFAULT = "0";

function competenciaAtual(now = new Date()): string {
  return `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
}

// Alíquota do ISSQN a declarar. Para município conveniado ao Sistema Nacional a
// alíquota é parametrizada pelo município — usamos a da API. Só quando não há
// parametrização (ou a consulta falha) caímos na alíquota configurada pelo
// contador. Best-effort: nunca bloqueia a emissão.
async function resolverAliquota(
  agent: import("https").Agent,
  ambiente: Ambiente,
  codigoMunicipio: string,
  codServico: string,
  competencia: string,
  fallbackPct: number,
): Promise<number> {
  const cod = String(codigoMunicipio || "").replace(/\D/g, "");
  if (cod.length !== 7) return fallbackPct;
  try {
    const conv = await getConvenio(agent, ambiente, cod);
    if (!conv.aderente) return fallbackPct;
    const iso = `${competencia.slice(3)}-${competencia.slice(0, 2)}-01`;
    const param = await getAliquotaParametrizada(agent, ambiente, cod, codServico, iso);
    if (param != null && Number.isFinite(param)) return param;
  } catch (e) {
    nfseLog("warn", "aliquota.param_falhou", {
      municipio: cod,
      msg: e instanceof Error ? e.message : String(e),
    });
  }
  return fallbackPct;
}

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
  const competencia =
    input.competencia && /^\d{2}\/\d{4}$/.test(input.competencia)
      ? input.competencia
      : competenciaAtual();
  const tomadorDoc = normalizeInscricao(input.tomador.doc);

  // --- dedupe: uma emissão 'processando' recente com os mesmos dados pode ser
  // uma tentativa anterior que o Sefin de fato processou. Reconcilia antes de
  // gerar um novo número.
  for (const p of await pendingEmissoes(clientId)) {
    if (
      p.atividadeId === atividade.id &&
      (p.tomadorDoc || "") === tomadorDoc &&
      p.valorServicos === input.valor &&
      p.competencia === competencia
    ) {
      const r = await reconcileEmissao(clientId, p.id);
      if (r.status === "emitida") return r;
      if (r.status === "processando") {
        throw new NfseError(
          "A emissão anterior desta nota ainda está em processamento no Sefin Nacional. Aguarde alguns instantes e verifique em “Notas emitidas”.",
          { status: 409, reason: "processando" },
        );
      }
      // 'rejeitada' → segue para uma nova emissão
    }
  }

  const cert = await loadClientCertContext(clientId);

  // Consome o próximo número de DPS de forma atômica.
  const [bumped] = await db
    .update(nfseConfig)
    .set({ proxNumeroDps: sql`${nfseConfig.proxNumeroDps} + 1`, updatedAt: new Date() })
    .where(eq(nfseConfig.clientId, clientId))
    .returning({ prox: nfseConfig.proxNumeroDps });
  if (!bumped) throw new NfseError("Falha ao reservar o número da DPS.", { status: 500 });
  const numeroDps = bumped.prox - 1;
  const serie = config.serieDps || "00001";

  const codServico =
    (atividade.codTributacaoNac || "").replace(/\D/g, "") ||
    (atividade.itemListaServico || "").replace(/\D/g, "");
  const aliquotaIss = await resolverAliquota(
    cert.agent,
    ambiente,
    String(config.codigoMunicipio || ""),
    codServico,
    competencia,
    atividade.aliquotaIss || 0,
  );

  const dhEmi = new Date();
  const built = buildDpsXml({
    ambiente,
    serie,
    numero: numeroDps,
    competencia,
    dhEmi,
    cLocEmi: String(config.codigoMunicipio || ""),
    prestador: {
      cnpj: normalizeInscricao(client.cnpj),
      inscricaoMunicipal: null,
      nome: client.name,
      regimeTributario: (config.regimeTributario as any) || "simples_nacional",
      regEspTrib: config.regimeEspecialTrib || REG_ESP_TRIB_DEFAULT,
    },
    tomador: {
      doc: tomadorDoc,
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
      aliquotaIss,
      issRetido: atividade.issRetido,
      exigibilidadeIss: atividade.exigibilidadeIss || "1",
      retIrrf: atividade.retIrrf,
      retCsll: atividade.retCsll,
      retInss: atividade.retInss,
    },
  });

  const valorIss = Math.round((aliquotaIss / 100) * input.valor);
  const baseRow = {
    clientId,
    atividadeId: atividade.id,
    ambiente,
    competencia,
    valorServicos: input.valor,
    aliquotaIss,
    valorIss,
    descricao: input.descricao,
    tomadorDoc,
    tomadorNome: input.tomador.nome,
    tomadorEmail: input.tomador.email || null,
    tomadorTelefone: input.tomador.telefone || null,
    tomadorEndereco: (input.tomador.endereco ?? null) as any,
    serieDps: serie,
    numeroDps,
    idDps: built.idDps,
    dataEmissao: dhEmi,
    updatedAt: new Date(),
  };

  // Validação estrutural + assinatura + revalidação com a assinatura.
  let dpsAssinada: string;
  try {
    validateDps(built.xml);
    dpsAssinada = signDps(built.xml, built.idDps, cert.parsed.keyPem, cert.parsed.certPem);
    validateDps(dpsAssinada, { requireSignature: true });
  } catch (e) {
    const err = e instanceof NfseError ? e : new NfseError(String((e as any)?.message || e), { status: 500 });
    await db.insert(nfseEmissoes).values({
      ...baseRow,
      status: "rejeitada",
      xmlDps: built.xml,
      rejeicaoMotivo: err.motivo || err.message,
      erroMsg: err.message,
    });
    nfseLog("error", "dps.invalida", { idDps: built.idDps, ambiente, reason: err.reason, msg: err.message });
    throw err;
  }

  const rowBase = { ...baseRow, xmlDps: dpsAssinada };
  const started = Date.now();

  try {
    const result = await postNfse(cert.agent, ambiente, dpsAssinada);
    const info = parseNfseXml(result.nfseXml);
    const chave = (result.chaveAcesso || info.chaveAcesso || "").toUpperCase();
    const usable =
      !!result.nfseXml && isChaveAcesso(chave) && (info.cStat == null || info.cStat === "100");

    if (usable) {
      const [row] = await db
        .insert(nfseEmissoes)
        .values({
          ...rowBase,
          status: "emitida",
          chaveAcesso: chave,
          numeroNota: info.numeroNota,
          xmlNfse: result.nfseXml,
          alertas: (result.alertas.length ? result.alertas : null) as any,
          versaoAplicativo: result.versaoAplicativo,
          sefinProcessadoEm: result.processadoEm ? new Date(result.processadoEm) : null,
        })
        .returning();
      nfseLog("info", "emissao.emitida", {
        idDps: built.idDps,
        ambiente,
        chave,
        nNFSe: info.numeroNota,
        alertas: result.alertas.length,
        ms: Date.now() - started,
      });
      return row;
    }

    // 201 sem NFS-e utilizável → anomalia; reconcilia depois.
    const [row] = await db
      .insert(nfseEmissoes)
      .values({
        ...rowBase,
        status: "processando",
        alertas: (result.alertas.length ? result.alertas : null) as any,
        versaoAplicativo: result.versaoAplicativo,
        erroMsg: "Sefin retornou 201 sem a NFS-e utilizável — em reconciliação.",
      })
      .returning();
    nfseLog("warn", "emissao.anomalia_201", {
      idDps: built.idDps,
      ambiente,
      httpStatus: result.status,
      temXml: !!result.nfseXml,
      chaveValida: isChaveAcesso(chave),
    });
    return row;
  } catch (e) {
    const err = e instanceof NfseError ? e : new NfseError(String((e as any)?.message || e), { status: 502 });

    // Rejeição definitiva (regra de negócio / esquema) ou certificado de
    // transmissão inválido: persiste 'rejeitada' e propaga.
    if (err.reason === "rejeitada" || err.reason === "cert_transmissao" || err.status === 422) {
      await db.insert(nfseEmissoes).values({
        ...rowBase,
        status: "rejeitada",
        rejeicaoCodigo: err.codigo || null,
        rejeicaoMotivo: err.motivo || err.message,
        erroMsg: err.message,
      });
      nfseLog("warn", "emissao.rejeitada", {
        idDps: built.idDps,
        ambiente,
        reason: err.reason,
        codigo: err.codigo,
      });
      throw err;
    }

    // Ambíguo (timeout / rede / HTTP 500): a NFS-e pode ter sido gerada.
    // Persiste 'processando' e sinaliza ao chamador (HTTP 202).
    const [row] = await db
      .insert(nfseEmissoes)
      .values({
        ...rowBase,
        status: "processando",
        erroMsg: err.message,
      })
      .returning();
    nfseLog("warn", "emissao.processando", {
      idDps: built.idDps,
      ambiente,
      reason: err.reason,
      ms: Date.now() - started,
    });
    throw new NfseError(
      "A DPS foi enviada, mas o Sefin Nacional ainda não confirmou. A nota aparecerá em “Notas emitidas” assim que for confirmada — não reemita.",
      { status: 202, reason: "processando", codigo: row.id },
    );
  }
}
