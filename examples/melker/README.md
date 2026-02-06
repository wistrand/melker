# Melker Template Examples

*Run text with meaning*

This directory contains `.melker` template files demonstrating scripts and advanced patterns.

## Running Examples

```bash
./melker.ts examples/melker/script-demo.melker
./melker.ts examples/melker/oauth-login.melker
```

For basic examples (hello, counter, form, dialog, tabs), see `examples/basics/`.

For component demos (input, select, table, slider, etc.), see `examples/components/`.

For layout examples (flexbox, borders, scrolling), see `examples/layout/`.

For canvas, shaders, images, and video, see `examples/canvas/`.

## Script Examples

| File                        | Description                        |
|-----------------------------|------------------------------------|
| `script-demo.melker`        | Inline script sections             |
| `external-script-demo.melker` | External script loading via src  |
| `npm-import-demo.melker`    | Importing npm packages             |

## Responsive Design (Media Queries)

| File                          | Description                                   |
|-------------------------------|-----------------------------------------------|
| `media-queries.melker`        | Width/height breakpoints, responsive dashboard |
| `media-orientation.melker`    | Portrait/landscape layout switching            |
| `media-aspect-ratio.melker`   | Aspect ratio-based responsive design           |

## Advanced Patterns

| File                     | Description                           |
|--------------------------|---------------------------------------|
| `oauth-login.melker`     | OAuth2 PKCE integration               |
| `persistence-demo.melker` | State persistence with password input |
| `ai-tools-demo.melker`   | AI accessibility tools demo           |
| `interactive.melker`     | Advanced event handling patterns      |
| `qr-code.melker`         | QR code generation                    |

## Supporting Files

| File/Directory | Description                    |
|----------------|--------------------------------|
| `bundler/`     | Bundler test files             |
| `utils.ts`     | Shared utility functions       |
| `.env.local.example` | Environment variable template |

## .melker File Format

### Basic Structure
```html
<melker>
  <style>
    button { background-color: blue; }
    #myId { color: red; }
    .myClass { border: thin; }
  </style>

  <!-- UI components first -->
  <container style="width: 40; height: 10; border: thin;">
    <text id="output">Hello!</text>
    <!-- Call exported functions via $app (alias for $melker.exports) -->
    <button label="Click" onClick="$app.handleClick()" />
  </container>

  <!-- Scripts last -->
  <script type="typescript">
    let count = 0;

    function handleClick() {
      count++;
      const el = $melker.getElementById('output');
      el.setValue(`Clicked ${count} times!`);
      // Auto-renders after handler completes
    }

    // Export functions to make them available in handlers
    export { handleClick };  // Accessible as $app.handleClick()
  </script>
</melker>
```

**Multiple top-level elements** are auto-wrapped in a flex column container:
```html
<melker>
  <text>Header</text>
  <container style="flex: 1;">Content</container>
  <text>Footer</text>
</melker>
```

### Available Context

In event handlers and scripts:
- `$melker.url` - Source file URL (e.g. `file:///path/to/app.melker`)
- `$melker.dirname` - Source directory path (e.g. `/path/to`)
- `$melker.exports` / `$app` - User exports namespace (script exports are added here)
- `$melker.getElementById(id)` - Find elements by ID
- `$melker.render()` - Trigger re-render (auto-called after event handlers)
- `$melker.exit()` - Exit the application
- `$melker.copyToClipboard(text)` - Copy text to system clipboard
- `$melker.alert(message)` - Show modal alert dialog
- `$melker.setTitle(title)` - Set window/terminal title
- `$melker.engine` - Access engine instance
- `$melker.logger` - Logging interface

### Script Exports

Functions and variables defined in `<script>` blocks must be exported to be accessible from event handlers:

```html
<script type="typescript">
  let state = { count: 0 };

  function increment() {
    state.count++;
  }

  // Export using any of these patterns:
  export { state, increment };
  // OR: export function increment() { ... }
  // OR: export const increment = () => { ... }
</script>

<!-- Access via $app (alias for $melker.exports) -->
<button onClick="$app.increment()" />
<text text="${$app.state.count}" />
```

External scripts (`<script src="...">`) are imported as ES modules and their exports are automatically merged into `$melker.exports` (accessible via `$app` alias).

**Auto-render:** Event handlers automatically trigger a re-render after completion. Return `false` to skip auto-render.

**Element methods:**
- `element.getBounds()` - Get layout bounds `{ x, y, width, height }` after render
- `element.props` - Access/modify element properties

### Special Tags

| Tag        | Description                    |
|------------|--------------------------------|
| `<melker>` | Root wrapper (optional)        |
| `<style>`  | CSS-like stylesheet rules      |
| `<script>` | TypeScript/JavaScript code     |
| `<oauth>`  | OAuth2 PKCE configuration      |
| `<title>`  | Window title                   |
