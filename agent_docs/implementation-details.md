# Implementation Details

Critical implementation notes for Melker development.

## Mouse Tracking Initialization Order

**CRITICAL**: Raw mode MUST be enabled BEFORE terminal setup.

**Correct order** (see `src/engine.ts` ~line 797):
1. Enable raw mode FIRST - `_inputProcessor.startListening()`
2. Setup event handlers - `_setupEventHandlers()`
3. Terminal setup LAST - `_setupTerminal()`

Wrong order causes `ENOTTY` errors because alternate screen mode interferes with raw mode.

## Menu Overlay Rendering

Dropdown menus are rendered as overlays after normal content to prevent sibling elements from overwriting them.

**Pipeline** (see `src/rendering.ts` ~line 109):
1. Normal rendering - all elements in tree order
2. Menu collection - dropdowns stored in `context.overlays`
3. Overlay pass - menus rendered on top
4. Modal pass - dialogs render last

**Component registration** (`src/melker-main.ts`): The `melker.ts` module MUST be imported BEFORE `parseMelkerFile` to ensure component registrations happen first.

## Error Handling

The engine MUST:
- Exit with full stack traces on fatal errors
- Restore terminal before error output (disable mouse tracking, exit alternate screen, show cursor, reset attributes)
- Never suppress errors

See terminal restoration sequences in `src/engine.ts` cleanup methods.

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `MELKER_THEME` | Visual theme (`{type}-{mode}`) | `fullcolor-dark`, `bw-std` |
| `MELKER_LOG_FILE` | Log file path | `/tmp/debug.log` |
| `MELKER_LOG_LEVEL` | Log level | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `MELKER_HEADLESS` | Headless mode for CI | `true` |
| `MELKER_DEBUG_PORT` | Debug server port | `8080` |
| `MELKER_NO_ALTERNATE_SCREEN` | Disable alternate screen | `1` |

## Gray Theme

Gray themes (`gray-std`, `gray-dark`) enforce grayscale conversion at render time:
- All colors converted using luminance-based algorithm
- Maps to 4 levels: black, brightBlack, gray, white
- See `src/theme.ts` for implementation

## Dialog/Menu Hit Testing

Overlays (dialogs, menus) require special hit testing since their children's bounds are stored separately from the main layout tree. See `_hitTestOpenDialogs()` and `_hitTestOpenMenus()` in `src/engine.ts`.

## Element Bounds

All elements have `getBounds()` / `setBounds()` methods for accessing layout bounds:
- `setBounds()` is called by the renderer before `render()` (see `src/rendering.ts`)
- `getBounds()` returns `{ x, y, width, height }` or `null` before first render
- Useful for canvas components that need to resize to fill their container

## Canvas Dithering

Canvas supports automatic dithering based on theme type:

**Dither mode `'auto'`:**
- `fullcolor` theme: No dithering (true color rendering)
- `bw`, `gray`, `color` themes: Uses `sierra-stable` with 1 bit (B&W)

**Implementation** (see `src/components/canvas.ts` `_prepareDitheredBuffer()`):
```typescript
if (ditherMode === 'auto') {
  const theme = getCurrentTheme();
  if (theme.type === 'fullcolor') {
    return null;  // No dithering
  } else {
    ditherMode = 'sierra-stable';  // Apply dithering
  }
}
```

## Canvas onPaint Handler

Canvas fires `onPaint` before each render, allowing content updates:
- Handler receives `{ canvas, bounds }` event object
- Use `canvas.getBounds()` to get layout dimensions
- Call `canvas.setSize(width, height)` to resize canvas buffer

**Pattern for fill-style canvas:**
```xml
<canvas
  id="myCanvas"
  width="60" height="20"
  style="width: fill; height: fill"
  onPaint="context.drawMyContent(event.canvas)"
/>
```

```typescript
export const drawMyContent = (canvas: any): void => {
  const bounds = canvas.getBounds();
  if (!bounds) return;
  if (canvas.props.width !== bounds.width || canvas.props.height !== bounds.height) {
    canvas.setSize(bounds.width, bounds.height);
  }
  // Draw content...
};
```
