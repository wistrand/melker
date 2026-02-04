/**
 * Data-heatmap component benchmarks
 */

import { BenchmarkSuite } from '../harness.ts';
import { createElement, TerminalBuffer, globalLayoutEngine, RenderingEngine } from '../../mod.ts';

const suite = new BenchmarkSuite('components');

// Generate random grid data
function generateGrid(rows: number, cols: number): number[][] {
  const grid: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(Math.random() * 100);
    }
    grid.push(row);
  }
  return grid;
}

// Generate gradient grid (for isolines)
function generateGradientGrid(rows: number, cols: number): number[][] {
  const grid: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      // Create a gradient from corner to corner
      row.push((r / rows + c / cols) * 50);
    }
    grid.push(row);
  }
  return grid;
}

const viewport = { width: 120, height: 40 };
const renderer = new RenderingEngine();

function makeContext(width: number, height: number) {
  return {
    viewport: { x: 0, y: 0, width, height },
    parentBounds: { x: 0, y: 0, width, height },
    availableSpace: { width, height },
  };
}

// Small heatmap (20x10)
const smallGrid = generateGrid(10, 20);
const smallHeatmap = createElement('data-heatmap', {
  grid: smallGrid,
  colorScale: 'viridis',
});

suite.add('heatmap-20x10', () => {
  globalLayoutEngine.calculateLayout(smallHeatmap, makeContext(viewport.width, viewport.height));
  const buffer = new TerminalBuffer(viewport.width, viewport.height);
  renderer.render(smallHeatmap, buffer, viewport.width, viewport.height);
}, { iterations: 500, target: 0.5 });

// Medium heatmap (50x30)
const mediumGrid = generateGrid(30, 50);
const mediumHeatmap = createElement('data-heatmap', {
  grid: mediumGrid,
  colorScale: 'thermal',
});

suite.add('heatmap-50x30', () => {
  globalLayoutEngine.calculateLayout(mediumHeatmap, makeContext(viewport.width, viewport.height));
  const buffer = new TerminalBuffer(viewport.width, viewport.height);
  renderer.render(mediumHeatmap, buffer, viewport.width, viewport.height);
}, { iterations: 200, target: 0.5 });

// Heatmap with isolines
const isolineGrid = generateGradientGrid(30, 50);
const isolineHeatmap = createElement('data-heatmap', {
  grid: isolineGrid,
  colorScale: 'viridis',
  isolines: [
    { value: 20 },
    { value: 40 },
    { value: 60 },
    { value: 80 },
  ],
});

suite.add('heatmap-isolines-4', () => {
  globalLayoutEngine.calculateLayout(isolineHeatmap, makeContext(viewport.width, viewport.height));
  const buffer = new TerminalBuffer(viewport.width, viewport.height);
  renderer.render(isolineHeatmap, buffer, viewport.width, viewport.height);
}, { iterations: 200, target: 0.5 });

// Heatmap with auto-isolines
const autoIsolineHeatmap = createElement('data-heatmap', {
  grid: isolineGrid,
  colorScale: 'plasma',
  isolineCount: 5,
  isolineMode: 'nice',
});

suite.add('heatmap-auto-isolines', () => {
  globalLayoutEngine.calculateLayout(autoIsolineHeatmap, makeContext(viewport.width, viewport.height));
  const buffer = new TerminalBuffer(viewport.width, viewport.height);
  renderer.render(autoIsolineHeatmap, buffer, viewport.width, viewport.height);
}, { iterations: 200, target: 0.5 });

// Heatmap with values displayed
const valuesHeatmap = createElement('data-heatmap', {
  grid: smallGrid,
  colorScale: 'inferno',
  showValues: true,
  valueFormat: '.1f',
});

suite.add('heatmap-with-values', () => {
  globalLayoutEngine.calculateLayout(valuesHeatmap, makeContext(viewport.width, viewport.height));
  const buffer = new TerminalBuffer(viewport.width, viewport.height);
  renderer.render(valuesHeatmap, buffer, viewport.width, viewport.height);
}, { iterations: 500, target: 0.5 });

// Large heatmap (100x50)
const largeGrid = generateGrid(50, 100);
const largeHeatmap = createElement('data-heatmap', {
  grid: largeGrid,
  colorScale: 'viridis',
});

suite.add('heatmap-100x50', () => {
  globalLayoutEngine.calculateLayout(largeHeatmap, makeContext(200, 60));
  const buffer = new TerminalBuffer(200, 60);
  renderer.render(largeHeatmap, buffer, 200, 60);
}, { iterations: 100, target: 1.0 });

// Isolines-only mode
const isolinesOnlyHeatmap = createElement('data-heatmap', {
  grid: isolineGrid,
  showCells: false,
  isolineCount: 6,
  isolineMode: 'equal',
  showIsolineLabels: true,
});

suite.add('heatmap-isolines-only', () => {
  globalLayoutEngine.calculateLayout(isolinesOnlyHeatmap, makeContext(viewport.width, viewport.height));
  const buffer = new TerminalBuffer(viewport.width, viewport.height);
  renderer.render(isolinesOnlyHeatmap, buffer, viewport.width, viewport.height);
}, { iterations: 200, target: 0.5 });

// Run benchmarks
const results = await suite.run();

// Save results
const outputPath = new URL('../results/components-' + new Date().toISOString().slice(0, 10) + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
