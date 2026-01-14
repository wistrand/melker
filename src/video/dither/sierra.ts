// Sierra dithering algorithms

import { _ditherBuffers, ensureDitherBuffers, quantizeChannel, rgbToGray } from './utils.ts';

/**
 * Apply Sierra 2-row dithering to an RGBA frame buffer
 * Sierra 2-row is a good balance between quality and speed.
 * Error distribution pattern (divisor = 16):
 *       [*]  4   3
 *    1   2   3   2   1
 *
 * @param frameData RGBA pixel data
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @param bits Bits per channel (1-8), where 1 = 2 levels (B&W), 8 = 256 levels
 */
export function applySierraDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number
): void {
  // Clamp bits to valid range
  bits = Math.max(1, Math.min(8, Math.round(bits)));

  // Calculate number of levels: 2^bits
  const levels = 1 << bits;

  // Ensure reusable buffers are large enough (Sierra needs +4 padding)
  ensureDitherBuffers(width, true, 4);
  const bufSize = width + 4;

  const errorR = _ditherBuffers.errorR;
  const errorG = _ditherBuffers.errorG;
  const errorB = _ditherBuffers.errorB;
  const nextErrorR = _ditherBuffers.nextErrorR;
  const nextErrorG = _ditherBuffers.nextErrorG;
  const nextErrorB = _ditherBuffers.nextErrorB;

  // Clear buffers at start
  errorR.fill(0, 0, bufSize);
  errorG.fill(0, 0, bufSize);
  errorB.fill(0, 0, bufSize);
  nextErrorR.fill(0, 0, bufSize);
  nextErrorG.fill(0, 0, bufSize);
  nextErrorB.fill(0, 0, bufSize);

  const OFFSET = 2; // Padding offset for negative index access

  for (let y = 0; y < height; y++) {
    // Swap error buffers
    for (let i = 0; i < bufSize; i++) {
      errorR[i] = nextErrorR[i];
      errorG[i] = nextErrorG[i];
      errorB[i] = nextErrorB[i];
    }
    nextErrorR.fill(0, 0, bufSize);
    nextErrorG.fill(0, 0, bufSize);
    nextErrorB.fill(0, 0, bufSize);

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const ex = x + OFFSET;

      // Get original color + accumulated error
      let r = frameData[idx] + errorR[ex];
      let g = frameData[idx + 1] + errorG[ex];
      let b = frameData[idx + 2] + errorB[ex];

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

      // Distribute error using Sierra 2-row pattern (divisor = 16)
      //       [*]  4   3
      //    1   2   3   2   1

      // Current row: right pixels
      // +1: 4/16
      errorR[ex + 1] += errR * 4 / 16;
      errorG[ex + 1] += errG * 4 / 16;
      errorB[ex + 1] += errB * 4 / 16;
      // +2: 3/16
      errorR[ex + 2] += errR * 3 / 16;
      errorG[ex + 2] += errG * 3 / 16;
      errorB[ex + 2] += errB * 3 / 16;

      // Next row
      // -2: 1/16
      nextErrorR[ex - 2] += errR * 1 / 16;
      nextErrorG[ex - 2] += errG * 1 / 16;
      nextErrorB[ex - 2] += errB * 1 / 16;
      // -1: 2/16
      nextErrorR[ex - 1] += errR * 2 / 16;
      nextErrorG[ex - 1] += errG * 2 / 16;
      nextErrorB[ex - 1] += errB * 2 / 16;
      // 0: 3/16
      nextErrorR[ex] += errR * 3 / 16;
      nextErrorG[ex] += errG * 3 / 16;
      nextErrorB[ex] += errB * 3 / 16;
      // +1: 2/16
      nextErrorR[ex + 1] += errR * 2 / 16;
      nextErrorG[ex + 1] += errG * 2 / 16;
      nextErrorB[ex + 1] += errB * 2 / 16;
      // +2: 1/16
      nextErrorR[ex + 2] += errR * 1 / 16;
      nextErrorG[ex + 2] += errG * 1 / 16;
      nextErrorB[ex + 2] += errB * 1 / 16;
    }
  }
}

/**
 * Apply stable Sierra 2-row dithering to an RGBA frame buffer
 * Like Sierra but with reduced vertical error propagation for temporal stability.
 * Error distribution pattern (divisor = 16, vertical with decay):
 *       [*]  4   3
 *    1   2   3   2   1  (all * DECAY)
 *
 * @param frameData RGBA pixel data
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @param bits Bits per channel (1-8), where 1 = 2 levels (B&W), 8 = 256 levels
 */
export function applySierraStableDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number
): void {
  // Clamp bits to valid range
  bits = Math.max(1, Math.min(8, Math.round(bits)));

  // Calculate number of levels: 2^bits
  const levels = 1 << bits;

  // Ensure reusable buffers are large enough (Sierra needs +4 padding)
  ensureDitherBuffers(width, true, 4);
  const bufSize = width + 4;

  const errorR = _ditherBuffers.errorR;
  const errorG = _ditherBuffers.errorG;
  const errorB = _ditherBuffers.errorB;
  const nextErrorR = _ditherBuffers.nextErrorR;
  const nextErrorG = _ditherBuffers.nextErrorG;
  const nextErrorB = _ditherBuffers.nextErrorB;

  // Clear buffers at start
  errorR.fill(0, 0, bufSize);
  errorG.fill(0, 0, bufSize);
  errorB.fill(0, 0, bufSize);
  nextErrorR.fill(0, 0, bufSize);
  nextErrorG.fill(0, 0, bufSize);
  nextErrorB.fill(0, 0, bufSize);

  const OFFSET = 2; // Padding offset for negative index access
  const DECAY = 0.5; // Reduce vertical error propagation for stability

  for (let y = 0; y < height; y++) {
    // Swap error buffers
    for (let i = 0; i < bufSize; i++) {
      errorR[i] = nextErrorR[i];
      errorG[i] = nextErrorG[i];
      errorB[i] = nextErrorB[i];
    }
    nextErrorR.fill(0, 0, bufSize);
    nextErrorG.fill(0, 0, bufSize);
    nextErrorB.fill(0, 0, bufSize);

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const ex = x + OFFSET;

      // Get original color + accumulated error
      let r = frameData[idx] + errorR[ex];
      let g = frameData[idx + 1] + errorG[ex];
      let b = frameData[idx + 2] + errorB[ex];

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

      // Distribute error using Sierra 2-row pattern (divisor = 16)
      // Horizontal at full strength, vertical with decay
      //       [*]  4   3
      //    1   2   3   2   1  (all * DECAY)

      // Current row: right pixels (full strength)
      // +1: 4/16
      errorR[ex + 1] += errR * 4 / 16;
      errorG[ex + 1] += errG * 4 / 16;
      errorB[ex + 1] += errB * 4 / 16;
      // +2: 3/16
      errorR[ex + 2] += errR * 3 / 16;
      errorG[ex + 2] += errG * 3 / 16;
      errorB[ex + 2] += errB * 3 / 16;

      // Next row (with decay for stability)
      // -2: 1/16 * DECAY
      nextErrorR[ex - 2] += errR * 1 / 16 * DECAY;
      nextErrorG[ex - 2] += errG * 1 / 16 * DECAY;
      nextErrorB[ex - 2] += errB * 1 / 16 * DECAY;
      // -1: 2/16 * DECAY
      nextErrorR[ex - 1] += errR * 2 / 16 * DECAY;
      nextErrorG[ex - 1] += errG * 2 / 16 * DECAY;
      nextErrorB[ex - 1] += errB * 2 / 16 * DECAY;
      // 0: 3/16 * DECAY
      nextErrorR[ex] += errR * 3 / 16 * DECAY;
      nextErrorG[ex] += errG * 3 / 16 * DECAY;
      nextErrorB[ex] += errB * 3 / 16 * DECAY;
      // +1: 2/16 * DECAY
      nextErrorR[ex + 1] += errR * 2 / 16 * DECAY;
      nextErrorG[ex + 1] += errG * 2 / 16 * DECAY;
      nextErrorB[ex + 1] += errB * 2 / 16 * DECAY;
      // +2: 1/16 * DECAY
      nextErrorR[ex + 2] += errR * 1 / 16 * DECAY;
      nextErrorG[ex + 2] += errG * 1 / 16 * DECAY;
      nextErrorB[ex + 2] += errB * 1 / 16 * DECAY;
    }
  }
}
