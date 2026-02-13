/**
 * Kitty Graphics Protocol Types
 */

import type { BaseCapabilities } from '../graphics/detection-base.ts';

/**
 * Kitty terminal capabilities
 */
export interface KittyCapabilities extends BaseCapabilities {
  /** Detection method used */
  detectionMethod: 'query' | 'env' | 'none';
  /** Terminal program name if detected */
  terminalProgram?: string;
}

/**
 * Kitty encode options
 */
export interface KittyEncodeOptions {
  /** RGBA packed pixels */
  pixels: Uint32Array;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Pixel format */
  format?: 'rgb' | 'rgba';
  /** Use zlib compression */
  compress?: boolean;
  /** Image ID for updates/deletion */
  imageId?: number;
  /** Number of terminal columns to display over (for scaling) */
  columns?: number;
  /** Number of terminal rows to display over (for scaling) */
  rows?: number;
}

/**
 * Kitty encoder output
 */
export interface KittyOutput {
  /** Pre-split escape sequence chunks */
  chunks: string[];
  /** Assigned image ID */
  imageId: number;
}

/**
 * Kitty output data for canvas rendering
 */
export interface KittyOutputData {
  /** Complete escape sequence to output */
  data: string;
  /** Bounds of the rendered image in terminal cells */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Image ID for cleanup */
  imageId: number;
  /** Element ID (for tracking) */
  elementId?: string;
}
