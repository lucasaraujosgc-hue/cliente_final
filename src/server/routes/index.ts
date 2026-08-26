import { Express } from "express";
import { registerWebhookRoutes } from "./webhook.routes";
import { registerAuthRoutes } from "./auth.routes";
import { registerIntegrationRoutes } from "./integration.routes";
import { registerClientRoutes } from "./client.routes";
import { registerAccountantRoutes } from "./accountant.routes";
import { registerNotificationRoutes } from "./notifications.routes";

// Re-exported so existing imports of `triggerDebouncedDocumentNotification`
// from "./routes" keep working after the split.
export { triggerDebouncedDocumentNotification } from "../services/notificationSweeper";

// Mounts every route module onto the Express app. Keeps the same public
// signature the old monolithic routes.ts exposed, so server.ts needs no changes.
export function setupRoutes(app: Express) {
  registerWebhookRoutes(app);
  registerAuthRoutes(app);
  registerIntegrationRoutes(app);
  registerClientRoutes(app);
  registerAccountantRoutes(app);
  registerNotificationRoutes(app);
}
