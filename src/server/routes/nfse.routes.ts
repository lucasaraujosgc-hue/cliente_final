import { Express } from "express";
import { verifyClientAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { getClientId } from "../types";
import { isUuid } from "../services/serpro";
import { nfseEmissaoCreateSchema } from "../schemas/validation";
import {
  nfseStatus,
  listEmissoes,
  getEmissao,
  createEmissao,
  NotImplementedError,
} from "../services/nfse";

// NFS-e API scaffold. Client-scoped, same middlewares as the rest of the portal.
// Emission is not implemented — POST returns 501 and never creates a record.
export function registerNfseRoutes(app: Express) {
  app.get("/api/nfse", verifyClientAuth, (_req, res) => {
    res.json(nfseStatus());
  });

  app.get("/api/nfse/emissoes", verifyClientAuth, async (req, res) => {
    const clientId = getClientId(req);
    res.json({ emissoes: await listEmissoes(clientId) });
  });

  app.get("/api/nfse/:id", verifyClientAuth, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
    const clientId = getClientId(req);
    const emissao = await getEmissao(clientId, req.params.id);
    if (!emissao) return res.status(404).json({ error: "Emissão não encontrada." });
    res.json({ emissao });
  });

  app.post(
    "/api/nfse/emissoes",
    verifyClientAuth,
    validateBody(nfseEmissaoCreateSchema),
    async (_req, res) => {
      try {
        await createEmissao();
        res.json({ ok: true }); // unreachable — createEmissao always throws for now
      } catch (e) {
        if (e instanceof NotImplementedError) {
          return res.status(501).json({ error: e.message });
        }
        throw e;
      }
    },
  );
}
