# Melker Template Examples

This directory contains `.melker` template files demonstrating the declarative HTML-like syntax.

## Running Examples

```bash
# Run a .melker file
deno run --allow-all melker.ts examples/melker/counter.melker

# Run from URL
deno run --allow-all melker.ts http://localhost:1990/melker/counter.melker

# With lint validation
deno run --allow-all melker.ts --lint examples/melker/counter.melker

# Display element tree
deno run --allow-all melker.ts examples/melker/counter.melker --print-tree

# Display JSON serialization
deno run --allow-all melker.ts examples/melker/counter.melker --print-json
```

## Core Examples

| File | Description |
|------|-------------|
| `hello.melker` | Simple greeting with text and button |
| `counter.melker` | Interactive counter with style tag |
| `input-demo.melker` | Input field with Enter key handling |
| `persistence_demo.melker` | State persistence with password input |
| `interactive.melker` | Advanced event handling patterns |

## Component Demos

| File | Description |
|------|-------------|
| `dialog_demo.melker` | Modal dialog examples |
| `menu_example.melker` | Menu bar with dropdowns |
| `tabs_demo.melker` | Tabbed interface component |
| `textarea_demo.melker` | Multi-line text input |
| `textarea_scrollable.melker` | Textarea in scrollable container |
| `markdown_viewer.melker` | Markdown rendering |

## Layout Examples

| File | Description |
|------|-------------|
| `flex-demo.melker` | Flexbox layout examples |
| `flexbox-visualizer.melker` | Interactive flexbox demo |
| `one-column-scroll.melker` | Single column scrolling |
| `three-column-scroll.melker` | Multi-column scrolling |
| `horizontal-column-scroll.melker` | Horizontal scroll layout |

## Canvas & Graphics

| File | Description |
|------|-------------|
| `analog-clock.melker` | Canvas-based analog clock |
| `enterprise-analog-clock.melker` | Feature-rich clock demo |
| `text-analog-clock.melker` | Text-based clock |
| `canvas_test.melker` | Canvas drawing basics |
| `canvas_color_test.melker` | Canvas color drawing |
| `video_demo.melker` | Video playback |

### Canvas Features

Canvas uses sextant characters (2x3 pixel blocks per terminal character).

**Auto-sizing with onPaint:**
```xml
<canvas
  id="myCanvas"
  width="60" height="20"
  style="width: fill; height: fill"
  onPaint="context.drawContent(event.canvas)"
/>
```

**Dithering modes:**
- `dither="auto"` - Adapts to theme (sierra-stable for B&W, none for fullcolor)
- `dither="sierra-stable"` - Best for B&W themes
- `dither="none"` - True color rendering

**Aspect-ratio corrected drawing:**
```typescript
// Use visual coordinates for round circles
const visSize = canvas.getVisualSize();
const [pxCenterX, pxCenterY] = canvas.visualToPixel(visSize.width/2, visSize.height/2);
canvas.drawCircleCorrected(pxCenterX, pxCenterY, radius);
```

## Script Examples

| File | Description |
|------|-------------|
| `script-demo.melker` | Inline script sections |
| `external-script-demo.melker` | External script loading via src |
| `oauth_login.melker` | OAuth2 PKCE integration |

## Fun Examples

| File | Description |
|------|-------------|
| `procrastinate.melker` | Productivity app |

## .melker File Format

### Basic Structure
```html
<melker>
  <style>
    button { background-color: blue; }
    #myId { color: red; }
    .myClass { border: thin; }
  </style>

  <script type="typescript">
    function handleClick() {
      const el = context.getElementById('output');
      el.props.text = 'Clicked!';
      // Auto-renders after handler completes
    }
  </script>

  <container style="width: 40; height: 10; border: thin;">
    <text id="output">Hello!</text>
    <button title="Click" onClick="handleClick()" />
  </container>
</melker>
```

### Available Context

In event handlers and scripts:
- `context.getElementById(id)` - Find elements by ID
- `context.render()` - Trigger re-render (auto-called after event handlers)
- `context.exit()` - Exit the application
- `context.engine` - Access engine instance
- `context.logger` - Logging interface

**Auto-render:** Event handlers automatically trigger a re-render after completion. Return `false` to skip auto-render.

**Element methods:**
- `element.getBounds()` - Get layout bounds `{ x, y, width, height }` after render
- `element.props` - Access/modify element properties

### Special Tags

| Tag | Description |
|-----|-------------|
| `<melker>` | Root wrapper (optional) |
| `<style>` | CSS-like stylesheet rules |
| `<script>` | TypeScript/JavaScript code |
| `<oauth>` | OAuth2 PKCE configuration |
| `<title>` | Window title |
