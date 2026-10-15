import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { clients, fiscalNotificacoes, fiscalPerfil, fiscalStatus, parcelamentos } from "../../schema";
import { LIMITE_MES, usoDoMes } from "./integra";
import { ultimaRotina } from "./monitor";
import { PROCESSO_ROTULO, PROCESSOS, piorSituacao, type Processo, type Situacao } from "./regras";

// Dados da tela "Pendências fiscais" — só leitura do banco, nenhuma chamada ao
// SERPRO.

const vazio = (): Record<Situacao, number> => ({ em_dia: 0, pendente: 0, atencao: 0, processando: 0 });

export async function montarPainel() {
  const lista = await db.select({ id: clients.id, name: clients.name, cnpj: clients.cnpj }).from(clients);
  const status = await db.select().from(fiscalStatus);
  const perfis = await db.select().from(fiscalPerfil);
  const parcs = await db.select({ clientId: parcelamentos.clientId }).from(parcelamentos);

  const porCliente = new Map<string, typeof status>();
  for (const s of status) {
    const arr = porCliente.get(s.clientId) ?? [];
    arr.push(s);
    porCliente.set(s.clientId, arr);
  }

  const resumo = vazio();
  const porProcesso: Record<string, Record<Situacao, number>> = {};
  for (const p of PROCESSOS) porProcesso[p] = vazio();
  const ausencias = { PGDASD: { ausentes: 0, entregues: 0 }, DCTFWEB: { ausentes: 0, entregues: 0 } };

  const clientes = lista
    .map((c) => {
      const linhas = porCliente.get(c.id) ?? [];
      const processos: Partial<Record<Processo, { status: Situacao; resumo: string; competencia: string | null; fonte: string; verificadoEm: Date; detalhes: unknown }>> = {};
      for (const l of linhas) {
        const p = l.processo as Processo;
        processos[p] = { status: l.status as Situacao, resumo: l.resumo, competencia: l.competencia, fonte: l.fonte, verificadoEm: l.verificadoEm, detalhes: l.detalhes };
        if (porProcesso[p]) porProcesso[p][l.status as Situacao]++;
        if (p === "PGDASD" || p === "DCTFWEB") {
          if (/não transmitid/i.test(l.resumo)) ausencias[p].ausentes++;
          else ausencias[p].entregues++;
        }
      }
      const geral: Situacao = linhas.length ? piorSituacao(linhas.map((l) => l.status as Situacao)) : "processando";
      if (linhas.length) resumo[geral]++;
      const perfil = perfis.find((p) => p.clientId === c.id);
      return {
        id: c.id,
        nome: c.name,
        cnpj: c.cnpj,
        geral,
        monitorado: linhas.length > 0,
        regime: perfil?.regime ?? null,
        processosManuais: Array.isArray(perfil?.processos),
        temParcelamento: parcs.some((p) => p.clientId === c.id),
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

  const rotina = await ultimaRotina();
  return {
    resumo: { ...resumo, total: clientes.filter((c) => c.monitorado).length },
    porProcesso: PROCESSOS.map((p) => ({ processo: p, rotulo: PROCESSO_ROTULO[p], ...porProcesso[p] })),
    ausencias,
    clientes,
    notificacoes,
    uso: { mes: await usoDoMes(), limite: LIMITE_MES },
    ultimaRotina: rotina ? { executadoEm: rotina.executadoEm, resultado: rotina.resultado } : null,
  };
}
