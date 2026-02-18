// Canvas terminal rendering - re-export hub + dispatcher
// Split into focused sub-modules for maintainability:
//   canvas-render-types.ts     - Shared types, classes, interfaces, constants
//   canvas-render-sextant.ts   - Sextant render path + quantization
//   canvas-render-block.ts     - Block mode (colored spaces)
//   canvas-render-ascii.ts     - ASCII pattern/luma modes
//   canvas-render-isolines.ts  - Contour line rendering
//   canvas-render-dithered.ts  - Dithered buffer rendering
//   canvas-render-graphics.ts  - Sixel/Kitty/iTerm2 protocol handlers

import { type DualBuffer, type Cell } from '../buffer.ts';
import { type Bounds } from '../types.ts';
import { MelkerConfig } from '../config/mod.ts';
import type { CanvasRenderData, CanvasRenderState, ResolvedGfxMode, GfxMode } from './canvas-render-types.ts';
import { getUnicodeTier } from '../utils/terminal-detection.ts';
import { renderGraphicsPlaceholder } from './canvas-render-graphics.ts';
import { renderSextantToTerminal } from './canvas-render-sextant.ts';
import { renderBlockMode } from './canvas-render-block.ts';
import { renderHalfBlockMode } from './canvas-render-halfblock.ts';
import { renderAsciiMode } from './canvas-render-ascii.ts';
import { renderIsolinesToTerminal } from './canvas-render-isolines.ts';
import { renderDitheredToTerminal } from './canvas-render-dithered.ts';

// Re-export everything from sub-modules for backwards compatibility
export * from './canvas-render-types.ts';
export * from './canvas-render-sextant.ts';
export * from './canvas-render-block.ts';
export * from './canvas-render-halfblock.ts';
export * from './canvas-render-ascii.ts';
export * from './canvas-render-isolines.ts';
export * from './canvas-render-dithered.ts';
export * from './canvas-render-graphics.ts';

/**
 * Main entry point for canvas terminal rendering.
 * Dispatches to appropriate render mode based on config and dither state.
 */
export function renderToTerminal(
  bounds: Bounds,
  style: Partial<Cell>,
  buffer: DualBuffer,
  data: CanvasRenderData,
  state: CanvasRenderState,
  ditheredBuffer: Uint8Array | null,
  gfxMode: ResolvedGfxMode
): void {
  let terminalWidth = Math.min(data.propsWidth, bounds.width);
  const terminalHeight = Math.min(data.propsHeight, bounds.height);

  // Workaround for terminal edge rendering glitch
  const engine = globalThis.melkerEngine;
  if (engine && bounds.x + terminalWidth >= engine.terminalSize?.width) {
    terminalWidth = Math.max(1, terminalWidth - 1);
  }

  // Graphics mode: fill with placeholder, actual overlay is handled by engine
  if (gfxMode === 'sixel' || gfxMode === 'kitty' || gfxMode === 'iterm2') {
    renderGraphicsPlaceholder(bounds, style, buffer, terminalWidth, terminalHeight, data);
    return;
  }

  // Check for dithered rendering mode
  if (ditheredBuffer) {
    renderDitheredToTerminal(bounds, style, buffer, ditheredBuffer, gfxMode, data, state);
    return;
  }

  // Half-block mode: 1x2 pixels per cell using ▀▄█ characters
  if (gfxMode === 'halfblock') {
    renderHalfBlockMode(bounds, style, buffer, terminalWidth, terminalHeight, data);
    return;
  }

  // Block mode: 1 colored space per cell instead of sextant characters
  if (gfxMode === 'block') {
    renderBlockMode(bounds, style, buffer, terminalWidth, terminalHeight, data);
    return;
  }

  // ASCII mode: pattern (spatial mapping) or luma (brightness-based)
  if (gfxMode === 'pattern' || gfxMode === 'luma') {
    renderAsciiMode(bounds, style, buffer, terminalWidth, terminalHeight, gfxMode, data);
    return;
  }

  // Isolines mode: render contour lines using marching squares
  if (gfxMode === 'isolines' || gfxMode === 'isolines-filled') {
    renderIsolinesToTerminal(bounds, style, buffer, data, {}, gfxMode === 'isolines-filled');
    return;
  }

  // Default: sextant rendering
  renderSextantToTerminal(bounds, style, buffer, data, state);
}

/**
 * Get effective graphics mode from config and props.
 * Falls back to sextant if sixel/kitty/iterm2 is requested but not available.
 */
export function getEffectiveGfxMode(
  propsGfxMode?: GfxMode
): ResolvedGfxMode {
  const globalGfxMode = MelkerConfig.get().gfxMode as GfxMode | undefined;
  const requested = globalGfxMode || propsGfxMode || 'sextant';

  const engine = globalThis.melkerEngine;
  const kittySupported = engine?.kittyCapabilities?.supported ?? false;
  const sixelSupported = engine?.sixelCapabilities?.supported ?? false;
  const itermSupported = engine?.itermCapabilities?.supported ?? false;

  const tier = getUnicodeTier();
  const sextantFallback: ResolvedGfxMode =
    tier === 'full' ? 'sextant' : tier === 'basic' ? 'halfblock' : 'block';

  // hires: try kitty → sixel → iterm2 → sextant (best available high-resolution mode)
  if (requested === 'hires') {
    if (kittySupported) {
      return 'kitty';
    }
    if (sixelSupported) {
      return 'sixel';
    }
    if (itermSupported) {
      return 'iterm2';
    }
    return sextantFallback;
  }

  // kitty: falls back directly to sextant
  if (requested === 'kitty') {
    if (!kittySupported) {
      return sextantFallback;
    }
    return 'kitty';
  }

  // sixel: falls back to sextant
  if (requested === 'sixel') {
    if (!sixelSupported) {
      return sextantFallback;
    }
    return 'sixel';
  }

  // iterm2: falls back to sextant
  if (requested === 'iterm2') {
    if (!itermSupported) {
      return sextantFallback;
    }
    return 'iterm2';
  }

  // isolines and isolines-filled: no capability check needed
  if (requested === 'isolines' || requested === 'isolines-filled') {
    return requested;
  }

  // sextant needs full unicode (sextant chars U+1FB00+)
  if (requested === 'sextant' && tier !== 'full') {
    return tier === 'basic' ? 'halfblock' : 'block';
  }

  // halfblock needs basic unicode (▀▄ chars)
  if (requested === 'halfblock' && tier === 'ascii') {
    return 'block';
  }

  return requested;
}
