// Canvas render types - shared types, interfaces, classes, and constants
// Extracted from canvas-render.ts for modularity

import { type Cell } from '../buffer.ts';
import { type Bounds } from '../types.ts';
import {
  type KittyCapabilities,
  generateImageId,
} from '../kitty/mod.ts';

// Minimal interface for canvas data needed by render functions
export interface CanvasRenderData {
  colorBuffer: Uint32Array;
  imageColorBuffer: Uint32Array;
  bufferWidth: number;
  bufferHeight: number;
  scale: number;
  propsWidth: number;
  propsHeight: number;
  backgroundColor?: number | string;
}

/**
 * Reusable cache for graphics output (kitty/iTerm2).
 * Tracks content hash, bounds, compositing buffer, and cached output to skip re-encoding.
 */
export class GraphicsOutputCache<T> {
  private _contentHash: number = 0;
  private _cachedOutput: T | null = null;
  private _cachedBounds: { x: number; y: number; width: number; height: number } | null = null;
  private _compositedBuffer: Uint32Array | null = null;

  getCompositedBuffer(pixelCount: number): Uint32Array {
    if (!this._compositedBuffer || this._compositedBuffer.length < pixelCount) {
      this._compositedBuffer = new Uint32Array(pixelCount);
    }
    return this._compositedBuffer;
  }

  getCachedOutput(contentHash: number, bounds: { x: number; y: number; width: number; height: number }): T | null {
    if (
      this._cachedOutput &&
      this._contentHash === contentHash &&
      this._cachedBounds &&
      this._cachedBounds.x === bounds.x &&
      this._cachedBounds.y === bounds.y &&
      this._cachedBounds.width === bounds.width &&
      this._cachedBounds.height === bounds.height
    ) {
      return this._cachedOutput;
    }
    return null;
  }

  setCachedOutput(contentHash: number, bounds: { x: number; y: number; width: number; height: number }, output: T): void {
    this._contentHash = contentHash;
    this._cachedBounds = { ...bounds };
    this._cachedOutput = output;
  }

  invalidate(): void {
    this._contentHash = 0;
    this._cachedOutput = null;
    this._cachedBounds = null;
  }
}

/**
 * Sixel output data for a canvas element
 */
export interface SixelOutputData {
  /** Positioned sixel sequence (includes cursor save/restore) */
  data: string;
  /** Canvas bounds for occlusion detection */
  bounds: Bounds;
  /** Element ID for tracking */
  elementId?: string;
}

/**
 * Kitty output data for a canvas element
 */
export interface KittyOutputData {
  /** Positioned kitty sequence (includes cursor positioning) */
  data: string;
  /** Canvas bounds for occlusion detection */
  bounds: Bounds;
  /** Image ID for cleanup/deletion */
  imageId: number;
  /** Element ID for tracking */
  elementId?: string;
  /** True if this output is from cache (already displayed, skip writing) */
  fromCache?: boolean;
}

/**
 * iTerm2 output data for a canvas element
 */
export interface ITermOutputData {
  /** Positioned iTerm2 sequence (includes cursor positioning) */
  data: string;
  /** Canvas bounds for occlusion detection */
  bounds: Bounds;
  /** Element ID for tracking */
  elementId?: string;
  /** True if this output is from cache (already displayed, skip writing) */
  fromCache?: boolean;
}

/**
 * Pre-allocated state for canvas rendering operations.
 * Created once per CanvasElement instance to avoid GC pressure in hot paths.
 */
export class CanvasRenderState {
  // Working arrays for _renderToTerminal (avoid per-cell allocations)
  readonly drawingPixels: boolean[] = [false, false, false, false, false, false];
  readonly drawingColors: number[] = [0, 0, 0, 0, 0, 0];
  readonly imagePixels: boolean[] = [false, false, false, false, false, false];
  readonly imageColors: number[] = [0, 0, 0, 0, 0, 0];
  readonly sextantPixels: boolean[] = [false, false, false, false, false, false];
  readonly compositePixels: boolean[] = [false, false, false, false, false, false];
  readonly compositeColors: number[] = [0, 0, 0, 0, 0, 0];
  readonly isDrawing: boolean[] = [false, false, false, false, false, false];

  // Reusable cell style object
  readonly cellStyle: Partial<Cell> = {};

  // Quantization buffers
  readonly qPixels: boolean[] = [false, false, false, false, false, false];
  readonly qBrightness: number[] = [0, 0, 0, 0, 0, 0];
  qFgColor: number = 0;
  qBgColor: number = 0;

  // Kitty and iTerm2 output caches
  readonly kittyCache = new GraphicsOutputCache<KittyOutputData>();
  readonly itermCache = new GraphicsOutputCache<ITermOutputData>();

  // Stable image ID for this canvas - reused across frames to enable in-place replacement
  // This eliminates flicker from the display+delete cycle that occurs with new IDs each frame
  private _kittyStableImageId: number = generateImageId();

  /**
   * Compute a fast hash of a Uint32Array buffer.
   * Uses FNV-1a variant for speed with reasonable collision resistance.
   */
  computeBufferHash(buffer: Uint32Array, length: number): number {
    let hash = 2166136261; // FNV offset basis
    for (let i = 0; i < length; i++) {
      hash ^= buffer[i];
      hash = Math.imul(hash, 16777619); // FNV prime
    }
    return hash >>> 0; // Convert to unsigned
  }

  /**
   * Get stable image ID for this canvas.
   * Reusing the same ID across frames allows Kitty to replace images in-place,
   * eliminating flicker from the display+delete cycle.
   */
  getKittyStableImageId(): number {
    return this._kittyStableImageId;
  }
}

/** All graphics rendering modes (single source of truth) */
export const GFX_MODES = ['sextant', 'block', 'pattern', 'luma', 'sixel', 'kitty', 'iterm2', 'hires', 'isolines', 'isolines-filled'] as const;

/** Graphics rendering mode (user-facing, includes 'hires' auto-select) */
export type GfxMode = typeof GFX_MODES[number];

/** Resolved graphics modes (after 'hires' is expanded to actual mode) */
export const RESOLVED_GFX_MODES = ['sextant', 'block', 'pattern', 'luma', 'sixel', 'kitty', 'iterm2', 'isolines', 'isolines-filled'] as const;

/** Resolved graphics mode type */
export type ResolvedGfxMode = typeof RESOLVED_GFX_MODES[number];
