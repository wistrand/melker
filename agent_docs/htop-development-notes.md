# htop.melker Development Notes

Common mistakes and solutions encountered while building the [htop example app](../examples/melker/htop.melker)

## 1. Table Sorting Redundancy

**Mistake**: Kept manual `sortProcs()` function when table has native sorting.

**Solution**: Remove manual sorting - table handles it internally via `sortColumn` and `sortDirection` props. The `_getSortedRows()` method sorts automatically.

```xml
<!-- Native sorting - no manual sort needed -->
<table sortColumn="3" sortDirection="desc">
```

## 2. Exported Functions in Handlers

**Mistake**: Function not accessible from handler attribute.

**Solution**: Functions must be exported with `export` keyword to be accessible from template handlers. The bundler merges exports to `$app` and looks up bare identifiers there.

```javascript
// WRONG - function not accessible
function showProcessDetails(event) { }

// CORRECT - exported function accessible
export function showProcessDetails(event) {
  // event.rowId available
}
```

```xml
<!-- In template - just use function name -->
<tbody onActivate="showProcessDetails">
```

## 3. Flex Layout Auto-Inference

~~**Mistake**: Using flex properties without `display: flex`.~~

**Fixed**: As of Build 142, `display: flex` is automatically inferred when flex container properties are present (`flex-direction`, `justify-content`, `align-items`, `align-content`, `flex-wrap`, `gap`).

```xml
<!-- Both work now - display: flex is auto-inferred -->
<container style="flex-direction: column">
<container style="display: flex; flex-direction: column">
```

Note: `flex`, `flex-grow`, `flex-shrink`, `flex-basis` are flex *item* properties (how an element behaves inside a flex container), not flex *container* properties, so they don't trigger auto-inference.

## 4. Dialog Open/Close

**Mistake**: Called `dialog.open()` method.

**Solution**: Dialog uses boolean prop, not method.

```javascript
// Open dialog
dialog.props.open = true;

// Close dialog
dialog.props.open = false;
```

## 5. Markdown Content Prop

**Mistake**: Set `markdown.props.content`.

**Solution**: Markdown uses `text` prop.

```javascript
var md = $melker.getElementById("myMarkdown");
md.props.text = "# Hello\n\nWorld";
```

## 6. Dialog Layout

**Mistake**: Content doesn't expand to fill dialog.

**Solution**: Use `width: fill` on containers and content.

```xml
<dialog style="width: 80; height: 18;">
  <container style="width: fill; height: 100%">
    <markdown style="width: fill"></markdown>
  </container>
</dialog>
```

## 7. Scrollable Container

**Mistake**: Used `overflow: scroll` in style for scrolling.

**Solution**: Use `scrollable="true"` as a prop on the container, not a style property. Also use `flex: 1 1 0` for proper flex sizing and `text-wrap: wrap` for text wrapping.

```xml
<!-- WRONG - overflow style doesn't work -->
<container style="overflow: scroll; flex: 1">
  <markdown style="white-space: pre-wrap"></markdown>
</container>

<!-- CORRECT - scrollable prop + proper flex -->
<container scrollable="true" style="flex: 1 1 0; width: fill">
  <markdown style="text-wrap: wrap; width: fill"></markdown>
</container>
```

## 8. Dialog Props Reference

```xml
<dialog
  title="Title"
  modal="false"      <!-- Allow background interaction -->
  backdrop="false"   <!-- No dimmed background -->
  draggable="true"   <!-- Drag by title bar -->
  resizable="true"   <!-- Resize from corner (shows indicator) -->
  style="width: 80; height: 18;"
>
```

## 9. Use let/const Instead of var

**Mistake**: Used `var` for variable declarations in TypeScript.

**Solution**: Scripts in .melker files are TypeScript. Use `let` for variables that will be reassigned, and `const` for variables that won't change.

```typescript
// WRONG - var is JavaScript legacy
var count = 0;
var name = "test";

// CORRECT - use let for reassigned variables
let count = 0;
count++;

// CORRECT - use const for constants
const name = "test";
const config = { debug: true };
```

## 10. Table Selection and Activation

```xml
<tbody
  selectable="single"           <!-- Enable row selection -->
  onActivate="handleActivate"   <!-- Double-click or Enter -->
>
```

The `onActivate` event includes `event.rowId` matching the row's `data-id` attribute.
