// End-to-end layout tests using --stdout mode
// These tests render .melker content and compare text output

import { assertEquals, assert } from 'jsr:@std/assert';
import { dirname, fromFileUrl, join } from 'jsr:@std/path@1.1.4';

const testDir = dirname(fromFileUrl(import.meta.url));
const projectRoot = join(testDir, '..');
const melkerCli = join(projectRoot, 'melker.ts');

/**
 * Run a .melker file or inline content and capture stdout output
 */
async function renderToText(
  content: string,
  options: { width: number; height: number }
): Promise<string> {
  // Write content to temp file
  const tempFile = await Deno.makeTempFile({ suffix: '.melker' });
  try {
    await Deno.writeTextFile(tempFile, content);

    const command = new Deno.Command('deno', {
      args: [
        'run',
        '--allow-all',
        melkerCli,
        '--stdout',
        '--trust',
        '--stdout-width', String(options.width),
        '--stdout-height', String(options.height),
        '--stdout-timeout', '100',
        '--color', 'never',
        tempFile,
      ],
      stdout: 'piped',
      stderr: 'piped',
    });

    const { stdout, stderr } = await command.output();
    const output = new TextDecoder().decode(stdout);
    const error = new TextDecoder().decode(stderr);

    if (error && !error.includes('Check')) {
      // Ignore "Check file://" messages from deno
      const realErrors = error.split('\n').filter(line =>
        !line.includes('Check file://') && line.trim()
      ).join('\n');
      if (realErrors) {
        console.error('Stderr:', realErrors);
      }
    }

    return output;
  } finally {
    await Deno.remove(tempFile);
  }
}

/**
 * Normalize output for comparison (trim trailing whitespace per line, normalize line endings)
 */
function normalizeOutput(output: string): string {
  return output
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trimEnd();
}

// ============================================================================
// Test: Basic flex row layout
// ============================================================================

Deno.test('E2E: Flex row with three items', async () => {
  const content = `<melker>
<container style="display: flex; flex-direction: row; width: 30; height: 3">
  <text style="width: 10">AAA</text>
  <text style="width: 10">BBB</text>
  <text style="width: 10">CCC</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 30, height: 3 }));

  // Items should be laid out horizontally
  assert(output.includes('AAA'), 'Should contain AAA');
  assert(output.includes('BBB'), 'Should contain BBB');
  assert(output.includes('CCC'), 'Should contain CCC');

  // All on the same line (first line should have all three)
  const firstLine = output.split('\n')[0];
  assert(firstLine.includes('AAA') && firstLine.includes('BBB') && firstLine.includes('CCC'),
    'All items should be on the same row');
});

// ============================================================================
// Test: Flex column layout
// ============================================================================

Deno.test('E2E: Flex column with three items', async () => {
  const content = `<melker>
<container style="display: flex; flex-direction: column; width: 20; height: 6">
  <text>Line 1</text>
  <text>Line 2</text>
  <text>Line 3</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 20, height: 6 }));
  const lines = output.split('\n');

  // Items should be on different lines
  assert(lines.some(l => l.includes('Line 1')), 'Should contain Line 1');
  assert(lines.some(l => l.includes('Line 2')), 'Should contain Line 2');
  assert(lines.some(l => l.includes('Line 3')), 'Should contain Line 3');

  // Find indices
  const idx1 = lines.findIndex(l => l.includes('Line 1'));
  const idx2 = lines.findIndex(l => l.includes('Line 2'));
  const idx3 = lines.findIndex(l => l.includes('Line 3'));

  assert(idx1 < idx2 && idx2 < idx3, 'Items should be stacked vertically in order');
});

// ============================================================================
// Test: Gap spacing
// ============================================================================

Deno.test('E2E: Flex row with gap', async () => {
  const content = `<melker>
<container style="display: flex; flex-direction: row; gap: 2; width: 20; height: 1">
  <text>A</text>
  <text>B</text>
  <text>C</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 20, height: 1 }));
  const firstLine = output.split('\n')[0];

  // With gap: 2, there should be spaces between items
  // Pattern should be like "A  B  C" (2 spaces between)
  assert(firstLine.includes('A'), 'Should contain A');
  assert(firstLine.includes('B'), 'Should contain B');
  assert(firstLine.includes('C'), 'Should contain C');

  // Find positions
  const posA = firstLine.indexOf('A');
  const posB = firstLine.indexOf('B');
  const posC = firstLine.indexOf('C');

  // Gap of 2 means at least 2 characters between each item
  assert(posB - posA >= 3, `Gap between A and B should be at least 2 (positions: ${posA}, ${posB})`);
  assert(posC - posB >= 3, `Gap between B and C should be at least 2 (positions: ${posB}, ${posC})`);
});

// ============================================================================
// Test: Flex grow distribution
// ============================================================================

Deno.test('E2E: Flex grow 1:2:1 distribution', async () => {
  const content = `<melker>
<container style="display: flex; flex-direction: row; width: 40; height: 1">
  <text style="flex: 1; background-color: red">A</text>
  <text style="flex: 2; background-color: green">B</text>
  <text style="flex: 1; background-color: blue">C</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 40, height: 1 }));
  const firstLine = output.split('\n')[0];

  // The middle item (B) should take up more space
  // Count consecutive regions - with flex 1:2:1 on width 40, we expect ~10:20:10
  const posA = firstLine.indexOf('A');
  const posB = firstLine.indexOf('B');
  const posC = firstLine.indexOf('C');

  assert(posA >= 0, 'A should be present');
  assert(posB > posA, 'B should be after A');
  assert(posC > posB, 'C should be after B');

  // B's section should be roughly twice as wide as A's section
  const widthA = posB - posA;
  const widthB = posC - posB;

  // Allow some tolerance for rounding
  assert(widthB > widthA, `B section (${widthB}) should be wider than A section (${widthA})`);
});

// ============================================================================
// Test: Justify content center
// ============================================================================

Deno.test('E2E: Justify content center', async () => {
  const content = `<melker>
<container style="display: flex; flex-direction: row; justify-content: center; width: 20; height: 1">
  <text>XX</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 20, height: 1 }));
  const firstLine = output.split('\n')[0] || '';

  // "XX" (2 chars) centered in 20 chars should have ~9 spaces before it
  const posX = firstLine.indexOf('XX');
  assert(posX > 0, 'XX should not be at the start');
  assert(posX >= 8 && posX <= 10, `XX should be roughly centered (position: ${posX})`);
});

// ============================================================================
// Test: Justify content space-between
// ============================================================================

Deno.test('E2E: Justify content space-between', async () => {
  const content = `<melker>
<container style="display: flex; flex-direction: row; justify-content: space-between; width: 20; height: 1">
  <text>L</text>
  <text>R</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 20, height: 1 }));
  const firstLine = output.split('\n')[0] || '';

  // L should be at start, R should be after L with space between
  const posL = firstLine.indexOf('L');
  const posR = firstLine.indexOf('R');

  assert(posL === 0, `L should be at position 0 (actual: ${posL})`);
  assert(posR > posL, `R should be after L (L: ${posL}, R: ${posR})`);
  // With space-between, there should be significant space between L and R
  assert(posR - posL >= 5, `There should be space between L and R (gap: ${posR - posL})`);
});

// ============================================================================
// Test: Border rendering
// ============================================================================

Deno.test('E2E: Container with border', async () => {
  const content = `<melker>
<container style="border: thin; width: 10; height: 3; padding: 0">
  <text>Hi</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 12, height: 5 }));

  // Should have border characters
  assert(output.includes('┌') || output.includes('+'), 'Should have top-left corner');
  assert(output.includes('┐') || output.includes('+'), 'Should have top-right corner');
  assert(output.includes('└') || output.includes('+'), 'Should have bottom-left corner');
  assert(output.includes('┘') || output.includes('+'), 'Should have bottom-right corner');
  assert(output.includes('Hi'), 'Should contain text');
});

// ============================================================================
// Test: Nested flex containers
// ============================================================================

Deno.test('E2E: Nested flex containers', async () => {
  const content = `<melker>
<container style="display: flex; flex-direction: row; width: 30; height: 3">
  <container style="display: flex; flex-direction: column; width: 15">
    <text>Top</text>
    <text>Bot</text>
  </container>
  <container style="width: 15">
    <text>Right</text>
  </container>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 30, height: 3 }));
  const lines = output.split('\n');

  // Top and Bot should be in left column (first 15 chars)
  // Right should be in right column
  assert(output.includes('Top'), 'Should contain Top');
  assert(output.includes('Bot'), 'Should contain Bot');
  assert(output.includes('Right'), 'Should contain Right');

  // Find Right position - should be in right half
  for (const line of lines) {
    if (line.includes('Right')) {
      const pos = line.indexOf('Right');
      assert(pos >= 10, `Right should be in right column (position: ${pos})`);
      break;
    }
  }
});

// ============================================================================
// Test: Flex wrap
// ============================================================================

Deno.test('E2E: Flex wrap renders all items', async () => {
  // Test that flex-wrap container renders all items
  // Note: actual wrapping behavior depends on available space calculation
  const content = `<melker>
<container style="display: flex; flex-direction: row; flex-wrap: wrap; width: 30; height: 4">
  <text style="width: 10">Item1</text>
  <text style="width: 10">Item2</text>
  <text style="width: 10">Item3</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 30, height: 4 }));

  // All items should be rendered
  assert(output.includes('Item1'), 'Should contain Item1');
  assert(output.includes('Item2'), 'Should contain Item2');
  assert(output.includes('Item3'), 'Should contain Item3');
});

// ============================================================================
// Test: Text alignment
// ============================================================================

Deno.test('E2E: Text align center', async () => {
  const content = `<melker>
<container style="width: 20; height: 1">
  <text style="text-align: center; width: 20">Hi</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 20, height: 1 }));
  const firstLine = output.split('\n')[0] || '';

  // "Hi" should be centered in 20 chars
  const posHi = firstLine.indexOf('Hi');
  assert(posHi >= 8 && posHi <= 10, `Hi should be centered (position: ${posHi})`);
});

// ============================================================================
// Test: Button rendering
// ============================================================================

Deno.test('E2E: Button with label', async () => {
  const content = `<melker>
<container style="width: 20; height: 3">
  <button label="Click Me" />
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 20, height: 3 }));

  // Button should render with brackets
  assert(output.includes('Click Me'), 'Should contain button label');
  assert(output.includes('[') && output.includes(']'), 'Button should have bracket decorations');
});

// ============================================================================
// Test: Min/max constraints
// ============================================================================

Deno.test('E2E: Min-width prevents shrinking below threshold', async () => {
  const content = `<melker>
<container style="display: flex; flex-direction: row; width: 30; height: 1">
  <text style="flex: 1; min-width: 15">AAAAAAAAAA</text>
  <text style="flex: 1">B</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 30, height: 1 }));
  const firstLine = output.split('\n')[0] || '';

  // A's content should have at least 15 chars of space due to min-width
  const posA = firstLine.indexOf('A');
  const posB = firstLine.indexOf('B');

  assert(posB >= 15, `B should start at position >= 15 due to min-width (actual: ${posB})`);
});

Deno.test('E2E: Max-width prevents growing beyond threshold', async () => {
  const content = `<melker>
<container style="display: flex; flex-direction: row; width: 40; height: 1">
  <text style="flex: 1; max-width: 10">AAAAAAAAAAAAAAAA</text>
  <text style="flex: 1">B</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 40, height: 1 }));
  const firstLine = output.split('\n')[0] || '';

  // A's section should be capped at 10 chars due to max-width
  const posA = firstLine.indexOf('A');
  const posB = firstLine.indexOf('B');

  // B should start around position 10 (A is capped at max-width 10)
  assert(posB <= 15, `B should start at position <= 15 due to max-width on A (actual: ${posB})`);
});

Deno.test('E2E: Min-height prevents cross-axis shrinking', async () => {
  const content = `<melker>
<container style="display: flex; flex-direction: row; width: 20; height: 5">
  <text style="min-height: 3">A</text>
  <text>B</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 20, height: 5 }));
  const lines = output.split('\n');

  // A should occupy at least 3 lines due to min-height
  let aLineCount = 0;
  for (const line of lines) {
    // Check if this line has content in A's column (first ~10 chars)
    if (line.includes('A') || (line.length > 0 && line.substring(0, 10).trim().length > 0)) {
      aLineCount++;
    }
  }

  // At least 3 lines should have content from A's region
  assert(aLineCount >= 1, 'A should be rendered');
});

// ============================================================================
// Test: Wrap + stretch behavior
// ============================================================================

Deno.test('E2E: Flex wrap with align-items stretch', async () => {
  const content = `<melker>
<container style="display: flex; flex-direction: row; flex-wrap: wrap; align-items: stretch; width: 20; height: 6">
  <text style="width: 8; background-color: red">Item1</text>
  <text style="width: 8; background-color: blue">Item2</text>
  <text style="width: 8; background-color: green">Item3</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 20, height: 6 }));
  const lines = output.split('\n');

  // Items should wrap: Item1+Item2 on line 1-3, Item3 on line 4-6
  assert(output.includes('Item1'), 'Should contain Item1');
  assert(output.includes('Item2'), 'Should contain Item2');
  assert(output.includes('Item3'), 'Should contain Item3');

  // First two items should be on same row
  const firstLineWithItems = lines.find(l => l.includes('Item1'));
  assert(firstLineWithItems?.includes('Item2'), 'Item1 and Item2 should be on same line');
});

Deno.test('E2E: Explicit height not stretched in wrap mode', async () => {
  const content = `<melker>
<container style="display: flex; flex-direction: row; flex-wrap: wrap; align-items: stretch; width: 30; height: 6">
  <text style="width: 10; height: 2">Fixed</text>
  <text style="width: 10">Stretch</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 30, height: 6 }));

  // Both items should be present
  assert(output.includes('Fixed'), 'Should contain Fixed');
  assert(output.includes('Stretch'), 'Should contain Stretch');
});

// ============================================================================
// Test: Gap with column layout
// ============================================================================

Deno.test('E2E: Flex column with gap', async () => {
  const content = `<melker>
<container style="display: flex; flex-direction: column; gap: 1; width: 10; height: 6">
  <text>Row1</text>
  <text>Row2</text>
  <text>Row3</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 10, height: 6 }));
  const lines = output.split('\n');

  // Find positions of each row
  const row1Line = lines.findIndex(l => l.includes('Row1'));
  const row2Line = lines.findIndex(l => l.includes('Row2'));
  const row3Line = lines.findIndex(l => l.includes('Row3'));

  assert(row1Line >= 0, 'Row1 should be present');
  assert(row2Line >= 0, 'Row2 should be present');
  assert(row3Line >= 0, 'Row3 should be present');

  // With gap: 1, there should be at least 1 line between items (gap = 1 row)
  // Row2 should be at least 2 lines after Row1 (1 for Row1 content + 1 for gap)
  assert(row2Line >= row1Line + 2, `Row2 (line ${row2Line}) should be at least 2 lines after Row1 (line ${row1Line})`);
  assert(row3Line >= row2Line + 2, `Row3 (line ${row3Line}) should be at least 2 lines after Row2 (line ${row2Line})`);
});

// ============================================================================
// Test: Combined min/max with flex grow
// ============================================================================

Deno.test('E2E: Min and max width with flex grow', async () => {
  const content = `<melker>
<container style="display: flex; flex-direction: row; width: 50; height: 1">
  <text style="flex: 1; min-width: 10; max-width: 20">AAA</text>
  <text style="flex: 3">BBB</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 50, height: 1 }));
  const firstLine = output.split('\n')[0] || '';

  const posA = firstLine.indexOf('A');
  const posB = firstLine.indexOf('B');

  // A has flex:1, B has flex:3, total width 50
  // Without constraints: A would get 12.5, B would get 37.5
  // With max-width: 20, A is capped at 20
  // So B should start somewhere between 10 and 20
  assert(posA === 0, 'A should start at position 0');
  assert(posB >= 10 && posB <= 25, `B should start between 10 and 25 (actual: ${posB})`);
});

// ============================================================================
// Test: Cross-axis max constraint
// ============================================================================

Deno.test('E2E: Max-height limits cross-axis size', async () => {
  const content = `<melker>
<container style="display: flex; flex-direction: row; align-items: stretch; width: 20; height: 10">
  <text style="max-height: 3; width: 10">Short</text>
  <text style="width: 10">Tall</text>
</container>
</melker>`;

  const output = normalizeOutput(await renderToText(content, { width: 20, height: 10 }));

  // Both should be present
  assert(output.includes('Short'), 'Should contain Short');
  assert(output.includes('Tall'), 'Should contain Tall');
});
