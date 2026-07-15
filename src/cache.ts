type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class TtlCache {
  #store = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly defaultTtlMs: number) {}

  get<T>(key: string): T | undefined {
    const entry = this.#store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.#store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    this.#store.set(key, { value, expiresAt: Date.now() + ttlMs });
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
