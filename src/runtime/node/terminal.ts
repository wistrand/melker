/**
 * Node.js terminal I/O and signal handling.
 * Maps Node.js process.stdin/stdout/stderr to the runtime-agnostic interface.
 *
 * stdin.read() uses process.stdin events with an internal queue to bridge
 * Node's push-based stream to Deno's pull-based read semantics.
 * When setRaw(true) is called, process.stdin is resumed so data events flow.
 */

import * as fs from 'node:fs';
import process from 'node:process';
import * as readline from 'node:readline';

export type Signal = 'SIGINT' | 'SIGTERM' | 'SIGHUP' | 'SIGQUIT' | 'SIGWINCH' | 'SIGKILL';

// Internal queue bridging process.stdin's push events to pull-based read().
let _stdinQueue: Buffer[] = [];
let _stdinWaiter: ((chunk: Buffer | null) => void) | null = null;
let _stdinStarted = false;
let _stdinEnded = false;

function ensureStdinListening(): void {
  if (_stdinStarted) return;
  _stdinStarted = true;

  process.stdin.on('data', (chunk: Buffer) => {
    if (_stdinWaiter) {
      const resolve = _stdinWaiter;
      _stdinWaiter = null;
      resolve(chunk);
    } else {
      _stdinQueue.push(chunk);
    }
  });

  process.stdin.on('end', () => {
    _stdinEnded = true;
    if (_stdinWaiter) {
      const resolve = _stdinWaiter;
      _stdinWaiter = null;
      resolve(null);
    }
  });

  process.stdin.resume();
}

export const stdin = {
  setRaw(mode: boolean): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(mode);
    }
    if (mode) {
      ensureStdinListening();
    }
  },

  read(buf: Uint8Array): Promise<number | null> {
    ensureStdinListening();

    // Return queued data immediately if available
    if (_stdinQueue.length > 0) {
      const chunk = _stdinQueue.shift()!;
      const len = Math.min(chunk.length, buf.length);
      buf.set(chunk.subarray(0, len));
      // If chunk was larger than buf, re-queue the remainder
      if (chunk.length > buf.length) {
        _stdinQueue.unshift(chunk.subarray(buf.length));
      }
      return Promise.resolve(len);
    }

    // EOF already received
    if (_stdinEnded) {
      return Promise.resolve(null);
    }

    // Wait for next data event
    return new Promise<number | null>((resolve) => {
      _stdinWaiter = (chunk: Buffer | null) => {
        if (chunk === null) {
          resolve(null);
        } else {
          const len = Math.min(chunk.length, buf.length);
          buf.set(chunk.subarray(0, len));
          if (chunk.length > buf.length) {
            _stdinQueue.unshift(chunk.subarray(buf.length));
          }
          resolve(len);
        }
      };
    });
  },

  isTerminal(): boolean {
    return process.stdin.isTTY ?? false;
  },
};

export const stdout = {
  write(data: Uint8Array): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const ok = process.stdout.write(Buffer.from(data), (err) => {
        if (err) reject(err);
        else resolve(data.length);
      });
      if (!ok) {
        process.stdout.once('drain', () => {});
      }
    });
  },

  writeSync(data: Uint8Array): number {
    // On POSIX TTYs, process.stdout.write() is synchronous and more reliable
    // than fs.writeSync(1, ...) for terminal escape sequences.
    if (process.stdout.isTTY) {
      process.stdout.write(Buffer.from(data));
      return data.length;
    }
    return fs.writeSync(1, data);
  },

  isTerminal(): boolean {
    return process.stdout.isTTY ?? false;
  },
};

export const stderr = {
  writeSync(data: Uint8Array): number {
    if (process.stderr.isTTY) {
      process.stderr.write(Buffer.from(data));
      return data.length;
    }
    return fs.writeSync(2, data);
  },
};

export function consoleSize(): { columns: number; rows: number } | null {
  if (process.stdout.columns != null && process.stdout.rows != null) {
    return { columns: process.stdout.columns, rows: process.stdout.rows };
  }
  return null;
}

export function addSignalListener(signal: Signal, handler: () => void): void {
  if (signal === 'SIGKILL') return; // Can't listen for SIGKILL
  process.on(signal, handler);
}

export function removeSignalListener(signal: Signal, handler: () => void): void {
  if (signal === 'SIGKILL') return;
  process.removeListener(signal, handler);
}

export function onUncaughtError(handler: (error: Error) => void): void {
  process.on('uncaughtException', (err) => {
    handler(err instanceof Error ? err : new Error(String(err)));
  });
}

export function onUnhandledRejection(handler: (reason: unknown) => void): void {
  process.on('unhandledRejection', (reason) => {
    handler(reason);
  });
}

export function onBeforeExit(handler: () => void): void {
  process.on('exit', handler);
}

/**
 * Async confirm prompt, equivalent to Deno's global confirm().
 * Displays "message [y/N] " and reads a line from stdin via readline.
 * Returns true only if the user types 'y' or 'Y'.
 */
export function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}
