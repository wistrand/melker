// Tests for geometric arrow-key focus navigation (FocusManager.focusInDirection)

import { assertEquals } from 'jsr:@std/assert';
import {
  FocusManager,
  EventManager,
  Document,
  ContainerElement,
  ButtonElement,
  InputElement,
  createElement,
} from '../mod.ts';

/** Helper: create a FocusManager wired to a document with a static bounds map */
function setup(
  elements: { id: string; x: number; y: number; width: number; height: number; disabled?: boolean; visible?: boolean }[],
) {
  const children = elements.map(e =>
    createElement('button', { id: e.id, label: e.id, disabled: e.disabled ?? false, visible: e.visible ?? true })
  );
  const root = new ContainerElement({ id: 'root' }, children);
  const doc = new Document(root);

  const boundsMap = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const e of elements) {
    boundsMap.set(e.id, { x: e.x, y: e.y, width: e.width, height: e.height });
  }

  const em = new EventManager();
  const fm = new FocusManager(em, doc);
  fm.setBoundsProvider(id => boundsMap.get(id));

  // Register all elements as focusable
  for (const e of elements) {
    fm.registerFocusableElement(e.id);
  }

  return fm;
}

// ── Basic horizontal navigation ────────────────────────────────────────

Deno.test('focusInDirection right - same row', () => {
  //  [A]  [B]  [C]   all on y=0
  const fm = setup([
    { id: 'a', x: 0, y: 0, width: 5, height: 1 },
    { id: 'b', x: 10, y: 0, width: 5, height: 1 },
    { id: 'c', x: 20, y: 0, width: 5, height: 1 },
  ]);
  fm.focus('a');
  assertEquals(fm.focusInDirection('right'), true);
  assertEquals(fm.getFocusedElement(), 'b');
});

Deno.test('focusInDirection left - same row', () => {
  const fm = setup([
    { id: 'a', x: 0, y: 0, width: 5, height: 1 },
    { id: 'b', x: 10, y: 0, width: 5, height: 1 },
    { id: 'c', x: 20, y: 0, width: 5, height: 1 },
  ]);
  fm.focus('c');
  assertEquals(fm.focusInDirection('left'), true);
  assertEquals(fm.getFocusedElement(), 'b');
});

Deno.test('focusInDirection right - no element to the right', () => {
  const fm = setup([
    { id: 'a', x: 0, y: 0, width: 5, height: 1 },
    { id: 'b', x: 10, y: 0, width: 5, height: 1 },
  ]);
  fm.focus('b');
  assertEquals(fm.focusInDirection('right'), false);
  assertEquals(fm.getFocusedElement(), 'b');
});

// ── Basic vertical navigation ──────────────────────────────────────────

Deno.test('focusInDirection down - same column', () => {
  //  [A]
  //  [B]
  //  [C]
  const fm = setup([
    { id: 'a', x: 0, y: 0, width: 10, height: 1 },
    { id: 'b', x: 0, y: 2, width: 10, height: 1 },
    { id: 'c', x: 0, y: 4, width: 10, height: 1 },
  ]);
  fm.focus('a');
  assertEquals(fm.focusInDirection('down'), true);
  assertEquals(fm.getFocusedElement(), 'b');
});

Deno.test('focusInDirection up - same column', () => {
  const fm = setup([
    { id: 'a', x: 0, y: 0, width: 10, height: 1 },
    { id: 'b', x: 0, y: 2, width: 10, height: 1 },
    { id: 'c', x: 0, y: 4, width: 10, height: 1 },
  ]);
  fm.focus('c');
  assertEquals(fm.focusInDirection('up'), true);
  assertEquals(fm.getFocusedElement(), 'b');
});

Deno.test('focusInDirection up - no element above', () => {
  const fm = setup([
    { id: 'a', x: 0, y: 0, width: 10, height: 1 },
    { id: 'b', x: 0, y: 2, width: 10, height: 1 },
  ]);
  fm.focus('a');
  assertEquals(fm.focusInDirection('up'), false);
  assertEquals(fm.getFocusedElement(), 'a');
});

// ── Alignment preference ───────────────────────────────────────────────

Deno.test('focusInDirection right - prefers aligned (same row) over closer off-row', () => {
  //  [B]  (row 0, closer but different row — gap between rows)
  //
  //  [A]        [C]  (row 3, aligned, farther)
  const fm = setup([
    { id: 'a', x: 0, y: 3, width: 5, height: 1 },
    { id: 'b', x: 8, y: 0, width: 5, height: 1 },
    { id: 'c', x: 20, y: 3, width: 5, height: 1 },
  ]);
  fm.focus('a');
  assertEquals(fm.focusInDirection('right'), true);
  assertEquals(fm.getFocusedElement(), 'c');
});

Deno.test('focusInDirection down - prefers aligned (same column) over closer off-column', () => {
  //  [A]
  //       [B]  (off-column, closer)
  //  [C]       (aligned, farther)
  const fm = setup([
    { id: 'a', x: 0, y: 0, width: 10, height: 1 },
    { id: 'b', x: 15, y: 2, width: 10, height: 1 },
    { id: 'c', x: 0, y: 5, width: 10, height: 1 },
  ]);
  fm.focus('a');
  assertEquals(fm.focusInDirection('down'), true);
  assertEquals(fm.getFocusedElement(), 'c');
});

// ── Disabled and invisible elements ────────────────────────────────────

Deno.test('focusInDirection skips disabled elements', () => {
  const fm = setup([
    { id: 'a', x: 0, y: 0, width: 5, height: 1 },
    { id: 'b', x: 10, y: 0, width: 5, height: 1, disabled: true },
    { id: 'c', x: 20, y: 0, width: 5, height: 1 },
  ]);
  fm.focus('a');
  assertEquals(fm.focusInDirection('right'), true);
  assertEquals(fm.getFocusedElement(), 'c');
});

Deno.test('focusInDirection skips invisible elements', () => {
  const fm = setup([
    { id: 'a', x: 0, y: 0, width: 5, height: 1 },
    { id: 'b', x: 10, y: 0, width: 5, height: 1, visible: false },
    { id: 'c', x: 20, y: 0, width: 5, height: 1 },
  ]);
  fm.focus('a');
  assertEquals(fm.focusInDirection('right'), true);
  assertEquals(fm.getFocusedElement(), 'c');
});

// ── Grid layout ────────────────────────────────────────────────────────

Deno.test('focusInDirection grid - navigate right then down', () => {
  //  [A] [B]
  //  [C] [D]
  const fm = setup([
    { id: 'a', x: 0, y: 0, width: 5, height: 1 },
    { id: 'b', x: 10, y: 0, width: 5, height: 1 },
    { id: 'c', x: 0, y: 2, width: 5, height: 1 },
    { id: 'd', x: 10, y: 2, width: 5, height: 1 },
  ]);
  fm.focus('a');

  assertEquals(fm.focusInDirection('right'), true);
  assertEquals(fm.getFocusedElement(), 'b');

  assertEquals(fm.focusInDirection('down'), true);
  assertEquals(fm.getFocusedElement(), 'd');

  assertEquals(fm.focusInDirection('left'), true);
  assertEquals(fm.getFocusedElement(), 'c');

  assertEquals(fm.focusInDirection('up'), true);
  assertEquals(fm.getFocusedElement(), 'a');
});

// ── No focus set ───────────────────────────────────────────────────────

Deno.test('focusInDirection returns false when nothing focused', () => {
  const fm = setup([
    { id: 'a', x: 0, y: 0, width: 5, height: 1 },
  ]);
  // Don't focus anything
  assertEquals(fm.focusInDirection('right'), false);
});

// ── Element without bounds ─────────────────────────────────────────────

Deno.test('focusInDirection skips elements with no bounds', () => {
  const children = [
    createElement('button', { id: 'a', label: 'A' }),
    createElement('button', { id: 'b', label: 'B' }),
    createElement('button', { id: 'c', label: 'C' }),
  ];
  const root = new ContainerElement({ id: 'root' }, children);
  const doc = new Document(root);

  const boundsMap = new Map<string, { x: number; y: number; width: number; height: number }>();
  boundsMap.set('a', { x: 0, y: 0, width: 5, height: 1 });
  // 'b' has no bounds (e.g., in inactive tab)
  boundsMap.set('c', { x: 20, y: 0, width: 5, height: 1 });

  const em = new EventManager();
  const fm = new FocusManager(em, doc);
  fm.setBoundsProvider(id => boundsMap.get(id));
  fm.registerFocusableElement('a');
  fm.registerFocusableElement('b');
  fm.registerFocusableElement('c');
  fm.focus('a');

  assertEquals(fm.focusInDirection('right'), true);
  assertEquals(fm.getFocusedElement(), 'c');
});

// ── Weighted scoring: closer on main axis wins ─────────────────────────

Deno.test('focusInDirection right - closer element wins among non-aligned', () => {
  //  [A]
  //         [B] (closer right, slightly below)
  //                [C] (farther right, slightly below)
  const fm = setup([
    { id: 'a', x: 0, y: 0, width: 5, height: 1 },
    { id: 'b', x: 8, y: 2, width: 5, height: 1 },
    { id: 'c', x: 20, y: 2, width: 5, height: 1 },
  ]);
  fm.focus('a');
  assertEquals(fm.focusInDirection('right'), true);
  assertEquals(fm.getFocusedElement(), 'b');
});

// ── Enclosing element skip ─────────────────────────────────────────────

Deno.test('focusInDirection right - skips element that fully encloses current', () => {
  //  ┌─────────────── container ───────────────┐
  //  │  [A]     [B]     [C]                    │
  //  └─────────────────────────────────────────┘
  // Navigating right from A should go to B, not the enclosing container
  const fm = setup([
    { id: 'a', x: 2, y: 2, width: 5, height: 1 },
    { id: 'b', x: 12, y: 2, width: 5, height: 1 },
    { id: 'c', x: 22, y: 2, width: 5, height: 1 },
    { id: 'container', x: 0, y: 0, width: 40, height: 5 },
  ]);
  fm.focus('a');
  assertEquals(fm.focusInDirection('right'), true);
  assertEquals(fm.getFocusedElement(), 'b');
});

Deno.test('focusInDirection down - skips element that fully encloses current', () => {
  //  ┌──── container ────┐
  //  │  [A]              │
  //  │  [B]              │
  //  └───────────────────┘
  const fm = setup([
    { id: 'a', x: 2, y: 1, width: 5, height: 1 },
    { id: 'b', x: 2, y: 3, width: 5, height: 1 },
    { id: 'container', x: 0, y: 0, width: 20, height: 6 },
  ]);
  fm.focus('a');
  assertEquals(fm.focusInDirection('down'), true);
  assertEquals(fm.getFocusedElement(), 'b');
});

Deno.test('focusInDirection - does NOT skip partially overlapping element', () => {
  //  [A]  [B (partial overlap)]
  const fm = setup([
    { id: 'a', x: 0, y: 0, width: 5, height: 3 },
    { id: 'b', x: 3, y: 1, width: 10, height: 1 },
  ]);
  fm.focus('a');
  assertEquals(fm.focusInDirection('right'), true);
  assertEquals(fm.getFocusedElement(), 'b');
});

Deno.test('focusInDirection - can navigate FROM enclosing element TO child', () => {
  //  Focus on container, press right to reach a child inside it
  //  ┌────── container ──────┐
  //  │            [B]        │
  //  └───────────────────────┘
  const fm = setup([
    { id: 'container', x: 0, y: 0, width: 40, height: 5 },
    { id: 'b', x: 25, y: 2, width: 5, height: 1 },
  ]);
  fm.focus('container');
  assertEquals(fm.focusInDirection('right'), true);
  assertEquals(fm.getFocusedElement(), 'b');
});

// ── Overlapping ranges ─────────────────────────────────────────────────

Deno.test('focusInDirection right with overlapping Y ranges counts as aligned', () => {
  //  [A (h=3)]  [B (h=3, overlapping Y)]
  const fm = setup([
    { id: 'a', x: 0, y: 0, width: 5, height: 3 },
    { id: 'b', x: 10, y: 1, width: 5, height: 3 },
  ]);
  fm.focus('a');
  assertEquals(fm.focusInDirection('right'), true);
  assertEquals(fm.getFocusedElement(), 'b');
});
