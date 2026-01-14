// Dithering types and constants

export type ColorSupport = 'none' | '16' | '256' | 'truecolor';

// Dither algorithm type
export type DitherMode = 'floyd-steinberg' | 'floyd-steinberg-stable' | 'sierra' | 'sierra-stable' | 'atkinson' | 'atkinson-stable' | 'blue-noise' | 'ordered' | 'none' | 'auto';

// Threshold matrix for ordered/threshold dithering
// Values should be normalized to 0-255 range
export interface ThresholdMatrix {
  size: number;           // Matrix dimension (must be square, power of 2 preferred)
  data: Uint8Array;       // Row-major threshold values (0-255)
  mask: number;           // Bitmask for efficient tiling (size - 1)
}

// 8x8 Bayer matrix for ordered dithering (normalized to 0-63)
export const BAYER_8X8 = [
  [ 0, 32,  8, 40,  2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44,  4, 36, 14, 46,  6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [ 3, 35, 11, 43,  1, 33,  9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47,  7, 39, 13, 45,  5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21]
];
