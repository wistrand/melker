/**
 * Node.js subprocess execution.
 * Maps child_process.spawn to the runtime-agnostic Command interface.
 * Uses Web Streams to wrap Node.js streams.
 */

import { spawn, type ChildProcess as NodeChildProcess, type StdioOptions } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

export interface CommandOptions {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: 'piped' | 'null' | 'inherit';
  stdout?: 'piped' | 'null' | 'inherit';
  stderr?: 'piped' | 'null' | 'inherit';
}

export interface CommandOutput {
  success: boolean;
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

export type CommandStatus = {
  success: boolean;
  code: number;
};

export type ProcessSignal =
  | 'SIGINT' | 'SIGTERM' | 'SIGHUP' | 'SIGQUIT'
  | 'SIGKILL' | 'SIGWINCH' | 'SIGPIPE' | 'SIGUSR1' | 'SIGUSR2'
  | 'SIGSTOP' | 'SIGCONT';

export interface ChildProcess {
  readonly stdin: WritableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly status: Promise<CommandStatus>;
  readonly pid: number;
  kill(signo?: ProcessSignal): void;
  output(): Promise<CommandOutput>;
  ref(): void;
  unref(): void;
}

// --- Stream adapters ---

function toReadableStream(readable: Readable | null): ReadableStream<Uint8Array> {
  if (!readable) {
    return new ReadableStream({ start(controller) { controller.close(); } });
  }
  // Use Node's built-in Readable.toWeb() for correct stream bridging.
  // The manual event-listener approach has timing issues where 'end' can fire
  // before the ReadableStream consumer starts reading.
  return Readable.toWeb(readable) as ReadableStream<Uint8Array>;
}

function toWritableStream(writable: Writable | null): WritableStream<Uint8Array> {
  if (!writable) {
    return new WritableStream();
  }
  return Writable.toWeb(writable) as WritableStream<Uint8Array>;
}

// --- Stdio mapping ---

function mapStdio(value: 'piped' | 'null' | 'inherit' | undefined): 'pipe' | 'ignore' | 'inherit' {
  if (value === 'piped') return 'pipe';
  if (value === 'null') return 'ignore';
  if (value === 'inherit') return 'inherit';
  return 'inherit';
}

// --- Collect stream chunks ---

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export class Command {
  private _command: string;
  private _options: CommandOptions;

  constructor(command: string, options?: CommandOptions) {
    this._command = command;
    this._options = options ?? {};
  }

  async output(): Promise<CommandOutput> {
    const child = this.spawn();
    const [stdoutData, stderrData, status] = await Promise.all([
      collectStream(child.stdout),
      collectStream(child.stderr),
      child.status,
    ]);
    return {
      success: status.success,
      code: status.code,
      stdout: stdoutData,
      stderr: stderrData,
    };
  }

  spawn(): ChildProcess {
    const args = this._options.args ?? [];
    const stdio: StdioOptions = [
      mapStdio(this._options.stdin),
      mapStdio(this._options.stdout ?? 'piped'),
      mapStdio(this._options.stderr ?? 'piped'),
    ];

    const proc = spawn(this._command, args, {
      cwd: this._options.cwd,
      env: this._options.env,
      stdio,
    });

    const stdinStream = toWritableStream(proc.stdin);
    const stdoutStream = toReadableStream(proc.stdout);
    const stderrStream = toReadableStream(proc.stderr);

    const statusPromise = new Promise<CommandStatus>((resolve) => {
      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          code: code ?? 1,
        });
      });
      proc.on('error', () => {
        resolve({
          success: false,
          code: 1,
        });
      });
    });

    const pid = proc.pid ?? -1;

    return {
      get stdin() { return stdinStream; },
      get stdout() { return stdoutStream; },
      get stderr() { return stderrStream; },
      get status() { return statusPromise; },
      get pid() { return pid; },
      kill(signo?: ProcessSignal) {
        proc.kill(signo as NodeJS.Signals);
      },
      async output(): Promise<CommandOutput> {
        const [stdoutData, stderrData, status] = await Promise.all([
          collectStream(stdoutStream),
          collectStream(stderrStream),
          statusPromise,
        ]);
        return {
          success: status.success,
          code: status.code,
          stdout: stdoutData,
          stderr: stderrData,
        };
      },
      ref() { proc.ref(); },
      unref() { proc.unref(); },
    };
  }
}
