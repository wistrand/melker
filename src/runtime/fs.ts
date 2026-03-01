/**
 * Runtime-agnostic filesystem operations.
 * Wraps Deno file system APIs and error classes.
 */

// Re-export Deno types under runtime-agnostic names
export type FileInfo = Deno.FileInfo;
export type DirEntry = Deno.DirEntry;
export type FsEvent = Deno.FsEvent;

export interface WriteOptions {
  append?: boolean;
}

export interface MkdirOptions {
  recursive?: boolean;
}

export interface RemoveOptions {
  recursive?: boolean;
}

export interface MakeTempOptions {
  prefix?: string;
  suffix?: string;
}

// --- Async operations ---

export function readTextFile(path: string | URL): Promise<string> {
  return Deno.readTextFile(path);
}

export function writeTextFile(path: string | URL, data: string, options?: WriteOptions): Promise<void> {
  return Deno.writeTextFile(path, data, options);
}

export function readFile(path: string | URL): Promise<Uint8Array> {
  return Deno.readFile(path);
}

export function writeFile(path: string | URL, data: Uint8Array): Promise<void> {
  return Deno.writeFile(path, data);
}

export function readDir(path: string | URL): AsyncIterable<DirEntry> {
  return Deno.readDir(path);
}

export function stat(path: string | URL): Promise<FileInfo> {
  return Deno.stat(path);
}

export function remove(path: string | URL, options?: RemoveOptions): Promise<void> {
  return Deno.remove(path, options);
}

export function mkdir(path: string | URL, options?: MkdirOptions): Promise<void> {
  return Deno.mkdir(path, options);
}

export function makeTempDir(options?: MakeTempOptions): Promise<string> {
  return Deno.makeTempDir(options);
}

export function makeTempFile(options?: MakeTempOptions): Promise<string> {
  return Deno.makeTempFile(options);
}

export function watchFs(paths: string | string[]): Deno.FsWatcher {
  return Deno.watchFs(paths);
}

// --- Sync operations ---

export function readTextFileSync(path: string | URL): string {
  return Deno.readTextFileSync(path);
}

export function writeTextFileSync(path: string | URL, data: string, options?: WriteOptions): void {
  Deno.writeTextFileSync(path, data, options);
}

export function readFileSync(path: string | URL): Uint8Array {
  return Deno.readFileSync(path);
}

export function statSync(path: string | URL): FileInfo {
  return Deno.statSync(path);
}

export function removeSync(path: string | URL, options?: RemoveOptions): void {
  Deno.removeSync(path, options);
}

export function mkdirSync(path: string | URL, options?: MkdirOptions): void {
  Deno.mkdirSync(path, options);
}

// --- Error predicates ---

export function isNotFoundError(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound;
}

export function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Deno.errors.AlreadyExists;
}

export function isPermissionError(error: unknown): boolean {
  return error instanceof Deno.errors.NotCapable;
}

// --- Permission checks ---

export function hasWritePermission(path: string): boolean {
  return Deno.permissions.querySync({ name: 'write', path }).state === 'granted';
}
