/**
 * iTerm2 Inline Images Protocol Types
 *
 * The iTerm2 protocol uses OSC escape sequences to display images inline:
 * ESC ] 1337 ; File = [params] : <base64-data> BEL
 *
 * Unlike Kitty/Sixel which take raw pixels, iTerm2 expects encoded image
 * files (PNG, JPEG, GIF, etc.) as the payload.
 */

import type { BaseCapabilities } from '../graphics/detection-base.ts';

/**
 * iTerm2 terminal capabilities
 */
export interface ITermCapabilities extends BaseCapabilities {
  /** Detection method used */
  detectionMethod: 'env' | 'query' | 'none';
  /** Terminal program name if detected */
  terminalProgram?: string;
  /** Whether multipart mode should be used (for tmux compatibility) */
  useMultipart: boolean;
  /** Cell size in pixels (if detected) */
  cellWidth?: number;
  cellHeight?: number;
}

/**
 * iTerm2 encode options
 */
export interface ITermEncodeOptions {
  /** RGBA packed pixels (will be encoded to PNG) */
  pixels: Uint32Array;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Display width (cells, 'Npx', 'N%', or 'auto') */
  displayWidth?: number | string;
  /** Display height (cells, 'Npx', 'N%', or 'auto') */
  displayHeight?: number | string;
  /** Preserve aspect ratio (default: true) */
  preserveAspectRatio?: boolean;
  /** Use multipart mode for large images/tmux compatibility */
  useMultipart?: boolean;
  /** Optional filename (base64 encoded in output) */
  filename?: string;
}

/**
 * iTerm2 encode options for pre-encoded image data (PNG passthrough)
 */
export interface ITermEncodeImageOptions {
  /** Pre-encoded image bytes (PNG, JPEG, GIF, etc.) */
  imageData: Uint8Array;
  /** Display width (cells, 'Npx', 'N%', or 'auto') */
  displayWidth?: number | string;
  /** Display height (cells, 'Npx', 'N%', or 'auto') */
  displayHeight?: number | string;
  /** Preserve aspect ratio (default: true) */
  preserveAspectRatio?: boolean;
  /** Use multipart mode for large images/tmux compatibility */
  useMultipart?: boolean;
  /** Optional filename (base64 encoded in output) */
  filename?: string;
}

/**
 * iTerm2 encoder output
 */
export interface ITermOutput {
  /** Escape sequence(s) to output */
  sequences: string[];
  /** Cached PNG bytes (for reuse/caching) */
  pngBytes?: Uint8Array;
  /** Total size in bytes */
  totalBytes: number;
}

/**
 * iTerm2 output data for canvas rendering
 */
export interface ITermOutputData {
  /** Complete escape sequence(s) to output */
  data: string;
  /** Bounds of the rendered image in terminal cells */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Element ID (for tracking) */
  elementId?: string;
  /** Cached PNG bytes (for content caching) */
  pngBytes?: Uint8Array;
}

/**
 * Maximum single-sequence payload size (1MB)
 * Larger images should use multipart mode
 */
export const ITERM_MAX_SEQUENCE_SIZE = 1048576;

/**
 * Multipart chunk size (safe for most terminals)
 */
export const ITERM_MULTIPART_CHUNK_SIZE = 65536;
