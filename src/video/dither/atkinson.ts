// Atkinson dithering algorithms

import { _ditherBuffers, ensureDitherBuffers, quantizeChannel, rgbToGray } from './utils.ts';

/**
 * Apply Atkinson dithering to an RGBA frame buffer
 * Atkinson dithering was developed by Bill Atkinson at Apple. It only
 * diffuses 6/8 (75%) of the quantization error, which preserves highlights
 * and shadows better than Floyd-Steinberg at the cost of some detail.
 * Error distribution pattern (each coefficient = 1/8):
 *       [*]  1   1
 *    1   1   1
 *        1
 *
 * @param frameData RGBA pixel data
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @param bits Bits per channel (1-8), where 1 = 2 levels (B&W), 8 = 256 levels
 */
export function applyAtkinsonDither(
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
  // Atkinson needs current row + 2 next rows, but we can use 2-row approach
  // with +2 padding for the right-side pixels
  ensureDitherBuffers(width, true, 2);
  const bufSize = width + 2;

  const errorR = _ditherBuffers.errorR;
  const errorG = _ditherBuffers.errorG;
  const errorB = _ditherBuffers.errorB;
  const nextErrorR = _ditherBuffers.nextErrorR;
  const nextErrorG = _ditherBuffers.nextErrorG;
  const nextErrorB = _ditherBuffers.nextErrorB;

  // We need a third row buffer for the row+2 pixel
  // Reuse main error buffers with offset for this
  const row2Offset = bufSize;

  // Clear buffers at start
  errorR.fill(0, 0, bufSize * 2);
  errorG.fill(0, 0, bufSize * 2);
  errorB.fill(0, 0, bufSize * 2);
  nextErrorR.fill(0, 0, bufSize);
  nextErrorG.fill(0, 0, bufSize);
  nextErrorB.fill(0, 0, bufSize);

  for (let y = 0; y < height; y++) {
    // Rotate error buffers: current <- next, next <- row2, row2 <- clear
    for (let i = 0; i < bufSize; i++) {
      errorR[i] = nextErrorR[i];
      errorG[i] = nextErrorG[i];
      errorB[i] = nextErrorB[i];
      nextErrorR[i] = errorR[row2Offset + i];
      nextErrorG[i] = errorG[row2Offset + i];
      nextErrorB[i] = errorB[row2Offset + i];
      errorR[row2Offset + i] = 0;
      errorG[row2Offset + i] = 0;
      errorB[row2Offset + i] = 0;
    }

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

        errR = r - qr;
        errG = g - qg;
        errB = b - qb;
      }

      // Write quantized color back
      frameData[idx] = qr;
      frameData[idx + 1] = qg;
      frameData[idx + 2] = qb;

      // Atkinson distributes 1/8 to each of 6 neighbors (total 6/8 = 75%)
      // This preserves highlights/shadows better than full error diffusion
      //       [*]  1   1
      //    1   1   1
      //        1
      const e8R = errR / 8;
      const e8G = errG / 8;
      const e8B = errB / 8;

      // Current row: x+1, x+2
      if (x + 1 < width) {
        errorR[x + 1] += e8R;
        errorG[x + 1] += e8G;
        errorB[x + 1] += e8B;
      }
      if (x + 2 < width) {
        errorR[x + 2] += e8R;
        errorG[x + 2] += e8G;
        errorB[x + 2] += e8B;
      }

      // Next row (y+1): x-1, x, x+1
      if (y + 1 < height) {
        if (x > 0) {
          nextErrorR[x - 1] += e8R;
          nextErrorG[x - 1] += e8G;
          nextErrorB[x - 1] += e8B;
        }
        nextErrorR[x] += e8R;
        nextErrorG[x] += e8G;
        nextErrorB[x] += e8B;
        if (x + 1 < width) {
          nextErrorR[x + 1] += e8R;
          nextErrorG[x + 1] += e8G;
          nextErrorB[x + 1] += e8B;
        }
      }

      // Row y+2: x only
      if (y + 2 < height) {
        errorR[row2Offset + x] += e8R;
        errorG[row2Offset + x] += e8G;
        errorB[row2Offset + x] += e8B;
      }
    }
  }
}

/**
 * Apply stable Atkinson dithering to an RGBA frame buffer
 * Like Atkinson but with reduced vertical error propagation for temporal stability.
 * Horizontal error is at full strength, vertical error is decayed.
 * Error distribution pattern (each coefficient = 1/8, vertical with decay):
 *       [*]  1   1
 *    1   1   1      (all * DECAY)
 *        1          (* DECAY)
 *
 * @param frameData RGBA pixel data
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @param bits Bits per channel (1-8), where 1 = 2 levels (B&W), 8 = 256 levels
 */
export function applyAtkinsonStableDither(
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
  ensureDitherBuffers(width, true, 2);
  const bufSize = width + 2;

  const errorR = _ditherBuffers.errorR;
  const errorG = _ditherBuffers.errorG;
  const errorB = _ditherBuffers.errorB;
  const nextErrorR = _ditherBuffers.nextErrorR;
  const nextErrorG = _ditherBuffers.nextErrorG;
  const nextErrorB = _ditherBuffers.nextErrorB;

  // Third row buffer offset
  const row2Offset = bufSize;

  // Clear buffers at start
  errorR.fill(0, 0, bufSize * 2);
  errorG.fill(0, 0, bufSize * 2);
  errorB.fill(0, 0, bufSize * 2);
  nextErrorR.fill(0, 0, bufSize);
  nextErrorG.fill(0, 0, bufSize);
  nextErrorB.fill(0, 0, bufSize);

  const DECAY = 0.5; // Reduce vertical error propagation for stability

  for (let y = 0; y < height; y++) {
    // Rotate error buffers: current <- next, next <- row2, row2 <- clear
    for (let i = 0; i < bufSize; i++) {
      errorR[i] = nextErrorR[i];
      errorG[i] = nextErrorG[i];
      errorB[i] = nextErrorB[i];
      nextErrorR[i] = errorR[row2Offset + i];
      nextErrorG[i] = errorG[row2Offset + i];
      nextErrorB[i] = errorB[row2Offset + i];
      errorR[row2Offset + i] = 0;
      errorG[row2Offset + i] = 0;
      errorB[row2Offset + i] = 0;
    }

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

        errR = r - qr;
        errG = g - qg;
        errB = b - qb;
      }

      // Write quantized color back
      frameData[idx] = qr;
      frameData[idx + 1] = qg;
      frameData[idx + 2] = qb;

      // Atkinson distributes 1/8 to each neighbor
      // Horizontal at full strength, vertical with decay
      const e8R = errR / 8;
      const e8G = errG / 8;
      const e8B = errB / 8;

      // Current row: x+1, x+2 (full strength - horizontal)
      if (x + 1 < width) {
        errorR[x + 1] += e8R;
        errorG[x + 1] += e8G;
        errorB[x + 1] += e8B;
      }
      if (x + 2 < width) {
        errorR[x + 2] += e8R;
        errorG[x + 2] += e8G;
        errorB[x + 2] += e8B;
      }

      // Next row (y+1): x-1, x, x+1 (with decay)
      if (y + 1 < height) {
        if (x > 0) {
          nextErrorR[x - 1] += e8R * DECAY;
          nextErrorG[x - 1] += e8G * DECAY;
          nextErrorB[x - 1] += e8B * DECAY;
        }
        nextErrorR[x] += e8R * DECAY;
        nextErrorG[x] += e8G * DECAY;
        nextErrorB[x] += e8B * DECAY;
        if (x + 1 < width) {
          nextErrorR[x + 1] += e8R * DECAY;
          nextErrorG[x + 1] += e8G * DECAY;
          nextErrorB[x + 1] += e8B * DECAY;
        }
      }

      // Row y+2: x only (with decay)
      if (y + 2 < height) {
        errorR[row2Offset + x] += e8R * DECAY;
        errorG[row2Offset + x] += e8G * DECAY;
        errorB[row2Offset + x] += e8B * DECAY;
      }
    }
  }
}
