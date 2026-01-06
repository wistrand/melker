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

**Dialog handling**: Fast render skipped when:
- System dialogs open (alert, confirm, prompt, accessibility)
- Overlay dialog exists (dialog that doesn't contain the focused input)

Inputs inside an open dialog still use fast render.

See `agent_docs/fast-input-render-plan.md` for full architecture.

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
