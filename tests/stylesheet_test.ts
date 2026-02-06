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
} from '../mod.ts';

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
  const items = parseStyleBlock('button { border: thin; }');
  assertEquals(items.length, 1);
  assertEquals(items[0].style.border, 'thin');
  assertEquals(items[0].selector.segments[0].compound.parts[0].value, 'button');
});

Deno.test('parseStyleBlock - multiple rules', () => {
  const items = parseStyleBlock(`
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
  assertEquals(parseStyleBlock('').length, 0);
});

Deno.test('parseStyleBlock - block comments stripped', () => {
  const items = parseStyleBlock(`
    /* This is a comment */
    button { border: thin; }
    /* Another comment */
  `);
  assertEquals(items.length, 1);
  assertEquals(items[0].style.border, 'thin');
});

Deno.test('parseStyleBlock - single-line comments stripped', () => {
  const items = parseStyleBlock(`
    // This is a comment
    button { border: thin; }
  `);
  assertEquals(items.length, 1);
});

Deno.test('parseStyleBlock - rule with multiple properties', () => {
  const items = parseStyleBlock(`
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
  const items = parseStyleBlock('container .card { border: thin; }');
  assertEquals(items.length, 1);
  assertEquals(items[0].selector.segments.length, 2);
  assertEquals(items[0].selector.segments[1].combinator, 'descendant');
});

Deno.test('parseStyleBlock - child selector in rule', () => {
  const items = parseStyleBlock('container > button { border: thin; }');
  assertEquals(items.length, 1);
  assertEquals(items[0].selector.segments.length, 2);
  assertEquals(items[0].selector.segments[1].combinator, 'child');
});

Deno.test('parseStyleBlock - empty rule body skipped', () => {
  const items = parseStyleBlock('button { }');
  assertEquals(items.length, 0);
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

Deno.test('id selector is more specific than type (last-wins cascade)', () => {
  // No specificity weighting — last matching rule wins
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
