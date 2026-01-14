// Floyd-Steinberg dithering algorithms

import { _ditherBuffers, ensureDitherBuffers, quantizeChannel, quantizeColor, rgbToGray } from './utils.ts';

/**
 * Apply Floyd-Steinberg dithering to an RGBA frame buffer
 * Modifies the buffer in place
 *
 * The algorithm distributes quantization error to neighboring pixels:
 *   [*] 7/16 ->
 * 3/16 5/16 1/16
 *
 * @param frameData RGBA pixel data
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @param bits Bits per channel (1-8), where 1 = 2 levels (B&W), 8 = 256 levels
 */
export function applyFloydSteinbergDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number
): void {
  // Ensure reusable buffers are large enough
  ensureDitherBuffers(width, false);
  const errorR = _ditherBuffers.errorR;
  const errorG = _ditherBuffers.errorG;
  const errorB = _ditherBuffers.errorB;

  // Clear buffers (they may contain data from previous frame)
  errorR.fill(0, 0, width * 2);
  errorG.fill(0, 0, width * 2);
  errorB.fill(0, 0, width * 2);

  // Reusable output array for quantizeColor (avoids per-pixel allocation)
  const qOut = [0, 0, 0];

  for (let y = 0; y < height; y++) {
    // Swap error rows (current becomes previous, next becomes current)
    const currRow = (y % 2) * width;
    const nextRow = ((y + 1) % 2) * width;

    // Clear next row
    for (let x = 0; x < width; x++) {
      errorR[nextRow + x] = 0;
      errorG[nextRow + x] = 0;
      errorB[nextRow + x] = 0;
    }

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // Get original color + accumulated error
      let r = frameData[idx] + errorR[currRow + x];
      let g = frameData[idx + 1] + errorG[currRow + x];
      let b = frameData[idx + 2] + errorB[currRow + x];

      // Clamp to valid range
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));

      // Quantize (writes to qOut)
      quantizeColor(r, g, b, bits, qOut);
      const qr = qOut[0], qg = qOut[1], qb = qOut[2];

      // Calculate error
      let errR: number, errG: number, errB: number;
      if (bits === 1) {
        // For 1-bit, propagate grayscale error to all channels
        // This ensures error accumulates properly for saturated colors
        const gray = rgbToGray(r, g, b);
        const grayError = gray - qr; // qr is either 0 or 255
        errR = errG = errB = grayError;
      } else {
        errR = r - qr;
        errG = g - qg;
        errB = b - qb;
      }

      // Write quantized color back
      frameData[idx] = qr;
      frameData[idx + 1] = qg;
      frameData[idx + 2] = qb;
      // Alpha stays unchanged

      // Distribute error to neighbors using Floyd-Steinberg coefficients
      // Right pixel: 7/16
      if (x + 1 < width) {
        errorR[currRow + x + 1] += errR * 7 / 16;
        errorG[currRow + x + 1] += errG * 7 / 16;
        errorB[currRow + x + 1] += errB * 7 / 16;
      }

      // Bottom-left pixel: 3/16
      if (y + 1 < height && x > 0) {
        errorR[nextRow + x - 1] += errR * 3 / 16;
        errorG[nextRow + x - 1] += errG * 3 / 16;
        errorB[nextRow + x - 1] += errB * 3 / 16;
      }

      // Bottom pixel: 5/16
      if (y + 1 < height) {
        errorR[nextRow + x] += errR * 5 / 16;
        errorG[nextRow + x] += errG * 5 / 16;
        errorB[nextRow + x] += errB * 5 / 16;
      }

      // Bottom-right pixel: 1/16
      if (y + 1 < height && x + 1 < width) {
        errorR[nextRow + x + 1] += errR * 1 / 16;
        errorG[nextRow + x + 1] += errG * 1 / 16;
        errorB[nextRow + x + 1] += errB * 1 / 16;
      }
    }
  }
}

/**
 * Apply stable Floyd-Steinberg dithering to an RGBA frame buffer
 * Uses serpentine scanning and processes row-by-row without carrying
 * error between rows, making it more temporally stable for video.
 * Modifies the buffer in place
 *
 * @param frameData RGBA pixel data
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @param bits Bits per channel (1-8), where 1 = 2 levels (B&W), 8 = 256 levels
 */
export function applyFloydSteinbergStableDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number
): void {
  // Clamp bits to valid range
  bits = Math.max(1, Math.min(8, Math.round(bits)));

  // Calculate number of levels: 2^bits
  const levels = 1 << bits;

  // Ensure reusable buffers are large enough
  ensureDitherBuffers(width, true);

  // Use first 'width' elements of main buffers for current row
  const errorR = _ditherBuffers.errorR;
  const errorG = _ditherBuffers.errorG;
  const errorB = _ditherBuffers.errorB;
  const nextErrorR = _ditherBuffers.nextErrorR;
  const nextErrorG = _ditherBuffers.nextErrorG;
  const nextErrorB = _ditherBuffers.nextErrorB;

  // Clear all buffers at start
  errorR.fill(0, 0, width);
  errorG.fill(0, 0, width);
  errorB.fill(0, 0, width);
  nextErrorR.fill(0, 0, width);
  nextErrorG.fill(0, 0, width);
  nextErrorB.fill(0, 0, width);

  const DECAY = 0.5; // Reduce vertical error propagation for stability

  for (let y = 0; y < height; y++) {
    // Copy next row errors to current (with decay already applied)
    for (let i = 0; i < width; i++) {
      errorR[i] = nextErrorR[i];
      errorG[i] = nextErrorG[i];
      errorB[i] = nextErrorB[i];
    }

    // Clear next row
    nextErrorR.fill(0, 0, width);
    nextErrorG.fill(0, 0, width);
    nextErrorB.fill(0, 0, width);

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // Get original color + accumulated error
      let r = frameData[idx] + errorR[x];
      let g = frameData[idx + 1] + errorG[x];
      let b = frameData[idx + 2] + errorB[x];

      // Clamp to valid range
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));

      // Quantize
      let qr: number, qg: number, qb: number;
      let errR: number, errG: number, errB: number;

      if (bits === 1) {
        // For 1-bit, work in grayscale space for error diffusion
        // This ensures error accumulates properly for saturated colors
        const gray = rgbToGray(r, g, b);
        const bw = gray >= 128 ? 255 : 0;
        qr = qg = qb = bw;

        // Calculate grayscale error and propagate equally to all channels
        const grayError = gray - bw;
        errR = errG = errB = grayError;
      } else {
        qr = quantizeChannel(r, levels);
        qg = quantizeChannel(g, levels);
        qb = quantizeChannel(b, levels);

        // Calculate error per channel
        errR = r - qr;
        errG = g - qg;
        errB = b - qb;
      }

      // Write quantized color back
      frameData[idx] = qr;
      frameData[idx + 1] = qg;
      frameData[idx + 2] = qb;

      // Distribute error - primarily horizontal for stability
      // Right pixel: 7/16 (full strength)
      if (x + 1 < width) {
        errorR[x + 1] += errR * 7 / 16;
        errorG[x + 1] += errG * 7 / 16;
        errorB[x + 1] += errB * 7 / 16;
      }

      // Bottom pixels with decay for temporal stability
      // Bottom-left: 3/16 * DECAY
      if (x > 0) {
        nextErrorR[x - 1] += errR * 3 / 16 * DECAY;
        nextErrorG[x - 1] += errG * 3 / 16 * DECAY;
        nextErrorB[x - 1] += errB * 3 / 16 * DECAY;
      }

      // Bottom: 5/16 * DECAY
      nextErrorR[x] += errR * 5 / 16 * DECAY;
      nextErrorG[x] += errG * 5 / 16 * DECAY;
      nextErrorB[x] += errB * 5 / 16 * DECAY;

      // Bottom-right: 1/16 * DECAY
      if (x + 1 < width) {
        nextErrorR[x + 1] += errR * 1 / 16 * DECAY;
        nextErrorG[x + 1] += errG * 1 / 16 * DECAY;
        nextErrorB[x + 1] += errB * 1 / 16 * DECAY;
      }
    }
  }
}
