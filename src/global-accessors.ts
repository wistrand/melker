// Typed accessors for global variables
// Avoids 'declare global' which JSR rejects in published packages.
// All globalThis access goes through these functions.

import type { MelkerEngine } from './engine.ts';
import type { MelkerLogger } from './globals.d.ts';

// deno-lint-ignore no-explicit-any
const g = globalThis as any;

export function getGlobalEngine(): MelkerEngine | undefined {
  return g.melkerEngine;
}

export function setGlobalEngine(engine: MelkerEngine): void {
  g.melkerEngine = engine;
}

export function getGlobalRequestRender(): (() => void) | undefined {
  return g.__melkerRequestRender;
}

export function setGlobalRequestRender(fn: (() => void) | undefined): void {
  g.__melkerRequestRender = fn;
}

export function getGlobalRenderCount(): number | undefined {
  return g.melkerRenderCount;
}

export function setGlobalRenderCount(count: number): void {
  g.melkerRenderCount = count;
}

export function getGlobalLogger(): MelkerLogger | undefined {
  return g.logger;
}

export function setGlobalEmergencyCleanup(fn: (() => void) | undefined): void {
  g._melkerEmergencyCleanup = fn;
}
