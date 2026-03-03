/**
 * Runtime abstraction layer.
 *
 * Re-exports the active runtime implementation. For Deno this delegates to
 * ./deno/mod.ts. For Node.js it will delegate to ./node/mod.ts (future).
 *
 * All source files outside src/runtime/ import from this module.
 * This is the single file that changes when selecting a different runtime.
 */

export * from './deno/mod.ts';
