// Dithering algorithms for video rendering
// Re-exports all dithering functionality

// Types and constants
export type { ColorSupport, DitherMode, ThresholdMatrix } from './types.ts';
export { BAYER_8X8 } from './types.ts';

// Utility functions
export { colorSupportToBits } from './utils.ts';

// Threshold-based dithering (ordered, blue noise, custom matrices)
export {
  loadThresholdMatrixFromPng,
  loadThresholdMatrixFromPngSync,
  getCachedThresholdMatrix,
  clearThresholdMatrixCache,
  applyOrderedDither,
  applyThresholdDither,
  applyBlueNoiseDither,
} from './threshold.ts';

// Floyd-Steinberg dithering
export {
  applyFloydSteinbergDither,
  applyFloydSteinbergStableDither,
} from './floyd-steinberg.ts';

// Sierra dithering
export {
  applySierraDither,
  applySierraStableDither,
} from './sierra.ts';

// Atkinson dithering
export {
  applyAtkinsonDither,
  applyAtkinsonStableDither,
} from './atkinson.ts';
