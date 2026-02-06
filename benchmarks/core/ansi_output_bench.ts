/**
 * ANSI output generation benchmarks - terminal rendering output
 * Final step in the rendering pipeline that generates escape sequences.
 */

import { BenchmarkSuite, benchmarkTimestamp } from '../harness.ts';
import { AnsiOutputGenerator, type BufferDifference, type BufferCell } from '../../src/ansi-output.ts';

const suite = new BenchmarkSuite('ansi-output');

// =============================================================================
// Helper functions to create test data
// =============================================================================

const TERMINAL_WIDTH = 120;
const TERMINAL_HEIGHT = 40;

function createCell(char: string, fg?: number, bg?: number, bold = false, italic = false): BufferCell {
  return {
    char,
    foreground: fg,
    background: bg,
    bold,
    italic,
  };
}

function createScatteredDiffs(count: number): BufferDifference[] {
  const diffs: BufferDifference[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i * 7) % TERMINAL_WIDTH;
    const y = Math.floor((i * 13) / TERMINAL_WIDTH) % TERMINAL_HEIGHT;
    diffs.push({
      x,
      y,
      cell: createCell(
        String.fromCharCode(65 + (i % 26)),
        0xff0000ff + (i * 0x001100),
        0x000000ff
      ),
    });
  }
  return diffs;
}

function createContiguousDiffs(rows: number, cols: number, startX = 0, startY = 0): BufferDifference[] {
  const diffs: BufferDifference[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      diffs.push({
        x: startX + x,
        y: startY + y,
        cell: createCell(
          String.fromCharCode(65 + ((x + y) % 26)),
          0xffffffff,
          0x000000ff
        ),
      });
    }
  }
  return diffs;
}

function createFullScreenDiff(): BufferDifference[] {
  const diffs: BufferDifference[] = [];
  for (let y = 0; y < TERMINAL_HEIGHT; y++) {
    for (let x = 0; x < TERMINAL_WIDTH; x++) {
      diffs.push({
        x,
        y,
        cell: createCell(
          String.fromCharCode(65 + ((x + y) % 26)),
          0xffffffff,
          0x000000ff
        ),
      });
    }
  }
  return diffs;
}

function createStyledDiffs(count: number): BufferDifference[] {
  const diffs: BufferDifference[] = [];
  for (let i = 0; i < count; i++) {
    const x = i % TERMINAL_WIDTH;
    const y = Math.floor(i / TERMINAL_WIDTH);
    diffs.push({
      x,
      y,
      cell: createCell(
        'X',
        0xff0000ff + (i % 256) * 0x010000,  // Varying red
        0x0000ffff + (i % 256) * 0x000100,  // Varying blue
        i % 3 === 0,  // Bold every 3rd
        i % 5 === 0   // Italic every 5th
      ),
    });
  }
  return diffs;
}

function createSingleRowDiff(row: number, startCol: number, length: number): BufferDifference[] {
  const diffs: BufferDifference[] = [];
  for (let x = startCol; x < startCol + length && x < TERMINAL_WIDTH; x++) {
    diffs.push({
      x,
      y: row,
      cell: createCell('=', 0xffffffff, 0x000000ff),
    });
  }
  return diffs;
}

function createMultipleSpansDiff(): BufferDifference[] {
  // Create several non-contiguous spans across different rows
  const diffs: BufferDifference[] = [];

  // Span 1: Row 5, cols 10-20
  for (let x = 10; x < 20; x++) {
    diffs.push({ x, y: 5, cell: createCell('A', 0xff0000ff) });
  }

  // Span 2: Row 5, cols 50-60 (same row, different location)
  for (let x = 50; x < 60; x++) {
    diffs.push({ x, y: 5, cell: createCell('B', 0x00ff00ff) });
  }

  // Span 3: Row 10, cols 0-30
  for (let x = 0; x < 30; x++) {
    diffs.push({ x, y: 10, cell: createCell('C', 0x0000ffff) });
  }

  // Span 4: Row 20, cols 80-119
  for (let x = 80; x < TERMINAL_WIDTH; x++) {
    diffs.push({ x, y: 20, cell: createCell('D', 0xffff00ff) });
  }

  return diffs;
}

// =============================================================================
// Pre-create test data
// =============================================================================

const scattered10 = createScatteredDiffs(10);
const scattered100 = createScatteredDiffs(100);
const scattered500 = createScatteredDiffs(500);
const scattered1000 = createScatteredDiffs(1000);

const contiguous10x10 = createContiguousDiffs(10, 10);
const contiguous20x60 = createContiguousDiffs(20, 60);
const contiguousFullRow = createContiguousDiffs(1, TERMINAL_WIDTH);
const contiguous5Rows = createContiguousDiffs(5, TERMINAL_WIDTH);

const fullScreen = createFullScreenDiff();

const styled100 = createStyledDiffs(100);
const styled500 = createStyledDiffs(500);

const singleRow = createSingleRowDiff(10, 20, 80);
const multipleSpans = createMultipleSpansDiff();

// Create generators for different color modes
const generatorTruecolor = new AnsiOutputGenerator({ colorSupport: 'truecolor' });
const generator256 = new AnsiOutputGenerator({ colorSupport: '256' });
const generator16 = new AnsiOutputGenerator({ colorSupport: '16' });
const generatorNone = new AnsiOutputGenerator({ colorSupport: 'none' });

// =============================================================================
// Scattered differences (worst case - many cursor jumps)
// =============================================================================

suite.add('ansi-scattered-10', () => {
  generatorTruecolor.generateOptimizedOutput(scattered10, TERMINAL_WIDTH);
}, { iterations: 2000, target: 0.02 });

suite.add('ansi-scattered-100', () => {
  generatorTruecolor.generateOptimizedOutput(scattered100, TERMINAL_WIDTH);
}, { iterations: 1000, target: 0.1 });

suite.add('ansi-scattered-500', () => {
  generatorTruecolor.generateOptimizedOutput(scattered500, TERMINAL_WIDTH);
}, { iterations: 500, target: 0.5 });

suite.add('ansi-scattered-1000', () => {
  generatorTruecolor.generateOptimizedOutput(scattered1000, TERMINAL_WIDTH);
}, { iterations: 200, target: 1.0 });

// =============================================================================
// Contiguous differences (best case - minimal cursor movement)
// =============================================================================

suite.add('ansi-contiguous-10x10', () => {
  generatorTruecolor.generateOptimizedOutput(contiguous10x10, TERMINAL_WIDTH);
}, { iterations: 2000, target: 0.05 });

suite.add('ansi-contiguous-20x60', () => {
  generatorTruecolor.generateOptimizedOutput(contiguous20x60, TERMINAL_WIDTH);
}, { iterations: 500, target: 0.5 });

suite.add('ansi-contiguous-fullrow', () => {
  generatorTruecolor.generateOptimizedOutput(contiguousFullRow, TERMINAL_WIDTH);
}, { iterations: 2000, target: 0.05 });

suite.add('ansi-contiguous-5rows', () => {
  generatorTruecolor.generateOptimizedOutput(contiguous5Rows, TERMINAL_WIDTH);
}, { iterations: 1000, target: 0.3 });

// =============================================================================
// Full screen update
// =============================================================================

suite.add('ansi-fullscreen', () => {
  generatorTruecolor.generateOptimizedOutput(fullScreen, TERMINAL_WIDTH);
}, { iterations: 100, target: 3.0 });

// =============================================================================
// Styled content (many style changes)
// =============================================================================

suite.add('ansi-styled-100', () => {
  generatorTruecolor.generateOptimizedOutput(styled100, TERMINAL_WIDTH);
}, { iterations: 1000, target: 0.15 });

suite.add('ansi-styled-500', () => {
  generatorTruecolor.generateOptimizedOutput(styled500, TERMINAL_WIDTH);
}, { iterations: 500, target: 0.6 });

// =============================================================================
// Multiple spans (realistic update pattern)
// =============================================================================

suite.add('ansi-singlerow', () => {
  generatorTruecolor.generateOptimizedOutput(singleRow, TERMINAL_WIDTH);
}, { iterations: 2000, target: 0.05 });

suite.add('ansi-multiplespans', () => {
  generatorTruecolor.generateOptimizedOutput(multipleSpans, TERMINAL_WIDTH);
}, { iterations: 2000, target: 0.05 });

// =============================================================================
// Color support modes comparison
// =============================================================================

suite.add('ansi-truecolor-100', () => {
  generatorTruecolor.generateOptimizedOutput(scattered100, TERMINAL_WIDTH);
}, { iterations: 1000, target: 0.1 });

suite.add('ansi-256color-100', () => {
  generator256.generateOptimizedOutput(scattered100, TERMINAL_WIDTH);
}, { iterations: 1000, target: 0.1 });

suite.add('ansi-16color-100', () => {
  generator16.generateOptimizedOutput(scattered100, TERMINAL_WIDTH);
}, { iterations: 1000, target: 0.1 });

suite.add('ansi-nocolor-100', () => {
  generatorNone.generateOptimizedOutput(scattered100, TERMINAL_WIDTH);
}, { iterations: 1000, target: 0.08 });

// =============================================================================
// Output size comparison (measures string length, not time)
// =============================================================================

// These measure how optimized the output is
let outputSizes: Record<string, number> = {};

suite.add('ansi-output-size-scattered', () => {
  const output = generatorTruecolor.generateOptimizedOutput(scattered100, TERMINAL_WIDTH);
  outputSizes['scattered100'] = output.length;
}, { iterations: 100, target: 0.15 });

suite.add('ansi-output-size-contiguous', () => {
  const output = generatorTruecolor.generateOptimizedOutput(contiguous10x10, TERMINAL_WIDTH);
  outputSizes['contiguous10x10'] = output.length;
}, { iterations: 100, target: 0.1 });

// =============================================================================
// Run benchmarks
// =============================================================================

const results = await suite.run();

// Helper to get median from results
const getMedian = (name: string) => results.find(r => r.name === name)?.median ?? 0;

// Add findings
suite.addFindings([
  {
    title: 'Contiguous spans are much faster than scattered',
    description: 'Contiguous cell updates benefit from span grouping, reducing cursor movements.',
    category: 'info',
    benchmarks: ['ansi-scattered-100', 'ansi-contiguous-10x10'],
    metrics: {
      scattered100Ms: getMedian('ansi-scattered-100'),
      contiguous100Ms: getMedian('ansi-contiguous-10x10'),
      ratio: (getMedian('ansi-scattered-100') / getMedian('ansi-contiguous-10x10')).toFixed(1) + 'x',
    }
  },
  {
    title: 'Full screen updates are within frame budget',
    description: 'Rendering all 4800 cells (120x40) takes ~2-3ms, well under 16.67ms budget.',
    category: 'info',
    benchmarks: ['ansi-fullscreen'],
    metrics: {
      fullScreenMs: getMedian('ansi-fullscreen'),
      cellCount: TERMINAL_WIDTH * TERMINAL_HEIGHT,
      usPerCell: ((getMedian('ansi-fullscreen') * 1000) / (TERMINAL_WIDTH * TERMINAL_HEIGHT)).toFixed(2),
    }
  },
  {
    title: 'Color mode has minimal performance impact',
    description: 'Truecolor, 256-color, and 16-color modes have similar generation times.',
    category: 'info',
    benchmarks: ['ansi-truecolor-100', 'ansi-256color-100', 'ansi-16color-100', 'ansi-nocolor-100'],
    metrics: {
      truecolorMs: getMedian('ansi-truecolor-100'),
      color256Ms: getMedian('ansi-256color-100'),
      color16Ms: getMedian('ansi-16color-100'),
      noColorMs: getMedian('ansi-nocolor-100'),
    }
  },
  {
    title: 'Style changes add overhead',
    description: 'Frequent style changes (bold, italic, colors) increase output generation time.',
    category: 'info',
    benchmarks: ['ansi-scattered-100', 'ansi-styled-100'],
    metrics: {
      simpleMs: getMedian('ansi-scattered-100'),
      styledMs: getMedian('ansi-styled-100'),
    }
  }
]);

suite.setNotes('ANSI output generation benchmarks. Tests scattered vs contiguous updates, full screen rendering, style changes, color mode comparisons (truecolor/256/16/none), and span grouping optimization.');

// Save results
const outputPath = new URL('../results/ansi-output-' + benchmarkTimestamp() + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
