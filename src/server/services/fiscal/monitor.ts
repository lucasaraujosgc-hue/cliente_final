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
import {
  aaaammDe,
  avaliarParcelamento,
  avaliarPorGuias,
  competenciaAnterior,
  competenciaDeAAAAMM,
  compararCompetencia,
  dataDoEvento,
  dctfwebTransmitidaPeloEvento,
  DIA_PRAZO,
  EVENTOS,
  AGENDA_PADRAO,
  eventosDoDia,
  lerListaNumeros,
  inferirProcessos,
  lerElementos,
  piorSituacao,
  prazoDa,
  type Avaliacao,
  type CodigoEvento,
  type Processo,
} from "./regras";

// Monitor do painel de pendências fiscais. Custo no Integra Contador:
//   - eventos (cada um = 2 chamadas p/ TODOS os clientes: solicitar+obter):
//     Caixa Postal 2×/semana e DCTFWeb 1×/mês (agenda em regras.ts) — ~20/mês;
//   - a avaliação diária pelas guias do portal não gasta nada;
//   - pontual: Caixa Postal só quando o evento E0601 muda; PGDAS-D/DCTFWeb só
//     quando venceu o prazo e não há guia no portal nem evento que responda
//     (no máximo uma consulta por competência a cada 5 dias);
//   - parcelamentos do Simples: 1 consulta por parcelamento ativo por mês.
// Tudo passa por integra.ts (limite mensal + registro em serpro_uso).

const RECONSULTA_DIAS = 5;

// Dias da agenda de eventos — ajustáveis sem mudar código.
const AGENDA = {
  caixaPostalDiasSemana: lerListaNumeros(process.env.FISCAL_CAIXAPOSTAL_DIAS, 0, 6) ?? AGENDA_PADRAO.caixaPostalDiasSemana,
  dctfwebDiasMes: lerListaNumeros(process.env.FISCAL_DCTFWEB_DIAS, 1, 31) ?? AGENDA_PADRAO.dctfwebDiasMes,
};
const PARCELAMENTO_RECONSULTA_DIAS = 25;

function log(evento: string, campos: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), scope: "fiscal", evento, ...campos }));
}

const somenteDigitos = (v: string) => String(v || "").replace(/\D/g, "");
const diasDesde = (d: unknown) => (d ? (Date.now() - new Date(d as any).getTime()) / 86_400_000 : Infinity);
const fmtEvento = (v: string) => {
  const d = dataDoEvento(v);
  return d ? d.toLocaleDateString("pt-BR") : v;
};

async function notificar(clientId: string, processo: Processo | "PAGAMENTOS", titulo: string, descricao: string) {
  await db.insert(fiscalNotificacoes).values({ clientId, processo, titulo, descricao });
}

async function salvarStatus(
  clientId: string,
  processo: Processo,
  a: Avaliacao,
  fonte: "portal" | "serpro" | "manual",
) {
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
  if (Array.isArray(perfil?.processos)) return perfil!.processos as Processo[];
  const ajustarAoRegime = (lista: Processo[]): Processo[] => {
    // PGDAS-D é só do Simples (ME/EPP): MEI, Presumido e Real não declaram —
    // consultar seria erro garantido e consulta paga à toa.
    if (perfil?.regime && perfil.regime !== "simples") return lista.filter((p) => p !== "PGDASD");
    if (perfil?.regime === "simples" && !lista.includes("PGDASD")) return ["PGDASD", ...lista];
    return lista;
  };
  const docs = await db
    .select({ category: documents.category, createdAt: documents.createdAt, status: documents.status })
    .from(documents)
    .where(and(eq(documents.clientId, clientId), eq(documents.uploadedBy, "accountant")));
  const [parc] = await db.select({ id: parcelamentos.id }).from(parcelamentos).where(eq(parcelamentos.clientId, clientId)).limit(1);
  return ajustarAoRegime(inferirProcessos(docs, hoje, !!parc));
}

// --- consultas pontuais ---------------------------------------------------------

async function consultarPgdas(clientId: string, cnpj: string, competencia: string, origem: "automatico" | "manual"): Promise<Avaliacao | null> {
  const r = await chamarIntegra({
    rota: "Consultar",
    idSistema: "PGDASD",
    idServico: "CONSDECLARACAO13",
    contribuinte: { numero: cnpj, tipo: 2 },
    dados: { periodoApuracao: aaaammDe(competencia) },
    clientId,
    origem,
  });
  const base = { competencia, detalhes: { serpro: { competencia, verificadoEm: new Date().toISOString() } } };
  if (r.semProcuracao) return { ...base, status: "atencao", resumo: "Sem procuração para consultar o PGDAS-D" };
  if (!r.ok) {
    log("pgdas.erro", { clientId, httpStatus: r.httpStatus, corpo: r.texto.slice(0, 500) });
    return null;
  }
  const ops: any[] = r.dados?.periodo?.operacoes ?? r.dados?.periodos?.[0]?.operacoes ?? [];
  const declarou = ops.some((o) => /declara/i.test(String(o?.tipoOperacao)));
  const pago = ops.some((o) => o?.indiceDas?.dasPago === true);
  const malha = ops.map((o) => o?.indiceDeclaracao?.malha).find(Boolean);
  if (!declarou) return { ...base, status: "atencao", resumo: `PGDAS-D de ${competencia} não transmitido` };
  if (malha) return { ...base, status: "atencao", resumo: `PGDAS-D de ${competencia}: ${malha}` };
  if (pago) return { ...base, status: "em_dia", resumo: `PGDAS-D de ${competencia} declarado e DAS pago` };
  return { ...base, status: "atencao", resumo: `PGDAS-D de ${competencia} declarado, DAS não pago` };
}

async function consultarDctfweb(clientId: string, cnpj: string, competencia: string, origem: "automatico" | "manual"): Promise<Avaliacao | null> {
  const [mm, yyyy] = competencia.split("/");
  const r = await chamarIntegra({
    rota: "Consultar",
    idSistema: "DCTFWEB",
    idServico: "CONSRECIBO32",
    contribuinte: { numero: cnpj, tipo: 2 },
    dados: { categoria: 40, anoPA: yyyy, mesPA: mm },
    clientId,
    origem,
  });
  const base = { competencia, detalhes: { serpro: { competencia, verificadoEm: new Date().toISOString() } } };
  if (r.semProcuracao) return { ...base, status: "atencao", resumo: "Sem procuração para consultar a DCTFWeb" };
  if (r.ok && (r.dados?.PDFByteArrayBase64 || /sucesso/i.test(JSON.stringify(r.mensagens)))) {
    return { ...base, status: "pendente", resumo: `DCTFWeb de ${competencia} transmitida — guia não publicada no portal` };
  }
  if (r.httpStatus >= 400 && r.httpStatus < 500) {
    return { ...base, status: "atencao", resumo: `DCTFWeb de ${competencia} não transmitida` };
  }
  log("dctfweb.erro", { clientId, httpStatus: r.httpStatus, corpo: r.texto.slice(0, 500) });
  return null;
}

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
  await avaliarCliente(clientId, { consultarSerpro: false, origem });
  return { encontrados, semProcuracao };
}

// --- avaliação por cliente ------------------------------------------------------

export interface OpcoesAvaliacao {
  consultarSerpro: boolean;
  origem: "automatico" | "manual";
  forcar?: boolean; // ignora o intervalo mínimo entre consultas
}

export async function avaliarCliente(clientId: string, opts: OpcoesAvaliacao, hoje = new Date()) {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) return;
  const cnpj = somenteDigitos(client.cnpj);
  const processos = await processosDoCliente(clientId, hoje);
  const competencia = competenciaAnterior(hoje);

  const desde = new Date(hoje.getFullYear(), hoje.getMonth() - 14, 1);
  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.clientId, clientId), eq(documents.uploadedBy, "accountant"), gte(documents.createdAt, desde)));
  const atuais = await db.select().from(fiscalStatus).where(eq(fiscalStatus.clientId, clientId));
  const atual = (p: Processo) => atuais.find((s) => s.processo === p);
  const eventos = await db.select().from(fiscalEventos).where(eq(fiscalEventos.clientId, clientId));
  const evento = (e: CodigoEvento) => eventos.find((x) => x.evento === e)?.ultimaData;
  // A procuração do e-CAC é por serviço: "x" num evento só diz que falta
  // aquele acesso. Por isso só pula a consulta do serviço correspondente.
  const semAcesso = (e: CodigoEvento) => evento(e) === "x";
  const eventosSemAcesso = eventos.filter((e) => e.ultimaData === "x").map((e) => e.evento as CodigoEvento);

  for (const processo of ["PGDASD", "DCTFWEB", "FGTS"] as Processo[]) {
    if (!processos.includes(processo)) continue;
    let a: Avaliacao = avaliarPorGuias(processo, docs, competencia, hoje);
    let fonte: "portal" | "serpro" = "portal";
    const semGuia = (a as any).semGuia;
    delete (a as any).semGuia;
    let respondidoPeloEvento = false;

    if (semGuia && processo === "DCTFWEB") {
      const peloEvento = dctfwebTransmitidaPeloEvento(evento("E0301"), competencia);
      if (peloEvento === true) {
        a = { status: "pendente", competencia, resumo: `DCTFWeb transmitida em ${fmtEvento(evento("E0301")!)} — guia não publicada no portal` };
        respondidoPeloEvento = true;
      } else if (
        peloEvento === false &&
        a.status === "atencao" &&
        new Date(eventos.find((x) => x.evento === "E0301")!.verificadoEm) > prazoDa(competencia, DIA_PRAZO.DCTFWEB ?? 15)
      ) {
        // O evento, lido DEPOIS do prazo, já responde (última transmissão é
        // anterior ao fim da competência): não gasta a consulta pontual. Leitura
        // feita antes do prazo não vale como "não transmitida".
        a = { status: "atencao", competencia, resumo: `DCTFWeb de ${competencia} não transmitida (última transmissão em ${fmtEvento(evento("E0301")!)})` };
        respondidoPeloEvento = true;
      }
    }

    const prazoVencido = hoje > prazoDa(competencia, DIA_PRAZO[processo] ?? 20);
    const anterior = atual(processo);
    const serproAnterior = (anterior?.detalhes as any)?.serpro;
    const jaConsultado = serproAnterior?.competencia === competencia && diasDesde(serproAnterior?.verificadoEm) < RECONSULTA_DIAS;
    const bloqueado = processo === "DCTFWEB" && semAcesso("E0301");

    if (semGuia && a.status === "atencao" && processo !== "FGTS" && !respondidoPeloEvento) {
      if (jaConsultado && !opts.forcar && anterior) {
        a = { status: anterior.status as any, resumo: anterior.resumo, competencia, detalhes: anterior.detalhes as any };
        fonte = anterior.fonte as any;
      } else if (opts.consultarSerpro && prazoVencido && !bloqueado) {
        // Registra a tentativa mesmo se a consulta falhar: sem isso, um erro
        // persistente viraria uma consulta por dia por cliente.
        const tentativa = { serpro: { competencia, verificadoEm: new Date().toISOString(), semResposta: true } };
        try {
          const r = processo === "PGDASD"
            ? await consultarPgdas(clientId, cnpj, competencia, opts.origem)
            : await consultarDctfweb(clientId, cnpj, competencia, opts.origem);
          if (r) {
            a = r;
            fonte = "serpro";
          } else {
            a = { ...a, detalhes: tentativa };
          }
        } catch (e) {
          if (e instanceof LimiteSerproError) throw e;
          a = { ...a, detalhes: tentativa };
          log("consulta.falhou", { clientId, processo, msg: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    await salvarStatus(clientId, processo, a, fonte);
  }

  if (processos.includes("PARCELAMENTOS")) {
    const lista = await db.select().from(parcelamentos).where(and(eq(parcelamentos.clientId, clientId), eq(parcelamentos.ativo, true)));
    if (opts.consultarSerpro) {
      for (const row of lista.filter((r) => r.origem === "serpro")) {
        const verificado = (row.detalhes as any)?.verificadoEm;
        const emDia = row.ultimoPagamento && compararCompetencia(row.ultimoPagamento, competencia) >= 0;
        if (opts.forcar || (!emDia && diasDesde(verificado) > PARCELAMENTO_RECONSULTA_DIAS)) {
          try {
            await atualizarParcelamentoSn(row, cnpj, opts.origem);
          } catch (e) {
            if (e instanceof LimiteSerproError) throw e;
          }
        }
      }
    }
    const atualizados = await db.select().from(parcelamentos).where(and(eq(parcelamentos.clientId, clientId), eq(parcelamentos.ativo, true)));
    const docsParc = docs.filter((d) => /parcelamento/i.test(d.category));
    const avals = atualizados.map((p) => avaliarParcelamento(p, docsParc, hoje));
    const a: Avaliacao = avals.length
      ? { status: piorSituacao(avals.map((x) => x.status)), resumo: avals.map((x) => x.resumo).join(" · "), detalhes: { itens: avals } }
      : { status: "pendente", resumo: "Guias de parcelamento publicadas, mas nenhum parcelamento cadastrado" };
    await salvarStatus(clientId, "PARCELAMENTOS", a, atualizados.some((p) => p.origem === "serpro") ? "serpro" : "manual");
  }

  if (processos.includes("PROCURACAO")) {
    const NOME_EVENTO: Record<CodigoEvento, string> = { E0301: "DCTFWeb", E0601: "Caixa Postal", E0701: "Pagamentos" };
    const a: Avaliacao = eventosSemAcesso.length && eventosSemAcesso.length === eventos.length
      ? { status: "atencao", resumo: "O escritório não tem procuração no e-CAC para este cliente" }
      : eventosSemAcesso.length
        ? { status: "atencao", resumo: `Procuração sem acesso a: ${eventosSemAcesso.map((e) => NOME_EVENTO[e]).join(", ")}` }
        : eventos.length
        ? { status: "em_dia", resumo: "Procuração ativa" }
        : { status: "processando", resumo: "Aguardando o primeiro monitoramento" };
    await salvarStatus(clientId, "PROCURACAO", a, "serpro");
  }

  if (processos.includes("CAIXAPOSTAL") && !atual("CAIXAPOSTAL")) {
    await salvarStatus(clientId, "CAIXAPOSTAL", { status: "processando", resumo: "Aguardando o primeiro monitoramento" }, "serpro");
  }

  // Processo que deixou de se aplicar sai do painel.
  await db.delete(fiscalStatus).where(and(eq(fiscalStatus.clientId, clientId), notInArray(fiscalStatus.processo, processos)));
}

// --- eventos de atualização -----------------------------------------------------

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

async function atualizarCaixaPostal(clientId: string, cnpj: string, dataEvento: string, origem: "automatico" | "manual") {
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
  const assunto = (m: any) =>
    String(m?.assuntoModelo || "Mensagem").replace("++VARIAVEL++", String(m?.valorParametroAssunto || "")).trim();
  const relevantes = lista.filter((m) => Number(m?.relevancia) === 2);
  const a: Avaliacao = lista.length
    ? {
        status: relevantes.length ? "atencao" : "pendente",
        resumo: `${lista.length} mensagem(ns) não lida(s)${relevantes.length ? `, ${relevantes.length} relevante(s)` : ""}`,
        detalhes: { mensagens: lista.slice(0, 10).map((m) => ({ assunto: assunto(m), data: m?.dataEnvio, relevante: Number(m?.relevancia) === 2, origem: m?.descricaoOrigem ?? null })) },
      }
    : { status: "em_dia", resumo: `Sem mensagens não lidas (última em ${fmtEvento(dataEvento)})` };
  await salvarStatus(clientId, "CAIXAPOSTAL", a, "serpro");
  if (lista.length) {
    await notificar(clientId, "CAIXAPOSTAL", "Caixa Postal — mensagem não lida", lista.slice(0, 3).map(assunto).join(" · "));
  }
}

/** 3 eventos × (solicitar + obter) para todos os clientes de uma vez. */
export async function rodarEventos(origem: "automatico" | "manual" = "automatico", quais: CodigoEvento[] = EVENTOS) {
  const todos = await db.select({ id: clients.id, cnpj: clients.cnpj }).from(clients);
  const porCnpj = new Map(todos.map((c) => [somenteDigitos(c.cnpj), c.id]).filter(([cnpj]) => cnpj.length === 14) as [string, string][]);
  const cnpjs = [...porCnpj.keys()].slice(0, 1000);
  if (!cnpjs.length) return { clientes: 0, mudancas: 0 };

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

      if (valor === "x") {
        const servico = ev === "E0301" ? "a DCTFWeb" : "a Caixa Postal";
        await notificar(clientId, "PROCURACAO", "Sem procuração", `O escritório não tem procuração no e-CAC para ${servico} deste cliente.`);
        if (ev === "E0601") {
          await salvarStatus(clientId, "CAIXAPOSTAL", { status: "atencao", resumo: "Sem procuração para acessar a Caixa Postal" }, "serpro");
        }
        continue;
      }
      if (ev === "E0601") {
        // Caixa Postal: na 1ª leitura também confere as não lidas (1 consulta
        // por cliente, uma vez) — senão o cliente ficaria "processando" até a
        // próxima mensagem chegar. Sem mensagem nenhuma, não consulta.
        if (!valor) {
          await salvarStatus(clientId, "CAIXAPOSTAL", { status: "em_dia", resumo: "Nenhuma mensagem na Caixa Postal" }, "serpro");
          continue;
        }
        try {
          await atualizarCaixaPostal(clientId, cnpj, valor, origem);
        } catch (e) {
          if (e instanceof LimiteSerproError) throw e;
        }
        continue;
      }
      if (prev === undefined || !valor) continue; // 1ª leitura = linha de base, sem custo extra
      if (ev === "E0301") {
        await notificar(clientId, "DCTFWEB", "DCTFWeb transmitida", `Nova transmissão registrada em ${fmtEvento(valor)}.`);
      } else if (ev === "E0701") {
        await notificar(clientId, "PAGAMENTOS", "Pagamento identificado", `Novo pagamento registrado na Receita em ${fmtEvento(valor)}.`);
      }
    }
  }
  for (const clientId of afetados) await avaliarCliente(clientId, { consultarSerpro: false, origem });
  return { clientes: cnpjs.length, mudancas };
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
    // Manual ("Verificar agora") lê os dois eventos; a rotina segue a agenda.
    const jaLidos = new Set((await db.selectDistinct({ e: fiscalEventos.evento }).from(fiscalEventos)).map((r) => r.e));
    const quais = origem === "manual" ? EVENTOS : eventosDoDia(new Date(), jaLidos, AGENDA);
    resultado.eventosConsultados = quais;
    resultado.eventos = quais.length ? await rodarEventos(origem, quais) : { clientes: 0, mudancas: 0 };
    const todos = await db.select({ id: clients.id }).from(clients);
    for (const c of todos) await avaliarCliente(c.id, { consultarSerpro: true, origem });
    resultado.clientes = todos.length;
  } catch (e) {
    resultado.erro = e instanceof Error ? e.message : String(e);
    log("rotina.erro", { msg: resultado.erro });
  }
  await marcarExecucao("rotina_diaria", resultado);
  return resultado;
}

export async function ultimaRotina() {
  const [r] = await db.select().from(fiscalExecucoes).where(eq(fiscalExecucoes.chave, "rotina_diaria"));
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

