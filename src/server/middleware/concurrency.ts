import type { Request, Response, NextFunction } from "express";

// Caps how many requests may be in-flight through a route at any moment.
//
// The per-IP rate limiter bounds request *frequency*; this bounds request
// *concurrency*. The webhook endpoints do real work per call (base64 decode of
// up to ~14 MB, PDF parsing, disk writes), so a burst — even from one allowed
// partner — can pin CPU and memory. Over the cap we shed load with a 503 +
// Retry-After instead of queueing unboundedly.
export function inFlightLimit(max: number, retryAfterSeconds = 5) {
  let active = 0;

  return function inFlightLimiter(req: Request, res: Response, next: NextFunction) {
    if (active >= max) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res
        .status(503)
        .json({ error: "Servidor ocupado processando outros arquivos. Tente novamente em instantes." });
    }

    active++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
    };
    res.on("finish", release);
    res.on("close", release);

    next();
  };
}
