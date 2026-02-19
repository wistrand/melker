// Tests for LSP server functions

import { assertEquals, assert, assertExists } from 'jsr:@std/assert';
import { _testing } from '../src/lsp.ts';
import { DiagnosticSeverity, CodeActionKind } from 'npm:vscode-languageserver@9.0.1/node.js';

const {
  validateDocument,
  getHover,
  getCompletions,
  getDocumentSymbols,
  getFoldingRanges,
  getCodeActions,
  getLinkedEditingRanges,
  getDocumentLinks,
  extractColors,
  getColorPresentations,
  getDefinition,
  levenshteinDistance,
  findSimilarNames,
} = _testing;

// ============================================================================
// levenshteinDistance
// ============================================================================

Deno.test('levenshteinDistance: identical strings', () => {
  assertEquals(levenshteinDistance('abc', 'abc'), 0);
});

Deno.test('levenshteinDistance: single edit', () => {
  assertEquals(levenshteinDistance('cat', 'car'), 1);
});

Deno.test('levenshteinDistance: empty string', () => {
  assertEquals(levenshteinDistance('', 'abc'), 3);
  assertEquals(levenshteinDistance('abc', ''), 3);
});

Deno.test('findSimilarNames: finds close matches', () => {
  const result = findSimilarNames('colr', ['color', 'column', 'background']);
  assert(result.includes('color'));
});

Deno.test('findSimilarNames: no matches for distant strings', () => {
  const result = findSimilarNames('xyz', ['color', 'background', 'border']);
  assertEquals(result.length, 0);
});

// ============================================================================
// validateDocument - diagnostics
// ============================================================================

Deno.test('validateDocument: no diagnostics for valid document', () => {
  const text = '<container><text>Hello</text></container>';
  const diags = validateDocument(text);
  assertEquals(diags.length, 0);
});

Deno.test('validateDocument: unknown element warning', () => {
  const text = '<foobar>test</foobar>';
  const diags = validateDocument(text);
  assert(diags.some(d => d.message.includes('Unknown element')));
});

Deno.test('validateDocument: unknown prop warning', () => {
  const text = '<container fakeattr="x"></container>';
  const diags = validateDocument(text);
  assert(diags.some(d => d.message.includes('Unknown property') && d.code === 'unknown-prop'));
});

Deno.test('validateDocument: style-as-prop warning', () => {
  const text = '<container flexDirection="row"></container>';
  const diags = validateDocument(text);
  assert(diags.some(d => d.code === 'style-as-prop'));
});

Deno.test('validateDocument: invalid enum value', () => {
  const text = '<container style="border: foobar"></container>';
  const diags = validateDocument(text);
  assert(diags.some(d => d.code === 'invalid-enum-value'));
});

Deno.test('validateDocument: no warning for valid policy keys', () => {
  const text = '<policy>{"name":"app","version":"1","description":"d","comment":"c","permissions":{},"config":{},"configSchema":{}}</policy>';
  const diags = validateDocument(text);
  const policyDiags = diags.filter(d => d.message.includes('policy'));
  assertEquals(policyDiags.length, 0);
});

Deno.test('validateDocument: no warning for sys permission', () => {
  const text = '<policy>{"permissions":{"sys":["hostname","osRelease"]}}</policy>';
  const diags = validateDocument(text);
  const sysDiags = diags.filter(d => d.message.includes('sys'));
  assertEquals(sysDiags.length, 0);
});

Deno.test('validateDocument: no warning for help tag', () => {
  const text = '<help>Some help text</help>';
  const diags = validateDocument(text);
  const helpDiags = diags.filter(d => d.message.includes('help') || d.message.includes('Unknown element'));
  assertEquals(helpDiags.length, 0);
});

Deno.test('validateDocument: no warning for help src attr', () => {
  const text = '<help src="help.md"></help>';
  const diags = validateDocument(text);
  assertEquals(diags.length, 0);
});

Deno.test('validateDocument: no warning for oauth debug-server', () => {
  const text = '<oauth wellknown="https://example.com" client-id="id" debug-server></oauth>';
  const diags = validateDocument(text);
  const debugDiags = diags.filter(d => d.message.includes('debug-server'));
  assertEquals(debugDiags.length, 0);
});

Deno.test('validateDocument: unknown style property in style attribute', () => {
  const text = '<container style="fake-prop: value"></container>';
  const diags = validateDocument(text);
  assert(diags.some(d => d.code === 'unknown-style'));
});

// ============================================================================
// getDocumentSymbols
// ============================================================================

Deno.test('getDocumentSymbols: returns symbols for elements', () => {
  const text = '<container id="main"><text>Hello</text></container>';
  const symbols = getDocumentSymbols(text);
  assertEquals(symbols.length, 1);
  assertEquals(symbols[0].name, '<container>');
  assertEquals(symbols[0].detail, '#main');
  assert(symbols[0].children && symbols[0].children.length > 0);
});

Deno.test('getDocumentSymbols: style tag shows CSS selectors', () => {
  const text = '<style>.foo { color: red; }\n#bar { border: thin; }</style>';
  const symbols = getDocumentSymbols(text);
  assertEquals(symbols.length, 1);
  assertEquals(symbols[0].name, '<style>');
  assert(symbols[0].children && symbols[0].children.length >= 2);
  assert(symbols[0].children!.some(c => c.name === '.foo'));
  assert(symbols[0].children!.some(c => c.name === '#bar'));
});

Deno.test('getDocumentSymbols: empty document', () => {
  const symbols = getDocumentSymbols('');
  assertEquals(symbols.length, 0);
});

// ============================================================================
// getFoldingRanges
// ============================================================================

Deno.test('getFoldingRanges: multi-line element creates range', () => {
  const text = '<container>\n  <text>Hello</text>\n</container>';
  const ranges = getFoldingRanges(text);
  assert(ranges.length >= 1);
  assertEquals(ranges[0].startLine, 0);
  assertEquals(ranges[0].endLine, 2);
});

Deno.test('getFoldingRanges: single-line element no range', () => {
  const text = '<text>Hello</text>';
  const ranges = getFoldingRanges(text);
  assertEquals(ranges.length, 0);
});

Deno.test('getFoldingRanges: CSS blocks in style tag', () => {
  const text = '<style>\n.foo {\n  color: red;\n}\n</style>';
  const ranges = getFoldingRanges(text);
  // Should have range for <style> and for .foo { }
  assert(ranges.length >= 2);
});

// ============================================================================
// getLinkedEditingRanges
// ============================================================================

Deno.test('getLinkedEditingRanges: cursor on open tag name', () => {
  const text = '<container>content</container>';
  // Cursor on 'c' of 'container' in the open tag (offset 1)
  const result = getLinkedEditingRanges(text, { line: 0, character: 1 });
  assertExists(result);
  assertEquals(result!.ranges.length, 2);
});

Deno.test('getLinkedEditingRanges: cursor on close tag name', () => {
  const text = '<container>content</container>';
  // Cursor in the close tag name (offset = len('<container>content</') = 20, + 1 into 'container')
  const result = getLinkedEditingRanges(text, { line: 0, character: 21 });
  assertExists(result);
  assertEquals(result!.ranges.length, 2);
});

Deno.test('getLinkedEditingRanges: cursor not in tag name returns null', () => {
  const text = '<container>content</container>';
  // Cursor in the content
  const result = getLinkedEditingRanges(text, { line: 0, character: 12 });
  assertEquals(result, null);
});

Deno.test('getLinkedEditingRanges: self-closing tag returns null', () => {
  // Self-closing tags have no close tag to link
  const text = '<text>hi</text>';
  // Cursor in content area, not in tag name
  const result = getLinkedEditingRanges(text, { line: 0, character: 7 });
  assertEquals(result, null);
});

// ============================================================================
// getDocumentLinks
// ============================================================================

Deno.test('getDocumentLinks: finds src attribute', () => {
  const text = '<script src="app.ts"></script>';
  const links = getDocumentLinks(text, 'file:///project/test.melker');
  assert(links.length >= 1);
  assert(links[0].target?.includes('app.ts'));
});

Deno.test('getDocumentLinks: finds href attribute', () => {
  const text = '<container href="https://example.com"></container>';
  const links = getDocumentLinks(text, 'file:///project/test.melker');
  assert(links.length >= 1);
  assertEquals(links[0].target, 'https://example.com');
});

Deno.test('getDocumentLinks: no links in plain text', () => {
  const text = '<text>Hello world</text>';
  const links = getDocumentLinks(text, 'file:///project/test.melker');
  assertEquals(links.length, 0);
});

// ============================================================================
// extractColors
// ============================================================================

Deno.test('extractColors: finds named color in inline style', () => {
  const text = '<text style="color: red">Hello</text>';
  const colors = extractColors(text);
  assert(colors.length >= 1);
  // Red should be approximately {red: 1, green: 0, blue: 0, alpha: 1}
  assertEquals(colors[0].color.red, 1);
  assertEquals(colors[0].color.green, 0);
  assertEquals(colors[0].color.blue, 0);
});

Deno.test('extractColors: finds hex color in inline style', () => {
  const text = '<text style="color: #00ff00">Hello</text>';
  const colors = extractColors(text);
  assert(colors.length >= 1);
  assertEquals(colors[0].color.green, 1);
});

Deno.test('extractColors: finds color in style block', () => {
  const text = '<style>text { color: blue; }</style>';
  const colors = extractColors(text);
  assert(colors.length >= 1);
  assertEquals(colors[0].color.blue, 1);
});

Deno.test('extractColors: ignores non-color properties', () => {
  const text = '<text style="border: thin">Hello</text>';
  const colors = extractColors(text);
  assertEquals(colors.length, 0);
});

Deno.test('extractColors: skips var() references', () => {
  const text = '<text style="color: var(--theme-primary)">Hello</text>';
  const colors = extractColors(text);
  assertEquals(colors.length, 0);
});

// ============================================================================
// getColorPresentations
// ============================================================================

Deno.test('getColorPresentations: returns hex and rgb', () => {
  const presentations = getColorPresentations({ red: 1, green: 0, blue: 0, alpha: 1 });
  assert(presentations.length >= 2);
  assert(presentations.some(p => p.label.startsWith('#')));
  assert(presentations.some(p => p.label.startsWith('rgb(')));
});

Deno.test('getColorPresentations: includes rgba for translucent colors', () => {
  const presentations = getColorPresentations({ red: 1, green: 0, blue: 0, alpha: 0.5 });
  assert(presentations.some(p => p.label.startsWith('rgba(')));
});

// ============================================================================
// getDefinition
// ============================================================================

Deno.test('getDefinition: id attr to CSS selector', () => {
  const text = '<style>#main { color: red; }</style>\n<container id="main"></container>';
  // Cursor on "main" in id="main" — find the attr value position
  // '<style>#main { color: red; }</style>\n<container id="' = 53 chars, 'main' starts at char 53 on line 1
  const result = getDefinition(text, { line: 1, character: 18 }, 'file:///test.melker');
  assertExists(result);
  assert(Array.isArray(result));
  assert((result as unknown[]).length >= 1);
});

Deno.test('getDefinition: CSS #id to element', () => {
  const text = '<style>#main { color: red; }</style>\n<container id="main"></container>';
  // Cursor on "#main" in <style> — position in first line, char 7 = 'm' of '#main'
  const result = getDefinition(text, { line: 0, character: 8 }, 'file:///test.melker');
  assertExists(result);
  assert(Array.isArray(result));
  assert((result as unknown[]).length >= 1);
});

Deno.test('getDefinition: CSS .class to element', () => {
  const text = '<style>.highlight { color: red; }</style>\n<text class="highlight">Hi</text>';
  // Cursor on ".highlight" in <style> — char 8 = 'h'
  const result = getDefinition(text, { line: 0, character: 8 }, 'file:///test.melker');
  assertExists(result);
  assert(Array.isArray(result));
  assert((result as unknown[]).length >= 1);
});

Deno.test('getDefinition: class attr to CSS selector', () => {
  const text = '<style>.highlight { color: red; }</style>\n<text class="highlight">Hi</text>';
  // Cursor on "highlight" in class="highlight" — line 1, inside the value
  const result = getDefinition(text, { line: 1, character: 14 }, 'file:///test.melker');
  assertExists(result);
  assert(Array.isArray(result));
  assert((result as unknown[]).length >= 1);
});

Deno.test('getDefinition: CSS type selector to element', () => {
  const text = '<style>button { color: red; }</style>\n<button>Click</button>';
  // Cursor on "button" in <style> — char 1
  const result = getDefinition(text, { line: 0, character: 8 }, 'file:///test.melker');
  assertExists(result);
  assert(Array.isArray(result));
  assert((result as unknown[]).length >= 1);
});

Deno.test('getDefinition: returns null for cursor in content', () => {
  const text = '<text>Hello world</text>';
  const result = getDefinition(text, { line: 0, character: 8 }, 'file:///test.melker');
  assertEquals(result, null);
});

// ============================================================================
// getHover
// ============================================================================

Deno.test('getHover: element tag name shows hover', () => {
  const text = '<container></container>';
  const hover = getHover(text, { line: 0, character: 2 });
  assertExists(hover);
  assert(hover!.contents !== undefined);
});

Deno.test('getHover: returns null for text content', () => {
  const text = '<text>Hello world</text>';
  const hover = getHover(text, { line: 0, character: 8 });
  assertEquals(hover, null);
});

// ============================================================================
// getCompletions
// ============================================================================

Deno.test('getCompletions: element names after <', () => {
  const text = '<';
  const completions = getCompletions(text, { line: 0, character: 1 });
  assert(completions.length > 0);
  assert(completions.some(c => c.label === 'container'));
  assert(completions.some(c => c.label === 'text'));
});

Deno.test('getCompletions: includes special tags', () => {
  const text = '<';
  const completions = getCompletions(text, { line: 0, character: 1 });
  assert(completions.some(c => c.label === 'script'));
  assert(completions.some(c => c.label === 'style'));
  assert(completions.some(c => c.label === 'help'));
  assert(completions.some(c => c.label === 'policy'));
  assert(completions.some(c => c.label === 'oauth'));
});

Deno.test('getCompletions: style property names in style attribute', () => {
  const text = '<container style=""></container>';
  // Cursor inside style="" — position after the opening quote
  const completions = getCompletions(text, { line: 0, character: 18 });
  assert(completions.length > 0);
  assert(completions.some(c => c.label === 'flex-direction'));
  assert(completions.some(c => c.label === 'border'));
});

Deno.test('getCompletions: color completions for color property value', () => {
  const text = '<container style="color: "></container>';
  const completions = getCompletions(text, { line: 0, character: 24 });
  assert(completions.some(c => c.label === 'red'));
  assert(completions.some(c => c.label === 'blue'));
  assert(completions.some(c => c.label === '#rrggbb'));
  assert(completions.some(c => c.label === 'rgb(r, g, b)'));
  assert(completions.some(c => c.label === 'hsl(h, s%, l%)'));
  assert(completions.some(c => c.label === 'oklch(L C H)'));
});

// ============================================================================
// getCodeActions
// ============================================================================

Deno.test('getCodeActions: style-as-prop quick fix', () => {
  const text = '<container flexDirection="row"></container>';
  const diags = validateDocument(text);
  const styleAsProp = diags.find(d => d.code === 'style-as-prop');
  assertExists(styleAsProp);

  const actions = getCodeActions(text, {
    textDocument: { uri: 'file:///test.melker' },
    range: styleAsProp!.range,
    context: { diagnostics: [styleAsProp!] },
  });
  assert(actions.length >= 1);
  assert(actions[0].title.includes('style'));
});

Deno.test('getCodeActions: invalid-enum-value suggests alternatives', () => {
  const text = '<container style="border: foobar"></container>';
  const diags = validateDocument(text);
  const enumDiag = diags.find(d => d.code === 'invalid-enum-value');
  assertExists(enumDiag);

  const actions = getCodeActions(text, {
    textDocument: { uri: 'file:///test.melker' },
    range: enumDiag!.range,
    context: { diagnostics: [enumDiag!] },
  });
  assert(actions.length >= 1);
  // Should suggest valid border values like 'thin', 'single', etc.
  assert(actions.some(a => a.title.includes('Change to')));
});

Deno.test('getCodeActions: unknown-style suggests similar names', () => {
  const text = '<container style="colr: red"></container>';
  const diags = validateDocument(text);
  const unknownStyle = diags.find(d => d.code === 'unknown-style');
  assertExists(unknownStyle);

  const actions = getCodeActions(text, {
    textDocument: { uri: 'file:///test.melker' },
    range: unknownStyle!.range,
    context: { diagnostics: [unknownStyle!] },
  });
  assert(actions.length >= 1);
  assert(actions.some(a => a.title.includes('color')));
});
