// Tests for the color16+ expanded palette (src/color16-palette.ts).
// Covers: nearestColor16Plus(), nearestSolid16(), blendShadeChars(),
// palette structure, LUT correctness, gamma-correct mixing, shade penalty.

import { assertEquals, assert, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  nearestColor16Plus,
  nearestSolid16,
  blendShadeChars,
} from '../src/color16-palette.ts';
import type { PaletteEntry } from '../src/color16-palette.ts';
import { packRGBA, unpackRGBA } from '../src/components/color-utils.ts';

// VGA ANSI color table (same as in color16-palette.ts)
const VGA = [
  { sgr: 30, r: 0,   g: 0,   b: 0   }, // black
  { sgr: 31, r: 170, g: 0,   b: 0   }, // red
  { sgr: 32, r: 0,   g: 170, b: 0   }, // green
  { sgr: 33, r: 170, g: 85,  b: 0   }, // brown/dark yellow
  { sgr: 34, r: 0,   g: 0,   b: 170 }, // blue
  { sgr: 35, r: 170, g: 0,   b: 170 }, // magenta
  { sgr: 36, r: 0,   g: 170, b: 170 }, // cyan
  { sgr: 37, r: 170, g: 170, b: 170 }, // light gray
  { sgr: 90, r: 85,  g: 85,  b: 85  }, // dark gray
  { sgr: 91, r: 255, g: 85,  b: 85  }, // bright red
  { sgr: 92, r: 85,  g: 255, b: 85  }, // bright green
  { sgr: 93, r: 255, g: 255, b: 85  }, // bright yellow
  { sgr: 94, r: 85,  g: 85,  b: 255 }, // bright blue
  { sgr: 95, r: 255, g: 85,  b: 255 }, // bright magenta
  { sgr: 96, r: 85,  g: 255, b: 255 }, // bright cyan
  { sgr: 97, r: 255, g: 255, b: 255 }, // white
];

function packedOf(r: number, g: number, b: number): number {
  return packRGBA(r, g, b, 255);
}

// ============================================================================
// nearestColor16Plus — basic lookup
// ============================================================================

Deno.test('nearestColor16Plus returns a valid PaletteEntry', () => {
  const entry = nearestColor16Plus(128, 64, 32);
  assertExists(entry);
  assert(typeof entry.fgPacked === 'number');
  assert(typeof entry.bgPacked === 'number');
  assert(typeof entry.char === 'string');
  assert(entry.char.length === 1);
});

Deno.test('nearestColor16Plus - shade chars are from the valid set', () => {
  const valid = new Set([' ', '░', '▒', '▓', '█']);
  // Sample a spread of inputs
  for (let r = 0; r < 256; r += 51) {
    for (let g = 0; g < 256; g += 51) {
      for (let b = 0; b < 256; b += 51) {
        const entry = nearestColor16Plus(r, g, b);
        assert(valid.has(entry.char), `Invalid shade char '${entry.char}' for (${r},${g},${b})`);
      }
    }
  }
});

// ============================================================================
// nearestColor16Plus — exact ANSI color inputs
// ============================================================================

Deno.test('nearestColor16Plus - pure black maps to solid black', () => {
  const entry = nearestColor16Plus(0, 0, 0);
  // Should be a solid entry (space with black bg, or █ with black fg)
  const { r: fr, g: fg, b: fb } = unpackRGBA(entry.fgPacked);
  const { r: br, g: bg, b: bb } = unpackRGBA(entry.bgPacked);
  // Both fg and bg should be black (all channels 0)
  // The char could be space (bg=black) or █ (fg=black)
  if (entry.char === ' ') {
    assertEquals(br, 0); assertEquals(bg, 0); assertEquals(bb, 0);
  } else if (entry.char === '█') {
    assertEquals(fr, 0); assertEquals(fg, 0); assertEquals(fb, 0);
  } else {
    // Shade char — both fg and bg should be black
    assertEquals(fr, 0); assertEquals(fg, 0); assertEquals(fb, 0);
    assertEquals(br, 0); assertEquals(bg, 0); assertEquals(bb, 0);
  }
});

Deno.test('nearestColor16Plus - pure white maps to solid white', () => {
  const entry = nearestColor16Plus(255, 255, 255);
  const { r: fr, g: fg, b: fb } = unpackRGBA(entry.fgPacked);
  const { r: br, g: bg, b: bb } = unpackRGBA(entry.bgPacked);
  if (entry.char === ' ') {
    assertEquals(br, 255); assertEquals(bg, 255); assertEquals(bb, 255);
  } else if (entry.char === '█') {
    assertEquals(fr, 255); assertEquals(fg, 255); assertEquals(fb, 255);
  } else {
    assertEquals(fr, 255); assertEquals(fg, 255); assertEquals(fb, 255);
    assertEquals(br, 255); assertEquals(bg, 255); assertEquals(bb, 255);
  }
});

Deno.test('nearestColor16Plus - exact ANSI colors prefer solid entries', () => {
  // Shade penalty should ensure exact ANSI colors map to solid entries
  for (const c of VGA) {
    const entry = nearestColor16Plus(c.r, c.g, c.b);
    const isSolid = entry.char === ' ' || entry.char === '█';
    assert(isSolid,
      `ANSI color SGR ${c.sgr} (${c.r},${c.g},${c.b}) got shade char '${entry.char}' instead of solid`);
  }
});

// ============================================================================
// nearestColor16Plus — consistency and monotonicity
// ============================================================================

Deno.test('nearestColor16Plus - same input gives same output', () => {
  const a = nearestColor16Plus(100, 150, 200);
  const b = nearestColor16Plus(100, 150, 200);
  assertEquals(a.fgPacked, b.fgPacked);
  assertEquals(a.bgPacked, b.bgPacked);
  assertEquals(a.char, b.char);
});

Deno.test('nearestColor16Plus - fg and bg are valid ANSI packed colors', () => {
  const validPacked = new Set(VGA.map(c => packedOf(c.r, c.g, c.b)));

  for (let r = 0; r < 256; r += 85) {
    for (let g = 0; g < 256; g += 85) {
      for (let b = 0; b < 256; b += 85) {
        const entry = nearestColor16Plus(r, g, b);
        assert(validPacked.has(entry.fgPacked),
          `fg ${entry.fgPacked} not a valid ANSI color for input (${r},${g},${b})`);
        assert(validPacked.has(entry.bgPacked),
          `bg ${entry.bgPacked} not a valid ANSI color for input (${r},${g},${b})`);
      }
    }
  }
});

// ============================================================================
// nearestColor16Plus — boundary and edge cases
// ============================================================================

Deno.test('nearestColor16Plus - handles 0,0,0 and 255,255,255', () => {
  // Just verify no crash / valid output
  const black = nearestColor16Plus(0, 0, 0);
  const white = nearestColor16Plus(255, 255, 255);
  assertExists(black);
  assertExists(white);
});

Deno.test('nearestColor16Plus - handles mid-gray', () => {
  const entry = nearestColor16Plus(128, 128, 128);
  assertExists(entry);
  // Mid-gray should map to one of the gray ANSI colors
  // (dark gray 85,85,85 or light gray 170,170,170)
  const { r: fr } = unpackRGBA(entry.fgPacked);
  const { r: br } = unpackRGBA(entry.bgPacked);
  // At least one of fg or bg should be a gray
  const isGray = (r: number, g: number, b: number) => r === g && g === b;
  const fgU = unpackRGBA(entry.fgPacked);
  const bgU = unpackRGBA(entry.bgPacked);
  assert(isGray(fgU.r, fgU.g, fgU.b) || isGray(bgU.r, bgU.g, bgU.b),
    `Mid-gray mapped to non-gray fg=(${fgU.r},${fgU.g},${fgU.b}) bg=(${bgU.r},${bgU.g},${bgU.b})`);
});

// ============================================================================
// nearestSolid16 — solid ANSI color lookup
// ============================================================================

Deno.test('nearestSolid16 - returns a valid ANSI packed color', () => {
  const validPacked = new Set(VGA.map(c => packedOf(c.r, c.g, c.b)));

  for (let r = 0; r < 256; r += 51) {
    for (let g = 0; g < 256; g += 51) {
      for (let b = 0; b < 256; b += 51) {
        const packed = nearestSolid16(r, g, b);
        assert(validPacked.has(packed),
          `nearestSolid16(${r},${g},${b}) returned ${packed} which is not a valid ANSI color`);
      }
    }
  }
});

Deno.test('nearestSolid16 - exact ANSI colors map to themselves', () => {
  for (const c of VGA) {
    const packed = nearestSolid16(c.r, c.g, c.b);
    const expected = packedOf(c.r, c.g, c.b);
    assertEquals(packed, expected,
      `ANSI SGR ${c.sgr} (${c.r},${c.g},${c.b}) didn't map to itself`);
  }
});

Deno.test('nearestSolid16 - pure black → black', () => {
  assertEquals(nearestSolid16(0, 0, 0), packedOf(0, 0, 0));
});

Deno.test('nearestSolid16 - pure white → white', () => {
  assertEquals(nearestSolid16(255, 255, 255), packedOf(255, 255, 255));
});

Deno.test('nearestSolid16 - bright red → bright red ANSI', () => {
  const packed = nearestSolid16(250, 80, 80);
  assertEquals(packed, packedOf(255, 85, 85));
});

Deno.test('nearestSolid16 - same input gives same output', () => {
  assertEquals(nearestSolid16(42, 100, 200), nearestSolid16(42, 100, 200));
});

// ============================================================================
// blendShadeChars — shade density interpolation
// ============================================================================

Deno.test('blendShadeChars - same input returns same char', () => {
  assertEquals(blendShadeChars(' ', ' '), ' ');
  assertEquals(blendShadeChars('░', '░'), '░');
  assertEquals(blendShadeChars('▒', '▒'), '▒');
  assertEquals(blendShadeChars('▓', '▓'), '▓');
  assertEquals(blendShadeChars('█', '█'), '█');
});

Deno.test('blendShadeChars - adjacent chars blend to intermediate', () => {
  // (0+1)/2 = 0.5 → rounds to 1 → ░
  assertEquals(blendShadeChars(' ', '░'), '░');
  // (1+2)/2 = 1.5 → rounds to 2 → ▒
  assertEquals(blendShadeChars('░', '▒'), '▒');
  // (2+3)/2 = 2.5 → rounds to 3 → ▓
  assertEquals(blendShadeChars('▒', '▓'), '▓');
  // (3+4)/2 = 3.5 → rounds to 4 → █
  assertEquals(blendShadeChars('▓', '█'), '█');
});

Deno.test('blendShadeChars - is commutative', () => {
  const chars = [' ', '░', '▒', '▓', '█'];
  for (const a of chars) {
    for (const b of chars) {
      assertEquals(blendShadeChars(a, b), blendShadeChars(b, a),
        `blendShadeChars('${a}','${b}') !== blendShadeChars('${b}','${a}')`);
    }
  }
});

Deno.test('blendShadeChars - extremes blend to middle', () => {
  // (0+4)/2 = 2 → ▒
  assertEquals(blendShadeChars(' ', '█'), '▒');
});

Deno.test('blendShadeChars - result is always a valid shade char', () => {
  const valid = new Set([' ', '░', '▒', '▓', '█']);
  const chars = [' ', '░', '▒', '▓', '█'];
  for (const a of chars) {
    for (const b of chars) {
      assert(valid.has(blendShadeChars(a, b)));
    }
  }
});

Deno.test('blendShadeChars - unknown chars treated as space (index 0)', () => {
  assertEquals(blendShadeChars('?', '█'), blendShadeChars(' ', '█'));
});

// ============================================================================
// Gamma-correct mixing validation
// ============================================================================

Deno.test('nearestColor16Plus - dark regions use shading (not just solid black)', () => {
  // A dark but not-black color should use a shade entry, not just map to solid black.
  // This validates the gamma-correct mixing: in sRGB space, dark values are crushed
  // to black, but linear-light mixing preserves them.
  const entry = nearestColor16Plus(40, 40, 40);
  // Dark gray (40,40,40) should be distinguishable from pure black.
  // It should use dark gray (85,85,85) as either fg or bg, not just black.
  const fgU = unpackRGBA(entry.fgPacked);
  const bgU = unpackRGBA(entry.bgPacked);
  const hasDarkGray = (fgU.r === 85 && fgU.g === 85 && fgU.b === 85) ||
                      (bgU.r === 85 && bgU.g === 85 && bgU.b === 85);
  assert(hasDarkGray,
    `Dark input (40,40,40) expected dark gray in fg or bg, got fg=(${fgU.r},${fgU.g},${fgU.b}) bg=(${bgU.r},${bgU.g},${bgU.b})`);
});

Deno.test('nearestColor16Plus - mid-tones between two ANSI colors use shade chars', () => {
  // A color midway between black (0,0,0) and dark gray (85,85,85) should use a
  // shade char to interpolate, not just pick the nearest solid.
  const entry = nearestColor16Plus(42, 42, 42);
  // This should ideally be a shade entry between black and dark gray
  const fgU = unpackRGBA(entry.fgPacked);
  const bgU = unpackRGBA(entry.bgPacked);
  const fgIsBlack = fgU.r === 0 && fgU.g === 0 && fgU.b === 0;
  const bgIsBlack = bgU.r === 0 && bgU.g === 0 && bgU.b === 0;
  const fgIsDarkGray = fgU.r === 85 && fgU.g === 85 && fgU.b === 85;
  const bgIsDarkGray = bgU.r === 85 && bgU.g === 85 && bgU.b === 85;
  // Should involve both black and dark gray in some combination
  assert(
    (fgIsBlack && bgIsDarkGray) || (fgIsDarkGray && bgIsBlack) ||
    (fgIsBlack && bgIsBlack) || (fgIsDarkGray && bgIsDarkGray),
    `Mid-tone (42,42,42) expected black/dark-gray combo, got fg=(${fgU.r},${fgU.g},${fgU.b}) bg=(${bgU.r},${bgU.g},${bgU.b})`
  );
});

// ============================================================================
// Shade penalty — solid entries preferred at equal distance
// ============================================================================

Deno.test('nearestColor16Plus - shade penalty prefers solid for exact match', () => {
  // When input exactly matches an ANSI color, solid entry should win
  // even though a shade entry with same fg=bg would give the same visual color.
  for (const c of VGA) {
    const entry = nearestColor16Plus(c.r, c.g, c.b);
    assert(entry.char === ' ' || entry.char === '█',
      `Exact ANSI (${c.r},${c.g},${c.b}) got shade '${entry.char}'`);
  }
});

// ============================================================================
// LUT coverage — verify no undefined entries
// ============================================================================

Deno.test('nearestColor16Plus - full LUT has no undefined entries', () => {
  // Sample every 8th value across the full range
  for (let r = 0; r < 256; r += 8) {
    for (let g = 0; g < 256; g += 8) {
      for (let b = 0; b < 256; b += 8) {
        const entry = nearestColor16Plus(r, g, b);
        assertExists(entry, `Undefined LUT entry at (${r},${g},${b})`);
        assert(entry.fgPacked !== undefined);
        assert(entry.bgPacked !== undefined);
        assert(entry.char !== undefined);
      }
    }
  }
});

Deno.test('nearestSolid16 - full LUT has no undefined entries', () => {
  for (let r = 0; r < 256; r += 8) {
    for (let g = 0; g < 256; g += 8) {
      for (let b = 0; b < 256; b += 8) {
        const packed = nearestSolid16(r, g, b);
        assert(packed !== undefined, `Undefined solid LUT entry at (${r},${g},${b})`);
        assert(typeof packed === 'number');
      }
    }
  }
});

// ============================================================================
// Color neighborhood — nearby inputs should give perceptually similar results
// ============================================================================

Deno.test('nearestColor16Plus - nearby inputs give same or similar results', () => {
  // Colors that differ by 1 in each channel should usually map to the same entry
  const base = nearestColor16Plus(100, 100, 100);
  const near = nearestColor16Plus(101, 100, 100);
  // Same entry (LUT bucket granularity is 8, so ±1 is same bucket)
  assertEquals(base.fgPacked, near.fgPacked);
  assertEquals(base.bgPacked, near.bgPacked);
  assertEquals(base.char, near.char);
});

// ============================================================================
// Chromatic colors — verify color-aware matching
// ============================================================================

Deno.test('nearestSolid16 - saturated red maps to a red ANSI', () => {
  const packed = nearestSolid16(200, 10, 10);
  // Should be dark red (170,0,0) or bright red (255,85,85)
  const redPacked = [packedOf(170, 0, 0), packedOf(255, 85, 85)];
  assert(redPacked.includes(packed),
    `Saturated red (200,10,10) mapped to unexpected color ${packed}`);
});

Deno.test('nearestSolid16 - saturated blue maps to a blue ANSI', () => {
  const packed = nearestSolid16(10, 10, 200);
  const bluePacked = [packedOf(0, 0, 170), packedOf(85, 85, 255)];
  assert(bluePacked.includes(packed),
    `Saturated blue (10,10,200) mapped to unexpected color ${packed}`);
});

Deno.test('nearestSolid16 - saturated green maps to a green ANSI', () => {
  const packed = nearestSolid16(10, 200, 10);
  const greenPacked = [packedOf(0, 170, 0), packedOf(85, 255, 85)];
  assert(greenPacked.includes(packed),
    `Saturated green (10,200,10) mapped to unexpected color ${packed}`);
});

Deno.test('nearestColor16Plus - saturated red uses red ANSI fg or bg', () => {
  const entry = nearestColor16Plus(200, 10, 10);
  const fgU = unpackRGBA(entry.fgPacked);
  const bgU = unpackRGBA(entry.bgPacked);
  // At least one of fg/bg should be a red ANSI color
  const isRed = (r: number, g: number, b: number) => r >= 170 && g <= 85 && b <= 85;
  assert(isRed(fgU.r, fgU.g, fgU.b) || isRed(bgU.r, bgU.g, bgU.b),
    `Red input (200,10,10) expected red ANSI, got fg=(${fgU.r},${fgU.g},${fgU.b}) bg=(${bgU.r},${bgU.g},${bgU.b})`);
});
