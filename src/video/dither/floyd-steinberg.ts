// Floyd-Steinberg dithering algorithms
//
// Error distribution pattern:
//   [*] 7/16 ->
// 3/16 5/16 1/16

import { type DitherKernel, applyErrorDiffusion } from './error-diffusion.ts';

const FLOYD_STEINBERG_KERNEL: DitherKernel = {
  offsets: [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16],
  ],
  maxDy: 1,
  padding: 2,
};

/**
 * Apply Floyd-Steinberg dithering to an RGBA frame buffer.
 * Modifies the buffer in place.
 */
export function applyFloydSteinbergDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number,
): void {
  applyErrorDiffusion(frameData, width, height, bits, FLOYD_STEINBERG_KERNEL, false);
}

/**
 * Apply stable Floyd-Steinberg dithering to an RGBA frame buffer.
 * Vertical error is halved for temporal stability in video.
 */
export function applyFloydSteinbergStableDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number,
): void {
  applyErrorDiffusion(frameData, width, height, bits, FLOYD_STEINBERG_KERNEL, true);
}
