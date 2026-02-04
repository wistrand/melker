/**
 * Buffer benchmarks - core rendering operations
 */

import { BenchmarkSuite } from '../harness.ts';
import { TerminalBuffer } from '../../mod.ts';

const suite = new BenchmarkSuite('rendering');

// Create test buffers
const WIDTH = 120;
const HEIGHT = 40;

let buffer1: TerminalBuffer;
let buffer2: TerminalBuffer;

function setup() {
  buffer1 = new TerminalBuffer(WIDTH, HEIGHT);
  buffer2 = new TerminalBuffer(WIDTH, HEIGHT);

  // Fill with some content
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      buffer1.setCell(x, y, {
        char: String.fromCharCode(65 + (x + y) % 26),
        fg: '#ffffff',
        bg: '#000000',
      });
    }
  }

  // Copy to buffer2 with some differences
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const cell = buffer1.getCell(x, y);
      if (cell) {
        buffer2.setCell(x, y, { ...cell });
      }
    }
  }

  // Make ~10% of cells different
  for (let i = 0; i < (WIDTH * HEIGHT * 0.1); i++) {
    const x = Math.floor(Math.random() * WIDTH);
    const y = Math.floor(Math.random() * HEIGHT);
    buffer2.setCell(x, y, { char: 'X', fg: '#ff0000', bg: '#000000' });
  }
}

// Buffer diff (comparing two buffers)
suite.add('buffer-diff', () => {
  buffer1.diff(buffer2);
}, { iterations: 1000, warmup: 100, target: 0.2 });

// SetCell operations
suite.add('setCell-1000', () => {
  for (let i = 0; i < 1000; i++) {
    const x = i % WIDTH;
    const y = Math.floor(i / WIDTH) % HEIGHT;
    buffer1.setCell(x, y, { char: 'A', fg: '#fff', bg: '#000' });
  }
}, { iterations: 500, target: 0.2 });

// SetText operations
suite.add('setText-line', () => {
  const text = 'Hello, World! This is a benchmark test string.';
  for (let y = 0; y < HEIGHT; y++) {
    buffer1.setText(0, y, text);
  }
}, { iterations: 500, target: 0.5 });

// FillRect operations
suite.add('fillRect-full', () => {
  buffer1.fillRect(0, 0, WIDTH, HEIGHT, { char: ' ', fg: '#fff', bg: '#000' });
}, { iterations: 500, target: 0.5 });

suite.add('fillRect-quarter', () => {
  buffer1.fillRect(0, 0, WIDTH / 2, HEIGHT / 2, { char: ' ', fg: '#fff', bg: '#000' });
}, { iterations: 1000, target: 0.2 });

// DrawBorder
suite.add('drawBorder', () => {
  buffer1.drawBorder(0, 0, WIDTH, HEIGHT, 'thin', '#fff', '#000');
}, { iterations: 1000, target: 1.0 });

// Buffer clear
suite.add('clear', () => {
  buffer1.clear();
}, { iterations: 1000, target: 0.3 });

// Run benchmarks
setup();
const results = await suite.run();

// Save results
const outputPath = new URL('../results/rendering-' + new Date().toISOString().slice(0, 10) + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
