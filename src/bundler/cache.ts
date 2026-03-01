/**
 * Bundle caching for Melker bundler.
 *
 * Caches bundled output based on content hash to avoid re-bundling
 * unchanged .melker files. Cache is invalidated when:
 * - File content changes
 * - Deno version changes
 * - Cache file is corrupted
 */

import { getLogger } from '../logging.ts';
import { getCacheDir as getXdgCacheDir } from '../xdg.ts';
import { sha256Hex } from '../utils/crypto.ts';
import type { CacheEntry, AssembledMelker, LineMapping } from './types.ts';
import {
  readTextFile,
  writeTextFile,
  mkdir,
  readDir,
  stat,
  remove,
  isNotFoundError,
  runtimeVersion,
} from '../runtime/mod.ts';

const logger = getLogger('Bundler:Cache');

/** Cache directory name under XDG cache */
const CACHE_SUBDIR = 'bundles';

/**
 * Get the cache directory path.
 */
function getCacheDir(): string {
  return `${getXdgCacheDir()}/${CACHE_SUBDIR}`;
}

/**
 * Get the cache file path for a given source path and content.
 */
async function getCachePath(sourcePath: string, content: string): Promise<string> {
  const cacheKey = await sha256Hex(sourcePath + content);
  return `${getCacheDir()}/${cacheKey}.json`;
}

/**
 * Check the cache for a valid entry.
 *
 * Returns the cached entry if:
 * - Cache file exists
 * - Content hash matches
 * - Deno version matches
 *
 * Returns null otherwise.
 */
export async function checkCache(
  sourcePath: string,
  content: string
): Promise<CacheEntry | null> {
  const cachePath = await getCachePath(sourcePath, content);

  logger.debug('Checking cache', { sourcePath, cachePath });

  try {
    const cached = JSON.parse(await readTextFile(cachePath)) as CacheEntry;

    // Validate Deno version
    if (cached.denoVersion !== runtimeVersion()) {
      logger.debug('Cache miss: Deno version mismatch', {
        cached: cached.denoVersion,
        current: runtimeVersion(),
      });
      return null;
    }

    // Validate content hash
    const currentHash = await sha256Hex(content);
    if (cached.contentHash !== currentHash) {
      logger.debug('Cache miss: content hash mismatch');
      return null;
    }

    logger.info('Cache hit', {
      sourcePath,
      cachedAt: new Date(cached.timestamp).toISOString(),
    });

    return cached;
  } catch (error) {
    if (isNotFoundError(error)) {
      logger.debug('Cache miss: file not found', { cachePath });
    } else {
      logger.debug('Cache miss: read error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}

/**
 * Save a bundle result to the cache.
 */
export async function saveToCache(
  sourcePath: string,
  content: string,
  assembled: AssembledMelker
): Promise<void> {
  const cacheDir = getCacheDir();
  const cachePath = await getCachePath(sourcePath, content);

  logger.debug('Saving to cache', { sourcePath, cachePath });

  try {
    // Ensure cache directory exists
    await mkdir(cacheDir, { recursive: true });

    // Create cache entry
    const entry: CacheEntry = {
      contentHash: await sha256Hex(content),
      bundledCode: assembled.bundledCode,
      lineMap: Array.from(assembled.lineMap.entries()),
      template: assembled.template,
      denoVersion: runtimeVersion(),
      timestamp: Date.now(),
    };

    await writeTextFile(cachePath, JSON.stringify(entry));

    logger.debug('Cache saved', {
      cachePath,
      bytes: JSON.stringify(entry).length,
    });
  } catch (error) {
    // Cache save failures are non-fatal
    logger.warn('Failed to save cache', {
      error: error instanceof Error ? error.message : String(error),
      cachePath,
    });
  }
}

/**
 * Restore an AssembledMelker from a cache entry.
 */
export function restoreFromCache(
  entry: CacheEntry,
  originalContent: string,
  sourceUrl: string
): AssembledMelker {
  logger.debug('Restoring from cache', {
    sourceUrl,
    bundledCodeLength: entry.bundledCode.length,
    lineMapSize: entry.lineMap.length,
  });

  return {
    bundledCode: entry.bundledCode,
    lineMap: new Map(entry.lineMap as Array<[number, LineMapping]>),
    template: entry.template,
    bundleSourceMap: null, // Sourcemap not cached (large and not essential)
    originalContent,
    sourceUrl,
  };
}

/**
 * Clear the bundle cache.
 *
 * Optionally limit to entries older than maxAge (in milliseconds).
 */
export async function clearCache(maxAge?: number): Promise<number> {
  const cacheDir = getCacheDir();
  let cleared = 0;

  logger.info('Clearing cache', { cacheDir, maxAge });

  try {
    const now = Date.now();

    for await (const entry of readDir(cacheDir)) {
      if (!entry.isFile || !entry.name.endsWith('.json')) continue;

      const filePath = `${cacheDir}/${entry.name}`;

      if (maxAge !== undefined) {
        // Check if entry is old enough to delete
        try {
          const content = await readTextFile(filePath);
          const cached = JSON.parse(content) as CacheEntry;

          if (now - cached.timestamp < maxAge) {
            continue; // Skip: not old enough
          }
        } catch {
          // If we can't read/parse, delete it anyway
        }
      }

      try {
        await remove(filePath);
        cleared++;
      } catch {
        // Ignore individual file delete errors
      }
    }

    logger.info('Cache cleared', { cleared });
  } catch (error) {
    if (!isNotFoundError(error)) {
      logger.warn('Error clearing cache', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return cleared;
}

/**
 * Get cache statistics.
 */
export async function getCacheStats(): Promise<{
  entries: number;
  totalSize: number;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
}> {
  const cacheDir = getCacheDir();
  let entries = 0;
  let totalSize = 0;
  let oldestTimestamp: number | null = null;
  let newestTimestamp: number | null = null;

  try {
    for await (const entry of readDir(cacheDir)) {
      if (!entry.isFile || !entry.name.endsWith('.json')) continue;

      const filePath = `${cacheDir}/${entry.name}`;

      try {
        const fileStat = await stat(filePath);
        entries++;
        totalSize += fileStat.size;

        // Try to read timestamp from cache entry
        const content = await readTextFile(filePath);
        const cached = JSON.parse(content) as CacheEntry;

        if (oldestTimestamp === null || cached.timestamp < oldestTimestamp) {
          oldestTimestamp = cached.timestamp;
        }
        if (newestTimestamp === null || cached.timestamp > newestTimestamp) {
          newestTimestamp = cached.timestamp;
        }
      } catch {
        // Skip files we can't read
      }
    }
  } catch {
    // Cache dir doesn't exist or can't be read
  }

  return { entries, totalSize, oldestTimestamp, newestTimestamp };
}
