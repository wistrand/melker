/**
 * Runtime-agnostic process utilities.
 * Wraps Deno.cwd, Deno.args, Deno.exit, Deno.build, Deno.version, Deno.inspect, Deno.execPath.
 */

export type Platform = 'darwin' | 'linux' | 'windows';
export type Arch = 'x86_64' | 'aarch64';

export function cwd(): string {
  return Deno.cwd();
}

export function args(): string[] {
  return Deno.args;
}

export function exit(code?: number): never {
  Deno.exit(code);
}

export function platform(): Platform {
  return Deno.build.os as Platform;
}

export function arch(): Arch {
  return Deno.build.arch as Arch;
}

export function runtimeVersion(): string {
  return Deno.version.deno;
}

export function runtimeName(): string {
  return 'deno';
}

export function inspect(value: unknown, options?: { colors?: boolean; depth?: number }): string {
  return Deno.inspect(value, options);
}

export function execPath(): string {
  return Deno.execPath();
}
