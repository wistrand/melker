// File Browser - Utility functions for directory loading and file operations

import { join, dirname } from 'https://deno.land/std@0.208.0/path/mod.ts';
import { getLogger } from '../../logging.ts';
import type {
  FileEntry,
  LoadResult,
  LoadOptions,
  FileErrorEvent,
  FileErrorCode,
} from './file-entry.ts';

const logger = getLogger('file-browser');

/**
 * Load directory contents with error handling
 */
export async function loadDirectory(
  path: string,
  options: LoadOptions
): Promise<LoadResult> {
  const entries: FileEntry[] = [];

  try {
    for await (const entry of Deno.readDir(path)) {
      // Skip hidden files unless showHidden is true
      if (!options.showHidden && entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = join(path, entry.name);

      // Stat may fail for individual entries (permission, broken symlink)
      try {
        const stat = await Deno.stat(fullPath);

        // Apply extension filter for files
        if (!entry.isDirectory && options.extensions && options.extensions.length > 0) {
          const ext = getExtension(entry.name);
          if (!options.extensions.includes(ext)) {
            continue;
          }
        }

        entries.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory,
          isSymlink: entry.isSymlink,
          size: stat.size,
          modified: stat.mtime,
          icon: entry.isDirectory ? '[D]' : '[F]',
        });
      } catch (statError) {
        // Log but continue - don't fail entire directory for one bad entry
        logger.warn(`FileBrowser: Cannot stat ${fullPath}: ${(statError as Error).message}`);
        // Still add entry with unknown size/date
        entries.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory,
          isSymlink: entry.isSymlink,
          size: -1,
          modified: null,
          icon: entry.isDirectory ? '[D]' : '[?]',
        });
      }
    }
  } catch (error) {
    // Directory read failed entirely
    logger.error(`FileBrowser: Cannot read directory ${path}: ${(error as Error).message}`);
    return {
      entries: [],
      error: {
        type: 'error',
        path,
        code: classifyError(error as Error),
        message: formatErrorMessage(error as Error, path),
        targetId: '',
      },
    };
  }

  // Sort: directories first, then alphabetically (case-insensitive)
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  return { entries, error: null };
}

/**
 * Classify an error into a FileErrorCode
 */
export function classifyError(error: Error): FileErrorCode {
  const msg = error.message.toLowerCase();
  if (msg.includes('permission denied') || msg.includes('access denied')) {
    return 'PERMISSION_DENIED';
  }
  if (msg.includes('no such file') || msg.includes('not found')) {
    return 'NOT_FOUND';
  }
  if (msg.includes('not a directory')) {
    return 'NOT_DIRECTORY';
  }
  return 'UNKNOWN';
}

/**
 * Format a user-friendly error message
 */
export function formatErrorMessage(error: Error, path: string): string {
  const code = classifyError(error);
  switch (code) {
    case 'PERMISSION_DENIED':
      return `Permission denied: ${path}`;
    case 'NOT_FOUND':
      return `Directory not found: ${path}`;
    case 'NOT_DIRECTORY':
      return `Not a directory: ${path}`;
    default:
      return `Cannot read directory: ${error.message}`;
  }
}

/**
 * Get file extension including the dot
 */
export function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0) return '';
  return filename.substring(lastDot).toLowerCase();
}

/**
 * Format file size for display
 */
export function formatSize(bytes: number): string {
  if (bytes < 0) return '?';
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);

  if (i === 0) return `${bytes} B`;
  return `${size.toFixed(1)} ${units[i]}`;
}

/**
 * Format modification date for display
 */
export function formatDate(date: Date | null): string {
  if (!date) return '?';

  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  // If within last 24 hours, show time
  if (diff < dayMs) {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  // If within current year, show month and day
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  // Otherwise show full date
  return date.toLocaleDateString('en-US', {
    year: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Get parent directory path
 */
export function getParentPath(path: string): string {
  return dirname(path);
}

/**
 * Check if path is the root directory
 */
export function isRootPath(path: string): boolean {
  return path === '/' || path === dirname(path);
}

// Re-export join for convenience
export { join };
