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
  resolveVarReferences,
  extractVariableDeclarations,
} from '../mod.ts';
import type { Style, StyleContext, ContainerCondition, PseudoClassState, TransitionSpec, VariableDecl } from '../mod.ts';
import { getCurrentTheme, initThemes } from '../mod.ts';
import { parseColor, unpackRGBA, rgbToHex } from '../src/components/color-utils.ts';
import { interpolateValue, getTransitionStyle } from '../src/css-animation.ts';
import { getTimingFunction } from '../src/easing.ts';
import { computeStyle } from '../src/layout-style.ts';
import type { LayoutContext } from '../src/layout.ts';

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

// ===========================================================================
// 15. Pseudo-class selectors (:focus, :hover)
// ===========================================================================

// --- 15a. Selector parsing ---

Deno.test('parseSelector - :hover pseudo-class on type', () => {
  const sel = parseSelector('button:hover');
  assertEquals(sel.segments.length, 1);
  assertEquals(sel.segments[0].compound.parts[0], { type: 'type', value: 'button' });
  assertEquals(sel.segments[0].compound.pseudoClasses, ['hover']);
});

Deno.test('parseSelector - :focus pseudo-class on type', () => {
  const sel = parseSelector('input:focus');
  assertEquals(sel.segments.length, 1);
  assertEquals(sel.segments[0].compound.parts[0], { type: 'type', value: 'input' });
  assertEquals(sel.segments[0].compound.pseudoClasses, ['focus']);
});

Deno.test('parseSelector - :hover pseudo-class on class', () => {
  const sel = parseSelector('.card:hover');
  assertEquals(sel.segments.length, 1);
  assertEquals(sel.segments[0].compound.parts[0], { type: 'class', value: 'card' });
  assertEquals(sel.segments[0].compound.pseudoClasses, ['hover']);
});

Deno.test('parseSelector - :focus pseudo-class on id', () => {
  const sel = parseSelector('#myInput:focus');
  assertEquals(sel.segments.length, 1);
  assertEquals(sel.segments[0].compound.parts[0], { type: 'id', value: 'myInput' });
  assertEquals(sel.segments[0].compound.pseudoClasses, ['focus']);
});

Deno.test('parseSelector - compound type.class:hover', () => {
  const sel = parseSelector('button.primary:hover');
  assertEquals(sel.segments.length, 1);
  const parts = sel.segments[0].compound.parts;
  assertEquals(parts.length, 2);
  assertEquals(parts[0], { type: 'type', value: 'button' });
  assertEquals(parts[1], { type: 'class', value: 'primary' });
  assertEquals(sel.segments[0].compound.pseudoClasses, ['hover']);
});

Deno.test('parseSelector - multiple pseudo-classes :hover:focus', () => {
  const sel = parseSelector('button:hover:focus');
  assertEquals(sel.segments.length, 1);
  assertEquals(sel.segments[0].compound.parts[0], { type: 'type', value: 'button' });
  assertEquals(sel.segments[0].compound.pseudoClasses, ['hover', 'focus']);
});

Deno.test('parseSelector - no pseudo-class means no pseudoClasses field', () => {
  const sel = parseSelector('button');
  assertEquals(sel.segments[0].compound.pseudoClasses, undefined);
});

Deno.test('parseSelector - pseudo-class with descendant combinator', () => {
  const sel = parseSelector('.app button:hover');
  assertEquals(sel.segments.length, 2);
  assertEquals(sel.segments[0].compound.parts[0], { type: 'class', value: 'app' });
  assertEquals(sel.segments[0].compound.pseudoClasses, undefined);
  assertEquals(sel.segments[1].compound.parts[0], { type: 'type', value: 'button' });
  assertEquals(sel.segments[1].compound.pseudoClasses, ['hover']);
});

Deno.test('parseSelector - pseudo-class with child combinator', () => {
  const sel = parseSelector('.app > input:focus');
  assertEquals(sel.segments.length, 2);
  assertEquals(sel.segments[1].combinator, 'child');
  assertEquals(sel.segments[1].compound.parts[0], { type: 'type', value: 'input' });
  assertEquals(sel.segments[1].compound.pseudoClasses, ['focus']);
});

// --- 15b. Selector matching with pseudo-class state ---

Deno.test('selectorMatches - :hover matches when hoveredElementId matches', () => {
  const btn = el('button', { id: 'btn1' });
  const state: PseudoClassState = { hoveredElementId: 'btn1' };
  assert(selectorMatches(parseSelector('button:hover'), btn, [], state));
});

Deno.test('selectorMatches - :hover does not match when hoveredElementId differs', () => {
  const btn = el('button', { id: 'btn1' });
  const state: PseudoClassState = { hoveredElementId: 'btn2' };
  assert(!selectorMatches(parseSelector('button:hover'), btn, [], state));
});

Deno.test('selectorMatches - :hover does not match when no hover state', () => {
  const btn = el('button', { id: 'btn1' });
  assert(!selectorMatches(parseSelector('button:hover'), btn, [], {}));
  assert(!selectorMatches(parseSelector('button:hover'), btn, []));
});

Deno.test('selectorMatches - :focus matches when focusedElementId matches', () => {
  const inp = el('input', { id: 'inp1' });
  const state: PseudoClassState = { focusedElementId: 'inp1' };
  assert(selectorMatches(parseSelector('input:focus'), inp, [], state));
});

Deno.test('selectorMatches - :focus does not match when focusedElementId differs', () => {
  const inp = el('input', { id: 'inp1' });
  const state: PseudoClassState = { focusedElementId: 'inp2' };
  assert(!selectorMatches(parseSelector('input:focus'), inp, [], state));
});

Deno.test('selectorMatches - :focus does not match when no focus state', () => {
  const inp = el('input', { id: 'inp1' });
  assert(!selectorMatches(parseSelector('input:focus'), inp, [], {}));
});

Deno.test('selectorMatches - :hover:focus requires both states active', () => {
  const btn = el('button', { id: 'btn1' });
  const bothActive: PseudoClassState = { hoveredElementId: 'btn1', focusedElementId: 'btn1' };
  const hoverOnly: PseudoClassState = { hoveredElementId: 'btn1' };
  const focusOnly: PseudoClassState = { focusedElementId: 'btn1' };
  assert(selectorMatches(parseSelector('button:hover:focus'), btn, [], bothActive));
  assert(!selectorMatches(parseSelector('button:hover:focus'), btn, [], hoverOnly));
  assert(!selectorMatches(parseSelector('button:hover:focus'), btn, [], focusOnly));
});

Deno.test('selectorMatches - pseudo-class with descendant combinator', () => {
  const btn = el('button', { id: 'btn1' });
  const parent = el('container', { classes: ['app'] });
  const state: PseudoClassState = { hoveredElementId: 'btn1' };
  assert(selectorMatches(parseSelector('.app button:hover'), btn, [parent], state));
  assert(!selectorMatches(parseSelector('.app button:hover'), btn, [parent]));  // no state
});

Deno.test('selectorMatches - pseudo-class on ancestor segment', () => {
  // .parent:hover > .child — tests pseudo-class on ancestor
  const child = el('container', { id: 'child1', classes: ['child'] });
  const parent = el('container', { id: 'parent1', classes: ['parent'] });
  const state: PseudoClassState = { hoveredElementId: 'parent1' };
  assert(selectorMatches(parseSelector('.parent:hover > .child'), child, [parent], state));
  // Doesn't match when parent is not hovered
  const wrongState: PseudoClassState = { hoveredElementId: 'child1' };
  assert(!selectorMatches(parseSelector('.parent:hover > .child'), child, [parent], wrongState));
});

Deno.test('selectorMatches - non-pseudo rules still work when state provided', () => {
  const btn = el('button', { id: 'btn1' });
  const state: PseudoClassState = { hoveredElementId: 'btn1' };
  // Regular selector with state — should still match normally
  assert(selectorMatches(parseSelector('button'), btn, [], state));
});

// --- 15c. Specificity ---

Deno.test('specificity - :hover counts as class-level specificity', () => {
  // button:hover = type(1) + pseudo-class(1000) = 1001
  // .primary     = class(1000)
  // button:hover and .primary have specificity 1001 vs 1000
  const ss = Stylesheet.fromString(`
    .primary { width: 10; }
    button:hover { width: 20; }
  `);
  const btn = el('button', { id: 'btn1', classes: ['primary'] });
  const state: PseudoClassState = { hoveredElementId: 'btn1' };
  const merged = ss.getMergedStyle(btn, [], undefined, state);
  assertEquals(merged.width, 20);  // button:hover (1001) beats .primary (1000)
});

Deno.test('specificity - :hover beats plain type selector', () => {
  const ss = Stylesheet.fromString(`
    button { width: 10; }
    button:hover { width: 20; }
  `);
  const btn = el('button', { id: 'btn1' });
  const state: PseudoClassState = { hoveredElementId: 'btn1' };
  const merged = ss.getMergedStyle(btn, [], undefined, state);
  assertEquals(merged.width, 20);
});

Deno.test('specificity - :hover on type loses to id selector', () => {
  // button:hover = type(1) + pseudo(1000) = 1001
  // #myBtn = id(1000000)
  const ss = Stylesheet.fromString(`
    button:hover { width: 20; }
    #myBtn { width: 50; }
  `);
  const btn = el('button', { id: 'myBtn' });
  const state: PseudoClassState = { hoveredElementId: 'myBtn' };
  const merged = ss.getMergedStyle(btn, [], undefined, state);
  assertEquals(merged.width, 50);  // id wins
});

Deno.test('specificity - two pseudo-classes beat one pseudo-class', () => {
  // button:hover:focus = type(1) + 2*pseudo(2000) = 2001
  // button:hover       = type(1) + pseudo(1000)   = 1001
  const ss = Stylesheet.fromString(`
    button:hover:focus { width: 30; }
    button:hover { width: 20; }
  `);
  const btn = el('button', { id: 'btn1' });
  const state: PseudoClassState = { hoveredElementId: 'btn1', focusedElementId: 'btn1' };
  const merged = ss.getMergedStyle(btn, [], undefined, state);
  assertEquals(merged.width, 30);
});

// --- 15d. parseStyleBlock with pseudo-classes ---

Deno.test('parseStyleBlock - pseudo-class rule', () => {
  const { items } = parseStyleBlock('button:hover { border: thin; }');
  assertEquals(items.length, 1);
  assertEquals(items[0].style.border, 'thin');
  assertEquals(items[0].selector.segments[0].compound.pseudoClasses, ['hover']);
});

Deno.test('parseStyleBlock - mixed normal and pseudo rules', () => {
  const { items } = parseStyleBlock(`
    button { width: 20; }
    button:hover { width: 30; }
    button:focus { border: thin; }
  `);
  assertEquals(items.length, 3);
  assertEquals(items[0].selector.segments[0].compound.pseudoClasses, undefined);
  assertEquals(items[1].selector.segments[0].compound.pseudoClasses, ['hover']);
  assertEquals(items[2].selector.segments[0].compound.pseudoClasses, ['focus']);
});

Deno.test('parseStyleBlock - pseudo-class in @media block', () => {
  const { items } = parseStyleBlock(`
    @media (min-width: 80) {
      button:hover { width: 30; }
    }
  `);
  assertEquals(items.length, 1);
  assertEquals(items[0].selector.segments[0].compound.pseudoClasses, ['hover']);
  assertEquals(items[0].mediaCondition!.minWidth, 80);
});

// --- 15e. Stylesheet.hasPseudoClassRules ---

Deno.test('Stylesheet.hasPseudoClassRules - false when no pseudo rules', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  assertEquals(ss.hasPseudoClassRules, false);
});

Deno.test('Stylesheet.hasPseudoClassRules - true when pseudo rules exist', () => {
  const ss = Stylesheet.fromString(`
    button { width: 20; }
    button:hover { width: 30; }
  `);
  assertEquals(ss.hasPseudoClassRules, true);
});

Deno.test('Stylesheet.hasPseudoClassRules - true for focus pseudo', () => {
  const ss = Stylesheet.fromString('input:focus { border: thin; }');
  assertEquals(ss.hasPseudoClassRules, true);
});

// --- 15f. getMergedStyle with pseudo state ---

Deno.test('getMergedStyle - pseudo state applies matching pseudo rules', () => {
  const ss = Stylesheet.fromString(`
    button { width: 20; }
    button:hover { width: 30; }
  `);
  const btn = el('button', { id: 'btn1' });
  const state: PseudoClassState = { hoveredElementId: 'btn1' };
  // Without state — only base rule matches
  assertEquals(ss.getMergedStyle(btn).width, 20);
  // With state — pseudo rule matches and overrides (higher specificity)
  assertEquals(ss.getMergedStyle(btn, [], undefined, state).width, 30);
});

Deno.test('getMergedStyle - pseudo state does not affect non-matching element', () => {
  const ss = Stylesheet.fromString(`
    button { width: 20; }
    button:hover { width: 30; }
  `);
  const btn = el('button', { id: 'btn1' });
  const state: PseudoClassState = { hoveredElementId: 'other' };
  assertEquals(ss.getMergedStyle(btn, [], undefined, state).width, 20);
});

Deno.test('getMergedStyle - focus and hover pseudo rules both apply', () => {
  const ss = Stylesheet.fromString(`
    button { width: 10; }
    button:hover { height: 5; }
    button:focus { border: thin; }
  `);
  const btn = el('button', { id: 'btn1' });
  const state: PseudoClassState = { hoveredElementId: 'btn1', focusedElementId: 'btn1' };
  const merged = ss.getMergedStyle(btn, [], undefined, state);
  assertEquals(merged.width, 10);
  assertEquals(merged.height, 5);
  assertEquals(merged.border, 'thin');
});

// --- 15g. getPseudoMatchingStyles ---

Deno.test('getPseudoMatchingStyles - returns only pseudo-class rule styles', () => {
  const ss = Stylesheet.fromString(`
    button { width: 20; }
    button:hover { height: 5; }
  `);
  const btn = el('button', { id: 'btn1' });
  const state: PseudoClassState = { hoveredElementId: 'btn1' };
  const pseudo = ss.getPseudoMatchingStyles(btn, [], undefined, state);
  // Should only return the :hover rule's styles, not the base rule
  assertEquals(pseudo.height, 5);
  assertEquals(pseudo.width, undefined);
});

Deno.test('getPseudoMatchingStyles - returns empty when no pseudo rules match', () => {
  const ss = Stylesheet.fromString(`
    button { width: 20; }
    button:hover { height: 5; }
  `);
  const btn = el('button', { id: 'btn1' });
  const state: PseudoClassState = { hoveredElementId: 'other' };
  const pseudo = ss.getPseudoMatchingStyles(btn, [], undefined, state);
  assertEquals(Object.keys(pseudo).length, 0);
});

Deno.test('getPseudoMatchingStyles - returns empty when no pseudo rules exist', () => {
  const ss = Stylesheet.fromString('button { width: 20; }');
  const btn = el('button', { id: 'btn1' });
  const state: PseudoClassState = { hoveredElementId: 'btn1' };
  const pseudo = ss.getPseudoMatchingStyles(btn, [], undefined, state);
  assertEquals(Object.keys(pseudo).length, 0);
});

Deno.test('getPseudoMatchingStyles - merges multiple matching pseudo rules', () => {
  const ss = Stylesheet.fromString(`
    button:hover { height: 5; }
    .primary:hover { width: 30; }
  `);
  const btn = el('button', { id: 'btn1', classes: ['primary'] });
  const state: PseudoClassState = { hoveredElementId: 'btn1' };
  const pseudo = ss.getPseudoMatchingStyles(btn, [], undefined, state);
  assertEquals(pseudo.height, 5);
  assertEquals(pseudo.width, 30);
});

Deno.test('getPseudoMatchingStyles - respects specificity ordering', () => {
  const ss = Stylesheet.fromString(`
    button:hover { width: 10; }
    .primary:hover { width: 20; }
  `);
  const btn = el('button', { id: 'btn1', classes: ['primary'] });
  const state: PseudoClassState = { hoveredElementId: 'btn1' };
  const pseudo = ss.getPseudoMatchingStyles(btn, [], undefined, state);
  // .primary:hover (class + pseudo = 2000) beats button:hover (type + pseudo = 1001)
  assertEquals(pseudo.width, 20);
});

Deno.test('getPseudoMatchingStyles - with ancestor matching', () => {
  const ss = Stylesheet.fromString(`
    .app button:hover { height: 5; }
  `);
  const btn = el('button', { id: 'btn1' });
  const parent = el('container', { classes: ['app'] });
  const state: PseudoClassState = { hoveredElementId: 'btn1' };
  const pseudo = ss.getPseudoMatchingStyles(btn, [parent], undefined, state);
  assertEquals(pseudo.height, 5);
});

Deno.test('getPseudoMatchingStyles - respects media condition', () => {
  const ss = Stylesheet.fromString(`
    @media (min-width: 80) {
      button:hover { width: 30; }
    }
  `);
  const btn = el('button', { id: 'btn1' });
  const state: PseudoClassState = { hoveredElementId: 'btn1' };
  const wideCtx: StyleContext = { terminalWidth: 100, terminalHeight: 24 };
  const narrowCtx: StyleContext = { terminalWidth: 60, terminalHeight: 24 };

  assertEquals(ss.getPseudoMatchingStyles(btn, [], wideCtx, state).width, 30);
  assertEquals(Object.keys(ss.getPseudoMatchingStyles(btn, [], narrowCtx, state)).length, 0);
});

// --- 15h. applyStylesheet does NOT apply pseudo-class rules ---

Deno.test('applyStylesheet - pseudo rules not applied without state', () => {
  const ss = Stylesheet.fromString(`
    button { width: 20; }
    button:hover { width: 30; }
  `);
  const btn = el('button', { id: 'btn1' });
  applyStylesheet(btn, ss);
  // Without pseudo state, :hover rule should not apply
  assertEquals(btn.props.style.width, 20);
});

// --- 15i. Edge cases ---

Deno.test('selectorMatches - element without id never matches pseudo-class', () => {
  const btn = el('button');  // no id
  const state: PseudoClassState = { hoveredElementId: 'btn1' };
  assert(!selectorMatches(parseSelector('button:hover'), btn, [], state));
});

Deno.test('getMergedStyle - :focus overrides :hover for same property (later rule wins at same specificity)', () => {
  // Both button:hover and button:focus have same specificity (1001)
  // Later one wins (source order)
  const ss = Stylesheet.fromString(`
    button:hover { width: 20; }
    button:focus { width: 30; }
  `);
  const btn = el('button', { id: 'btn1' });
  const state: PseudoClassState = { hoveredElementId: 'btn1', focusedElementId: 'btn1' };
  const merged = ss.getMergedStyle(btn, [], undefined, state);
  assertEquals(merged.width, 30);  // :focus is later, wins
});

Deno.test('getMergedStyle - non-overlapping pseudo properties merge', () => {
  const ss = Stylesheet.fromString(`
    button:hover { height: 5; }
    button:focus { width: 30; }
  `);
  const btn = el('button', { id: 'btn1' });
  const state: PseudoClassState = { hoveredElementId: 'btn1', focusedElementId: 'btn1' };
  const merged = ss.getMergedStyle(btn, [], undefined, state);
  assertEquals(merged.height, 5);
  assertEquals(merged.width, 30);
});

// ===========================================================================
// 16. CSS Transition parsing
// ===========================================================================

Deno.test('parseStyleProperties - transition shorthand single property', () => {
  const s = parseStyleProperties('transition: background-color 300ms ease;');
  assert(s._transitionSpecs !== undefined);
  const specs = s._transitionSpecs as TransitionSpec[];
  assertEquals(specs.length, 1);
  assertEquals(specs[0].property, 'backgroundColor');
  assertEquals(specs[0].duration, 300);
  assertEquals(specs[0].timingFn, 'ease');
  assertEquals(specs[0].delay, 0);
});

Deno.test('parseStyleProperties - transition shorthand all keyword', () => {
  const s = parseStyleProperties('transition: all 200ms ease-in-out;');
  const specs = s._transitionSpecs as TransitionSpec[];
  assertEquals(specs.length, 1);
  assertEquals(specs[0].property, 'all');
  assertEquals(specs[0].duration, 200);
  assertEquals(specs[0].timingFn, 'ease-in-out');
});

Deno.test('parseStyleProperties - transition shorthand multiple properties', () => {
  const s = parseStyleProperties('transition: color 200ms, background-color 300ms ease-in;');
  const specs = s._transitionSpecs as TransitionSpec[];
  assertEquals(specs.length, 2);
  assertEquals(specs[0].property, 'color');
  assertEquals(specs[0].duration, 200);
  assertEquals(specs[0].timingFn, 'ease');  // default
  assertEquals(specs[1].property, 'backgroundColor');
  assertEquals(specs[1].duration, 300);
  assertEquals(specs[1].timingFn, 'ease-in');
});

Deno.test('parseStyleProperties - transition shorthand with delay', () => {
  const s = parseStyleProperties('transition: color 1s linear 500ms;');
  const specs = s._transitionSpecs as TransitionSpec[];
  assertEquals(specs.length, 1);
  assertEquals(specs[0].property, 'color');
  assertEquals(specs[0].duration, 1000);  // 1s = 1000ms
  assertEquals(specs[0].timingFn, 'linear');
  assertEquals(specs[0].delay, 500);
});

Deno.test('parseStyleProperties - transition in stylesheet block', () => {
  const { items } = parseStyleBlock(`
    button { transition: background-color 200ms ease; }
  `);
  assertEquals(items.length, 1);
  const specs = items[0].style._transitionSpecs as TransitionSpec[];
  assert(specs !== undefined);
  assertEquals(specs.length, 1);
  assertEquals(specs[0].property, 'backgroundColor');
  assertEquals(specs[0].duration, 200);
});

Deno.test('parseStyleProperties - transitionDuration longhand', () => {
  const s = parseStyleProperties('transition-duration: 500ms;');
  assertEquals(s.transitionDuration, 500);
});

Deno.test('parseStyleProperties - transitionDelay longhand', () => {
  const s = parseStyleProperties('transition-delay: 100ms;');
  assertEquals(s.transitionDelay, 100);
});

Deno.test('parseStyleProperties - transitionDuration seconds', () => {
  const s = parseStyleProperties('transition-duration: 1.5s;');
  assertEquals(s.transitionDuration, 1500);
});

// ===========================================================================
// 17. getTransitionStyle
// ===========================================================================

Deno.test('getTransitionStyle - returns empty when no _transitionState', () => {
  const btn = el('button');
  const result = getTransitionStyle(btn);
  assertEquals(Object.keys(result).length, 0);
});

Deno.test('getTransitionStyle - returns from value during delay period', () => {
  const btn = el('button');
  btn._transitionState = {
    active: new Map([
      ['backgroundColor', {
        from: 0xFF0000FF,  // red
        to: 0x0000FFFF,    // blue
        startTime: performance.now(),
        duration: 200,
        delay: 1000,       // 1 second delay — should still be in delay
        timingFn: getTimingFunction('linear'),
      }],
    ]),
    previousValues: new Map(),
  };
  const result = getTransitionStyle(btn);
  assertEquals(result.backgroundColor, 0xFF0000FF);  // from value during delay
});

Deno.test('getTransitionStyle - returns to value at completion', () => {
  const btn = el('button');
  btn._transitionState = {
    active: new Map([
      ['backgroundColor', {
        from: 0xFF0000FF,  // red
        to: 0x0000FFFF,    // blue
        startTime: performance.now() - 300,  // started 300ms ago
        duration: 200,                        // 200ms duration — completed
        delay: 0,
        timingFn: getTimingFunction('linear'),
      }],
    ]),
    previousValues: new Map(),
  };
  const result = getTransitionStyle(btn);
  assertEquals(result.backgroundColor, 0x0000FFFF);  // to value at completion
});

Deno.test('getTransitionStyle - removes completed transitions from active map', () => {
  const btn = el('button');
  btn._transitionState = {
    active: new Map([
      ['backgroundColor', {
        from: 0xFF0000FF,
        to: 0x0000FFFF,
        startTime: performance.now() - 300,  // completed
        duration: 200,
        delay: 0,
        timingFn: getTimingFunction('linear'),
      }],
    ]),
    previousValues: new Map(),
  };
  getTransitionStyle(btn);
  assertEquals(btn._transitionState!.active.size, 0);
});

Deno.test('getTransitionStyle - returns interpolated value mid-transition', () => {
  const btn = el('button');
  // Use a gap property (numeric) for easier validation
  btn._transitionState = {
    active: new Map([
      ['gap', {
        from: 0,
        to: 10,
        startTime: performance.now() - 100,  // started 100ms ago
        duration: 200,                         // 200ms total — 50% through
        delay: 0,
        timingFn: getTimingFunction('linear'),
      }],
    ]),
    previousValues: new Map(),
  };
  const result = getTransitionStyle(btn);
  // At ~50% through with linear easing, should be ~5
  assert(typeof result.gap === 'number');
  assert(result.gap! >= 3 && result.gap! <= 7, `Expected gap ~5, got ${result.gap}`);
});

// ===========================================================================
// 18. interpolateValue (exported)
// ===========================================================================

Deno.test('interpolateValue - numeric property', () => {
  assertEquals(interpolateValue('gap', 0, 10, 0.5), 5);
  assertEquals(interpolateValue('gap', 0, 10, 0), 0);
  assertEquals(interpolateValue('gap', 0, 10, 1), 10);
});

Deno.test('interpolateValue - same value returns from', () => {
  assertEquals(interpolateValue('gap', 5, 5, 0.5), 5);
});

Deno.test('interpolateValue - discrete snap for strings', () => {
  assertEquals(interpolateValue('border', 'thin', 'thick', 0.3), 'thin');
  assertEquals(interpolateValue('border', 'thin', 'thick', 0.7), 'thick');
});

// ===========================================================================
// 19. Phase 3 — Integration: pseudo-classes + transitions
// ===========================================================================

// Helper: create a LayoutContext with stylesheets and pseudo-class state
function makeLayoutContext(opts: {
  stylesheets?: Stylesheet[];
  focusedElementId?: string;
  hoveredElementId?: string;
}): LayoutContext {
  return {
    viewport: { x: 0, y: 0, width: 80, height: 24 },
    parentBounds: { x: 0, y: 0, width: 80, height: 24 },
    availableSpace: { width: 80, height: 24 },
    stylesheets: opts.stylesheets || [],
    focusedElementId: opts.focusedElementId,
    hoveredElementId: opts.hoveredElementId,
  };
}

// Helper: clean up transition registration (UIAnimationManager interval) to prevent leaks
function cleanupTransition(element: ReturnType<typeof createElement>) {
  if (element._transitionRegistration) {
    element._transitionRegistration();
    element._transitionRegistration = undefined;
  }
  element._transitionState = undefined;
}

Deno.test('integration - hover creates transition when transition spec exists', () => {
  const ss = Stylesheet.fromString(`
    button { background-color: gray; transition: background-color 200ms ease; }
    button:hover { background-color: blue; }
  `);
  const btn = el('button', { id: 'btn1' });
  ss.applyTo(btn);

  // Verify transition spec was applied
  assert(btn.props.style._transitionSpecs, '_transitionSpecs should be set');

  const ctx = makeLayoutContext({ stylesheets: [ss] });

  // Frame 1: no hover — establishes baseline previousValues
  computeStyle(btn, undefined, ctx);
  // processTransitions should have initialized state and stored previousValues
  assert(btn._transitionState !== undefined, '_transitionState should be initialized');
  assertEquals(btn._transitionState!.active.size, 0, 'No active transitions yet');

  // Frame 2: hover activated — backgroundColor changes, transition should start
  const hoverCtx = makeLayoutContext({ stylesheets: [ss], hoveredElementId: 'btn1' });
  computeStyle(btn, undefined, hoverCtx);

  assert(btn._transitionState!.active.size > 0, 'Should have active transitions after hover');
  assert(btn._transitionState!.active.has('backgroundColor'), 'backgroundColor should be transitioning');

  const transition = btn._transitionState!.active.get('backgroundColor')!;
  assertEquals(transition.duration, 200);
  cleanupTransition(btn);
});

Deno.test('integration - hover without transition spec is instant (no transition created)', () => {
  const ss = Stylesheet.fromString(`
    button { background-color: gray; }
    button:hover { background-color: blue; }
  `);
  const btn = el('button', { id: 'btn1' });
  ss.applyTo(btn);

  const ctx = makeLayoutContext({ stylesheets: [ss] });
  computeStyle(btn, undefined, ctx);

  // No _transitionSpecs → no _transitionState
  assertEquals(btn._transitionState, undefined, 'No transition state without transition spec');

  // Hover — still no transition
  const hoverCtx = makeLayoutContext({ stylesheets: [ss], hoveredElementId: 'btn1' });
  computeStyle(btn, undefined, hoverCtx);
  assertEquals(btn._transitionState, undefined, 'Still no transition state');
});

Deno.test('integration - focus creates transition when transition spec exists', () => {
  const ss = Stylesheet.fromString(`
    input { border-color: gray; transition: border-color 150ms linear; }
    input:focus { border-color: cyan; }
  `);
  const inp = el('input', { id: 'inp1' });
  ss.applyTo(inp);

  const ctx = makeLayoutContext({ stylesheets: [ss] });
  computeStyle(inp, undefined, ctx);
  assertEquals(inp._transitionState!.active.size, 0);

  // Focus
  const focusCtx = makeLayoutContext({ stylesheets: [ss], focusedElementId: 'inp1' });
  computeStyle(inp, undefined, focusCtx);
  assert(inp._transitionState!.active.has('borderColor'), 'borderColor should be transitioning');
  assertEquals(inp._transitionState!.active.get('borderColor')!.duration, 150);
  cleanupTransition(inp);
});

Deno.test('integration - hover leave reverses transition (interruption)', () => {
  const ss = Stylesheet.fromString(`
    button { gap: 0; transition: gap 200ms linear; }
    button:hover { gap: 10; }
  `);
  const btn = el('button', { id: 'btn1' });
  ss.applyTo(btn);

  const ctx = makeLayoutContext({ stylesheets: [ss] });
  const hoverCtx = makeLayoutContext({ stylesheets: [ss], hoveredElementId: 'btn1' });

  // Frame 1: baseline
  computeStyle(btn, undefined, ctx);

  // Frame 2: hover on — starts transition from 0 to 10
  computeStyle(btn, undefined, hoverCtx);
  assert(btn._transitionState!.active.has('gap'));
  const t1 = btn._transitionState!.active.get('gap')!;
  assertEquals(t1.from, 0);
  assertEquals(t1.to, 10);

  // Frame 3: hover off — should interrupt transition, reversing to 0
  // The current interpolated value becomes 'from', 0 becomes 'to'
  computeStyle(btn, undefined, ctx);
  assert(btn._transitionState!.active.has('gap'), 'gap should still be transitioning (reverse)');
  const t2 = btn._transitionState!.active.get('gap')!;
  assertEquals(t2.to, 0, 'Reverse target should be 0');
  // from should be the interpolated value at interruption point (a number > 0)
  assert(typeof t2.from === 'number', 'from should be numeric');
  cleanupTransition(btn);
});

Deno.test('integration - transition: all applies to any changing property', () => {
  const ss = Stylesheet.fromString(`
    button { gap: 0; padding: 0; transition: all 100ms linear; }
    button:hover { gap: 5; padding: 2; }
  `);
  const btn = el('button', { id: 'btn1' });
  ss.applyTo(btn);

  const ctx = makeLayoutContext({ stylesheets: [ss] });
  computeStyle(btn, undefined, ctx);

  const hoverCtx = makeLayoutContext({ stylesheets: [ss], hoveredElementId: 'btn1' });
  computeStyle(btn, undefined, hoverCtx);

  assert(btn._transitionState!.active.has('gap'), 'gap should be transitioning');
  assert(btn._transitionState!.active.has('padding'), 'padding should be transitioning');
  cleanupTransition(btn);
});

Deno.test('integration - focus + hover simultaneously both trigger transitions', () => {
  const ss = Stylesheet.fromString(`
    button { gap: 0; padding: 0; transition: all 200ms ease; }
    button:hover { gap: 5; }
    button:focus { padding: 3; }
  `);
  const btn = el('button', { id: 'btn1' });
  ss.applyTo(btn);

  const ctx = makeLayoutContext({ stylesheets: [ss] });
  computeStyle(btn, undefined, ctx);

  // Both hover and focus at once
  const bothCtx = makeLayoutContext({
    stylesheets: [ss],
    hoveredElementId: 'btn1',
    focusedElementId: 'btn1',
  });
  computeStyle(btn, undefined, bothCtx);

  assert(btn._transitionState!.active.has('gap'), 'gap from :hover');
  assert(btn._transitionState!.active.has('padding'), 'padding from :focus');
  cleanupTransition(btn);
});

Deno.test('integration - transition on non-animatable property uses discrete snap', () => {
  const ss = Stylesheet.fromString(`
    button { border: thin; transition: border 200ms ease; }
    button:hover { border: thick; }
  `);
  const btn = el('button', { id: 'btn1' });
  ss.applyTo(btn);

  const ctx = makeLayoutContext({ stylesheets: [ss] });
  computeStyle(btn, undefined, ctx);

  const hoverCtx = makeLayoutContext({ stylesheets: [ss], hoveredElementId: 'btn1' });
  computeStyle(btn, undefined, hoverCtx);

  // Border is a string — transition still created, interpolateValue handles it as discrete
  assert(btn._transitionState!.active.has('border'), 'border transition created');
  const t = btn._transitionState!.active.get('border')!;
  assertEquals(t.from, 'thin');
  assertEquals(t.to, 'thick');
  cleanupTransition(btn);
});

Deno.test('integration - getTransitionStyle returns interpolated value during active transition', () => {
  const ss = Stylesheet.fromString(`
    button { gap: 0; transition: gap 200ms linear; }
    button:hover { gap: 10; }
  `);
  const btn = el('button', { id: 'btn1' });
  ss.applyTo(btn);

  const ctx = makeLayoutContext({ stylesheets: [ss] });
  computeStyle(btn, undefined, ctx);

  const hoverCtx = makeLayoutContext({ stylesheets: [ss], hoveredElementId: 'btn1' });
  computeStyle(btn, undefined, hoverCtx);

  // Manually set startTime to 100ms ago for a predictable interpolation
  const t = btn._transitionState!.active.get('gap')!;
  t.startTime = performance.now() - 100;  // 50% through

  const style = getTransitionStyle(btn);
  assert(typeof style.gap === 'number');
  assert(style.gap! >= 3 && style.gap! <= 7, `Expected gap ~5, got ${style.gap}`);
  cleanupTransition(btn);
});

Deno.test('integration - completed transition cleans up active map', () => {
  const ss = Stylesheet.fromString(`
    button { gap: 0; transition: gap 200ms linear; }
    button:hover { gap: 10; }
  `);
  const btn = el('button', { id: 'btn1' });
  ss.applyTo(btn);

  const ctx = makeLayoutContext({ stylesheets: [ss] });
  computeStyle(btn, undefined, ctx);

  const hoverCtx = makeLayoutContext({ stylesheets: [ss], hoveredElementId: 'btn1' });
  computeStyle(btn, undefined, hoverCtx);

  // Set startTime far in the past so transition is complete
  const t = btn._transitionState!.active.get('gap')!;
  t.startTime = performance.now() - 500;  // well past 200ms duration

  const style = getTransitionStyle(btn);
  assertEquals(style.gap, 10);  // final value
  assertEquals(btn._transitionState!.active.size, 0, 'transition should be cleaned up');
  // getTransitionStyle already unregistered since active is empty
});

Deno.test('integration - zero-duration transition spec does not create transitions', () => {
  const ss = Stylesheet.fromString(`
    button { gap: 0; transition: gap 0ms ease; }
    button:hover { gap: 10; }
  `);
  const btn = el('button', { id: 'btn1' });
  ss.applyTo(btn);

  const ctx = makeLayoutContext({ stylesheets: [ss] });
  computeStyle(btn, undefined, ctx);

  const hoverCtx = makeLayoutContext({ stylesheets: [ss], hoveredElementId: 'btn1' });
  computeStyle(btn, undefined, hoverCtx);

  // Zero-duration should not create a transition — no registration to clean up
  assertEquals(btn._transitionState!.active.size, 0, 'No transition for 0ms duration');
});

Deno.test('integration - multiple properties transition independently', () => {
  const ss = Stylesheet.fromString(`
    button { gap: 0; padding: 0; transition: gap 100ms linear, padding 300ms ease; }
    button:hover { gap: 10; padding: 5; }
  `);
  const btn = el('button', { id: 'btn1' });
  ss.applyTo(btn);

  const ctx = makeLayoutContext({ stylesheets: [ss] });
  computeStyle(btn, undefined, ctx);

  const hoverCtx = makeLayoutContext({ stylesheets: [ss], hoveredElementId: 'btn1' });
  computeStyle(btn, undefined, hoverCtx);

  assert(btn._transitionState!.active.has('gap'));
  assert(btn._transitionState!.active.has('padding'));
  assertEquals(btn._transitionState!.active.get('gap')!.duration, 100);
  assertEquals(btn._transitionState!.active.get('padding')!.duration, 300);
  cleanupTransition(btn);
});

Deno.test('integration - transition with delay shows from value during delay', () => {
  const ss = Stylesheet.fromString(`
    button { gap: 0; transition: gap 200ms linear 500ms; }
    button:hover { gap: 10; }
  `);
  const btn = el('button', { id: 'btn1' });
  ss.applyTo(btn);

  const ctx = makeLayoutContext({ stylesheets: [ss] });
  computeStyle(btn, undefined, ctx);

  const hoverCtx = makeLayoutContext({ stylesheets: [ss], hoveredElementId: 'btn1' });
  computeStyle(btn, undefined, hoverCtx);

  const t = btn._transitionState!.active.get('gap')!;
  assertEquals(t.delay, 500);

  // During delay, should return 'from' value
  const style = getTransitionStyle(btn);
  assertEquals(style.gap, 0, 'Should show from value during delay');
  cleanupTransition(btn);
});

// ===========================================================================
// Phase 0: Comma-separated selectors
// ===========================================================================

Deno.test('parseStyleBlock - comma-separated selectors produce multiple items', () => {
  const result = parseStyleBlock('.card, .panel { color: white; }');
  assertEquals(result.items.length, 2);
  assertEquals(result.items[0].selector.segments[0].compound.parts[0].value, 'card');
  assertEquals(result.items[1].selector.segments[0].compound.parts[0].value, 'panel');
});

Deno.test('parseStyleBlock - comma-separated selectors share the same style', () => {
  const result = parseStyleBlock('.card, .panel { width: 10; }');
  assertEquals(result.items[0].style.width, 10);
  assertEquals(result.items[1].style.width, 10);
});

Deno.test('parseStyleBlock - comma selector matches correct elements', () => {
  const ss = new Stylesheet();
  ss.addFromString('.card, .panel { width: 20; }');
  const card = el('container', { classes: ['card'] });
  const panel = el('container', { classes: ['panel'] });
  const other = el('container', { classes: ['other'] });
  assertEquals(ss.getMergedStyle(card).width, 20);
  assertEquals(ss.getMergedStyle(panel).width, 20);
  assertEquals(ss.getMergedStyle(other).width, undefined);
});

Deno.test('parseStyleBlock - comma selector with compound selectors', () => {
  const result = parseStyleBlock('button.primary, .card.active { height: 5; }');
  assertEquals(result.items.length, 2);
  // First: button.primary
  assertEquals(result.items[0].selector.segments[0].compound.parts[0].value, 'button');
  assertEquals(result.items[0].selector.segments[0].compound.parts[1].value, 'primary');
  // Second: .card.active
  assertEquals(result.items[1].selector.segments[0].compound.parts[0].value, 'card');
  assertEquals(result.items[1].selector.segments[0].compound.parts[1].value, 'active');
});

Deno.test('parseStyleBlock - single selector still works', () => {
  const result = parseStyleBlock('.card { width: 10; }');
  assertEquals(result.items.length, 1);
  assertEquals(result.items[0].style.width, 10);
});

// ===========================================================================
// Phase 1-3: CSS Nesting
// ===========================================================================

Deno.test('nesting - basic nested rule', () => {
  const result = parseStyleBlock('.card { width: 30; .title { font-weight: bold; } }');
  assertEquals(result.items.length, 2);
  // Parent: .card { width: 30 }
  assertEquals(result.items[0].selector.segments.length, 1);
  assertEquals(result.items[0].selector.segments[0].compound.parts[0].value, 'card');
  assertEquals(result.items[0].style.width, 30);
  // Child: .card .title { font-weight: bold }
  assertEquals(result.items[1].selector.segments.length, 2);
  assertEquals(result.items[1].selector.segments[0].compound.parts[0].value, 'card');
  assertEquals(result.items[1].selector.segments[1].combinator, 'descendant');
  assertEquals(result.items[1].selector.segments[1].compound.parts[0].value, 'title');
  assertEquals(result.items[1].style.fontWeight, 'bold');
});

Deno.test('nesting - & with descendant', () => {
  const result = parseStyleBlock('.card { & .title { width: 5; } }');
  assertEquals(result.items.length, 1);
  const sel = result.items[0].selector;
  assertEquals(sel.segments.length, 2);
  assertEquals(sel.segments[0].compound.parts[0].value, 'card');
  assertEquals(sel.segments[1].compound.parts[0].value, 'title');
});

Deno.test('nesting - &.compound merges with parent', () => {
  const result = parseStyleBlock('.card { &.active { width: 10; } }');
  assertEquals(result.items.length, 1);
  const sel = result.items[0].selector;
  // Should be a single segment: .card.active
  assertEquals(sel.segments.length, 1);
  assertEquals(sel.segments[0].compound.parts.length, 2);
  assertEquals(sel.segments[0].compound.parts[0].value, 'card');
  assertEquals(sel.segments[0].compound.parts[1].value, 'active');
});

Deno.test('nesting - & with child combinator', () => {
  const result = parseStyleBlock('.card { & > .footer { height: 3; } }');
  assertEquals(result.items.length, 1);
  const sel = result.items[0].selector;
  assertEquals(sel.segments.length, 2);
  assertEquals(sel.segments[0].compound.parts[0].value, 'card');
  assertEquals(sel.segments[1].combinator, 'child');
  assertEquals(sel.segments[1].compound.parts[0].value, 'footer');
});

Deno.test('nesting - &:hover pseudo-class', () => {
  const result = parseStyleBlock('.card { &:hover { width: 20; } }');
  assertEquals(result.items.length, 1);
  const seg = result.items[0].selector.segments[0];
  assertEquals(seg.compound.parts[0].value, 'card');
  assertEquals(seg.compound.pseudoClasses, ['hover']);
});

Deno.test('nesting - deep nesting (3 levels)', () => {
  const result = parseStyleBlock('.a { .b { .c { width: 1; } } }');
  assertEquals(result.items.length, 1);
  const sel = result.items[0].selector;
  assertEquals(sel.segments.length, 3);
  assertEquals(sel.segments[0].compound.parts[0].value, 'a');
  assertEquals(sel.segments[1].compound.parts[0].value, 'b');
  assertEquals(sel.segments[2].compound.parts[0].value, 'c');
});

Deno.test('nesting - properties before and after nested block', () => {
  const result = parseStyleBlock('.card { width: 30; .title { height: 5; } padding: 2; }');
  // .card gets both width and padding
  assertEquals(result.items.length, 2);
  assertEquals(result.items[0].style.width, 30);
  assertEquals(result.items[0].style.padding, 2);
  // .card .title gets height
  assertEquals(result.items[1].style.height, 5);
});

Deno.test('nesting - multiple nested blocks', () => {
  const result = parseStyleBlock('.card { .title { width: 10; } .body { height: 5; } }');
  assertEquals(result.items.length, 2);
  assertEquals(result.items[0].selector.segments[1].compound.parts[0].value, 'title');
  assertEquals(result.items[0].style.width, 10);
  assertEquals(result.items[1].selector.segments[1].compound.parts[0].value, 'body');
  assertEquals(result.items[1].style.height, 5);
});

Deno.test('nesting - comma parent with nested child', () => {
  const result = parseStyleBlock('.card, .panel { .title { width: 10; } }');
  assertEquals(result.items.length, 2);
  // .card .title
  assertEquals(result.items[0].selector.segments[0].compound.parts[0].value, 'card');
  assertEquals(result.items[0].selector.segments[1].compound.parts[0].value, 'title');
  // .panel .title
  assertEquals(result.items[1].selector.segments[0].compound.parts[0].value, 'panel');
  assertEquals(result.items[1].selector.segments[1].compound.parts[0].value, 'title');
});

Deno.test('nesting - empty nested block produces no items', () => {
  const result = parseStyleBlock('.card { .title { } }');
  assertEquals(result.items.length, 0);
});

Deno.test('nesting - only nested blocks, no direct properties', () => {
  const result = parseStyleBlock('.card { .title { width: 5; } }');
  assertEquals(result.items.length, 1);
  assertEquals(result.items[0].selector.segments.length, 2);
  assertEquals(result.items[0].style.width, 5);
});

Deno.test('nesting - element matching with nested rules', () => {
  const ss = new Stylesheet();
  ss.addFromString('.card { width: 30; .title { font-weight: bold; } }');
  const card = el('container', { classes: ['card'] });
  const title = el('text', { classes: ['title'] });
  assertEquals(ss.getMergedStyle(card).width, 30);
  assertEquals(ss.getMergedStyle(title, [card]).fontWeight, 'bold');
  // title without card ancestor should not match
  assertEquals(ss.getMergedStyle(title).fontWeight, undefined);
});

Deno.test('nesting - type selector nested', () => {
  const result = parseStyleBlock('.card { text { dim: true; } }');
  assertEquals(result.items.length, 1);
  const sel = result.items[0].selector;
  assertEquals(sel.segments[0].compound.parts[0].value, 'card');
  assertEquals(sel.segments[1].compound.parts[0].value, 'text');
});

Deno.test('nesting - complex parent selector preserved', () => {
  const result = parseStyleBlock('container > .card { .title { width: 5; } }');
  assertEquals(result.items.length, 1);
  const sel = result.items[0].selector;
  assertEquals(sel.segments.length, 3);
  assertEquals(sel.segments[0].compound.parts[0].value, 'container');
  assertEquals(sel.segments[1].combinator, 'child');
  assertEquals(sel.segments[1].compound.parts[0].value, 'card');
  assertEquals(sel.segments[2].combinator, 'descendant');
  assertEquals(sel.segments[2].compound.parts[0].value, 'title');
});

// ===========================================================================
// Phase 4: Nested at-rules
// ===========================================================================

Deno.test('nesting - @media inside rule', () => {
  const result = parseStyleBlock('.card { width: 30; @media (max-width: 80) { padding: 1; } }');
  // Direct property
  assertEquals(result.items.length, 2);
  assertEquals(result.items[0].style.width, 30);
  assertEquals(result.items[0].mediaCondition, undefined);
  // Nested @media rule: .card { padding: 1 } with media condition
  assertEquals(result.items[1].style.padding, 1);
  assertEquals(result.items[1].mediaCondition?.maxWidth, 80);
  assertEquals(result.items[1].selector.segments[0].compound.parts[0].value, 'card');
});

Deno.test('nesting - @media with nested rule inside', () => {
  const result = parseStyleBlock('.card { @media (max-width: 80) { .title { width: 5; } } }');
  assertEquals(result.items.length, 1);
  assertEquals(result.items[0].mediaCondition?.maxWidth, 80);
  assertEquals(result.items[0].selector.segments.length, 2);
  assertEquals(result.items[0].selector.segments[0].compound.parts[0].value, 'card');
  assertEquals(result.items[0].selector.segments[1].compound.parts[0].value, 'title');
});

Deno.test('nesting - @container inside rule', () => {
  const result = parseStyleBlock('.card { @container (min-width: 40) { padding: 2; } }');
  assertEquals(result.containerItems.length, 1);
  assertEquals(result.containerItems[0].style.padding, 2);
  assertEquals(result.containerItems[0].containerCondition?.minWidth, 40);
  assertEquals(result.containerItems[0].selector.segments[0].compound.parts[0].value, 'card');
});

Deno.test('nesting - @keyframes inside rule is global', () => {
  const result = parseStyleBlock('.card { @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } } }');
  assertEquals(result.keyframes.length, 1);
  assertEquals(result.keyframes[0].name, 'fadeIn');
  assertEquals(result.keyframes[0].keyframes.length, 2);
});

Deno.test('nesting - @media respects parent selector in matching', () => {
  const ss = new Stylesheet();
  ss.addFromString('.card { @media (max-width: 80) { width: 20; } }');
  const card = el('container', { classes: ['card'] });
  const ctx: StyleContext = { terminalWidth: 60, terminalHeight: 24 };
  // Should match: element is .card and terminal width <= 80
  assertEquals(ss.getMergedStyle(card, [], ctx).width, 20);
  // Should not match: terminal too wide
  const wideCtx: StyleContext = { terminalWidth: 100, terminalHeight: 24 };
  assertEquals(ss.getMergedStyle(card, [], wideCtx).width, undefined);
});

// ===========================================================================
// CSS Variables - Phase 1: resolveVarReferences()
// ===========================================================================

Deno.test('resolveVarReferences - no var passthrough', () => {
  const vars = new Map<string, string>();
  assertEquals(resolveVarReferences('hello', vars), 'hello');
});

Deno.test('resolveVarReferences - simple lookup', () => {
  const vars = new Map([['--x', 'blue']]);
  assertEquals(resolveVarReferences('var(--x)', vars), 'blue');
});

Deno.test('resolveVarReferences - missing no fallback', () => {
  const vars = new Map<string, string>();
  assertEquals(resolveVarReferences('var(--x)', vars), '');
});

Deno.test('resolveVarReferences - missing with fallback', () => {
  const vars = new Map<string, string>();
  assertEquals(resolveVarReferences('var(--x, red)', vars), 'red');
});

Deno.test('resolveVarReferences - present ignores fallback', () => {
  const vars = new Map([['--x', 'blue']]);
  assertEquals(resolveVarReferences('var(--x, red)', vars), 'blue');
});

Deno.test('resolveVarReferences - nested fallback both missing', () => {
  const vars = new Map<string, string>();
  assertEquals(resolveVarReferences('var(--a, var(--b, red))', vars), 'red');
});

Deno.test('resolveVarReferences - nested fallback inner hit', () => {
  const vars = new Map([['--b', 'green']]);
  assertEquals(resolveVarReferences('var(--a, var(--b, red))', vars), 'green');
});

Deno.test('resolveVarReferences - nested fallback outer hit', () => {
  const vars = new Map([['--a', 'blue']]);
  assertEquals(resolveVarReferences('var(--a, var(--b, red))', vars), 'blue');
});

Deno.test('resolveVarReferences - multiple var in value', () => {
  const vars = new Map([['--x', 'A'], ['--y', 'B']]);
  assertEquals(resolveVarReferences('10 var(--x) var(--y) 20', vars), '10 A B 20');
});

Deno.test('resolveVarReferences - var value contains var', () => {
  const vars = new Map([['--a', 'red'], ['--b', 'var(--a)']]);
  assertEquals(resolveVarReferences('var(--b)', vars), 'red');
});

Deno.test('resolveVarReferences - direct cycle', () => {
  const vars = new Map([['--a', 'var(--a)']]);
  assertEquals(resolveVarReferences('var(--a)', vars), '');
});

Deno.test('resolveVarReferences - direct cycle with fallback', () => {
  const vars = new Map([['--a', 'var(--a, blue)']]);
  assertEquals(resolveVarReferences('var(--a)', vars), 'blue');
});

Deno.test('resolveVarReferences - indirect cycle', () => {
  const vars = new Map([['--a', 'var(--b)'], ['--b', 'var(--a)']]);
  assertEquals(resolveVarReferences('var(--a)', vars), '');
});

Deno.test('resolveVarReferences - whitespace tolerance', () => {
  const vars = new Map<string, string>();
  assertEquals(resolveVarReferences('var(  --x  ,  red  )', vars), 'red');
});

Deno.test('resolveVarReferences - deeply nested fallbacks', () => {
  const vars = new Map<string, string>();
  assertEquals(resolveVarReferences('var(--a, var(--b, var(--c, red)))', vars), 'red');
});

// ===========================================================================
// CSS Variables - Phase 2: extractVariableDeclarations()
// ===========================================================================

Deno.test('extractVariableDeclarations - simple :root', () => {
  const decls = extractVariableDeclarations(':root { --x: 1; --y: blue; }');
  assertEquals(decls.length, 2);
  assertEquals(decls[0].name, '--x');
  assertEquals(decls[0].value, '1');
  assertEquals(decls[0].mediaCondition, undefined);
  assertEquals(decls[1].name, '--y');
  assertEquals(decls[1].value, 'blue');
});

Deno.test('extractVariableDeclarations - no variables', () => {
  const decls = extractVariableDeclarations('button { color: red; }');
  assertEquals(decls.length, 0);
});

Deno.test('extractVariableDeclarations - non-var props skipped', () => {
  const decls = extractVariableDeclarations(':root { --x: 1; color: white; font-weight: bold; }');
  assertEquals(decls.length, 1);
  assertEquals(decls[0].name, '--x');
  assertEquals(decls[0].value, '1');
});

Deno.test('extractVariableDeclarations - inside @media', () => {
  const decls = extractVariableDeclarations('@media (max-width: 80) { :root { --x: 1; } }');
  assertEquals(decls.length, 1);
  assertEquals(decls[0].name, '--x');
  assertEquals(decls[0].value, '1');
  assertEquals(decls[0].mediaCondition?.maxWidth, 80);
});

Deno.test('extractVariableDeclarations - mixed unconditional and media', () => {
  const decls = extractVariableDeclarations(`
    :root { --a: 10; }
    @media (max-width: 60) { :root { --a: 5; } }
  `);
  assertEquals(decls.length, 2);
  assertEquals(decls[0].name, '--a');
  assertEquals(decls[0].value, '10');
  assertEquals(decls[0].mediaCondition, undefined);
  assertEquals(decls[1].name, '--a');
  assertEquals(decls[1].value, '5');
  assertEquals(decls[1].mediaCondition?.maxWidth, 60);
});

Deno.test('extractVariableDeclarations - non-:root inside @media ignored', () => {
  const decls = extractVariableDeclarations('@media (max-width: 60) { button { --x: 1; } }');
  assertEquals(decls.length, 0);
});

Deno.test('extractVariableDeclarations - CSS comments stripped', () => {
  const decls = extractVariableDeclarations(':root { /* comment */ --x: 1; }');
  assertEquals(decls.length, 1);
  assertEquals(decls[0].name, '--x');
  assertEquals(decls[0].value, '1');
});

Deno.test('extractVariableDeclarations - :root.compound ignored', () => {
  const decls = extractVariableDeclarations(':root.dark { --x: 1; }');
  assertEquals(decls.length, 0);
});

Deno.test('extractVariableDeclarations - value with var ref preserved raw', () => {
  const decls = extractVariableDeclarations(':root { --x: var(--theme-primary); }');
  assertEquals(decls.length, 1);
  assertEquals(decls[0].name, '--x');
  assertEquals(decls[0].value, 'var(--theme-primary)');
});

Deno.test('extractVariableDeclarations - multiple @media blocks', () => {
  const decls = extractVariableDeclarations(`
    @media (min-width: 40) { :root { --x: 1; } }
    @media (min-width: 80) { :root { --x: 2; } }
  `);
  assertEquals(decls.length, 2);
  assertEquals(decls[0].value, '1');
  assertEquals(decls[0].mediaCondition?.minWidth, 40);
  assertEquals(decls[1].value, '2');
  assertEquals(decls[1].mediaCondition?.minWidth, 80);
});

// ============================================================================
// Phase 3: Theme Variable Auto-Population
// ============================================================================

// Theme tests require initThemes() to populate the THEMES registry
Deno.test('_buildThemeVars - init themes', async () => {
  await initThemes();
});

Deno.test('_buildThemeVars - all 29 palette entries populated', () => {
  const { vars } = Stylesheet._buildThemeVars();
  // ColorPalette has exactly 29 entries
  assertEquals(vars.size, Object.keys(getCurrentTheme().palette).length);
});

Deno.test('_buildThemeVars - kebab-case conversion for multi-word keys', () => {
  const { vars } = Stylesheet._buildThemeVars();
  assert(vars.has('--theme-input-background'));
  assert(vars.has('--theme-button-primary'));
  assert(vars.has('--theme-header-foreground'));
  assert(vars.has('--theme-scrollbar-thumb'));
});

Deno.test('_buildThemeVars - single-word keys unchanged', () => {
  const { vars } = Stylesheet._buildThemeVars();
  assert(vars.has('--theme-primary'));
  assert(vars.has('--theme-secondary'));
  assert(vars.has('--theme-background'));
  assert(vars.has('--theme-foreground'));
  assert(vars.has('--theme-surface'));
  assert(vars.has('--theme-border'));
});

Deno.test('_buildThemeVars - values are hex strings', () => {
  const { vars } = Stylesheet._buildThemeVars();
  const hexPattern = /^#[0-9a-f]{6}$/;
  for (const [key, value] of vars) {
    assert(hexPattern.test(value), `${key} value "${value}" is not a valid hex color`);
  }
});

Deno.test('_buildThemeVars - hex matches packed RGBA', () => {
  const { vars } = Stylesheet._buildThemeVars();
  const palette = getCurrentTheme().palette;
  const { r, g, b } = unpackRGBA(palette.primary);
  const expectedHex = rgbToHex(r, g, b);
  assertEquals(vars.get('--theme-primary'), expectedHex);
});

Deno.test('_buildThemeVars - resolveVarReferences uses theme vars', () => {
  const { vars } = Stylesheet._buildThemeVars();
  const result = resolveVarReferences('var(--theme-primary)', vars);
  const palette = getCurrentTheme().palette;
  const { r, g, b } = unpackRGBA(palette.primary);
  assertEquals(result, rgbToHex(r, g, b));
});

Deno.test('_buildThemeVars - user can override theme var', () => {
  const { vars } = Stylesheet._buildThemeVars();
  // User overrides --theme-primary
  vars.set('--theme-primary', '#FF0000');
  const result = resolveVarReferences('var(--theme-primary)', vars);
  assertEquals(result, '#FF0000');
});

Deno.test('_buildThemeVars - user can alias theme var', () => {
  const { vars } = Stylesheet._buildThemeVars();
  // User defines --accent as an alias for --theme-primary
  const themePrimary = vars.get('--theme-primary')!;
  vars.set('--accent', 'var(--theme-primary)');
  // Resolve the alias — the raw value contains var(), so resolve it
  const resolvedAlias = resolveVarReferences(vars.get('--accent')!, vars);
  vars.set('--accent', resolvedAlias);
  const result = resolveVarReferences('var(--accent)', vars);
  assertEquals(result, themePrimary);
});

// ============================================================================
// Phase 4: Wire var() Into parseStyleProperties and parseStyleBlock
// ============================================================================

Deno.test('parseStyleProperties - --* declarations are skipped', () => {
  const style = parseStyleProperties('--x: 1; width: 10');
  assertEquals(style.width, 10);
  assertEquals((style as Record<string, unknown>)['--x'], undefined);
});

Deno.test('parseStyleProperties - var resolved to number', () => {
  const vars = new Map([['--x', '10']]);
  const style = parseStyleProperties('width: var(--x)', vars);
  assertEquals(style.width, 10);
});

Deno.test('parseStyleProperties - var resolved to color', () => {
  const vars = new Map([['--c', '#FF0000']]);
  const style = parseStyleProperties('color: var(--c)', vars);
  assertEquals(style.color, parseColor('#FF0000'));
});

Deno.test('parseStyleProperties - var resolved to string', () => {
  const vars = new Map([['--b', 'single']]);
  const style = parseStyleProperties('border: var(--b)', vars);
  assertEquals(style.border, 'single');
});

Deno.test('parseStyleProperties - var in box spacing', () => {
  const vars = new Map([['--p', '2']]);
  const style = parseStyleProperties('padding: var(--p) var(--p)', vars);
  assertEquals(style.padding, { top: 2, right: 2, bottom: 2, left: 2 });
});

Deno.test('parseStyleProperties - var in animation shorthand', () => {
  const vars = new Map([['--name', 'fade'], ['--dur', '300ms']]);
  const style = parseStyleProperties('animation: var(--name) var(--dur) ease', vars);
  assertEquals(style.animationName, 'fade');
  assertEquals(style.animationDuration, 300);
  assertEquals(style.animationTimingFunction, 'ease');
});

Deno.test('parseStyleProperties - var in transition shorthand', () => {
  const vars = new Map([['--dur', '200ms']]);
  const style = parseStyleProperties('transition: color var(--dur) ease', vars);
  const specs = (style as Record<string, unknown>)._transitionSpecs as TransitionSpec[];
  assertEquals(specs[0].property, 'color');
  assertEquals(specs[0].duration, 200);
  assertEquals(specs[0].timingFn, 'ease');
});

Deno.test('parseStyleProperties - unresolved var skips property', () => {
  const vars = new Map<string, string>();
  const style = parseStyleProperties('width: var(--x)', vars);
  assertEquals(style.width, undefined);
});

Deno.test('parseStyleProperties - no variables param unchanged behavior', () => {
  const style = parseStyleProperties('width: 10');
  assertEquals(style.width, 10);
});

Deno.test('parseStyleBlock - threads variables to rules', () => {
  const vars = new Map([['--c', 'red']]);
  const result = parseStyleBlock('button { color: var(--c) }', vars);
  assertEquals(result.items.length, 1);
  assertEquals(result.items[0].style.color, parseColor('red'));
});

Deno.test('parseStyleBlock - var in @keyframes', () => {
  const vars = new Map([['--c', 'blue']]);
  const result = parseStyleBlock('@keyframes x { to { color: var(--c) } }', vars);
  assertEquals(result.keyframes.length, 1);
  assertEquals(result.keyframes[0].keyframes[0].style.color, parseColor('blue'));
});

Deno.test('parseStyleBlock - var in @media rule', () => {
  const vars = new Map([['--g', '3']]);
  const result = parseStyleBlock('@media (max-width: 80) { .x { gap: var(--g) } }', vars);
  assertEquals(result.items.length, 1);
  assertEquals(result.items[0].style.gap, 3);
  assert(result.items[0].mediaCondition !== undefined);
});

Deno.test('parseStyleBlock - var in @container rule', () => {
  const vars = new Map([['--g', '2']]);
  const result = parseStyleBlock('@container (min-width: 40) { .x { gap: var(--g) } }', vars);
  assertEquals(result.containerItems.length, 1);
  assertEquals(result.containerItems[0].style.gap, 2);
});

Deno.test('parseStyleBlock - var in nested rule', () => {
  const vars = new Map([['--c', 'blue']]);
  const result = parseStyleBlock('.card { .title { color: var(--c) } }', vars);
  assertEquals(result.items.length, 1);
  assertEquals(result.items[0].style.color, parseColor('blue'));
});

// ============================================================================
// Phase 5: Stylesheet Class Integration
// ============================================================================

Deno.test('Stylesheet - basic end-to-end var resolution', () => {
  const sheet = Stylesheet.fromString(':root { --x: 1; } button { width: var(--x); }');
  const buttonRule = sheet.items.find(item =>
    item.selector.segments[0]?.compound.parts[0]?.value === 'button'
  );
  assert(buttonRule !== undefined);
  assertEquals(buttonRule!.style.width, 1);
});

Deno.test('Stylesheet - color end-to-end', () => {
  const sheet = Stylesheet.fromString(':root { --c: #3B82F6; } button { color: var(--c); }');
  const buttonRule = sheet.items.find(item =>
    item.selector.segments[0]?.compound.parts[0]?.value === 'button'
  );
  assert(buttonRule !== undefined);
  assertEquals(buttonRule!.style.color, parseColor('#3B82F6'));
});

Deno.test('Stylesheet - fallback end-to-end', () => {
  const sheet = Stylesheet.fromString('button { color: var(--missing, red); }');
  const buttonRule = sheet.items.find(item =>
    item.selector.segments[0]?.compound.parts[0]?.value === 'button'
  );
  assert(buttonRule !== undefined);
  assertEquals(buttonRule!.style.color, parseColor('red'));
});

Deno.test('Stylesheet - nested fallback end-to-end', () => {
  const sheet = Stylesheet.fromString('button { color: var(--a, var(--b, red)); }');
  const buttonRule = sheet.items.find(item =>
    item.selector.segments[0]?.compound.parts[0]?.value === 'button'
  );
  assert(buttonRule !== undefined);
  assertEquals(buttonRule!.style.color, parseColor('red'));
});

Deno.test('Stylesheet - --* not in style output', () => {
  const sheet = Stylesheet.fromString(':root { --x: 1; color: white; }');
  // :root rule should have color but no --x property
  for (const item of sheet.items) {
    assertEquals((item.style as Record<string, unknown>)['--x'], undefined);
  }
});

Deno.test('Stylesheet - non-:root --* ignored as variable source', () => {
  const sheet = Stylesheet.fromString('button { --x: 1; width: var(--x); }');
  const buttonRule = sheet.items.find(item =>
    item.selector.segments[0]?.compound.parts[0]?.value === 'button'
  );
  assert(buttonRule !== undefined);
  // --x declared in button (not :root) so not in variable set → width unresolved
  assertEquals(buttonRule!.style.width, undefined);
});

Deno.test('Stylesheet - multiple addFromString forward reference', () => {
  const sheet = new Stylesheet();
  sheet.addFromString('button { color: var(--c); }');
  sheet.addFromString(':root { --c: blue; }');
  // After second addFromString, re-parse resolves --c in button rule
  const buttonRule = sheet.items.find(item =>
    item.selector.segments[0]?.compound.parts[0]?.value === 'button'
  );
  assert(buttonRule !== undefined);
  assertEquals(buttonRule!.style.color, parseColor('blue'));
});

Deno.test('Stylesheet - addRule survives re-parse', () => {
  const sheet = new Stylesheet();
  sheet.addRule('text', { width: 5 });
  sheet.addFromString(':root { --x: 1; }');
  // Programmatic rule should still be present after re-parse
  const textRule = sheet.items.find(item =>
    item.selector.segments[0]?.compound.parts[0]?.value === 'text'
  );
  assert(textRule !== undefined);
  assertEquals(textRule!.style.width, 5);
});

Deno.test('Stylesheet - addItem survives re-parse', () => {
  const sheet = new Stylesheet();
  const item = {
    selector: parseSelector('text'),
    style: { width: 7 } as Style,
    specificity: 1,
  };
  sheet.addItem(item);
  sheet.addFromString(':root { --x: 1; }');
  const textRule = sheet.items.find(it =>
    it.selector.segments[0]?.compound.parts[0]?.value === 'text'
  );
  assert(textRule !== undefined);
  assertEquals(textRule!.style.width, 7);
});

Deno.test('Stylesheet - _hasMediaVars false for unconditional vars', () => {
  const sheet = Stylesheet.fromString(':root { --x: 1; }');
  // deno-lint-ignore no-explicit-any
  assertEquals((sheet as any)._hasMediaVars, false);
});

Deno.test('Stylesheet - _hasMediaVars true for media vars', () => {
  const sheet = Stylesheet.fromString('@media (max-width: 80) { :root { --x: 1; } }');
  // deno-lint-ignore no-explicit-any
  assertEquals((sheet as any)._hasMediaVars, true);
});

Deno.test('Stylesheet - media var with no ctx uses fallback', () => {
  const sheet = Stylesheet.fromString(`
    @media (max-width: 80) { :root { --x: 1; } }
    button { width: var(--x, 5); }
  `);
  const buttonRule = sheet.items.find(item =>
    item.selector.segments[0]?.compound.parts[0]?.value === 'button'
  );
  assert(buttonRule !== undefined);
  // No ctx → media var skipped → fallback 5
  assertEquals(buttonRule!.style.width, 5);
});

Deno.test('Stylesheet - media var with matching ctx resolves', () => {
  const sheet = Stylesheet.fromString(`
    @media (max-width: 80) { :root { --x: 1; } }
    button { width: var(--x, 5); }
  `);
  const el = createElement('button');
  sheet.applyTo(el, { terminalWidth: 60, terminalHeight: 24 });
  // ctx width 60 ≤ 80 → media matches → --x = 1
  assertEquals(el.props.style?.width, 1);
});

Deno.test('Stylesheet - media var with non-matching ctx uses fallback', () => {
  const sheet = Stylesheet.fromString(`
    @media (max-width: 80) { :root { --x: 1; } }
    button { width: var(--x, 5); }
  `);
  const el = createElement('button');
  sheet.applyTo(el, { terminalWidth: 100, terminalHeight: 24 });
  // ctx width 100 > 80 → media doesn't match → fallback 5
  assertEquals(el.props.style?.width, 5);
});

Deno.test('Stylesheet - resize re-parses media vars', () => {
  const sheet = Stylesheet.fromString(`
    @media (max-width: 80) { :root { --x: 1; } }
    button { width: var(--x, 5); }
  `);
  const el = createElement('button');
  // First apply: width 100 → media miss → fallback 5
  sheet.applyTo(el, { terminalWidth: 100, terminalHeight: 24 });
  assertEquals(el.props.style?.width, 5);
  // Second apply: width 60 → media hit → 1
  // No reset needed — origin tracking diffs correctly on re-apply
  sheet.applyTo(el, { terminalWidth: 60, terminalHeight: 24 });
  assertEquals(el.props.style?.width, 1);
});

Deno.test('Stylesheet - no re-parse without media vars on ctx change', () => {
  const sheet = Stylesheet.fromString(':root { --x: 1; } button { width: var(--x); }');
  // deno-lint-ignore no-explicit-any
  const s = sheet as any;
  assertEquals(s._hasMediaVars, false);
  const el = createElement('button');
  sheet.applyTo(el, { terminalWidth: 80, terminalHeight: 24 });
  assertEquals(el.props.style?.width, 1);
  // Applying with different ctx should NOT trigger re-parse (no media vars)
  const varsBefore = s._variables;
  el._inlineStyle = undefined;
  el._computedStyle = undefined;
  sheet.applyTo(el, { terminalWidth: 60, terminalHeight: 24 });
  // _variables should be the same object (no re-parse happened)
  assert(s._variables === varsBefore);
});

Deno.test('Stylesheet - unconditional + media override', () => {
  const css = `
    :root { --x: 10; }
    @media (max-width: 60) { :root { --x: 5; } }
    button { width: var(--x); }
  `;
  const sheet = Stylesheet.fromString(css);
  const el1 = createElement('button');
  sheet.applyTo(el1, { terminalWidth: 50, terminalHeight: 24 });
  // width 50 ≤ 60 → media matches → --x overridden to 5
  assertEquals(el1.props.style?.width, 5);

  const el2 = createElement('button');
  sheet.applyTo(el2, { terminalWidth: 80, terminalHeight: 24 });
  // width 80 > 60 → media miss → --x stays 10
  assertEquals(el2.props.style?.width, 10);
});

Deno.test('Stylesheet - clear resets all state', () => {
  const sheet = Stylesheet.fromString(`
    :root { --x: 1; }
    @media (max-width: 80) { :root { --y: 2; } }
    button { width: var(--x); }
  `);
  sheet.addRule('text', { width: 5 });
  sheet.clear();
  // deno-lint-ignore no-explicit-any
  const s = sheet as any;
  assertEquals(s._rawCSS.length, 0);
  assertEquals(s._variableDecls.length, 0);
  assertEquals(s._directItems.length, 0);
  assertEquals(s._hasMediaVars, false);
  assertEquals(s._lastCtx, undefined);
  assertEquals(sheet.items.length, 0);
  assertEquals(sheet.length, 0);
  // _variables should be reset to theme vars
  assertEquals(s._variables.size, s._themeVars.size);
});

Deno.test('Stylesheet - theme vars available without :root', async () => {
  await initThemes();
  const sheet = Stylesheet.fromString('button { color: var(--theme-primary); }');
  const buttonRule = sheet.items.find(item =>
    item.selector.segments[0]?.compound.parts[0]?.value === 'button'
  );
  assert(buttonRule !== undefined);
  const palette = getCurrentTheme().palette;
  assertEquals(buttonRule!.style.color, palette.primary);
});

Deno.test('Stylesheet - var in @keyframes end-to-end', () => {
  const sheet = Stylesheet.fromString(`
    :root { --c: blue; }
    @keyframes x { to { color: var(--c); } }
  `);
  const kf = sheet.getKeyframes('x');
  assert(kf !== undefined);
  assertEquals(kf!.keyframes[0].style.color, parseColor('blue'));
});

Deno.test('Stylesheet - var in transition shorthand end-to-end', () => {
  const sheet = Stylesheet.fromString(`
    :root { --dur: 300ms; }
    button { transition: color var(--dur) ease; }
  `);
  const buttonRule = sheet.items.find(item =>
    item.selector.segments[0]?.compound.parts[0]?.value === 'button'
  );
  assert(buttonRule !== undefined);
  const specs = (buttonRule!.style as Record<string, unknown>)._transitionSpecs as TransitionSpec[];
  assert(specs !== undefined);
  assertEquals(specs[0].property, 'color');
  assertEquals(specs[0].duration, 300);
});

Deno.test('Stylesheet - var in @container rule end-to-end', () => {
  const sheet = Stylesheet.fromString(`
    :root { --g: 2; }
    @container (min-width: 40) { .x { gap: var(--g); } }
  `);
  assertEquals(sheet.containerItems.length, 1);
  assertEquals(sheet.containerItems[0].style.gap, 2);
});
