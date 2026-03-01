// Query cache for AI accessibility responses
// Only caches exact query + context matches

export interface CacheEntry {
  query: string;
  contextHash: string;
  response: string;
  timestamp: number;
}

export class QueryCache {
  private _cache: Map<string, CacheEntry> = new Map();
  private _maxAge: number;
  private _maxEntries: number;

  /**
   * Create a new query cache
   * @param maxAgeMs Maximum age of cache entries in milliseconds (default: 5 minutes)
   * @param maxEntries Maximum number of entries to store (default: 100)
   */
  constructor(maxAgeMs: number = 5 * 60 * 1000, maxEntries: number = 100) {
    this._maxAge = maxAgeMs;
    this._maxEntries = maxEntries;
  }

  /**
   * Generate a cache key from query and context hash
   * Only exact matches are cached
   */
  private _getCacheKey(query: string, contextHash: string): string {
    return `${query}|${contextHash}`;
  }

  /**
   * Get a cached response for exact query + context match
   * @returns The cached response or null if not found/expired
   */
  get(query: string, contextHash: string): string | null {
    const key = this._getCacheKey(query, contextHash);
    const entry = this._cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if entry has expired
    if (Date.now() - entry.timestamp > this._maxAge) {
      this._cache.delete(key);
      return null;
    }

    // Promote to most-recently-used (move to end of Map insertion order)
    this._cache.delete(key);
    this._cache.set(key, entry);

    return entry.response;
  }

  /**
   * Cache a response for the exact query + context
   */
  set(query: string, contextHash: string, response: string): void {
    // Evict old entries if at capacity
    if (this._cache.size >= this._maxEntries) {
      this._evictOldest();
    }

    const key = this._getCacheKey(query, contextHash);
    this._cache.set(key, {
      query,
      contextHash,
      response,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if a query is cached without retrieving
   */
  has(query: string, contextHash: string): boolean {
    return this.get(query, contextHash) !== null;
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this._cache.clear();
  }

  /**
   * Remove expired entries
   */
  prune(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this._cache.entries()) {
      if (now - entry.timestamp > this._maxAge) {
        this._cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; maxEntries: number; maxAgeMs: number } {
    return {
      size: this._cache.size,
      maxEntries: this._maxEntries,
      maxAgeMs: this._maxAge,
    };
  }

  /**
   * Evict the least-recently-used entry (first key in Map insertion order)
   */
  private _evictOldest(): void {
    const firstKey = this._cache.keys().next().value;
    if (firstKey !== undefined) {
      this._cache.delete(firstKey);
    }
  }
}

// Singleton cache instance
let globalCache: QueryCache | undefined;

export function getGlobalCache(): QueryCache {
  if (!globalCache) {
    globalCache = new QueryCache();
  }
  return globalCache;
}

export function setGlobalCache(cache: QueryCache): void {
  globalCache = cache;
}
