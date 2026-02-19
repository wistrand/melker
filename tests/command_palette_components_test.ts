// Tests for command palette component discovery, label resolution, shortcuts,
// and draggable palette behavior.

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  Document,
  ContainerElement,
  ButtonElement,
  InputElement,
  createElement,
} from '../mod.ts';
import {
  discoverPaletteItems,
  normalizeShortcut,
  eventToShortcut,
  buildShortcutMap,
  parseCommandKeys,
  type PaletteItem,
} from '../src/command-palette-components.ts';
import { CommandPaletteElement } from '../src/components/filterable-list/command-palette.ts';

/** Helper: create a document with children under a root container */
function createDoc(children: any[]) {
  const root = new ContainerElement({ id: 'root' }, children);
  return new Document(root);
}

const noop = () => {};

// ── Discovery: qualifying types ────────────────────────────────────────

Deno.test('discoverPaletteItems finds buttons', () => {
  const doc = createDoc([
    createElement('button', { id: 'btn1', label: 'Save' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assertEquals(items.length, 1);
  assert(items[0].label.includes('Save'));
  assertEquals(items[0].group, 'Actions');
});

Deno.test('discoverPaletteItems finds inputs', () => {
  const doc = createDoc([
    createElement('input', { id: 'search', placeholder: 'Search...' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assertEquals(items.length, 1);
  assert(items[0].label.includes('Search...'));
  assertEquals(items[0].group, 'Fields');
});

Deno.test('discoverPaletteItems finds tabs', () => {
  const doc = createDoc([
    createElement('tab', { id: 'tab1', title: 'General' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assertEquals(items.length, 1);
  assert(items[0].label.includes('General'));
  assertEquals(items[0].group, 'Navigation');
});

Deno.test('discoverPaletteItems finds checkboxes and radios', () => {
  const doc = createDoc([
    createElement('checkbox', { id: 'cb1', title: 'Dark mode' }),
    createElement('radio', { id: 'r1', title: 'English', value: 'en' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assertEquals(items.length, 2);
  assertEquals(items[0].group, 'Actions');
  assertEquals(items[1].group, 'Actions');
});

// ── Discovery: non-qualifying types excluded ───────────────────────────

Deno.test('discoverPaletteItems ignores text elements', () => {
  const doc = createDoc([
    createElement('text', { id: 'txt', text: 'Hello' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assertEquals(items.length, 0);
});

Deno.test('discoverPaletteItems ignores containers', () => {
  const doc = createDoc([
    createElement('container', { id: 'box' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assertEquals(items.length, 0);
});

// ── Discovery: opt-out ─────────────────────────────────────────────────

Deno.test('discoverPaletteItems excludes palette=false', () => {
  const doc = createDoc([
    createElement('button', { id: 'btn1', label: 'Visible' }),
    createElement('button', { id: 'btn2', label: 'Hidden', palette: false }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assertEquals(items.length, 1);
  assert(items[0].label.includes('Visible'));
});

Deno.test('discoverPaletteItems excludes palette="false" (string)', () => {
  const doc = createDoc([
    createElement('button', { id: 'btn1', label: 'Visible' }),
    createElement('button', { id: 'btn2', label: 'Hidden', palette: 'false' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assertEquals(items.length, 1);
});

// ── Discovery: visibility filtering ────────────────────────────────────

Deno.test('discoverPaletteItems skips invisible branches', () => {
  const doc = createDoc([
    createElement('container', { id: 'c1', visible: false },
      createElement('button', { id: 'btn-hidden', label: 'Should not appear' }),
    ),
    createElement('button', { id: 'btn-visible', label: 'Visible' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assertEquals(items.length, 1);
  assert(items[0].label.includes('Visible'));
});

Deno.test('discoverPaletteItems skips closed dialogs', () => {
  const doc = createDoc([
    createElement('dialog', { id: 'd1', open: false },
      createElement('button', { id: 'btn-in-dialog', label: 'Dialog Btn' }),
    ),
    createElement('button', { id: 'btn-outside', label: 'Outside' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assertEquals(items.length, 1);
  assert(items[0].label.includes('Outside'));
});

Deno.test('discoverPaletteItems includes open dialog children', () => {
  const doc = createDoc([
    createElement('dialog', { id: 'd1', open: true },
      createElement('button', { id: 'btn-in-dialog', label: 'Dialog Btn' }),
    ),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assertEquals(items.length, 1);
  assert(items[0].label.includes('Dialog Btn'));
});

Deno.test('discoverPaletteItems skips command-palette elements', () => {
  const doc = createDoc([
    createElement('command-palette', { id: 'cp1', open: true },
      createElement('button', { id: 'btn-in-palette', label: 'Palette Btn' }),
    ),
    createElement('button', { id: 'btn-outside', label: 'Outside' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assertEquals(items.length, 1);
  assert(items[0].label.includes('Outside'));
});

// ── Label resolution ───────────────────────────────────────────────────

Deno.test('label resolution: palette prop takes priority', () => {
  const doc = createDoc([
    createElement('button', { id: 'btn', label: 'X', palette: 'Close Panel' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assert(items[0].label.includes('Close Panel'));
});

Deno.test('label resolution: label prop', () => {
  const doc = createDoc([
    createElement('button', { id: 'btn', label: 'Save' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assert(items[0].label.includes('Save'));
});

Deno.test('label resolution: title prop', () => {
  const doc = createDoc([
    createElement('checkbox', { id: 'cb', title: 'Dark mode' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assert(items[0].label.includes('Dark mode'));
});

Deno.test('label resolution: aria-label', () => {
  const doc = createDoc([
    createElement('slider', { id: 'vol', 'aria-label': 'Volume' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assert(items[0].label.includes('Volume'));
});

Deno.test('label resolution: placeholder', () => {
  const doc = createDoc([
    createElement('input', { id: 'q', placeholder: 'Search...' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assert(items[0].label.includes('Search...'));
});

Deno.test('label resolution: humanized ID', () => {
  const doc = createDoc([
    createElement('button', { id: 'submit-btn' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assert(items[0].label.includes('Submit Btn'));
});

Deno.test('label resolution: auto-generated IDs (el-*) are skipped', () => {
  // Element with auto-generated ID and no other label source → excluded
  const doc = createDoc([
    createElement('button', { id: 'el-123' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assertEquals(items.length, 0);
});

Deno.test('label includes element type', () => {
  const doc = createDoc([
    createElement('button', { id: 'btn', label: 'Save' }),
    createElement('input', { id: 'inp', placeholder: 'Name' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assert(items[0].label.includes('(button)'));
  assert(items[1].label.includes('(input)'));
});

// ── Custom group ───────────────────────────────────────────────────────

Deno.test('palette-group overrides default group', () => {
  const doc = createDoc([
    createElement('button', { id: 'btn', label: 'Undo', 'palette-group': 'Edit' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assertEquals(items[0].group, 'Edit');
});

// ── Shortcuts ──────────────────────────────────────────────────────────

Deno.test('palette-shortcut is captured', () => {
  const doc = createDoc([
    createElement('button', { id: 'btn', label: 'Save', 'palette-shortcut': 'Ctrl+S' }),
  ]);
  const items = discoverPaletteItems(doc, noop);
  assertEquals(items[0].shortcut, 'Ctrl+S');
});

// ── normalizeShortcut ──────────────────────────────────────────────────

Deno.test('normalizeShortcut lowercases and sorts modifiers', () => {
  assertEquals(normalizeShortcut('Ctrl+S'), 'ctrl+s');
  assertEquals(normalizeShortcut('Alt+Ctrl+S'), 'alt+ctrl+s');
});

Deno.test('normalizeShortcut handles single key', () => {
  assertEquals(normalizeShortcut('F1'), 'f1');
});

Deno.test('normalizeShortcut strips shift for printable letters', () => {
  assertEquals(normalizeShortcut('Shift+P'), 'p');
  assertEquals(normalizeShortcut('Shift+Alt+X'), 'alt+x');
  assertEquals(normalizeShortcut('P'), 'p');
  assertEquals(normalizeShortcut('p'), 'p');
});

Deno.test('normalizeShortcut keeps shift for non-printable keys', () => {
  assertEquals(normalizeShortcut('Shift+ArrowUp'), 'shift+arrowup');
  assertEquals(normalizeShortcut('Shift+F1'), 'shift+f1');
  assertEquals(normalizeShortcut('Shift+Tab'), 'shift+tab');
  assertEquals(normalizeShortcut('Ctrl+Shift+Enter'), 'ctrl+shift+enter');
});

// ── eventToShortcut ────────────────────────────────────────────────────

Deno.test('eventToShortcut builds correct string', () => {
  assertEquals(eventToShortcut({ key: 's', ctrlKey: true }), 'ctrl+s');
  assertEquals(eventToShortcut({ key: 'a' }), 'a');
});

Deno.test('eventToShortcut strips shift for printable letters', () => {
  // Simple terminal: uppercase char, no shift flag
  assertEquals(eventToShortcut({ key: 'P' }), 'p');
  // Kitty terminal: uppercase char with explicit shift flag
  assertEquals(eventToShortcut({ key: 'P', shiftKey: true }), 'p');
  // Modifier combo: Ctrl+Shift+P (Kitty reports shift)
  assertEquals(eventToShortcut({ key: 'P', ctrlKey: true, shiftKey: true }), 'ctrl+p');
  // Alt+Shift+X
  assertEquals(eventToShortcut({ key: 'x', altKey: true, shiftKey: true }), 'alt+x');
});

Deno.test('eventToShortcut keeps shift for non-printable keys', () => {
  assertEquals(eventToShortcut({ key: 'ArrowUp', shiftKey: true }), 'shift+arrowup');
  assertEquals(eventToShortcut({ key: 'Tab', shiftKey: true }), 'shift+tab');
  assertEquals(eventToShortcut({ key: 'F1', shiftKey: true }), 'shift+f1');
});

// ── parseCommandKeys ─────────────────────────────────────────────────

Deno.test('parseCommandKeys splits comma-separated keys', () => {
  assertEquals(parseCommandKeys('a,b,c'), ['a', 'b', 'c']);
  assertEquals(parseCommandKeys('Delete,Backspace'), ['Delete', 'Backspace']);
});

Deno.test('parseCommandKeys handles comma alias', () => {
  assertEquals(parseCommandKeys(','), [',']);
  assertEquals(parseCommandKeys('a,comma'), ['a', ',']);
});

Deno.test('parseCommandKeys handles space key', () => {
  assertEquals(parseCommandKeys(' '), [' ']);
  assertEquals(parseCommandKeys('Space'), [' ']);
  assertEquals(parseCommandKeys('a,Space'), ['a', ' ']);
});

// ── normalizeShortcut + space ────────────────────────────────────────

Deno.test('normalizeShortcut handles space key', () => {
  assertEquals(normalizeShortcut(' '), ' ');
  assertEquals(normalizeShortcut('Space'), ' ');
  assertEquals(normalizeShortcut('Ctrl+ '), 'ctrl+ ');
});

Deno.test('eventToShortcut handles space key', () => {
  assertEquals(eventToShortcut({ key: ' ' }), ' ');
  assertEquals(eventToShortcut({ key: ' ', ctrlKey: true }), 'ctrl+ ');
});

// ── parseCommandKeys + plus ──────────────────────────────────────────

Deno.test('parseCommandKeys handles plus key', () => {
  assertEquals(parseCommandKeys('+'), ['+']);
  assertEquals(parseCommandKeys('plus'), ['+']);
  assertEquals(parseCommandKeys('+,='), ['+', '=']);
});

// ── normalizeShortcut + plus ─────────────────────────────────────────

Deno.test('normalizeShortcut handles plus key', () => {
  assertEquals(normalizeShortcut('+'), '+');
  assertEquals(normalizeShortcut('plus'), '+');
  assertEquals(normalizeShortcut('Ctrl++'), 'ctrl++');
  assertEquals(normalizeShortcut('Ctrl+plus'), 'ctrl++');
});

Deno.test('eventToShortcut handles plus key', () => {
  assertEquals(eventToShortcut({ key: '+' }), '+');
  assertEquals(eventToShortcut({ key: '+', ctrlKey: true }), 'ctrl++');
});

// ── buildShortcutMap ───────────────────────────────────────────────────

Deno.test('buildShortcutMap creates map from items', () => {
  let called = false;
  const items: PaletteItem[] = [
    { elementId: 'btn1', label: 'Save', group: 'Actions', action: () => { called = true; }, shortcut: 'Ctrl+S' },
  ];
  const map = buildShortcutMap(items);
  assertEquals(map.size, 1);
  assert(map.has('ctrl+s'));
  map.get('ctrl+s')!();
  assertEquals(called, true);
});

Deno.test('buildShortcutMap skips system key conflicts', () => {
  const items: PaletteItem[] = [
    { elementId: 'btn1', label: 'Copy', group: 'Actions', action: noop, shortcut: 'Ctrl+C' },
  ];
  const map = buildShortcutMap(items);
  assertEquals(map.has('ctrl+c'), false);
});

Deno.test('buildShortcutMap first in tree order wins duplicates', () => {
  let firstCalled = false;
  let secondCalled = false;
  const items: PaletteItem[] = [
    { elementId: 'btn1', label: 'First', group: 'Actions', action: () => { firstCalled = true; }, shortcut: 'Ctrl+S' },
    { elementId: 'btn2', label: 'Second', group: 'Actions', action: () => { secondCalled = true; }, shortcut: 'Ctrl+S' },
  ];
  const map = buildShortcutMap(items);
  assertEquals(map.size, 1);
  map.get('ctrl+s')!();
  assertEquals(firstCalled, true);
  assertEquals(secondCalled, false);
});

Deno.test('buildShortcutMap skips items without shortcut', () => {
  const items: PaletteItem[] = [
    { elementId: 'btn1', label: 'Save', group: 'Actions', action: noop },
  ];
  const map = buildShortcutMap(items);
  assertEquals(map.size, 0);
});

Deno.test('buildShortcutMap registers _globalKeys from single palette item', () => {
  let called = 0;
  const action = () => { called++; };
  const items = [
    { elementId: 'cmd1', label: 'Move Left', group: 'Commands', action, hint: 'ArrowLeft, a', _globalKeys: ['ArrowLeft', 'a'], _elementType: 'command' },
  ] as unknown as PaletteItem[];
  const map = buildShortcutMap(items);
  assertEquals(map.size, 2);
  assert(map.has('arrowleft'));
  assert(map.has('a'));
  map.get('arrowleft')!();
  map.get('a')!();
  assertEquals(called, 2);
});

// ── CommandPaletteElement drag ──────────────────────────────────────────

Deno.test('CommandPaletteElement drag state lifecycle', () => {
  const palette = new CommandPaletteElement({ id: 'cp', title: 'Test' });

  assertEquals(palette.isDragging(), false);

  palette.startDrag(10, 5);
  assertEquals(palette.isDragging(), true);

  palette.endDrag();
  assertEquals(palette.isDragging(), false);
});

Deno.test('CommandPaletteElement isOnTitleBar returns false when closed', () => {
  const palette = new CommandPaletteElement({ id: 'cp', title: 'Test' });
  // No bounds set, palette not open
  assertEquals(palette.isOnTitleBar(5, 0), false);
});

Deno.test('CommandPaletteElement close resets drag state', () => {
  const palette = new CommandPaletteElement({ id: 'cp', title: 'Test' });
  palette.open();
  palette.startDrag(10, 5);
  assertEquals(palette.isDragging(), true);

  palette.close();
  assertEquals(palette.isDragging(), false);
});

Deno.test('CommandPaletteElement open resets position', () => {
  const palette = new CommandPaletteElement({ id: 'cp', title: 'Test' });

  // First open + drag
  palette.open();
  palette.startDrag(10, 5);
  palette.endDrag();

  // Close and reopen should reset
  palette.close();
  palette.open();
  assertEquals(palette.isDragging(), false);
});
