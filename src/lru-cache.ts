/**
 * Simple LRU (Least Recently Used) cache implementation
 * Uses Map's insertion order for efficient O(1) operations
 */
export class LRUCache<K, V> {
  private readonly _cache = new Map<K, V>();
  private readonly _maxSize: number;

  constructor(maxSize: number) {
    if (maxSize < 1) {
      throw new Error('LRU cache maxSize must be at least 1');
    }
    this._maxSize = maxSize;
  }

  /**
   * Get a value from the cache
   * Moves the entry to the end (most recently used)
   */
  get(key: K): V | undefined {
    const value = this._cache.get(key);
    if (value !== undefined) {
      // Move to end for LRU behavior (delete and re-add)
      this._cache.delete(key);
      this._cache.set(key, value);
    }
    return value;
  }

  /**
   * Check if key exists without affecting LRU order
   */
  has(key: K): boolean {
    return this._cache.has(key);
  }

  /**
   * Set a value in the cache
   * Evicts oldest entries if cache exceeds max size
   */
  set(key: K, value: V): void {
    // If key exists, delete first to update position
    if (this._cache.has(key)) {
      this._cache.delete(key);
    }

    this._cache.set(key, value);

    // Evict oldest entries if over max size
    while (this._cache.size > this._maxSize) {
      const oldestKey = this._cache.keys().next().value;
      if (oldestKey !== undefined) {
        this._cache.delete(oldestKey);
      } else {
        break;
      }
    }
  }

  /**
   * Delete an entry from the cache
   */
  delete(key: K): boolean {
    return this._cache.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this._cache.clear();
  }

  /**
   * Get the current number of entries in the cache
   */
  get size(): number {
    return this._cache.size;
  }

  /**
   * Get the maximum size of the cache
   */
  get maxSize(): number {
    return this._maxSize;
  }
}
