// Dither algorithm dispatch — single entry point for all dithering modes

import type { DitherMode } from './types.ts';
import { applyFloydSteinbergDither, applyFloydSteinbergStableDither } from './floyd-steinberg.ts';
import { applySierraDither, applySierraStableDither } from './sierra.ts';
import { applyAtkinsonDither, applyAtkinsonStableDither } from './atkinson.ts';
import { applyOrderedDither, applyBlueNoiseDither } from './threshold.ts';

/**
 * Apply dithering to an RGBA frame buffer using the specified algorithm.
 * `true` maps to 'sierra-stable' (the default).
 * No-op for 'none', 'auto', false, or undefined.
 */
export function applyDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number,
  mode: DitherMode | boolean,
): void {
  if (mode === 'sierra-stable' || mode === true) {
    applySierraStableDither(frameData, width, height, bits);
  } else if (mode === 'sierra') {
    applySierraDither(frameData, width, height, bits);
  } else if (mode === 'floyd-steinberg') {
    applyFloydSteinbergDither(frameData, width, height, bits);
  } else if (mode === 'floyd-steinberg-stable') {
    applyFloydSteinbergStableDither(frameData, width, height, bits);
  } else if (mode === 'atkinson') {
    applyAtkinsonDither(frameData, width, height, bits);
  } else if (mode === 'atkinson-stable') {
    applyAtkinsonStableDither(frameData, width, height, bits);
  } else if (mode === 'ordered') {
    applyOrderedDither(frameData, width, height, bits);
  } else if (mode === 'blue-noise') {
    applyBlueNoiseDither(frameData, width, height, bits);
  }
}
