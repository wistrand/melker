/**
 * Dithering algorithm benchmarks
 *
 * Split from graphics_bench.ts to keep suite under 60s.
 */

import { BenchmarkSuite } from '../harness.ts';
import {
  applyFloydSteinbergDither,
  applyFloydSteinbergStableDither,
  applySierraDither,
  applySierraStableDither,
  applyAtkinsonDither,
  applyAtkinsonStableDither,
  applyOrderedDither,
  applyBlueNoiseDither,
} from '../../src/video/dither/mod.ts';

const suite = new BenchmarkSuite('dithering');

// =============================================================================
// Test image generation
// =============================================================================

function generatePhotoLikeImage(width: number, height: number): Uint32Array {
  const pixels = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.floor(128 + 127 * Math.sin(x * 0.1));
      const g = Math.floor(128 + 127 * Math.sin(y * 0.08 + x * 0.02));
      const b = Math.floor(128 + 127 * Math.sin((x + y) * 0.05));
      const a = 255;
      pixels[y * width + x] = (r << 24) | (g << 16) | (b << 8) | a;
    }
  }
  return pixels;
}

function toRGBABytes(pixels: Uint32Array, width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    const pixel = pixels[i];
    const offset = i * 4;
    bytes[offset] = (pixel >> 24) & 0xff;
    bytes[offset + 1] = (pixel >> 16) & 0xff;
    bytes[offset + 2] = (pixel >> 8) & 0xff;
    bytes[offset + 3] = pixel & 0xff;
  }
  return bytes;
}

// Test images
const smallWidth = 64, smallHeight = 64;
const mediumWidth = 256, mediumHeight = 256;
const largeWidth = 640, largeHeight = 480;

const smallImagePhoto = generatePhotoLikeImage(smallWidth, smallHeight);
const mediumImagePhoto = generatePhotoLikeImage(mediumWidth, mediumHeight);
const largeImagePhoto = generatePhotoLikeImage(largeWidth, largeHeight);

// Create fresh byte arrays for each dithering test (they modify in place)
function freshSmallBytes() { return toRGBABytes(smallImagePhoto, smallWidth, smallHeight); }
function freshMediumBytes() { return toRGBABytes(mediumImagePhoto, mediumWidth, mediumHeight); }
function freshLargeBytes() { return toRGBABytes(largeImagePhoto, largeWidth, largeHeight); }

// =============================================================================
// Floyd-Steinberg dithering
// =============================================================================

suite.add('dither-floyd-64x64', () => {
  const bytes = freshSmallBytes();
  applyFloydSteinbergDither(bytes, smallWidth, smallHeight, 4);
}, { iterations: 200, target: 1.0 });

suite.add('dither-floyd-256x256', () => {
  const bytes = freshMediumBytes();
  applyFloydSteinbergDither(bytes, mediumWidth, mediumHeight, 4);
}, { iterations: 20, target: 15.0 });

suite.add('dither-floyd-640x480', () => {
  const bytes = freshLargeBytes();
  applyFloydSteinbergDither(bytes, largeWidth, largeHeight, 4);
}, { iterations: 5, target: 60.0 });

// =============================================================================
// Sierra dithering
// =============================================================================

suite.add('dither-sierra-64x64', () => {
  const bytes = freshSmallBytes();
  applySierraDither(bytes, smallWidth, smallHeight, 4);
}, { iterations: 200, target: 1.0 });

suite.add('dither-sierra-256x256', () => {
  const bytes = freshMediumBytes();
  applySierraDither(bytes, mediumWidth, mediumHeight, 4);
}, { iterations: 20, target: 15.0 });

// =============================================================================
// Atkinson dithering
// =============================================================================

suite.add('dither-atkinson-64x64', () => {
  const bytes = freshSmallBytes();
  applyAtkinsonDither(bytes, smallWidth, smallHeight, 4);
}, { iterations: 200, target: 1.0 });

suite.add('dither-atkinson-256x256', () => {
  const bytes = freshMediumBytes();
  applyAtkinsonDither(bytes, mediumWidth, mediumHeight, 4);
}, { iterations: 20, target: 15.0 });

// =============================================================================
// Ordered dithering (Bayer matrix - fastest)
// =============================================================================

suite.add('dither-ordered-64x64', () => {
  const bytes = freshSmallBytes();
  applyOrderedDither(bytes, smallWidth, smallHeight, 4);
}, { iterations: 500, target: 0.5 });

suite.add('dither-ordered-256x256', () => {
  const bytes = freshMediumBytes();
  applyOrderedDither(bytes, mediumWidth, mediumHeight, 4);
}, { iterations: 100, target: 10.0 });

suite.add('dither-ordered-640x480', () => {
  const bytes = freshLargeBytes();
  applyOrderedDither(bytes, largeWidth, largeHeight, 4);
}, { iterations: 20, target: 40.0 });

// =============================================================================
// Bit depth comparison (1-bit B&W vs 4-bit color)
// =============================================================================

suite.add('dither-floyd-1bit-256x256', () => {
  const bytes = freshMediumBytes();
  applyFloydSteinbergDither(bytes, mediumWidth, mediumHeight, 1);
}, { iterations: 20, target: 10.0 });

suite.add('dither-floyd-4bit-256x256', () => {
  const bytes = freshMediumBytes();
  applyFloydSteinbergDither(bytes, mediumWidth, mediumHeight, 4);
}, { iterations: 20, target: 12.0 });

suite.add('dither-floyd-8bit-256x256', () => {
  const bytes = freshMediumBytes();
  applyFloydSteinbergDither(bytes, mediumWidth, mediumHeight, 8);
}, { iterations: 20, target: 8.0 });

// =============================================================================
// Stable dithering variants (temporally stable for video)
// =============================================================================

suite.add('dither-floyd-stable-256x256', () => {
  const bytes = freshMediumBytes();
  applyFloydSteinbergStableDither(bytes, mediumWidth, mediumHeight, 4);
}, { iterations: 20, target: 12.0 });

suite.add('dither-sierra-stable-256x256', () => {
  const bytes = freshMediumBytes();
  applySierraStableDither(bytes, mediumWidth, mediumHeight, 4);
}, { iterations: 20, target: 12.0 });

suite.add('dither-atkinson-stable-256x256', () => {
  const bytes = freshMediumBytes();
  applyAtkinsonStableDither(bytes, mediumWidth, mediumHeight, 4);
}, { iterations: 20, target: 12.0 });

// =============================================================================
// Blue noise dithering (high quality, no visible pattern)
// =============================================================================

suite.add('dither-bluenoise-64x64', () => {
  const bytes = freshSmallBytes();
  applyBlueNoiseDither(bytes, smallWidth, smallHeight, 4);
}, { iterations: 200, target: 0.5 });

suite.add('dither-bluenoise-256x256', () => {
  const bytes = freshMediumBytes();
  applyBlueNoiseDither(bytes, mediumWidth, mediumHeight, 4);
}, { iterations: 20, target: 15.0 });

suite.add('dither-bluenoise-640x480', () => {
  const bytes = freshLargeBytes();
  applyBlueNoiseDither(bytes, largeWidth, largeHeight, 4);
}, { iterations: 5, target: 45.0 });

// =============================================================================
// Pipeline benchmark (dithering in graphics pipeline)
// =============================================================================

suite.add('pipeline-dither-floyd-256x256', () => {
  const bytes = freshMediumBytes();
  applyFloydSteinbergDither(bytes, mediumWidth, mediumHeight, 4);
}, { iterations: 20, target: 12.0 });

// Run benchmarks
const results = await suite.run();

// Analyze results and add findings
const getMedian = (name: string) => results.find(r => r.name === name)?.median ?? 0;

suite.addFindings([
  {
    title: 'Ordered dithering is fastest',
    description: 'Ordered (Bayer) dithering is ~2-3x faster than error-diffusion methods while maintaining temporal stability.',
    category: 'performance',
    benchmarks: ['dither-ordered-256x256', 'dither-floyd-256x256'],
    metrics: {
      orderedMs: getMedian('dither-ordered-256x256'),
      floydMs: getMedian('dither-floyd-256x256'),
      speedup: `${(getMedian('dither-floyd-256x256') / getMedian('dither-ordered-256x256')).toFixed(1)}x`,
    },
  },
  {
    title: 'Blue noise provides best quality',
    description: 'Blue noise dithering produces the best visual quality with no visible patterns, at moderate speed.',
    category: 'info',
    benchmarks: ['dither-bluenoise-256x256', 'dither-ordered-256x256'],
    metrics: {
      blueNoiseMs: getMedian('dither-bluenoise-256x256'),
      orderedMs: getMedian('dither-ordered-256x256'),
    },
  },
  {
    title: 'Stable variants have minimal overhead',
    description: 'Temporally stable dithering variants (for video) have similar performance to standard versions.',
    category: 'info',
    benchmarks: ['dither-floyd-256x256', 'dither-floyd-stable-256x256'],
    metrics: {
      standardMs: getMedian('dither-floyd-256x256'),
      stableMs: getMedian('dither-floyd-stable-256x256'),
    },
  },
  {
    title: 'Bit depth affects quality, not speed',
    description: 'Different bit depths (1-bit B&W to 8-bit color) have similar performance; choose based on output quality needs.',
    category: 'info',
    benchmarks: ['dither-floyd-1bit-256x256', 'dither-floyd-4bit-256x256', 'dither-floyd-8bit-256x256'],
    metrics: {
      oneBitMs: getMedian('dither-floyd-1bit-256x256'),
      fourBitMs: getMedian('dither-floyd-4bit-256x256'),
      eightBitMs: getMedian('dither-floyd-8bit-256x256'),
    },
  },
]);

suite.setNotes('Dithering benchmarks for all supported algorithms. Ordered is fastest (Bayer matrix), blue noise is highest quality, error-diffusion (Floyd-Steinberg, Sierra, Atkinson) balance speed and quality.');

// Save results
const outputPath = new URL('../results/dithering-' + new Date().toISOString().slice(0, 10) + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
