type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const DEFAULT_MAX_ENTRIES = 256;

export class TtlCache {
  #store = new Map<string, CacheEntry<unknown>>();
  readonly maxEntries: number;

  constructor(
    private readonly defaultTtlMs: number,
    maxEntries: number = DEFAULT_MAX_ENTRIES,
  ) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  /** Drop expired entries. Returns how many were removed. */
  sweep(now = Date.now()): number {
    let removed = 0;
    for (const [key, entry] of this.#store) {
      if (now > entry.expiresAt) {
        this.#store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.#store.size;
  }

  get<T>(key: string): T | undefined {
    const entry = this.#store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.#store.delete(key);
      return undefined;
    }
    // LRU touch: Map insertion order = eviction order
    this.#store.delete(key);
    this.#store.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    this.sweep();
    if (this.#store.has(key)) this.#store.delete(key);
    this.#store.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.#store.size > this.maxEntries) {
      const oldest = this.#store.keys().next().value;
      if (oldest === undefined) break;
      this.#store.delete(oldest);
    }
  }

  delete(key: string): void {
    this.#store.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.#store.keys()) {
      if (key.startsWith(prefix)) this.#store.delete(key);
    }
  }

  clear(): void {
    this.#store.clear();
  }
}

export function resolveCacheMaxEntries(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.NOTION_BANK_CACHE_MAX_ENTRIES?.trim();
  if (!raw) return DEFAULT_MAX_ENTRIES;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_ENTRIES;
}
