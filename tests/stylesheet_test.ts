// Baseline tests for the stylesheet system: parsing, selector matching, style
// merging, and tree application. These must pass before any refactoring
// (e.g., media queries) to ensure no regressions.

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  createElement,
  parseSelector,
  parseStyleBlock,
  parseStyleProperties,
  selectorMatches,
  selectorStringMatches,
  Stylesheet,
  applyStylesheet,
  mediaConditionMatches,
  containerConditionMatches,
} from '../mod.ts';
import type { StyleContext, ContainerCondition } from '../mod.ts';

// ---------------------------------------------------------------------------
// Helper: create an element with classList already set (simulates class="...")
// ---------------------------------------------------------------------------
function el(
  type: string,
  opts: { id?: string; classes?: string[]; style?: Record<string, unknown> } = {},
  ...children: ReturnType<typeof createElement>[]
): ReturnType<typeof createElement> {
  const props: Record<string, unknown> = {};
  if (opts.id) props.id = opts.id;
  if (opts.classes) props.classList = opts.classes;
  if (opts.style) props.style = opts.style;
  return createElement(type, props, ...children);
}

// ===========================================================================
// 1. parseStyleProperties
// ===========================================================================

Deno.test('parseStyleProperties - numeric values', () => {
  const s = parseStyleProperties('width: 40; height: 10;');
  assertEquals(s.width, 40);
  assertEquals(s.height, 10);
});

Deno.test('parseStyleProperties - string values', () => {
  const s = parseStyleProperties('border: thin; display: flex;');
  assertEquals(s.border, 'thin');
  assertEquals(s.display, 'flex');
});

Deno.test('parseStyleProperties - kebab-case to camelCase', () => {
  const s = parseStyleProperties('flex-direction: row; font-weight: bold;');
  assertEquals(s.flexDirection, 'row');
  assertEquals(s.fontWeight, 'bold');
});

Deno.test('parseStyleProperties - boolean values', () => {
  const s = parseStyleProperties('visible: true; disabled: false;');
  assertEquals(s.visible, true);
  assertEquals(s.disabled, false);
});

Deno.test('parseStyleProperties - padding shorthand 2 values', () => {
  const s = parseStyleProperties('padding: 1 2;');
  assertEquals(s.padding, { top: 1, right: 2, bottom: 1, left: 2 });
});

Deno.test('parseStyleProperties - padding shorthand 4 values', () => {
  const s = parseStyleProperties('padding: 1 2 3 4;');
  assertEquals(s.padding, { top: 1, right: 2, bottom: 3, left: 4 });
});

Deno.test('parseStyleProperties - single numeric padding', () => {
  const s = parseStyleProperties('padding: 2;');
  assertEquals(s.padding, 2);
});

Deno.test('parseStyleProperties - empty string returns empty style', () => {
  const s = parseStyleProperties('');
  assertEquals(Object.keys(s).length, 0);
});

Deno.test('parseStyleProperties - malformed property (no colon) skipped', () => {
  const s = parseStyleProperties('width 40; height: 10;');
  assertEquals(s.width, undefined);
  assertEquals(s.height, 10);
});

Deno.test('parseStyleProperties - quoted string values', () => {
  const s = parseStyleProperties('text-wrap: "wrap"; overflow: "hidden";');
  assertEquals(s.textWrap, 'wrap');
  assertEquals(s.overflow, 'hidden');
});

Deno.test('parseStyleProperties - float values', () => {
  const s = parseStyleProperties('flex: 1.5; opacity: 0.8;');
  assertEquals(s.flex, 1.5);
  assertEquals(s.opacity, 0.8);
});

Deno.test('parseStyleProperties - individual padding overrides', () => {
  const s = parseStyleProperties('padding: 1; padding-left: 3;');
  assertEquals(s.padding, { top: 1, right: 1, bottom: 1, left: 3 });
});

// ===========================================================================
// 2. parseSelector
// ===========================================================================

Deno.test('parseSelector - type selector', () => {
  const sel = parseSelector('button');
  assertEquals(sel.segments.length, 1);
  assertEquals(sel.segments[0].compound.parts.length, 1);
  assertEquals(sel.segments[0].compound.parts[0], { type: 'type', value: 'button' });
  assertEquals(sel.segments[0].combinator, null);
});

Deno.test('parseSelector - class selector', () => {
  const sel = parseSelector('.primary');
  assertEquals(sel.segments.length, 1);
  assertEquals(sel.segments[0].compound.parts[0], { type: 'class', value: 'primary' });
});

Deno.test('parseSelector - id selector', () => {
  const sel = parseSelector('#header');
  assertEquals(sel.segments.length, 1);
  assertEquals(sel.segments[0].compound.parts[0], { type: 'id', value: 'header' });
});

Deno.test('parseSelector - universal selector', () => {
  const sel = parseSelector('*');
  assertEquals(sel.segments.length, 1);
  assertEquals(sel.segments[0].compound.parts[0], { type: 'universal', value: '*' });
});

Deno.test('parseSelector - compound type.class', () => {
  const sel = parseSelector('button.primary');
  assertEquals(sel.segments.length, 1);
  const parts = sel.segments[0].compound.parts;
  assertEquals(parts.length, 2);
  assertEquals(parts[0], { type: 'type', value: 'button' });
  assertEquals(parts[1], { type: 'class', value: 'primary' });
});

Deno.test('parseSelector - compound with multiple classes', () => {
  const sel = parseSelector('.card.active.highlighted');
  assertEquals(sel.segments.length, 1);
  const parts = sel.segments[0].compound.parts;
  assertEquals(parts.length, 3);
  assertEquals(parts[0], { type: 'class', value: 'card' });
  assertEquals(parts[1], { type: 'class', value: 'active' });
  assertEquals(parts[2], { type: 'class', value: 'highlighted' });
});

Deno.test('parseSelector - descendant combinator', () => {
  const sel = parseSelector('container text');
  assertEquals(sel.segments.length, 2);
  assertEquals(sel.segments[0].combinator, null);
  assertEquals(sel.segments[0].compound.parts[0], { type: 'type', value: 'container' });
  assertEquals(sel.segments[1].combinator, 'descendant');
  assertEquals(sel.segments[1].compound.parts[0], { type: 'type', value: 'text' });
});

Deno.test('parseSelector - child combinator', () => {
  const sel = parseSelector('container > text');
  assertEquals(sel.segments.length, 2);
  assertEquals(sel.segments[1].combinator, 'child');
});

Deno.test('parseSelector - mixed combinators', () => {
  const sel = parseSelector('container > .card text');
  assertEquals(sel.segments.length, 3);
  assertEquals(sel.segments[0].combinator, null);
  assertEquals(sel.segments[1].combinator, 'child');
  assertEquals(sel.segments[2].combinator, 'descendant');
});

Deno.test('parseSelector - empty string', () => {
  const sel = parseSelector('');
  assertEquals(sel.segments.length, 0);
});

// ===========================================================================
// 3. selectorMatches
// ===========================================================================

Deno.test('selectorMatches - type matches', () => {
  const btn = el('button');
  assert(selectorMatches(parseSelector('button'), btn));
});

Deno.test('selectorMatches - type does not match', () => {
  const txt = el('text');
  assert(!selectorMatches(parseSelector('button'), txt));
});

Deno.test('selectorMatches - class matches', () => {
  const e = el('container', { classes: ['primary'] });
  assert(selectorMatches(parseSelector('.primary'), e));
});

Deno.test('selectorMatches - class does not match', () => {
  const e = el('container', { classes: ['secondary'] });
  assert(!selectorMatches(parseSelector('.primary'), e));
});

Deno.test('selectorMatches - element without classes does not match class selector', () => {
  const e = el('container');
  assert(!selectorMatches(parseSelector('.primary'), e));
});

Deno.test('selectorMatches - id matches', () => {
  const e = el('container', { id: 'header' });
  assert(selectorMatches(parseSelector('#header'), e));
});

Deno.test('selectorMatches - id does not match', () => {
  const e = el('container', { id: 'footer' });
  assert(!selectorMatches(parseSelector('#header'), e));
});

Deno.test('selectorMatches - universal matches anything', () => {
  const e = el('text');
  assert(selectorMatches(parseSelector('*'), e));
});

Deno.test('selectorMatches - compound type.class both must match', () => {
  const e = el('button', { classes: ['primary'] });
  assert(selectorMatches(parseSelector('button.primary'), e));
});

Deno.test('selectorMatches - compound type.class fails on wrong type', () => {
  const e = el('text', { classes: ['primary'] });
  assert(!selectorMatches(parseSelector('button.primary'), e));
});

Deno.test('selectorMatches - compound type.class fails on missing class', () => {
  const e = el('button');
  assert(!selectorMatches(parseSelector('button.primary'), e));
});

Deno.test('selectorMatches - descendant combinator matches parent', () => {
  const child = el('text');
  const parent = el('container', {}, child);
  // ancestors array: nearest first
  assert(selectorMatches(parseSelector('container text'), child, [parent]));
});

Deno.test('selectorMatches - descendant combinator matches grandparent', () => {
  const child = el('text');
  const middle = el('container');
  const root = el('container', { classes: ['root'] });
  // ancestors: parent first, then grandparent
  assert(selectorMatches(parseSelector('.root text'), child, [middle, root]));
});

Deno.test('selectorMatches - descendant combinator fails when ancestor missing', () => {
  const child = el('text');
  const parent = el('container');
  assert(!selectorMatches(parseSelector('.sidebar text'), child, [parent]));
});

Deno.test('selectorMatches - child combinator matches direct parent', () => {
  const child = el('text');
  const parent = el('container');
  assert(selectorMatches(parseSelector('container > text'), child, [parent]));
});

Deno.test('selectorMatches - child combinator fails on grandparent', () => {
  const child = el('text');
  const middle = el('container');
  const root = el('container', { classes: ['root'] });
  // .root > text requires .root to be the direct parent, but middle is in the way
  assert(!selectorMatches(parseSelector('.root > text'), child, [middle, root]));
});

Deno.test('selectorMatches - three-segment descendant chain', () => {
  const leaf = el('text');
  const mid = el('container', { classes: ['card'] });
  const root = el('container', { classes: ['app'] });
  assert(selectorMatches(parseSelector('.app .card text'), leaf, [mid, root]));
});

Deno.test('selectorMatches - mixed child and descendant', () => {
  // .app > .card text — .card must be direct child of .app, text can be anywhere inside .card
  const leaf = el('text');
  const inner = el('container');
  const card = el('container', { classes: ['card'] });
  const app = el('container', { classes: ['app'] });
  // ancestors from leaf: inner, card, app
  assert(selectorMatches(parseSelector('.app > .card text'), leaf, [inner, card, app]));
});

Deno.test('selectorMatches - empty selector never matches', () => {
  const e = el('text');
  assert(!selectorMatches(parseSelector(''), e));
});

// ===========================================================================
// 4. selectorStringMatches (comma-separated)
// ===========================================================================

Deno.test('selectorStringMatches - comma-separated OR', () => {
  const btn = el('button');
  const txt = el('text');
  const inp = el('input');
  assert(selectorStringMatches('button, text', btn));
  assert(selectorStringMatches('button, text', txt));
  assert(!selectorStringMatches('button, text', inp));
});

// ===========================================================================
// 5. parseStyleBlock
// ===========================================================================

Deno.test('parseStyleBlock - single rule', () => {
  const { items } = parseStyleBlock('button { border: thin; }');
  assertEquals(items.length, 1);
  assertEquals(items[0].style.border, 'thin');
  assertEquals(items[0].selector.segments[0].compound.parts[0].value, 'button');
});

Deno.test('parseStyleBlock - multiple rules', () => {
  const { items } = parseStyleBlock(`
    .primary { border: thin; }
    #header { height: 3; }
    text { font-weight: bold; }
  `);
  assertEquals(items.length, 3);
  assertEquals(items[0].style.border, 'thin');
  assertEquals(items[1].style.height, 3);
  assertEquals(items[2].style.fontWeight, 'bold');
});

Deno.test('parseStyleBlock - empty input', () => {
  assertEquals(parseStyleBlock('').items.length, 0);
});

Deno.test('parseStyleBlock - block comments stripped', () => {
  const { items } = parseStyleBlock(`
    /* This is a comment */
    button { border: thin; }
    /* Another comment */
  `);
  assertEquals(items.length, 1);
  assertEquals(items[0].style.border, 'thin');
});

Deno.test('parseStyleBlock - single-line comments stripped', () => {
  const { items } = parseStyleBlock(`
    // This is a comment
    button { border: thin; }
  `);
  assertEquals(items.length, 1);
});

Deno.test('parseStyleBlock - rule with multiple properties', () => {
  const { items } = parseStyleBlock(`
    .card {
      width: 30;
      height: 10;
      border: single;
      padding: 1;
    }
  `);
  assertEquals(items.length, 1);
  assertEquals(items[0].style.width, 30);
  assertEquals(items[0].style.height, 10);
  assertEquals(items[0].style.border, 'single');
  assertEquals(items[0].style.padding, 1);
});

Deno.test('parseStyleBlock - descendant selector in rule', () => {
  const { items } = parseStyleBlock('container .card { border: thin; }');
  assertEquals(items.length, 1);
  assertEquals(items[0].selector.segments.length, 2);
  assertEquals(items[0].selector.segments[1].combinator, 'descendant');
});

Deno.test('parseStyleBlock - child selector in rule', () => {
  const { items } = parseStyleBlock('container > button { border: thin; }');
  assertEquals(items.length, 1);
  assertEquals(items[0].selector.segments.length, 2);
  assertEquals(items[0].selector.segments[1].combinator, 'child');
});

Deno.test('parseStyleBlock - empty rule body skipped', () => {
  const { items } = parseStyleBlock('button { }');
  assertEquals(items.length, 0);
});

// ===========================================================================
// 5b. parseStyleBlock — @media blocks (Phase 2: brace-balancing tokenizer)
// ===========================================================================

Deno.test('parseStyleBlock - @media basic nested rule', () => {
  const { items } = parseStyleBlock(`
    @media (max-width: 80) {
      .sidebar { width: 20; }
    }
  `);
  assertEquals(items.length, 1);
  assertEquals(items[0].style.width, 20);
  assert(items[0].mediaCondition !== undefined);
  assertEquals(items[0].mediaCondition!.maxWidth, 80);
});

Deno.test('parseStyleBlock - @media with min-width', () => {
  const { items } = parseStyleBlock(`
    @media (min-width: 100) {
      .sidebar { width: 30; }
    }
  `);
  assertEquals(items.length, 1);
  assertEquals(items[0].mediaCondition!.minWidth, 100);
});

Deno.test('parseStyleBlock - @media with height conditions', () => {
  const { items } = parseStyleBlock(`
    @media (min-height: 20) {
      .footer { height: 3; }
    }
    @media (max-height: 24) {
      .footer { height: 1; }
    }
  `);
  assertEquals(items.length, 2);
  assertEquals(items[0].mediaCondition!.minHeight, 20);
  assertEquals(items[1].mediaCondition!.maxHeight, 24);
});

Deno.test('parseStyleBlock - @media with multiple conditions (and)', () => {
  const { items } = parseStyleBlock(`
    @media (min-width: 60) and (max-width: 100) {
      .sidebar { width: 25; }
    }
  `);
  assertEquals(items.length, 1);
  assertEquals(items[0].mediaCondition!.minWidth, 60);
  assertEquals(items[0].mediaCondition!.maxWidth, 100);
});

Deno.test('parseStyleBlock - @media multiple rules inside one block', () => {
  const { items } = parseStyleBlock(`
    @media (max-width: 80) {
      .sidebar { width: 20; }
      .footer { height: 1; }
    }
  `);
  assertEquals(items.length, 2);
  assertEquals(items[0].style.width, 20);
  assertEquals(items[0].mediaCondition!.maxWidth, 80);
  assertEquals(items[1].style.height, 1);
  assertEquals(items[1].mediaCondition!.maxWidth, 80);
});

Deno.test('parseStyleBlock - mixed regular and @media rules', () => {
  const { items } = parseStyleBlock(`
    .sidebar { width: 30; border: thin; }
    @media (max-width: 80) {
      .sidebar { width: 20; }
    }
    .footer { height: 3; }
  `);
  assertEquals(items.length, 3);
  // Regular rule
  assertEquals(items[0].style.width, 30);
  assertEquals(items[0].mediaCondition, undefined);
  // Media rule
  assertEquals(items[1].style.width, 20);
  assertEquals(items[1].mediaCondition!.maxWidth, 80);
  // Regular rule
  assertEquals(items[2].style.height, 3);
  assertEquals(items[2].mediaCondition, undefined);
});

Deno.test('parseStyleBlock - @media empty block', () => {
  const { items } = parseStyleBlock(`
    @media (max-width: 80) { }
  `);
  assertEquals(items.length, 0);
});

Deno.test('parseStyleBlock - @media with empty rule body inside', () => {
  const { items } = parseStyleBlock(`
    @media (max-width: 80) {
      .sidebar { }
    }
  `);
  assertEquals(items.length, 0);
});

Deno.test('parseStyleBlock - @media preserves selector types', () => {
  const { items } = parseStyleBlock(`
    @media (max-width: 60) {
      container > .card text { font-weight: bold; }
    }
  `);
  assertEquals(items.length, 1);
  assertEquals(items[0].selector.segments.length, 3);
  assertEquals(items[0].selector.segments[1].combinator, 'child');
  assertEquals(items[0].selector.segments[2].combinator, 'descendant');
});

Deno.test('parseStyleBlock - multiple @media blocks', () => {
  const { items } = parseStyleBlock(`
    @media (max-width: 80) {
      .sidebar { width: 20; }
    }
    @media (max-width: 60) {
      .sidebar { display: none; }
    }
  `);
  assertEquals(items.length, 2);
  assertEquals(items[0].mediaCondition!.maxWidth, 80);
  assertEquals(items[0].style.width, 20);
  assertEquals(items[1].mediaCondition!.maxWidth, 60);
  assertEquals(items[1].style.display, 'none');
});

Deno.test('parseStyleBlock - @media with comments', () => {
  const { items } = parseStyleBlock(`
    /* hide sidebar on small terminals */
    @media (max-width: 60) {
      /* completely hide it */
      .sidebar { display: none; }
    }
  `);
  assertEquals(items.length, 1);
  assertEquals(items[0].style.display, 'none');
  assertEquals(items[0].mediaCondition!.maxWidth, 60);
});

Deno.test('parseStyleBlock - @media invalid condition skipped', () => {
  const { items } = parseStyleBlock(`
    @media (invalid-thing: 80) {
      .sidebar { width: 20; }
    }
    button { border: thin; }
  `);
  // Invalid @media rules are skipped, regular rules still parse
  assertEquals(items.length, 1);
  assertEquals(items[0].style.border, 'thin');
});

// ===========================================================================
// 5c. mediaConditionMatches + StyleContext (Phase 4: conditional evaluation)
// ===========================================================================

Deno.test('mediaConditionMatches - min-width pass', () => {
  assert(mediaConditionMatches({ minWidth: 80 }, { terminalWidth: 100, terminalHeight: 24 }));
});

Deno.test('mediaConditionMatches - min-width fail', () => {
  assert(!mediaConditionMatches({ minWidth: 80 }, { terminalWidth: 60, terminalHeight: 24 }));
});

Deno.test('mediaConditionMatches - min-width exact boundary passes', () => {
  assert(mediaConditionMatches({ minWidth: 80 }, { terminalWidth: 80, terminalHeight: 24 }));
});

Deno.test('mediaConditionMatches - max-width pass', () => {
  assert(mediaConditionMatches({ maxWidth: 80 }, { terminalWidth: 60, terminalHeight: 24 }));
});

Deno.test('mediaConditionMatches - max-width fail', () => {
  assert(!mediaConditionMatches({ maxWidth: 80 }, { terminalWidth: 100, terminalHeight: 24 }));
});

Deno.test('mediaConditionMatches - max-width exact boundary passes', () => {
  assert(mediaConditionMatches({ maxWidth: 80 }, { terminalWidth: 80, terminalHeight: 24 }));
});

Deno.test('mediaConditionMatches - min-height / max-height', () => {
  const ctx: StyleContext = { terminalWidth: 80, terminalHeight: 24 };
  assert(mediaConditionMatches({ minHeight: 20 }, ctx));
  assert(!mediaConditionMatches({ minHeight: 30 }, ctx));
  assert(mediaConditionMatches({ maxHeight: 30 }, ctx));
  assert(!mediaConditionMatches({ maxHeight: 20 }, ctx));
  assert(mediaConditionMatches({ maxHeight: 24 }, ctx));  // exact boundary
  assert(mediaConditionMatches({ minHeight: 24 }, ctx));  // exact boundary
});

Deno.test('mediaConditionMatches - combined min and max width', () => {
  const cond = { minWidth: 60, maxWidth: 100 };
  assert(mediaConditionMatches(cond, { terminalWidth: 80, terminalHeight: 24 }));
  assert(!mediaConditionMatches(cond, { terminalWidth: 50, terminalHeight: 24 }));
  assert(!mediaConditionMatches(cond, { terminalWidth: 110, terminalHeight: 24 }));
  assert(mediaConditionMatches(cond, { terminalWidth: 60, terminalHeight: 24 }));
  assert(mediaConditionMatches(cond, { terminalWidth: 100, terminalHeight: 24 }));
});

Deno.test('mediaConditionMatches - combined width and height', () => {
  const cond = { minWidth: 80, maxHeight: 30 };
  assert(mediaConditionMatches(cond, { terminalWidth: 100, terminalHeight: 24 }));
  assert(!mediaConditionMatches(cond, { terminalWidth: 60, terminalHeight: 24 }));   // width too small
  assert(!mediaConditionMatches(cond, { terminalWidth: 100, terminalHeight: 40 }));  // height too big
});

Deno.test('mediaConditionMatches - empty condition always matches', () => {
  assert(mediaConditionMatches({}, { terminalWidth: 80, terminalHeight: 24 }));
});

Deno.test('mediaConditionMatches - orientation portrait', () => {
  // Portrait: height > width
  assert(mediaConditionMatches({ orientation: 'portrait' }, { terminalWidth: 60, terminalHeight: 80 }));
  assert(!mediaConditionMatches({ orientation: 'portrait' }, { terminalWidth: 120, terminalHeight: 40 }));
});

Deno.test('mediaConditionMatches - orientation landscape', () => {
  // Landscape: width >= height
  assert(mediaConditionMatches({ orientation: 'landscape' }, { terminalWidth: 120, terminalHeight: 40 }));
  assert(!mediaConditionMatches({ orientation: 'landscape' }, { terminalWidth: 40, terminalHeight: 80 }));
});

Deno.test('mediaConditionMatches - square terminal is landscape', () => {
  // Equal dimensions: not portrait (height not > width), so landscape matches
  assert(mediaConditionMatches({ orientation: 'landscape' }, { terminalWidth: 50, terminalHeight: 50 }));
  assert(!mediaConditionMatches({ orientation: 'portrait' }, { terminalWidth: 50, terminalHeight: 50 }));
});

Deno.test('mediaConditionMatches - min-aspect-ratio', () => {
  // 120/40 = 3.0, min 16/9 ≈ 1.78 → pass
  assert(mediaConditionMatches({ minAspectRatio: 16 / 9 }, { terminalWidth: 120, terminalHeight: 40 }));
  // 80/40 = 2.0, min 16/9 ≈ 1.78 → pass
  assert(mediaConditionMatches({ minAspectRatio: 16 / 9 }, { terminalWidth: 80, terminalHeight: 40 }));
  // 60/40 = 1.5, min 16/9 ≈ 1.78 → fail
  assert(!mediaConditionMatches({ minAspectRatio: 16 / 9 }, { terminalWidth: 60, terminalHeight: 40 }));
});

Deno.test('mediaConditionMatches - max-aspect-ratio', () => {
  // 80/40 = 2.0, max 4/3 ≈ 1.33 → fail
  assert(!mediaConditionMatches({ maxAspectRatio: 4 / 3 }, { terminalWidth: 80, terminalHeight: 40 }));
  // 40/40 = 1.0, max 4/3 ≈ 1.33 → pass
  assert(mediaConditionMatches({ maxAspectRatio: 4 / 3 }, { terminalWidth: 40, terminalHeight: 40 }));
});

Deno.test('mediaConditionMatches - orientation combined with dimensions', () => {
  const cond = { orientation: 'landscape' as const, minWidth: 80 };
  assert(mediaConditionMatches(cond, { terminalWidth: 120, terminalHeight: 40 }));
  assert(!mediaConditionMatches(cond, { terminalWidth: 60, terminalHeight: 40 }));   // width too small
  assert(!mediaConditionMatches(cond, { terminalWidth: 120, terminalHeight: 200 })); // portrait
});

Deno.test('parseStyleBlock - @media orientation', () => {
  const { items } = parseStyleBlock(`
    @media (orientation: portrait) {
      .sidebar { display: none; }
    }
  `);
  assertEquals(items.length, 1);
  assertEquals(items[0].mediaCondition?.orientation, 'portrait');
});

Deno.test('parseStyleBlock - @media aspect-ratio', () => {
  const { items } = parseStyleBlock(`
    @media (min-aspect-ratio: 16/9) {
      .wide { width: fill; }
    }
    @media (max-aspect-ratio: 4/3) {
      .narrow { display: none; }
    }
  `);
  assertEquals(items.length, 2);
  assert(Math.abs(items[0].mediaCondition!.minAspectRatio! - 16 / 9) < 0.001);
  assert(Math.abs(items[1].mediaCondition!.maxAspectRatio! - 4 / 3) < 0.001);
});

Deno.test('parseStyleBlock - @media orientation and dimensions combined', () => {
  const { items } = parseStyleBlock(`
    @media (orientation: landscape) and (min-width: 100) {
      .wide { width: fill; }
    }
  `);
  assertEquals(items.length, 1);
  assertEquals(items[0].mediaCondition?.orientation, 'landscape');
  assertEquals(items[0].mediaCondition?.minWidth, 100);
});

Deno.test('getMergedStyle - filters by StyleContext', () => {
  const ss = Stylesheet.fromString(`
    .sidebar { width: 30; }
    @media (max-width: 60) {
      .sidebar { display: none; }
    }
  `);
  const sidebar = el('container', { classes: ['sidebar'] });

  // Wide terminal — media rule should NOT match
  const wide = ss.getMergedStyle(sidebar, [], { terminalWidth: 100, terminalHeight: 24 });
  assertEquals(wide.width, 30);
  assertEquals(wide.display, undefined);

  // Narrow terminal — media rule should match
  const narrow = ss.getMergedStyle(sidebar, [], { terminalWidth: 50, terminalHeight: 24 });
  assertEquals(narrow.width, 30);
  assertEquals(narrow.display, 'none');
});

Deno.test('getMergedStyle - without StyleContext ignores media rules', () => {
  const ss = Stylesheet.fromString(`
    .sidebar { width: 30; }
    @media (max-width: 60) {
      .sidebar { display: none; }
    }
  `);
  const sidebar = el('container', { classes: ['sidebar'] });
  // No context — media rules excluded
  const merged = ss.getMergedStyle(sidebar);
  assertEquals(merged.width, 30);
  assertEquals(merged.display, undefined);
});

Deno.test('getMergedStyle - media rule overrides regular rule (later wins)', () => {
  const ss = Stylesheet.fromString(`
    .sidebar { width: 30; }
    @media (max-width: 80) {
      .sidebar { width: 20; }
    }
  `);
  const sidebar = el('container', { classes: ['sidebar'] });
  const ctx: StyleContext = { terminalWidth: 60, terminalHeight: 24 };
  const merged = ss.getMergedStyle(sidebar, [], ctx);
  assertEquals(merged.width, 20);  // media rule is later, overrides
});

Deno.test('applyStylesheet - with StyleContext applies media rules', () => {
  const ss = Stylesheet.fromString(`
    .sidebar { width: 30; border: thin; }
    @media (max-width: 60) {
      .sidebar { display: none; }
    }
  `);
  const sidebar = el('container', { classes: ['sidebar'] });
  const root = el('container', {}, sidebar);

  const ctx: StyleContext = { terminalWidth: 50, terminalHeight: 24 };
  applyStylesheet(root, ss, [], ctx);
  assertEquals(sidebar.props.style.width, 30);
  assertEquals(sidebar.props.style.border, 'thin');
  assertEquals(sidebar.props.style.display, 'none');
});

Deno.test('applyStylesheet - re-apply with changed StyleContext', () => {
  const ss = Stylesheet.fromString(`
    .sidebar { width: 30; }
    @media (max-width: 60) {
      .sidebar { display: none; }
    }
  `);
  const sidebar = el('container', { classes: ['sidebar'], style: { border: 'single' as any } });

  // First apply: wide terminal
  applyStylesheet(sidebar, ss, [], { terminalWidth: 100, terminalHeight: 24 });
  assertEquals(sidebar.props.style.width, 30);
  assertEquals(sidebar.props.style.border, 'single');
  assertEquals(sidebar.props.style.display, undefined);

  // Re-apply: narrow terminal — media rule activates
  applyStylesheet(sidebar, ss, [], { terminalWidth: 50, terminalHeight: 24 });
  assertEquals(sidebar.props.style.width, 30);
  assertEquals(sidebar.props.style.border, 'single');  // inline preserved
  assertEquals(sidebar.props.style.display, 'none');    // media rule applied

  // Re-apply: wide again — media rule deactivates
  applyStylesheet(sidebar, ss, [], { terminalWidth: 100, terminalHeight: 24 });
  assertEquals(sidebar.props.style.width, 30);
  assertEquals(sidebar.props.style.border, 'single');   // inline preserved
  assertEquals(sidebar.props.style.display, undefined);  // media property gone
});

Deno.test('applyStylesheet - inline beats media rule', () => {
  const ss = Stylesheet.fromString(`
    @media (max-width: 60) {
      .sidebar { display: none; }
    }
  `);
  const sidebar = el('container', { classes: ['sidebar'], style: { display: 'flex' as any } });
  applyStylesheet(sidebar, ss, [], { terminalWidth: 50, terminalHeight: 24 });
  assertEquals(sidebar.props.style.display, 'flex');  // inline wins over media rule
});

Deno.test('Stylesheet.hasMediaRules - false for no media rules', () => {
  const ss = Stylesheet.fromString('.sidebar { width: 30; }');
  assertEquals(ss.hasMediaRules, false);
});

Deno.test('Stylesheet.hasMediaRules - true when media rules exist', () => {
  const ss = Stylesheet.fromString(`
    .sidebar { width: 30; }
    @media (max-width: 60) {
      .sidebar { display: none; }
    }
  `);
  assertEquals(ss.hasMediaRules, true);
});

// ===========================================================================
// 6. Stylesheet class
// ===========================================================================

Deno.test('Stylesheet.fromString creates stylesheet', () => {
  const ss = Stylesheet.fromString('button { border: thin; } text { font-weight: bold; }');
  assertEquals(ss.length, 2);
});

Deno.test('Stylesheet.addRule adds a rule', () => {
  const ss = new Stylesheet();
  ss.addRule('.card', { border: 'single' as any, width: 20 });
  assertEquals(ss.length, 1);
});

Deno.test('Stylesheet.getMergedStyle returns matching styles', () => {
  const ss = Stylesheet.fromString(`
    button { border: thin; }
    .primary { width: 20; }
  `);
  const btn = el('button', { classes: ['primary'] });
  const merged = ss.getMergedStyle(btn);
  assertEquals(merged.border, 'thin');
  assertEquals(merged.width, 20);
});

Deno.test('Stylesheet.getMergedStyle - later rules override earlier', () => {
  const ss = Stylesheet.fromString(`
    button { width: 10; }
    button { width: 20; }
  `);
  const btn = el('button');
  assertEquals(ss.getMergedStyle(btn).width, 20);
});

Deno.test('Stylesheet.getMergedStyle - non-matching rules excluded', () => {
  const ss = Stylesheet.fromString(`
    button { border: thin; }
    text { font-weight: bold; }
  `);
  const btn = el('button');
  const merged = ss.getMergedStyle(btn);
  assertEquals(merged.border, 'thin');
  assertEquals(merged.fontWeight, undefined);
});

Deno.test('Stylesheet.getMergedStyle with ancestors', () => {
  const ss = Stylesheet.fromString('container text { font-weight: bold; }');
  const txt = el('text');
  const parent = el('container', {}, txt);
  const merged = ss.getMergedStyle(txt, [parent]);
  assertEquals(merged.fontWeight, 'bold');
});

Deno.test('Stylesheet.getMatchingStyles returns array', () => {
  const ss = Stylesheet.fromString(`
    .a { width: 10; }
    .b { height: 20; }
  `);
  const e = el('container', { classes: ['a', 'b'] });
  const styles = ss.getMatchingStyles(e);
  assertEquals(styles.length, 2);
  assertEquals(styles[0].width, 10);
  assertEquals(styles[1].height, 20);
});

Deno.test('Stylesheet.clear removes all rules', () => {
  const ss = Stylesheet.fromString('button { border: thin; }');
  assertEquals(ss.length, 1);
  ss.clear();
  assertEquals(ss.length, 0);
});

Deno.test('Stylesheet.addFromString appends rules', () => {
  const ss = Stylesheet.fromString('button { border: thin; }');
  ss.addFromString('text { font-weight: bold; }');
  assertEquals(ss.length, 2);
});

// ===========================================================================
// 7. applyStylesheet — tree application
// ===========================================================================

Deno.test('applyStylesheet - applies matching rule to element', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  const btn = el('button');
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style.width, 20);
});

Deno.test('applyStylesheet - inline style takes priority', () => {
  const ss = Stylesheet.fromString('button { width: 20; height: 10; }');
  const btn = el('button', { style: { width: 50 } });
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style.width, 50);  // inline wins
  assertEquals(btn.props.style.height, 10); // from stylesheet
});

Deno.test('applyStylesheet - applies recursively to children', () => {
  const ss = Stylesheet.fromString('text { font-weight: bold; }');
  const txt = el('text');
  const root = el('container', {}, txt);
  applyStylesheet(root, ss);
  assertEquals(txt.props.style.fontWeight, 'bold');
});

Deno.test('applyStylesheet - descendant selector works in tree', () => {
  const ss = Stylesheet.fromString('.app text { font-weight: bold; }');
  const txt = el('text');
  const root = el('container', { classes: ['app'] }, txt);
  applyStylesheet(root, ss);
  assertEquals(txt.props.style.fontWeight, 'bold');
});

Deno.test('applyStylesheet - descendant selector skips non-matching subtree', () => {
  const ss = Stylesheet.fromString('.sidebar text { font-weight: bold; }');
  const txt = el('text');
  const root = el('container', { classes: ['main'] }, txt);
  applyStylesheet(root, ss);
  assertEquals(txt.props.style?.fontWeight, undefined);
});

Deno.test('applyStylesheet - child combinator in tree', () => {
  const ss = Stylesheet.fromString('.app > button { width: 30; }');
  const btn = el('button');
  const root = el('container', { classes: ['app'] }, btn);
  applyStylesheet(root, ss);
  assertEquals(btn.props.style.width, 30);
});

Deno.test('applyStylesheet - child combinator does not match grandchild', () => {
  const ss = Stylesheet.fromString('.app > button { width: 30; }');
  const btn = el('button');
  const mid = el('container', {}, btn);
  const root = el('container', { classes: ['app'] }, mid);
  applyStylesheet(root, ss);
  assertEquals(btn.props.style?.width, undefined);
});

Deno.test('applyStylesheet - multiple rules apply to same element', () => {
  const ss = Stylesheet.fromString(`
    button { height: 3; }
    .primary { width: 20; }
  `);
  const btn = el('button', { classes: ['primary'] });
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style.height, 3);
  assertEquals(btn.props.style.width, 20);
});

Deno.test('applyStylesheet - does not affect non-matching elements', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  const txt = el('text');
  const btn = el('button');
  const root = el('container', {}, txt, btn);
  applyStylesheet(root, ss);
  assertEquals(txt.props.style?.width, undefined);
  assertEquals(btn.props.style.width, 20);
});

Deno.test('applyStylesheet - deeply nested descendant', () => {
  const ss = Stylesheet.fromString('.root text { font-weight: bold; }');
  const txt = el('text');
  const c3 = el('container', {}, txt);
  const c2 = el('container', {}, c3);
  const c1 = el('container', {}, c2);
  const root = el('container', { classes: ['root'] }, c1);
  applyStylesheet(root, ss);
  assertEquals(txt.props.style.fontWeight, 'bold');
});

Deno.test('applyStylesheet - Stylesheet.applyTo convenience method', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  const btn = el('button');
  ss.applyTo(btn);
  assertEquals(btn.props.style.width, 20);
});

// ===========================================================================
// 8. Edge cases and combined scenarios
// ===========================================================================

Deno.test('universal selector matches all elements in tree', () => {
  const ss = Stylesheet.fromString('* { padding: 1; }');
  const txt = el('text');
  const btn = el('button');
  const root = el('container', {}, txt, btn);
  applyStylesheet(root, ss);
  assertEquals(root.props.style.padding, 1);
  assertEquals(txt.props.style.padding, 1);
  assertEquals(btn.props.style.padding, 1);
});

Deno.test('id selector is more specific than type selector', () => {
  const ss = Stylesheet.fromString(`
    button { width: 10; }
    #myBtn { width: 20; }
  `);
  const btn = el('button', { id: 'myBtn' });
  const merged = ss.getMergedStyle(btn);
  assertEquals(merged.width, 20);
});

Deno.test('compound selector .class1.class2 requires both classes', () => {
  const ss = Stylesheet.fromString('.card.active { border: thin; }');
  const both = el('container', { classes: ['card', 'active'] });
  const one = el('container', { classes: ['card'] });
  const neither = el('container');
  assertEquals(ss.getMergedStyle(both).border, 'thin');
  assertEquals(ss.getMergedStyle(one).border, undefined);
  assertEquals(ss.getMergedStyle(neither).border, undefined);
});

// ===========================================================================
// 9. Style origin tracking (_inlineStyle / _computedStyle)
// ===========================================================================

Deno.test('applyStylesheet - captures _inlineStyle on first apply', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  const btn = el('button', { style: { border: 'single' as any } });
  applyStylesheet(btn, ss);
  assertEquals((btn as any)._inlineStyle, { border: 'single' });
});

Deno.test('applyStylesheet - _inlineStyle is empty when no inline style', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  const btn = el('button');
  applyStylesheet(btn, ss);
  assertEquals((btn as any)._inlineStyle, {});
});

Deno.test('applyStylesheet - _computedStyle matches props.style after apply', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  const btn = el('button', { style: { border: 'single' as any } });
  applyStylesheet(btn, ss);
  assertEquals((btn as any)._computedStyle, btn.props.style);
  // Should be a copy, not the same reference
  assert((btn as any)._computedStyle !== btn.props.style);
});

Deno.test('applyStylesheet - re-apply preserves inline styles', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  const btn = el('button', { style: { border: 'single' as any } });
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style.border, 'single');
  assertEquals(btn.props.style.width, 20);

  // Re-apply same stylesheet
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style.border, 'single');  // inline preserved
  assertEquals(btn.props.style.width, 20);          // stylesheet re-applied
});

Deno.test('applyStylesheet - re-apply with empty stylesheet clears stylesheet properties', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  const btn = el('button', { style: { border: 'single' as any } });
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style.width, 20);
  assertEquals(btn.props.style.border, 'single');

  // Re-apply with empty stylesheet (simulates media query deactivation)
  const empty = new Stylesheet();
  applyStylesheet(btn, empty);
  assertEquals(btn.props.style.border, 'single');   // inline preserved
  assertEquals(btn.props.style.width, undefined);    // stylesheet property gone
});

Deno.test('applyStylesheet - inline always beats stylesheet on re-apply', () => {
  const ss = Stylesheet.fromString('button { width: 20; border: thin; }');
  const btn = el('button', { style: { width: 50 } });
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style.width, 50);    // inline wins
  assertEquals(btn.props.style.border, 'thin');

  // Re-apply
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style.width, 50);    // still inline
  assertEquals(btn.props.style.border, 'thin');
});

Deno.test('applyStylesheet - detects script change (spread pattern) on re-apply', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  const btn = el('button', { style: { border: 'single' as any } });
  applyStylesheet(btn, ss);

  // Simulate script: element.props.style = { ...element.props.style, color: 'red' }
  btn.props.style = { ...btn.props.style, color: 'red' };

  // Re-apply — script change should be preserved
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style.border, 'single');  // original inline
  assertEquals(btn.props.style.color, 'red');       // script addition
  assertEquals(btn.props.style.width, 20);          // stylesheet
});

Deno.test('applyStylesheet - detects script replacement (no spread) on re-apply', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  const btn = el('button', { style: { border: 'single' as any } });
  applyStylesheet(btn, ss);

  // Script replaces entire style (no spread)
  btn.props.style = { color: 'red' };

  // Re-apply — only script's style survives as inline
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style.color, 'red');        // script set this
  assertEquals(btn.props.style.width, 20);           // stylesheet re-applied
  assertEquals(btn.props.style.border, undefined);   // was inline, script removed it
});

Deno.test('applyStylesheet - script override of stylesheet property persists', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  const btn = el('button');
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style.width, 20);

  // Script overrides stylesheet property
  btn.props.style = { ...btn.props.style, width: 50 };

  // Re-apply — script override should persist (becomes inline)
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style.width, 50);  // script override wins
  assertEquals((btn as any)._inlineStyle.width, 50);
});

Deno.test('applyStylesheet - multiple re-applies maintain correct state', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  const btn = el('button', { style: { border: 'single' as any } });

  // Apply 1
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style, { width: 20, border: 'single' });

  // Apply 2 (no changes between)
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style, { width: 20, border: 'single' });

  // Script change
  btn.props.style = { ...btn.props.style, color: 'red' };

  // Apply 3
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style, { width: 20, border: 'single', color: 'red' });

  // Apply 4 (no changes between)
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style, { width: 20, border: 'single', color: 'red' });
});

Deno.test('applyStylesheet - element with no matching rules preserves inline', () => {
  const ss = Stylesheet.fromString('text { font-weight: bold; }');
  const btn = el('button', { style: { border: 'single' as any } });
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style.border, 'single');
  assertEquals((btn as any)._inlineStyle, { border: 'single' });

  // Re-apply
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style.border, 'single');
});

Deno.test('applyStylesheet - deep tree re-apply with origin tracking', () => {
  const ss = Stylesheet.fromString(`
    .sidebar { width: 30; }
    .sidebar button { height: 3; }
  `);
  const btn = el('button', { style: { border: 'thin' as any } });
  const sidebar = el('container', { classes: ['sidebar'] }, btn);
  const root = el('container', {}, sidebar);

  // First apply
  applyStylesheet(root, ss);
  assertEquals(sidebar.props.style.width, 30);
  assertEquals(btn.props.style.height, 3);
  assertEquals(btn.props.style.border, 'thin');

  // Script changes button
  btn.props.style = { ...btn.props.style, color: 'red' };

  // Re-apply
  applyStylesheet(root, ss);
  assertEquals(sidebar.props.style.width, 30);       // stylesheet
  assertEquals(btn.props.style.height, 3);            // stylesheet
  assertEquals(btn.props.style.border, 'thin');       // original inline
  assertEquals(btn.props.style.color, 'red');         // script addition
});

Deno.test('applyStylesheet - re-apply with changed stylesheet rules', () => {
  const ss1 = Stylesheet.fromString('button { width: 20; height: 3; }');
  const btn = el('button', { style: { border: 'single' as any } });
  applyStylesheet(btn, ss1);
  assertEquals(btn.props.style, { width: 20, height: 3, border: 'single' });

  // Re-apply with different stylesheet (simulates different media rules matching)
  const ss2 = Stylesheet.fromString('button { width: 10; }');
  applyStylesheet(btn, ss2);
  assertEquals(btn.props.style.width, 10);            // new stylesheet value
  assertEquals(btn.props.style.height, undefined);    // no longer in stylesheet
  assertEquals(btn.props.style.border, 'single');     // inline preserved
});

Deno.test('applyStylesheet - Stylesheet.applyTo preserves origin tracking', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  const btn = el('button', { style: { border: 'single' as any } });
  ss.applyTo(btn);
  assertEquals((btn as any)._inlineStyle, { border: 'single' });
  assertEquals(btn.props.style.width, 20);
  assertEquals(btn.props.style.border, 'single');
});

Deno.test('applyStylesheet - script removes inline property', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  const btn = el('button', { style: { border: 'single' as any, height: 5 } });
  applyStylesheet(btn, ss);
  assertEquals((btn as any)._inlineStyle, { border: 'single', height: 5 });

  // Script removes height by not including it
  btn.props.style = { width: btn.props.style.width, border: btn.props.style.border };

  // Re-apply
  applyStylesheet(btn, ss);
  assertEquals(btn.props.style.height, undefined);    // script removed it
  assertEquals(btn.props.style.border, 'single');     // kept
  assertEquals(btn.props.style.width, 20);            // stylesheet
  assertEquals((btn as any)._inlineStyle.height, undefined);  // removed from inline
});

// ===========================================================================
// 10. Edge cases and combined scenarios
// ===========================================================================

Deno.test('real-world dashboard layout', () => {
  const ss = Stylesheet.fromString(`
    .sidebar { width: 30; border: thin; }
    .sidebar button { height: 3; }
    .main { flex: 1; }
    .main > .header { height: 3; font-weight: bold; }
  `);

  const sidebarBtn = el('button');
  const sidebar = el('container', { classes: ['sidebar'] }, sidebarBtn);

  const header = el('container', { classes: ['header'] });
  const body = el('container');
  const main = el('container', { classes: ['main'] }, header, body);

  const root = el('container', {}, sidebar, main);

  applyStylesheet(root, ss);

  // sidebar
  assertEquals(sidebar.props.style.width, 30);
  assertEquals(sidebar.props.style.border, 'thin');
  // sidebar button (descendant)
  assertEquals(sidebarBtn.props.style.height, 3);
  // main
  assertEquals(main.props.style.flex, 1);
  // main > .header (child)
  assertEquals(header.props.style.height, 3);
  assertEquals(header.props.style.fontWeight, 'bold');
  // body should not match .header rule
  assertEquals(body.props.style?.fontWeight, undefined);
});

// ===========================================================================
// 12. CSS specificity
// ===========================================================================

Deno.test('specificity - class selector beats type selector regardless of order', () => {
  const ss = Stylesheet.fromString(`
    .primary { width: 20; }
    button { width: 10; }
  `);
  const btn = el('button', { classes: ['primary'] });
  assertEquals(ss.getMergedStyle(btn).width, 20);
});

Deno.test('specificity - type selector defined later loses to earlier class', () => {
  // Class (1000) > type (1), even when type is defined after class
  const ss = Stylesheet.fromString(`
    .card { padding: 5; }
    container { padding: 0; }
  `);
  const c = el('container', { classes: ['card'] });
  assertEquals(ss.getMergedStyle(c).padding, 5);
});

Deno.test('specificity - id selector beats class selector regardless of order', () => {
  const ss = Stylesheet.fromString(`
    .highlight { height: 10; }
    #hero { height: 50; }
  `);
  const c = el('container', { id: 'hero', classes: ['highlight'] });
  assertEquals(ss.getMergedStyle(c).height, 50);
});

Deno.test('specificity - id selector beats class selector even when class defined later', () => {
  const ss = Stylesheet.fromString(`
    #hero { height: 50; }
    .highlight { height: 10; }
  `);
  const c = el('container', { id: 'hero', classes: ['highlight'] });
  assertEquals(ss.getMergedStyle(c).height, 50);
});

Deno.test('specificity - compound selector button.primary beats plain .primary', () => {
  // button.primary = type(1) + class(1000) = 1001, .primary = 1000
  const ss = Stylesheet.fromString(`
    .primary { width: 10; }
    button.primary { width: 20; }
  `);
  const btn = el('button', { classes: ['primary'] });
  assertEquals(ss.getMergedStyle(btn).width, 20);
});

Deno.test('specificity - compound selector button.primary beats .primary even when defined first', () => {
  const ss = Stylesheet.fromString(`
    button.primary { width: 20; }
    .primary { width: 10; }
  `);
  const btn = el('button', { classes: ['primary'] });
  assertEquals(ss.getMergedStyle(btn).width, 20);
});

Deno.test('specificity - equal specificity falls back to definition order (later wins)', () => {
  // Both are class selectors: specificity 1000 each
  const ss = Stylesheet.fromString(`
    .first { width: 10; }
    .second { width: 20; }
  `);
  const c = el('container', { classes: ['first', 'second'] });
  const merged = ss.getMergedStyle(c);
  // Both match — equal specificity, so .second wins (later definition)
  assertEquals(merged.width, 20);
});

Deno.test('specificity - equal specificity type selectors use definition order', () => {
  // Both type selectors match 'button': specificity 1 each
  const ss = Stylesheet.fromString(`
    button { gap: 2; }
    button { gap: 5; }
  `);
  const btn = el('button');
  assertEquals(ss.getMergedStyle(btn).gap, 5);
});

Deno.test('specificity - descendant selector accumulates from all segments', () => {
  // "container .card" = type(1) + class(1000) = 1001
  // ".wrapper text"   = class(1000) + type(1) = 1001
  // "#main text"      = id(1000000) + type(1) = 1000001
  const ss = Stylesheet.fromString(`
    container .card { width: 10; }
    #main .card { width: 30; }
  `);
  const card = el('container', { classes: ['card'] });
  const root = el('container', { id: 'main' }, card);
  // Both rules match card; #main .card has higher specificity
  assertEquals(ss.getMergedStyle(card, [root]).width, 30);
});

Deno.test('specificity - two-class selector beats single-class selector', () => {
  // .card.active = 2000, .card = 1000
  const ss = Stylesheet.fromString(`
    .card { width: 10; }
    .card.active { width: 20; }
  `);
  const c = el('container', { classes: ['card', 'active'] });
  assertEquals(ss.getMergedStyle(c).width, 20);
});

Deno.test('specificity - two-class beats single-class even when defined first', () => {
  const ss = Stylesheet.fromString(`
    .card.active { width: 20; }
    .card { width: 10; }
  `);
  const c = el('container', { classes: ['card', 'active'] });
  assertEquals(ss.getMergedStyle(c).width, 20);
});

Deno.test('specificity - id beats multiple classes', () => {
  // #box = 1000000, .a.b.c = 3000
  const ss = Stylesheet.fromString(`
    .a.b.c { width: 10; }
    #box { width: 50; }
  `);
  const c = el('container', { id: 'box', classes: ['a', 'b', 'c'] });
  assertEquals(ss.getMergedStyle(c).width, 50);
});

Deno.test('specificity - non-overlapping properties merge from all matching rules', () => {
  // Both match; different properties, both should appear
  const ss = Stylesheet.fromString(`
    button { width: 10; }
    .primary { height: 20; }
  `);
  const btn = el('button', { classes: ['primary'] });
  const merged = ss.getMergedStyle(btn);
  assertEquals(merged.width, 10);
  assertEquals(merged.height, 20);
});

Deno.test('specificity - works through applyStylesheet tree application', () => {
  const ss = Stylesheet.fromString(`
    text { padding: 0; }
    .important { padding: 5; }
    #hero-text { padding: 10; }
  `);
  const t1 = el('text');                                     // type only → padding 0
  const t2 = el('text', { classes: ['important'] });         // class wins → padding 5
  const t3 = el('text', { id: 'hero-text', classes: ['important'] }); // id wins → padding 10
  const root = el('container', {}, t1, t2, t3);
  applyStylesheet(root, ss);
  assertEquals(t1.props.style.padding, 0);
  assertEquals(t2.props.style.padding, 5);
  assertEquals(t3.props.style.padding, 10);
});

Deno.test('specificity - addRule respects specificity', () => {
  const ss = new Stylesheet();
  ss.addRule('.highlight', { width: 20 } as any);
  ss.addRule('button', { width: 10 } as any);
  const btn = el('button', { classes: ['highlight'] });
  assertEquals(ss.getMergedStyle(btn).width, 20);
});

Deno.test('specificity - universal selector has lowest specificity', () => {
  const ss = Stylesheet.fromString(`
    * { gap: 1; }
    button { gap: 5; }
  `);
  const btn = el('button');
  assertEquals(ss.getMergedStyle(btn).gap, 5);
});

Deno.test('specificity - universal selector loses to class even when defined later', () => {
  const ss = Stylesheet.fromString(`
    .card { padding: 5; }
    * { padding: 0; }
  `);
  const c = el('container', { classes: ['card'] });
  assertEquals(ss.getMergedStyle(c).padding, 5);
});

// ===========================================================================
// 13. Container queries (Phase 1: parsing & condition matching)
// ===========================================================================

Deno.test('containerConditionMatches - min-width matches', () => {
  const cond: ContainerCondition = { minWidth: 40 };
  assertEquals(containerConditionMatches(cond, { width: 40, height: 20 }), true);
  assertEquals(containerConditionMatches(cond, { width: 50, height: 20 }), true);
  assertEquals(containerConditionMatches(cond, { width: 39, height: 20 }), false);
});

Deno.test('containerConditionMatches - max-width matches', () => {
  const cond: ContainerCondition = { maxWidth: 60 };
  assertEquals(containerConditionMatches(cond, { width: 60, height: 20 }), true);
  assertEquals(containerConditionMatches(cond, { width: 30, height: 20 }), true);
  assertEquals(containerConditionMatches(cond, { width: 61, height: 20 }), false);
});

Deno.test('containerConditionMatches - min-height and max-height', () => {
  const cond: ContainerCondition = { minHeight: 10, maxHeight: 30 };
  assertEquals(containerConditionMatches(cond, { width: 50, height: 10 }), true);
  assertEquals(containerConditionMatches(cond, { width: 50, height: 20 }), true);
  assertEquals(containerConditionMatches(cond, { width: 50, height: 30 }), true);
  assertEquals(containerConditionMatches(cond, { width: 50, height: 9 }), false);
  assertEquals(containerConditionMatches(cond, { width: 50, height: 31 }), false);
});

Deno.test('containerConditionMatches - combined width and height (AND logic)', () => {
  const cond: ContainerCondition = { minWidth: 40, maxHeight: 20 };
  assertEquals(containerConditionMatches(cond, { width: 50, height: 15 }), true);
  assertEquals(containerConditionMatches(cond, { width: 30, height: 15 }), false);
  assertEquals(containerConditionMatches(cond, { width: 50, height: 25 }), false);
});

Deno.test('containerConditionMatches - empty condition always matches', () => {
  assertEquals(containerConditionMatches({}, { width: 50, height: 20 }), true);
});

Deno.test('parseStyleBlock - @container rules go to containerItems', () => {
  const { items, containerItems } = parseStyleBlock(`
    .card { width: 10; }
    @container (min-width: 40) {
      .item { flex-direction: row; }
    }
  `);
  assertEquals(items.length, 1);
  assertEquals(items[0].style.width, 10);
  assertEquals(containerItems.length, 1);
  assertEquals(containerItems[0].style.flexDirection, 'row');
  assert(containerItems[0].containerCondition !== undefined);
  assertEquals(containerItems[0].containerCondition!.minWidth, 40);
});

Deno.test('parseStyleBlock - @container with multiple rules', () => {
  const { containerItems } = parseStyleBlock(`
    @container (max-width: 30) {
      .nav-item { flex-direction: column; }
      .nav-label { display: none; }
    }
  `);
  assertEquals(containerItems.length, 2);
  assertEquals(containerItems[0].style.flexDirection, 'column');
  assertEquals(containerItems[1].style.display, 'none');
  assertEquals(containerItems[0].containerCondition!.maxWidth, 30);
  assertEquals(containerItems[1].containerCondition!.maxWidth, 30);
});

Deno.test('parseStyleBlock - @container with combined conditions', () => {
  const { containerItems } = parseStyleBlock(`
    @container (min-width: 30) and (max-width: 60) {
      .item { gap: 2; }
    }
  `);
  assertEquals(containerItems.length, 1);
  assertEquals(containerItems[0].containerCondition!.minWidth, 30);
  assertEquals(containerItems[0].containerCondition!.maxWidth, 60);
});

Deno.test('parseStyleBlock - @container with height conditions', () => {
  const { containerItems } = parseStyleBlock(`
    @container (min-height: 10) {
      .tall { height: 20; }
    }
  `);
  assertEquals(containerItems.length, 1);
  assertEquals(containerItems[0].containerCondition!.minHeight, 10);
});

Deno.test('parseStyleBlock - @container rules preserve specificity', () => {
  const { containerItems } = parseStyleBlock(`
    @container (min-width: 40) {
      button { width: 10; }
      .card { width: 20; }
      #main .card { width: 30; }
    }
  `);
  assertEquals(containerItems.length, 3);
  assertEquals(containerItems[0].specificity, 1);       // button = type
  assertEquals(containerItems[1].specificity, 1000);    // .card = class
  assertEquals(containerItems[2].specificity, 1001000); // #main .card = id + class
});

Deno.test('parseStyleBlock - @container inside @media gets both conditions', () => {
  const { items, containerItems } = parseStyleBlock(`
    @media (min-width: 80) {
      .wide { padding: 2; }
      @container (min-width: 40) {
        .item { gap: 3; }
      }
    }
  `);
  assertEquals(items.length, 1);
  assertEquals(items[0].mediaCondition!.minWidth, 80);
  assertEquals(containerItems.length, 1);
  assertEquals(containerItems[0].containerCondition!.minWidth, 40);
  assertEquals(containerItems[0].mediaCondition!.minWidth, 80);
});

Deno.test('parseStyleBlock - invalid @container condition skipped', () => {
  const { containerItems } = parseStyleBlock(`
    @container (invalid: foo) {
      .item { width: 10; }
    }
  `);
  assertEquals(containerItems.length, 0);
});

Deno.test('Stylesheet.fromString - stores container items separately', () => {
  const ss = Stylesheet.fromString(`
    .card { width: 10; }
    @container (min-width: 40) {
      .item { width: 20; }
    }
  `);
  assertEquals(ss.length, 1);  // Regular items only
  assertEquals(ss.hasContainerRules, true);
  assertEquals(ss.containerItems.length, 1);
});

Deno.test('Stylesheet.fromString - hasContainerRules false when no @container', () => {
  const ss = Stylesheet.fromString('.card { width: 10; }');
  assertEquals(ss.hasContainerRules, false);
  assertEquals(ss.containerItems.length, 0);
});

Deno.test('Stylesheet.addFromString - accumulates container items', () => {
  const ss = new Stylesheet();
  ss.addFromString('@container (min-width: 20) { .a { width: 1; } }');
  ss.addFromString('@container (min-width: 40) { .b { width: 2; } }');
  assertEquals(ss.containerItems.length, 2);
  assertEquals(ss.hasContainerRules, true);
});

Deno.test('Stylesheet.clear - clears container items', () => {
  const ss = Stylesheet.fromString(`
    @container (min-width: 40) { .item { width: 20; } }
  `);
  assertEquals(ss.hasContainerRules, true);
  ss.clear();
  assertEquals(ss.hasContainerRules, false);
  assertEquals(ss.containerItems.length, 0);
});

Deno.test('parseStyleBlock - container-type parsed as style property', () => {
  const { items } = parseStyleBlock('.sidebar { container-type: inline-size; }');
  assertEquals(items[0].style.containerType, 'inline-size');
});

Deno.test('parseStyleBlock - multiple @container blocks', () => {
  const { containerItems } = parseStyleBlock(`
    @container (min-width: 40) {
      .item { flex-direction: row; }
    }
    @container (max-width: 25) {
      .item { flex-direction: column; }
    }
  `);
  assertEquals(containerItems.length, 2);
  assertEquals(containerItems[0].containerCondition!.minWidth, 40);
  assertEquals(containerItems[1].containerCondition!.maxWidth, 25);
});

// ===========================================================================
// 14. Container queries (Phase 2: getContainerMatchingStyles)
// ===========================================================================

Deno.test('getContainerMatchingStyles - returns matching styles when condition met', () => {
  const ss = Stylesheet.fromString(`
    @container (min-width: 40) {
      .item { flex-direction: row; }
    }
  `);
  const item = el('container', { classes: ['item'] });
  const result = ss.getContainerMatchingStyles(item, [], { width: 50, height: 20 });
  assertEquals(result.flexDirection, 'row');
});

Deno.test('getContainerMatchingStyles - returns empty when condition not met', () => {
  const ss = Stylesheet.fromString(`
    @container (min-width: 40) {
      .item { flex-direction: row; }
    }
  `);
  const item = el('container', { classes: ['item'] });
  const result = ss.getContainerMatchingStyles(item, [], { width: 30, height: 20 });
  assertEquals(Object.keys(result).length, 0);
});

Deno.test('getContainerMatchingStyles - returns empty when selector does not match', () => {
  const ss = Stylesheet.fromString(`
    @container (min-width: 40) {
      .card { width: 20; }
    }
  `);
  const item = el('container', { classes: ['item'] });
  const result = ss.getContainerMatchingStyles(item, [], { width: 50, height: 20 });
  assertEquals(Object.keys(result).length, 0);
});

Deno.test('getContainerMatchingStyles - returns empty when no container rules', () => {
  const ss = Stylesheet.fromString('.card { width: 10; }');
  const item = el('container', { classes: ['card'] });
  const result = ss.getContainerMatchingStyles(item, [], { width: 50, height: 20 });
  assertEquals(Object.keys(result).length, 0);
});

Deno.test('getContainerMatchingStyles - multiple conditions, only matching applied', () => {
  const ss = Stylesheet.fromString(`
    @container (min-width: 40) {
      .item { flex-direction: row; }
    }
    @container (max-width: 25) {
      .item { flex-direction: column; }
    }
  `);
  const item = el('container', { classes: ['item'] });

  const wide = ss.getContainerMatchingStyles(item, [], { width: 50, height: 20 });
  assertEquals(wide.flexDirection, 'row');

  const narrow = ss.getContainerMatchingStyles(item, [], { width: 20, height: 20 });
  assertEquals(narrow.flexDirection, 'column');

  // In between — neither matches
  const mid = ss.getContainerMatchingStyles(item, [], { width: 30, height: 20 });
  assertEquals(mid.flexDirection, undefined);
});

Deno.test('getContainerMatchingStyles - specificity ordering', () => {
  const ss = Stylesheet.fromString(`
    @container (min-width: 40) {
      button { width: 10; }
      .primary { width: 20; }
    }
  `);
  const btn = el('button', { classes: ['primary'] });
  const result = ss.getContainerMatchingStyles(btn, [], { width: 50, height: 20 });
  // .primary (specificity 1000) beats button (specificity 1)
  assertEquals(result.width, 20);
});

Deno.test('getContainerMatchingStyles - merges non-overlapping properties', () => {
  const ss = Stylesheet.fromString(`
    @container (min-width: 40) {
      button { width: 10; }
      .primary { height: 20; }
    }
  `);
  const btn = el('button', { classes: ['primary'] });
  const result = ss.getContainerMatchingStyles(btn, [], { width: 50, height: 20 });
  assertEquals(result.width, 10);
  assertEquals(result.height, 20);
});

Deno.test('getContainerMatchingStyles - ancestor selector matching', () => {
  const ss = Stylesheet.fromString(`
    @container (min-width: 40) {
      .sidebar .item { gap: 3; }
    }
  `);
  const item = el('container', { classes: ['item'] });
  const sidebar = el('container', { classes: ['sidebar'] }, item);

  const withAncestor = ss.getContainerMatchingStyles(item, [sidebar], { width: 50, height: 20 });
  assertEquals(withAncestor.gap, 3);

  const withoutAncestor = ss.getContainerMatchingStyles(item, [], { width: 50, height: 20 });
  assertEquals(withoutAncestor.gap, undefined);
});

Deno.test('getContainerMatchingStyles - @container inside @media skipped without ctx', () => {
  const ss = Stylesheet.fromString(`
    @media (min-width: 80) {
      @container (min-width: 40) {
        .item { gap: 3; }
      }
    }
  `);
  const item = el('container', { classes: ['item'] });

  // No StyleContext — media condition can't be evaluated, rule skipped
  const noCtx = ss.getContainerMatchingStyles(item, [], { width: 50, height: 20 });
  assertEquals(noCtx.gap, undefined);

  // With matching StyleContext
  const withCtx = ss.getContainerMatchingStyles(
    item, [], { width: 50, height: 20 },
    { terminalWidth: 100, terminalHeight: 30 }
  );
  assertEquals(withCtx.gap, 3);

  // With non-matching StyleContext
  const noMatch = ss.getContainerMatchingStyles(
    item, [], { width: 50, height: 20 },
    { terminalWidth: 60, terminalHeight: 30 }
  );
  assertEquals(noMatch.gap, undefined);
});
