/**
 * Tracks Streamable HTTP MCP transports and evicts idle sessions so disconnected
 * clients cannot leak transports forever when onclose never fires.
 */
export type ClosableTransport = {
  sessionId?: string;
  close(): Promise<void> | void;
};

export type TransportEntry<T extends ClosableTransport = ClosableTransport> = {
  transport: T;
  accessToken: string;
  lastActiveAt: number;
};

export function resolveHttpIdleMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.NOTION_BANK_HTTP_IDLE_MS?.trim();
  if (raw === "0") return 0; // disable idle eviction
  if (!raw) return 30 * 60 * 1000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30 * 60 * 1000;
}

export class TransportSessionRegistry<T extends ClosableTransport = ClosableTransport> {
  #map = new Map<string, TransportEntry<T>>();
  #timer: ReturnType<typeof setInterval> | null = null;
  readonly idleMs: number;
  readonly checkEveryMs: number;

  constructor(idleMs: number, checkEveryMs?: number) {
    this.idleMs = idleMs;
    this.checkEveryMs =
      checkEveryMs ??
      (idleMs <= 0 ? 60_000 : Math.min(60_000, Math.max(5_000, Math.floor(idleMs / 6))));
  }

  get size(): number {
    return this.#map.size;
  }

  start(): void {
    if (this.#timer || this.idleMs <= 0) return;
    this.#timer = setInterval(() => {
      void this.evictIdle();
    }, this.checkEveryMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  set(
    sid: string,
    entry: {
      transport: T;
      accessToken: string;
      lastActiveAt?: number;
    },
  ): void {
    this.#map.set(sid, {
      transport: entry.transport,
      accessToken: entry.accessToken,
      lastActiveAt: entry.lastActiveAt ?? Date.now(),
    });
  }

  /** Returns entry and refreshes lastActiveAt. */
  get(sid: string): TransportEntry<T> | undefined {
    const entry = this.#map.get(sid);
    if (!entry) return undefined;
    entry.lastActiveAt = Date.now();
    return entry;
  }

  delete(sid: string): void {
    this.#map.delete(sid);
  }

  async evictIdle(now = Date.now()): Promise<string[]> {
    if (this.idleMs <= 0) return [];
    const closed: string[] = [];
    for (const [sid, entry] of [...this.#map.entries()]) {
      if (now - entry.lastActiveAt < this.idleMs) continue;
      this.#map.delete(sid);
      closed.push(sid);
      try {
        await entry.transport.close();
      } catch {
        /* ignore close errors during eviction */
      }
    }
    return closed;
  }
}
