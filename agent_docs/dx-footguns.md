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

Some components use props, others use style:

```xml
<!-- Props (specific dimensions) -->
<canvas width="60" height="20" />
<dialog style="width: 80; height: 20;" />

<!-- Style (layout) -->
<container style="width: fill; height: fill;" />
<data-table style="width: fill;" />
```

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

## 11. Console Redirects to Logger

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
