import type { Client } from "../types";

// Response shapes for the `clients` table. NEVER spread a raw client row into a
// response — it carries password_hash, integration_hash(+digest) and the
// password-reset code hash/expiry/attempts. Use one of these instead.

// What a client's own portal may see about itself.
export function clientSelfDTO(c: Client) {
  return {
    id: c.id,
    cnpj: c.cnpj,
    name: c.name,
    email: c.email ?? null,
    regularityStatus: c.regularityStatus,
    firstAccessDone: c.firstAccessDone ?? false,
    accountantCategory: c.accountantCategory ?? null,
    notificationPreferences: c.notificationPreferences ?? null,
  };
}

// What the accountant admin panel needs. It gets to know *whether* an
// integration token is configured, never its value.
export function clientAdminDTO(c: Client) {
  return {
    id: c.id,
    cnpj: c.cnpj,
    name: c.name,
    email: c.email ?? null,
    regularityStatus: c.regularityStatus,
    firstAccessDone: c.firstAccessDone ?? false,
    accountantCategory: c.accountantCategory ?? null,
    hasIntegrationToken: Boolean(c.integrationHash || c.integrationHashDigest),
  };
}

// Echoed back to an external integration after sync-client.
export function clientIntegrationDTO(c: Client) {
  return {
    id: c.id,
    cnpj: c.cnpj,
    name: c.name,
    regularityStatus: c.regularityStatus,
  };
}
