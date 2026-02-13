// Sierra 2-row dithering algorithms
//
// Good balance between quality and speed.
// Error distribution pattern (divisor = 16):
//       [*]  4   3
//    1   2   3   2   1

import { type DitherKernel, applyErrorDiffusion } from './error-diffusion.ts';

const SIERRA_KERNEL: DitherKernel = {
  offsets: [
    [1, 0, 4 / 16],
    [2, 0, 3 / 16],
    [-2, 1, 1 / 16],
    [-1, 1, 2 / 16],
    [0, 1, 3 / 16],
    [1, 1, 2 / 16],
    [2, 1, 1 / 16],
  ],
  maxDy: 1,
  padding: 4,
};

/**
 * Apply Sierra 2-row dithering to an RGBA frame buffer.
 * Modifies the buffer in place.
 */
export function applySierraDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number,
): void {
  applyErrorDiffusion(frameData, width, height, bits, SIERRA_KERNEL, false);
}

/**
 * Apply stable Sierra 2-row dithering to an RGBA frame buffer.
 * Vertical error is halved for temporal stability in video.
 */
export function applySierraStableDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number,
): void {
  applyErrorDiffusion(frameData, width, height, bits, SIERRA_KERNEL, true);
}
