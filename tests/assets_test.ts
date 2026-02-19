// Tests for the embedded asset system (src/assets.ts).

import { assertEquals, assert, assertThrows } from 'jsr:@std/assert';
import { getAsset, getAssetText, getAssetIds } from '../src/assets.ts';

// ============================================================================
// getAssetIds
// ============================================================================

Deno.test('getAssetIds - returns all asset IDs', () => {
  const ids = getAssetIds();
  assert(ids.length >= 12, `expected at least 12 assets, got ${ids.length}`);
  assert(ids.includes('theme/bw-std'));
  assert(ids.includes('blue-noise-64'));
  assert(ids.includes('font-5x7'));
});

Deno.test('getAssetIds - filters by prefix', () => {
  const themeIds = getAssetIds('theme/');
  assertEquals(themeIds.length, 10);
  for (const id of themeIds) {
    assert(id.startsWith('theme/'), `${id} should start with theme/`);
  }
});

Deno.test('getAssetIds - non-matching prefix returns empty', () => {
  const ids = getAssetIds('nonexistent/');
  assertEquals(ids.length, 0);
});

// ============================================================================
// getAsset
// ============================================================================

Deno.test('getAsset - returns Uint8Array', () => {
  const data = getAsset('font-5x7');
  assert(data instanceof Uint8Array);
  assert(data.length > 0);
});

Deno.test('getAsset - returns same instance on second call (cached)', () => {
  const a = getAsset('blue-noise-64');
  const b = getAsset('blue-noise-64');
  assert(a === b, 'expected same reference from cache');
});

Deno.test('getAsset - throws on unknown ID', () => {
  assertThrows(
    () => getAsset('nonexistent'),
    Error,
    'Unknown embedded asset',
  );
});

Deno.test('getAsset - blue noise is 64x64 = 4096 bytes', () => {
  const data = getAsset('blue-noise-64');
  assertEquals(data.length, 64 * 64);
});

Deno.test('getAsset - font-5x7 starts with PSF2 magic bytes', () => {
  const data = getAsset('font-5x7');
  // PSF2 magic: 0x72 0xb5 0x4a 0x86
  assertEquals(data[0], 0x72);
  assertEquals(data[1], 0xb5);
  assertEquals(data[2], 0x4a);
  assertEquals(data[3], 0x86);
});

// ============================================================================
// getAssetText
// ============================================================================

Deno.test('getAssetText - returns string', () => {
  const css = getAssetText('theme/bw-std');
  assertEquals(typeof css, 'string');
  assert(css.length > 0);
});

Deno.test('getAssetText - theme CSS contains :root block', () => {
  const css = getAssetText('theme/fullcolor-dark');
  assert(css.includes(':root'), 'theme CSS should contain :root');
  assert(css.includes('--theme-'), 'theme CSS should contain --theme- variables');
});

Deno.test('getAssetText - all themes are valid CSS with required variables', () => {
  const required = ['--theme-type', '--theme-mode', '--theme-primary', '--theme-background'];
  for (const id of getAssetIds('theme/')) {
    const css = getAssetText(id);
    for (const prop of required) {
      assert(css.includes(prop), `${id} missing ${prop}`);
    }
  }
});

// ============================================================================
// Round-trip integrity — decoded assets match source files
// ============================================================================

Deno.test('round-trip - theme CSS matches source file', async () => {
  const decoded = getAssetText('theme/bw-dark');
  const source = await Deno.readTextFile('src/themes/bw-dark.css');
  assertEquals(decoded, source);
});

Deno.test('round-trip - font binary matches source file', async () => {
  const decoded = getAsset('font-5x7');
  const source = await Deno.readFile('src/components/segment-display/5x7.psf2');
  assertEquals(decoded.length, source.length);
  for (let i = 0; i < decoded.length; i++) {
    assertEquals(decoded[i], source[i], `byte mismatch at offset ${i}`);
  }
});
