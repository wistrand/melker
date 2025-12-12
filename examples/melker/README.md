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
| `interactive.melker` | Advanced event handling patterns |

## Component Demos

| File | Description |
|------|-------------|
| `dialog_demo.melker` | Modal dialog examples |
| `menu_example.melker` | Menu bar with dropdowns |
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
| `video_demo.melker` | Video playback |

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
      context.render();
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
- `context.render()` - Trigger re-render after state changes
- `context.exit()` - Exit the application
- `context.engine` - Access engine instance
- `context.logger` - Logging interface

### Special Tags

| Tag | Description |
|-----|-------------|
| `<melker>` | Root wrapper (optional) |
| `<style>` | CSS-like stylesheet rules |
| `<script>` | TypeScript/JavaScript code |
| `<oauth>` | OAuth2 PKCE configuration |
| `<title>` | Window title |
