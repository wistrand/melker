/**
 * Runtime abstraction layer.
 *
 * Thin wrappers around Deno-specific APIs to prepare for possible Node/Bun support.
 * On Deno these are near-zero-overhead delegations. On other runtimes the
 * implementations would change while keeping the same interface.
 */

export * from './process.ts';
export * from './fs.ts';
export * from './terminal.ts';
export { Command } from './command.ts';
export type { CommandOptions, CommandOutput, CommandStatus, ChildProcess } from './command.ts';
