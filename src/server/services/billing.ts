import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { billingData, nfseEmissoes } from "../schema";

// Shape accepted from clients, the accountant panel and external integrations.
// The current data model is the "services" one (servicesRevenue / salesRevenue
// / totalIncomes / servicesTaken); `revenue` / `expenses` / `payroll` are the
// legacy columns kept in sync for older readers.
export interface BillingInput {
  month: string;
  servicesRevenue?: number;
  salesRevenue?: number;
  totalIncomes?: number;
  servicesTaken?: number;
  // legacy
  revenue?: number;
  expenses?: number;
  payroll?: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Normalises an arbitrary billing input into the exact column set, coercing
// junk to 0 and deriving the legacy columns. Pure — exported for testing.
export function buildBillingPayload(input: BillingInput) {
  const servicesRevenue = num(input.servicesRevenue);
  const salesRevenue = num(input.salesRevenue);
  const totalIncomes = num(input.totalIncomes);
  const servicesTaken = num(input.servicesTaken);

  return {
    servicesRevenue,
    salesRevenue,
    totalIncomes,
    servicesTaken,
    // Legacy columns: prefer explicit legacy values when that's all we got.
    revenue: input.revenue != null ? num(input.revenue) : servicesRevenue + salesRevenue,
    expenses: input.expenses != null ? num(input.expenses) : servicesTaken,
    payroll: num(input.payroll),
  };
}

// Insert or update the billing row for (clientId, month). Centralised here so
// the four call sites (client / accountant × single / bulk) can't drift apart.
// Edição de pessoa (cliente, contador, integração): o campo de serviços
// prestados/tomados cujo valor mudou passa a 'manual' — as NFS-e deixam de
// sobrescrevê-lo. Reenviar o mesmo valor (o formulário manda os 4 campos) não
// muda a origem.
export async function upsertBilling(clientId: string, input: BillingInput) {
  const payload = buildBillingPayload(input);

  const [existing] = await db
    .select()
    .from(billingData)
    .where(and(eq(billingData.clientId, clientId), eq(billingData.month, input.month)))
    .limit(1);

  const origem = (campo: "servicesRevenue" | "servicesTaken", atual?: string | null) => {
    const antes = existing ? existing[campo] : 0;
    return payload[campo] !== antes ? "manual" : (atual ?? null);
  };
  const origens = {
    servicesRevenueOrigem: origem("servicesRevenue", existing?.servicesRevenueOrigem),
    servicesTakenOrigem: origem("servicesTaken", existing?.servicesTakenOrigem),
  };

  if (existing) {
    await db.update(billingData).set({ ...payload, ...origens }).where(eq(billingData.id, existing.id));
  } else {
    await db.insert(billingData).values({ ...payload, ...origens, clientId, month: input.month });
  }
}

// --- Faturamento a partir das NFS-e -------------------------------------------

export interface FaturamentoNfseResultado {
  mesesAtualizados: number;
  // Mês com valor informado antes (sem origem) diferente da soma das notas:
  // não é sobrescrito — vai para a conferência do contador.
  divergentes: { mes: string; campo: "servicos" | "tomados"; informado: number; notas: number }[];
}

/**
 * Soma, por competência, as NFS-e de produção não canceladas do cliente:
 * emitidas por ele (papel prestador) → "Serviços" do faturamento declarado;
 * recebidas (papel tomador) → "Serviços tomados". Valores em reais inteiros,
 * como o resto do faturamento. Não toca em campo editado à mão nem em valor
 * informado antes desta função existir (este entra em `divergentes`).
 */
export async function aplicarFaturamentoNfse(clientId: string): Promise<FaturamentoNfseResultado> {
  const somas = await db
    .select({
      competencia: nfseEmissoes.competencia,
      papel: nfseEmissoes.papel,
      centavos: sql<string>`coalesce(sum(${nfseEmissoes.valorServicos}), 0)`,
    })
    .from(nfseEmissoes)
    .where(
      and(
        eq(nfseEmissoes.clientId, clientId),
        eq(nfseEmissoes.ambiente, "producao"),
        eq(nfseEmissoes.status, "emitida"),
        inArray(nfseEmissoes.papel, ["prestador", "tomador"]),
      ),
    )
    .groupBy(nfseEmissoes.competencia, nfseEmissoes.papel);

  const porMes = new Map<string, { servicos: number; tomados: number }>();
  for (const r of somas) {
    if (!r.competencia || !/^\d{2}\/\d{4}$/.test(r.competencia)) continue;
    const m = porMes.get(r.competencia) ?? { servicos: 0, tomados: 0 };
    const reais = Math.round(Number(r.centavos) / 100);
    if (r.papel === "prestador") m.servicos += reais;
    else m.tomados += reais;
    porMes.set(r.competencia, m);
  }

  const linhas = await db.select().from(billingData).where(eq(billingData.clientId, clientId));
  const porLinha = new Map(linhas.map((l) => [l.month, l]));
  // Também os meses que vieram das notas e agora não têm nota (cancelamento) → 0.
  for (const l of linhas) {
    if ((l.servicesRevenueOrigem === "nfse" || l.servicesTakenOrigem === "nfse") && !porMes.has(l.month)) {
      porMes.set(l.month, { servicos: 0, tomados: 0 });
    }
  }

  const res: FaturamentoNfseResultado = { mesesAtualizados: 0, divergentes: [] };
  for (const [mes, v] of porMes) {
    const l = porLinha.get(mes);
    // Decide cada campo: 'manual' fica; valor antigo sem origem e ≠ das notas fica
    // (e é reportado); senão vale a soma das notas.
    const decidir = (campo: "servicos" | "tomados", atual: number, origemAtual: string | null | undefined, novo: number) => {
      if (origemAtual === "manual") return null;
      if (!origemAtual && atual === 0 && novo === 0) return null; // nada a aplicar
      if (!origemAtual && atual !== 0 && atual !== novo) {
        res.divergentes.push({ mes, campo, informado: atual, notas: novo });
        return null;
      }
      return novo;
    };
    const servicos = decidir("servicos", l?.servicesRevenue ?? 0, l?.servicesRevenueOrigem, v.servicos);
    const tomados = decidir("tomados", l?.servicesTaken ?? 0, l?.servicesTakenOrigem, v.tomados);
    if (servicos === null && tomados === null) continue;

    const novo = {
      servicesRevenue: servicos ?? l?.servicesRevenue ?? 0,
      servicesTaken: tomados ?? l?.servicesTaken ?? 0,
    };
    const origens = {
      servicesRevenueOrigem: servicos !== null ? "nfse" : (l?.servicesRevenueOrigem ?? null),
      servicesTakenOrigem: tomados !== null ? "nfse" : (l?.servicesTakenOrigem ?? null),
    };
    const igual =
      !!l &&
      l.servicesRevenue === novo.servicesRevenue &&
      l.servicesTaken === novo.servicesTaken &&
      (l.servicesRevenueOrigem ?? null) === origens.servicesRevenueOrigem &&
      (l.servicesTakenOrigem ?? null) === origens.servicesTakenOrigem;
    if (igual) continue;
    // Mês só com zeros e sem linha: não cria linha vazia.
    if (!l && novo.servicesRevenue === 0 && novo.servicesTaken === 0) continue;
    const payload = buildBillingPayload({
      month: mes,
      servicesRevenue: novo.servicesRevenue,
      salesRevenue: l?.salesRevenue ?? 0,
      totalIncomes: l?.totalIncomes ?? 0,
      servicesTaken: novo.servicesTaken,
      payroll: l?.payroll ?? 0,
    });
    if (l) await db.update(billingData).set({ ...payload, ...origens }).where(eq(billingData.id, l.id));
    else await db.insert(billingData).values({ ...payload, ...origens, clientId, month: mes });
    res.mesesAtualizados++;
  }
  return res;
}

/** Recalcula sem atrasar quem chamou (emissão, cancelamento, reconciliação). */
export function atualizarFaturamentoNfse(clientId: string) {
  void aplicarFaturamentoNfse(clientId).catch((e) =>
    console.warn("[faturamento] falha ao aplicar NFS-e:", e instanceof Error ? e.message : e),
  );
}
