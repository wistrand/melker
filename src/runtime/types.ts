/**
 * Shared type interfaces for the runtime abstraction layer.
 * Both deno/ and node/ implementations use these types.
 */

export interface FileInfo {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: Date | null;
}

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface FsEvent {
  kind: string;
  paths: string[];
}

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
