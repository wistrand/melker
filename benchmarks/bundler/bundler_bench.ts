/**
 * Bundler benchmarks - code generation and template processing
 */

import { BenchmarkSuite, benchmarkTimestamp } from '../harness.ts';
import { generate, rewriteHandlers } from '../../src/bundler/generator.ts';
import { parseMelkerFile } from '../../src/template.ts';
import type { ParseResult, ParsedScript, ParsedHandler } from '../../src/bundler/types.ts';

const suite = new BenchmarkSuite('bundler');

// =============================================================================
// Helper functions
// =============================================================================

function createScript(overrides: Partial<ParsedScript> = {}): ParsedScript {
  return {
    id: 'script_0',
    type: 'sync',
    code: '',
    isAsync: false,
    sourceRange: {
      start: { line: 1, column: 0, offset: 0 },
      end: { line: 1, column: 0, offset: 0 },
    },
    ...overrides,
  };
}

function createHandler(id: string, code: string, line: number): ParsedHandler {
  return {
    id,
    attributeName: 'onClick',
    code,
    isAsync: false,
    params: [{ name: 'event', type: 'any' }],
    attributeRange: {
      start: { line, column: 0, offset: line * 50 },
      end: { line, column: code.length + 10, offset: line * 50 + code.length + 10 },
    },
    codeRange: {
      start: { line, column: 9, offset: line * 50 + 9 },
      end: { line, column: code.length + 9, offset: line * 50 + code.length + 9 },
    },
    element: { tag: 'button', id: `btn${id}`, line },
  };
}

function createParseResult(overrides: Partial<ParseResult> = {}): ParseResult {
  return {
    template: '<container></container>',
    scripts: [],
    handlers: [],
    originalContent: '',
    resolvedContent: '',
    sourceUrl: 'file:///test/app.melker',
    ...overrides,
  };
}

// =============================================================================
// Test data generation
// =============================================================================

// Simple script (few lines)
const simpleScript = createScript({
  id: 'script_0',
  code: `
let count = 0;

export function increment() {
  count++;
  updateDisplay();
}

export function decrement() {
  count--;
  updateDisplay();
}

function updateDisplay() {
  $melker.getElementById('counter').props.text = String(count);
}
`,
});

// Medium script (~50 lines)
const mediumScript = createScript({
  id: 'script_0',
  code: `
// Data storage
let items = [];
let selectedIndex = 0;
let filter = '';

// Add item
export function addItem(name) {
  items.push({ id: Date.now(), name, completed: false });
  updateList();
}

// Remove item
export function removeItem(id) {
  items = items.filter(item => item.id !== id);
  updateList();
}

// Toggle item
export function toggleItem(id) {
  const item = items.find(item => item.id === id);
  if (item) {
    item.completed = !item.completed;
    updateList();
  }
}

// Filter items
export function setFilter(f) {
  filter = f;
  updateList();
}

// Update list display
function updateList() {
  const filtered = filter
    ? items.filter(item => item.name.includes(filter))
    : items;

  const rows = filtered.map(item => [
    item.completed ? '[x]' : '[ ]',
    item.name,
    item.id,
  ]);

  $melker.getElementById('itemList').props.rows = rows;
  $melker.getElementById('countLabel').props.text = \`\${filtered.length} items\`;
}

// Navigation
export function selectNext() {
  if (selectedIndex < items.length - 1) {
    selectedIndex++;
    highlightSelected();
  }
}

export function selectPrev() {
  if (selectedIndex > 0) {
    selectedIndex--;
    highlightSelected();
  }
}

function highlightSelected() {
  const list = $melker.getElementById('itemList');
  list.props.selectedRow = selectedIndex;
}
`,
});

// Large script (~100+ lines with multiple exports)
const largeScript = createScript({
  id: 'script_0',
  code: `
// Configuration
const CONFIG = {
  maxItems: 1000,
  pageSize: 20,
  debounceMs: 100,
};

// State management
let state = {
  items: [],
  page: 0,
  filter: '',
  sortBy: 'name',
  sortDir: 'asc',
  selected: new Set(),
  loading: false,
  error: null,
};

// Selectors
function getFilteredItems() {
  let items = state.items;
  if (state.filter) {
    const f = state.filter.toLowerCase();
    items = items.filter(item =>
      item.name.toLowerCase().includes(f) ||
      item.description.toLowerCase().includes(f)
    );
  }
  return items;
}

function getSortedItems() {
  const items = getFilteredItems();
  return items.sort((a, b) => {
    const aVal = a[state.sortBy];
    const bVal = b[state.sortBy];
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return state.sortDir === 'asc' ? cmp : -cmp;
  });
}

function getPagedItems() {
  const items = getSortedItems();
  const start = state.page * CONFIG.pageSize;
  return items.slice(start, start + CONFIG.pageSize);
}

// Actions
export async function loadItems() {
  state.loading = true;
  updateUI();

  try {
    const response = await fetch('/api/items');
    const data = await response.json();
    state.items = data.items;
    state.error = null;
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
    updateUI();
  }
}

export function setFilter(filter) {
  state.filter = filter;
  state.page = 0;
  updateUI();
}

export function setSort(field) {
  if (state.sortBy === field) {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortBy = field;
    state.sortDir = 'asc';
  }
  updateUI();
}

export function nextPage() {
  const maxPage = Math.ceil(getFilteredItems().length / CONFIG.pageSize) - 1;
  if (state.page < maxPage) {
    state.page++;
    updateUI();
  }
}

export function prevPage() {
  if (state.page > 0) {
    state.page--;
    updateUI();
  }
}

export function toggleSelect(id) {
  if (state.selected.has(id)) {
    state.selected.delete(id);
  } else {
    state.selected.add(id);
  }
  updateUI();
}

export function selectAll() {
  for (const item of getPagedItems()) {
    state.selected.add(item.id);
  }
  updateUI();
}

export function deselectAll() {
  state.selected.clear();
  updateUI();
}

export async function deleteSelected() {
  if (state.selected.size === 0) return;

  const confirmed = await $melker.confirm(
    \`Delete \${state.selected.size} items?\`
  );

  if (confirmed) {
    state.loading = true;
    updateUI();

    try {
      await fetch('/api/items/bulk-delete', {
        method: 'POST',
        body: JSON.stringify([...state.selected]),
      });
      state.items = state.items.filter(item => !state.selected.has(item.id));
      state.selected.clear();
      state.error = null;
    } catch (err) {
      state.error = err.message;
    } finally {
      state.loading = false;
      updateUI();
    }
  }
}

// UI update
function updateUI() {
  const items = getPagedItems();
  const total = getFilteredItems().length;
  const totalPages = Math.ceil(total / CONFIG.pageSize);

  $melker.getElementById('table').props.rows = items.map(item => [
    state.selected.has(item.id) ? '[x]' : '[ ]',
    item.name,
    item.description,
    item.createdAt,
  ]);

  $melker.getElementById('pageInfo').props.text =
    \`Page \${state.page + 1} of \${totalPages} (\${total} items)\`;

  $melker.getElementById('selectedInfo').props.text =
    \`\${state.selected.size} selected\`;

  $melker.getElementById('loading').props.visible = state.loading;

  if (state.error) {
    $melker.getElementById('error').props.text = state.error;
    $melker.getElementById('error').props.visible = true;
  } else {
    $melker.getElementById('error').props.visible = false;
  }
}
`,
});

// =============================================================================
// Generate benchmarks
// =============================================================================

// Simple: 1 script, no handlers
suite.add('generate-simple', () => {
  const parsed = createParseResult({
    scripts: [simpleScript],
    handlers: [],
    template: '<container><text id="counter">0</text></container>',
  });
  generate(parsed);
}, { iterations: 1000, target: 0.1 });

// Medium: 1 script, 5 handlers
const mediumHandlers = Array.from({ length: 5 }, (_, i) =>
  createHandler(`__h${i}`, `$app.handler${i}(event)`, i + 10)
);

suite.add('generate-medium', () => {
  const parsed = createParseResult({
    scripts: [mediumScript],
    handlers: mediumHandlers,
    template: '<container><button onClick="handler"></button></container>',
  });
  generate(parsed);
}, { iterations: 500, target: 0.1 });

// Large: 1 script, 20 handlers
const largeHandlers = Array.from({ length: 20 }, (_, i) =>
  createHandler(`__h${i}`, `$app.handler${i}(event); updateUI();`, i + 10)
);

suite.add('generate-large', () => {
  const parsed = createParseResult({
    scripts: [largeScript],
    handlers: largeHandlers,
    template: '<container></container>',
  });
  generate(parsed);
}, { iterations: 200, target: 0.2 });

// Multi-script: 3 scripts (sync, init, ready)
const initScript = createScript({
  id: 'script_1',
  type: 'init',
  code: `
await loadConfig();
await initializeDatabase();
console.log('Init complete');
`,
  isAsync: true,
});

const readyScript = createScript({
  id: 'script_2',
  type: 'ready',
  code: `
await loadItems();
$melker.getElementById('status').props.text = 'Ready';
`,
  isAsync: true,
});

suite.add('generate-multi-script', () => {
  const parsed = createParseResult({
    scripts: [simpleScript, initScript, readyScript],
    handlers: mediumHandlers,
    template: '<container></container>',
  });
  generate(parsed);
}, { iterations: 500, target: 0.1 });

// =============================================================================
// Handler rewriting benchmarks
// =============================================================================

// Small template with few handlers
const smallTemplate = `<container>
  <button id="btn1" onClick="count++">Click</button>
  <button id="btn2" onClick="$app.reset()">Reset</button>
  <text>Hello</text>
</container>`;

const smallHandlers: ParsedHandler[] = [
  createHandler('__h0', 'count++', 2),
  createHandler('__h1', '$app.reset()', 3),
];
// Fix offsets for actual template positions
smallHandlers[0].attributeRange = {
  start: { line: 2, column: 21, offset: smallTemplate.indexOf('onClick="count++"') },
  end: { line: 2, column: 38, offset: smallTemplate.indexOf('onClick="count++"') + 17 },
};
smallHandlers[1].attributeRange = {
  start: { line: 3, column: 21, offset: smallTemplate.indexOf('onClick="$app.reset()"') },
  end: { line: 3, column: 43, offset: smallTemplate.indexOf('onClick="$app.reset()"') + 22 },
};

suite.add('rewrite-handlers-2', () => {
  rewriteHandlers(smallTemplate, smallHandlers);
}, { iterations: 2000, target: 0.01 });

// Medium template with 10 handlers
const mediumTemplate = Array.from({ length: 10 }, (_, i) =>
  `<button id="btn${i}" onClick="handler${i}(event)">Button ${i}</button>`
).join('\n');

const mediumRewriteHandlers: ParsedHandler[] = Array.from({ length: 10 }, (_, i) => {
  const offset = mediumTemplate.indexOf(`onClick="handler${i}(event)"`);
  return {
    ...createHandler(`__h${i}`, `handler${i}(event)`, i + 1),
    attributeRange: {
      start: { line: i + 1, column: 20, offset },
      end: { line: i + 1, column: 45, offset: offset + 25 },
    },
  };
});

suite.add('rewrite-handlers-10', () => {
  rewriteHandlers(mediumTemplate, mediumRewriteHandlers);
}, { iterations: 1000, target: 0.02 });

// =============================================================================
// Template parsing benchmarks
// =============================================================================

// Simple .melker file
const simpleMelker = `<melker>
  <script>
    let count = 0;
    export function increment() { count++; }
  </script>
  <container>
    <text>Count: 0</text>
    <button onClick="$app.increment()">+</button>
  </container>
</melker>`;

suite.add('parse-simple', () => {
  parseMelkerFile(simpleMelker);
}, { iterations: 500, target: 0.1 });

// Medium .melker file (~50 elements)
const mediumMelker = `<melker>
  <title>Dashboard</title>
  <style>
    .header { font-weight: bold; }
    .content { padding: 1; }
  </style>
  <script>
    let data = [];
    export function refresh() { loadData(); }
    export function filter(text) { applyFilter(text); }
    async function loadData() {
      const response = await fetch('/api/data');
      data = await response.json();
    }
    function applyFilter(text) {
      // filter logic
    }
  </script>
  <container style="flex-direction: column; height: 100%;">
    <container style="flex-direction: row; height: 3; border: single;">
      <text class="header">Dashboard</text>
      <container style="flex: 1;" />
      <button onClick="$app.refresh()">Refresh</button>
    </container>
    <container style="flex: 1; flex-direction: row;">
      <container style="width: 20; border: single;">
        ${Array.from({ length: 10 }, (_, i) =>
          `<button onClick="selectItem(${i})">Item ${i}</button>`
        ).join('\n        ')}
      </container>
      <container style="flex: 1; padding: 1;">
        <text>Content Area</text>
        ${Array.from({ length: 5 }, (_, i) =>
          `<text id="line${i}">Line ${i}</text>`
        ).join('\n        ')}
      </container>
    </container>
    <container style="height: 2; border: single;">
      <text>Status: Ready</text>
    </container>
  </container>
</melker>`;

suite.add('parse-medium', () => {
  parseMelkerFile(mediumMelker);
}, { iterations: 200, target: 0.5 });

// Large .melker file (~100+ elements with many handlers)
const largeMelker = `<melker>
  <title>Complex App</title>
  <policy>{"permissions": {"read": ["."]}}</policy>
  <style>
    container { padding: 1; }
    button { border: single; }
    .selected { background-color: blue; }
    .error { color: red; }
    .success { color: green; }
    #header { font-weight: bold; }
    #footer { color: gray; }
  </style>
  <script>
    // State management
    let state = { items: [], page: 0, filter: '', selected: null };

    // Actions
    export function setFilter(f) { state.filter = f; update(); }
    export function nextPage() { state.page++; update(); }
    export function prevPage() { state.page--; update(); }
    export function select(id) { state.selected = id; update(); }
    export function deselect() { state.selected = null; update(); }

    // Async actions
    export async function loadItems() {
      const resp = await fetch('/api/items');
      state.items = await resp.json();
      update();
    }

    export async function saveItem(item) {
      await fetch('/api/items', { method: 'POST', body: JSON.stringify(item) });
      await loadItems();
    }

    export async function deleteItem(id) {
      if (await $melker.confirm('Delete item?')) {
        await fetch('/api/items/' + id, { method: 'DELETE' });
        await loadItems();
      }
    }

    function update() {
      // Update UI
      const list = $melker.getElementById('itemList');
      list.props.rows = state.items.map(i => [i.name, i.status]);
    }
  </script>
  <script type="typescript" async="init">
    await $app.loadItems();
  </script>
  <container style="flex-direction: column; height: 100%;">
    <container id="header" style="height: 3; flex-direction: row; gap: 1;">
      <text style="font-weight: bold;">Complex App</text>
      <input id="filterInput" placeholder="Filter..." onChange="$app.setFilter(event.value)" />
      <button onClick="$app.loadItems()">Refresh</button>
      <button onClick="$app.deselect()">Clear</button>
    </container>
    <container style="flex: 1; flex-direction: row; gap: 1;">
      <container style="width: 30; flex-direction: column; gap: 1; border: single;">
        <text style="font-weight: bold;">Navigation</text>
        ${Array.from({ length: 20 }, (_, i) =>
          `<button onClick="$app.select(${i})">Nav Item ${i}</button>`
        ).join('\n        ')}
      </container>
      <container style="flex: 1; flex-direction: column; gap: 1;">
        <container style="flex: 1; border: single;">
          <data-table id="itemList" style="height: 100%;">
          {
            "columns": [
              {"header": "Name", "width": 30},
              {"header": "Status", "width": 15}
            ],
            "rows": []
          }
          </data-table>
        </container>
        <container style="height: 5; flex-direction: row; gap: 1;">
          <button onClick="$app.prevPage()">Previous</button>
          <text id="pageInfo">Page 1</text>
          <button onClick="$app.nextPage()">Next</button>
        </container>
      </container>
      <container style="width: 25; flex-direction: column; border: single;">
        <text style="font-weight: bold;">Details</text>
        ${Array.from({ length: 10 }, (_, i) =>
          `<text id="detail${i}">Detail ${i}: -</text>`
        ).join('\n        ')}
        <container style="flex: 1;" />
        <button onClick="$app.saveItem({})">Save</button>
        <button onClick="$app.deleteItem(state.selected)">Delete</button>
      </container>
    </container>
    <container id="footer" style="height: 2; flex-direction: row;">
      <text id="status">Ready</text>
      <container style="flex: 1;" />
      <text id="selectedInfo">Nothing selected</text>
    </container>
  </container>
</melker>`;

suite.add('parse-large', () => {
  parseMelkerFile(largeMelker);
}, { iterations: 100, target: 1.0 });

// =============================================================================
// Additional .melker format parsing tests
// =============================================================================

// Minimal file - just template, no scripts
const minimalMelker = `<melker>
  <container>
    <text>Hello World</text>
  </container>
</melker>`;

suite.add('parse-minimal', () => {
  parseMelkerFile(minimalMelker);
}, { iterations: 500, target: 0.05 });

// File with policy
const policyMelker = `<melker>
  <policy>
  {
    "name": "Test App",
    "description": "App with policy",
    "permissions": {
      "read": ["."],
      "net": ["api.example.com"],
      "env": ["HOME", "PATH"]
    }
  }
  </policy>
  <container>
    <text>App with Policy</text>
  </container>
</melker>`;

suite.add('parse-with-policy', () => {
  parseMelkerFile(policyMelker);
}, { iterations: 200, target: 0.1 });

// File with stylesheet
const stylesheetMelker = `<melker>
  <style>
    #header { font-weight: bold; background-color: blue; }
    .item { padding: 1; margin: 1; }
    .item:hover { background-color: gray; }
    #footer { border: single; }
    button { border: none; }
    text.title { font-size: large; }
    container.sidebar { width: 30; }
    #main > container { flex: 1; }
  </style>
  <container id="header">
    <text class="title">Styled App</text>
  </container>
  <container id="main">
    <container class="sidebar">
      <text class="item">Item 1</text>
      <text class="item">Item 2</text>
    </container>
  </container>
  <container id="footer">
    <text>Footer</text>
  </container>
</melker>`;

suite.add('parse-with-stylesheet', () => {
  parseMelkerFile(stylesheetMelker);
}, { iterations: 200, target: 0.3 });

// File with inline JSON data (data components)
const inlineJsonMelker = `<melker>
  <container style="gap: 1;">
    <data-table id="users" style="height: 20;">
    {
      "columns": [
        {"header": "ID", "width": 5, "align": "right"},
        {"header": "Name", "width": 20},
        {"header": "Email", "width": 30},
        {"header": "Status", "width": 10}
      ],
      "rows": [
        [1, "Alice", "alice@example.com", "Active"],
        [2, "Bob", "bob@example.com", "Away"],
        [3, "Carol", "carol@example.com", "Active"],
        [4, "Dave", "dave@example.com", "Offline"],
        [5, "Eve", "eve@example.com", "Active"]
      ]
    }
    </data-table>
    <data-heatmap
      grid='[[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]'
      rowLabels='["A", "B", "C"]'
      colLabels='["1", "2", "3", "4"]'
      showValues="true"
    />
    <data-bars>
    {
      "series": [{"name": "Sales"}, {"name": "Costs"}],
      "labels": ["Q1", "Q2", "Q3", "Q4"],
      "bars": [[100, 50], [150, 70], [120, 60], [180, 90]]
    }
    </data-bars>
  </container>
</melker>`;

suite.add('parse-inline-json', () => {
  parseMelkerFile(inlineJsonMelker);
}, { iterations: 200, target: 0.15 });

// Deeply nested elements (10 levels)
const deeplyNestedMelker = `<melker>
  <container id="l1">
    <container id="l2">
      <container id="l3">
        <container id="l4">
          <container id="l5">
            <container id="l6">
              <container id="l7">
                <container id="l8">
                  <container id="l9">
                    <container id="l10">
                      <text>Deeply nested content</text>
                    </container>
                  </container>
                </container>
              </container>
            </container>
          </container>
        </container>
      </container>
    </container>
  </container>
</melker>`;

suite.add('parse-deeply-nested', () => {
  parseMelkerFile(deeplyNestedMelker);
}, { iterations: 300, target: 0.15 });

// Many handlers (20 buttons with onClick)
const manyHandlersMelker = `<melker>
  <script>
    export function handleClick(n) { console.log('clicked ' + n); }
  </script>
  <container style="flex-direction: column;">
    ${Array.from({ length: 20 }, (_, i) =>
      `<button onClick="$app.handleClick(${i})">Button ${i}</button>`
    ).join('\n    ')}
  </container>
</melker>`;

suite.add('parse-many-handlers', () => {
  parseMelkerFile(manyHandlersMelker);
}, { iterations: 200, target: 0.3 });

// Multiple scripts (sync, init, ready)
const multiScriptMelker = `<melker>
  <script type="typescript">
    // Main script
    let state = { count: 0, items: [] };

    export function increment() { state.count++; update(); }
    export function decrement() { state.count--; update(); }
    export function addItem(name) { state.items.push(name); update(); }

    function update() {
      $melker.getElementById('counter').props.text = String(state.count);
    }
  </script>
  <script type="typescript" async="init">
    // Init script - runs once
    console.log('Initializing...');
    state.items = ['Item 1', 'Item 2'];
  </script>
  <script type="typescript" async="ready">
    // Ready script - runs after layout
    $melker.getElementById('status').props.text = 'Ready!';
  </script>
  <container>
    <text id="counter">0</text>
    <text id="status">Loading...</text>
    <button onClick="$app.increment()">+</button>
    <button onClick="$app.decrement()">-</button>
  </container>
</melker>`;

suite.add('parse-multi-script', () => {
  parseMelkerFile(multiScriptMelker);
}, { iterations: 200, target: 0.15 });

// Wide layout (many siblings)
const wideLayoutMelker = `<melker>
  <container style="flex-direction: row; flex-wrap: wrap; gap: 1;">
    ${Array.from({ length: 50 }, (_, i) =>
      `<container style="width: 10; height: 5; border: single;">
        <text>Card ${i}</text>
      </container>`
    ).join('\n    ')}
  </container>
</melker>`;

suite.add('parse-wide-layout', () => {
  parseMelkerFile(wideLayoutMelker);
}, { iterations: 100, target: 1.5 });

// Complex attributes (many style properties)
const complexAttrsMelker = `<melker>
  <container
    id="main"
    style="
      display: flex;
      flex-direction: column;
      width: fill;
      height: fill;
      padding: 2;
      margin: 1;
      gap: 1;
      border: double;
      background-color: #1a1a2e;
      color: #eee;
    "
  >
    <text
      id="title"
      style="
        font-weight: bold;
        font-size: large;
        text-align: center;
        padding: 1;
        margin-bottom: 2;
      "
    >
      Complex Styled App
    </text>
    <container
      style="
        flex: 1;
        flex-direction: row;
        gap: 2;
        overflow: auto;
      "
    >
      <container
        style="
          width: 30;
          border: single;
          padding: 1;
          flex-direction: column;
          gap: 1;
        "
      >
        ${Array.from({ length: 10 }, (_, i) =>
          `<button style="height: 3; border: thin; text-align: center;">Nav ${i}</button>`
        ).join('\n        ')}
      </container>
      <container style="flex: 1; border: single; padding: 1;">
        <text>Main content area</text>
      </container>
    </container>
  </container>
</melker>`;

suite.add('parse-complex-attrs', () => {
  parseMelkerFile(complexAttrsMelker);
}, { iterations: 100, target: 0.5 });

// Tabs component with nested content
const tabsMelker = `<melker>
  <tabs style="flex: 1;">
    <tab title="Overview">
      <container style="padding: 1; gap: 1;">
        <text style="font-weight: bold;">Overview Tab</text>
        <text>This is the overview content with some details.</text>
        <container style="flex-direction: row; gap: 1;">
          <text>Status:</text>
          <text style="color: green;">Active</text>
        </container>
      </container>
    </tab>
    <tab title="Details">
      <container style="padding: 1;">
        <data-table>
        {
          "columns": [
            {"header": "Property", "width": 20},
            {"header": "Value", "width": 30}
          ],
          "rows": [
            ["Name", "Test App"],
            ["Version", "1.0.0"],
            ["Author", "Developer"],
            ["License", "MIT"]
          ]
        }
        </data-table>
      </container>
    </tab>
    <tab title="Settings">
      <container style="padding: 1; gap: 1;">
        <container style="flex-direction: row; gap: 1; align-items: center;">
          <text style="width: 20;">Enable feature:</text>
          <checkbox id="feature1" />
        </container>
        <container style="flex-direction: row; gap: 1; align-items: center;">
          <text style="width: 20;">Auto-save:</text>
          <checkbox id="autosave" checked="true" />
        </container>
        <container style="flex-direction: row; gap: 1; align-items: center;">
          <text style="width: 20;">Theme:</text>
          <select id="theme">
            <option value="auto">Auto</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </container>
      </container>
    </tab>
  </tabs>
</melker>`;

suite.add('parse-tabs-component', () => {
  parseMelkerFile(tabsMelker);
}, { iterations: 200, target: 0.5 });

// Run benchmarks
const results = await suite.run();

// Save results
const outputPath = new URL('../results/bundler-' + benchmarkTimestamp() + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
