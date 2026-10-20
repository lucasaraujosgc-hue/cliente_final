// Small structured-ish logger. Not a full observability stack — just a single
// consistent shape (timestamp + level + message + optional context object) so
// request logs and error logs are greppable and carry a request id. Existing
// scattered console.* calls are left as-is; new code should prefer this.

type Level = "info" | "warn" | "error";

const SINKS: Record<Level, (...a: unknown[]) => void> = {
  info: console.log,
  warn: console.warn,
  error: console.error,
};

function emit(level: Level, msg: string, context?: Record<string, unknown>) {
  const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}`;
  if (context && Object.keys(context).length > 0) {
    SINKS[level](prefix, context);
  } else {
    SINKS[level](prefix);
  }
}

export const logger = {
  info: (msg: string, context?: Record<string, unknown>) => emit("info", msg, context),
  warn: (msg: string, context?: Record<string, unknown>) => emit("warn", msg, context),
  error: (msg: string, context?: Record<string, unknown>) => emit("error", msg, context),
};
