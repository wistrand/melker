# Melker DX Footguns

Known developer experience issues when building .melker apps.

## Table of Contents

1. [No Reactive Bindings](#1-no-reactive-bindings)
2. [Button Uses `label` or Content, Not `title`](#2-button-uses-label-or-content-not-title)
3. [Border Removes Button Brackets](#3-border-removes-button-brackets)
4. [Functions Must Be Exported for Handlers](#4-functions-must-be-exported-for-handlers)
5. [Scrollable Containers Need Proper Sizing](#5-scrollable-containers-need-proper-sizing)
6. [Width/Height: Props vs Style](#6-widthheight-props-vs-style)
7. [Avoid Specifying Colors](#7-avoid-specifying-colors)
8. [Dialog Content Layout](#8-dialog-content-layout)
9. [Flex Is the Default Layout](#9-flex-is-the-default-layout)
10. [Cross-Axis Stretching in Column Containers](#10-cross-axis-stretching-in-column-containers)
11. [Exported Variables Can't Be Modified from Ready Script](#11-exported-variables-cant-be-modified-from-ready-script)
12. [Input Type Is 'input', Not 'text-input'](#12-input-type-is-input-not-text-input)
13. [Emojis Break Terminal Layout](#13-emojis-break-terminal-layout)

## 1. No Reactive Bindings

Melker has **no reactivity system**. All UI updates require explicit `getElementById()` and `setValue()`:

```xml
<script>
  let count = 0;
  export function increment() {
    count++;
    $melker.getElementById('counter').setValue(String(count));
  }
</script>

<text id="counter">0</text>
<button label="Increment" onClick="$app.increment()" />
```

**Load-time substitutions**: Only `${argv[N]}` and `$ENV{VAR}` are replaced at load time (see `substituteEnvVars` in melker-runner.ts):

```xml
<!-- Command line args: ./melker.ts app.melker arg1 arg2 -->
<text>${argv[0]}</text>           <!-- "arg1" -->
<text>${argv[1]:-default}</text>  <!-- "arg2" or "default" if missing -->

<!-- Environment variables -->
<text>$ENV{HOME}</text>           <!-- "/home/user" -->
<text>$ENV{FOO:-bar}</text>       <!-- Value of FOO or "bar" if unset -->
```

## 2. Button Uses `label` or Content, Not `title`

**Mistake**: Using `title` attribute for button text.

```xml
<!-- WRONG - title is not supported -->
<button title="Click Me" />

<!-- CORRECT - content syntax (preferred) -->
<button>Click Me</button>

<!-- CORRECT - label prop -->
<button label="Click Me" />
```

## 3. Border Removes Button Brackets

**Surprise**: Adding border style to buttons removes the default brackets.

```xml
<!-- Default - renders as [ Submit ] -->
<button label="Submit" />

<!-- With border - renders as ┌──────┐ -->
<!--                          │Submit│ -->
<!--                          └──────┘ -->
<button label="Submit" style="border: thin;" />

<!-- Plain variant - renders as just: Submit -->
<button label="Submit" variant="plain" />
```

Buttons render with `[ ]` brackets by default. Adding a border switches to bordered rendering (no brackets). Use `variant="plain"` for no decoration at all.

## 4. Functions Must Be Exported for Handlers

**Mistake**: Function not accessible from handler attribute.

```javascript
// WRONG - function not accessible
function handleClick(event) { }

// CORRECT - exported function accessible via $app
export function handleClick(event) { }
```

```xml
<!-- In template - use $app prefix or bare function name -->
<button label="Click" onClick="$app.handleClick()" />
<button label="Click" onClick="handleClick" />
```

## 5. Scrollable Containers Need Proper Sizing

**Mistake**: Forgetting to constrain scrollable container size.

```xml
<!-- PROBLEM - container grows to fit content, no scrolling -->
<container style="overflow: scroll">
  <text>Long content...</text>
</container>

<!-- CORRECT - constrain size with flex: 1 -->
<container style="overflow: scroll; flex: 1; width: fill">
  <text style="text-wrap: wrap; width: fill">Long content...</text>
</container>
```

**Scrolling syntax:**

```xml
<!-- Always show scrollbars -->
<container style="overflow: scroll; flex: 1">

<!-- Show scrollbars only when content overflows -->
<container style="overflow: auto; flex: 1">
```

## 6. Width/Height: Props vs Style

Different components use different conventions. The most common footgun is using `style.width/height` on canvas-family components.

**Mitigations:** Runtime warnings are logged when style.width/height is used on canvas-family without props. Lint mode (`--lint`) also catches these issues.

### Canvas-Family: Props Define Buffer Size

For `canvas`, `img`, `video`, and `progress`, the `width`/`height` **props** define the pixel buffer resolution. Style only affects layout positioning, NOT the actual pixel count.

```xml
<!-- FOOTGUN: style.width doesn't resize the image buffer -->
<img style="width: fill; height: fill;" src="photo.png" />
<!-- Result: Uses default 30x15 buffer, stretched to fill layout -->
<!-- Runtime warning logged, lint warning if --lint enabled -->

<!-- CORRECT: Use props for buffer sizing -->
<img width="fill" height="fill" src="photo.png" />
<img width="100%" height="100%" src="photo.png" />
<img width="60" height="30" src="photo.png" />
```

**Why:** Canvas-family components pre-allocate pixel buffers at construction time. Style can't change the buffer after creation.

### img Supports Responsive Props

The `img` component props support multiple formats:

```xml
<!-- Fixed size -->
<img width="60" height="30" src="photo.png" />

<!-- Percentage of parent -->
<img width="100%" height="100%" src="photo.png" />
<img width="50%" height="50%" src="photo.png" />

<!-- Fill available space -->
<img width="fill" height="fill" src="photo.png" />

<!-- Combine props (buffer) with style (layout) -->
<img width="fill" height="fill" style="flex: 1;" src="photo.png" />
```

### Dialog Supports Multiple Formats

Dialog width/height props support numbers, percentages, decimals, and "fill":

```xml
<!-- Fixed size -->
<dialog width="60" height="20" />

<!-- String percentage -->
<dialog width="80%" height="90%" />

<!-- Fill available space -->
<dialog width="fill" height="fill" />

<!-- Decimal 0 < value < 1 (legacy, still supported) -->
<dialog width={0.8} height={0.9} />  <!-- 80% x 90% -->
```

**Note:** Decimal percentages must be strictly less than 1. The value `1` is treated as absolute (1 terminal unit), not 100%. Use `"100%"` or `"fill"` for full size.

### Select/Combobox/Slider: Consistent Precedence

These components all support both props and style, with **style taking precedence**. They also support percentage values:

```xml
<!-- Fixed size -->
<select width="20">...</select>
<combobox width="30" />
<slider width="20" />

<!-- Percentage of parent -->
<select width="50%">...</select>
<combobox width="80%" />
<slider width="50%" />

<!-- Fill available space -->
<select width="fill">...</select>
<combobox width="fill" />
<slider width="fill" />

<!-- Style wins when both specified -->
<select width="20" style="width: 30;">...</select>  <!-- width=30 -->
```

### Layout Components Use Style Only

Container, text, and data-table ignore width/height props - use style:

```xml
<!-- WRONG: props ignored -->
<container width="50" />
<text width="40" />

<!-- CORRECT: use style -->
<container style="width: fill; height: fill;" />
<container style="width: 50%; height: 100%;" />
<text style="width: 40;" />  <!-- Limits text wrapping -->
<data-table style="width: fill;" />
```

### Percentage Support Varies by Component

| Component | `"%"` support | `"fill"` support | Where |
|-----------|--------------|------------------|-------|
| img | ✓ | ✓ | props |
| dialog | ✓ | ✓ | props |
| container | ✓ | ✓ | style |
| text | ✓ | ✓ | style |
| canvas/video | ✗ | ✗ | N/A (fixed buffer) |
| progress | ✓ | ✓ | props only |
| slider | ✓ | ✓ | props or style |
| select/combobox | ✓ | ✓ | props or style |

### Quick Reference: What to Use

| Component | Fixed size | Responsive/fill |
|-----------|-----------|-----------------|
| canvas | `width={30} height={20}` | N/A (buffer must be fixed) |
| img | `width={30} height={20}` | `width="fill"` or `width="100%"` |
| video | `width={30} height={20}` | N/A |
| progress | `width={20}` | `width="50%"` or `width="fill"` |
| dialog | `width={60} height={20}` | `width="80%"` or `width="fill"` |
| slider | `width={20}` | `width="50%"` or `width="fill"` |
| select | `width={20}` | `width="50%"` or `width="fill"` |
| combobox | `width={30}` | `width="50%"` or `width="fill"` |
| container | `style="width: 30;"` | `style="width: fill;"` |
| text | `style="width: 40;"` | `style="width: fill;"` |

## 7. Avoid Specifying Colors

**Mistake**: Hardcoding colors that don't work across themes.

```xml
<!-- WRONG - may look bad in some themes -->
<text style="color: #ff0000;">Error</text>

<!-- BETTER - let theme handle it, or use semantic colors -->
<text style="color: red;">Error</text>
```

Let the theme engine handle colors for best appearance across all themes.

## 8. Dialog Content Layout

**Mistake**: Content doesn't expand to fill dialog.

```xml
<!-- WRONG - content won't fill -->
<dialog style="width: 80; height: 18;">
  <markdown>Content</markdown>
</dialog>

<!-- CORRECT - use width: fill on containers -->
<dialog style="width: 80; height: 18;">
  <container style="width: fill; height: 100%">
    <markdown style="width: fill"></markdown>
  </container>
</dialog>
```

## 9. Flex Is the Default Layout

The root viewport and `container`, `dialog`, and `tab` elements all default to `display: flex` with `flexDirection: column`. This means:

- Child elements stretch to fill width (cross-axis)
- Child elements shrink to content height unless `flex: 1` or `height: fill` is set

```xml
<!-- Root container fills viewport by default -->
<container>  <!-- Already flex column, stretches to fill -->
  <text>Header</text>
  <container style="flex: 1">  <!-- Takes remaining height -->
    <text>Content</text>
  </container>
</container>
```

Auto-inference from style properties triggers for flex **container** props (like `flex-direction`, `gap`) but not item props (like `flex`, `flex-grow`). Since most layout elements default to flex anyway, this rarely matters.

## 10. Cross-Axis Stretching in Column Containers

**Mistake**: Elements stretching to full width in column containers.

In flexbox column layout, children stretch horizontally (cross-axis) by default. This causes select, combobox, and other components to fill the entire width even when they have a fixed `width` prop.

```xml
<!-- PROBLEM - select stretches to full width -->
<container style="flex-direction: column">
  <select width="20">...</select>
</container>

<!-- SOLUTION - wrap in row container -->
<container style="flex-direction: column">
  <container style="flex-direction: row">
    <select width="20">...</select>
  </container>
</container>
```

This is standard flexbox behavior - in a column container, `align-items` defaults to `stretch`.

## 11. Exported Variables Can't Be Modified from Ready Script

**Mistake**: Trying to modify an `export let` variable from `<script async="ready">`.

```xml
<script type="typescript">
  export let count = 0;
</script>

<script async="ready">
  $app.count = 10;  // WRONG - sets a copy, not the original
  console.log($app.count);  // Shows 10, but original is still 0
</script>
```

**Solution**: Use setter functions to modify variables from other scripts:

```xml
<script type="typescript">
  export let count = 0;
  export function setCount(n: number) { count = n; }
</script>

<script async="ready">
  $app.setCount(10);  // CORRECT - modifies the original
</script>
```

**Why this happens**: The bundler merges exports into `$app` by copying values. For primitives (numbers, strings, booleans), `$app.count` holds a copy of the value, not a reference to the original binding. Setting `$app.count = 10` modifies the copy on `$app`, but the module-internal `count` variable remains unchanged. Objects work differently - they're copied by reference, so `$app.config.debug = true` would modify the original object.

## 12. Input Type Is 'input', Not 'text-input'

**Mistake**: Using `'text-input'` as the element type.

```xml
<!-- WRONG - no such element type -->
<text-input placeholder="Enter name" />

<!-- CORRECT - type is 'input' -->
<input placeholder="Enter name" />
```

The single-line text input component is called `input`, not `text-input`. Use `<textarea>` for multi-line input.

## 13. Emojis Break Terminal Layout

**Mistake**: Using emojis in text content.

```xml
<!-- PROBLEM - emoji width varies by terminal -->
<text>✅ Success</text>
<button label="🚀 Launch" />

<!-- BETTER - use ASCII or text -->
<text>[OK] Success</text>
<button label="Launch" />
```

Emojis have inconsistent widths across terminals. Melker calculates emoji width as 2 characters, but some terminals render them wider or narrower, causing layout misalignment. Avoid emojis in UI text for reliable layouts.

## See Also

- [getting-started.md](getting-started.md) — Quick start guide
- [script_usage.md](script_usage.md) — Script context and $melker API
- [component-reference.md](component-reference.md) — Component documentation
