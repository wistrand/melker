// Engine Cache - file-based cache with LRU eviction per namespace
// Uses runtime fs abstraction for cross-runtime compatibility

import type { EngineCacheAPI } from './core-types.ts';
import {
  readFile, writeFile, mkdir, readDir, stat, remove, isNotFoundError,
} from './runtime/mod.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('EngineCache');

interface CacheEntry {
  path: string;
  size: number;
  lastAccess: number;
}

interface NamespaceIndex {
  entries: Map<string, CacheEntry>;
  totalBytes: number;
  scanned: boolean;
}

export interface EngineCacheOptions {
  baseDir: string;
}

export class EngineCache implements EngineCacheAPI {
  private _baseDir: string;
  private _namespaces = new Map<string, NamespaceIndex>();

  constructor(options: EngineCacheOptions) {
    this._baseDir = options.baseDir;
  }

  async read(namespace: string, key: string): Promise<Uint8Array | null> {
    try {
      const ns = await this._getNamespace(namespace);
      const entry = ns.entries.get(key);
      if (!entry) {
        // Try reading file directly in case index is stale
        const path = this._keyToPath(namespace, key);
        try {
          const data = await readFile(path);

          logger.debug(`read [${namespace}/${key}]: ${path}`);

          // Add to index
          const fileStat = await stat(path);
          ns.entries.delete(key);
          ns.entries.set(key, { path, size: fileStat.size, lastAccess: Date.now() });
          ns.totalBytes += fileStat.size;
          return data;
        } catch {
          return null;
        }
      }

      try {
        const data = await readFile(entry.path);
        // Update LRU order (delete + re-insert moves to end)
        entry.lastAccess = Date.now();
        ns.entries.delete(key);
        ns.entries.set(key, entry);
        return data;
      } catch (e) {
        if (isNotFoundError(e)) {
          // File was deleted externally, remove from index
          ns.totalBytes -= entry.size;
          ns.entries.delete(key);
        }
        return null;
      }
    } catch (e) {
      logger.warn(`cache read error [${namespace}/${key}]: ${e}`);
      return null;
    }
  }

  async write(namespace: string, key: string, data: Uint8Array, options?: { maxBytes?: number }): Promise<void> {
    try {
      const ns = await this._getNamespace(namespace);
      const path = this._keyToPath(namespace, key);

      // Ensure parent directory exists (keys with '/' create subdirs)
      const lastSlash = path.lastIndexOf('/');
      if (lastSlash > 0) {
        await mkdir(path.substring(0, lastSlash), { recursive: true });
      }

      await writeFile(path, data);

      logger.debug(`write [${namespace}/${key}]: ${path}`);

      // Update index
      const existing = ns.entries.get(key);
      if (existing) {
        ns.totalBytes -= existing.size;
        ns.entries.delete(key);
      }
      ns.entries.set(key, { path, size: data.length, lastAccess: Date.now() });
      ns.totalBytes += data.length;

      // Evict if over budget
      const budget = options?.maxBytes ?? Infinity;
      if (budget < Infinity && ns.totalBytes > budget) {
        await this._evict(ns, budget);
      }
    } catch (e) {
      logger.warn(`cache write error [${namespace}/${key}]: ${e}`);
    }
  }

  async delete(namespace: string, key: string): Promise<boolean> {
    try {
      const ns = await this._getNamespace(namespace);
      const entry = ns.entries.get(key);
      if (!entry) return false;

      try {
        await remove(entry.path);
      } catch (e) {
        if (!isNotFoundError(e)) {
          logger.warn(`cache delete error [${namespace}/${key}]: ${e}`);
        }
      }
      ns.totalBytes -= entry.size;
      ns.entries.delete(key);
      return true;
    } catch (e) {
      logger.warn(`cache delete error [${namespace}/${key}]: ${e}`);
      return false;
    }
  }

  async scan(namespace: string): Promise<string[]> {
    try {
      const ns = await this._getNamespace(namespace);
      return Array.from(ns.entries.keys());
    } catch {
      return [];
    }
  }

  async clear(namespace: string): Promise<number> {
    try {
      const ns = await this._getNamespace(namespace);
      const count = ns.entries.size;
      for (const [, entry] of ns.entries) {
        try {
          await remove(entry.path);
        } catch { /* best effort */ }
      }
      ns.entries.clear();
      ns.totalBytes = 0;
      // Clean up empty directories
      try {
        await this._cleanEmptyDirs(`${this._baseDir}/${namespace}`);
      } catch { /* best effort */ }
      return count;
    } catch {
      return 0;
    }
  }

  async stats(namespace: string): Promise<{ entries: number; totalBytes: number }> {
    try {
      const ns = await this._getNamespace(namespace);
      return { entries: ns.entries.size, totalBytes: ns.totalBytes };
    } catch {
      return { entries: 0, totalBytes: 0 };
    }
  }

  // --- Internal ---

  private async _getNamespace(namespace: string): Promise<NamespaceIndex> {
    let ns = this._namespaces.get(namespace);
    if (ns) return ns;

    ns = { entries: new Map(), totalBytes: 0, scanned: false };
    this._namespaces.set(namespace, ns);

    // Lazy scan: populate index from existing files on disk
    await this._scanNamespace(namespace, ns);
    ns.scanned = true;
    return ns;
  }

  private async _scanNamespace(namespace: string, ns: NamespaceIndex): Promise<void> {
    const dir = `${this._baseDir}/${namespace}`;
    const collected: { key: string; entry: CacheEntry }[] = [];

    try {
      await this._scanDir(dir, dir, collected);
    } catch (e) {
      if (!isNotFoundError(e)) {
        logger.debug(`scan namespace [${namespace}]: ${e}`);
      }
      return;
    }

    // Sort by mtime ascending (oldest first) so Map insertion order = LRU order
    collected.sort((a, b) => a.entry.lastAccess - b.entry.lastAccess);
    for (const { key, entry } of collected) {
      ns.entries.set(key, entry);
      ns.totalBytes += entry.size;
    }

    if (collected.length > 0) {
      logger.debug(`cache scan [${namespace}]: ${collected.length} files, ${(ns.totalBytes / 1024 / 1024).toFixed(1)} MB`);
    }
  }

  private async _scanDir(
    rootDir: string,
    currentDir: string,
    out: { key: string; entry: CacheEntry }[],
  ): Promise<void> {
    try {
      for await (const dirEntry of readDir(currentDir)) {
        const fullPath = `${currentDir}/${dirEntry.name}`;
        if (dirEntry.isDirectory) {
          await this._scanDir(rootDir, fullPath, out);
        } else if (dirEntry.isFile) {
          try {
            const fileStat = await stat(fullPath);
            // Derive key from path relative to namespace dir, strip .bin extension
            let rel = fullPath.substring(rootDir.length + 1);
            if (rel.endsWith('.bin')) {
              rel = rel.substring(0, rel.length - 4);
            }
            out.push({
              key: rel,
              entry: {
                path: fullPath,
                size: fileStat.size,
                lastAccess: fileStat.mtime?.getTime() ?? Date.now(),
              },
            });
          } catch { /* stat failed, skip */ }
        }
      }
    } catch (e) {
      if (!isNotFoundError(e)) throw e;
    }
  }

  private _keyToPath(namespace: string, key: string): string {
    // Sanitize to prevent path traversal
    const safeNs = namespace.replace(/\.\./g, '_');
    const safeKey = key.replace(/\.\./g, '_');
    return `${this._baseDir}/${safeNs}/${safeKey}.bin`;
  }

  private async _evict(ns: NamespaceIndex, budget: number): Promise<void> {
    // Evict to 80% of budget (hysteresis)
    const target = budget * 0.8;
    let evicted = 0;
    for (const [key, entry] of ns.entries) {
      if (ns.totalBytes <= target) break;
      try {
        await remove(entry.path);
      } catch (e) {
        if (!isNotFoundError(e)) {
          logger.warn(`eviction failed [${key}]: ${e}`);
        }
      }
      ns.totalBytes -= entry.size;
      ns.entries.delete(key);
      evicted++;
    }
    if (evicted > 0) {
      logger.debug(`evicted ${evicted} cache entries, now ${(ns.totalBytes / 1024 / 1024).toFixed(1)} MB`);
    }
  }

  private async _cleanEmptyDirs(dir: string): Promise<boolean> {
    let empty = true;
    try {
      for await (const entry of readDir(dir)) {
        if (entry.isDirectory) {
          const childEmpty = await this._cleanEmptyDirs(`${dir}/${entry.name}`);
          if (!childEmpty) empty = false;
        } else {
          empty = false;
        }
      }
      if (empty) {
        await remove(dir);
      }
    } catch {
      empty = false;
    }
    return empty;
  }
}
