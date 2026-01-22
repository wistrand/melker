# Implementation Details

Critical implementation notes for Melker development.

## Mouse Tracking Initialization Order

**CRITICAL**: Raw mode MUST be enabled BEFORE terminal setup.

**Correct order** (see `src/engine.ts` ~line 797):
1. Enable raw mode FIRST - `_inputProcessor.startListening()`
2. Setup event handlers - `_setupEventHandlers()`
3. Terminal setup LAST - `_setupTerminal()`

Wrong order causes `ENOTTY` errors because alternate screen mode interferes with raw mode.

**Component registration** (`melker-runner.ts`): The `melker.ts` module MUST be imported BEFORE `parseMelkerFile` to ensure component registrations happen first.

## Fast Render Path

Input and Textarea components use a fast render path for immediate visual feedback (~2ms latency).

**Key implementation** (see `src/engine.ts` keydown handler):
1. `prepareForFastRender()` - Copy previous buffer to current
2. `fastRender()` - Render only the input cells at cached bounds
3. `getDiffOnly()` - Get diff WITHOUT swapping buffers
4. `_renderFastPath()` - Output to terminal

**Critical**: Must NOT swap buffers during fast render, or the debounced full render will diff against wrong baseline (causing flicker).

**Dirty row tracking**: Both fast and full render benefit from dirty row tracking - only rows with changed cells are scanned during diff. See `agent_docs/dirty-row-tracking.md`.

**Dialog handling**: Fast render skipped when:
- System dialogs open (alert, confirm, prompt, accessibility)
- Overlay dialog exists (dialog that doesn't contain the focused input)

Inputs inside an open dialog still use fast render.

See `agent_docs/fast-input-render-plan.md` for full architecture.

## Dirty Row Tracking

Buffer diff operations use dirty row tracking to avoid full O(width × height) scans.

**How it works** (see `src/buffer.ts`):
1. DualBuffer injects tracking into TerminalBuffer via `setDirtyTracking()`
2. When `setCell()` writes a cell differing from reference buffer, that row is marked dirty
3. `swapAndGetDiff()` only scans dirty rows via `_computeDirtyDiff()`
4. After diff, dirty set is cleared for next frame

**Performance**: Typical 70-95% savings. Form with 13 content rows in 47-row terminal: scans 1599 cells instead of 5781 (72% saved).

**Special cases**:
- Resize marks all rows dirty (full redraw)
- `prepareForFastRender()` preserves dirty rows during buffer copy
- **Modal dialogs are handled automatically** - engine detects newly opened dialogs and uses full diff

**Limitations**:
- Conservative marking due to multi-pass rendering. Container background fills mark rows dirty even if children restore original content.

See `agent_docs/dirty-row-tracking.md` for full documentation.

## Engine Stop Sequence

**CRITICAL**: Render guards prevent output after terminal cleanup.

When `stop()` is called (see `src/engine.ts`):
1. `_isInitialized` set to `false` FIRST
2. Video elements stopped (`stopVideo()`)
3. Input processor stopped
4. Resize handler stopped
5. Debug server stopped
6. Headless mode stopped
7. Terminal cleanup (`cleanupTerminal()`)

**Render Guards** (see `src/engine.ts` ~lines 895, 1037, 1264, 1298):
- `render()` and `forceRender()` check `_isInitialized` at entry
- `_renderOptimized()` and `_renderFullScreen()` check before `writeSync()`
- These guards prevent video frames from being written after alternate screen exit

This fixes a race condition where:
1. Video `onFrame` callback triggers `render()`
2. `stop()` sets `_isInitialized = false` and exits alternate screen
3. Pending render would write sextant characters to normal screen (garbage output)

## Error Handling

The engine MUST:
- Exit with full stack traces on fatal errors
- Restore terminal before error output
- Never suppress errors
- Log fatal errors to file with `logger.fatal()`

## Error Rate Limiting

Component render errors are rate-limited to prevent error floods from blocking input (see `src/error-boundary.ts`).

**Configuration:**
- Max 5 errors per component per second
- 2 second cooldown after rate limit triggers
- Per-component tracking (by element ID or type)

**Behavior:**
1. First 5 errors logged normally
2. 6th error triggers rate limiting with warning
3. Subsequent errors suppressed during cooldown
4. After cooldown, summary logged: "suppressed N errors"

**Error overlay** shows "(+N suppressed)" when rate limiting is active.

**Terminal restoration sequence** (see `src/terminal-lifecycle.ts`):
1. Disable raw mode: `Deno.stdin.setRaw(false)`
2. Disable mouse reporting: `\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l`
3. Exit alternate screen: `\x1b[?1049l`
4. Show cursor: `\x1b[?25h`
5. Reset text styles: `\x1b[0m`

This sequence is used by:
- Global error/unhandledrejection handlers
- Signal handlers (SIGINT, SIGTERM, etc.)
- Bundler error translation (`src/bundler/errors.ts`)

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `MELKER_THEME` | Visual theme (default: `auto`) | `auto`, `auto-dark`, `fullcolor-dark`, `bw-std` |
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

## Dialog Hit Testing

Dialogs require special hit testing since their children's bounds are stored separately from the main layout tree. See `_hitTestOpenDialogs()` in `src/hit-test.ts`.

## Element Bounds

All elements have `getBounds()` / `setBounds()` methods for accessing layout bounds:
- `setBounds()` is called by the renderer before `render()` (see `src/rendering.ts`)
- `getBounds()` returns `{ x, y, width, height }` or `null` before first render
- Useful for canvas components that need to resize to fill their container

## Canvas Image Loading

Canvas loads images using pure-JS decoders (no Deno internal APIs). All decoders are centralized in `src/deps.ts` for remote URL execution support.

| Format | Library | Notes |
|--------|---------|-------|
| PNG | fast-png | Full support including alpha, 16-bit depth |
| JPEG | jpeg-js | Full support |
| GIF | omggif | First frame only (no animation) |

Format detection uses magic bytes at file start.

**Supported source types:**
- File paths (absolute or relative)
- HTTP/HTTPS URLs (requires `net` permission for target host)
- Data URLs (`data:image/png;base64,...`)

**HTTP/HTTPS caching:**
- Remote images are cached using an LRU cache (max 50 entries)
- Cache stores Promises to handle concurrent requests for the same URL
- Cache returns copies of byte arrays to prevent mutation
- Failed fetches are removed from cache to allow retry
- See `src/lru-cache.ts` for the generic LRU implementation

Image loading code is in `src/components/canvas-image.ts`, with decoders imported from `src/deps.ts`.

## Canvas Dithering

Canvas supports automatic dithering based on theme type:

**Dither mode `'auto'`:**
- `fullcolor` theme: No dithering (true color rendering)
- `bw`, `gray`, `color` themes: Uses `sierra-stable` with 1 bit (B&W)

**Available algorithms** (see `src/video/dither/`):
- `sierra-stable` / `sierra` - Sierra 2-row error diffusion
- `floyd-steinberg` / `floyd-steinberg-stable` - Classic Floyd-Steinberg
- `atkinson` / `atkinson-stable` - Bill Atkinson's algorithm (75% error diffusion)
- `blue-noise` - Threshold dithering using void-and-cluster blue noise matrix
- `ordered` - Bayer 8x8 ordered dithering
- `none` - No dithering

**Stable variants** reduce vertical error propagation for temporal stability in video/animation.

**Blue noise dithering:**
- Uses 64x64 threshold matrix from `media/blue-noise-64.png`
- No visible grid pattern like Bayer, temporally stable like ordered dithering
- Custom matrix path via `dither.blueNoisePath` config or `MELKER_BLUE_NOISE_PATH` env var
- Falls back to ordered dithering if matrix fails to load

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
  onPaint="$melker.drawMyContent(event.canvas)"
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

## Canvas onShader Handler

Canvas/img elements support per-pixel shader callbacks for animated effects:

```xml
<img
  src="image.png"
  width="100%" height="100%"
  onShader="$app.myShader"
  shaderFps="30"
  shaderRunTime="5000"
/>
```

**Shader callback signature:**
```typescript
export const myShader = (
  x: number,
  y: number,
  time: number,
  resolution: { width: number; height: number; pixelAspect: number },
  source?: ShaderSource,
  utils?: ShaderUtils
): [number, number, number] => {
  // Return [r, g, b] or [r, g, b, a] (0-255 range)
  return [255, 0, 0];
};
```

**Key parameters:**
- `resolution.pixelAspect`: ~0.5 (pixels are taller than wide due to sextant chars)
- `source.getPixel(x, y)`: Read source image pixels `[r, g, b, a]`
- `source.mouse/mouseUV`: Mouse position in pixels or normalized 0-1 (auto-tracked, -1 when outside)
- `utils`: Built-in functions (`noise2d`, `simplex2d`, `simplex3d`, `perlin2d`, `perlin3d`, `fbm`, `fbm3d`, `palette`, `smoothstep`, `mix`, `fract`)

**Aspect-correct shapes:** Divide y-distance by `pixelAspect`:
```typescript
const dy = (v - centerY) / resolution.pixelAspect;
const dist = Math.sqrt(dx*dx + dy*dy);
```

**shaderRunTime:** Stops shader after specified ms, freezing final frame as a resizable image.

**Permission:** Requires `"shader": true` in app policy.

## Confirm and Prompt Dialogs

The engine provides `showConfirm()` and `showPrompt()` methods as terminal equivalents to browser dialogs.

**Usage** (see `src/engine.ts`):
```typescript
// Confirm dialog - returns Promise<boolean>
const confirmed = await engine.showConfirm('Delete this file?');

// Prompt dialog - returns Promise<string | null>
const name = await engine.showPrompt('Enter your name:', 'Default');
```

**Escape key** closes both dialogs (returns `false` for confirm, `null` for prompt).

## Draggable and Wheelable Interfaces

New element interfaces for advanced interaction (see `src/types.ts`):

**Draggable** - For elements handling mouse drag:
- `getDragZone(x, y)` - Returns drag zone ID or null
- `handleDragStart(zone, x, y)` - Start drag
- `handleDragMove(zone, x, y)` - Continue drag
- `handleDragEnd(zone, x, y)` - End drag

Used by: dialog title bars, scrollbar thumbs

**Wheelable** - For elements handling wheel events:
- `canHandleWheel(x, y)` - Check if position handles wheel
- `handleWheel(deltaX, deltaY)` - Handle wheel, returns true if consumed

Used by: table tbody (scrollable), custom scroll areas

The engine checks `isWheelable(target)` before falling through to default scroll handling.

## Table Hit Testing

Table components require special hit testing (see `src/hit-test.ts`):

**Problem:** Click on a `<td>` should trigger table row onClick, not return the td element.

**Solution:** `_isTablePart()` checks if element is tbody/thead/tfoot/tr/td/th. If hit target is a table part, `_findContainingTable()` walks up to return the table instead.

## Checkbox ASCII Characters

Checkbox uses ASCII `[x]` instead of Unicode `[✓]` for consistent terminal width:
- `[x]` - Checked
- `[ ]` - Unchecked
- `[-]` - Indeterminate

The Unicode checkmark `✓` has inconsistent width across terminals, causing layout issues. ASCII characters have predictable 1-char width.

## intrinsicSize Contract

Component `intrinsicSize()` methods must return **content size only** (without padding or border). The layout engine adds padding and border separately.

**Contract:**
```typescript
// Component intrinsicSize returns content dimensions only
intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
  // DO NOT include padding or border here
  return { width: contentWidth, height: contentHeight };
}

// Layout engine adds padding + border for outer size:
const intrinsicOuter = intrinsicSize.width + paddingCross + borderCross;
```

**Rationale:**
- Prevents double-counting when layout adds chrome
- Consistent behavior across all components
- Layout engine has full control over box model calculations

**Exceptions:**
- Default buttons (`[ ]` style) include brackets in width (4 chars) since brackets are content, not border
- Components with explicit `style.width`/`height` may return those values

## Single-Line Element Padding

For single-line elements (buttons, text, input) without borders, vertical padding is ignored in flex cross-axis calculation.

**Implementation** (`src/layout.ts`):
```typescript
let effectivePaddingCross = paddingCross;
if (isRow && intrinsicSize.height === 1 && borderCross === 0) {
  effectivePaddingCross = 0;  // Skip vertical padding for single-line elements
}
```

This prevents buttons from expanding to 3 lines when `padding: 1` is applied.

## Flex Layout Cross-Axis Calculation

**CRITICAL**: The `baseCross` calculation in flex layout must handle three cases correctly (see `src/layout.ts` ~lines 586-608):

### 1. Explicit cross-size (border-box)
```typescript
if (!useIntrinsicSize && typeof childProps.height === 'number') {
  baseCross = childProps.height;  // Already includes padding+border
}
```

### 2. Stretch alignment
```typescript
else if (willStretch) {
  const intrinsicOuter = intrinsicSize.height + paddingCross + borderCross;
  baseCross = Math.max(crossAxisSize, intrinsicOuter);  // Fill space, min intrinsic
}
```

### 3. Non-stretch (intrinsic sizing)
```typescript
else {
  baseCross = intrinsicSize.height + paddingCross + borderCross;  // Outer size
}
```

**Key invariant**: `baseCross` is always the element's outer size (including padding and border). Do NOT add `paddingCross` again at finalization.

**Common bugs:**
- Adding `paddingCross` to `baseCross` at finalization (line ~915) causes double-counting
- Using `crossAxisSize - paddingCross` for stretch can go negative when space is small (e.g., button with padding in a 1-row container)

**Stretch finalization** (line ~934):
```typescript
case 'stretch':
  finalCross = lineCrossSize - item.marginCross;  // Uses line size, not baseCross
```

For stretch, the final size comes from `lineCrossSize`, which is calculated from the maximum `baseCross` of all items in the line, plus any distributed free space from `align-content: stretch`.

## Dialog Intrinsic Size

Dialogs must return zero intrinsic size since they are rendered as overlays, not part of normal layout flow.

**Problem:** When dialog is open, background content disappears even with `backdrop="false"`.

**Cause:** Dialog's `intrinsicSize()` returned full viewport size when open, consuming layout space.

**Fix** (`src/components/dialog.ts`):
```typescript
intrinsicSize(_context: IntrinsicSizeContext): { width: number; height: number } {
  return { width: 0, height: 0 };  // Dialogs are overlays
}
```

## Dialog-Only Render Path

For performance, dialog interactions use a fast render path that skips full layout recalculation:

**Triggers:**
- Dialog drag/resize (throttled to ~60fps)
- Scrolling inside a dialog (via `ScrollHandler._isInsideDialog()`)

**Implementation** (`src/rendering.ts` `renderDialogOnly()`):
1. Check for cached layout tree - return false if none
2. Clear buffer
3. Re-render main content from cached layout (no layout recalculation)
4. Apply low-contrast effect for non-backdrop modals
5. Render modals at new positions

**Scroll handler integration** (`src/scroll-handler.ts`):
```typescript
if (updated && this._autoRender) {
  if (this._onRenderDialogOnly && this._isInsideDialog(targetContainer)) {
    this._onRenderDialogOnly();  // Fast path
  } else {
    this._onRender();  // Full render
  }
}
```

## Flex Display Auto-Inference

`display: flex` is automatically inferred when flex container properties are present in style.

**Trigger properties:** `flexDirection`, `justifyContent`, `alignItems`, `alignContent`, `flexWrap`, `gap`

**Implementation** (`src/layout.ts` `_computeLayoutProps()`):
```typescript
if (result.display !== 'flex') {
  const hasFlexContainerProps =
    style.flexDirection !== undefined ||
    style.justifyContent !== undefined ||
    style.alignItems !== undefined ||
    style.alignContent !== undefined ||
    style.flexWrap !== undefined ||
    style.gap !== undefined;
  if (hasFlexContainerProps) {
    result.display = 'flex';
  }
}
```

Note: Flex *item* properties (`flex`, `flexGrow`, `flexShrink`, `flexBasis`) don't trigger auto-inference since they describe how an element behaves inside a flex container, not that the element itself is a flex container.

## Table Render Caching

Tables with many rows cache expensive calculations to avoid O(n) loops on every render.

**Caches** (`src/components/table.ts`):
- `_cachedSortedRows` - Avoids O(n log n) sort
- `_cachedContentHeight` - Avoids O(n) row height calculation
- `_cachedColumnWidths` - Avoids O(n) intrinsicSize() calls

**Cache invalidation:**
- Cache keys include row count, sort parameters, column settings
- Uses `children.length` (O(1)) instead of `getRows().length` (O(n)) for cache key
- Caches invalidate when data actually changes

## Element Interfaces and Type Guards

Melker uses TypeScript interfaces with type guards for duck-typed element methods. This provides type safety without requiring all elements to implement all interfaces.

**Core interfaces** (see `src/types.ts`):

| Interface | Method | Purpose |
|-----------|--------|---------|
| `Focusable` | `canReceiveFocus()` | Elements that can receive keyboard focus |
| `FocusCapturable` | `capturesFocusForChildren()` | Elements that handle focus for all children (dialogs) |
| `Clickable` | `handleClick(event, document)` | Elements handling click events with full event object |
| `PositionalClickHandler` | `handleClick(x, y)` | Elements handling clicks with coordinates (markdown, textarea) |
| `Toggleable` | `toggle()` | Elements with open/closed state (command palettes) |
| `KeyInputHandler` | `handleKeyInput(value)` | Elements handling text input |
| `ContentGettable` | `getContent()` | Elements returning their text content |
| `HasIntrinsicSize` | `intrinsicSize(context)` | Elements calculating their own size |
| `Renderable` | `render()`, `intrinsicSize()` | Elements with full rendering capability |
| `Wheelable` | `canHandleWheel()`, `handleWheel()` | Elements handling scroll wheel |
| `Draggable` | `getDragZone()`, `handleDrag*()` | Elements with drag interactions |
| `KeyboardElement` | `handlesOwnKeyboard()`, `onKeyPress()` | Elements with custom keyboard handling |
| `ShaderElement` | `updateShaderMouse()`, `clearShaderMouse()` | Elements supporting shader mouse tracking |

**Type guards** follow the pattern `is<Interface>(element)` or `has<Method>(element)`:

```typescript
import { isFocusable, hasPositionalClickHandler, isToggleable } from './types.ts';

// Type-safe method access after guard
if (isFocusable(element)) {
  if (element.canReceiveFocus()) {
    // Handle focusable element
  }
}

if (hasPositionalClickHandler(element)) {
  element.handleClick(x, y);  // TypeScript knows this is valid
}
```

**Implementation pattern** for type guards:
```typescript
export function isFocusable(element: Element): element is Element & Focusable {
  const el = element as unknown as Record<string, unknown>;
  return typeof el.canReceiveFocus === 'function';
}
```

**Global type declarations** (`src/globals.d.ts`):

The `globals.d.ts` file declares global variables used throughout the codebase:
- `melkerEngine` - Global engine instance
- `$melker` - Context object for .melker scripts
- `$app` - Alias for `$melker.exports`
- `argv` - Command-line arguments
- `__melker` - Handler registry
- `__melkerRequestRender` - Render request function
- `logger` - Global logger instance

To include global declarations in the module graph (required for test type checking), `types.ts` imports `globals.d.ts`:
```typescript
import './globals.d.ts';
```

## Chrome Collapse Implementation

When content bounds would be negative due to insufficient space, chrome (padding then border) is progressively collapsed (see `src/sizing.ts`).

**Types:**
```typescript
interface ChromeCollapseState {
  paddingCollapsed: BoxDimensions;  // Amount reduced per side
  borderCollapsed: { top, right, bottom, left: boolean };
}

interface ContentBoundsResult {
  bounds: Bounds;
  chromeCollapse?: ChromeCollapseState;
}
```

**Flow:**
1. `calculateContentBounds()` detects insufficient space
2. Padding reduced proportionally, tracking in `paddingCollapsed`
3. If still insufficient, borders collapsed one side at a time
4. State stored in `LayoutNode.chromeCollapse`
5. `_renderBorder()` skips collapsed borders
