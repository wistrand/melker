/**
 * Node.js filesystem operations.
 * Maps node:fs/promises to the runtime-agnostic interface.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import type {
  FileInfo,
  DirEntry,
  FsEvent,
  WriteOptions,
  MkdirOptions,
  RemoveOptions,
  MakeTempOptions,
} from '../types.ts';

export type { FileInfo, DirEntry, FsEvent, WriteOptions, MkdirOptions, RemoveOptions, MakeTempOptions };

// --- Helpers ---

function resolvePath(p: string | URL): string {
  if (p instanceof URL || (typeof p === 'string' && p.startsWith('file://'))) {
    return fileURLToPath(p);
  }
  return p as string;
}

function toFileInfo(stats: fs.Stats): FileInfo {
  return {
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymlink: stats.isSymbolicLink(),
    size: stats.size,
    mtime: stats.mtime,
  };
}

// --- Async operations ---

export async function readTextFile(path: string | URL): Promise<string> {
  return fsp.readFile(resolvePath(path), 'utf-8');
}

export async function writeTextFile(
  path: string | URL,
  data: string,
  options?: WriteOptions,
): Promise<void> {
  const flag = options?.append ? 'a' : 'w';
  await fsp.writeFile(resolvePath(path), data, { flag });
}

export async function readFile(path: string | URL): Promise<Uint8Array> {
  const buf = await fsp.readFile(resolvePath(path));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export async function writeFile(path: string | URL, data: Uint8Array): Promise<void> {
  await fsp.writeFile(resolvePath(path), data);
}

export async function* readDir(dirPath: string | URL): AsyncIterable<DirEntry> {
  const resolved = resolvePath(dirPath);
  const entries = await fsp.readdir(resolved, { withFileTypes: true });
  for (const entry of entries) {
    yield {
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
      isSymlink: entry.isSymbolicLink(),
    };
  }
}

export async function stat(path: string | URL): Promise<FileInfo> {
  const stats = await fsp.stat(resolvePath(path));
  return toFileInfo(stats);
}

export async function lstat(path: string | URL): Promise<FileInfo> {
  const stats = await fsp.lstat(resolvePath(path));
  return toFileInfo(stats);
}

export async function remove(path: string | URL, options?: RemoveOptions): Promise<void> {
  await fsp.rm(resolvePath(path), { recursive: options?.recursive ?? false });
}

export async function mkdir(path: string | URL, options?: MkdirOptions): Promise<void> {
  await fsp.mkdir(resolvePath(path), { recursive: options?.recursive ?? false });
}

export async function makeTempDir(options?: MakeTempOptions): Promise<string> {
  const prefix = options?.prefix ?? '';
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  if (options?.suffix) {
    const renamed = dir + options.suffix;
    await fsp.rename(dir, renamed);
    return renamed;
  }
  return dir;
}

export async function makeTempFile(options?: MakeTempOptions): Promise<string> {
  const prefix = options?.prefix ?? '';
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  const suffix = options?.suffix ?? '';
  const filePath = path.join(dir, `tmp${suffix}`);
  await fsp.writeFile(filePath, '');
  return filePath;
}

interface FsWatcherLike extends AsyncIterable<FsEvent> {
  close(): void;
}

export function watchFs(paths: string | string[]): FsWatcherLike {
  const pathList = Array.isArray(paths) ? paths : [paths];
  const watchers: fs.FSWatcher[] = [];

  // Queue + resolver pattern for async iteration
  const queue: FsEvent[] = [];
  let resolve: ((value: IteratorResult<FsEvent>) => void) | null = null;
  let closed = false;

  function kindMap(eventType: string): string {
    if (eventType === 'change') return 'modify';
    if (eventType === 'rename') return 'create';
    return eventType;
  }

  for (const p of pathList) {
    const watcher = fs.watch(p, { recursive: true }, (eventType, filename) => {
      const event: FsEvent = {
        kind: kindMap(eventType),
        paths: [filename ? path.join(p, filename) : p],
      };
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: event, done: false });
      } else {
        queue.push(event);
      }
    });
    watchers.push(watcher);
  }

  return {
    close() {
      closed = true;
      for (const w of watchers) w.close();
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined as unknown as FsEvent, done: true });
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<FsEvent>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined as unknown as FsEvent, done: true });
          }
          return new Promise<IteratorResult<FsEvent>>((r) => {
            resolve = r;
          });
        },
      };
    },
  };
}

// --- Sync operations ---

export function readTextFileSync(path: string | URL): string {
  return fs.readFileSync(resolvePath(path), 'utf-8');
}

export function writeTextFileSync(path: string | URL, data: string, options?: WriteOptions): void {
  const flag = options?.append ? 'a' : 'w';
  fs.writeFileSync(resolvePath(path), data, { flag });
}

export function readFileSync(path: string | URL): Uint8Array {
  const buf = fs.readFileSync(resolvePath(path));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function statSync(path: string | URL): FileInfo {
  return toFileInfo(fs.statSync(resolvePath(path)));
}

export function removeSync(path: string | URL, options?: RemoveOptions): void {
  fs.rmSync(resolvePath(path), { recursive: options?.recursive ?? false });
}

export function mkdirSync(path: string | URL, options?: MkdirOptions): void {
  fs.mkdirSync(resolvePath(path), { recursive: options?.recursive ?? false });
}

// --- Error predicates ---

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === code;
}

export function isNotFoundError(error: unknown): boolean {
  return hasCode(error, 'ENOENT');
}

export function isAlreadyExistsError(error: unknown): boolean {
  return hasCode(error, 'EEXIST');
}

export function isPermissionError(error: unknown): boolean {
  return hasCode(error, 'EACCES') || hasCode(error, 'EPERM');
}

// --- Permission checks ---

export function hasWritePermission(path: string): boolean {
  const permission = (process as unknown as { permission?: { has(scope: string, ref: string): boolean } }).permission;
  if (!permission) return true; // Permission model not active
  return permission.has('fs.write', path);
}
