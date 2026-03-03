/**
 * Node.js process utilities.
 * Maps Node.js process APIs to the runtime-agnostic interface.
 */

import { inspect as utilInspect } from 'node:util';
import process from 'node:process';

export type Platform = 'darwin' | 'linux' | 'windows';
export type Arch = 'x86_64' | 'aarch64';

const platformMap: Record<string, Platform> = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'windows',
};

const archMap: Record<string, Arch> = {
  x64: 'x86_64',
  arm64: 'aarch64',
};

export function cwd(): string {
  return process.cwd();
}

export function args(): string[] {
  return process.argv.slice(2);
}

export function exit(code?: number): never {
  process.exit(code);
}

export function platform(): Platform {
  return platformMap[process.platform] ?? 'linux';
}

export function arch(): Arch {
  return archMap[process.arch] ?? 'x86_64';
}

export function runtimeVersion(): string {
  return process.versions.node;
}

export function runtimeName(): string {
  return 'node';
}

export function inspect(value: unknown, options?: { colors?: boolean; depth?: number }): string {
  return utilInspect(value, {
    colors: options?.colors,
    depth: options?.depth,
  });
}

export function execPath(): string {
  return process.execPath;
}

import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function isMainModule(_importMetaMain?: boolean): boolean {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

let _version: string | undefined;
export function melkerVersion(): string {
  if (!_version) {
    const dir = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(dir, '../../../package.json'), 'utf-8'));
    _version = pkg.version;
  }
  return _version;
}
