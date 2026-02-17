# CSS Variables Architecture

## Summary

- Define variables in `:root { --my-color: red; }`, use with `var(--my-color, fallback)`
- Theme colors auto-populate as `--theme-primary`, `--theme-border`, etc.
- Variables can change per media query (`:root` inside `@media`) and re-resolve on resize
- `var()` works in both `<style>` blocks and inline `style=""` attributes

CSS custom properties (`--*`) defined in `:root`, resolved at parse time. Supports `var()` with nested fallbacks, auto-populated `--theme-*` from the theme palette, media-conditioned variables via `:root` inside `@media`, and `var()` in inline `style="..."` attributes.

## File Map

| File                                        | Purpose                                                             |
|---------------------------------------------|---------------------------------------------------------------------|
| [`src/stylesheet.ts`](../src/stylesheet.ts) | Variable extraction, resolution, storage, re-parse lifecycle        |
| [`src/template.ts`](../src/template.ts)     | Passes stylesheet variables to inline style parsing                 |
| [`src/engine.ts`](../src/engine.ts)         | Calls `stylesheet.applyTo()` on resize to trigger media var re-eval |
| [`src/dev-tools.ts`](../src/dev-tools.ts)   | Vars tab in DevTools overlay (variable name, value, source)         |
| [`src/lsp.ts`](../src/lsp.ts)              | LSP validation/completion for `--*`, `var()`, `:root`               |
| [`src/lint.ts`](../src/lint.ts)             | Schema definitions (skips `--*` in validation)                      |

## Syntax

```css
:root {
  --accent: #3B82F6;
  --gap: 2;
}
button { color: var(--accent); gap: var(--gap); }
.card { color: var(--missing, var(--theme-primary)); }

@media (max-width: 60) {
  :root { --cols: 1; }
}
```

Inline styles also resolve variables:

```html
<container style="color: var(--accent); gap: var(--gap)" />
```

## Data Flow

```
<style> block                        Stylesheet constructor
    │                                       │
    ▼                                       ▼
addFromString(css)                  _buildThemeVars()
    │                                (29 --theme-* vars)
    ├── extractVariableDeclarations()       │
    │   (find :root { --*: ... })           ▼
    │         │                        _themeVars
    │         ▼                        _themeVarOrigins
    │   _variableDecls[]                    │
    │         │                             ▼
    │         ▼                     ┌── _variables ◄── merge ──┐
    │   _buildActiveVariables(ctx)  │   _variableOrigins       │
    │   (theme + user + media)      │                          │
    │         │                     │                          │
    │         ▼                     │                          │
    └── parseStyleBlock(css, vars)  │                          │
        (resolve var() in values)   │                          │
              │                     │                          │
              ▼                     │                          │
        _items[] (rules)            │                          │
                                    │                          │
applyTo(element, ctx) ──────────────┘                          │
    │                                                          │
    ├── if _hasMediaVars && ctx changed:                       │
    │       _fullReparse(ctx) ─────────────────────────────────┘
    │
    ▼
applyStylesheet(element, ...)

inline style="..." ──► parseAttributeValue()
                           │
                           ▼
                    parseStyleProperties(value, context.cssVariables)
                    (resolves var() from stylesheet)
```

## Variable Resolution (`resolveVarReferences`)

Recursive descent parser for `var(--name)` and `var(--name, fallback)`.

**Algorithm:** Scans character by character. When `var(` is found:
1. Extract variable name (`--xxx-yyy`) up to `,` or `)`
2. If comma: extract fallback using balanced-paren tracking (handles nested `var()`)
3. Cycle detection via `seen` set: if name already in set, use fallback or empty string
4. Lookup in variables map: found → recurse on value; not found → recurse on fallback

| Input                            | Result                              |
|----------------------------------|-------------------------------------|
| `var(--x)`                       | Lookup `--x`                        |
| `var(--x, red)`                  | Lookup `--x`, fallback `red`        |
| `var(--x, var(--y, red))`        | Chain: `--x` → `--y` → `red`       |
| `10 var(--x) 20`                 | Multiple refs in one value          |
| `--a: var(--a)`                  | Cycle → empty string                |
| `--a: var(--a, blue)`            | Cycle → fallback `blue`             |
| `--a: var(--b)`, `--b: var(--a)` | Indirect cycle → empty              |

## Variable Extraction (`extractVariableDeclarations`)

First pass over CSS text to find `:root { --*: value; }` blocks.

1. Strip comments, `tokenizeCSS()` into blocks
2. `:root` blocks → extract `--*` declarations
3. `@media` blocks → recurse, tag results with `MediaCondition` and source string
4. Other selectors → skip

```typescript
interface VariableDecl {
  name: string;                    // "--accent"
  value: string;                   // raw, may contain var() refs
  mediaCondition?: MediaCondition; // present when inside @media
  source?: string;                 // origin for DevTools: ":root", "@media (max-width: 80)"
}
```

**Scope:** Only `:root` blocks are scanned. `--*` in non-`:root` selectors (per-element scoping) is not supported. `:root.compound` is treated as a regular rule.

## Theme Variable Auto-Population

Themes are defined as CSS files in `src/themes/` (e.g., `src/themes/fullcolor-dark.css`). Each file is a `:root` block with 30 color properties and 3 metadata properties. At startup, `initThemes()` loads these via `fetch()` relative to `import.meta.url` and parses them with `extractVariableDeclarations()` + `cssToRgba()` into `ColorPalette` objects. Custom themes can be loaded via `MELKER_THEME_FILE` or `--theme-file`. See [css-themes-architecture.md](css-themes-architecture.md) for details.

`Stylesheet._buildThemeVars()` then pre-populates 30 `--theme-*` variables from the current `ColorPalette`. Built once per Stylesheet instance.

Conversion: `camelCase` palette key → `kebab-case` CSS variable, `PackedRGBA` → hex string.

### Overriding Theme Colors

App stylesheets can override theme colors by re-declaring `--theme-*` variables in `:root`:

```css
:root {
  --theme-background: #1a1a2e;
  --theme-primary: #e94560;
}
```

When `_fullReparse()` runs, `_pushThemeOverrides()` detects `--theme-*` variables that differ from the original palette and pushes them to `ThemeManager.setColorOverrides()`. This makes `getThemeColor()` return the overridden values globally. See [css-themes-architecture.md](css-themes-architecture.md#css-variable-overrides--palette) for the full data flow.

| Palette Key         | CSS Variable                |
|---------------------|-----------------------------|
| `primary`           | `--theme-primary`           |
| `secondary`         | `--theme-secondary`         |
| `background`        | `--theme-background`        |
| `foreground`        | `--theme-foreground`        |
| `surface`           | `--theme-surface`           |
| `border`            | `--theme-border`            |
| `success`           | `--theme-success`           |
| `warning`           | `--theme-warning`           |
| `error`             | `--theme-error`             |
| `info`              | `--theme-info`              |
| `buttonPrimary`     | `--theme-button-primary`    |
| `buttonSecondary`   | `--theme-button-secondary`  |
| `buttonBackground`  | `--theme-button-background` |
| `inputBackground`   | `--theme-input-background`  |
| `inputForeground`   | `--theme-input-foreground`  |
| `inputBorder`       | `--theme-input-border`      |
| `focusPrimary`      | `--theme-focus-primary`     |
| `focusBackground`   | `--theme-focus-background`  |
| `focusBorder`       | `--theme-focus-border`      |
| `textPrimary`       | `--theme-text-primary`      |
| `textSecondary`     | `--theme-text-secondary`    |
| `textMuted`         | `--theme-text-muted`        |
| `headerBackground`  | `--theme-header-background` |
| `headerForeground`  | `--theme-header-foreground` |
| `sidebarBackground` | `--theme-sidebar-background`|
| `sidebarForeground` | `--theme-sidebar-foreground`|
| `modalBackground`   | `--theme-modal-background`  |
| `modalForeground`   | `--theme-modal-foreground`  |
| `scrollbarThumb`    | `--theme-scrollbar-thumb`   |
| `scrollbarTrack`    | `--theme-scrollbar-track`   |

## Parse-Time Resolution

`var()` references are resolved at CSS parse time, not at render time. This means:

- `parseStyleProperties(css, variables)` resolves `var()` before type conversion (number, color, enum)
- `--*` declarations are skipped (not stored as style properties)
- Unresolved `var()` with no fallback → property skipped entirely
- `parseStyleBlock()` and `parseKeyframeBlock()` thread the `variables` map to all recursive calls

After resolution, values flow into the existing parsing pipeline unchanged (number detection, color parsing, box spacing shorthand, animation/transition shorthand).

Color values are parsed by `cssToRgba()` which supports: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `hsl()`, `hsla()`, `oklch()`, `oklab()`, and named colors. See [css-themes-architecture.md](css-themes-architecture.md#supported-color-formats) for the full format table.

## Stylesheet Class Integration

### State

```typescript
private _rawCSS: string[] = [];           // stored for re-parse
private _directItems: StyleItem[] = [];   // programmatic rules (survive re-parse)
private _variableDecls: VariableDecl[] = [];
private _variables: Map<string, string>;
private _variableOrigins: Map<string, string>;  // source tracking for DevTools
private _themeVars: Map<string, string>;
private _themeVarOrigins: Map<string, string>;
private _hasMediaVars: boolean = false;
private _lastCtx?: StyleContext;
```

### `addFromString(css)` — Two-pass with lazy re-parse

1. Store raw CSS in `_rawCSS`
2. `extractVariableDeclarations(css)` → find new `--*` declarations
3. If new declarations found:
   - Append to `_variableDecls`, set `_hasMediaVars` flag
   - `_fullReparse()` — re-parse ALL stored CSS with updated variable set
   - This handles forward references (later `<style>` defines vars used in earlier)
4. If no new declarations:
   - Parse only this CSS chunk with current `_variables`
   - Append results (zero-cost common case)

### `_fullReparse(ctx?)` — Rebuild everything

1. `_buildActiveVariables(ctx)` → theme vars + user declarations (media-conditioned filtered by ctx)
2. Clear and re-parse all `_rawCSS` with the new variable set
3. Re-append `_directItems` (programmatic rules survive)
4. Update `_variables` and `_variableOrigins`
5. `_pushThemeOverrides(vars)` → detect `--theme-*` overrides, push to `ThemeManager`

### `applyTo(element, ctx)` — Media-aware apply

If `_hasMediaVars` and `ctx` differs from `_lastCtx`: trigger `_fullReparse(ctx)`. Otherwise, one boolean check (zero overhead for the common case).

### Public API

| Getter / Method   | Returns                                                   |
|-------------------|-----------------------------------------------------------|
| `variables`       | `ReadonlyMap<string, string>` — active variable set       |
| `variableOrigins` | `ReadonlyMap<string, string>` — origin per variable       |
| `hasMediaRules`   | Includes `_hasMediaVars` check (`:root` inside `@media`)  |

### Variable Origin Tracking

Each variable carries a source string for DevTools display:

| Origin                | Source string                      |
|-----------------------|------------------------------------|
| Theme palette         | `"theme"`                          |
| Top-level `:root`     | `":root"`                          |
| `:root` inside @media | `"@media (max-width: 80) > :root"` |

## Inline Style Support

`var()` in inline `style="..."` attributes is supported via `TemplateContext.cssVariables`. The template parser sets this from `stylesheet.variables` after processing `<style>` blocks, before parsing the element tree. `parseAttributeValue()` passes it to `parseStyleProperties()`.

## DevTools Integration

The **Vars** tab in DevTools (F12) shows a data-table with three columns:

| Column   | Content                                |
|----------|----------------------------------------|
| Variable | `--accent`, `--theme-primary`, etc.    |
| Value    | `#3B82F6`, `2`, etc.                   |
| Source   | `theme`, `:root`, `@media (...)`, etc. |

User variables sort first, theme variables after. Refresh button re-reads current state. Theme variables are always visible even when no stylesheet defines custom variables.

## LSP Support

| Feature       | Behavior                                                    |
|---------------|-------------------------------------------------------------|
| Validation    | `--*` properties not flagged as unknown; `var()` values skip enum validation |
| Selectors     | `:root` recognized as valid; pseudo-classes stripped before type check |
| Completions   | `:root { }` snippet, `var(--name)` value function, `--` custom property declaration |
| Trigger chars | `:`, `;`, `{` added for CSS context triggering              |

## Performance

| Scenario                            | Cost                                                       |
|-------------------------------------|-------------------------------------------------------------|
| No variables used                   | Zero — one `key.startsWith('--')` check per property        |
| Variables, no `@media` `:root`      | One-time: string scan + Map lookups. Sub-microsecond.       |
| Variables with `@media` `:root`     | `_fullReparse` on resize: ~0.1ms for 50-rule sheet          |
| `var()` resolution per value        | Character scan + Map lookup + string concat. ~100ns         |
| Theme var population                | 29 `unpackRGBA` + `rgbToHex` calls. Once per instance.      |
| Theme override push                 | One Map scan per `_fullReparse()` to detect `--theme-*` diffs. |

## Stylesheet Registration

`stylesheet.applyTo(element)` applies computed styles to an element tree but does **not** register the stylesheet on the document. To persist styles through subsequent render passes, call `engine.document.addStylesheet(stylesheet)` separately. If another stylesheet's `applyTo` runs later (e.g. the document's own), it will overwrite styles from the first `applyTo` because they are tracked as "computed" not "inline". For sub-component stylesheets, use `addStylesheet(stylesheet, true)` (prepend) so they are applied in the normal pipeline.

## CSS Classes

Melker supports `class="foo bar"` on elements (converted to `classList` array in props). Use `.class-name` selectors in `<style>` blocks. Works for both template and `createElement`-created elements.

## Limitations

- `--*` declarations only in `:root` selectors (no per-element scoping)
- `:root` with compound selectors (`:root.dark`) treated as regular rule, not variable source
- Theme switching invalidation: overriding `--theme-*` in `:root` updates `getThemeColor()` globally, but does not trigger re-render of already-painted components
- `@property` rule (CSS registered custom properties) not supported
- Custom property animation/transition not supported

## Related Docs

- [css-animation-architecture.md](css-animation-architecture.md) — `@keyframes`, `animation` properties, specificity
- [css-pseudo-classes-transitions-architecture.md](css-pseudo-classes-transitions-architecture.md) — `:focus`, `:hover`, transitions
- [architecture-media-queries.md](architecture-media-queries.md) — `@media` queries, `StyleContext`
- [container-query-architecture.md](container-query-architecture.md) — `@container` queries

## Example

```css
/* Design tokens */
:root {
  --accent: #3B82F6;
  --gap-sm: 1;
  --gap-lg: 3;
  --border-style: single;
}

button { color: var(--accent); }
.card { gap: var(--gap-lg); border: var(--border-style); }

/* Theme color access */
.header {
  background: var(--theme-header-background);
  color: var(--theme-header-foreground);
}

/* Aliasing theme colors */
:root { --brand: var(--theme-primary); }
.link { color: var(--brand); }

/* Fallback chains */
.card { color: var(--brand-color, var(--theme-primary)); }

/* Responsive variables */
:root { --cols: 3; --sidebar-width: 25; }
@media (max-width: 60) {
  :root { --cols: 1; --sidebar-width: 0; }
}

/* Variables in animations */
:root { --highlight: #FFD700; }
@keyframes flash {
  from { color: var(--theme-text-primary); }
  to { color: var(--highlight); }
}

/* Variables in transitions */
:root { --speed: 300ms; }
button { transition: color var(--speed) ease; }
```

See [`examples/basics/css-variables.melker`](../examples/basics/css-variables.melker) for a working demo.
