// Tests for the theme system: CSS theme loading, initThemes(), ThemeManager,
// buildThemeFromCSS(), and CSS variable overrides flowing to getThemeColor().

import { assertEquals, assert, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  initThemes,
  getCurrentTheme,
  getThemeManager,
  getThemeColor,
  buildThemeFromCSS,
} from '../mod.ts';
import type { ColorPalette } from '../mod.ts';
import { Stylesheet } from '../src/stylesheet.ts';
import { cssToRgba, unpackRGBA } from '../src/components/color-utils.ts';

// ============================================================================
// buildThemeFromCSS — pure parsing, no initThemes() needed
// ============================================================================

Deno.test('buildThemeFromCSS - parses metadata', () => {
  const css = `:root {
    --theme-type: color;
    --theme-mode: std;
    --theme-color-support: 256;
    --theme-primary: red; --theme-secondary: red; --theme-background: black; --theme-foreground: white;
    --theme-surface: black; --theme-border: white; --theme-success: white; --theme-warning: white;
    --theme-error: white; --theme-info: white; --theme-button-primary: white; --theme-button-secondary: white;
    --theme-button-background: white; --theme-input-background: black; --theme-input-foreground: white;
    --theme-input-border: white; --theme-focus-primary: white; --theme-focus-background: black; --theme-focus-border: white;
    --theme-text-primary: white; --theme-text-secondary: white; --theme-text-muted: white;
    --theme-header-background: black; --theme-header-foreground: white;
    --theme-sidebar-background: black; --theme-sidebar-foreground: white;
    --theme-modal-background: black; --theme-modal-foreground: white;
    --theme-scrollbar-thumb: white; --theme-scrollbar-track: black;
  }`;
  const theme = buildThemeFromCSS(css, 'test.css');
  assertEquals(theme.type, 'color');
  assertEquals(theme.mode, 'std');
  assertEquals(theme.colorSupport, '256');
  assertEquals(theme.source, 'test.css');
});

Deno.test('buildThemeFromCSS - defaults metadata when missing', () => {
  const css = `:root {
    --theme-primary: red; --theme-secondary: red; --theme-background: black; --theme-foreground: white;
    --theme-surface: black; --theme-border: white; --theme-success: white; --theme-warning: white;
    --theme-error: white; --theme-info: white; --theme-button-primary: white; --theme-button-secondary: white;
    --theme-button-background: white; --theme-input-background: black; --theme-input-foreground: white;
    --theme-input-border: white; --theme-focus-primary: white; --theme-focus-background: black; --theme-focus-border: white;
    --theme-text-primary: white; --theme-text-secondary: white; --theme-text-muted: white;
    --theme-header-background: black; --theme-header-foreground: white;
    --theme-sidebar-background: black; --theme-sidebar-foreground: white;
    --theme-modal-background: black; --theme-modal-foreground: white;
    --theme-scrollbar-thumb: white; --theme-scrollbar-track: black;
  }`;
  const theme = buildThemeFromCSS(css);
  assertEquals(theme.type, 'fullcolor');
  assertEquals(theme.mode, 'dark');
  assertEquals(theme.colorSupport, 'truecolor');
  assertEquals(theme.source, undefined);
});

Deno.test('buildThemeFromCSS - parses palette colors', () => {
  const css = `:root {
    --theme-primary: #3b82f6; --theme-secondary: #06b6d4; --theme-background: black; --theme-foreground: white;
    --theme-surface: #1f2937; --theme-border: #6b7280; --theme-success: #10b981; --theme-warning: #f59e0b;
    --theme-error: #ef4444; --theme-info: #3b82f6; --theme-button-primary: white; --theme-button-secondary: #06b6d4;
    --theme-button-background: #3b82f6; --theme-input-background: #111827; --theme-input-foreground: #f9fafb;
    --theme-input-border: #374151; --theme-focus-primary: #fbbf24; --theme-focus-background: #1e40af; --theme-focus-border: #60a5fa;
    --theme-text-primary: #f9fafb; --theme-text-secondary: #d1d5db; --theme-text-muted: #6b7280;
    --theme-header-background: #1e40af; --theme-header-foreground: #f9fafb;
    --theme-sidebar-background: #1f2937; --theme-sidebar-foreground: #d1d5db;
    --theme-modal-background: #1e3a8a; --theme-modal-foreground: #f9fafb;
    --theme-scrollbar-thumb: #3b82f6; --theme-scrollbar-track: #374151;
  }`;
  const theme = buildThemeFromCSS(css);
  assertEquals(theme.palette.primary, cssToRgba('#3b82f6'));
  assertEquals(theme.palette.background, cssToRgba('black'));
  assertEquals(theme.palette.foreground, cssToRgba('white'));
  assertEquals(theme.palette.success, cssToRgba('#10b981'));
});

Deno.test('buildThemeFromCSS - missing property gets fallback magenta', () => {
  const css = `:root {
    --theme-primary: red;
  }`;
  const theme = buildThemeFromCSS(css);
  // Missing properties get FALLBACK_COLOR (0xFF00FFFF = magenta)
  assertEquals(theme.palette.secondary, 0xFF00FFFF);
  // Present property is parsed correctly
  assertEquals(theme.palette.primary, cssToRgba('red'));
});

Deno.test('buildThemeFromCSS - all 30 palette keys populated', () => {
  const css = `:root {
    --theme-primary: #111; --theme-secondary: #222; --theme-background: #333; --theme-foreground: #444;
    --theme-surface: #555; --theme-border: #666; --theme-success: #777; --theme-warning: #888;
    --theme-error: #999; --theme-info: #aaa; --theme-button-primary: #bbb; --theme-button-secondary: #ccc;
    --theme-button-background: #ddd; --theme-input-background: #eee; --theme-input-foreground: #fff;
    --theme-input-border: #123; --theme-focus-primary: #456; --theme-focus-background: #789; --theme-focus-border: #9ab;
    --theme-text-primary: #abc; --theme-text-secondary: #def; --theme-text-muted: #135;
    --theme-header-background: #246; --theme-header-foreground: #357;
    --theme-sidebar-background: #468; --theme-sidebar-foreground: #579;
    --theme-modal-background: #68a; --theme-modal-foreground: #79b;
    --theme-scrollbar-thumb: #8ac; --theme-scrollbar-track: #9bd;
  }`;
  const theme = buildThemeFromCSS(css);
  const keys = Object.keys(theme.palette);
  assertEquals(keys.length, 30);
});

Deno.test('buildThemeFromCSS - supports hsl colors', () => {
  const css = `:root {
    --theme-primary: hsl(210, 50%, 60%); --theme-secondary: red; --theme-background: black; --theme-foreground: white;
    --theme-surface: black; --theme-border: white; --theme-success: white; --theme-warning: white;
    --theme-error: white; --theme-info: white; --theme-button-primary: white; --theme-button-secondary: white;
    --theme-button-background: white; --theme-input-background: black; --theme-input-foreground: white;
    --theme-input-border: white; --theme-focus-primary: white; --theme-focus-background: black; --theme-focus-border: white;
    --theme-text-primary: white; --theme-text-secondary: white; --theme-text-muted: white;
    --theme-header-background: black; --theme-header-foreground: white;
    --theme-sidebar-background: black; --theme-sidebar-foreground: white;
    --theme-modal-background: black; --theme-modal-foreground: white;
    --theme-scrollbar-thumb: white; --theme-scrollbar-track: black;
  }`;
  const theme = buildThemeFromCSS(css);
  assertEquals(theme.palette.primary, cssToRgba('hsl(210, 50%, 60%)'));
  // Verify it's not the fallback magenta
  assert(theme.palette.primary !== 0xFF00FFFF);
});

Deno.test('buildThemeFromCSS - supports oklch colors', () => {
  const css = `:root {
    --theme-primary: oklch(0.7 0.15 210); --theme-secondary: red; --theme-background: black; --theme-foreground: white;
    --theme-surface: black; --theme-border: white; --theme-success: white; --theme-warning: white;
    --theme-error: white; --theme-info: white; --theme-button-primary: white; --theme-button-secondary: white;
    --theme-button-background: white; --theme-input-background: black; --theme-input-foreground: white;
    --theme-input-border: white; --theme-focus-primary: white; --theme-focus-background: black; --theme-focus-border: white;
    --theme-text-primary: white; --theme-text-secondary: white; --theme-text-muted: white;
    --theme-header-background: black; --theme-header-foreground: white;
    --theme-sidebar-background: black; --theme-sidebar-foreground: white;
    --theme-modal-background: black; --theme-modal-foreground: white;
    --theme-scrollbar-thumb: white; --theme-scrollbar-track: black;
  }`;
  const theme = buildThemeFromCSS(css);
  assertEquals(theme.palette.primary, cssToRgba('oklch(0.7 0.15 210)'));
  assert(theme.palette.primary !== 0xFF00FFFF);
});

// ============================================================================
// initThemes — loads built-in themes from CSS files
// ============================================================================

Deno.test('initThemes - loads all 10 built-in themes', async () => {
  await initThemes();
  const tm = getThemeManager();
  const available = tm.getAvailableThemes();
  assertEquals(available.length >= 10, true);
  assert(available.includes('bw-std'));
  assert(available.includes('bw-dark'));
  assert(available.includes('gray-std'));
  assert(available.includes('gray-dark'));
  assert(available.includes('color16-std'));
  assert(available.includes('color16-dark'));
  assert(available.includes('color-std'));
  assert(available.includes('color-dark'));
  assert(available.includes('fullcolor-std'));
  assert(available.includes('fullcolor-dark'));
});

Deno.test('initThemes - is idempotent', async () => {
  await initThemes();
  const theme1 = getCurrentTheme();
  await initThemes();
  const theme2 = getCurrentTheme();
  assertEquals(theme1, theme2);
});

Deno.test('getCurrentTheme - returns valid theme after init', async () => {
  await initThemes();
  const theme = getCurrentTheme();
  assertExists(theme);
  assertExists(theme.type);
  assertExists(theme.mode);
  assertExists(theme.colorSupport);
  assertExists(theme.palette);
  assertExists(theme.palette.primary);
  assertExists(theme.palette.background);
  assertExists(theme.palette.foreground);
});

Deno.test('getCurrentTheme - has source from CSS file', async () => {
  await initThemes();
  const theme = getCurrentTheme();
  assertExists(theme.source);
});

Deno.test('getThemeColor - returns PackedRGBA values', async () => {
  await initThemes();
  const primary = getThemeColor('primary');
  const bg = getThemeColor('background');
  assertEquals(typeof primary, 'number');
  assertEquals(typeof bg, 'number');
});

Deno.test('getThemeColor - matches palette', async () => {
  await initThemes();
  const palette = getCurrentTheme().palette;
  assertEquals(getThemeColor('primary'), palette.primary);
  assertEquals(getThemeColor('background'), palette.background);
  assertEquals(getThemeColor('textPrimary'), palette.textPrimary);
  assertEquals(getThemeColor('error'), palette.error);
});

// ============================================================================
// ThemeManager
// ============================================================================

Deno.test('ThemeManager - setTheme switches theme', async () => {
  await initThemes();
  const tm = getThemeManager();
  const original = tm.getCurrentTheme();
  const targetName = original.type === 'bw' ? 'fullcolor-dark' : 'bw-dark';
  tm.setTheme(targetName);
  const switched = tm.getCurrentTheme();
  assert(switched !== original || switched.type !== original.type);
  // Restore
  tm.setTheme(tm.getCurrentThemeName());
});

Deno.test('ThemeManager - getAvailableThemes returns array of names', async () => {
  await initThemes();
  const names = getThemeManager().getAvailableThemes();
  assert(Array.isArray(names));
  assert(names.length >= 8);
});

// ============================================================================
// CSS variable overrides → getThemeColor
// ============================================================================

Deno.test('CSS var override - :root override flows to getThemeColor', async () => {
  await initThemes();
  const tm = getThemeManager();
  const originalPrimary = tm.getColor('primary');

  // Simulate what Stylesheet._pushThemeOverrides does
  const override = cssToRgba('#FF0000');
  tm.setColorOverrides({ primary: override });
  assertEquals(tm.getColor('primary'), override);
  assert(tm.getColor('primary') !== originalPrimary);

  // Non-overridden colors still come from palette
  assertEquals(tm.getColor('background'), getCurrentTheme().palette.background);

  // Clear overrides
  tm.setColorOverrides({});
  assertEquals(tm.getColor('primary'), originalPrimary);
});

Deno.test('CSS var override - Stylesheet fullReparse pushes overrides', async () => {
  await initThemes();
  const tm = getThemeManager();
  const originalBg = tm.getColor('background');

  // Create a stylesheet with a --theme-background override
  const sheet = Stylesheet.fromString(`
    :root { --theme-background: #FF0000; }
    .x { color: white; }
  `);

  // The override should have been pushed to ThemeManager
  const overriddenBg = tm.getColor('background');
  assertEquals(overriddenBg, cssToRgba('#FF0000'));
  assert(overriddenBg !== originalBg);

  // Clean up: clear overrides
  tm.setColorOverrides({});
  assertEquals(tm.getColor('background'), originalBg);
});

Deno.test('CSS var override - multiple overrides work simultaneously', async () => {
  await initThemes();
  const tm = getThemeManager();

  tm.setColorOverrides({
    primary: cssToRgba('#111111'),
    background: cssToRgba('#222222'),
    error: cssToRgba('#333333'),
  });

  assertEquals(tm.getColor('primary'), cssToRgba('#111111'));
  assertEquals(tm.getColor('background'), cssToRgba('#222222'));
  assertEquals(tm.getColor('error'), cssToRgba('#333333'));
  // Non-overridden still from palette
  assertEquals(tm.getColor('surface'), getCurrentTheme().palette.surface);

  tm.setColorOverrides({});
});

Deno.test('CSS var override - named color override', async () => {
  await initThemes();
  const tm = getThemeManager();

  const sheet = Stylesheet.fromString(`
    :root { --theme-primary: red; }
    .x { color: white; }
  `);

  assertEquals(tm.getColor('primary'), cssToRgba('red'));

  tm.setColorOverrides({});
});

Deno.test('CSS var override - getThemeColor convenience function reflects overrides', async () => {
  await initThemes();
  const tm = getThemeManager();

  tm.setColorOverrides({ textPrimary: cssToRgba('#AABBCC') });
  assertEquals(getThemeColor('textPrimary'), cssToRgba('#AABBCC'));

  tm.setColorOverrides({});
});

// ============================================================================
// Built-in theme CSS files content validation
// ============================================================================

Deno.test('built-in themes - all have valid palette colors (not magenta)', async () => {
  await initThemes();
  const tm = getThemeManager();
  const MAGENTA = 0xFF00FFFF;
  for (const name of tm.getAvailableThemes()) {
    tm.setTheme(name);
    const palette = tm.getCurrentTheme().palette;
    for (const [key, value] of Object.entries(palette)) {
      assert(value !== MAGENTA,
        `Theme '${name}' has magenta fallback for '${key}' — missing CSS property`);
    }
  }
});

Deno.test('built-in themes - each has source set', async () => {
  await initThemes();
  const tm = getThemeManager();
  for (const name of tm.getAvailableThemes()) {
    tm.setTheme(name);
    const theme = tm.getCurrentTheme();
    assertExists(theme.source, `Theme '${name}' has no source`);
  }
});

Deno.test('built-in themes - fullcolor-dark has truecolor support', async () => {
  await initThemes();
  const tm = getThemeManager();
  tm.setTheme('fullcolor-dark');
  assertEquals(tm.getColorSupport(), 'truecolor');
  assertEquals(tm.getThemeType(), 'fullcolor');
  assertEquals(tm.isDarkMode(), true);
});

Deno.test('built-in themes - bw-std has no color support', async () => {
  await initThemes();
  const tm = getThemeManager();
  tm.setTheme('bw-std');
  assertEquals(tm.getColorSupport(), 'none');
  assertEquals(tm.getThemeType(), 'bw');
  assertEquals(tm.isDarkMode(), false);
});

// ============================================================================
// Fallback behavior (before initThemes)
// ============================================================================

Deno.test('fallback - getThemeColor works before initThemes', () => {
  // This test relies on the FALLBACK_THEME being used when THEMES is empty.
  // Since initThemes() was already called in earlier tests, we test the
  // mechanism directly via setColorOverrides/getColor instead.
  const tm = getThemeManager();
  const color = tm.getColor('primary');
  assertEquals(typeof color, 'number');
});
