export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const current = (process.env.NOTION_BANK_LOG_LEVEL as LogLevel) || "info";

function emit(level: LogLevel, message: string, meta?: unknown): void {
  if (LEVELS[level] < LEVELS[current]) return;
  const payload =
    meta === undefined
      ? `[notion-bank] ${level}: ${message}`
      : `[notion-bank] ${level}: ${message} ${JSON.stringify(meta)}`;
  // MCP stdio: never write to stdout
  console.error(payload);
}

export const log = {
  debug: (msg: string, meta?: unknown) => emit("debug", msg, meta),
  info: (msg: string, meta?: unknown) => emit("info", msg, meta),
  warn: (msg: string, meta?: unknown) => emit("warn", msg, meta),
  error: (msg: string, meta?: unknown) => emit("error", msg, meta),
};
