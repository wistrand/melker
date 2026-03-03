/**
 * Node.js environment variable access.
 * Wraps process.env.
 */

import process from 'node:process';

export function envGet(name: string): string | undefined {
  return process.env[name];
}

export function envSet(name: string, value: string): void {
  process.env[name] = value;
}

export function envDelete(name: string): void {
  delete process.env[name];
}

export function envToObject(): Record<string, string> {
  return { ...process.env } as Record<string, string>;
}
