/**
 * Hit testing benchmarks - element detection at screen coordinates
 * Critical hot path that runs on every mouse move and click.
 */

import { BenchmarkSuite, benchmarkTimestamp } from '../harness.ts';
import { HitTester, type HitTestContext } from '../../src/hit-test.ts';
import { Document } from '../../src/document.ts';
import { RenderingEngine } from '../../src/rendering.ts';
import { createElement } from '../../mod.ts';
import type { Element, Bounds } from '../../src/types.ts';

const suite = new BenchmarkSuite('hit-test');

// =============================================================================
// Mock setup helpers
// =============================================================================

/**
 * Create a mock rendering engine that returns predictable bounds
 */
function createMockRenderer(boundsMap: Map<string, Bounds>): RenderingEngine {
  const renderer = new RenderingEngine();
  // Override getContainerBounds to return our test bounds
  (renderer as any).getContainerBounds = (id: string): Bounds | undefined => {
    return boundsMap.get(id);
  };
  return renderer;
}

/**
 * Create a document with a given root element
 */
function createDocument(root: Element): Document {
  const doc = new Document(root);
  return doc;
}

/**
 * Create a simple element with an ID
 */
function el(type: string, id: string, props: Record<string, unknown> = {}, children: Element[] = []): Element {
  const element = createElement(type, { id, ...props }, ...children);
  return element;
}

/**
 * Create a flat list of elements
 */
function createFlatTree(count: number): { root: Element; bounds: Map<string, Bounds> } {
  const bounds = new Map<string, Bounds>();
  const children: Element[] = [];

  for (let i = 0; i < count; i++) {
    const id = `item-${i}`;
    children.push(el('button', id, { onClick: () => {} }));
    bounds.set(id, {
      x: 0,
      y: i * 2,
      width: 100,
      height: 2,
    });
  }

  const root = el('container', 'root', {}, children);
  bounds.set('root', { x: 0, y: 0, width: 100, height: count * 2 });

  return { root, bounds };
}

/**
 * Create a deeply nested tree
 */
function createDeepTree(depth: number): { root: Element; bounds: Map<string, Bounds> } {
  const bounds = new Map<string, Bounds>();

  function createLevel(level: number): Element {
    const id = `level-${level}`;
    const isLeaf = level === depth;

    const element = isLeaf
      ? el('button', id, { onClick: () => {} })
      : el('container', id, {}, [createLevel(level + 1)]);

    bounds.set(id, {
      x: level,
      y: level,
      width: 100 - level * 2,
      height: 40 - level,
    });

    return element;
  }

  const root = createLevel(0);
  return { root, bounds };
}

/**
 * Create a wide tree with many siblings at each level
 */
function createWideTree(levels: number, childrenPerLevel: number): { root: Element; bounds: Map<string, Bounds> } {
  const bounds = new Map<string, Bounds>();
  let elementCount = 0;

  function createLevel(level: number, parentX: number, parentY: number): Element[] {
    if (level >= levels) return [];

    const children: Element[] = [];
    const childWidth = 100 / childrenPerLevel;

    for (let i = 0; i < childrenPerLevel; i++) {
      const id = `el-${elementCount++}`;
      const x = parentX + i * childWidth;
      const y = parentY + level * 5;

      const grandchildren = createLevel(level + 1, x, y);
      const element = level === levels - 1
        ? el('button', id, { onClick: () => {} })
        : el('container', id, {}, grandchildren);

      bounds.set(id, {
        x: Math.floor(x),
        y: Math.floor(y),
        width: Math.floor(childWidth),
        height: 5,
      });

      children.push(element);
    }

    return children;
  }

  const rootChildren = createLevel(0, 0, 0);
  const root = el('container', 'root', {}, rootChildren);
  bounds.set('root', { x: 0, y: 0, width: 100, height: levels * 5 });

  return { root, bounds };
}

/**
 * Create a tree with mixed interactive and non-interactive elements
 */
function createMixedTree(count: number): { root: Element; bounds: Map<string, Bounds> } {
  const bounds = new Map<string, Bounds>();
  const children: Element[] = [];

  for (let i = 0; i < count; i++) {
    const id = `item-${i}`;
    // Every 3rd element is interactive
    const isInteractive = i % 3 === 0;
    children.push(el(isInteractive ? 'button' : 'text', id,
      isInteractive ? { onClick: () => {} } : { text: 'Text' }));
    bounds.set(id, {
      x: 0,
      y: i * 2,
      width: 100,
      height: 2,
    });
  }

  const root = el('container', 'root', {}, children);
  bounds.set('root', { x: 0, y: 0, width: 100, height: count * 2 });

  return { root, bounds };
}

/**
 * Create a tree with scrollable containers
 */
function createScrollableTree(): { root: Element; bounds: Map<string, Bounds> } {
  const bounds = new Map<string, Bounds>();

  const innerItems: Element[] = [];
  for (let i = 0; i < 50; i++) {
    const id = `scroll-item-${i}`;
    innerItems.push(el('button', id, { onClick: () => {} }));
    bounds.set(id, {
      x: 5,
      y: 5 + i * 2,
      width: 90,
      height: 2,
    });
  }

  const scrollContainer = el('container', 'scroll-container', {
    style: 'overflow: scroll',
    scrollX: 0,
    scrollY: 20, // Scrolled down 20 pixels
  }, innerItems);
  bounds.set('scroll-container', { x: 0, y: 0, width: 100, height: 40 });

  const root = el('container', 'root', {}, [scrollContainer]);
  bounds.set('root', { x: 0, y: 0, width: 100, height: 40 });

  return { root, bounds };
}

// =============================================================================
// Pre-create test trees for benchmarks
// =============================================================================

const flatTree10 = createFlatTree(10);
const flatTree100 = createFlatTree(100);
const flatTree500 = createFlatTree(500);

const deepTree5 = createDeepTree(5);
const deepTree10 = createDeepTree(10);
const deepTree20 = createDeepTree(20);

const wideTree3x5 = createWideTree(3, 5);   // 155 elements
const wideTree4x4 = createWideTree(4, 4);   // 340 elements
const wideTree3x10 = createWideTree(3, 10); // 1110 elements

const mixedTree100 = createMixedTree(100);
const scrollableTree = createScrollableTree();

// Pre-create hit testers
function createHitTester(tree: { root: Element; bounds: Map<string, Bounds> }): HitTester {
  const doc = createDocument(tree.root);
  const renderer = createMockRenderer(tree.bounds);
  return new HitTester({
    document: doc,
    renderer,
    viewportSize: { width: 120, height: 40 },
  });
}

const hitTesterFlat10 = createHitTester(flatTree10);
const hitTesterFlat100 = createHitTester(flatTree100);
const hitTesterFlat500 = createHitTester(flatTree500);

const hitTesterDeep5 = createHitTester(deepTree5);
const hitTesterDeep10 = createHitTester(deepTree10);
const hitTesterDeep20 = createHitTester(deepTree20);

const hitTesterWide3x5 = createHitTester(wideTree3x5);
const hitTesterWide4x4 = createHitTester(wideTree4x4);
const hitTesterWide3x10 = createHitTester(wideTree3x10);

const hitTesterMixed100 = createHitTester(mixedTree100);
const hitTesterScrollable = createHitTester(scrollableTree);

// =============================================================================
// Flat tree benchmarks
// =============================================================================

suite.add('hit-flat-10-first', () => {
  hitTesterFlat10.hitTest(50, 1); // First element
}, { iterations: 5000, target: 0.01 });

suite.add('hit-flat-10-last', () => {
  hitTesterFlat10.hitTest(50, 19); // Last element
}, { iterations: 5000, target: 0.01 });

suite.add('hit-flat-100-first', () => {
  hitTesterFlat100.hitTest(50, 1);
}, { iterations: 2000, target: 0.02 });

suite.add('hit-flat-100-middle', () => {
  hitTesterFlat100.hitTest(50, 100); // Middle
}, { iterations: 2000, target: 0.02 });

suite.add('hit-flat-100-last', () => {
  hitTesterFlat100.hitTest(50, 199);
}, { iterations: 2000, target: 0.02 });

suite.add('hit-flat-500-first', () => {
  hitTesterFlat500.hitTest(50, 1);
}, { iterations: 1000, target: 0.03 });

suite.add('hit-flat-500-last', () => {
  hitTesterFlat500.hitTest(50, 999);
}, { iterations: 1000, target: 0.05 });

// =============================================================================
// Deep tree benchmarks
// =============================================================================

suite.add('hit-deep-5', () => {
  hitTesterDeep5.hitTest(5, 5); // Hit deepest element
}, { iterations: 5000, target: 0.01 });

suite.add('hit-deep-10', () => {
  hitTesterDeep10.hitTest(10, 10);
}, { iterations: 5000, target: 0.015 });

suite.add('hit-deep-20', () => {
  hitTesterDeep20.hitTest(20, 20);
}, { iterations: 2000, target: 0.02 });

// =============================================================================
// Wide tree benchmarks
// =============================================================================

suite.add('hit-wide-3x5-leaf', () => {
  hitTesterWide3x5.hitTest(10, 12); // A leaf element
}, { iterations: 2000, target: 0.02 });

suite.add('hit-wide-4x4-leaf', () => {
  hitTesterWide4x4.hitTest(10, 17);
}, { iterations: 2000, target: 0.03 });

suite.add('hit-wide-3x10-leaf', () => {
  hitTesterWide3x10.hitTest(5, 12);
}, { iterations: 1000, target: 0.08 });

// =============================================================================
// Miss scenarios (no element found)
// =============================================================================

suite.add('hit-miss-flat-100', () => {
  hitTesterFlat100.hitTest(150, 150); // Outside bounds
}, { iterations: 2000, target: 0.02 });

suite.add('hit-miss-wide-3x10', () => {
  hitTesterWide3x10.hitTest(150, 150);
}, { iterations: 1000, target: 0.08 });

// =============================================================================
// Mixed tree (interactive + non-interactive)
// =============================================================================

suite.add('hit-mixed-interactive', () => {
  hitTesterMixed100.hitTest(50, 1); // First element (interactive)
}, { iterations: 2000, target: 0.02 });

suite.add('hit-mixed-non-interactive', () => {
  hitTesterMixed100.hitTest(50, 3); // Second element (non-interactive)
}, { iterations: 2000, target: 0.02 });

// =============================================================================
// Multiple hits (simulates mouse movement)
// =============================================================================

suite.add('hit-100-random-flat100', () => {
  for (let i = 0; i < 100; i++) {
    const y = Math.floor(Math.random() * 200);
    hitTesterFlat100.hitTest(50, y);
  }
}, { iterations: 500, target: 1.5 });

suite.add('hit-100-random-wide3x10', () => {
  for (let i = 0; i < 100; i++) {
    const x = Math.floor(Math.random() * 100);
    const y = Math.floor(Math.random() * 15);
    hitTesterWide3x10.hitTest(x, y);
  }
}, { iterations: 500, target: 8.0 });

// =============================================================================
// isInteractiveElement checks
// =============================================================================

const interactiveButton = el('button', 'btn', { onClick: () => {} });
const nonInteractiveText = el('text', 'txt', { text: 'Hello' });

suite.add('isInteractive-button-1000', () => {
  for (let i = 0; i < 1000; i++) {
    hitTesterFlat10.isInteractiveElement(interactiveButton);
  }
}, { iterations: 1000, target: 0.05 });

suite.add('isInteractive-text-1000', () => {
  for (let i = 0; i < 1000; i++) {
    hitTesterFlat10.isInteractiveElement(nonInteractiveText);
  }
}, { iterations: 1000, target: 0.05 });

// =============================================================================
// Run benchmarks
// =============================================================================

const results = await suite.run();

// Helper to get median from results
const getMedian = (name: string) => results.find(r => r.name === name)?.median ?? 0;

// Add findings
suite.addFindings([
  {
    title: 'Hit testing scales with tree traversal depth',
    description: 'Flat trees are fastest. Deep nesting adds overhead for each level traversed.',
    category: 'info',
    benchmarks: ['hit-flat-10-first', 'hit-deep-5', 'hit-deep-10', 'hit-deep-20'],
    metrics: {
      flat10Ms: getMedian('hit-flat-10-first'),
      deep5Ms: getMedian('hit-deep-5'),
      deep10Ms: getMedian('hit-deep-10'),
      deep20Ms: getMedian('hit-deep-20'),
    }
  },
  {
    title: 'Wide trees have higher traversal cost',
    description: 'Trees with many siblings at each level require checking more elements.',
    category: 'info',
    benchmarks: ['hit-wide-3x5-leaf', 'hit-wide-4x4-leaf', 'hit-wide-3x10-leaf'],
    metrics: {
      '155elements': getMedian('hit-wide-3x5-leaf'),
      '340elements': getMedian('hit-wide-4x4-leaf'),
      '1110elements': getMedian('hit-wide-3x10-leaf'),
    }
  },
  {
    title: 'Element position in flat list affects hit time',
    description: 'First-match returns quickly. Elements at the end require full traversal.',
    category: 'info',
    benchmarks: ['hit-flat-500-first', 'hit-flat-500-last'],
    metrics: {
      firstMs: getMedian('hit-flat-500-first'),
      lastMs: getMedian('hit-flat-500-last'),
      ratio: (getMedian('hit-flat-500-last') / getMedian('hit-flat-500-first')).toFixed(1) + 'x',
    }
  },
  {
    title: 'Hit testing is fast enough for 60fps',
    description: '100 random hit tests on large tree takes ~2-3ms, well within 16.67ms frame budget.',
    category: 'info',
    benchmarks: ['hit-100-random-flat100', 'hit-100-random-wide3x10'],
    metrics: {
      flat100randomMs: getMedian('hit-100-random-flat100'),
      wide3x10randomMs: getMedian('hit-100-random-wide3x10'),
    }
  }
]);

suite.setNotes('Hit testing benchmarks. Tests element detection across flat trees (10-500 elements), deep trees (5-20 levels), and wide trees (150-1100 elements). Includes miss scenarios and interactive element checks.');

// Save results
const outputPath = new URL('../results/hit-test-' + benchmarkTimestamp() + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
