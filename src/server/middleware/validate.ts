import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

// Validates req.body against a Zod schema before the route handler runs.
// On failure, responds 400 with a readable list of field errors instead of
// letting bad input reach the database layer or crash the handler.
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "Dados inválidos.",
        details: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    // Replace body with the parsed/coerced data so handlers get clean types.
    req.body = result.data;
    next();
  };
}
