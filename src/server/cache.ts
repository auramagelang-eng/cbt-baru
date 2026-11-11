interface CacheItem<T> {
  value: T;
  expiresAt: number;
}

class ServerCache {
  private cache = new Map<string, CacheItem<any>>();
  private hits = 0;
  private misses = 0;

  get<T>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) {
      this.misses++;
      return null;
    }

    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return item.value;
  }

  set<T>(key: string, value: T, ttlSeconds: number = 300): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  deleteByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  getMetrics() {
    const total = this.hits + this.misses;
    const ratio = total > 0 ? (this.hits / total) * 100 : 100;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRatioPercentage: Math.round(ratio * 10) / 10,
    };
  }
}

export const cacheEngine = new ServerCache();
