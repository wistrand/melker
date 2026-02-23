// Tests for CSS opacity and backgroundOpacity support
// Covers: interpolation, style inheritance, rendering (cell-level), and e2e ANSI output

import { assertEquals, assert, assertNotEquals } from 'jsr:@std/assert';
import {
  RenderingEngine,
  DualBuffer,
  ContainerElement,
  TextElement,
  createElement,
  parseStyleProperties,
} from '../mod.ts';
import type { Bounds, Style } from '../mod.ts';
import { COLORS, packRGBA, unpackRGBA } from '../src/components/color-utils.ts';
import { SRGB_TO_LINEAR, linearToSrgb } from '../src/color/oklab.ts';
import { interpolateValue } from '../src/css-animation.ts';
import { computeStyle } from '../src/layout-style.ts';
import { dirname, fromFileUrl, join } from 'jsr:@std/path@1.1.4';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replicate the rendering engine's linear-light opacity blend for expected values. */
function blendOpacity(color: number, opacity: number, bgColor: number): number {
  const fg = unpackRGBA(color);
  const bg = unpackRGBA(bgColor);
  const inv = 1 - opacity;
  return packRGBA(
    linearToSrgb(SRGB_TO_LINEAR[fg.r] * opacity + SRGB_TO_LINEAR[bg.r] * inv),
    linearToSrgb(SRGB_TO_LINEAR[fg.g] * opacity + SRGB_TO_LINEAR[bg.g] * inv),
    linearToSrgb(SRGB_TO_LINEAR[fg.b] * opacity + SRGB_TO_LINEAR[bg.b] * inv),
  );
}

// ===========================================================================
// 1. interpolateValue — opacity as FLOAT_PROPS (no rounding)
// ===========================================================================

Deno.test('interpolateValue — opacity interpolates without rounding', () => {
  const result = interpolateValue('opacity', 0, 1, 0.33);
  assertEquals(result, 0.33);
});

Deno.test('interpolateValue — backgroundOpacity interpolates without rounding', () => {
  // 0.2 + (0.8 - 0.2) * 0.5 = 0.5
  const result = interpolateValue('backgroundOpacity', 0.2, 0.8, 0.5);
  assertEquals(result, 0.5);
});

Deno.test('interpolateValue — opacity at boundaries', () => {
  assertEquals(interpolateValue('opacity', 0, 1, 0), 0);
  assertEquals(interpolateValue('opacity', 0, 1, 1), 1);
});

Deno.test('interpolateValue — same opacity returns from', () => {
  assertEquals(interpolateValue('opacity', 0.7, 0.7, 0.5), 0.7);
});

// ===========================================================================
// 2. computeStyle — opacity inheritance and multiplication
// ===========================================================================

Deno.test('computeStyle — opacity appears in computed style', () => {
  const el = createElement('text', { style: { opacity: 0.5 } });
  const style = computeStyle(el);
  assertEquals(style.opacity, 0.5);
});

Deno.test('computeStyle — opacity inherits from parent', () => {
  const el = createElement('text', {});
  const parentStyle: Style = { opacity: 0.3 } as Style;
  const style = computeStyle(el, parentStyle);
  assertEquals(style.opacity, 0.3);
});

Deno.test('computeStyle — nested opacity multiplies', () => {
  const el = createElement('text', { style: { opacity: 0.5 } });
  const parentStyle: Style = { opacity: 0.4 } as Style;
  const style = computeStyle(el, parentStyle);
  assertEquals(style.opacity, 0.4 * 0.5);
});

Deno.test('computeStyle — backgroundOpacity inherits from parent', () => {
  const el = createElement('text', {});
  const parentStyle: Style = { backgroundOpacity: 0.6 } as Style;
  const style = computeStyle(el, parentStyle);
  assertEquals(style.backgroundOpacity, 0.6);
});

Deno.test('computeStyle — nested backgroundOpacity multiplies', () => {
  const el = createElement('text', { style: { backgroundOpacity: 0.5 } });
  const parentStyle: Style = { backgroundOpacity: 0.8 } as Style;
  const style = computeStyle(el, parentStyle);
  assertEquals(style.backgroundOpacity, 0.8 * 0.5);
});

// ===========================================================================
// 3. normalizeStyle — string opacity parsing
// ===========================================================================

Deno.test('normalizeStyle — opacity string "0.5" becomes 0.5', () => {
  const el = createElement('text', { style: { opacity: '0.5' as any } });
  assertEquals((el.props.style as Style).opacity, 0.5);
});

Deno.test('normalizeStyle — opacity string "50%" becomes 0.5', () => {
  const el = createElement('text', { style: { opacity: '50%' as any } });
  assertEquals((el.props.style as Style).opacity, 0.5);
});

Deno.test('normalizeStyle — backgroundOpacity string "75%" becomes 0.75', () => {
  const el = createElement('text', { style: { backgroundOpacity: '75%' as any } });
  assertEquals((el.props.style as Style).backgroundOpacity, 0.75);
});

// ===========================================================================
// 3b. parseStyleProperties — CSS percentage opacity
// ===========================================================================

Deno.test('parseStyleProperties — opacity "50%" becomes 0.5', () => {
  const s = parseStyleProperties('opacity: 50%');
  assertEquals(s.opacity, 0.5);
});

Deno.test('parseStyleProperties — background-opacity "75%" becomes 0.75', () => {
  const s = parseStyleProperties('background-opacity: 75%');
  assertEquals(s.backgroundOpacity, 0.75);
});

Deno.test('parseStyleProperties — opacity "0.8" stays numeric', () => {
  const s = parseStyleProperties('opacity: 0.8');
  assertEquals(s.opacity, 0.8);
});

// ===========================================================================
// 4. Rendering — text foreground blended with opacity
// ===========================================================================

Deno.test('Rendering — text fg color blended with opacity', () => {
  const engine = new RenderingEngine();
  const parentBg = COLORS.black;

  const text = new TextElement({
    text: 'A',
    width: 1,
    height: 1,
    style: { color: COLORS.white, opacity: 0.5 },
  });

  const container = new ContainerElement({
    width: 1,
    height: 1,
    style: { backgroundColor: parentBg },
  }, [text]);

  const buffer = new DualBuffer(1, 1);
  const viewport: Bounds = { x: 0, y: 0, width: 1, height: 1 };
  engine.render(container, buffer, viewport);

  const cell = buffer.currentBuffer.getCell(0, 0);
  assert(cell, 'Cell should exist');
  assertEquals(cell!.char, 'A');
  // fg should be white blended at 50% toward black
  const expectedFg = blendOpacity(COLORS.white, 0.5, parentBg);
  assertEquals(cell!.foreground, expectedFg);
});

// ===========================================================================
// 5. Rendering — container background blended with opacity
// ===========================================================================

Deno.test('Rendering — container bg color blended with opacity', () => {
  const engine = new RenderingEngine();
  const parentBg = COLORS.black;

  const child = new ContainerElement({
    style: { backgroundColor: COLORS.red, opacity: 0.5, flex: 1 },
  });

  const container = new ContainerElement({
    width: 3,
    height: 1,
    style: { backgroundColor: parentBg },
  }, [child]);

  const buffer = new DualBuffer(3, 1);
  const viewport: Bounds = { x: 0, y: 0, width: 3, height: 1 };
  engine.render(container, buffer, viewport);

  const cell = buffer.currentBuffer.getCell(0, 0);
  assert(cell, 'Cell should exist');
  // bg should be red blended at 50% toward black
  const expectedBg = blendOpacity(COLORS.red, 0.5, parentBg);
  assertEquals(cell!.background, expectedBg);
});

// ===========================================================================
// 6. Rendering — border color blended with opacity
// ===========================================================================

Deno.test('Rendering — border color blended with opacity', () => {
  const engine = new RenderingEngine();
  const parentBg = COLORS.black;

  const bordered = new ContainerElement({
    style: {
      border: 'thin',
      borderColor: COLORS.white,
      backgroundColor: COLORS.black,
      opacity: 0.5,
      flex: 1,
    },
  });

  const container = new ContainerElement({
    width: 5,
    height: 3,
    style: { backgroundColor: parentBg },
  }, [bordered]);

  const buffer = new DualBuffer(5, 3);
  const viewport: Bounds = { x: 0, y: 0, width: 5, height: 3 };
  engine.render(container, buffer, viewport);

  // Top-left corner should be a border character
  const cell = buffer.currentBuffer.getCell(0, 0);
  assert(cell, 'Border cell should exist');
  assertEquals(cell!.char, '┌');
  // Border fg (white) blended at 50% toward black
  const expectedBorderFg = blendOpacity(COLORS.white, 0.5, parentBg);
  assertEquals(cell!.foreground, expectedBorderFg);
});

// ===========================================================================
// 7. Rendering — backgroundOpacity only blends background, not foreground
// ===========================================================================

Deno.test('Rendering — backgroundOpacity only blends background', () => {
  const engine = new RenderingEngine();
  const parentBg = COLORS.black;

  const text = new TextElement({
    text: 'X',
    width: 1,
    height: 1,
    style: {
      color: COLORS.white,
      backgroundColor: COLORS.red,
      backgroundOpacity: 0.5,
    },
  });

  const container = new ContainerElement({
    width: 1,
    height: 1,
    style: { backgroundColor: parentBg },
  }, [text]);

  const buffer = new DualBuffer(1, 1);
  const viewport: Bounds = { x: 0, y: 0, width: 1, height: 1 };
  engine.render(container, buffer, viewport);

  const cell = buffer.currentBuffer.getCell(0, 0);
  assert(cell, 'Cell should exist');
  // fg should be UNCHANGED (white) — backgroundOpacity doesn't affect fg
  assertEquals(cell!.foreground, COLORS.white);
  // bg should be red blended at 50% toward black
  const expectedBg = blendOpacity(COLORS.red, 0.5, parentBg);
  assertEquals(cell!.background, expectedBg);
});

// ===========================================================================
// 8. Rendering — opacity < 0.05 skips rendering entirely
// ===========================================================================

Deno.test('Rendering — opacity < 0.05 skips element rendering', () => {
  const engine = new RenderingEngine();

  const text = new TextElement({
    text: 'HIDDEN',
    width: 6,
    height: 1,
    style: { color: COLORS.red, opacity: 0.01 },
  });

  const container = new ContainerElement({
    width: 6,
    height: 1,
    style: { backgroundColor: COLORS.black },
  }, [text]);

  const buffer = new DualBuffer(6, 1);
  const viewport: Bounds = { x: 0, y: 0, width: 6, height: 1 };
  engine.render(container, buffer, viewport);

  // Cell at (0,0) should NOT contain 'H' — the text was skipped
  const cell = buffer.currentBuffer.getCell(0, 0);
  assertNotEquals(cell?.char, 'H', 'Near-zero opacity element should be skipped');
});

// ===========================================================================
// 9. Rendering — opacity 1.0 preserves original colors
// ===========================================================================

Deno.test('Rendering — opacity 1.0 preserves original colors', () => {
  const engine = new RenderingEngine();

  const text = new TextElement({
    text: 'A',
    width: 1,
    height: 1,
    style: { color: COLORS.red, backgroundColor: COLORS.green, opacity: 1.0 },
  });

  const container = new ContainerElement({
    width: 1,
    height: 1,
    style: { backgroundColor: COLORS.black },
  }, [text]);

  const buffer = new DualBuffer(1, 1);
  const viewport: Bounds = { x: 0, y: 0, width: 1, height: 1 };
  engine.render(container, buffer, viewport);

  const cell = buffer.currentBuffer.getCell(0, 0);
  assert(cell, 'Cell should exist');
  assertEquals(cell!.foreground, COLORS.red);
  assertEquals(cell!.background, COLORS.green);
});

// ===========================================================================
// 10. Rendering — combined opacity + backgroundOpacity
// ===========================================================================

Deno.test('Rendering — opacity and backgroundOpacity combine', () => {
  const engine = new RenderingEngine();
  const parentBg = COLORS.black;

  const text = new TextElement({
    text: 'B',
    width: 1,
    height: 1,
    style: {
      color: COLORS.white,
      backgroundColor: COLORS.red,
      backgroundOpacity: 0.5,
      opacity: 0.5,
    },
  });

  const container = new ContainerElement({
    width: 1,
    height: 1,
    style: { backgroundColor: parentBg },
  }, [text]);

  const buffer = new DualBuffer(1, 1);
  const viewport: Bounds = { x: 0, y: 0, width: 1, height: 1 };
  engine.render(container, buffer, viewport);

  const cell = buffer.currentBuffer.getCell(0, 0);
  assert(cell, 'Cell should exist');

  // fg: opacity blends white toward black
  const expectedFg = blendOpacity(COLORS.white, 0.5, parentBg);
  assertEquals(cell!.foreground, expectedFg);

  // bg: backgroundOpacity blends red toward black first, then opacity blends result toward black
  const afterBgOpacity = blendOpacity(COLORS.red, 0.5, parentBg);
  const expectedBg = blendOpacity(afterBgOpacity, 0.5, parentBg);
  assertEquals(cell!.background, expectedBg);
});

// ===========================================================================
// 11. Rendering — opacity on parent affects children
// ===========================================================================

Deno.test('Rendering — parent opacity applies to child', () => {
  const engine = new RenderingEngine();
  const rootBg = COLORS.black;

  // Child has no opacity, but parent has opacity 0.5
  const text = new TextElement({
    text: 'C',
    width: 1,
    height: 1,
    style: { color: COLORS.white },
  });

  const parent = new ContainerElement({
    width: 1,
    height: 1,
    style: { opacity: 0.5 },
  }, [text]);

  const root = new ContainerElement({
    width: 1,
    height: 1,
    style: { backgroundColor: rootBg },
  }, [parent]);

  const buffer = new DualBuffer(1, 1);
  const viewport: Bounds = { x: 0, y: 0, width: 1, height: 1 };
  engine.render(root, buffer, viewport);

  const cell = buffer.currentBuffer.getCell(0, 0);
  assert(cell, 'Cell should exist');
  assertEquals(cell!.char, 'C');
  // Child inherits opacity 0.5 from parent — fg blended toward root bg
  const expectedFg = blendOpacity(COLORS.white, 0.5, rootBg);
  assertEquals(cell!.foreground, expectedFg);
});

// ===========================================================================
// 12. Rendering — opacity 0 skips element entirely
// ===========================================================================

Deno.test('Rendering — opacity 0 skips element', () => {
  const engine = new RenderingEngine();

  const text = new TextElement({
    text: 'GONE',
    width: 4,
    height: 1,
    style: { color: COLORS.red, opacity: 0 },
  });

  const container = new ContainerElement({
    width: 4,
    height: 1,
    style: { backgroundColor: COLORS.black },
  }, [text]);

  const buffer = new DualBuffer(4, 1);
  const viewport: Bounds = { x: 0, y: 0, width: 4, height: 1 };
  engine.render(container, buffer, viewport);

  const cell = buffer.currentBuffer.getCell(0, 0);
  assertNotEquals(cell?.char, 'G', 'Zero opacity element should be skipped');
});

// ===========================================================================
// 13. Rendering — empty container bg blended at multiple positions
// ===========================================================================

Deno.test('Rendering — empty container bg blended at all positions', () => {
  const engine = new RenderingEngine();
  const parentBg = COLORS.blue;

  // Empty container with green bg + opacity 0.5 — no child content to overwrite
  const child = new ContainerElement({
    style: { backgroundColor: COLORS.green, opacity: 0.5, flex: 1 },
  });

  const container = new ContainerElement({
    width: 4,
    height: 1,
    style: { backgroundColor: parentBg },
  }, [child]);

  const buffer = new DualBuffer(4, 1);
  const viewport: Bounds = { x: 0, y: 0, width: 4, height: 1 };
  engine.render(container, buffer, viewport);

  const expectedBg = blendOpacity(COLORS.green, 0.5, parentBg);
  // All cells in the child should have the blended bg
  for (let x = 0; x < 4; x++) {
    const cell = buffer.currentBuffer.getCell(x, 0);
    assert(cell, `Cell at x=${x} should exist`);
    assertEquals(cell!.background, expectedBg, `Cell at x=${x} bg should be blended`);
  }
});

// ===========================================================================
// 14. E2E — opacity produces blended colors in ANSI output
// ===========================================================================

const testDir = dirname(fromFileUrl(import.meta.url));
const projectRoot = join(testDir, '..');
const melkerCli = join(projectRoot, 'melker.ts');

async function renderToAnsi(
  content: string,
  options: { width: number; height: number },
): Promise<string> {
  const tempFile = await Deno.makeTempFile({ suffix: '.melker' });
  try {
    await Deno.writeTextFile(tempFile, content);
    const command = new Deno.Command('deno', {
      args: [
        'run', '--allow-all',
        melkerCli,
        '--stdout', '--trust',
        '--stdout-width', String(options.width),
        '--stdout-height', String(options.height),
        '--stdout-timeout', '100',
        '--color', 'always',
        tempFile,
      ],
      stdout: 'piped',
      stderr: 'piped',
      env: { ...Deno.env.toObject(), COLORTERM: 'truecolor' },
    });
    const { stdout } = await command.output();
    return new TextDecoder().decode(stdout);
  } finally {
    await Deno.remove(tempFile);
  }
}

Deno.test('E2E — opacity changes rendered ANSI colors', async () => {
  const withOpacity = `<melker>
<container style="width: 10; height: 1; background-color: black">
  <text style="color: white; opacity: 0.5">TEST</text>
</container>
</melker>`;

  const withoutOpacity = `<melker>
<container style="width: 10; height: 1; background-color: black">
  <text style="color: white">TEST</text>
</container>
</melker>`;

  const opacityOutput = await renderToAnsi(withOpacity, { width: 10, height: 1 });
  const normalOutput = await renderToAnsi(withoutOpacity, { width: 10, height: 1 });

  // Both should contain ANSI escape sequences
  assert(opacityOutput.includes('\x1b['), 'Opacity output should have ANSI codes');
  assert(normalOutput.includes('\x1b['), 'Normal output should have ANSI codes');

  // Normal should have pure white (255,255,255)
  assert(normalOutput.includes('38;2;255;255;255'), 'Normal output should have white fg');

  // Opacity output should differ — colors are blended
  assertNotEquals(opacityOutput, normalOutput, 'Opacity should change rendered output');

  // Opacity output should NOT have pure white (it's blended toward black)
  assert(!opacityOutput.includes('38;2;255;255;255'),
    'Opacity output should not have pure white fg — it should be blended');
});

Deno.test('E2E — backgroundOpacity changes background ANSI colors', async () => {
  const withBgOpacity = `<melker>
<container style="width: 10; height: 1; background-color: black">
  <text style="background-color: red; background-opacity: 0.5">BG</text>
</container>
</melker>`;

  const withoutBgOpacity = `<melker>
<container style="width: 10; height: 1; background-color: black">
  <text style="background-color: red">BG</text>
</container>
</melker>`;

  const bgOpacityOutput = await renderToAnsi(withBgOpacity, { width: 10, height: 1 });
  const normalOutput = await renderToAnsi(withoutBgOpacity, { width: 10, height: 1 });

  // Both should contain ANSI escape sequences
  assert(bgOpacityOutput.includes('\x1b['), 'bgOpacity output should have ANSI codes');
  assert(normalOutput.includes('\x1b['), 'Normal output should have ANSI codes');

  // Normal should have pure red bg (255,0,0)
  assert(normalOutput.includes('48;2;255;0;0'), 'Normal output should have red bg');

  // bgOpacity output should differ
  assertNotEquals(bgOpacityOutput, normalOutput, 'backgroundOpacity should change rendered output');

  // bgOpacity output should NOT have pure red bg (it's blended toward black)
  assert(!bgOpacityOutput.includes('48;2;255;0;0'),
    'backgroundOpacity output should not have pure red bg');
});

Deno.test('E2E — opacity 0 produces no visible content', async () => {
  const content = `<melker>
<container style="width: 10; height: 1; background-color: black">
  <text style="color: red; opacity: 0">HIDDEN</text>
</container>
</melker>`;

  const output = await renderToAnsi(content, { width: 10, height: 1 });

  // The text 'HIDDEN' should not appear in the output (element was skipped)
  assert(!output.includes('HIDDEN'), 'Zero-opacity text should not appear in output');
});
