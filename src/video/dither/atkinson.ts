// Atkinson dithering algorithms
//
// Developed by Bill Atkinson at Apple. Only diffuses 6/8 (75%) of the
// quantization error, preserving highlights and shadows better than
// Floyd-Steinberg at the cost of some detail.
//
// Error distribution pattern (each coefficient = 1/8):
//       [*]  1   1
//    1   1   1
//        1

import { type DitherKernel, applyErrorDiffusion } from './error-diffusion.ts';

const ATKINSON_KERNEL: DitherKernel = {
  offsets: [
    [1, 0, 1 / 8],
    [2, 0, 1 / 8],
    [-1, 1, 1 / 8],
    [0, 1, 1 / 8],
    [1, 1, 1 / 8],
    [0, 2, 1 / 8],
  ],
  maxDy: 2,
  padding: 4,
};

/**
 * Apply Atkinson dithering to an RGBA frame buffer.
 * Modifies the buffer in place.
 */
export function applyAtkinsonDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number,
): void {
  applyErrorDiffusion(frameData, width, height, bits, ATKINSON_KERNEL, false);
}

/**
 * Apply stable Atkinson dithering to an RGBA frame buffer.
 * Vertical error is halved for temporal stability in video.
 */
export function applyAtkinsonStableDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number,
): void {
  applyErrorDiffusion(frameData, width, height, bits, ATKINSON_KERNEL, true);
}
