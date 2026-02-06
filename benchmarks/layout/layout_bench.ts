/**
 * Layout engine benchmarks
 */

import { BenchmarkSuite, benchmarkTimestamp } from '../harness.ts';
import { createElement, globalLayoutEngine } from '../../mod.ts';

const suite = new BenchmarkSuite('layout');

function makeContext(width: number, height: number) {
  return {
    viewport: { x: 0, y: 0, width, height },
    parentBounds: { x: 0, y: 0, width, height },
    availableSpace: { width, height },
  };
}

const viewport = { width: 120, height: 40 };

// Flat layout with 50 elements
const flatContainer = createElement('container', {
  style: { flexDirection: 'column' },
}, ...Array.from({ length: 50 }, (_, i) =>
  createElement('text', { text: `Item ${i}` })
));

suite.add('layout-50-flat', () => {
  globalLayoutEngine.calculateLayout(flatContainer, makeContext(viewport.width, viewport.height));
}, { iterations: 1000, target: 0.5 });

// Row layout with 20 elements
const rowContainer = createElement('container', {
  style: { flexDirection: 'row', gap: 1 },
}, ...Array.from({ length: 20 }, (_, i) =>
  createElement('text', { text: `Col${i}` })
));

suite.add('layout-20-row', () => {
  globalLayoutEngine.calculateLayout(rowContainer, makeContext(viewport.width, viewport.height));
}, { iterations: 1000, target: 0.3 });

// Deep nested tree (10 levels deep)
function createDeepTree(depth: number): ReturnType<typeof createElement> {
  if (depth === 0) {
    return createElement('text', { text: 'Leaf' });
  }
  return createElement('container', {
    style: { padding: 1 },
  }, createDeepTree(depth - 1));
}

const deepTree = createDeepTree(10);

suite.add('layout-deep-10', () => {
  globalLayoutEngine.calculateLayout(deepTree, makeContext(viewport.width, viewport.height));
}, { iterations: 500, target: 0.3 });

// Wide tree (3 levels, 5 children each = 155 nodes)
function createWideTree(depth: number, childrenPerLevel: number): ReturnType<typeof createElement> {
  if (depth === 0) {
    return createElement('text', { text: 'L' });
  }
  return createElement('container', {
    style: { flexDirection: depth % 2 === 0 ? 'row' : 'column', gap: 1 },
  }, ...Array.from({ length: childrenPerLevel }, () =>
    createWideTree(depth - 1, childrenPerLevel)
  ));
}

const wideTree = createWideTree(3, 5);

suite.add('layout-wide-3x5', () => {
  globalLayoutEngine.calculateLayout(wideTree, makeContext(viewport.width, viewport.height));
}, { iterations: 500, target: 3.0 });

// Flex layout with mixed sizing
const flexContainer = createElement('container', {
  style: { flexDirection: 'row', height: '100%' },
},
  createElement('container', { style: { flex: 1, border: 'single' } },
    createElement('text', { text: 'Sidebar' })
  ),
  createElement('container', { style: { flex: 3, border: 'single' } },
    createElement('text', { text: 'Main Content' })
  ),
  createElement('container', { style: { width: 20, border: 'single' } },
    createElement('text', { text: 'Fixed' })
  )
);

suite.add('layout-flex-mixed', () => {
  globalLayoutEngine.calculateLayout(flexContainer, makeContext(viewport.width, viewport.height));
}, { iterations: 1000, target: 0.3 });

// Complex dashboard layout
const dashboardLayout = createElement('container', {
  style: { flexDirection: 'column', height: '100%', gap: 1 },
},
  // Header
  createElement('container', { style: { height: 3, border: 'single' } },
    createElement('text', { text: 'Header' })
  ),
  // Main area
  createElement('container', { style: { flex: 1, flexDirection: 'row', gap: 1 } },
    // Left sidebar
    createElement('container', { style: { width: 20, flexDirection: 'column', gap: 1 } },
      createElement('container', { style: { flex: 1, border: 'single' } },
        createElement('text', { text: 'Nav' })
      ),
      createElement('container', { style: { height: 10, border: 'single' } },
        createElement('text', { text: 'Info' })
      )
    ),
    // Content
    createElement('container', { style: { flex: 1, flexDirection: 'column', gap: 1 } },
      createElement('container', { style: { flex: 1, border: 'single' } },
        createElement('text', { text: 'Content' })
      ),
      createElement('container', { style: { height: 8, flexDirection: 'row', gap: 1 } },
        createElement('container', { style: { flex: 1, border: 'single' } },
          createElement('text', { text: 'Tab 1' })
        ),
        createElement('container', { style: { flex: 1, border: 'single' } },
          createElement('text', { text: 'Tab 2' })
        ),
        createElement('container', { style: { flex: 1, border: 'single' } },
          createElement('text', { text: 'Tab 3' })
        )
      )
    ),
    // Right sidebar
    createElement('container', { style: { width: 25, border: 'single' } },
      createElement('text', { text: 'Properties' })
    )
  ),
  // Footer
  createElement('container', { style: { height: 2, border: 'single' } },
    createElement('text', { text: 'Footer' })
  )
);

suite.add('layout-dashboard', () => {
  globalLayoutEngine.calculateLayout(dashboardLayout, makeContext(viewport.width, viewport.height));
}, { iterations: 500, target: 1.0 });

// Many small elements (grid-like)
const gridLikeLayout = createElement('container', {
  style: { flexDirection: 'column' },
}, ...Array.from({ length: 10 }, (_, row) =>
  createElement('container', {
    style: { flexDirection: 'row' },
  }, ...Array.from({ length: 10 }, (_, col) =>
    createElement('container', { style: { width: 10, height: 3, border: 'single' } },
      createElement('text', { text: `${row},${col}` })
    )
  ))
));

suite.add('layout-grid-10x10', () => {
  globalLayoutEngine.calculateLayout(gridLikeLayout, makeContext(viewport.width, viewport.height));
}, { iterations: 200, target: 5.0 });

// Run benchmarks
const results = await suite.run();

// Save results
const outputPath = new URL('../results/layout-' + benchmarkTimestamp() + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
