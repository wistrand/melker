/**
 * Runtime-agnostic subprocess execution.
 * Wraps Deno.Command.
 */

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

export class Command {
  private _cmd: Deno.Command;

  constructor(command: string, options?: CommandOptions) {
    this._cmd = new Deno.Command(command, options);
  }

  output(): Promise<CommandOutput> {
    return this._cmd.output();
  }

  spawn(): ChildProcess {
    return this._cmd.spawn();
  }
}
