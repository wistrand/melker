# CSS Theme Files Architecture

## Summary

- 10 built-in themes as CSS files with `:root` custom properties (auto-dark, auto-std, bw-std, fullcolor-dark, etc.)
- Custom themes via `--theme-file` or `MELKER_THEME_FILE` — any CSS file with `:root` variables
- Theme variables (`--theme-*`) auto-populate into stylesheets so apps don't need to hardcode colors

Themes defined as CSS files with `:root` custom properties, loaded at startup via `fetch()`. Supports 10 built-in themes and user-provided custom themes.

## File Map

| File                                               | Purpose                                                             |
|----------------------------------------------------|---------------------------------------------------------------------|
| [`src/themes/*.css`](../src/themes/)               | 10 built-in theme CSS files                                        |
| [`src/theme.ts`](../src/theme.ts)                  | `buildThemeFromCSS()`, `initThemes()`, `ThemeManager`, palette types, `FALLBACK_THEME` |
| [`src/stylesheet.ts`](../src/stylesheet.ts)        | `extractVariableDeclarations()` (CSS `:root` parser, shared), `_pushThemeOverrides()` |
| [`src/components/color-utils.ts`](../src/components/color-utils.ts) | `cssToRgba()` (color string to PackedRGBA)         |
| [`src/config/schema.json`](../src/config/schema.json) | `theme.file` config property                                    |
| [`src/config/config.ts`](../src/config/config.ts)  | `themeFile` getter                                                  |
| [`src/melker-runner.ts`](../src/melker-runner.ts)   | `await initThemes()` in .melker startup path                       |
| [`src/engine.ts`](../src/engine.ts)                | `await initThemes()` in `createApp()` library path                  |

## Theme CSS Format

```css
:root {
  /* Metadata */
  --theme-type: fullcolor;         /* bw | gray | color16 | color | fullcolor */
  --theme-mode: dark;              /* std | dark */
  --theme-color-support: truecolor; /* none | 16 | 256 | truecolor */

  /* 30 color properties (all required, --theme- prefix) */
  --theme-primary: #3b82f6;
  --theme-secondary: #06b6d4;
  --theme-background: black;
  --theme-foreground: white;
  --theme-surface: #1f2937;
  --theme-border: #6b7280;
  --theme-success: #10b981;
  --theme-warning: #f59e0b;
  --theme-error: #ef4444;
  --theme-info: #3b82f6;
  --theme-button-primary: white;
  --theme-button-secondary: #06b6d4;
  --theme-button-background: #3b82f6;
  --theme-input-background: #111827;
  --theme-input-foreground: #f9fafb;
  --theme-input-border: #374151;
  --theme-focus-primary: #fbbf24;
  --theme-focus-background: #1e40af;
  --theme-focus-border: #60a5fa;
  --theme-text-primary: #f9fafb;
  --theme-text-secondary: #d1d5db;
  --theme-text-muted: #6b7280;
  --theme-header-background: #1e40af;
  --theme-header-foreground: #f9fafb;
  --theme-sidebar-background: #1f2937;
  --theme-sidebar-foreground: #d1d5db;
  --theme-modal-background: #1e3a8a;
  --theme-modal-foreground: #f9fafb;
  --theme-scrollbar-thumb: #3b82f6;
  --theme-scrollbar-track: #374151;
}
```

### Supported Color Formats

| Format           | Example                          | Notes                                    |
|------------------|----------------------------------|------------------------------------------|
| Hex 3-digit      | `#f0c`                           | Expands to `#ff00cc`                     |
| Hex 6-digit      | `#3b82f6`                        | Standard hex                             |
| Hex 8-digit      | `#3b82f6cc`                      | With alpha channel                       |
| `rgb()`/`rgba()` | `rgb(59, 130, 246)`              | r/g/b: 0–255, alpha: 0–1                |
| `hsl()`/`hsla()` | `hsl(210, 50%, 60%)`            | h: degrees, s/l: percentage, alpha: 0–1 |
| `oklch()`        | `oklch(0.7 0.15 210)`           | L: 0–1 or %, C: chroma, H: degrees      |
| `oklab()`        | `oklab(0.7 -0.1 0.1)`           | L: 0–1 or %, a/b: signed decimals       |
| Named colors     | `black`, `white`, `red`, etc.    | 15 names (see `_namedColors` in color-utils.ts) |

`oklch()` and `oklab()` support `/alpha` syntax: `oklch(0.7 0.15 210 / 0.5)`. Alpha can be 0–1 or a percentage.

## Loading Pipeline

```
fetch(new URL('./themes/x.css', import.meta.url))
    |
    v
CSS text (string)
    |
    v
extractVariableDeclarations(css)    <-- src/stylesheet.ts (shared with CSS vars)
    |
    v
Map<string, string>                 <-- { "--primary": "#3b82f6", ... }
    |
    v
buildThemeFromCSS(css)              <-- src/theme.ts
    |
    v
Theme { type, mode, colorSupport, palette: ColorPalette }
    |
    v
THEMES registry (module-level)      <-- used by ThemeManager
```

No full `Stylesheet` instance is needed. `extractVariableDeclarations()` is a standalone exported function that parses `:root { --*: value }` blocks from raw CSS text.

## Initialization

`initThemes()` is async and must be called before any theme access. It loads all 10 built-in themes via `fetch()` with `import.meta.url`, then optionally loads a custom theme from config.

Two startup paths call it:
- **`.melker` runner** (`src/melker-runner.ts`): `await initThemes()` before engine creation
- **Library API** (`createApp()` in `src/engine.ts`): `await initThemes()` before `getThemeManager()`

`initThemes()` is idempotent — safe to call multiple times, no-ops after first success.

`ThemeManager` constructor stays synchronous — it reads from the already-populated `THEMES` record. If `THEMES` is empty (e.g., tests, library use before `initThemes()`), the constructor uses `FALLBACK_THEME` (minimal BW-dark palette). All downstream code (`getThemeManager()`, `getCurrentTheme()`, components) is unchanged.

## Custom Themes

### Loading

Custom theme CSS files are loaded via config:

```bash
# Environment variable
MELKER_THEME_FILE=./my-theme.css melker app.melker

# CLI flag
melker --theme-file ./my-theme.css app.melker

# Config file (~/.config/melker/config.json)
{ "theme.file": "/path/to/my-theme.css" }

# Convenience: .css extension on theme value
MELKER_THEME=./my-theme.css melker app.melker
```

Custom themes are stored in the `THEMES` registry under the key `'custom'`. When a custom theme file is configured, `_parseThemeFromEnv()` returns `'custom'` as the theme name.

### Creating a Custom Theme

Copy `src/themes/fullcolor-dark.css` as a starting point:

```bash
cp src/themes/fullcolor-dark.css ~/.config/melker/themes/my-theme.css
# Edit colors, then:
melker --theme-file ~/.config/melker/themes/my-theme.css app.melker
```

### Error Handling

| Scenario              | Behavior                                              |
|-----------------------|-------------------------------------------------------|
| File not found        | Warning logged, falls back to auto-detected theme     |
| Invalid color value   | `cssToRgba()` returns default foreground color         |
| Missing color property| Warning logged per property, magenta (`#ff00ff`) used  |
| Missing metadata      | Defaults: `type: fullcolor`, `mode: dark`, `colorSupport: truecolor` |

## Property Name Mapping

CSS custom properties use `kebab-case`; `ColorPalette` fields use `camelCase`.

`buildThemeFromCSS()` converts via `camelToKebab()`: `inputBackground` -> `--input-background`.

This is the reverse of what `_buildThemeVars()` does when generating `--theme-*` CSS variables from the palette.

## Built-in Themes

| Theme file           | Type      | Mode | Color support | Description                          |
|----------------------|-----------|------|---------------|--------------------------------------|
| `bw-std.css`         | bw        | std  | none          | Black on white, maximum compatibility |
| `bw-dark.css`        | bw        | dark | none          | White on black                        |
| `gray-std.css`       | gray      | std  | 16            | Light background with grays           |
| `gray-dark.css`      | gray      | dark | 16            | Dark background with grays            |
| `color16-std.css`    | color16   | std  | 16            | 16 ANSI colors, light background      |
| `color16-dark.css`   | color16   | dark | 16            | 16 ANSI colors, dark background       |
| `color-std.css`      | color     | std  | 256           | 256 colors, light background          |
| `color-dark.css`     | color     | dark | 256           | 256 colors, dark background           |
| `fullcolor-std.css`  | fullcolor | std  | truecolor     | Truecolor, light background           |
| `fullcolor-dark.css` | fullcolor | dark | truecolor     | Truecolor, dark background            |

## Theme Type Hierarchy

| ThemeType   | `colorSupport` | Grayscale? | SGR codes          | Auto-detected for          |
|-------------|----------------|------------|--------------------|-----------------------------|
| `fullcolor` | `truecolor`    | No         | `38;2;R;G;B`       | `COLORTERM=truecolor\|24bit`|
| `color`     | `256`          | No         | `38;5;N`           | TERM contains `256color`    |
| `color16`   | `16`           | No         | `30-37` / `90-97`  | `TERM=linux`                |
| `gray`      | `16`           | **Yes**    | `30-37` / `90-97`  | TERM contains `xterm`/`color`/`screen`/`tmux` without 256color or truecolor |
| `bw`        | `none`         | N/A        | (none)             | `TERM=vt100/vt220`, others  |

### color16 vs gray

Both `color16` and `gray` use `colorSupport: '16'` (same SGR output path via `rgbTo16Color()`), but they differ in color treatment:

- **`gray`**: Forces all colors through `colorToGray()` in `ThemeManager.applyTheme()` and `ScreenBuffer.setCell()`, converting every fg/bg/border to one of 4 grayscale values (black, bright-black, white, bright-white). Used for intentional grayscale aesthetics.
- **`color16`**: Colors pass through unmodified. `rgbTo16Color()` maps RGB to the nearest of 16 ANSI colors using hue and luminance. Preserves semantic colors (red for errors, green for success, etc.).

`TERM=linux` auto-detects to `color16` because the Linux console can display all 16 ANSI colors. The `gray` theme remains available via `MELKER_THEME=gray` for users who prefer grayscale.

### color16 focus styling

On 16-color terminals, SGR bold typically only brightens text color rather than thickening the font. This makes bold-only focus indicators hard to see. Components (button, checkbox, radio) use `reverse` video for focus highlighting when the theme type is `color16`, providing strong visual contrast by swapping foreground and background colors.

### color16 dithering

Canvas auto-dithering defaults to `effectiveBits = 2` (4 quantization levels per channel) for `color16`, matching `gray`. With only 16 output colors, dithering helps preserve image detail in canvas rendering.

### Color pipeline

```
Theme palette (named ANSI colors)
    │
    ▼
Components render to buffer (PackedRGBA)
    │
    ▼
AnsiOutputGenerator._getColorCode()
    │
    ├── colorSupport='truecolor' → 38;2;R;G;B
    ├── colorSupport='256'       → 38;5;N (6×6×6 cube)
    ├── colorSupport='16'        → rgbTo16Color() → SGR 30-37/90-97
    └── colorSupport='none'      → (no color codes)
```

## `--theme-*` CSS Variables

Theme CSS files and app stylesheets use the same `--theme-*` names — no renaming or prefix transformation occurs. `Stylesheet._buildThemeVars()` reads the active palette and exposes the same `--theme-*` CSS variables for use in `var()` references. See [css-variables-architecture.md](css-variables-architecture.md) for details.

Theme CSS files are parsed once at startup. `--theme-*` variables are generated once per Stylesheet instance.

### CSS Variable Overrides → Palette

App stylesheets can override theme colors via `:root` declarations with `--theme-*` variables:

```css
:root {
  --theme-background: #1a1a2e;
  --theme-primary: #e94560;
}
```

When `Stylesheet._fullReparse()` runs, `_pushThemeOverrides()` detects any `--theme-*` variable whose value differs from the original theme and pushes those overrides to `ThemeManager._colorOverrides` via `setColorOverrides()`. This makes `getThemeColor()` (128+ call sites across 26 files) return the overridden value without changing any caller code.

```
:root { --theme-background: #1a1a2e; }
    │
    ▼
Stylesheet._fullReparse()
    │
    ▼
_pushThemeOverrides(vars)     ─── detects --theme-background differs from palette
    │
    ▼
ThemeManager.setColorOverrides({ background: cssToRgba('#1a1a2e') })
    │
    ▼
getThemeColor('background')   ─── now returns overridden value
```

`ThemeManager.getColor()` checks `_colorOverrides[key]` first, falling back to `palette[key]`. This overlay pattern avoids mutating the palette itself.

## Performance

| Scenario                   | Cost                                                                  |
|----------------------------|-----------------------------------------------------------------------|
| Built-in theme loading     | 8 local `file://` fetches + `extractVariableDeclarations()` each; < 5ms total |
| Custom theme loading       | 1 additional `file://` fetch; < 1ms                                   |
| Runtime                    | Zero — themes are fully resolved to `PackedRGBA` at startup           |
| CSS variable overrides     | One Map scan per `_fullReparse()` to detect `--theme-*` differences   |

## Limitations

- **No live theme file switching**: Changing the theme file requires restart. `ThemeManager.setTheme()` works for switching between loaded themes at runtime.
- **CSS variable overrides are global**: `:root { --theme-primary: red; }` in any stylesheet affects all `getThemeColor('primary')` calls, not just the element the stylesheet is applied to.
- **No per-element scoping**: Theme CSS files only support `:root` blocks. Per-element theme overrides are not supported.
- **No `@media` in theme files**: Media-conditioned theme properties are not supported (use CSS variables with `@media` in app stylesheets instead).

## Related Docs

- [css-variables-architecture.md](css-variables-architecture.md) — CSS custom properties, `--theme-*` auto-population
- [css-animation-architecture.md](css-animation-architecture.md) — `@keyframes` animations
- [architecture-media-queries.md](architecture-media-queries.md) — `@media` queries
- [config-architecture.md](config-architecture.md) — Configuration system, `theme.file` property
