import { describe, it, expect } from "vitest";
import { collectEnvIssues } from "../env";

const good = {
  JWT_SECRET: "s".repeat(40),
  ADMIN: "contador123",
  PASSWORD: "a-strong-unique-password",
  DATABASE_URL: "postgres://localhost/db",
  VAPID_PUBLIC_KEY: "x",
  VAPID_PRIVATE_KEY: "y",
  CORS_ORIGINS: "https://app.example.com",
  SECRETS_KEY: "a-dedicated-secrets-key",
  ACCOUNTANT_MFA_EMAIL: "contador@example.com",
} as NodeJS.ProcessEnv;

describe("collectEnvIssues", () => {
  it("is clean for a fully configured environment", () => {
    expect(collectEnvIssues(good)).toEqual({ problems: [], warnings: [] });
  });

  it("flags well-known default secrets as problems", () => {
    const report = collectEnvIssues({
      ...good,
      JWT_SECRET: "your_long_random_secret_string_here",
      PASSWORD: "admin_password",
    });
    expect(report.problems).toHaveLength(2);
    expect(report.problems.join(" ")).toContain("JWT_SECRET");
    expect(report.problems.join(" ")).toContain("PASSWORD");
  });

  it("treats missing DATABASE_URL as a problem and missing VAPID as a warning", () => {
    const { DATABASE_URL, VAPID_PUBLIC_KEY, ...partial } = good;
    const report = collectEnvIssues(partial as NodeJS.ProcessEnv);
    expect(report.problems).toContain("DATABASE_URL is required.");
    expect(report.warnings.join(" ")).toContain("VAPID_PUBLIC_KEY");
  });

  it("requires CORS_ORIGINS in production but only warns in dev", () => {
    const { CORS_ORIGINS, ...noCors } = good;

    const prod = collectEnvIssues({ ...noCors, NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(prod.problems.join(" ")).toContain("CORS_ORIGINS");

    const dev = collectEnvIssues(noCors as NodeJS.ProcessEnv);
    expect(dev.problems.join(" ")).not.toContain("CORS_ORIGINS");
    expect(dev.warnings.join(" ")).toContain("CORS_ORIGINS");
  });

  it("warns when accountant 2FA has no address, unless explicitly off", () => {
    const { ACCOUNTANT_MFA_EMAIL, ...noEmail } = good;

    expect(collectEnvIssues(noEmail as NodeJS.ProcessEnv).warnings.join(" ")).toContain("2FA");
    expect(
      collectEnvIssues({ ...noEmail, ACCOUNTANT_2FA: "off" } as NodeJS.ProcessEnv).warnings.join(" "),
    ).not.toContain("2FA");
    expect(
      collectEnvIssues({ ...noEmail, EMAIL_USER: "x@y.com" } as NodeJS.ProcessEnv).warnings.join(" "),
    ).not.toContain("2FA");
  });
});
