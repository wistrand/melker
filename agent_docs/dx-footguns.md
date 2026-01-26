# Melker DX Footguns

Known developer experience issues when building .melker apps.

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

## 3. Don't Add Border to Buttons

**Mistake**: Adding border style to buttons.

```xml
<!-- WRONG - creates [ [ Button ] ] -->
<button label="Submit" style="border: thin;" />

<!-- CORRECT - buttons have built-in [ ] brackets -->
<button label="Submit" />
```

Buttons render with `[ ]` brackets by default. Adding a border creates double brackets.

## 4. Getter/Setter Methods Standardized

All value-holding components support `getValue()`/`setValue()`:

| Component | Get Value | Set Value |
|-----------|-----------|-----------|
| input | `getValue()` | `setValue(v)` |
| textarea | `getValue()` | `setValue(v)` |
| slider | `getValue()` | `setValue(v)` |
| checkbox | `getValue()` | `setValue(v)`, `toggle()` |
| radio | `getValue()` | `setValue(v)` |
| text | `getValue()` | `setValue(v)` |
| markdown | `getValue()` | `setValue(v)` |
| data-table | `getValue()` | `setValue(rows)` |

**Mistake**: Using `.props.text =` or `.props.value =` directly.

```javascript
// WRONG - directly setting props
element.props.text = "new value";

// CORRECT - use setValue()
element.setValue("new value");
```

## 5. Functions Must Be Exported for Handlers

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

## 6. Dialog Visibility Methods

Use the convenience methods for dialog visibility:

```javascript
const dialog = $melker.getElementById('my-dialog');

// Preferred - use methods
dialog.show();              // Open dialog
dialog.hide();              // Close dialog
dialog.setVisible(true);    // Set visibility
dialog.setVisible(false);

// Also works - direct prop access
dialog.props.open = true;
dialog.props.open = false;

// Check visibility
if (dialog.isVisible()) { ... }
```

## 7. Scrollable Is a Prop, Not a Style

**Mistake**: Using `overflow: scroll` in style.

```xml
<!-- WRONG - overflow style doesn't work -->
<container style="overflow: scroll; flex: 1">
  <text>Content</text>
</container>

<!-- CORRECT - scrollable prop + proper flex -->
<container scrollable="true" style="flex: 1 1 0; width: fill">
  <text style="text-wrap: wrap; width: fill">Content</text>
</container>
```

## 8. Width/Height: Props vs Style

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

## 9. Boolean Props in XML Are Strings

XML attributes are always strings, converted internally:

```xml
<checkbox checked="false" />  <!-- String "false", converted to boolean -->
<dialog open="true" />        <!-- String "true", converted to boolean -->
```

This works correctly but may surprise developers expecting boolean literals.

## 10. Use let/const, Not var

**Mistake**: Using `var` in TypeScript scripts.

```typescript
// WRONG - var is JavaScript legacy
var count = 0;

// CORRECT - use let for reassigned variables
let count = 0;

// CORRECT - use const for constants
const config = { debug: true };
```

## 11. Console Redirects to Logger (App Code Only)

**Note:** This applies to **app code** (`.melker` files, examples) only. For Melker internal development (files in `src/`, `mod.ts`, `melker-*.ts`), `console.log()` is **strictly forbidden** - use the logging system instead.

Console methods are automatically redirected to `$melker.logger` in melker scripts, so they won't break the TUI. However, using `$melker.logger` directly is recommended for better control:

```javascript
// Safe - redirects to $melker.logger.info()
console.log("debug info");
console.log("user:", { name: "John", age: 30 }); // objects formatted as JSON

// Preferred - explicit log levels
$melker.logger.debug("debug info");
$melker.logger.info("info message");
$melker.logger.warn("warning");
$melker.logger.error("error");
```

**Mapping:**
- `console.log`, `console.info` → `$melker.logger.info`
- `console.warn` → `$melker.logger.warn`
- `console.error` → `$melker.logger.error`
- `console.debug`, `console.trace` → `$melker.logger.debug`

**Disable redirect** (output to terminal instead):
```bash
./melker.ts --no-console-override app.melker
# or
MELKER_NO_CONSOLE_OVERRIDE=1 ./melker.ts app.melker
```

Press F12 to see log file location in Dev Tools overlay.

## 12. Avoid Specifying Colors

**Mistake**: Hardcoding colors that don't work across themes.

```xml
<!-- WRONG - may look bad in some themes -->
<text style="color: #ff0000;">Error</text>

<!-- BETTER - let theme handle it, or use semantic colors -->
<text style="color: red;">Error</text>
```

Let the theme engine handle colors for best appearance across all themes.

## 13. Dialog Content Layout

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

## 14. Flex Container vs Item Properties

`display: flex` is auto-inferred from container properties, but NOT from item properties:

```xml
<!-- Auto-infers display: flex (container props) -->
<container style="flex-direction: column; gap: 1;">

<!-- Does NOT auto-infer (item props only) -->
<container style="flex: 1;">  <!-- Still needs display: flex on parent -->
```

Container props (trigger auto-inference): `flex-direction`, `justify-content`, `align-items`, `align-content`, `flex-wrap`, `gap`

Item props (don't trigger): `flex`, `flex-grow`, `flex-shrink`, `flex-basis`

## 15. flex-direction Is a Style, Not an Attribute

**Mistake**: Using `direction` attribute instead of `flex-direction` style.

```xml
<!-- WRONG - direction is not a valid attribute -->
<container direction="row">
  <text>Left</text>
  <text>Right</text>
</container>

<!-- CORRECT - use style -->
<container style="flex-direction: row; gap: 2">
  <text>Left</text>
  <text>Right</text>
</container>
```

## 16. Cross-Axis Stretching in Column Containers

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

## 17. Exported Variables Can't Be Modified from Ready Script

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

## See Also

- [getting-started.md](getting-started.md) — Quick start guide
- [script_usage.md](script_usage.md) — Script context and $melker API
- [component-reference.md](component-reference.md) — Component documentation
