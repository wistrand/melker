/**
 * Shared Pixel Encoding Utilities
 *
 * Converts Melker's packed Uint32Array pixel buffers (0xRRGGBBAA format)
 * to raw byte arrays in RGB or RGBA format. Used by kitty and iterm2 encoders.
 *
 * Includes a reusable buffer optimization to avoid repeated allocations
 * when encoding frames of similar size.
 */

// Reusable byte buffer for pixel conversion (grows as needed, never shrinks)
let pixelBytesBuffer: Uint8Array | null = null;

/**
 * Convert Melker's packed Uint32Array pixels to raw bytes.
 *
 * Melker packs colors as 0xRRGGBBAA: R in high bits, A in low bits.
 * See packRGBA() in color-utils.ts.
 *
 * Reuses a module-level buffer to avoid allocations on repeated calls.
 *
 * @param pixels - Packed RGBA pixel data
 * @param format - Output format: 'rgb' (3 bytes/pixel) or 'rgba' (4 bytes/pixel)
 * @returns Uint8Array view over the reusable buffer (valid until next call)
 */
export function pixelsToBytes(pixels: Uint32Array, format: 'rgb' | 'rgba'): Uint8Array {
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
