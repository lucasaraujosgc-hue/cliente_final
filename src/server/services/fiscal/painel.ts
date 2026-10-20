import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { clients, fiscalNotificacoes, fiscalPerfil, fiscalSitfis, fiscalStatus, parcelamentos } from "../../schema";
import { LIMITE_MES, usoDoMes } from "./integra";
import { sitfisRodando, ultimaExecucao } from "./monitor";
import { PROCESSO_ROTULO, PROCESSOS, piorSituacao, type Processo, type Situacao } from "./regras";

// Dados da tela "Pendências fiscais" — só leitura do banco, nenhuma chamada ao
// SERPRO.

const vazio = (): Record<Situacao, number> => ({ em_dia: 0, pendente: 0, atencao: 0, processando: 0 });

/** Última tentativa de relatório de cada cliente (com sucesso ou não). */
async function ultimosSitfis(somenteOk: boolean) {
  const q = db
    .selectDistinctOn([fiscalSitfis.clientId], {
      clientId: fiscalSitfis.clientId,
      ok: fiscalSitfis.ok,
      erro: fiscalSitfis.erro,
      createdAt: fiscalSitfis.createdAt,
      temPdf: fiscalSitfis.pdfPath,
    })
    .from(fiscalSitfis);
  const rows = await (somenteOk ? q.where(eq(fiscalSitfis.ok, true)) : q).orderBy(fiscalSitfis.clientId, desc(fiscalSitfis.createdAt));
  return new Map(rows.map((r) => [r.clientId, r]));
}

export async function montarPainel() {
  const lista = await db.select({ id: clients.id, name: clients.name, cnpj: clients.cnpj }).from(clients);
  const status = await db.select().from(fiscalStatus);
  const perfis = await db.select().from(fiscalPerfil);
  const parcs = await db.select({ clientId: parcelamentos.clientId }).from(parcelamentos);
  const sitfisOk = await ultimosSitfis(true);
  const sitfisUltimo = await ultimosSitfis(false);

  const porCliente = new Map<string, typeof status>();
  for (const s of status) {
    const arr = porCliente.get(s.clientId) ?? [];
    arr.push(s);
    porCliente.set(s.clientId, arr);
  }

  const resumo = vazio();
  const porProcesso: Record<string, Record<Situacao, number>> = {};
  for (const p of PROCESSOS) porProcesso[p] = vazio();
  // Omissões de declaração por tipo (PGDAS-D, DCTFWeb, DEFIS…), segundo o
  // último relatório de cada cliente.
  const omissoes: Record<string, number> = {};
  let semOmissao = 0;
  const totais = { debitos: 0, dividaAtiva: 0 };

  const clientes = lista
    .map((c) => {
      const linhas = porCliente.get(c.id) ?? [];
      const processos: Partial<Record<Processo, { status: Situacao; resumo: string; competencia: string | null; fonte: string; verificadoEm: Date; detalhes: unknown }>> = {};
      for (const l of linhas) {
        const p = l.processo as Processo;
        if (!PROCESSOS.includes(p)) continue; // código da versão anterior, ainda não reavaliado
        processos[p] = { status: l.status as Situacao, resumo: l.resumo, competencia: l.competencia, fonte: l.fonte, verificadoEm: l.verificadoEm, detalhes: l.detalhes };
        porProcesso[p][l.status as Situacao]++;
        const det = (l.detalhes ?? {}) as { declaracoes?: string[]; total?: number };
        if (p === "OMISSOES") {
          if (l.status === "em_dia") semOmissao++;
          for (const d of new Set(det.declaracoes ?? [])) omissoes[d] = (omissoes[d] ?? 0) + 1;
        }
        if (p === "DEBITOS" && typeof det.total === "number") totais.debitos += det.total;
        if (p === "DIVIDA_ATIVA" && typeof det.total === "number") totais.dividaAtiva += det.total;
      }
      const situacoes = Object.values(processos).map((x) => x!.status);
      const geral: Situacao = situacoes.length ? piorSituacao(situacoes) : "processando";
      if (situacoes.length) resumo[geral]++;
      const perfil = perfis.find((p) => p.clientId === c.id);
      const ok = sitfisOk.get(c.id);
      const ultimo = sitfisUltimo.get(c.id);
      return {
        id: c.id,
        nome: c.name,
        cnpj: c.cnpj,
        geral,
        monitorado: situacoes.length > 0,
        regime: perfil?.regime ?? null,
        processosManuais: Array.isArray(perfil?.processos),
        temParcelamento: parcs.some((p) => p.clientId === c.id),
        sitfis: {
          emitidoEm: ok?.createdAt ?? null,
          temPdf: !!ok?.temPdf,
          // Última tentativa falhou depois do último relatório bom.
          erro: ultimo && !ultimo.ok ? ultimo.erro : null,
        },
        processos,
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const notificacoes = await db
    .select({
      id: fiscalNotificacoes.id,
      clientId: fiscalNotificacoes.clientId,
      processo: fiscalNotificacoes.processo,
      titulo: fiscalNotificacoes.titulo,
      descricao: fiscalNotificacoes.descricao,
      lida: fiscalNotificacoes.lida,
      createdAt: fiscalNotificacoes.createdAt,
      cliente: clients.name,
    })
    .from(fiscalNotificacoes)
    .innerJoin(clients, eq(clients.id, fiscalNotificacoes.clientId))
    .orderBy(desc(fiscalNotificacoes.createdAt))
    .limit(60);

  const rotina = await ultimaExecucao("rotina_diaria");
  const semanal = await ultimaExecucao("sitfis_semanal");
  return {
    resumo: { ...resumo, total: clientes.filter((c) => c.monitorado).length },
    porProcesso: PROCESSOS.map((p) => ({ processo: p, rotulo: PROCESSO_ROTULO[p], ...porProcesso[p] })),
    omissoes: {
      porDeclaracao: Object.entries(omissoes)
        .map(([declaracao, clientes]) => ({ declaracao, clientes }))
        .sort((a, b) => b.clientes - a.clientes),
      semOmissao,
    },
    totais,
    clientes,
    notificacoes,
    uso: { mes: await usoDoMes(), limite: LIMITE_MES },
    ultimaRotina: rotina ? { executadoEm: rotina.executadoEm, resultado: rotina.resultado } : null,
    ultimoSitfisTodos: semanal ? { executadoEm: semanal.executadoEm, resultado: semanal.resultado } : null,
    sitfisEmAndamento: sitfisRodando(),
  };
}
