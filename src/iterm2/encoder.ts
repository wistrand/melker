/**
 * iTerm2 Inline Images Protocol Encoder
 *
 * Encodes pixel buffers to iTerm2 inline images escape sequences.
 *
 * ## Protocol Format
 *
 * Single sequence (for images < 1MB):
 * ```
 * ESC ] 1337 ; File = [params] : <base64-data> BEL
 * ```
 *
 * Multipart sequence (for large images or tmux):
 * ```
 * ESC ] 1337 ; MultipartFile = [params] BEL
 * ESC ] 1337 ; FilePart = <base64-chunk> BEL
 * ...
 * ESC ] 1337 ; FileEnd BEL
 * ```
 *
 * ## Pixel Format
 *
 * Melker uses Uint32Array with 0xRRGGBBAA packing (R in high bits).
 * This encoder converts to PNG format for iTerm2.
 */

import { encodeBase64 } from 'jsr:@std/encoding@^1.0.0/base64';
import { encodePng } from '../deps.ts';
import { getLogger } from '../logging.ts';
import type {
  ITermEncodeOptions,
  ITermEncodeImageOptions,
  ITermOutput,
  ITERM_MAX_SEQUENCE_SIZE,
  ITERM_MULTIPART_CHUNK_SIZE,
} from './types.ts';

const logger = getLogger('ITermEncoder');

// Reusable byte buffer for pixel conversion (grows as needed)
let pixelBytesBuffer: Uint8Array | null = null;

/**
 * Convert Melker's packed Uint32Array pixels to RGBA bytes for PNG encoding.
 * Melker packs colors as 0xRRGGBBAA: R in high bits, A in low bits.
 * Reuses a module-level buffer to avoid allocations.
 */
function pixelsToRgbaBytes(pixels: Uint32Array, width: number, height: number): Uint8Array {
  const requiredSize = width * height * 4;

  // Reuse buffer if large enough, otherwise allocate new one
  if (!pixelBytesBuffer || pixelBytesBuffer.length < requiredSize) {
    pixelBytesBuffer = new Uint8Array(requiredSize);
  }

  for (let i = 0; i < pixels.length; i++) {
    const pixel = pixels[i];
    const offset = i * 4;

    // Extract RGBA from packed Uint32 (0xRRGGBBAA)
    pixelBytesBuffer[offset] = (pixel >> 24) & 0xFF;     // R
    pixelBytesBuffer[offset + 1] = (pixel >> 16) & 0xFF; // G
    pixelBytesBuffer[offset + 2] = (pixel >> 8) & 0xFF;  // B
    pixelBytesBuffer[offset + 3] = pixel & 0xFF;         // A
  }

  // Return a view of only the used portion
  return pixelBytesBuffer.subarray(0, requiredSize);
}

/**
 * Encode RGBA bytes to PNG format using fast-png.
 * Uses compression level 0 (no compression) for maximum speed.
 * iTerm2 handles decompression, so we prioritize encoding speed over file size.
 */
function encodeToPng(rgbaBytes: Uint8Array, width: number, height: number): Uint8Array {
  const pngData = encodePng({
    width,
    height,
    data: rgbaBytes,
    depth: 8,
    channels: 4,
  }, {
    zlib: { level: 0 },  // No compression - fastest encoding
  });
  return pngData;
}

/**
 * Build iTerm2 parameter string from options.
 */
function buildParams(options: {
  displayWidth?: number | string;
  displayHeight?: number | string;
  preserveAspectRatio?: boolean;
  filename?: string;
  size?: number;
}): string {
  const params: string[] = [];

  // Always set inline=1 to display image (not download)
  params.push('inline=1');

  // Width
  if (options.displayWidth !== undefined) {
    if (typeof options.displayWidth === 'number') {
      params.push(`width=${options.displayWidth}`);
    } else {
      params.push(`width=${options.displayWidth}`);
    }
  }

  // Height
  if (options.displayHeight !== undefined) {
    if (typeof options.displayHeight === 'number') {
      params.push(`height=${options.displayHeight}`);
    } else {
      params.push(`height=${options.displayHeight}`);
    }
  }

  // Preserve aspect ratio (default is 1/true)
  if (options.preserveAspectRatio === false) {
    params.push('preserveAspectRatio=0');
  }

  // Filename (base64 encoded)
  if (options.filename) {
    const encodedName = encodeBase64(new TextEncoder().encode(options.filename));
    params.push(`name=${encodedName}`);
  }

  // Size (for progress indication)
  if (options.size !== undefined) {
    params.push(`size=${options.size}`);
  }

  return params.join(';');
}

/**
 * Encode to single iTerm2 escape sequence.
 * Used for images under 1MB.
 */
function encodeSingleSequence(
  base64Data: string,
  params: string
): string {
  // ESC ] 1337 ; File = <params> : <base64-data> BEL
  return `\x1b]1337;File=${params}:${base64Data}\x07`;
}

/**
 * Encode to multipart iTerm2 escape sequences.
 * Used for large images or tmux compatibility.
 */
function encodeMultipartSequences(
  base64Data: string,
  params: string,
  chunkSize: number = 65536
): string[] {
  const sequences: string[] = [];

  // Start: MultipartFile with params
  sequences.push(`\x1b]1337;MultipartFile=${params}\x07`);

  // Middle: FilePart chunks
  for (let i = 0; i < base64Data.length; i += chunkSize) {
    const chunk = base64Data.slice(i, i + chunkSize);
    sequences.push(`\x1b]1337;FilePart=${chunk}\x07`);
  }

  // End: FileEnd
  sequences.push(`\x1b]1337;FileEnd\x07`);

  return sequences;
}

/**
 * Encode pixel buffer to iTerm2 inline image escape sequence(s).
 *
 * Converts Melker's Uint32Array pixels to PNG, then to iTerm2 format.
 *
 * @param options - Encode options with pixels, dimensions, and display settings
 * @returns iTerm2 output with escape sequences and cached PNG bytes
 */
export function encodeToITerm2(options: ITermEncodeOptions): ITermOutput {
  const {
    pixels,
    width,
    height,
    displayWidth,
    displayHeight,
    preserveAspectRatio = true,
    useMultipart = false,
    filename,
  } = options;

  logger.debug('Encoding to iTerm2', {
    width,
    height,
    pixels: pixels.length,
    displayWidth,
    displayHeight,
    useMultipart,
  });

  // Convert pixels to RGBA bytes
  const rgbaBytes = pixelsToRgbaBytes(pixels, width, height);

  // Encode to PNG
  const pngBytes = encodeToPng(rgbaBytes, width, height);

  // Base64 encode the PNG
  const base64Data = encodeBase64(pngBytes);

  // Build parameters
  const params = buildParams({
    displayWidth,
    displayHeight,
    preserveAspectRatio,
    filename,
    size: pngBytes.length,
  });

  // Only use multipart if explicitly requested (for tmux compatibility)
  // Most terminals (WezTerm, Rio, Konsole) don't support multipart protocol
  // and handle large single sequences fine
  let sequences: string[];
  if (useMultipart) {
    sequences = encodeMultipartSequences(base64Data, params);
    logger.debug('iTerm2 multipart encoding', {
      chunks: sequences.length,
      totalBytes: base64Data.length,
    });
  } else {
    sequences = [encodeSingleSequence(base64Data, params)];
    logger.debug('iTerm2 single sequence encoding', {
      totalBytes: base64Data.length,
    });
  }

  return {
    sequences,
    pngBytes,
    totalBytes: base64Data.length,
  };
}

/**
 * Encode pre-encoded image data (PNG passthrough) to iTerm2 format.
 *
 * Use this when you already have PNG/JPEG/GIF bytes (e.g., from <img> element).
 *
 * @param options - Encode options with image data and display settings
 * @returns iTerm2 output with escape sequences
 */
export function encodeImageToITerm2(options: ITermEncodeImageOptions): ITermOutput {
  const {
    imageData,
    displayWidth,
    displayHeight,
    preserveAspectRatio = true,
    useMultipart = false,
    filename,
  } = options;

  logger.debug('Encoding image to iTerm2 (passthrough)', {
    bytes: imageData.length,
    displayWidth,
    displayHeight,
    useMultipart,
  });

  // Base64 encode the image data
  const base64Data = encodeBase64(imageData);

  // Build parameters
  const params = buildParams({
    displayWidth,
    displayHeight,
    preserveAspectRatio,
    filename,
    size: imageData.length,
  });

  // Only use multipart if explicitly requested (for tmux compatibility)
  let sequences: string[];
  if (useMultipart) {
    sequences = encodeMultipartSequences(base64Data, params);
  } else {
    sequences = [encodeSingleSequence(base64Data, params)];
  }

  return {
    sequences,
    totalBytes: base64Data.length,
  };
}

/**
 * Add cursor positioning to iTerm2 output.
 *
 * Moves cursor to the specified cell position before outputting the image.
 * Uses ANSI cursor position escape: ESC[row;colH
 *
 * @param output - iTerm2 output from encodeToITerm2
 * @param col - Column (1-based)
 * @param row - Row (1-based)
 * @returns Complete escape sequence with positioning
 */
export function positionedITerm2(output: ITermOutput, col: number, row: number): string {
  // Move cursor to position (1-based), then output all sequences
  const cursorMove = `\x1b[${row};${col}H`;
  return cursorMove + output.sequences.join('');
}

/**
 * Calculate estimated size of iTerm2 output.
 *
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns Estimated base64 size (actual PNG compression varies)
 */
export function estimateITerm2Size(width: number, height: number): number {
  // PNG compression varies, but worst case is raw + overhead
  // Estimate ~50% compression for typical images
  const rawBytes = width * height * 4;
  const estimatedPngBytes = rawBytes * 0.5;
  // Base64 expands by ~4/3
  return Math.ceil(estimatedPngBytes * 4 / 3);
}

/**
 * Check if an image would need multipart encoding.
 *
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns True if multipart encoding is recommended
 */
export function needsMultipartEncoding(width: number, height: number): boolean {
  return estimateITerm2Size(width, height) > 1048576;
}
