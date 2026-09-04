import { describe, it, expect } from "vitest";
import { buildBillingPayload } from "../billing";

describe("buildBillingPayload", () => {
  it("derives legacy columns from the services model", () => {
    expect(
      buildBillingPayload({
        month: "01/2026",
        servicesRevenue: 1000,
        salesRevenue: 500,
        servicesTaken: 200,
      }),
    ).toMatchObject({ revenue: 1500, expenses: 200, payroll: 0 });
  });

  it("keeps explicit legacy values when that's all it gets", () => {
    expect(
      buildBillingPayload({ month: "01/2026", revenue: 900, expenses: 300, payroll: 100 }),
    ).toMatchObject({
      revenue: 900,
      expenses: 300,
      payroll: 100,
      servicesRevenue: 0,
      salesRevenue: 0,
    });
  });

  it("coerces non-numeric / missing values to 0", () => {
    expect(
      buildBillingPayload({
        month: "01/2026",
        servicesRevenue: "abc" as any,
        salesRevenue: undefined,
        totalIncomes: NaN,
      }),
    ).toMatchObject({ servicesRevenue: 0, salesRevenue: 0, totalIncomes: 0, revenue: 0 });
  });
});
