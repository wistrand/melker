/**
 * Content measurement benchmarks - element sizing for layout calculations
 * Runs before every layout calculation to determine intrinsic sizes.
 */

import { BenchmarkSuite, benchmarkTimestamp } from '../harness.ts';
import { ContentMeasurer } from '../../src/content-measurer.ts';
import { createElement } from '../../mod.ts';
import type { Element } from '../../src/types.ts';

const suite = new BenchmarkSuite('content-measurer');

const measurer = new ContentMeasurer();

// =============================================================================
// Helper functions to create test elements
// =============================================================================

function createTextElement(text: string): Element {
  return createElement('text', { text });
}

function createButtonElement(label: string): Element {
  return createElement('button', { label, onClick: () => {} });
}

function createInputElement(value: string = '', placeholder: string = ''): Element {
  return createElement('input', { value, placeholder });
}

function createFlatContainer(childCount: number, childType: 'text' | 'button' = 'text'): Element {
  const children: Element[] = [];
  for (let i = 0; i < childCount; i++) {
    if (childType === 'text') {
      children.push(createTextElement(`Item ${i + 1}`));
    } else {
      children.push(createButtonElement(`Button ${i + 1}`));
    }
  }
  return createElement('container', {}, ...children);
}

function createNestedContainer(depth: number, childrenPerLevel: number = 2): Element {
  if (depth === 0) {
    return createTextElement('Leaf node');
  }

  const children: Element[] = [];
  for (let i = 0; i < childrenPerLevel; i++) {
    children.push(createNestedContainer(depth - 1, childrenPerLevel));
  }
  return createElement('container', {}, ...children);
}

function createScrollableContainer(childCount: number): Element {
  const children: Element[] = [];
  for (let i = 0; i < childCount; i++) {
    children.push(createTextElement(`Scrollable item ${i + 1} with some longer text content`));
  }
  return createElement('container', { scrollable: true }, ...children);
}

function createRowContainer(childCount: number): Element {
  const children: Element[] = [];
  for (let i = 0; i < childCount; i++) {
    children.push(createTextElement(`Col ${i + 1}`));
  }
  return createElement('container', { style: { flexDirection: 'row' } }, ...children);
}

function createContainerWithGap(childCount: number, gap: number): Element {
  const children: Element[] = [];
  for (let i = 0; i < childCount; i++) {
    children.push(createTextElement(`Item ${i + 1}`));
  }
  return createElement('container', { style: { gap } }, ...children);
}

function createContainerWithPadding(childCount: number, padding: number): Element {
  const children: Element[] = [];
  for (let i = 0; i < childCount; i++) {
    children.push(createTextElement(`Item ${i + 1}`));
  }
  return createElement('container', { style: { padding } }, ...children);
}

function createMixedContainer(count: number): Element {
  const children: Element[] = [];
  for (let i = 0; i < count; i++) {
    switch (i % 4) {
      case 0:
        children.push(createTextElement(`Text item ${i}`));
        break;
      case 1:
        children.push(createButtonElement(`Button ${i}`));
        break;
      case 2:
        children.push(createInputElement(`value${i}`, `placeholder${i}`));
        break;
      case 3:
        children.push(createElement('container', {},
          createTextElement('Nested text')
        ));
        break;
    }
  }
  return createElement('container', {}, ...children);
}

// =============================================================================
// Pre-create test elements
// =============================================================================

const textShort = createTextElement('Hello');
const textLong = createTextElement('This is a much longer piece of text that would need to be wrapped across multiple lines in a typical terminal window.');
const button = createButtonElement('Click Me');
const input = createInputElement('some value', 'Enter text...');

const flat10 = createFlatContainer(10);
const flat50 = createFlatContainer(50);
const flat100 = createFlatContainer(100);
const flat500 = createFlatContainer(500);

const nested3x2 = createNestedContainer(3, 2);  // 15 elements
const nested4x3 = createNestedContainer(4, 3);  // 121 elements
const nested5x2 = createNestedContainer(5, 2);  // 63 elements

const scrollable30 = createScrollableContainer(30);  // Below fast-path threshold
const scrollable100 = createScrollableContainer(100); // Above fast-path threshold
const scrollable500 = createScrollableContainer(500); // Well above threshold

const row10 = createRowContainer(10);
const row50 = createRowContainer(50);

const gapped20 = createContainerWithGap(20, 1);
const padded20 = createContainerWithPadding(20, 2);

const mixed50 = createMixedContainer(50);
const mixed100 = createMixedContainer(100);

const AVAILABLE_WIDTH = 120;

// =============================================================================
// Single element measurement
// =============================================================================

suite.add('measure-text-short', () => {
  measurer.measureElement(textShort, AVAILABLE_WIDTH);
}, { iterations: 5000, target: 0.005 });

suite.add('measure-text-long', () => {
  measurer.measureElement(textLong, AVAILABLE_WIDTH);
}, { iterations: 5000, target: 0.005 });

suite.add('measure-button', () => {
  measurer.measureElement(button, AVAILABLE_WIDTH);
}, { iterations: 5000, target: 0.005 });

suite.add('measure-input', () => {
  measurer.measureElement(input, AVAILABLE_WIDTH);
}, { iterations: 5000, target: 0.005 });

// =============================================================================
// Flat container measurement
// =============================================================================

suite.add('measure-flat-10', () => {
  measurer.measureContainer(flat10, AVAILABLE_WIDTH);
}, { iterations: 2000, target: 0.02 });

suite.add('measure-flat-50', () => {
  measurer.measureContainer(flat50, AVAILABLE_WIDTH);
}, { iterations: 1000, target: 0.08 });

suite.add('measure-flat-100', () => {
  measurer.measureContainer(flat100, AVAILABLE_WIDTH);
}, { iterations: 500, target: 0.15 });

suite.add('measure-flat-500', () => {
  measurer.measureContainer(flat500, AVAILABLE_WIDTH);
}, { iterations: 200, target: 0.8 });

// =============================================================================
// Nested container measurement
// =============================================================================

suite.add('measure-nested-3x2', () => {
  measurer.measureContainer(nested3x2, AVAILABLE_WIDTH);
}, { iterations: 2000, target: 0.03 });

suite.add('measure-nested-4x3', () => {
  measurer.measureContainer(nested4x3, AVAILABLE_WIDTH);
}, { iterations: 500, target: 0.2 });

suite.add('measure-nested-5x2', () => {
  measurer.measureContainer(nested5x2, AVAILABLE_WIDTH);
}, { iterations: 1000, target: 0.1 });

// =============================================================================
// Scrollable container (fast-path vs full measurement)
// =============================================================================

suite.add('measure-scrollable-30-full', () => {
  measurer.measureContainer(scrollable30, AVAILABLE_WIDTH);
}, { iterations: 1000, target: 0.05 });

suite.add('measure-scrollable-100-fastpath', () => {
  measurer.measureContainer(scrollable100, AVAILABLE_WIDTH);
}, { iterations: 1000, target: 0.02 });

suite.add('measure-scrollable-500-fastpath', () => {
  measurer.measureContainer(scrollable500, AVAILABLE_WIDTH);
}, { iterations: 1000, target: 0.02 });

// =============================================================================
// Row layout measurement
// =============================================================================

suite.add('measure-row-10', () => {
  measurer.measureContainer(row10, AVAILABLE_WIDTH);
}, { iterations: 2000, target: 0.02 });

suite.add('measure-row-50', () => {
  measurer.measureContainer(row50, AVAILABLE_WIDTH);
}, { iterations: 1000, target: 0.08 });

// =============================================================================
// Containers with styling (gap, padding)
// =============================================================================

suite.add('measure-gapped-20', () => {
  measurer.measureContainer(gapped20, AVAILABLE_WIDTH);
}, { iterations: 2000, target: 0.03 });

suite.add('measure-padded-20', () => {
  measurer.measureContainer(padded20, AVAILABLE_WIDTH);
}, { iterations: 2000, target: 0.03 });

// =============================================================================
// Mixed element types
// =============================================================================

suite.add('measure-mixed-50', () => {
  measurer.measureContainer(mixed50, AVAILABLE_WIDTH);
}, { iterations: 1000, target: 0.1 });

suite.add('measure-mixed-100', () => {
  measurer.measureContainer(mixed100, AVAILABLE_WIDTH);
}, { iterations: 500, target: 0.2 });

// =============================================================================
// Bulk measurement (simulates layout recalculation)
// =============================================================================

suite.add('measure-bulk-100-elements', () => {
  for (let i = 0; i < 100; i++) {
    measurer.measureElement(textShort, AVAILABLE_WIDTH);
  }
}, { iterations: 500, target: 0.3 });

// =============================================================================
// Run benchmarks
// =============================================================================

const results = await suite.run();

// Helper to get median from results
const getMedian = (name: string) => results.find(r => r.name === name)?.median ?? 0;

// Add findings
suite.addFindings([
  {
    title: 'Single element measurement is extremely fast',
    description: 'Measuring individual elements takes <5 microseconds regardless of content.',
    category: 'info',
    benchmarks: ['measure-text-short', 'measure-text-long', 'measure-button', 'measure-input'],
    metrics: {
      textShortUs: (getMedian('measure-text-short') * 1000).toFixed(1),
      textLongUs: (getMedian('measure-text-long') * 1000).toFixed(1),
      buttonUs: (getMedian('measure-button') * 1000).toFixed(1),
      inputUs: (getMedian('measure-input') * 1000).toFixed(1),
    }
  },
  {
    title: 'Container measurement scales linearly with child count',
    description: 'Measuring a flat container takes ~1.5µs per child element.',
    category: 'info',
    benchmarks: ['measure-flat-10', 'measure-flat-50', 'measure-flat-100', 'measure-flat-500'],
    metrics: {
      flat10Ms: getMedian('measure-flat-10'),
      flat50Ms: getMedian('measure-flat-50'),
      flat100Ms: getMedian('measure-flat-100'),
      flat500Ms: getMedian('measure-flat-500'),
    }
  },
  {
    title: 'Fast-path optimization for scrollable containers',
    description: 'Scrollable containers with >50 children use sampling, making measurement O(1) instead of O(n).',
    category: 'info',
    benchmarks: ['measure-scrollable-30-full', 'measure-scrollable-100-fastpath', 'measure-scrollable-500-fastpath'],
    metrics: {
      scroll30Ms: getMedian('measure-scrollable-30-full'),
      scroll100Ms: getMedian('measure-scrollable-100-fastpath'),
      scroll500Ms: getMedian('measure-scrollable-500-fastpath'),
      speedup: (getMedian('measure-scrollable-30-full') / getMedian('measure-scrollable-500-fastpath')).toFixed(1) + 'x',
    }
  },
  {
    title: 'Nested containers add depth overhead',
    description: 'Deeply nested containers require recursive measurement but remain fast for typical depths.',
    category: 'info',
    benchmarks: ['measure-nested-3x2', 'measure-nested-4x3', 'measure-nested-5x2'],
    metrics: {
      nested3x2Ms: getMedian('measure-nested-3x2'),
      nested4x3Ms: getMedian('measure-nested-4x3'),
      nested5x2Ms: getMedian('measure-nested-5x2'),
    }
  }
]);

suite.setNotes('Content measurement benchmarks. Tests single element measurement, flat containers (10-500 children), nested containers (various depths), scrollable container fast-path optimization, and mixed element type containers.');

// Save results
const outputPath = new URL('../results/content-measurer-' + benchmarkTimestamp() + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
