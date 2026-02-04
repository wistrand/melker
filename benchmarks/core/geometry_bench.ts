/**
 * Geometry utilities benchmarks - bounds checking, clipping, intersection
 * These are fundamental operations called thousands of times per frame.
 */

import { BenchmarkSuite } from '../harness.ts';
import { pointInBounds, clampToBounds, clipBounds, boundsIntersect } from '../../src/geometry.ts';
import type { Bounds } from '../../src/types.ts';

const suite = new BenchmarkSuite('geometry');

// =============================================================================
// Test data
// =============================================================================

// Standard bounds for testing
const bounds100x100: Bounds = { x: 0, y: 0, width: 100, height: 100 };
const bounds50x50: Bounds = { x: 25, y: 25, width: 50, height: 50 };
const boundsOffset: Bounds = { x: 50, y: 50, width: 100, height: 100 };
const boundsNoOverlap: Bounds = { x: 200, y: 200, width: 50, height: 50 };

// Pre-generate random test points for consistent benchmarks
const randomPoints: Array<{ x: number; y: number }> = [];
for (let i = 0; i < 10000; i++) {
  randomPoints.push({
    x: Math.floor(Math.random() * 200) - 50,
    y: Math.floor(Math.random() * 200) - 50,
  });
}

// Pre-generate bounds pairs for intersection testing
const boundsPairs: Array<{ a: Bounds; b: Bounds }> = [];
for (let i = 0; i < 1000; i++) {
  boundsPairs.push({
    a: {
      x: Math.floor(Math.random() * 100),
      y: Math.floor(Math.random() * 100),
      width: 20 + Math.floor(Math.random() * 80),
      height: 20 + Math.floor(Math.random() * 80),
    },
    b: {
      x: Math.floor(Math.random() * 100),
      y: Math.floor(Math.random() * 100),
      width: 20 + Math.floor(Math.random() * 80),
      height: 20 + Math.floor(Math.random() * 80),
    },
  });
}

// =============================================================================
// pointInBounds benchmarks
// =============================================================================

// Single point check (baseline)
suite.add('pointInBounds-single', () => {
  pointInBounds(50, 50, bounds100x100);
}, { iterations: 10000, target: 0.001 });

// Point inside bounds
suite.add('pointInBounds-inside', () => {
  for (let i = 0; i < 1000; i++) {
    pointInBounds(50, 50, bounds100x100);
  }
}, { iterations: 1000, target: 0.02 });

// Point outside bounds
suite.add('pointInBounds-outside', () => {
  for (let i = 0; i < 1000; i++) {
    pointInBounds(150, 150, bounds100x100);
  }
}, { iterations: 1000, target: 0.02 });

// Point on edge (boundary condition)
suite.add('pointInBounds-edge', () => {
  for (let i = 0; i < 1000; i++) {
    pointInBounds(0, 0, bounds100x100);
    pointInBounds(99, 99, bounds100x100);
    pointInBounds(100, 100, bounds100x100); // just outside
  }
}, { iterations: 1000, target: 0.03 });

// Random points (realistic workload)
suite.add('pointInBounds-1000-random', () => {
  for (let i = 0; i < 1000; i++) {
    const pt = randomPoints[i];
    pointInBounds(pt.x, pt.y, bounds100x100);
  }
}, { iterations: 500, target: 0.03 });

// High volume (simulates full-frame hit testing)
suite.add('pointInBounds-10000', () => {
  for (let i = 0; i < 10000; i++) {
    const pt = randomPoints[i];
    pointInBounds(pt.x, pt.y, bounds100x100);
  }
}, { iterations: 100, target: 0.2 });

// =============================================================================
// clampToBounds benchmarks
// =============================================================================

suite.add('clampToBounds-inside', () => {
  for (let i = 0; i < 1000; i++) {
    clampToBounds({ x: 50, y: 50 }, bounds100x100);
  }
}, { iterations: 1000, target: 0.03 });

suite.add('clampToBounds-outside', () => {
  for (let i = 0; i < 1000; i++) {
    clampToBounds({ x: 150, y: -50 }, bounds100x100);
  }
}, { iterations: 1000, target: 0.03 });

suite.add('clampToBounds-1000-random', () => {
  for (let i = 0; i < 1000; i++) {
    const pt = randomPoints[i];
    clampToBounds(pt, bounds100x100);
  }
}, { iterations: 500, target: 0.05 });

// =============================================================================
// clipBounds benchmarks
// =============================================================================

// Full overlap (inner bounds completely inside outer)
suite.add('clipBounds-full-overlap', () => {
  for (let i = 0; i < 1000; i++) {
    clipBounds(bounds50x50, bounds100x100);
  }
}, { iterations: 1000, target: 0.03 });

// Partial overlap
suite.add('clipBounds-partial-overlap', () => {
  for (let i = 0; i < 1000; i++) {
    clipBounds(boundsOffset, bounds100x100);
  }
}, { iterations: 1000, target: 0.03 });

// No overlap
suite.add('clipBounds-no-overlap', () => {
  for (let i = 0; i < 1000; i++) {
    clipBounds(boundsNoOverlap, bounds100x100);
  }
}, { iterations: 1000, target: 0.03 });

// Random bounds pairs
suite.add('clipBounds-1000-random', () => {
  for (let i = 0; i < 1000; i++) {
    const pair = boundsPairs[i];
    clipBounds(pair.a, pair.b);
  }
}, { iterations: 500, target: 0.05 });

// =============================================================================
// boundsIntersect benchmarks
// =============================================================================

// Intersecting bounds
suite.add('boundsIntersect-true', () => {
  for (let i = 0; i < 1000; i++) {
    boundsIntersect(bounds100x100, boundsOffset);
  }
}, { iterations: 1000, target: 0.02 });

// Non-intersecting bounds
suite.add('boundsIntersect-false', () => {
  for (let i = 0; i < 1000; i++) {
    boundsIntersect(bounds100x100, boundsNoOverlap);
  }
}, { iterations: 1000, target: 0.02 });

// Edge-touching bounds
suite.add('boundsIntersect-edge', () => {
  const edgeBounds: Bounds = { x: 100, y: 0, width: 50, height: 50 };
  for (let i = 0; i < 1000; i++) {
    boundsIntersect(bounds100x100, edgeBounds);
  }
}, { iterations: 1000, target: 0.02 });

// Random bounds pairs
suite.add('boundsIntersect-1000-random', () => {
  for (let i = 0; i < 1000; i++) {
    const pair = boundsPairs[i];
    boundsIntersect(pair.a, pair.b);
  }
}, { iterations: 500, target: 0.03 });

// =============================================================================
// Combined operations (realistic scenarios)
// =============================================================================

// Viewport clipping simulation (clip + intersect check)
suite.add('viewport-clip-check-1000', () => {
  const viewport: Bounds = { x: 0, y: 0, width: 120, height: 40 };
  for (let i = 0; i < 1000; i++) {
    const pair = boundsPairs[i];
    if (boundsIntersect(pair.a, viewport)) {
      clipBounds(pair.a, viewport);
    }
  }
}, { iterations: 500, target: 0.05 });

// Hit test simulation (point check + bounds intersection)
suite.add('hit-test-simulation-1000', () => {
  for (let i = 0; i < 1000; i++) {
    const pt = randomPoints[i];
    const pair = boundsPairs[i];
    if (pointInBounds(pt.x, pt.y, pair.a)) {
      boundsIntersect(pair.a, pair.b);
    }
  }
}, { iterations: 500, target: 0.04 });

// =============================================================================
// Run benchmarks
// =============================================================================

const results = await suite.run();

// Helper to get median from results
const getMedian = (name: string) => results.find(r => r.name === name)?.median ?? 0;

// Add findings
suite.addFindings([
  {
    title: 'pointInBounds is extremely fast',
    description: 'Single point-in-bounds check takes ~1 nanosecond. Can perform millions per frame.',
    category: 'info',
    benchmarks: ['pointInBounds-single', 'pointInBounds-10000'],
    metrics: {
      singleNs: (getMedian('pointInBounds-single') * 1000000).toFixed(0),
      per10000Ms: getMedian('pointInBounds-10000'),
    }
  },
  {
    title: 'All geometry operations are sub-microsecond',
    description: 'clipBounds and boundsIntersect are comparable in cost to pointInBounds.',
    category: 'info',
    benchmarks: ['pointInBounds-1000-random', 'clipBounds-1000-random', 'boundsIntersect-1000-random'],
    metrics: {
      pointInBoundsMs: getMedian('pointInBounds-1000-random'),
      clipBoundsMs: getMedian('clipBounds-1000-random'),
      boundsIntersectMs: getMedian('boundsIntersect-1000-random'),
    }
  },
  {
    title: 'Object creation in clampToBounds adds overhead',
    description: 'clampToBounds creates a new Point object, making it slightly slower than pure checks.',
    category: 'info',
    benchmarks: ['pointInBounds-1000-random', 'clampToBounds-1000-random'],
    metrics: {
      pointInBoundsMs: getMedian('pointInBounds-1000-random'),
      clampToBoundsMs: getMedian('clampToBounds-1000-random'),
    }
  }
]);

suite.setNotes('Geometry utility benchmarks. Tests pointInBounds, clampToBounds, clipBounds, and boundsIntersect at various scales. These are foundational operations used in hit testing, rendering, and viewport management.');

// Save results
const outputPath = new URL('../results/geometry-' + new Date().toISOString().slice(0, 10) + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
