/**
 * Color quantization benchmarks
 *
 * Split from graphics_bench.ts to keep suite under 60s.
 * Median-cut quantization is expensive; this suite has reduced warmup.
 */

import { BenchmarkSuite, benchmarkTimestamp } from '../harness.ts';
import {
  quantizeMedianCut,
  quantizeFixed256,
  quantizeFixed216,
  convertToGrayscale,
} from '../../src/sixel/mod.ts';

const suite = new BenchmarkSuite('quantization');

// =============================================================================
// Test image generation
// =============================================================================

function generateGradientImage(width: number, height: number): Uint32Array {
  const pixels = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.floor((x / width) * 255);
      const g = Math.floor((y / height) * 255);
      const b = Math.floor(((x + y) / (width + height)) * 255);
      const a = 255;
      pixels[y * width + x] = (r << 24) | (g << 16) | (b << 8) | a;
    }
  }
  return pixels;
}

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

// Test images
const smallImage = generateGradientImage(64, 64);
const smallImagePhoto = generatePhotoLikeImage(64, 64);
const mediumImage = generateGradientImage(256, 256);
const mediumImagePhoto = generatePhotoLikeImage(256, 256);
const largeImage = generateGradientImage(640, 480);
const largeImagePhoto = generatePhotoLikeImage(640, 480);

// =============================================================================
// Median-cut quantization (expensive - reduced warmup)
// =============================================================================

suite.add('quantize-median-cut-64x64', () => {
  quantizeMedianCut(smallImagePhoto, 256);
}, { iterations: 50, warmup: 5, target: 100 });

suite.add('quantize-median-cut-256x256', () => {
  quantizeMedianCut(mediumImagePhoto, 256);
}, { iterations: 10, warmup: 2, target: 300 });

suite.add('quantize-median-cut-640x480', () => {
  quantizeMedianCut(largeImagePhoto, 256);
}, { iterations: 4, warmup: 1, target: 800 });

// =============================================================================
// Fixed palette quantization (fast)
// =============================================================================

suite.add('quantize-fixed-256-64x64', () => {
  quantizeFixed256(smallImage);
}, { iterations: 200, target: 0.5 });

suite.add('quantize-fixed-256-256x256', () => {
  quantizeFixed256(mediumImage);
}, { iterations: 50, target: 1.0 });

suite.add('quantize-fixed-216-256x256', () => {
  quantizeFixed216(mediumImage);
}, { iterations: 50, target: 1.0 });

// =============================================================================
// Grayscale conversion
// =============================================================================

suite.add('grayscale-convert-256x256', () => {
  convertToGrayscale(mediumImage);
}, { iterations: 100, target: 2.0 });

suite.add('grayscale-convert-640x480', () => {
  convertToGrayscale(largeImage);
}, { iterations: 20, target: 10.0 });

// Run benchmarks
const results = await suite.run();

// Analyze results and add findings
const getMedian = (name: string) => results.find(r => r.name === name)?.median ?? 0;

suite.addFindings([
  {
    title: 'Median-cut quantization is expensive',
    description: 'Median-cut quantization dominates graphics pipeline time. Use fixed palettes or cache quantization results for static images.',
    category: 'recommendation',
    severity: 'warning',
    benchmarks: ['quantize-median-cut-256x256', 'quantize-fixed-256-256x256'],
    metrics: {
      medianCutMs: getMedian('quantize-median-cut-256x256'),
      fixedMs: getMedian('quantize-fixed-256-256x256'),
      ratio: `${(getMedian('quantize-median-cut-256x256') / getMedian('quantize-fixed-256-256x256')).toFixed(0)}x`,
    },
  },
  {
    title: 'Fixed-216 web-safe palette is fast',
    description: 'Fixed-216 (web-safe) palette is as fast as fixed-256 and produces consistent results across terminals.',
    category: 'info',
    benchmarks: ['quantize-fixed-256-256x256', 'quantize-fixed-216-256x256'],
    metrics: {
      fixed256Ms: getMedian('quantize-fixed-256-256x256'),
      fixed216Ms: getMedian('quantize-fixed-216-256x256'),
    },
  },
]);

suite.setNotes('Quantization benchmarks. Median-cut is O(n*colors) and expensive. Fixed palettes are O(n). Cache quantization for static images.');

// Save results
const outputPath = new URL('../results/quantization-' + benchmarkTimestamp() + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
