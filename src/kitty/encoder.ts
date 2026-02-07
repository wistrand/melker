/**
 * Kitty Graphics Protocol Encoder
 *
 * Encodes RGBA pixel buffers to Kitty graphics protocol escape sequences.
 *
 * ## Protocol Format
 *
 * All commands use the Application Programming Command (APC) structure:
 * ```
 * <ESC>_G<control data>;<payload><ESC>\
 * ```
 *
 * - Control data: comma-separated `key=value` pairs
 * - Payload: base64-encoded pixel data
 *
 * ## Chunking
 *
 * Data must be split into chunks no larger than 4096 bytes:
 * - First chunk includes control data
 * - Intermediate chunks: `m=1`
 * - Final chunk: `m=0`
 */

import { encodeBase64 } from '../deps.ts';
import { getLogger } from '../logging.ts';
import type { KittyEncodeOptions, KittyOutput } from './types.ts';

const logger = getLogger('KittyEncoder');

// Maximum chunk size for base64-encoded data
const MAX_CHUNK_SIZE = 4096;

// Image ID counter (auto-incremented)
let nextImageId = 1;

// Reusable byte buffer for pixelsToBytes (grows as needed)
let pixelBytesBuffer: Uint8Array | null = null;

/**
 * Generate a unique image ID
 */
export function generateImageId(): number {
  const id = nextImageId;
  nextImageId = (nextImageId % 0xFFFFFF) + 1; // Wrap at 24-bit
  return id;
}

/**
 * Reset image ID counter (for testing)
 */
export function resetImageIdCounter(): void {
  nextImageId = 1;
}

/**
 * Convert RGBA Uint32Array to raw bytes
 * Melker packs colors as 0xRRGGBBAA: R in high bits, A in low bits
 * See packRGBA() in color-utils.ts
 * Reuses a module-level buffer to avoid allocations.
 */
function pixelsToBytes(pixels: Uint32Array, format: 'rgb' | 'rgba'): Uint8Array {
  const bytesPerPixel = format === 'rgba' ? 4 : 3;
  const requiredSize = pixels.length * bytesPerPixel;

  // Reuse buffer if large enough, otherwise allocate new one
  if (!pixelBytesBuffer || pixelBytesBuffer.length < requiredSize) {
    pixelBytesBuffer = new Uint8Array(requiredSize);
  }

  for (let i = 0; i < pixels.length; i++) {
    const pixel = pixels[i];
    const offset = i * bytesPerPixel;

    // Extract RGBA from packed Uint32 (0xRRGGBBAA)
    pixelBytesBuffer[offset] = (pixel >> 24) & 0xFF;     // R
    pixelBytesBuffer[offset + 1] = (pixel >> 16) & 0xFF; // G
    pixelBytesBuffer[offset + 2] = (pixel >> 8) & 0xFF;  // B
    if (format === 'rgba') {
      pixelBytesBuffer[offset + 3] = pixel & 0xFF;       // A
    }
  }

  // Return a view of only the used portion
  return pixelBytesBuffer.subarray(0, requiredSize);
}

/**
 * Base64 encode a Uint8Array
 * Uses Deno standard library for efficient encoding of large buffers
 */
function base64Encode(data: Uint8Array): string {
  return encodeBase64(data);
}

/**
 * Split base64 string into chunks
 */
function splitIntoChunks(data: string, maxSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += maxSize) {
    chunks.push(data.slice(i, i + maxSize));
  }
  return chunks;
}

/**
 * Build control data string from key-value pairs
 */
function buildControlData(params: Record<string, number | string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
}

/**
 * Encode RGBA buffer to Kitty graphics protocol
 *
 * @param options - Encode options
 * @returns Kitty output with chunks and image ID
 */
export function encodeToKitty(options: KittyEncodeOptions): KittyOutput {
  const {
    pixels,
    width,
    height,
    format = 'rgba',
    imageId = generateImageId(),
    columns,
    rows,
  } = options;

  logger.debug('Encoding to Kitty', {
    width,
    height,
    pixels: pixels.length,
    format,
    imageId,
  });

  // Convert pixels to bytes
  const bytes = pixelsToBytes(pixels, format);

  // Base64 encode
  const base64Data = base64Encode(bytes);

  // Split into chunks
  const dataChunks = splitIntoChunks(base64Data, MAX_CHUNK_SIZE);

  // Build escape sequences
  const chunks: string[] = [];
  const formatCode = format === 'rgba' ? 32 : 24;

  for (let i = 0; i < dataChunks.length; i++) {
    const isFirst = i === 0;
    const isLast = i === dataChunks.length - 1;
    const chunk = dataChunks[i];

    let controlData: string;

    if (isFirst) {
      // First chunk includes full control data
      const params: Record<string, number | string> = {
        a: 'T',           // Transmit and display
        t: 'd',           // Direct transmission
        f: formatCode,    // Format (24=RGB, 32=RGBA)
        s: width,         // Width in pixels
        v: height,        // Height in pixels
        i: imageId,       // Image ID
        q: 2,             // Suppress all responses (prevents terminal echo after exit)
      };

      // Add column/row scaling if specified
      if (columns !== undefined) {
        params.c = columns;  // Display over this many columns
      }
      if (rows !== undefined) {
        params.r = rows;     // Display over this many rows
      }

      if (!isLast) {
        params.m = 1;     // More chunks to come
      }

      controlData = buildControlData(params);
    } else {
      // Subsequent chunks only need m flag
      controlData = isLast ? 'm=0' : 'm=1';
    }

    // Build escape sequence: ESC _ G <control> ; <data> ESC \
    const escapeSeq = `\x1b_G${controlData};${chunk}\x1b\\`;
    chunks.push(escapeSeq);
  }

  logger.debug('Kitty encoding complete', {
    imageId,
    chunks: chunks.length,
    totalBytes: base64Data.length,
  });

  return {
    chunks,
    imageId,
  };
}

/**
 * Add cursor positioning to Kitty chunks
 *
 * Moves cursor to the specified cell position before outputting the image.
 * Uses ANSI cursor position escape: ESC[row;colH
 *
 * @param output - Kitty output from encodeToKitty
 * @param col - Column (1-based)
 * @param row - Row (1-based)
 * @returns Complete escape sequence with positioning
 */
export function positionedKitty(output: KittyOutput, col: number, row: number): string {
  // Move cursor to position (1-based), then output all chunks
  const cursorMove = `\x1b[${row};${col}H`;
  return cursorMove + output.chunks.join('');
}

/**
 * Generate delete command for a Kitty image
 *
 * @param imageId - Image ID to delete
 * @param deleteType - Delete type: 'i' (by ID), 'a' (all), 'z' (z-index)
 * @returns Delete escape sequence
 */
export function deleteKittyImage(imageId?: number, deleteType: 'i' | 'a' | 'z' = 'i'): string {
  const params: Record<string, number | string> = {
    a: 'd',           // Delete action
    d: deleteType,    // Delete what
    q: 2,             // Suppress all responses
  };

  if (imageId !== undefined && deleteType === 'i') {
    params.i = imageId;
  }

  const controlData = buildControlData(params);
  return `\x1b_G${controlData}\x1b\\`;
}

/**
 * Generate delete command for all Kitty images
 */
export function deleteAllKittyImages(): string {
  return deleteKittyImage(undefined, 'a');
}

/**
 * Calculate the number of chunks needed for an image
 *
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param format - Pixel format
 * @returns Number of chunks
 */
export function calculateChunkCount(width: number, height: number, format: 'rgb' | 'rgba' = 'rgba'): number {
  const bytesPerPixel = format === 'rgba' ? 4 : 3;
  const rawBytes = width * height * bytesPerPixel;
  // Base64 expands data by ~4/3
  const base64Size = Math.ceil(rawBytes * 4 / 3);
  return Math.ceil(base64Size / MAX_CHUNK_SIZE);
}
