# Media Queries Architecture

## Summary

- `@media (min-width: 80)` / `(max-height: 24)` — style rules that activate based on terminal size
- Re-evaluated on terminal resize; units are character columns/rows
- Supports `and`, comma-separated lists, and nesting with other CSS features

CSS-like `@media` queries that respond to terminal dimensions, enabling responsive TUI layouts.

## Syntax

```css
@media (min-width: 80) {
  .sidebar { width: 20; }
}
@media (max-width: 60) {
  .sidebar { display: none; }
}
@media (min-height: 30) and (max-width: 80) {
  .split { direction: vertical; }
}
@media (orientation: portrait) {
  .layout { direction: vertical; }
}
@media (min-aspect-ratio: 16/9) {
  .wide-content { width: fill; }
}
```

### Supported Conditions

| Condition          | Syntax                           | Description                      |
|--------------------|----------------------------------|----------------------------------|
| `min-width`        | `(min-width: 80)`               | Terminal width >= value           |
| `max-width`        | `(max-width: 60)`               | Terminal width <= value           |
| `min-height`       | `(min-height: 30)`              | Terminal height >= value          |
| `max-height`       | `(max-height: 24)`              | Terminal height <= value          |
| `orientation`      | `(orientation: portrait)`       | `portrait` (h > w) or `landscape` (w >= h) |
| `min-aspect-ratio` | `(min-aspect-ratio: 16/9)`      | Width/height ratio >= value      |
| `max-aspect-ratio` | `(max-aspect-ratio: 4/3)`       | Width/height ratio <= value      |

Multiple conditions joined with `and` (all must match).

## Key Files

| File                   | Role                                                      |
|------------------------|-----------------------------------------------------------|
| `src/stylesheet.ts`   | Parser, tokenizer, condition evaluation, style application |
| `src/types.ts`        | `_inlineStyle` / `_computedStyle` fields on `Element`      |
| `src/engine.ts`       | Resize handler re-applies stylesheets with media rules     |
| `src/melker-runner.ts`| Initial apply with terminal size, dynamic element support  |
| `src/layout.ts`       | `direction → flexDirection` derivation in `_computeLayoutProps` |

## Architecture

### CSS Parsing: Brace-Balancing Tokenizer

The parser uses `tokenizeCSS()` — a brace-depth tracking state machine that handles nested braces (regex cannot). Extracts top-level `CSSBlock[]` of `{ selector, body }` pairs.

`@media` blocks are detected by selector prefix, their condition parsed via `parseMediaCondition()`, and body recursively parsed as nested rules. Each resulting `StyleItem` carries an optional `mediaCondition`.

### Style Origin Tracking

Every element tracks two style origins:

| Field            | Purpose                                                    |
|------------------|------------------------------------------------------------|
| `_inlineStyle`   | Ground truth from markup `style="..."` or script writes    |
| `_computedStyle` | Last merged result (for detecting script changes on re-apply) |

**Merge order**: `{ ...stylesheetRules, ...matchingMediaRules, ...inlineStyles }` — inline always wins, matching CSS specificity rules.

On first `applyStylesheet()` call, `element.props.style` is captured as `_inlineStyle`. On re-application (resize), script changes are detected by diffing `props.style` vs `_computedStyle`, merged into `_inlineStyle`, then everything recomputes from scratch.

### Condition Evaluation

`mediaConditionMatches(condition, ctx)` checks all specified fields (AND logic). Empty condition always matches. Evaluated per-rule in `getMatchingStyles()` — media-conditioned rules are skipped when no `StyleContext` is provided or when the condition doesn't match.

### Resize Integration

In the engine's resize callback (`src/engine.ts`):

1. Terminal size changes → resize handler fires
2. Root element dimensions updated
3. For each document stylesheet with `hasMediaRules`: re-apply to entire element tree with new `StyleContext`
4. Layout + render proceeds with updated styles

**Fast path**: `stylesheet.hasMediaRules` flag skips tree walks for apps without `@media` rules (zero overhead).

### Dynamic Elements

Elements created from script via `$melker.createElement()` get stylesheets applied with the current terminal size, so media rules are evaluated at creation time.

### Layout Engine Integration

The layout engine derives `flexDirection` from the `direction` style property in `_computeLayoutProps()`. This runs every layout pass, so media query changes to `direction` (e.g., on split-pane) automatically produce the correct flex layout without manual sync.

## Style Precedence

```
Lowest priority → Highest priority:
  Type defaults → Stylesheet rules → Media query rules → Inline styles
```

Inline styles **always** beat media query rules. A `style="display: block"` cannot be overridden by `@media { .x { display: none } }`. Media queries can only affect properties not set inline.

**What counts as inline**:
- Markup `style="..."` attribute
- Script `element.props.style = {...}` writes
- Constructor defaults set on `props.style`

**What counts as stylesheet** (overridable by media queries):
- `<style>` block rules (`.sidebar { width: 30; }`)
- Media query rules (`@media ... { .sidebar { display: none; } }`)

### Constructor Default Pitfall

Constructor defaults set on `props.style` are captured as `_inlineStyle` and permanently win over stylesheet values. To allow media query override of a property, do NOT set it as a constructor default — use accessor methods with fallback defaults instead. Example: split-pane sets `flexDirection: 'row'` (low-level layout prop) but lets `direction` come from stylesheets.

## Examples

### Width/Height Breakpoints

```xml
<melker>
  <style>
    .sidebar {
      width: 30;
      border: thin;
    }

    @media (max-width: 80) {
      .sidebar { width: 20; }
    }

    @media (max-width: 60) {
      .sidebar { display: none; }
    }

    @media (max-height: 20) {
      .footer { display: none; }
    }
  </style>

  <container style="flex-direction: row">
    <container class="sidebar">Sidebar</container>
    <container class="main" style="width: fill">Main</container>
  </container>
  <container class="footer">Footer</container>
</melker>
```

### Orientation

Switch layout direction based on terminal shape:

```xml
<style>
  .body {
    flex-direction: row;
  }

  /* Portrait: stack panels vertically */
  @media (orientation: portrait) {
    .body {
      flex-direction: column;
    }
  }
</style>
```

### Aspect Ratio

Adapt layout to ultra-wide, standard, and narrow terminals:

```xml
<style>
  .sidebar {
    width: 24;
  }

  /* Ultra-wide: wider sidebar */
  @media (min-aspect-ratio: 3/1) {
    .sidebar {
      width: 30;
    }
  }

  /* Narrow/square: hide sidebar */
  @media (max-aspect-ratio: 4/3) {
    .sidebar {
      display: none;
    }
  }
</style>
```

### Example Apps

| Example                                                                        | Demonstrates                                           |
|--------------------------------------------------------------------------------|--------------------------------------------------------|
| [media-queries.melker](../examples/melker/media-queries.melker)                | Width/height breakpoints, responsive dashboard         |
| [split-pane-responsive.melker](../examples/components/split-pane-responsive.melker) | Split-pane direction via `@media` + `and` combinator   |
| [media-orientation.melker](../examples/melker/media-orientation.melker)        | `orientation: portrait \| landscape` layout switching   |
| [media-aspect-ratio.melker](../examples/melker/media-aspect-ratio.melker)      | `min-aspect-ratio` / `max-aspect-ratio` breakpoints    |

## Limitations

- **Nested `@media` blocks**: Not supported. Inner blocks won't be recognized.
- **`getTerminalSize()` in stdout mode**: Returns actual terminal size from `Deno.consoleSize()`, not `MELKER_STDOUT_WIDTH`. Media queries use real terminal dimensions.
- **Graph/mermaid stylesheets**: Scoped to subtrees and intentionally NOT registered on the document — the resize handler won't re-apply them.

## Related

- [container-query-architecture.md](container-query-architecture.md) — `@container` queries (style children based on container size, not terminal size)
- [css-animation-architecture.md](css-animation-architecture.md) — CSS `@keyframes` animations
- [css-variables-architecture.md](css-variables-architecture.md) — CSS custom properties with media-dependent values via `:root` inside `@media`
