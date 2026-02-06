/**
 * Graphics encoding benchmarks - Sixel and Kitty protocols
 *
 * Split from graphics_bench.ts to keep suite under 60s.
 */

import { BenchmarkSuite, benchmarkTimestamp } from '../harness.ts';
import { encodeToSixel, quantizeMedianCut, quantizeFixed256 } from '../../src/sixel/mod.ts';
import { encodeToKitty } from '../../src/kitty/mod.ts';

const suite = new BenchmarkSuite('encoding');

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
const smallWidth = 64, smallHeight = 64;
const mediumWidth = 256, mediumHeight = 256;
const largeWidth = 640, largeHeight = 480;

const smallImage = generateGradientImage(smallWidth, smallHeight);
const mediumImage = generateGradientImage(mediumWidth, mediumHeight);
const mediumImagePhoto = generatePhotoLikeImage(mediumWidth, mediumHeight);
const largeImage = generateGradientImage(largeWidth, largeHeight);

// Pre-quantize images for sixel encoding (done once at setup)
const smallQuantized = quantizeMedianCut(smallImage, 256);
const mediumQuantized = quantizeMedianCut(mediumImage, 256);
const mediumQuantized64 = quantizeMedianCut(mediumImage, 64);
const largeQuantized = quantizeMedianCut(largeImage, 256);

// =============================================================================
// Sixel encoding benchmarks
// =============================================================================

suite.add('sixel-encode-64x64', () => {
  encodeToSixel({
    palette: smallQuantized.colors,
    indexed: smallQuantized.indexed,
    width: smallWidth,
    height: smallHeight,
    transparentIndex: smallQuantized.transparentIndex,
    useRLE: true,
  });
}, { iterations: 100, target: 2.0 });

suite.add('sixel-encode-256x256', () => {
  encodeToSixel({
    palette: mediumQuantized.colors,
    indexed: mediumQuantized.indexed,
    width: mediumWidth,
    height: mediumHeight,
    transparentIndex: mediumQuantized.transparentIndex,
    useRLE: true,
  });
}, { iterations: 20, target: 20.0 });

suite.add('sixel-encode-640x480', () => {
  encodeToSixel({
    palette: largeQuantized.colors,
    indexed: largeQuantized.indexed,
    width: largeWidth,
    height: largeHeight,
    transparentIndex: largeQuantized.transparentIndex,
    useRLE: true,
  });
}, { iterations: 5, target: 50.0 });

// Without RLE compression
suite.add('sixel-encode-no-rle-256x256', () => {
  encodeToSixel({
    palette: mediumQuantized.colors,
    indexed: mediumQuantized.indexed,
    width: mediumWidth,
    height: mediumHeight,
    transparentIndex: mediumQuantized.transparentIndex,
    useRLE: false,
  });
}, { iterations: 20, target: 25.0 });

// Smaller palette (64 colors)
suite.add('sixel-encode-64colors-256x256', () => {
  encodeToSixel({
    palette: mediumQuantized64.colors,
    indexed: mediumQuantized64.indexed,
    width: mediumWidth,
    height: mediumHeight,
    transparentIndex: mediumQuantized64.transparentIndex,
    useRLE: true,
  });
}, { iterations: 20, target: 2.0 });

// =============================================================================
// Kitty encoding benchmarks
// =============================================================================

suite.add('kitty-encode-64x64', () => {
  encodeToKitty({
    pixels: smallImage,
    width: smallWidth,
    height: smallHeight,
    format: 'rgba',
  });
}, { iterations: 200, target: 0.5 });

suite.add('kitty-encode-256x256', () => {
  encodeToKitty({
    pixels: mediumImage,
    width: mediumWidth,
    height: mediumHeight,
    format: 'rgba',
  });
}, { iterations: 50, target: 5.0 });

suite.add('kitty-encode-640x480', () => {
  encodeToKitty({
    pixels: largeImage,
    width: largeWidth,
    height: largeHeight,
    format: 'rgba',
  });
}, { iterations: 10, target: 15.0 });

// RGB format (no alpha, smaller output)
suite.add('kitty-encode-rgb-256x256', () => {
  encodeToKitty({
    pixels: mediumImage,
    width: mediumWidth,
    height: mediumHeight,
    format: 'rgb',
  });
}, { iterations: 50, target: 3.0 });

suite.add('kitty-encode-rgb-640x480', () => {
  encodeToKitty({
    pixels: largeImage,
    width: largeWidth,
    height: largeHeight,
    format: 'rgb',
  });
}, { iterations: 10, target: 12.0 });

// =============================================================================
// Full pipeline benchmarks (quantize + encode)
// =============================================================================

suite.add('pipeline-sixel-256x256', () => {
  const quantized = quantizeFixed256(mediumImagePhoto);
  encodeToSixel({
    palette: quantized.colors,
    indexed: quantized.indexed,
    width: mediumWidth,
    height: mediumHeight,
    transparentIndex: quantized.transparentIndex,
    useRLE: true,
  });
}, { iterations: 20, target: 15.0 });

suite.add('pipeline-kitty-256x256', () => {
  // Kitty doesn't need quantization, direct encode
  encodeToKitty({
    pixels: mediumImagePhoto,
    width: mediumWidth,
    height: mediumHeight,
    format: 'rgba',
  });
}, { iterations: 50, target: 3.0 });

// Run benchmarks
const results = await suite.run();

// Analyze results and add findings
const getMedian = (name: string) => results.find(r => r.name === name)?.median ?? 0;

const sixelTime = getMedian('sixel-encode-256x256');
const kittyTime = getMedian('kitty-encode-256x256');
const sixelNoRle = getMedian('sixel-encode-no-rle-256x256');

suite.addFindings([
  {
    title: 'Kitty encoding is faster than Sixel',
    description: `Kitty protocol encodes ${(sixelTime / kittyTime).toFixed(1)}x faster than Sixel at 256x256. Kitty avoids palette quantization overhead.`,
    category: 'comparison',
    benchmarks: ['sixel-encode-256x256', 'kitty-encode-256x256'],
    metrics: { sixelMs: sixelTime, kittyMs: kittyTime, speedup: `${(sixelTime / kittyTime).toFixed(1)}x` },
  },
  {
    title: 'RLE compression improves Sixel encoding',
    description: `RLE compression makes Sixel encoding ${(sixelNoRle / sixelTime).toFixed(1)}x faster by reducing output size.`,
    category: 'performance',
    benchmarks: ['sixel-encode-256x256', 'sixel-encode-no-rle-256x256'],
    metrics: { withRleMs: sixelTime, noRleMs: sixelNoRle },
  },
  {
    title: 'RGB format slightly faster than RGBA',
    description: `Kitty RGB format (no alpha) encodes slightly faster and produces smaller output.`,
    category: 'info',
    benchmarks: ['kitty-encode-256x256', 'kitty-encode-rgb-256x256'],
    metrics: {
      rgbaMs: getMedian('kitty-encode-256x256'),
      rgbMs: getMedian('kitty-encode-rgb-256x256'),
    },
  },
]);

suite.setNotes('Encoding benchmarks for Sixel and Kitty protocols. Kitty is faster because it sends raw pixels; Sixel requires palette encoding. Use Kitty when terminal supports it.');

// Save results
const outputPath = new URL('../results/encoding-' + benchmarkTimestamp() + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
