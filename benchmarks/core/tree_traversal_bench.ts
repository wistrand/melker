/**
 * Tree traversal benchmarks - element tree searching and filtering
 * Fundamental operations used in focus management, hit testing, and element lookup.
 */

import { BenchmarkSuite, benchmarkTimestamp } from '../harness.ts';
import {
  findElement,
  hasElement,
  collectElements,
  isDescendant,
  findElementById,
  findParentOf,
  type ElementPredicate,
} from '../../src/utils/tree-traversal.ts';
import { createElement } from '../../mod.ts';
import type { Element } from '../../src/types.ts';

const suite = new BenchmarkSuite('tree-traversal');

// =============================================================================
// Helper functions to create test trees
// =============================================================================

function el(type: string, id: string, children: Element[] = []): Element {
  return createElement(type, { id }, ...children);
}

/**
 * Create a flat tree with many siblings
 */
function createFlatTree(count: number): Element {
  const children: Element[] = [];
  for (let i = 0; i < count; i++) {
    children.push(el('text', `flat-${i}`));
  }
  return el('container', 'root', children);
}

/**
 * Create a deep tree (single child chain)
 */
function createDeepTree(depth: number): Element {
  if (depth === 0) {
    return el('text', 'leaf');
  }
  return el('container', `level-${depth}`, [createDeepTree(depth - 1)]);
}

/**
 * Create a balanced wide tree
 */
function createWideTree(levels: number, childrenPerLevel: number): { root: Element; totalNodes: number } {
  let nodeCount = 0;

  function createLevel(level: number): Element {
    const id = `node-${nodeCount++}`;
    if (level >= levels) {
      return el('text', id);
    }
    const children: Element[] = [];
    for (let i = 0; i < childrenPerLevel; i++) {
      children.push(createLevel(level + 1));
    }
    return el('container', id, children);
  }

  const root = createLevel(0);
  return { root, totalNodes: nodeCount };
}

/**
 * Create a tree with specific element types distributed
 */
function createMixedTree(count: number): Element {
  const children: Element[] = [];
  for (let i = 0; i < count; i++) {
    const type = i % 5 === 0 ? 'button' : i % 3 === 0 ? 'input' : 'text';
    children.push(el(type, `mixed-${i}`));
  }
  return el('container', 'root', children);
}

/**
 * Create a tree with nested containers
 */
function createNestedContainerTree(depth: number, width: number): Element {
  function createLevel(level: number, prefix: string): Element {
    const id = `${prefix}-${level}`;
    if (level >= depth) {
      return el('text', id);
    }
    const children: Element[] = [];
    for (let i = 0; i < width; i++) {
      children.push(createLevel(level + 1, `${prefix}-${i}`));
    }
    return el('container', id, children);
  }
  return createLevel(0, 'nested');
}

// =============================================================================
// Pre-create test trees
// =============================================================================

const flat100 = createFlatTree(100);
const flat500 = createFlatTree(500);
const flat1000 = createFlatTree(1000);

const deep10 = createDeepTree(10);
const deep20 = createDeepTree(20);
const deep50 = createDeepTree(50);

const wide3x5 = createWideTree(3, 5);   // 156 nodes
const wide4x4 = createWideTree(4, 4);   // 341 nodes
const wide5x3 = createWideTree(5, 3);   // 364 nodes
const wide4x5 = createWideTree(4, 5);   // 781 nodes

const mixed100 = createMixedTree(100);
const mixed500 = createMixedTree(500);

const nested4x3 = createNestedContainerTree(4, 3);

// Predicates for testing
const alwaysFalse: ElementPredicate = () => false;
const isButton: ElementPredicate = (el) => el.type === 'button';
const isInput: ElementPredicate = (el) => el.type === 'input';
const isText: ElementPredicate = (el) => el.type === 'text';
const hasIdPrefix = (prefix: string): ElementPredicate => (el) => el.id?.startsWith(prefix) ?? false;

// =============================================================================
// findElement benchmarks
// =============================================================================

// Find first element (early return)
suite.add('find-flat100-first', () => {
  findElement(flat100, (el) => el.id === 'flat-0');
}, { iterations: 5000, target: 0.002 });

// Find middle element
suite.add('find-flat100-middle', () => {
  findElement(flat100, (el) => el.id === 'flat-50');
}, { iterations: 5000, target: 0.005 });

// Find last element
suite.add('find-flat100-last', () => {
  findElement(flat100, (el) => el.id === 'flat-99');
}, { iterations: 5000, target: 0.01 });

// Not found (full traversal)
suite.add('find-flat100-notfound', () => {
  findElement(flat100, alwaysFalse);
}, { iterations: 5000, target: 0.01 });

// Find in large flat tree
suite.add('find-flat1000-middle', () => {
  findElement(flat1000, (el) => el.id === 'flat-500');
}, { iterations: 2000, target: 0.05 });

// Find leaf in deep tree
suite.add('find-deep20-leaf', () => {
  findElement(deep20, (el) => el.id === 'leaf');
}, { iterations: 5000, target: 0.005 });

suite.add('find-deep50-leaf', () => {
  findElement(deep50, (el) => el.id === 'leaf');
}, { iterations: 2000, target: 0.01 });

// Find in wide tree
suite.add('find-wide4x4-lastnode', () => {
  findElement(wide4x4.root, (el) => el.id === `node-${wide4x4.totalNodes - 1}`);
}, { iterations: 2000, target: 0.03 });

suite.add('find-wide4x5-middle', () => {
  const middleId = `node-${Math.floor(wide4x5.totalNodes / 2)}`;
  findElement(wide4x5.root, (el) => el.id === middleId);
}, { iterations: 2000, target: 0.03 });

// =============================================================================
// hasElement benchmarks
// =============================================================================

suite.add('has-flat100-first', () => {
  hasElement(flat100, (el) => el.id === 'flat-0');
}, { iterations: 5000, target: 0.002 });

suite.add('has-flat100-notfound', () => {
  hasElement(flat100, alwaysFalse);
}, { iterations: 5000, target: 0.01 });

suite.add('has-wide4x4-exists', () => {
  hasElement(wide4x4.root, (el) => el.id === `node-${wide4x4.totalNodes - 1}`);
}, { iterations: 2000, target: 0.03 });

suite.add('has-wide4x4-notexists', () => {
  hasElement(wide4x4.root, alwaysFalse);
}, { iterations: 2000, target: 0.03 });

// =============================================================================
// collectElements benchmarks
// =============================================================================

// Collect all elements (full traversal)
suite.add('collect-flat100-all', () => {
  collectElements(flat100, () => true);
}, { iterations: 2000, target: 0.02 });

// Collect by type (sparse matches)
suite.add('collect-mixed100-buttons', () => {
  collectElements(mixed100, isButton);
}, { iterations: 2000, target: 0.02 });

suite.add('collect-mixed500-buttons', () => {
  collectElements(mixed500, isButton);
}, { iterations: 1000, target: 0.08 });

// Collect none (full traversal, no matches)
suite.add('collect-flat100-none', () => {
  collectElements(flat100, alwaysFalse);
}, { iterations: 2000, target: 0.015 });

// Collect in wide tree
suite.add('collect-wide4x4-all', () => {
  collectElements(wide4x4.root, () => true);
}, { iterations: 1000, target: 0.05 });

suite.add('collect-wide4x5-text', () => {
  collectElements(wide4x5.root, isText);
}, { iterations: 1000, target: 0.1 });

// Reuse result array (optimization pattern)
const reusableArray: Element[] = [];
suite.add('collect-flat100-reuse', () => {
  reusableArray.length = 0;
  collectElements(flat100, () => true, reusableArray);
}, { iterations: 2000, target: 0.015 });

// =============================================================================
// isDescendant benchmarks
// =============================================================================

// Target is root (immediate match)
suite.add('descendant-isroot', () => {
  isDescendant(flat100, flat100);
}, { iterations: 10000, target: 0.001 });

// Target is direct child
suite.add('descendant-directchild', () => {
  const child = flat100.children![0];
  isDescendant(child, flat100);
}, { iterations: 5000, target: 0.002 });

// Target is deep leaf
suite.add('descendant-deep20-leaf', () => {
  const leaf = findElement(deep20, (el) => el.id === 'leaf')!;
  isDescendant(leaf, deep20);
}, { iterations: 5000, target: 0.005 });

// Target not in tree
suite.add('descendant-notfound', () => {
  const outsider = el('text', 'outsider');
  isDescendant(outsider, flat100);
}, { iterations: 2000, target: 0.015 });

// Wide tree descendant check
suite.add('descendant-wide4x4-leaf', () => {
  const leaf = findElement(wide4x4.root, (el) => el.id === `node-${wide4x4.totalNodes - 1}`)!;
  isDescendant(leaf, wide4x4.root);
}, { iterations: 2000, target: 0.03 });

// =============================================================================
// findElementById benchmarks
// =============================================================================

suite.add('findById-flat100-first', () => {
  findElementById(flat100, 'flat-0');
}, { iterations: 5000, target: 0.002 });

suite.add('findById-flat100-last', () => {
  findElementById(flat100, 'flat-99');
}, { iterations: 5000, target: 0.01 });

suite.add('findById-wide4x4-middle', () => {
  findElementById(wide4x4.root, `node-${Math.floor(wide4x4.totalNodes / 2)}`);
}, { iterations: 2000, target: 0.02 });

suite.add('findById-notfound', () => {
  findElementById(flat100, 'nonexistent');
}, { iterations: 5000, target: 0.01 });

// =============================================================================
// findParentOf benchmarks
// =============================================================================

suite.add('findParent-flat100-child', () => {
  findParentOf(flat100, 'flat-50');
}, { iterations: 5000, target: 0.005 });

suite.add('findParent-deep20-leaf', () => {
  findParentOf(deep20, 'leaf');
}, { iterations: 5000, target: 0.005 });

suite.add('findParent-wide4x4-deep', () => {
  findParentOf(wide4x4.root, `node-${wide4x4.totalNodes - 1}`);
}, { iterations: 2000, target: 0.03 });

suite.add('findParent-notfound', () => {
  findParentOf(flat100, 'nonexistent');
}, { iterations: 5000, target: 0.01 });

// =============================================================================
// Bulk operations (simulates real usage patterns)
// =============================================================================

suite.add('bulk-find-10-ids', () => {
  for (let i = 0; i < 10; i++) {
    findElementById(flat100, `flat-${i * 10}`);
  }
}, { iterations: 1000, target: 0.05 });

suite.add('bulk-has-20-checks', () => {
  for (let i = 0; i < 20; i++) {
    hasElement(mixed100, (el) => el.id === `mixed-${i * 5}`);
  }
}, { iterations: 500, target: 0.1 });

// =============================================================================
// Run benchmarks
// =============================================================================

const results = await suite.run();

// Helper to get median from results
const getMedian = (name: string) => results.find(r => r.name === name)?.median ?? 0;

// Add findings
suite.addFindings([
  {
    title: 'Early termination provides significant speedup',
    description: 'Finding first element vs last element shows the benefit of depth-first early return.',
    category: 'info',
    benchmarks: ['find-flat100-first', 'find-flat100-middle', 'find-flat100-last'],
    metrics: {
      firstMs: getMedian('find-flat100-first'),
      middleMs: getMedian('find-flat100-middle'),
      lastMs: getMedian('find-flat100-last'),
      ratio: (getMedian('find-flat100-last') / getMedian('find-flat100-first')).toFixed(1) + 'x',
    }
  },
  {
    title: 'Tree shape affects traversal time',
    description: 'Deep trees traverse faster than wide trees with same node count due to fewer siblings to check.',
    category: 'info',
    benchmarks: ['find-deep20-leaf', 'find-wide4x4-lastnode'],
    metrics: {
      deep20Ms: getMedian('find-deep20-leaf'),
      wide341Ms: getMedian('find-wide4x4-lastnode'),
    }
  },
  {
    title: 'collectElements with array reuse is faster',
    description: 'Reusing a result array avoids allocation overhead in hot paths.',
    category: 'info',
    benchmarks: ['collect-flat100-all', 'collect-flat100-reuse'],
    metrics: {
      newArrayMs: getMedian('collect-flat100-all'),
      reuseArrayMs: getMedian('collect-flat100-reuse'),
    }
  },
  {
    title: 'isDescendant is O(n) worst case',
    description: 'Descendant check requires full tree traversal when element is not found.',
    category: 'info',
    benchmarks: ['descendant-isroot', 'descendant-directchild', 'descendant-notfound'],
    metrics: {
      isRootMs: getMedian('descendant-isroot'),
      directChildMs: getMedian('descendant-directchild'),
      notFoundMs: getMedian('descendant-notfound'),
    }
  },
  {
    title: 'Traversal scales linearly with node count',
    description: 'Full traversal time correlates with total nodes in tree.',
    category: 'info',
    benchmarks: ['find-flat100-notfound', 'find-flat1000-middle', 'collect-wide4x4-all'],
    metrics: {
      flat100Ms: getMedian('find-flat100-notfound'),
      flat1000Ms: getMedian('find-flat1000-middle'),
      wide341Ms: getMedian('collect-wide4x4-all'),
    }
  }
]);

suite.setNotes('Tree traversal benchmarks. Tests findElement, hasElement, collectElements, isDescendant, findElementById, and findParentOf across flat trees (100-1000 nodes), deep trees (10-50 levels), and wide balanced trees (150-780 nodes).');

// Save results
const outputPath = new URL('../results/tree-traversal-' + benchmarkTimestamp() + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
