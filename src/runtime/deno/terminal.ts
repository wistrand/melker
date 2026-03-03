/**
 * Runtime-agnostic terminal I/O and signal handling.
 * Wraps Deno.stdin, Deno.stdout, Deno.stderr, Deno.consoleSize, and signal listeners.
 */

export type Signal = 'SIGINT' | 'SIGTERM' | 'SIGHUP' | 'SIGQUIT' | 'SIGWINCH' | 'SIGKILL';

export const stdin = {
  setRaw(mode: boolean): void {
    Deno.stdin.setRaw(mode);
  },
  read(buf: Uint8Array): Promise<number | null> {
    return Deno.stdin.read(buf);
  },
  isTerminal(): boolean {
    return Deno.stdin.isTerminal();
  },
};

export const stdout = {
  write(data: Uint8Array): Promise<number> {
    return Deno.stdout.write(data);
  },
  writeSync(data: Uint8Array): number {
    return Deno.stdout.writeSync(data);
  },
  isTerminal(): boolean {
    return Deno.stdout.isTerminal();
  },
};

export const stderr = {
  writeSync(data: Uint8Array): number {
    return Deno.stderr.writeSync(data);
  },
};

export function consoleSize(): { columns: number; rows: number } | null {
  try {
    return Deno.consoleSize();
  } catch {
    return null;
  }
}

export function addSignalListener(signal: Signal, handler: () => void): void {
  Deno.addSignalListener(signal, handler);
}

export function removeSignalListener(signal: Signal, handler: () => void): void {
  Deno.removeSignalListener(signal, handler);
}

export function onUncaughtError(handler: (error: Error) => void): void {
  globalThis.addEventListener('error', (event) => {
    const err = event.error instanceof Error ? event.error : new Error(String(event.error));
    handler(err);
  });
}

export function onUnhandledRejection(handler: (reason: unknown) => void): void {
  globalThis.addEventListener('unhandledrejection', (event) => {
    handler(event.reason);
  });
}

export function onBeforeExit(handler: () => void): void {
  try {
    globalThis.addEventListener('beforeunload', handler);
  } catch {
    // beforeunload might not be available in older Deno versions
  }
}

export function confirm(message: string): Promise<boolean> {
  return Promise.resolve(globalThis.confirm(message));
}
