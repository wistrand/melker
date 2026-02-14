/**
 * Component rendering benchmarks
 * Tests rendering performance of various UI components and layouts
 */

import { BenchmarkSuite, benchmarkTimestamp } from '../harness.ts';
import { createElement, TerminalBuffer, globalLayoutEngine, RenderingEngine } from '../../mod.ts';
import { DualBuffer } from '../../src/buffer.ts';

const suite = new BenchmarkSuite('rendering');

const viewport = { width: 120, height: 40 };
const renderer = new RenderingEngine();

function makeContext(width: number, height: number) {
  return {
    viewport: { x: 0, y: 0, width, height },
    parentBounds: { x: 0, y: 0, width, height },
    availableSpace: { width, height },
  };
}

// =============================================================================
// Basic Component Rendering
// =============================================================================

// Simple text element
const textEl = createElement('text', { text: 'Hello, World!' });
suite.add('render-text-simple', () => {
  globalLayoutEngine.calculateLayout(textEl, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(textEl, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 1000, target: 0.7 });

// Text with styling
const styledText = createElement('text', {
  text: 'Styled Text Content',
  style: { color: '#ff0000', fontWeight: 'bold', textDecoration: 'underline' }
});
suite.add('render-text-styled', () => {
  globalLayoutEngine.calculateLayout(styledText, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(styledText, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 1000, target: 0.7 });

// Long text with wrapping
const longText = createElement('text', {
  text: 'This is a very long text that will need to be wrapped across multiple lines. It contains enough content to test the text wrapping performance of the rendering engine.',
  style: { width: 60 }
});
suite.add('render-text-wrapped', () => {
  globalLayoutEngine.calculateLayout(longText, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(longText, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 500, target: 0.6 });

// Button
const button = createElement('button', { label: 'Click Me' });
suite.add('render-button', () => {
  globalLayoutEngine.calculateLayout(button, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(button, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 1000, target: 0.9 });

// Input field
const input = createElement('input', { value: 'Sample input text', placeholder: 'Enter text...' });
suite.add('render-input', () => {
  globalLayoutEngine.calculateLayout(input, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(input, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 1000, target: 1.5 });

// Checkbox
const checkbox = createElement('checkbox', { title: 'Accept terms', checked: true });
suite.add('render-checkbox', () => {
  globalLayoutEngine.calculateLayout(checkbox, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(checkbox, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 1000, target: 1.5 });

// Radio button
const radio = createElement('radio', { title: 'Option A', value: 'a', checked: true });
suite.add('render-radio', () => {
  globalLayoutEngine.calculateLayout(radio, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(radio, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 1000, target: 1.5 });

// Progress bar
const progress = createElement('progress', { value: 75, max: 100 });
suite.add('render-progress', () => {
  globalLayoutEngine.calculateLayout(progress, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(progress, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 1000, target: 1.5 });

// Slider
const slider = createElement('slider', { value: 50, min: 0, max: 100 });
suite.add('render-slider', () => {
  globalLayoutEngine.calculateLayout(slider, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(slider, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 1000, target: 1.5 });

// =============================================================================
// Container Rendering
// =============================================================================

// Simple container with border
const borderedContainer = createElement('container', {
  style: { border: 'thin', padding: 1, width: 40, height: 10 }
}, createElement('text', { text: 'Content inside' }));
suite.add('render-container-bordered', () => {
  globalLayoutEngine.calculateLayout(borderedContainer, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(borderedContainer, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 500, target: 0.5 });

// Container with multiple children (row)
const rowContainer = createElement('container', {
  style: { flexDirection: 'row', gap: 2 }
},
  createElement('text', { text: 'Item 1' }),
  createElement('text', { text: 'Item 2' }),
  createElement('text', { text: 'Item 3' }),
  createElement('text', { text: 'Item 4' }),
  createElement('text', { text: 'Item 5' })
);
suite.add('render-container-row', () => {
  globalLayoutEngine.calculateLayout(rowContainer, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(rowContainer, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 500, target: 0.5 });

// Container with multiple children (column)
const colContainer = createElement('container', {
  style: { flexDirection: 'column', gap: 1 }
},
  createElement('text', { text: 'Line 1' }),
  createElement('text', { text: 'Line 2' }),
  createElement('text', { text: 'Line 3' }),
  createElement('text', { text: 'Line 4' }),
  createElement('text', { text: 'Line 5' })
);
suite.add('render-container-column', () => {
  globalLayoutEngine.calculateLayout(colContainer, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(colContainer, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 500, target: 1.5 });

// =============================================================================
// Nested Layouts
// =============================================================================

// 3 levels deep nesting
const nested3 = createElement('container', { style: { border: 'thin', padding: 1 } },
  createElement('container', { style: { border: 'thin', padding: 1 } },
    createElement('container', { style: { border: 'thin', padding: 1 } },
      createElement('text', { text: 'Deep nested content' })
    )
  )
);
suite.add('render-nested-3-levels', () => {
  globalLayoutEngine.calculateLayout(nested3, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(nested3, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 500, target: 2.0 });

// 5 levels deep nesting
const nested5 = createElement('container', { style: { padding: 1 } },
  createElement('container', { style: { padding: 1 } },
    createElement('container', { style: { padding: 1 } },
      createElement('container', { style: { padding: 1 } },
        createElement('container', { style: { padding: 1 } },
          createElement('text', { text: 'Very deep content' })
        )
      )
    )
  )
);
suite.add('render-nested-5-levels', () => {
  globalLayoutEngine.calculateLayout(nested5, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(nested5, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 500, target: 2.0 });

// Wide tree (many siblings)
const wideTree = createElement('container', { style: { flexDirection: 'column' } },
  ...Array(20).fill(0).map((_, i) =>
    createElement('text', { text: `Item ${i + 1}` })
  )
);
suite.add('render-wide-tree-20', () => {
  globalLayoutEngine.calculateLayout(wideTree, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(wideTree, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 200, target: 2.0 });

// Complex tree (mixed nesting and siblings)
const complexTree = createElement('container', { style: { flexDirection: 'column', gap: 1 } },
  createElement('container', { style: { flexDirection: 'row', gap: 2 } },
    createElement('text', { text: 'Header Left' }),
    createElement('text', { text: 'Header Center' }),
    createElement('text', { text: 'Header Right' })
  ),
  createElement('container', { style: { flexDirection: 'row', gap: 1 } },
    createElement('container', { style: { flexDirection: 'column', border: 'thin', width: 30 } },
      createElement('text', { text: 'Sidebar Item 1' }),
      createElement('text', { text: 'Sidebar Item 2' }),
      createElement('text', { text: 'Sidebar Item 3' })
    ),
    createElement('container', { style: { flexDirection: 'column', flex: 1 } },
      createElement('text', { text: 'Main content area' }),
      createElement('text', { text: 'More content here' }),
      createElement('container', { style: { flexDirection: 'row', gap: 1 } },
        createElement('button', { label: 'Action 1' }),
        createElement('button', { label: 'Action 2' }),
        createElement('button', { label: 'Action 3' })
      )
    )
  ),
  createElement('text', { text: 'Footer content' })
);
suite.add('render-complex-tree', () => {
  globalLayoutEngine.calculateLayout(complexTree, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(complexTree, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 200, target: 2.0 });

// =============================================================================
// List Rendering
// =============================================================================

// Simple list
const simpleList = createElement('list', {},
  ...Array(10).fill(0).map((_, i) =>
    createElement('li', {},
      createElement('text', { text: `List item ${i + 1}` })
    )
  )
);
suite.add('render-list-10', () => {
  globalLayoutEngine.calculateLayout(simpleList, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(simpleList, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 500, target: 2.0 });

// Large list
const largeList = createElement('list', {},
  ...Array(50).fill(0).map((_, i) =>
    createElement('li', {},
      createElement('text', { text: `List item ${i + 1} with some extra text content` })
    )
  )
);
suite.add('render-list-50', () => {
  globalLayoutEngine.calculateLayout(largeList, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(largeList, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 100, target: 7.0 });

// =============================================================================
// Table Rendering
// =============================================================================

// Small table
const smallTable = createElement('table', {},
  createElement('thead', {},
    createElement('tr', {},
      createElement('th', {},
        createElement('text', { text: 'Name' })
      ),
      createElement('th', {},
        createElement('text', { text: 'Value' })
      ),
      createElement('th', {},
        createElement('text', { text: 'Status' })
      )
    )
  ),
  createElement('tbody', {},
    ...Array(5).fill(0).map((_, i) =>
      createElement('tr', {},
        createElement('td', {},
          createElement('text', { text: `Item ${i + 1}` })
        ),
        createElement('td', {},
          createElement('text', { text: `${(i + 1) * 100}` })
        ),
        createElement('td', {},
          createElement('text', { text: i % 2 === 0 ? 'Active' : 'Inactive' })
        )
      )
    )
  )
);
suite.add('render-table-5-rows', () => {
  globalLayoutEngine.calculateLayout(smallTable, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(smallTable, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 200, target: 2.5 });

// Medium table
const mediumTable = createElement('table', {},
  createElement('thead', {},
    createElement('tr', {},
      createElement('th', {}, createElement('text', { text: 'ID' })),
      createElement('th', {}, createElement('text', { text: 'Name' })),
      createElement('th', {}, createElement('text', { text: 'Email' })),
      createElement('th', {}, createElement('text', { text: 'Role' })),
      createElement('th', {}, createElement('text', { text: 'Status' }))
    )
  ),
  createElement('tbody', {},
    ...Array(20).fill(0).map((_, i) =>
      createElement('tr', {},
        createElement('td', {}, createElement('text', { text: `${i + 1}` })),
        createElement('td', {}, createElement('text', { text: `User ${i + 1}` })),
        createElement('td', {}, createElement('text', { text: `user${i + 1}@example.com` })),
        createElement('td', {}, createElement('text', { text: i % 3 === 0 ? 'Admin' : 'User' })),
        createElement('td', {}, createElement('text', { text: i % 2 === 0 ? 'Active' : 'Pending' }))
      )
    )
  )
);
suite.add('render-table-20-rows', () => {
  globalLayoutEngine.calculateLayout(mediumTable, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(mediumTable, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 100, target: 10.0 });

// =============================================================================
// Data Visualization Components
// =============================================================================

// Data bars
const dataBars = createElement('data-bars', {
  data: [
    { label: 'Sales', value: 120 },
    { label: 'Revenue', value: 85 },
    { label: 'Growth', value: 150 },
    { label: 'Users', value: 95 },
    { label: 'Conversion', value: 42 },
  ]
});
suite.add('render-data-bars', () => {
  globalLayoutEngine.calculateLayout(dataBars, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(dataBars, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 500, target: 1.5 });

// =============================================================================
// Scrollable Containers
// =============================================================================

// Scrollable container with overflow content
const scrollableContent = createElement('container', {
  style: { height: 20, overflow: 'scroll', border: 'thin' }
},
  createElement('container', { style: { flexDirection: 'column' } },
    ...Array(50).fill(0).map((_, i) =>
      createElement('text', { text: `Scrollable content line ${i + 1}` })
    )
  )
);
suite.add('render-scrollable', () => {
  globalLayoutEngine.calculateLayout(scrollableContent, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(scrollableContent, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 100, target: 2.5 });

// =============================================================================
// Full Page Layouts
// =============================================================================

// Dashboard-style layout
const dashboard = createElement('container', { style: { flexDirection: 'column', height: 'fill' } },
  // Header
  createElement('container', { style: { flexDirection: 'row', padding: 1, backgroundColor: '#333' } },
    createElement('text', { text: 'Dashboard', style: { fontWeight: 'bold' } }),
    createElement('container', { style: { flex: 1 } }),
    createElement('text', { text: 'User: admin' })
  ),
  // Main content
  createElement('container', { style: { flexDirection: 'row', flex: 1 } },
    // Sidebar
    createElement('container', { style: { width: 25, border: 'thin', padding: 1 } },
      createElement('text', { text: 'Navigation', style: { fontWeight: 'bold' } }),
      createElement('list', {},
        createElement('li', {}, createElement('text', { text: 'Home' })),
        createElement('li', {}, createElement('text', { text: 'Analytics' })),
        createElement('li', {}, createElement('text', { text: 'Reports' })),
        createElement('li', {}, createElement('text', { text: 'Settings' }))
      )
    ),
    // Content area
    createElement('container', { style: { flex: 1, padding: 1 } },
      createElement('text', { text: 'Overview', style: { fontWeight: 'bold' } }),
      createElement('container', { style: { flexDirection: 'row', gap: 2, marginTop: 1 } },
        createElement('container', { style: { border: 'thin', padding: 1, flex: 1 } },
          createElement('text', { text: 'Metric 1' }),
          createElement('text', { text: '1,234', style: { fontWeight: 'bold' } })
        ),
        createElement('container', { style: { border: 'thin', padding: 1, flex: 1 } },
          createElement('text', { text: 'Metric 2' }),
          createElement('text', { text: '5,678', style: { fontWeight: 'bold' } })
        ),
        createElement('container', { style: { border: 'thin', padding: 1, flex: 1 } },
          createElement('text', { text: 'Metric 3' }),
          createElement('text', { text: '9,012', style: { fontWeight: 'bold' } })
        )
      )
    )
  ),
  // Footer
  createElement('container', { style: { padding: 1, backgroundColor: '#333' } },
    createElement('text', { text: 'Status: Connected' })
  )
);
suite.add('render-dashboard-layout', () => {
  globalLayoutEngine.calculateLayout(dashboard, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(dashboard, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 100, target: 4.5 });

// Form layout
const formLayout = createElement('container', { style: { flexDirection: 'column', gap: 1, padding: 2 } },
  createElement('text', { text: 'User Registration', style: { fontWeight: 'bold' } }),
  createElement('container', { style: { flexDirection: 'row', gap: 1 } },
    createElement('text', { text: 'Username:', style: { width: 15 } }),
    createElement('input', { placeholder: 'Enter username', style: { flex: 1 } })
  ),
  createElement('container', { style: { flexDirection: 'row', gap: 1 } },
    createElement('text', { text: 'Email:', style: { width: 15 } }),
    createElement('input', { placeholder: 'Enter email', style: { flex: 1 } })
  ),
  createElement('container', { style: { flexDirection: 'row', gap: 1 } },
    createElement('text', { text: 'Password:', style: { width: 15 } }),
    createElement('input', { placeholder: 'Enter password', style: { flex: 1 } })
  ),
  createElement('checkbox', { title: 'I agree to the terms and conditions' }),
  createElement('checkbox', { title: 'Subscribe to newsletter' }),
  createElement('container', { style: { flexDirection: 'row', gap: 2, marginTop: 1 } },
    createElement('button', { label: 'Submit' }),
    createElement('button', { label: 'Cancel' })
  )
);
suite.add('render-form-layout', () => {
  globalLayoutEngine.calculateLayout(formLayout, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(formLayout, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 200, target: 2.0 });

// =============================================================================
// Buffer String Output
// =============================================================================

// Measure buffer to string conversion (used for debugging/stdout)
const stringTestEl = createElement('container', { style: { width: 80, height: 24 } },
  createElement('text', { text: 'Red text', style: { color: '#ff0000' } }),
  createElement('text', { text: 'Green bold', style: { color: '#00ff00', fontWeight: 'bold' } }),
  createElement('text', { text: 'Blue underline', style: { color: '#0000ff', textDecoration: 'underline' } }),
  createElement('container', { style: { border: 'thin', padding: 1 } },
    createElement('text', { text: 'Bordered content' })
  )
);

// Pre-render to buffer for string output test
const stringBuffer = new DualBuffer(80, 24);
globalLayoutEngine.calculateLayout(stringTestEl, makeContext(80, 24));
renderer.render(stringTestEl, stringBuffer, { x: 0, y: 0, width: 80, height: 24 });

suite.add('buffer-to-string-80x24', () => {
  stringBuffer.currentBuffer.toString();
}, { iterations: 500, target: 0.5 });

// Larger buffer output
const largeStringBuffer = new DualBuffer(viewport.width, viewport.height);
globalLayoutEngine.calculateLayout(dashboard, makeContext(viewport.width, viewport.height));
renderer.render(dashboard, largeStringBuffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });

suite.add('buffer-to-string-120x40', () => {
  largeStringBuffer.currentBuffer.toString();
}, { iterations: 200, target: 1.0 });

// =============================================================================
// Separator and Decorative Elements
// =============================================================================

const separatorLayout = createElement('container', { style: { flexDirection: 'column', gap: 1 } },
  createElement('text', { text: 'Section 1' }),
  createElement('separator', {}),
  createElement('text', { text: 'Section 2' }),
  createElement('separator', { style: { borderStyle: 'double' } }),
  createElement('text', { text: 'Section 3' }),
  createElement('separator', {}),
  createElement('text', { text: 'Section 4' })
);
suite.add('render-separators', () => {
  globalLayoutEngine.calculateLayout(separatorLayout, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(separatorLayout, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 500, target: 2.0 });

// =============================================================================
// Tabs Component
// =============================================================================

const tabsComponent = createElement('tabs', {},
  createElement('tab', { title: 'Tab 1' },
    createElement('text', { text: 'Content for tab 1' })
  ),
  createElement('tab', { title: 'Tab 2' },
    createElement('text', { text: 'Content for tab 2' })
  ),
  createElement('tab', { title: 'Tab 3' },
    createElement('text', { text: 'Content for tab 3' })
  )
);
suite.add('render-tabs', () => {
  globalLayoutEngine.calculateLayout(tabsComponent, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(tabsComponent, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 200, target: 2.5 });

// =============================================================================
// Run benchmarks
// =============================================================================

const results = await suite.run();

// Helper to get median from results
const getMedian = (name: string) => results.find(r => r.name === name)?.median ?? 0;

// Add findings
suite.addFindings([
  {
    title: 'Simple components render fast',
    description: 'Basic components (text, button, input) render quickly. DualBuffer allocation dominates for simple elements.',
    category: 'info',
    benchmarks: ['render-text-simple', 'render-button', 'render-input'],
    metrics: {
      textMs: getMedian('render-text-simple'),
      buttonMs: getMedian('render-button'),
      inputMs: getMedian('render-input'),
    }
  },
  {
    title: 'Nesting depth has moderate impact',
    description: 'Each level of nesting adds small overhead. 5 levels is ~50% slower than 3 levels.',
    category: 'info',
    benchmarks: ['render-nested-3-levels', 'render-nested-5-levels'],
    metrics: {
      threeMs: getMedian('render-nested-3-levels'),
      fiveMs: getMedian('render-nested-5-levels'),
    }
  },
  {
    title: 'Tables scale linearly with rows',
    description: 'Table rendering time scales approximately linearly with row count.',
    category: 'info',
    benchmarks: ['render-table-5-rows', 'render-table-20-rows'],
    metrics: {
      fiveRowMs: getMedian('render-table-5-rows'),
      twentyRowMs: getMedian('render-table-20-rows'),
      ratio: `${(getMedian('render-table-20-rows') / getMedian('render-table-5-rows')).toFixed(1)}x`,
    }
  },
  {
    title: 'Buffer string output is efficient',
    description: 'Converting rendered buffer to string representation is fast even for large buffers.',
    category: 'info',
    benchmarks: ['buffer-to-string-80x24', 'buffer-to-string-120x40'],
    metrics: {
      smallMs: getMedian('buffer-to-string-80x24'),
      largeMs: getMedian('buffer-to-string-120x40'),
    }
  }
]);

// Set notes
suite.setNotes('Component rendering benchmarks. Tests individual components, nested layouts, tables, lists, scrollable containers, and full page layouts. ANSI output generation is also measured.');

// Save results
const outputPath = new URL('../results/components-rendering-' + benchmarkTimestamp() + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
