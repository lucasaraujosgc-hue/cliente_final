import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

// Validates req.body against a Zod schema before the route handler runs.
// On failure, responds 400 with a readable list of field errors instead of
// letting bad input reach the database layer or crash the handler.
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join(".") || "(raiz)",
        message: issue.message,
      }));
      // Log no stdout — sem isso "Dados inválidos." é impossível de diagnosticar.
      console.warn(
        `[validateBody] 400 ${req.method} ${req.originalUrl} — ` +
          details.map((d) => `${d.field}: ${d.message}`).join(" | "),
      );
      return res.status(400).json({ error: "Dados inválidos.", details });
    }
    // Replace body with the parsed/coerced data so handlers get clean types.
    req.body = result.data;
    next();
  };
}
