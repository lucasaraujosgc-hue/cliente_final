import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { billingData } from "../schema";

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
export async function upsertBilling(clientId: string, input: BillingInput) {
  const payload = buildBillingPayload(input);

  const [existing] = await db
    .select()
    .from(billingData)
    .where(and(eq(billingData.clientId, clientId), eq(billingData.month, input.month)))
    .limit(1);

  if (existing) {
    await db.update(billingData).set(payload).where(eq(billingData.id, existing.id));
  } else {
    await db.insert(billingData).values({ ...payload, clientId, month: input.month });
  }
}
