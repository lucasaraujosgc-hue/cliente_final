import { and, eq, gte, notInArray } from "drizzle-orm";
import { db } from "../../db";
import {
  clients,
  documents,
  fiscalEventos,
  fiscalExecucoes,
  fiscalNotificacoes,
  fiscalPerfil,
  fiscalStatus,
  parcelamentos,
} from "../../schema";
import { chamarIntegra, LimiteSerproError } from "./integra";
import { emitirSitfis, ultimoSitfisOk } from "./sitfis";
import type { SitfisResultado } from "./sitfisParser";
import {
  AGENDA_PADRAO,
  avaliarFgts,
  avaliarSitfis,
  competenciaDeAAAAMM,
  compararCompetencia,
  diaDeSitfis,
  ehFgts,
  EVENTOS,
  eventosDoDia,
  inferirProcessos,
  lerElementos,
  lerListaNumeros,
  normalizarProcessos,
  piorou,
  PROCESSO_ROTULO,
  type Avaliacao,
  type CodigoEvento,
  type Processo,
  type Situacao,
} from "./regras";

// Monitor do painel de pendências fiscais. Custo no Integra Contador:
//   - Relatório de Situação Fiscal (SITFIS): 2 chamadas por cliente, 1×/semana
//     (segunda) — é a fonte das omissões, débitos, parcelamentos e dívida ativa;
//   - Caixa Postal: evento de atualização (2 chamadas para TODOS os clientes),
//     2×/semana, + 1 consulta de mensagens por cliente com mensagem nova ou que
//     ainda tinha mensagem não lida (para saber se já foi lida);
//   - FGTS e a avaliação diária usam só as guias do portal (sem custo).
// Tudo passa por integra.ts (limite mensal + registro em serpro_uso).

const AGENDA = {
  sitfisDiasSemana: lerListaNumeros(process.env.FISCAL_SITFIS_DIAS, 0, 6) ?? AGENDA_PADRAO.sitfisDiasSemana,
  caixaPostalDiasSemana: lerListaNumeros(process.env.FISCAL_CAIXAPOSTAL_DIAS, 0, 6) ?? AGENDA_PADRAO.caixaPostalDiasSemana,
};

function log(evento: string, campos: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), scope: "fiscal", evento, ...campos }));
}

const somenteDigitos = (v: string) => String(v || "").replace(/\D/g, "");

async function notificar(clientId: string, processo: Processo, titulo: string, descricao: string) {
  await db.insert(fiscalNotificacoes).values({ clientId, processo, titulo, descricao });
}

async function salvarStatus(clientId: string, processo: Processo, a: Avaliacao, fonte: "portal" | "serpro" | "manual") {
  const values = {
    clientId,
    processo,
    competencia: a.competencia ?? null,
    status: a.status,
    resumo: a.resumo,
    detalhes: (a.detalhes ?? null) as any,
    fonte,
    verificadoEm: new Date(),
  };
  await db
    .insert(fiscalStatus)
    .values(values)
    .onConflictDoUpdate({ target: [fiscalStatus.clientId, fiscalStatus.processo], set: values });
}

export async function processosDoCliente(clientId: string, hoje = new Date()): Promise<Processo[]> {
  const [perfil] = await db.select().from(fiscalPerfil).where(eq(fiscalPerfil.clientId, clientId));
  if (Array.isArray(perfil?.processos)) return normalizarProcessos(perfil!.processos as unknown[]);
  const docs = await db
    .select({ category: documents.category, createdAt: documents.createdAt, status: documents.status })
    .from(documents)
    .where(and(eq(documents.clientId, clientId), eq(documents.uploadedBy, "accountant")));
  return inferirProcessos(docs, hoje);
}

// --- parcelamentos do Simples (consulta manual) ---------------------------------

const MODALIDADES_SN: { modalidade: string; pedidos: string; obter: string }[] = [
  { modalidade: "PARCSN", pedidos: "PEDIDOSPARC163", obter: "OBTERPARC164" },
  { modalidade: "PARCSN-ESP", pedidos: "PEDIDOSPARC173", obter: "OBTERPARC174" },
  { modalidade: "PERTSN", pedidos: "PEDIDOSPARC183", obter: "OBTERPARC184" },
  { modalidade: "RELPSN", pedidos: "PEDIDOSPARC193", obter: "OBTERPARC194" },
];

async function atualizarParcelamentoSn(row: typeof parcelamentos.$inferSelect, cnpj: string, origem: "automatico" | "manual") {
  const mod = MODALIDADES_SN.find((m) => m.modalidade === row.modalidade);
  if (!mod) return;
  const r = await chamarIntegra({
    rota: "Consultar",
    idSistema: mod.modalidade,
    idServico: mod.obter,
    contribuinte: { numero: cnpj, tipo: 2 },
    dados: { numeroParcelamento: Number(row.numero) },
    clientId: row.clientId,
    origem,
  });
  if (!r.ok) {
    log("parcelamento.erro", { id: row.id, httpStatus: r.httpStatus, corpo: r.texto.slice(0, 500) });
    return;
  }
  const p = r.dados?.parcelamento ?? r.dados ?? {};
  const pagos: string[] = (p.demonstrativoPagamentos ?? [])
    .filter((d: any) => d?.dataDeArrecadacao)
    .map((d: any) => competenciaDeAAAAMM(d?.mesDaParcela))
    .filter(Boolean)
    .sort(compararCompetencia);
  const alteracao = Array.isArray(p.alteracoesDivida) && p.alteracoesDivida.length ? p.alteracoesDivida[p.alteracoesDivida.length - 1] : null;
  await db
    .update(parcelamentos)
    .set({
      situacao: p.situacao ?? row.situacao,
      ultimoPagamento: pagos.length ? pagos[pagos.length - 1] : row.ultimoPagamento,
      valorParcela: Number(alteracao?.parcelaBasica ?? p.consolidacaoOriginal?.parcelaBasica) || row.valorParcela,
      parcelasTotal: Number(p.consolidacaoOriginal?.quantidadeParcelas) || row.parcelasTotal,
      detalhes: { ...(row.detalhes as any), verificadoEm: new Date().toISOString(), parcelasRemanescentes: alteracao?.parcelasRemanescentes ?? null },
      updatedAt: new Date(),
    })
    .where(eq(parcelamentos.id, row.id));
}

/** Descobre os parcelamentos do Simples do cliente (4 chamadas) e atualiza os ativos. */
export async function buscarParcelamentosSerpro(clientId: string, origem: "automatico" | "manual" = "manual") {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) throw Object.assign(new Error("Cliente não encontrado."), { status: 404 });
  const cnpj = somenteDigitos(client.cnpj);
  let encontrados = 0;
  let semProcuracao = false;
  for (const mod of MODALIDADES_SN) {
    const r = await chamarIntegra({
      rota: "Consultar",
      idSistema: mod.modalidade,
      idServico: mod.pedidos,
      contribuinte: { numero: cnpj, tipo: 2 },
      dados: "",
      clientId,
      origem,
    });
    if (r.semProcuracao) semProcuracao = true;
    if (!r.ok) continue;
    for (const p of r.dados?.parcelamentos ?? []) {
      if (p?.numero == null) continue;
      encontrados++;
      const values = {
        clientId,
        modalidade: mod.modalidade,
        numero: String(p.numero),
        situacao: p.situacao ?? null,
        origem: "serpro",
        ativo: !/rescindid|cancelad|encerrad|liquidad|indeferid/i.test(String(p.situacao || "")),
        detalhes: { dataDoPedido: p.dataDoPedido ?? null, dataDaSituacao: p.dataDaSituacao ?? null } as any,
        updatedAt: new Date(),
      };
      await db
        .insert(parcelamentos)
        .values(values)
        .onConflictDoUpdate({
          target: [parcelamentos.clientId, parcelamentos.modalidade, parcelamentos.numero],
          set: { situacao: values.situacao, ativo: values.ativo, updatedAt: values.updatedAt },
        });
    }
  }
  const ativos = await db
    .select()
    .from(parcelamentos)
    .where(and(eq(parcelamentos.clientId, clientId), eq(parcelamentos.origem, "serpro"), eq(parcelamentos.ativo, true)));
  for (const row of ativos) await atualizarParcelamentoSn(row, cnpj, origem);
  return { encontrados, semProcuracao };
}

// --- avaliação por cliente (sem custo: lê o que já está no banco) ---------------

export async function avaliarCliente(clientId: string, hoje = new Date()) {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) return;
  const processos = await processosDoCliente(clientId, hoje);
  const atuais = await db.select().from(fiscalStatus).where(eq(fiscalStatus.clientId, clientId));
  const antes = (p: Processo) => atuais.find((s) => s.processo === p)?.status as Situacao | undefined;
  const novos: [Processo, Avaliacao, "portal" | "serpro" | "manual"][] = [];

  // Relatório de situação fiscal (último emitido com sucesso).
  const sitfis = await ultimoSitfisOk(clientId);
  const emitidoEm = sitfis?.createdAt ? new Date(sitfis.createdAt).toLocaleDateString("pt-BR") : null;
  const porSitfis = avaliarSitfis((sitfis?.resultado as SitfisResultado | null) ?? null, emitidoEm);
  for (const p of ["OMISSOES", "DEBITOS", "PARCELAMENTOS", "DIVIDA_ATIVA"] as const) {
    if (processos.includes(p)) novos.push([p, porSitfis[p], "serpro"]);
  }

  // FGTS: guias do portal (último ano) conforme o cliente ou o contador marcam
  // como pagas.
  if (processos.includes("FGTS")) {
    const desde = new Date(hoje.getFullYear() - 1, hoje.getMonth(), 1);
    const docs = await db
      .select()
      .from(documents)
      .where(and(eq(documents.clientId, clientId), gte(documents.createdAt, desde)));
    novos.push(["FGTS", avaliarFgts(docs, hoje), "portal"]);
  }

  // Caixa Postal só fica no painel para quem tem mensagem não lida (quem a
  // mantém é o evento E0601; aqui só limpa o que sobrou de versões anteriores:
  // "em dia", "processando", "sem procuração").
  const cp = atuais.find((s) => s.processo === "CAIXAPOSTAL");
  if (cp && !((cp.detalhes as { mensagens?: unknown[] } | null)?.mensagens?.length)) {
    await db.delete(fiscalStatus).where(eq(fiscalStatus.id, cp.id));
  }

  for (const [p, a, fonte] of novos) {
    await salvarStatus(clientId, p, a, fonte);
    // Avisa só quando aparece pendência onde estava em dia.
    if (piorou(antes(p), a.status)) await notificar(clientId, p, `Nova pendência — ${PROCESSO_ROTULO[p]}`, a.resumo);
  }

  // Processo que deixou de se aplicar sai do painel.
  await db.delete(fiscalStatus).where(and(eq(fiscalStatus.clientId, clientId), notInArray(fiscalStatus.processo, processos)));
}

/**
 * Guia marcada (ou desmarcada) como paga pelo cliente ou pelo contador: se for
 * de FGTS, atualiza o painel na hora (sem SERPRO).
 */
export function aoMudarPagamento(doc: { clientId: string; category?: string | null } | null | undefined) {
  if (!doc || !ehFgts(doc)) return;
  void avaliarCliente(doc.clientId).catch((e) => log("fgts.reavaliar_erro", { msg: e instanceof Error ? e.message : String(e) }));
}

/** Emite o relatório de situação fiscal do cliente (2 consultas) e reavalia. */
export async function atualizarSitfisCliente(clientId: string, origem: "automatico" | "manual") {
  const r = await emitirSitfis(clientId, origem);
  await avaliarCliente(clientId);
  return r;
}

// --- Caixa Postal (evento de atualização) ----------------------------------------

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function obterEventos(cnpjs: string[], ev: CodigoEvento, origem: "automatico" | "manual"): Promise<Map<string, string> | null> {
  const sol = await chamarIntegra({
    rota: "Monitorar",
    idSistema: "EVENTOSATUALIZACAO",
    idServico: "SOLICEVENTOSPJ132",
    contribuinte: { numero: cnpjs.join(","), tipo: 4 },
    dados: { evento: ev },
    origem,
  });
  const protocolo = sol.dados?.protocolo;
  if (!sol.ok || !protocolo) {
    log("eventos.solicitar_erro", { evento: ev, httpStatus: sol.httpStatus, corpo: sol.texto.slice(0, 500) });
    return null;
  }
  const tempo = Number(sol.dados?.TempoEsperaMedioEmMs ?? sol.dados?.tempoEsperaMedioEmMs) || 3000;
  await espera(Math.max(tempo, 3000) + 2000);
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const r = await chamarIntegra({
      rota: "Monitorar",
      idSistema: "EVENTOSATUALIZACAO",
      idServico: "OBTEREVENTOSPJ134",
      contribuinte: { numero: "", tipo: 4 },
      dados: { protocolo, evento: ev },
      origem,
    });
    const elementos = r.dados?.elementos ?? r.dados?.dados?.elementos;
    if (r.ok && Array.isArray(elementos)) return lerElementos(elementos);
    log("eventos.obter_aguardando", { evento: ev, httpStatus: r.httpStatus, corpo: r.texto.slice(0, 300) });
    await espera(5000);
  }
  return null;
}

const removerCaixaPostal = (clientId: string) =>
  db.delete(fiscalStatus).where(and(eq(fiscalStatus.clientId, clientId), eq(fiscalStatus.processo, "CAIXAPOSTAL")));

/** Mensagens não lidas (1 consulta). Sem nenhuma, o cliente sai da Caixa Postal do painel. */
async function atualizarCaixaPostal(clientId: string, cnpj: string, origem: "automatico" | "manual") {
  const r = await chamarIntegra({
    rota: "Consultar",
    idSistema: "CAIXAPOSTAL",
    idServico: "MSGCONTRIBUINTE61",
    contribuinte: { numero: cnpj, tipo: 2 },
    dados: { statusLeitura: "2", indicadorPagina: "0" },
    clientId,
    origem,
  });
  if (!r.ok) {
    log("caixapostal.erro", { clientId, httpStatus: r.httpStatus, corpo: r.texto.slice(0, 500) });
    return;
  }
  const lista: any[] = r.dados?.listaMensagens ?? [];
  if (!lista.length) {
    await removerCaixaPostal(clientId);
    return;
  }
  const [antes] = await db
    .select()
    .from(fiscalStatus)
    .where(and(eq(fiscalStatus.clientId, clientId), eq(fiscalStatus.processo, "CAIXAPOSTAL")));
  const totalAntes = Number((antes?.detalhes as { total?: number } | null)?.total) || 0;
  const assunto = (m: any) =>
    String(m?.assuntoModelo || "Mensagem").replace("++VARIAVEL++", String(m?.valorParametroAssunto || "")).trim();
  const relevantes = lista.filter((m) => Number(m?.relevancia) === 2);
  await salvarStatus(
    clientId,
    "CAIXAPOSTAL",
    {
      status: relevantes.length ? "atencao" : "pendente",
      resumo: `${lista.length} mensagem(ns) não lida(s)${relevantes.length ? `, ${relevantes.length} relevante(s)` : ""}`,
      detalhes: {
        total: lista.length,
        mensagens: lista.slice(0, 10).map((m) => ({ assunto: assunto(m), data: m?.dataEnvio, relevante: Number(m?.relevancia) === 2, origem: m?.descricaoOrigem ?? null })),
      },
    },
    "serpro",
  );
  // Avisa só quando chegou mensagem nova (não a cada nova conferência).
  if (lista.length > totalAntes) {
    await notificar(clientId, "CAIXAPOSTAL", "Caixa Postal — mensagem não lida", lista.slice(0, 3).map(assunto).join(" · "));
  }
}

/** Evento da Caixa Postal (solicitar + obter) para todos os clientes de uma vez. */
export async function rodarEventos(origem: "automatico" | "manual" = "automatico", quais: CodigoEvento[] = EVENTOS) {
  const todos = await db.select({ id: clients.id, cnpj: clients.cnpj }).from(clients);
  const porCnpj = new Map(todos.map((c) => [somenteDigitos(c.cnpj), c.id]).filter(([cnpj]) => cnpj.length === 14) as [string, string][]);
  const cnpjs = [...porCnpj.keys()].slice(0, 1000);
  if (!cnpjs.length) return { clientes: 0, mudancas: 0 };

  const cnpjDe = new Map([...porCnpj].map(([cnpj, id]) => [id, cnpj]));
  const afetados = new Set<string>();
  let mudancas = 0;
  for (const ev of quais) {
    const valores = await obterEventos(cnpjs, ev, origem);
    if (!valores) continue;
    const anteriores = await db.select().from(fiscalEventos).where(eq(fiscalEventos.evento, ev));
    for (const [cnpj, valor] of valores) {
      const clientId = porCnpj.get(cnpj);
      if (!clientId) continue;
      const prev = anteriores.find((a) => a.clientId === clientId)?.ultimaData;
      if (prev === valor) {
        await db
          .update(fiscalEventos)
          .set({ verificadoEm: new Date() })
          .where(and(eq(fiscalEventos.clientId, clientId), eq(fiscalEventos.evento, ev)));
        continue;
      }
      mudancas++;
      afetados.add(clientId);
      await db
        .insert(fiscalEventos)
        .values({ clientId, evento: ev, ultimaData: valor })
        .onConflictDoUpdate({ target: [fiscalEventos.clientId, fiscalEventos.evento], set: { ultimaData: valor, verificadoEm: new Date() } });

      if (ev !== "E0601") continue;
      // "x" = sem procuração para a Caixa Postal; "" = nenhuma mensagem.
      // Nos dois casos o cliente não aparece na Caixa Postal do painel.
      if (valor === "x" || !valor) {
        if (valor === "x") log("caixapostal.sem_procuracao", { clientId });
        await removerCaixaPostal(clientId);
        continue;
      }
      // Mensagem nova (ou 1ª leitura): confere as não lidas (1 consulta).
      try {
        await atualizarCaixaPostal(clientId, cnpj, origem);
      } catch (e) {
        if (e instanceof LimiteSerproError) throw e;
      }
    }

    // Quem ainda tinha mensagem não lida: confere de novo se já foi lida
    // (ler no e-CAC não muda o evento) — 1 consulta por cliente nessa situação.
    if (ev === "E0601") {
      const comMensagem = await db
        .select({ clientId: fiscalStatus.clientId })
        .from(fiscalStatus)
        .where(eq(fiscalStatus.processo, "CAIXAPOSTAL"));
      for (const { clientId } of comMensagem) {
        const cnpj = cnpjDe.get(clientId);
        if (!cnpj || afetados.has(clientId)) continue;
        afetados.add(clientId);
        try {
          await atualizarCaixaPostal(clientId, cnpj, origem);
        } catch (e) {
          if (e instanceof LimiteSerproError) throw e;
        }
      }
    }
  }
  for (const clientId of afetados) await avaliarCliente(clientId);
  return { clientes: cnpjs.length, mudancas };
}

// --- relatório de todos os clientes -----------------------------------------------

let sitfisEmAndamento = false;
export const sitfisRodando = () => sitfisEmAndamento;

/** Emite o relatório de todos os clientes, um por vez (2 consultas cada). */
export async function rodarSitfisTodos(origem: "automatico" | "manual") {
  if (sitfisEmAndamento) return { emAndamento: true };
  sitfisEmAndamento = true;
  const resultado = { inicio: new Date().toISOString(), ok: 0, falhas: 0, total: 0 };
  try {
    const todos = await db.select({ id: clients.id }).from(clients);
    for (const c of todos) {
      const processos = await processosDoCliente(c.id);
      if (!processos.some((p) => ["OMISSOES", "DEBITOS", "PARCELAMENTOS", "DIVIDA_ATIVA"].includes(p))) continue;
      resultado.total++;
      const r = await atualizarSitfisCliente(c.id, origem);
      if (r.ok) resultado.ok++;
      else resultado.falhas++;
    }
  } catch (e) {
    (resultado as any).erro = e instanceof Error ? e.message : String(e);
    log("sitfis.todos_erro", { msg: (resultado as any).erro });
  } finally {
    sitfisEmAndamento = false;
  }
  await marcarExecucao("sitfis_semanal", resultado);
  return resultado;
}

// --- rotina diária --------------------------------------------------------------

// Data no fuso de Brasília (UTC-3, sem horário de verão desde 2019). Comparar
// pela data do servidor (UTC) faria a rotina rodar de novo depois das 21h BRT,
// quando já é o dia seguinte em UTC.
const diaBrt = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);

async function executadoHoje(chave: string): Promise<boolean> {
  const [r] = await db.select().from(fiscalExecucoes).where(eq(fiscalExecucoes.chave, chave));
  if (!r) return false;
  return diaBrt(new Date(r.executadoEm)) === diaBrt(new Date());
}

async function marcarExecucao(chave: string, resultado: unknown) {
  await db
    .insert(fiscalExecucoes)
    .values({ chave, resultado: resultado as any })
    .onConflictDoUpdate({ target: fiscalExecucoes.chave, set: { executadoEm: new Date(), resultado: resultado as any } });
}

export async function rodarRotinaDiaria(origem: "automatico" | "manual" = "automatico") {
  const resultado: Record<string, unknown> = { inicio: new Date().toISOString() };
  try {
    // "Verificar agora" lê a Caixa Postal na hora; a rotina segue a agenda.
    const jaLidos = new Set((await db.selectDistinct({ e: fiscalEventos.evento }).from(fiscalEventos)).map((r) => r.e));
    const quais = origem === "manual" ? EVENTOS : eventosDoDia(new Date(), jaLidos, AGENDA);
    resultado.eventos = quais.length ? await rodarEventos(origem, quais) : { clientes: 0, mudancas: 0 };

    // Segunda-feira: relatório de situação fiscal de todos.
    if (origem === "automatico" && diaDeSitfis(new Date(), AGENDA) && !(await executadoHoje("sitfis_semanal"))) {
      resultado.sitfis = await rodarSitfisTodos("automatico");
    }

    const todos = await db.select({ id: clients.id }).from(clients);
    for (const c of todos) await avaliarCliente(c.id);
    resultado.clientes = todos.length;
  } catch (e) {
    resultado.erro = e instanceof Error ? e.message : String(e);
    log("rotina.erro", { msg: resultado.erro });
  }
  await marcarExecucao("rotina_diaria", resultado);
  return resultado;
}

export async function ultimaExecucao(chave: "rotina_diaria" | "sitfis_semanal") {
  const [r] = await db.select().from(fiscalExecucoes).where(eq(fiscalExecucoes.chave, chave));
  return r ?? null;
}

// Liga a rotina: a cada hora confere se já rodou hoje depois das 7h (BRT).
// FISCAL_MONITOR=0 desliga (ex.: ambiente de teste, ou para não gastar).
const MONITOR_LIGADO = process.env.FISCAL_MONITOR !== "0" && process.env.NODE_ENV !== "test" && !process.env.VITEST;
if (MONITOR_LIGADO) {
  const HORA = Number(process.env.FISCAL_MONITOR_HORA) || 7;
  setInterval(async () => {
    try {
      const horaBrt = (new Date().getUTCHours() + 21) % 24;
      if (horaBrt < HORA || (await executadoHoje("rotina_diaria"))) return;
      await marcarExecucao("rotina_diaria", { inicio: new Date().toISOString(), emAndamento: true });
      await rodarRotinaDiaria("automatico");
    } catch (e) {
      log("rotina.falhou", { msg: e instanceof Error ? e.message : String(e) });
    }
  }, 60 * 60 * 1000).unref?.();
}
