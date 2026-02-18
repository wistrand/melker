// Canvas dithering - buffer compositing and dithering algorithms
// Extracted from canvas.ts to reduce file size

import { applyDither, type DitherMode } from '../video/dither.ts';
import { getCurrentTheme } from '../theme.ts';
import { MelkerConfig } from '../config/mod.ts';
import { TRANSPARENT, unpackRGBA, parseColor } from './color-utils.ts';

/**
 * Dither state - manages cache for dithered buffer
 */
export class DitherState {
  cache: Uint8Array | null = null;
  cacheValid: boolean = false;
  lastDitherMode: DitherMode | boolean | undefined = undefined;
  lastDitherBits: number | undefined = undefined;

  /**
   * Invalidate the dither cache, forcing re-computation on next render
   */
  invalidate(): void {
    this.cacheValid = false;
  }

  /**
   * Reset state completely (e.g., after resize)
   */
  reset(): void {
    this.cache = null;
    this.cacheValid = false;
  }
}

/**
 * Data needed for dither buffer preparation
 */
export interface DitherData {
  colorBuffer: Uint32Array;
  imageColorBuffer: Uint32Array;
  bufferWidth: number;
  bufferHeight: number;
  ditherMode: DitherMode | boolean | undefined;
  ditherBits: number | undefined;
  backgroundColor: number | string | undefined;
  isDirty: boolean;
  shaderActive: boolean;
}

/**
 * Prepare a dithered buffer by compositing drawing and image layers,
 * then applying the specified dithering algorithm.
 * Returns null if dithering is not enabled, allowing original behavior.
 */
export function prepareDitheredBuffer(
  data: DitherData,
  state: DitherState
): Uint8Array | null {
  let ditherMode = data.ditherMode;

  // Handle 'auto' mode based on config and theme
  // Track if original mode was 'auto' for dither.bits handling
  const wasAutoMode = ditherMode === 'auto';
  if (ditherMode === 'auto') {
    // config dither.algorithm is always respected (any theme, any dither type)
    const config = MelkerConfig.get();
    const configDither = config.ditherAlgorithm;
    // dither.bits implies user wants dithering
    const configBits = config.ditherBits;

    if (configDither) {
      ditherMode = configDither as DitherMode;
    } else if (configBits !== undefined) {
      // User specified bits but not algorithm - use default algorithm
      ditherMode = 'sierra-stable';
    } else {
      // No env override - use theme-based defaults
      const theme = getCurrentTheme();
      if (theme.type === 'fullcolor') {
        // Fullcolor: no dithering needed, use passthrough mode
        // Still use dithered path to properly handle drawImage() content
        ditherMode = 'none';
      } else if (theme.colorSupport === '16') {
        // 16-color: shade chars (░▒▓) provide sub-cell color blending,
        // which conflicts with spatial dithering — skip dithering
        ditherMode = 'none';
      } else {
        // bw, gray, or color themes: default to sierra-stable
        ditherMode = 'sierra-stable';
      }
    }
  }

  // No dithering if not specified or explicitly disabled
  // Note: !ditherMode handles false, undefined, and empty string
  // Exception: dither="auto" sets ditherMode='none' for fullcolor - still need dithered path
  if (!ditherMode) {
    if (!data.shaderActive) {
      return null;
    }
  }
  // ditherMode='none' means passthrough (no dithering but use dithered rendering path)

  // Compute effective bits early for cache invalidation
  // Priority: prop > env var (if auto mode) > theme-based default (if auto mode) > fallback
  let effectiveBits: number;
  if (data.ditherBits !== undefined) {
    effectiveBits = data.ditherBits;
  } else if (wasAutoMode) {
    // Check config dither.bits when dither="auto" was used
    const configBits = MelkerConfig.get().ditherBits;
    if (configBits !== undefined) {
      effectiveBits = configBits;
      if (effectiveBits < 1 || effectiveBits > 8) effectiveBits = 1;
    } else {
      // Theme-based defaults
      const theme = getCurrentTheme();
      switch (theme.type) {
        case 'bw': effectiveBits = 1; break;       // 2 levels (black/white)
        case 'gray': effectiveBits = 2; break;     // 4 levels of gray
        case 'color16': effectiveBits = 2; break;  // 4 levels — 16 ANSI colors
        case 'color': effectiveBits = 3; break;    // 8 levels per channel
        case 'fullcolor': effectiveBits = 6; break; // 64 levels (subtle dithering)
        default: effectiveBits = 1;
      }
    }
  } else {
    effectiveBits = 1;
  }

  // Invalidate cache if content changed (drawing methods set _isDirty)
  // For active shaders, ALWAYS invalidate - external events can trigger renders
  // between shader write and our scheduled render, consuming _isDirty flag
  if (data.isDirty || data.shaderActive) {
    state.cacheValid = false;
  }

  // Check if dither settings changed
  if (state.lastDitherMode !== ditherMode || state.lastDitherBits !== effectiveBits) {
    state.cacheValid = false;
    state.lastDitherMode = ditherMode;
    state.lastDitherBits = effectiveBits;
  }

  // Return cached result if still valid
  if (state.cacheValid && state.cache) {
    return state.cache;
  }

  const bufW = data.bufferWidth;
  const bufH = data.bufferHeight;
  const bufferSize = bufW * bufH;

  // Allocate or reuse cache buffer (RGBA format: 4 bytes per pixel)
  if (!state.cache || state.cache.length !== bufferSize * 4) {
    state.cache = new Uint8Array(bufferSize * 4);
  }

  const cache = state.cache;

  // Composite drawing layer over image layer into RGBA buffer
  for (let i = 0; i < bufferSize; i++) {
    const drawingColor = data.colorBuffer[i];
    const imageColor = data.imageColorBuffer[i];
    const dstIdx = i * 4;

    let color: number;
    if (drawingColor !== TRANSPARENT) {
      // Drawing layer takes priority
      color = drawingColor;
    } else if (imageColor !== TRANSPARENT) {
      // Fall back to image layer (already pre-blended for alpha)
      color = imageColor;
    } else {
      // Transparent - use background or fully transparent
      const bgColor = data.backgroundColor;
      if (bgColor) {
        color = parseColor(bgColor) ?? TRANSPARENT;
      } else {
        // Fully transparent
        cache[dstIdx] = 0;
        cache[dstIdx + 1] = 0;
        cache[dstIdx + 2] = 0;
        cache[dstIdx + 3] = 0;
        continue;
      }
    }

    // Unpack RGBA from packed uint32
    const rgba = unpackRGBA(color);
    cache[dstIdx] = rgba.r;
    cache[dstIdx + 1] = rgba.g;
    cache[dstIdx + 2] = rgba.b;
    cache[dstIdx + 3] = rgba.a;
  }

  // Apply dithering algorithm (effectiveBits computed earlier for cache check)
  if (ditherMode) {
    applyDither(cache, bufW, bufH, effectiveBits, ditherMode);
  }

  state.cacheValid = true;
  return cache;
}
