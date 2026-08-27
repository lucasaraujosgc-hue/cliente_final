import type { Request } from "express";
import type { InferSelectModel } from "drizzle-orm";
import type { clients, documents, billingData, messages } from "./schema";

// Row types inferred straight from the Drizzle schema — the single source of
// truth. Prefer these over hand-written interfaces.
export type Client = InferSelectModel<typeof clients>;
export type Document = InferSelectModel<typeof documents>;
export type BillingRow = InferSelectModel<typeof billingData>;
export type Message = InferSelectModel<typeof messages>;

// JWT payload shape signed in auth.routes.ts.
export interface AuthPayload {
  role: "client" | "accountant";
  name?: string;
  clientId?: string; // present for role === "client"
}

// Populated by the auth middleware. Augmenting Express.Request lets route
// handlers read req.user / req.integrationClient without `as any`.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
      integrationClient?: Client;
    }
  }
}

// Narrow accessors for authenticated routes. They throw if the expected auth
// middleware didn't run — which shouldn't be possible on a guarded route, but
// keeps the types honest without `!` littered everywhere.
export function getAuth(req: Request): AuthPayload {
  if (!req.user) throw Object.assign(new Error("Not authenticated"), { status: 401 });
  return req.user;
}

export function getClientId(req: Request): string {
  const id = req.user?.clientId;
  if (!id) throw Object.assign(new Error("Client token required"), { status: 403 });
  return id;
}

export function getIntegrationClient(req: Request): Client {
  if (!req.integrationClient) {
    throw Object.assign(new Error("Integration token required"), { status: 401 });
  }
  return req.integrationClient;
}
