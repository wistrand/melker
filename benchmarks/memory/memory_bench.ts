#!/usr/bin/env -S deno run --v8-flags=--expose-gc --allow-read --allow-write --allow-run --allow-env

/**
 * Memory usage benchmarks for Melker
 *
 * Measures heap allocation cost of core data structures:
 *   - DualBuffer (the heaviest structure — two grids of Cell objects)
 *   - Element trees (createElement + normalizeStyle overhead)
 *   - Document (element registry Map)
 *   - Layout trees (LayoutNode hierarchy)
 *   - Full render pipeline (element + document + layout + buffer + render)
 *
 * Requires: --v8-flags=--expose-gc
 */

import { MemoryBenchmarkSuite, benchmarkTimestamp } from './memory-harness.ts';
import { DualBuffer } from '../../src/buffer.ts';
import {
  createElement,
  createDocument,
  globalLayoutEngine,
  RenderingEngine,
} from '../../mod.ts';
import { MelkerEngine } from '../../src/engine.ts';
import { parseMelkerFile, parseMelkerForBundler } from '../../src/template.ts';
import { generate } from '../../src/bundler/generator.ts';
import type { ParseResult, ParsedScript, ParsedHandler } from '../../src/bundler/types.ts';
import { EventManager } from '../../src/events.ts';
import { FocusManager } from '../../src/focus.ts';
import { TerminalRenderer } from '../../src/renderer.ts';
import { AnsiOutputGenerator } from '../../src/ansi-output.ts';
import { HitTester } from '../../src/hit-test.ts';
import { ScrollHandler } from '../../src/scroll-handler.ts';
import { Stylesheet } from '../../src/stylesheet.ts';
import { ToastManager } from '../../src/toast/toast-manager.ts';
import { TooltipManager } from '../../src/tooltip/tooltip-manager.ts';
import { GraphicsOverlayManager } from '../../src/graphics-overlay-manager.ts';
import { StatePersistenceManager } from '../../src/state-persistence-manager.ts';
import { initThemes, getThemeManager } from '../../src/theme.ts';
import { MelkerConfig } from '../../src/config/config.ts';

const suite = new MemoryBenchmarkSuite('memory');
const renderer = new RenderingEngine();

function makeContext(width: number, height: number) {
  return {
    viewport: { x: 0, y: 0, width, height },
    parentBounds: { x: 0, y: 0, width, height },
    availableSpace: { width, height },
  };
}

// =============================================================================
// Group 1 — DualBuffer allocation
// =============================================================================

suite.add('dual-buffer-80x24', () => {
  return new DualBuffer(80, 24);
}, { target: 200 });

suite.add('dual-buffer-120x40', () => {
  return new DualBuffer(120, 40);
}, { target: 490 });

suite.add('dual-buffer-220x60', () => {
  return new DualBuffer(220, 60);
}, { target: 1300 });

// =============================================================================
// Group 2 — Element creation
// =============================================================================

suite.add('create-elements-10', () => {
  return createElement('container', { style: { flexDirection: 'column' } },
    ...Array.from({ length: 10 }, (_, i) =>
      createElement('text', { text: `Item ${i}` })
    )
  );
}, { target: 8 });

suite.add('create-elements-100', () => {
  return createElement('container', { style: { flexDirection: 'column' } },
    ...Array.from({ length: 100 }, (_, i) =>
      createElement('text', { text: `Item ${i}` })
    )
  );
}, { target: 45 });

suite.add('create-elements-1000', () => {
  return createElement('container', { style: { flexDirection: 'column' } },
    ...Array.from({ length: 1000 }, (_, i) =>
      createElement('text', { text: `Item ${i}` })
    )
  );
}, { target: 400 });

// =============================================================================
// Group 3 — Document (element registry Map overhead)
// =============================================================================

function freshTree(n: number) {
  return createElement('container', { style: { flexDirection: 'column' } },
    ...Array.from({ length: n }, (_, i) =>
      createElement('text', { text: `Item ${i}` })
    )
  );
}

suite.add('document-10-elements', () => {
  return createDocument(freshTree(10));
}, { target: 10 });

suite.add('document-100-elements', () => {
  return createDocument(freshTree(100));
}, { target: 50 });

// =============================================================================
// Group 4 — Layout (LayoutNode tree overhead)
// =============================================================================

suite.add('layout-10-elements', () => {
  const tree = freshTree(10);
  return globalLayoutEngine.calculateLayout(tree, makeContext(120, 40));
}, { target: 20 });

suite.add('layout-100-elements', () => {
  const tree = freshTree(100);
  return globalLayoutEngine.calculateLayout(tree, makeContext(120, 40));
}, { target: 100 });

// =============================================================================
// Group 5 — Full render pipeline
// =============================================================================

suite.add('full-pipeline-simple', () => {
  const el = createElement('text', { text: 'Hello, World!' });
  globalLayoutEngine.calculateLayout(el, makeContext(80, 24));
  const buffer = new DualBuffer(80, 24);
  renderer.render(el, buffer, { x: 0, y: 0, width: 80, height: 24 });
  return buffer;
}, { target: 450 });

suite.add('full-pipeline-form', () => {
  const el = createElement('container', { style: { flexDirection: 'column', gap: 1, padding: 1 } },
    createElement('text', { text: 'Registration', style: { fontWeight: 'bold' } }),
    createElement('container', { style: { flexDirection: 'row', gap: 1 } },
      createElement('text', { text: 'Name:', style: { width: 12 } }),
      createElement('input', { placeholder: 'Enter name', style: { flex: 1 } }),
    ),
    createElement('container', { style: { flexDirection: 'row', gap: 1 } },
      createElement('text', { text: 'Email:', style: { width: 12 } }),
      createElement('input', { placeholder: 'Enter email', style: { flex: 1 } }),
    ),
    createElement('checkbox', { title: 'Accept terms' }),
    createElement('container', { style: { flexDirection: 'row', gap: 2 } },
      createElement('button', { label: 'Submit' }),
      createElement('button', { label: 'Cancel' }),
    ),
  );
  globalLayoutEngine.calculateLayout(el, makeContext(120, 40));
  const buffer = new DualBuffer(120, 40);
  renderer.render(el, buffer, { x: 0, y: 0, width: 120, height: 40 });
  return buffer;
}, { target: 1100 });

suite.add('full-pipeline-dashboard', () => {
  const el = createElement('container', { style: { flexDirection: 'column', height: 'fill' } },
    // Header
    createElement('container', { style: { flexDirection: 'row', padding: 1 } },
      createElement('text', { text: 'Dashboard', style: { fontWeight: 'bold' } }),
      createElement('container', { style: { flex: 1 } }),
      createElement('text', { text: 'User: admin' }),
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
          createElement('li', {}, createElement('text', { text: 'Settings' })),
        ),
      ),
      // Content area
      createElement('container', { style: { flex: 1, padding: 1 } },
        createElement('text', { text: 'Overview', style: { fontWeight: 'bold' } }),
        createElement('container', { style: { flexDirection: 'row', gap: 2, marginTop: 1 } },
          createElement('container', { style: { border: 'thin', padding: 1, flex: 1 } },
            createElement('text', { text: 'Metric 1' }),
            createElement('text', { text: '1,234', style: { fontWeight: 'bold' } }),
          ),
          createElement('container', { style: { border: 'thin', padding: 1, flex: 1 } },
            createElement('text', { text: 'Metric 2' }),
            createElement('text', { text: '5,678', style: { fontWeight: 'bold' } }),
          ),
          createElement('container', { style: { border: 'thin', padding: 1, flex: 1 } },
            createElement('text', { text: 'Metric 3' }),
            createElement('text', { text: '9,012', style: { fontWeight: 'bold' } }),
          ),
        ),
      ),
    ),
    // Footer
    createElement('container', { style: { padding: 1 } },
      createElement('text', { text: 'Status: Connected' }),
    ),
  );
  globalLayoutEngine.calculateLayout(el, makeContext(120, 40));
  const buffer = new DualBuffer(120, 40);
  renderer.render(el, buffer, { x: 0, y: 0, width: 120, height: 40 });
  return buffer;
}, { target: 1100 });

// =============================================================================
// Group 6 — .melker file parsing (with and without <style>)
// =============================================================================

// Minimal .melker — no style, no script
const minimalMelker = `<melker>
  <container>
    <text>Hello World</text>
    <button label="Click Me" />
  </container>
</melker>`;

suite.add('parse-minimal', () => {
  return parseMelkerFile(minimalMelker);
}, { target: 20 });

// Form .melker — no style block, has script + handlers
const formMelker = `<melker>
  <title>Form Demo</title>
  <container id="root" style="display: flex; flex-direction: column; gap: 1; width: 100%; height: 100%">
    <text>User Registration</text>
    <container style="display: flex; flex-direction: column; gap: 1">
      <text>Name:</text>
      <input id="name-input" />
      <text>Email:</text>
      <input id="email-input" />
      <text>Subscription:</text>
      <radio name="plan" id="free-plan" title="Free Plan" value="free" />
      <radio name="plan" id="pro-plan" title="Pro Plan" value="pro" />
      <radio name="plan" id="enterprise" title="Enterprise" value="ent" />
      <checkbox id="newsletter" title="Receive newsletter" />
      <checkbox id="2fa" title="Enable two-factor auth" />
    </container>
    <container style="display: flex; flex-direction: row; gap: 1">
      <button id="submit" label="Submit" onClick="alert('Submitted')" />
      <button id="clear" label="Clear" onClick="alert('Cleared')" />
    </container>
  </container>
</melker>`;

suite.add('parse-form-no-style', () => {
  return parseMelkerFile(formMelker);
}, { target: 25 });

// Dashboard .melker — with <style> block
const dashboardMelker = `<melker>
  <title>Dashboard</title>
  <style>
    .header { font-weight: bold; padding: 1; }
    .sidebar { width: 25; border: thin; padding: 1; }
    .metric { border: thin; padding: 1; flex: 1; }
    .metric-value { font-weight: bold; }
    .footer { padding: 1; }
    #nav-list li { padding: 0; }
    container.content { flex: 1; padding: 1; }
    .activity-row { flex-direction: row; }
    .activity-row text:first-child { width: 20; }
    .activity-row text:nth-child(2) { width: 15; }
  </style>
  <container style="flex-direction: column; height: fill">
    <container class="header" style="flex-direction: row;">
      <text>Dashboard</text>
      <container style="flex: 1;" />
      <text>User: admin</text>
    </container>
    <container style="flex-direction: row; flex: 1;">
      <container class="sidebar">
        <text style="font-weight: bold;">Navigation</text>
        <list id="nav-list">
          <li><text>Home</text></li>
          <li><text>Analytics</text></li>
          <li><text>Reports</text></li>
          <li><text>Settings</text></li>
        </list>
      </container>
      <container class="content" style="flex-direction: column;">
        <text style="font-weight: bold;">Overview</text>
        <container style="flex-direction: row; gap: 2; margin-top: 1;">
          <container class="metric">
            <text>Metric 1</text>
            <text class="metric-value">1,234</text>
          </container>
          <container class="metric">
            <text>Metric 2</text>
            <text class="metric-value">5,678</text>
          </container>
          <container class="metric">
            <text>Metric 3</text>
            <text class="metric-value">9,012</text>
          </container>
        </container>
      </container>
    </container>
    <container class="footer">
      <text>Status: Connected</text>
    </container>
  </container>
</melker>`;

suite.add('parse-dashboard-with-style', () => {
  return parseMelkerFile(dashboardMelker);
}, { target: 55 });

// Complex app .melker — <style> + <script> + <policy> + many handlers
const complexAppMelker = `<melker>
  <title>Complex App</title>
  <policy>{"permissions": {"read": ["."], "net": ["api.example.com"]}}</policy>
  <style>
    container { padding: 1; }
    .selected { background-color: blue; }
    .error { color: red; }
    .success { color: green; }
    #header { font-weight: bold; }
    #footer { color: gray; }
    .nav-item { padding: 0; }
    .detail-row { flex-direction: row; gap: 1; }
    .detail-row text:first-child { width: 15; font-weight: bold; }
  </style>
  <script type="typescript">
    let state = { items: [], page: 0, filter: '', selected: null };
    export function setFilter(f) { state.filter = f; update(); }
    export function nextPage() { state.page++; update(); }
    export function prevPage() { state.page--; update(); }
    export function select(id) { state.selected = id; update(); }
    export function deselect() { state.selected = null; update(); }
    export async function loadItems() {
      const resp = await fetch('/api/items');
      state.items = await resp.json();
      update();
    }
    function update() {
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
      <container style="width: 30; flex-direction: column; border: thin;">
        <text style="font-weight: bold;">Navigation</text>
        ${Array.from({ length: 15 }, (_, i) =>
          `<button class="nav-item" onClick="$app.select(${i})">Nav ${i}</button>`
        ).join('\n        ')}
      </container>
      <container style="flex: 1; flex-direction: column;">
        <container style="flex: 1; border: thin;">
          <text>Content area</text>
        </container>
        <container style="height: 3; flex-direction: row; gap: 1;">
          <button onClick="$app.prevPage()">Previous</button>
          <text id="pageInfo">Page 1</text>
          <button onClick="$app.nextPage()">Next</button>
        </container>
      </container>
    </container>
    <container id="footer" style="height: 2; flex-direction: row;">
      <text id="status">Ready</text>
    </container>
  </container>
</melker>`;

suite.add('parse-complex-app', () => {
  return parseMelkerFile(complexAppMelker);
}, { target: 55 });

// =============================================================================
// Group 7 — Bundler pipeline (parseMelkerForBundler + generate)
// =============================================================================

// Helper to create ParseResult for generate()
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

// parseMelkerForBundler — simple (counter app)
const counterMelker = `<melker>
  <script>
    let count = 0;
    export function increment() { count++; updateDisplay(); }
    export function decrement() { count--; updateDisplay(); }
    function updateDisplay() {
      $melker.getElementById('counter').props.text = String(count);
    }
  </script>
  <container>
    <text id="counter">0</text>
    <button onClick="$app.increment()">+</button>
    <button onClick="$app.decrement()">-</button>
  </container>
</melker>`;

suite.addAsync('bundler-parse-simple', async () => {
  return await parseMelkerForBundler(counterMelker, 'file:///bench/counter.melker');
}, { iterations: 20, warmup: 3, target: 40 });

// parseMelkerForBundler — complex app (style + script + many handlers)
suite.addAsync('bundler-parse-complex', async () => {
  return await parseMelkerForBundler(complexAppMelker, 'file:///bench/complex.melker');
}, { iterations: 20, warmup: 3, target: 30 });

// generate() — simple script, no handlers
const simpleGenScript = createScript({
  id: 'script_0',
  code: `
let count = 0;
export function increment() { count++; }
export function decrement() { count--; }
`,
});

suite.add('bundler-generate-simple', () => {
  const parsed = createParseResult({
    scripts: [simpleGenScript],
    handlers: [],
    template: '<container><text id="counter">0</text></container>',
  });
  return generate(parsed);
}, { target: 15 });

// generate() — medium script + 10 handlers
const mediumGenScript = createScript({
  id: 'script_0',
  code: `
let items = [];
let selectedIndex = 0;
let filter = '';
export function addItem(name) { items.push({ id: Date.now(), name, completed: false }); updateList(); }
export function removeItem(id) { items = items.filter(item => item.id !== id); updateList(); }
export function toggleItem(id) { const item = items.find(item => item.id === id); if (item) { item.completed = !item.completed; updateList(); } }
export function setFilter(f) { filter = f; updateList(); }
function updateList() {
  const filtered = filter ? items.filter(item => item.name.includes(filter)) : items;
  $melker.getElementById('itemList').props.rows = filtered.map(item => [item.completed ? '[x]' : '[ ]', item.name]);
  $melker.getElementById('countLabel').props.text = filtered.length + ' items';
}
`,
});

const genHandlers10 = Array.from({ length: 10 }, (_, i) =>
  createHandler(`__h${i}`, `$app.handler${i}(event)`, i + 10)
);

suite.add('bundler-generate-10-handlers', () => {
  const parsed = createParseResult({
    scripts: [mediumGenScript],
    handlers: genHandlers10,
    template: '<container></container>',
  });
  return generate(parsed);
}, { target: 15 });

// generate() — large: multi-script + 20 handlers
const initGenScript = createScript({
  id: 'script_1',
  type: 'init',
  code: `await loadData(); console.log('Init complete');`,
  isAsync: true,
});

const readyGenScript = createScript({
  id: 'script_2',
  type: 'ready',
  code: `$melker.getElementById('status').props.text = 'Ready!';`,
  isAsync: true,
});

const genHandlers20 = Array.from({ length: 20 }, (_, i) =>
  createHandler(`__h${i}`, `$app.handler${i}(event); updateUI();`, i + 10)
);

suite.add('bundler-generate-multi-script-20h', () => {
  const parsed = createParseResult({
    scripts: [mediumGenScript, initGenScript, readyGenScript],
    handlers: genHandlers20,
    template: '<container></container>',
  });
  return generate(parsed);
}, { target: 40 });

// =============================================================================
// Group 8 — Engine internals (where does the ~215 KB overhead come from?)
// =============================================================================

// Theme system: initThemes() loads 10 CSS files and builds Theme objects
// initThemes is idempotent after first call — measures the cached singleton access
suite.addAsync('engine-init-themes', async () => {
  await initThemes();
  return getThemeManager();
}, { iterations: 20, warmup: 3, target: 5 });

// Config system: MelkerConfig singleton with schema parsing
suite.add('engine-config', () => {
  return MelkerConfig.get();
}, { target: 5 });

// Document registry (6 elements — hello app tree)
suite.add('engine-document', () => {
  const tree = createElement('container', { style: { flexDirection: 'column' } },
    createElement('text', { text: 'Hello' }),
    createElement('text', { text: 'World' }),
    createElement('text', { text: 'Press Ctrl+C' }),
    createElement('button', { label: 'Click Me!' }),
  );
  return createDocument(tree);
}, { target: 8 });

// EventManager
suite.add('engine-event-manager', () => {
  return new EventManager();
}, { target: 5 });

// FocusManager (needs EventManager + Document)
suite.add('engine-focus-manager', () => {
  const em = new EventManager();
  const tree = createElement('container', {},
    createElement('button', { label: 'A' }),
    createElement('button', { label: 'B' }),
  );
  const doc = createDocument(tree);
  return new FocusManager(em, doc);
}, { target: 8 });

// RenderingEngine (with all its internal caches)
suite.add('engine-rendering-engine', () => {
  return new RenderingEngine();
}, { target: 5 });

// TerminalRenderer
suite.add('engine-terminal-renderer', () => {
  return new TerminalRenderer({ colorSupport: 'truecolor' });
}, { target: 5 });

// AnsiOutputGenerator
suite.add('engine-ansi-output', () => {
  return new AnsiOutputGenerator({ colorSupport: 'truecolor' });
}, { target: 5 });

// HitTester
suite.add('engine-hit-tester', () => {
  const tree = createElement('container', {}, createElement('text', { text: 'Hi' }));
  const doc = createDocument(tree);
  const re = new RenderingEngine();
  return new HitTester({ document: doc, renderer: re, viewportSize: { width: 80, height: 24 } });
}, { target: 8 });

// ScrollHandler
suite.add('engine-scroll-handler', () => {
  const tree = createElement('container', {}, createElement('text', { text: 'Hi' }));
  const doc = createDocument(tree);
  const re = new RenderingEngine();
  return new ScrollHandler({
    document: doc, renderer: re, autoRender: true,
    onRender: () => {}, onRenderDialogOnly: () => {},
    calculateScrollDimensions: () => ({ width: 0, height: 0 }),
  });
}, { target: 8 });

// Stylesheet (parsing 10 CSS rules — typical dashboard style block)
suite.add('engine-stylesheet-10-rules', () => {
  return Stylesheet.fromString(`
    .header { font-weight: bold; padding: 1; }
    .sidebar { width: 25; border: thin; padding: 1; }
    .metric { border: thin; padding: 1; flex: 1; }
    .metric-value { font-weight: bold; }
    .footer { padding: 1; }
    #nav-list li { padding: 0; }
    container.content { flex: 1; padding: 1; }
    .activity-row { flex-direction: row; }
    .activity-row text:first-child { width: 20; }
    .activity-row text:nth-child(2) { width: 15; }
  `);
}, { target: 20 });

// ToastManager + TooltipManager
suite.add('engine-toast-tooltip', () => {
  return { toast: new ToastManager(), tooltip: new TooltipManager() };
}, { target: 5 });

// GraphicsOverlayManager
suite.add('engine-graphics-overlay', () => {
  const tree = createElement('container', {}, createElement('text', { text: 'Hi' }));
  const doc = createDocument(tree);
  const re = new RenderingEngine();
  return new GraphicsOverlayManager({
    document: doc,
    renderer: re,
    writeAllSync: () => {},
  });
}, { target: 8 });

// StatePersistenceManager
suite.add('engine-persistence-manager', () => {
  const tree = createElement('container', {}, createElement('text', { text: 'Hi' }));
  const doc = createDocument(tree);
  return new StatePersistenceManager(
    { persistenceDebounceMs: 500 },
    { document: doc },
  );
}, { target: 5 });

// =============================================================================
// Group 9 — Realistic apps via MelkerEngine (constructor only, no start())
//
// Measures the full engine allocation cost: all managers, buffer, document,
// focus, events, hit-testing, scroll, overlays, etc. — without touching the
// terminal, reading stdin, or starting a server.
// =============================================================================

// Ensure themes are loaded before engine construction (createApp does this internally)
await initThemes();
const _themeManager = getThemeManager();
const _themeName = _themeManager.getCurrentThemeName();
const _colorSupport = _themeManager.getCurrentTheme().colorSupport;

function createEngine(el: ReturnType<typeof createElement>, width: number, height: number) {
  return new MelkerEngine(el, {
    colorSupport: _colorSupport,
    theme: _themeName,
    initialWidth: width, initialHeight: height,
    enableEvents: true, autoResize: false,
    alternateScreen: false, hideCursor: false,
  });
}

// Hello world — minimal app (~6 elements)
suite.add('app-hello', () => {
  const el = createElement('container', { style: { width: 'fill', height: 'fill', border: 'thin', padding: 2, flexDirection: 'column' } },
    createElement('text', { text: 'Hello from Melker CLI!', style: { fontWeight: 'bold', marginBottom: 2 } }),
    createElement('text', { text: 'This UI was loaded from a .melker file.', style: { marginBottom: 1 } }),
    createElement('text', { text: 'Welcome to Melker!', style: { marginBottom: 1 } }),
    createElement('text', { text: 'Press Ctrl+C to exit', style: { marginBottom: 2 } }),
    createElement('button', { label: 'Click Me!' }),
  );
  return createEngine(el, 80, 24);
}, { iterations: 15, warmup: 2, target: 400 });

// Form — typical form app (~20 elements, inputs, radios, checkboxes)
suite.add('app-form', () => {
  const el = createElement('container', { id: 'root', style: { flexDirection: 'column', gap: 1, width: '100%', height: '100%' } },
    createElement('text', { text: 'User Registration' }),
    createElement('container', { style: { flexDirection: 'column', gap: 1 } },
      createElement('text', { text: 'Name:' }),
      createElement('input', { id: 'name-input' }),
      createElement('text', { text: 'Email:' }),
      createElement('input', { id: 'email-input' }),
      createElement('text', { text: 'Subscription:' }),
      createElement('radio', { name: 'plan', title: 'Free Plan', value: 'free' }),
      createElement('radio', { name: 'plan', title: 'Pro Plan', value: 'pro' }),
      createElement('radio', { name: 'plan', title: 'Enterprise', value: 'enterprise' }),
      createElement('text', { text: 'Options:' }),
      createElement('checkbox', { title: 'Receive newsletter' }),
      createElement('checkbox', { title: 'Enable two-factor auth' }),
    ),
    createElement('container', { style: { flexDirection: 'row', gap: 1 } },
      createElement('button', { label: 'Submit' }),
      createElement('button', { label: 'Clear' }),
      createElement('button', { label: 'Cancel' }),
    ),
  );
  return createEngine(el, 80, 24);
}, { iterations: 15, warmup: 2, target: 400 });

// Dashboard — complex layout (~35 elements, nested flexbox, borders, lists)
suite.add('app-dashboard', () => {
  const el = createElement('container', { style: { flexDirection: 'column', height: 'fill' } },
    // Header
    createElement('container', { style: { flexDirection: 'row', padding: 1 } },
      createElement('text', { text: 'Dashboard', style: { fontWeight: 'bold' } }),
      createElement('container', { style: { flex: 1 } }),
      createElement('text', { text: 'User: admin' }),
    ),
    // Main area
    createElement('container', { style: { flexDirection: 'row', flex: 1 } },
      // Sidebar
      createElement('container', { style: { width: 25, border: 'thin', padding: 1 } },
        createElement('text', { text: 'Navigation', style: { fontWeight: 'bold' } }),
        createElement('list', {},
          createElement('li', {}, createElement('text', { text: 'Home' })),
          createElement('li', {}, createElement('text', { text: 'Analytics' })),
          createElement('li', {}, createElement('text', { text: 'Reports' })),
          createElement('li', {}, createElement('text', { text: 'Settings' })),
        ),
      ),
      // Content
      createElement('container', { style: { flex: 1, padding: 1, flexDirection: 'column' } },
        createElement('text', { text: 'Overview', style: { fontWeight: 'bold' } }),
        createElement('container', { style: { flexDirection: 'row', gap: 2, marginTop: 1 } },
          createElement('container', { style: { border: 'thin', padding: 1, flex: 1 } },
            createElement('text', { text: 'Metric 1' }),
            createElement('text', { text: '1,234', style: { fontWeight: 'bold' } }),
          ),
          createElement('container', { style: { border: 'thin', padding: 1, flex: 1 } },
            createElement('text', { text: 'Metric 2' }),
            createElement('text', { text: '5,678', style: { fontWeight: 'bold' } }),
          ),
          createElement('container', { style: { border: 'thin', padding: 1, flex: 1 } },
            createElement('text', { text: 'Metric 3' }),
            createElement('text', { text: '9,012', style: { fontWeight: 'bold' } }),
          ),
        ),
        // Table-like section
        createElement('container', { style: { border: 'thin', marginTop: 1, flex: 1, flexDirection: 'column' } },
          createElement('text', { text: 'Recent Activity', style: { fontWeight: 'bold', padding: 1 } }),
          ...Array.from({ length: 8 }, (_, i) =>
            createElement('container', { style: { flexDirection: 'row', paddingLeft: 1, paddingRight: 1 } },
              createElement('text', { text: `Event ${i + 1}`, style: { width: 20 } }),
              createElement('text', { text: `User ${i + 1}`, style: { width: 15 } }),
              createElement('text', { text: '2 min ago' }),
            )
          ),
        ),
      ),
    ),
    // Footer
    createElement('container', { style: { padding: 1 } },
      createElement('text', { text: 'Status: Connected' }),
    ),
  );
  return createEngine(el, 120, 40);
}, { iterations: 15, warmup: 2, target: 900 });

// Data table — heavy data app (5000-row data-table component)
suite.add('app-data-table-5000', () => {
  const rows: (string | number)[][] = [];
  const names = ['Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'];
  const depts = ['Engineering', 'Marketing', 'Sales', 'HR', 'Finance', 'Operations'];
  const statuses = ['Active', 'Away', 'Busy', 'Offline'];
  for (let i = 1; i <= 5000; i++) {
    rows.push([
      i,
      names[i % names.length] + ' ' + names[(i * 7) % names.length],
      depts[i % depts.length],
      statuses[i % statuses.length],
      30000 + (i * 17) % 120000,
      (i % 20 + 1) + ' years',
    ]);
  }

  const el = createElement('container', { style: { flexDirection: 'column', width: '100%', height: '100%', gap: 1 } },
    createElement('container', { style: { flexDirection: 'row', paddingLeft: 1, paddingRight: 1 } },
      createElement('text', { text: 'Employee Directory', style: { fontWeight: 'bold' } }),
      createElement('text', { text: 'No selection' }),
    ),
    createElement('data-table', {
      style: { width: 'fill', height: 'fill' },
      columns: [
        { header: 'ID', width: 5, align: 'right' },
        { header: 'Name', width: '25%' },
        { header: 'Department', width: '20%' },
        { header: 'Status', width: 10 },
        { header: 'Salary', width: 12, align: 'right' },
        { header: 'Tenure' },
      ],
      rows,
    }),
    createElement('container', { style: { flexDirection: 'row', gap: 2, paddingLeft: 1, paddingRight: 1 } },
      createElement('text', { text: 'Click header to sort' }),
      createElement('text', { text: 'Arrow keys to navigate' }),
      createElement('button', { label: 'Exit' }),
    ),
  );
  return createEngine(el, 120, 40);
}, { iterations: 10, warmup: 1, target: 1700 });

// =============================================================================
// Run benchmarks
// =============================================================================

const results = await suite.run();

// Helper to get median from results
const getMedian = (name: string) => results.find(r => r.name === name)?.median ?? 0;

// =============================================================================
// Findings
// =============================================================================

// Per-element cost (from element creation group)
const elem10 = getMedian('create-elements-10');
const elem100 = getMedian('create-elements-100');
const elem1000 = getMedian('create-elements-1000');
const perElement100 = (elem100 - elem10) / 90;
const perElement1000 = (elem1000 - elem100) / 900;

// Buffer sizes
const buf80x24 = getMedian('dual-buffer-80x24');
const buf120x40 = getMedian('dual-buffer-120x40');
const buf220x60 = getMedian('dual-buffer-220x60');

// Full pipeline
const pipelineSimple = getMedian('full-pipeline-simple');
const pipelineDashboard = getMedian('full-pipeline-dashboard');

// Parsing benchmarks
const parseMinimal = getMedian('parse-minimal');
const parseForm = getMedian('parse-form-no-style');
const parseDashboard = getMedian('parse-dashboard-with-style');
const parseComplex = getMedian('parse-complex-app');

// Bundler benchmarks
const bundlerParseSimple = getMedian('bundler-parse-simple');
const bundlerParseComplex = getMedian('bundler-parse-complex');
const bundlerGenSimple = getMedian('bundler-generate-simple');
const bundlerGen10h = getMedian('bundler-generate-10-handlers');
const bundlerGenMulti = getMedian('bundler-generate-multi-script-20h');

// Engine internals benchmarks
const engThemes = getMedian('engine-init-themes');
const engConfig = getMedian('engine-config');
const engDocument = getMedian('engine-document');
const engEventMgr = getMedian('engine-event-manager');
const engFocusMgr = getMedian('engine-focus-manager');
const engRenderEng = getMedian('engine-rendering-engine');
const engTermRend = getMedian('engine-terminal-renderer');
const engAnsiOut = getMedian('engine-ansi-output');
const engHitTest = getMedian('engine-hit-tester');
const engScroll = getMedian('engine-scroll-handler');
const engStylesheet = getMedian('engine-stylesheet-10-rules');
const engToastTooltip = getMedian('engine-toast-tooltip');
const engGfxOverlay = getMedian('engine-graphics-overlay');
const engPersistence = getMedian('engine-persistence-manager');
const engInternalsSum = engThemes + engConfig + engDocument + engEventMgr + engFocusMgr +
  engRenderEng + engTermRend + engAnsiOut + engHitTest + engScroll + engStylesheet +
  engToastTooltip + engGfxOverlay + engPersistence;

// App benchmarks
const appHello = getMedian('app-hello');
const appForm = getMedian('app-form');
const appDashboard = getMedian('app-dashboard');
const appDataTable = getMedian('app-data-table-5000');

suite.addFindings([
  {
    title: 'DualBuffer dominates memory',
    description: `DualBuffer is the single heaviest allocation. 80x24=${buf80x24.toFixed(0)} KB, 120x40=${buf120x40.toFixed(0)} KB, 220x60=${buf220x60.toFixed(0)} KB. Scales linearly with cell count (width * height * 2 buffers).`,
    category: 'performance',
    severity: 'info',
    benchmarks: ['dual-buffer-80x24', 'dual-buffer-120x40', 'dual-buffer-220x60'],
    metrics: {
      '80x24_KB': buf80x24,
      '120x40_KB': buf120x40,
      '220x60_KB': buf220x60,
      'ratio_220x60_vs_80x24': `${(buf220x60 / buf80x24).toFixed(1)}x`,
    },
  },
  {
    title: 'Per-element allocation cost',
    description: `Each element costs ~${perElement100.toFixed(2)} KB (from 10→100 range) to ~${perElement1000.toFixed(2)} KB (100→1000 range). Includes createElement overhead and normalizeStyle.`,
    category: 'performance',
    severity: 'info',
    benchmarks: ['create-elements-10', 'create-elements-100', 'create-elements-1000'],
    metrics: {
      '10_elements_KB': elem10,
      '100_elements_KB': elem100,
      '1000_elements_KB': elem1000,
      'per_element_KB': perElement100,
    },
  },
  {
    title: 'Buffer dominance in full pipeline',
    description: `In the simple pipeline (80x24), total=${pipelineSimple.toFixed(0)} KB vs buffer-only=${buf80x24.toFixed(0)} KB. Buffer accounts for ~${((buf80x24 / pipelineSimple) * 100).toFixed(0)}% of total allocation. Dashboard (120x40) = ${pipelineDashboard.toFixed(0)} KB.`,
    category: 'comparison',
    severity: 'info',
    benchmarks: ['full-pipeline-simple', 'dual-buffer-80x24', 'full-pipeline-dashboard'],
    metrics: {
      'simple_total_KB': pipelineSimple,
      'buffer_80x24_KB': buf80x24,
      'buffer_share_pct': `${((buf80x24 / pipelineSimple) * 100).toFixed(0)}%`,
      'dashboard_total_KB': pipelineDashboard,
    },
  },
  {
    title: 'Full app memory (MelkerEngine lifecycle)',
    description: `Realistic apps via createApp in headless mode. Hello=${appHello.toFixed(0)} KB, Form=${appForm.toFixed(0)} KB, Dashboard=${appDashboard.toFixed(0)} KB. Engine overhead (theme, document, focus, event managers) adds significant cost beyond raw pipeline.`,
    category: 'performance',
    severity: 'info',
    benchmarks: ['app-hello', 'app-form', 'app-dashboard'],
    metrics: {
      'hello_KB': appHello,
      'form_KB': appForm,
      'dashboard_KB': appDashboard,
      'engine_overhead_KB': `${(appHello - pipelineSimple).toFixed(0)}`,
    },
  },
  {
    title: 'Data-heavy app memory',
    description: `Data table with 5000 rows costs ${appDataTable.toFixed(0)} KB. The row data array itself is a significant contributor alongside the DualBuffer.`,
    category: 'performance',
    severity: 'info',
    benchmarks: ['app-data-table-5000'],
    metrics: {
      'data_table_5000_KB': appDataTable,
      'vs_dashboard_ratio': `${(appDataTable / appDashboard).toFixed(1)}x`,
    },
  },
  {
    title: '.melker parsing: style block cost',
    description: `Parsing without style: minimal=${parseMinimal.toFixed(1)} KB, form=${parseForm.toFixed(1)} KB. With style: dashboard=${parseDashboard.toFixed(1)} KB, complex=${parseComplex.toFixed(1)} KB. The <style> block adds stylesheet parsing and CSS rule objects.`,
    category: 'comparison',
    severity: 'info',
    benchmarks: ['parse-minimal', 'parse-form-no-style', 'parse-dashboard-with-style', 'parse-complex-app'],
    metrics: {
      'minimal_KB': parseMinimal,
      'form_no_style_KB': parseForm,
      'dashboard_with_style_KB': parseDashboard,
      'complex_app_KB': parseComplex,
    },
  },
  {
    title: 'Bundler pipeline memory',
    description: `parseMelkerForBundler: simple=${bundlerParseSimple.toFixed(1)} KB, complex=${bundlerParseComplex.toFixed(1)} KB. generate(): simple=${bundlerGenSimple.toFixed(1)} KB, 10 handlers=${bundlerGen10h.toFixed(1)} KB, multi-script+20h=${bundlerGenMulti.toFixed(1)} KB. Handler count drives generate() cost.`,
    category: 'performance',
    severity: 'info',
    benchmarks: ['bundler-parse-simple', 'bundler-parse-complex', 'bundler-generate-simple', 'bundler-generate-10-handlers', 'bundler-generate-multi-script-20h'],
    metrics: {
      'parse_simple_KB': bundlerParseSimple,
      'parse_complex_KB': bundlerParseComplex,
      'generate_simple_KB': bundlerGenSimple,
      'generate_10h_KB': bundlerGen10h,
      'generate_multi_20h_KB': bundlerGenMulti,
    },
  },
  {
    title: 'Engine internals breakdown',
    description: `Individual engine component costs (sum=${engInternalsSum.toFixed(0)} KB): ThemeManager=${engThemes.toFixed(1)} KB, Config=${engConfig.toFixed(1)} KB, Document=${engDocument.toFixed(1)} KB, EventManager=${engEventMgr.toFixed(1)} KB, FocusManager=${engFocusMgr.toFixed(1)} KB, RenderingEngine=${engRenderEng.toFixed(1)} KB, TerminalRenderer=${engTermRend.toFixed(1)} KB, AnsiOutput=${engAnsiOut.toFixed(1)} KB, HitTester=${engHitTest.toFixed(1)} KB, ScrollHandler=${engScroll.toFixed(1)} KB, Stylesheet=${engStylesheet.toFixed(1)} KB, Toast+Tooltip=${engToastTooltip.toFixed(1)} KB, GfxOverlay=${engGfxOverlay.toFixed(1)} KB, Persistence=${engPersistence.toFixed(1)} KB.`,
    category: 'performance',
    severity: 'info',
    benchmarks: [
      'engine-init-themes', 'engine-config', 'engine-document', 'engine-event-manager',
      'engine-focus-manager', 'engine-rendering-engine', 'engine-terminal-renderer',
      'engine-ansi-output', 'engine-hit-tester', 'engine-scroll-handler',
      'engine-stylesheet-10-rules', 'engine-toast-tooltip', 'engine-graphics-overlay',
      'engine-persistence-manager',
    ],
    metrics: {
      'themes_KB': engThemes,
      'config_KB': engConfig,
      'document_KB': engDocument,
      'event_manager_KB': engEventMgr,
      'focus_manager_KB': engFocusMgr,
      'rendering_engine_KB': engRenderEng,
      'terminal_renderer_KB': engTermRend,
      'ansi_output_KB': engAnsiOut,
      'hit_tester_KB': engHitTest,
      'scroll_handler_KB': engScroll,
      'stylesheet_KB': engStylesheet,
      'toast_tooltip_KB': engToastTooltip,
      'gfx_overlay_KB': engGfxOverlay,
      'persistence_KB': engPersistence,
      'sum_KB': engInternalsSum,
    },
  },
]);

suite.setNotes(
  'Memory usage benchmarks. Measures heap allocation cost of DualBuffer, element trees, ' +
  'documents, layout trees, full render pipelines, .melker file parsing (with/without style), ' +
  'bundler pipeline (parseMelkerForBundler + generate), engine internal components, ' +
  'and realistic apps via createApp (headless). ' +
  'All values in KB.'
);

// Save results
const outputPath = new URL('../results/memory-' + benchmarkTimestamp() + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
