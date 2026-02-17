# Graphics Architecture

## Summary

- Six graphics modes: sextant (default), block, pattern, luma, sixel, kitty, iterm2
- Text modes (sextant/block/pattern/luma) use Unicode characters; pixel modes (sixel/kitty/iterm2) use terminal protocols for true-color images
- Auto-detection picks the best available mode; `--gfx-mode` or `MELKER_GFX_MODE` overrides
- Canvas, img, and video components all go through the same rendering pipeline

## Overview

Melker supports multiple graphics modes for rendering pixel content in terminals. All modes share a common architecture for detection, rendering pipeline, and configuration.

See [gfx-modes.md](gfx-modes.md) for mode details and comparison.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              APPLICATION                                │
│  <canvas gfxMode="...">  <img gfxMode="...">  <video>                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            CANVAS COMPONENT                             │
│  src/components/canvas.ts                                               │
│  - Manages pixel buffers (drawing layer + image layer)                  │
│  - Selects effective graphics mode                                      │
│  - Delegates to mode-specific renderer                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
            │   sextant   │  │    sixel    │  │    kitty    │
            │   block     │  │  palette.ts │  │  encoder.ts │
            │   pattern   │  │  encoder.ts │  │             │
            │   luma      │  │             │  │             │
            └─────────────┘  └─────────────┘  └─────────────┘
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                                ENGINE                                   │
│  src/engine.ts + src/graphics-overlay-manager.ts                        │
│  - Buffer output (sextant/block/pattern/luma)                           │
│  - Graphics overlay output (sixel/kitty/iterm2 after buffer)            │
│  - Stale graphics cleanup                                               │
│  - Overlay detection (hide graphics when dialogs visible)               │
└─────────────────────────────────────────────────────────────────────────┘
```

## Detection Architecture

Both sixel and kitty use an async query/response pattern to detect terminal capabilities without blocking or leaving orphaned stdin reads.

**The problem with naive detection:**
```typescript
// BAD: This leaves orphaned reads that swallow Ctrl+C
writeQuery('\x1b[c');
const response = await Promise.race([
  readFromStdin(),  // This read stays pending after timeout!
  timeout(100)
]);
```

**Solution: Route all reads through main input loop:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                STARTUP                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  1. Engine starts input loop (src/input.ts)                             │
│     - Single read point: inputLoop() owns ALL stdin reads               │
│                                                                         │
│  2. Engine calls startDetection() for sixel and kitty                   │
│     - Detection ONLY writes queries to stdout                           │
│     - Returns Promise (resolves when detection complete)                │
│                                                                         │
│  3. Input loop reads terminal responses                                 │
│     - Calls feedDetectionInput(data) with raw bytes                     │
│     - Detection state machine processes responses                       │
│     - Returns true if consumed, false to process normally               │
│     - Ctrl+C (0x03) always passed through (never consumed)              │
│                                                                         │
│  4. Detection resolves when complete                                    │
│     - Capabilities cached for session                                   │
└─────────────────────────────────────────────────────────────────────────┘

                      DATA FLOW

       ┌──────────┐      queries       ┌──────────┐
       │ detect.ts│ ─────────────────► │ Terminal │
       │          │                    │          │
       └──────────┘                    └──────────┘
            ▲                               │
            │                               │ responses
            │ feedDetectionInput()          │
            │                               ▼
       ┌──────────┐      raw bytes     ┌──────────┐
       │ detect.ts│ ◄───────────────── │ input.ts │
       │  (state) │                    │  (loop)  │
       └──────────┘                    └──────────┘
```

**Detection hardening:**
- Ctrl+C (byte 0x03) always passed through during detection
- Response validation uses full regex patterns
- 100ms timeout per phase with graceful fallback to defaults
- Environment hints for fast-path (skip query on unsupported terminals)

## Rendering Pipeline

Graphics modes that bypass the character buffer (sixel, kitty) render as overlays after buffer output.

**Render sequence:**
```
1. Layout pass     - Calculate bounds for all elements
2. Paint pass      - Render UI to buffer (graphics regions get placeholder)
3. Buffer diff     - Output changed characters to terminal
4. Graphics overlay - Output sixel/kitty at their positions
5. Cleanup stale   - Clear/delete graphics that moved or disappeared
```

**Why overlays?**

Sixel and kitty output raw pixel data that bypasses the terminal's character grid. They must be rendered after the buffer to appear on top of placeholder characters.

## Overlay/Dialog Handling

Graphics overlays would obscure dialogs and dropdowns since they bypass the buffer. Solution: detect overlays and clear/delete graphics before buffer output.

```typescript
// In engine.ts render pipeline:
if (renderer.hasVisibleOverlays()) {
  // Clear sixels / delete kitty images BEFORE buffer output
  // so dialog content is fully visible
  clearGraphicsOverlays();
}
// Then output buffer (includes dialog)
// Graphics overlays skipped this frame
```

**Overlay detection** (`src/rendering.ts`):
- Checks `_overlays` array (dropdown menus, select boxes)
- Checks for open `<dialog>` elements
- Returns true if any overlay is visible

## Clipping Behavior

Graphics modes have limited clipping support:

| Mode                       | Clipping                       |
|----------------------------|--------------------------------|
| sextant/block/pattern/luma | Full clipping via buffer       |
| sixel                      | Placeholder shown when clipped |
| kitty                      | Element skipped when clipped   |

For sixel/kitty, full visibility is required. When an element extends outside the viewport, graphics output is suppressed and a placeholder may be shown.

## Configuration

**Environment variable:**
```bash
MELKER_GFX_MODE=sextant   # Default, universal
MELKER_GFX_MODE=sixel     # Sixel graphics
MELKER_GFX_MODE=kitty     # Kitty graphics
MELKER_GFX_MODE=hires     # Best available: kitty → sixel → sextant
```

**Per-element:**
```xml
<canvas gfxMode="sixel" onPaint="..." />
<img gfxMode="kitty" src="photo.jpg" />
<img gfxMode="hires" src="photo.jpg" />
```

**Priority:** Global config > per-element prop > default (sextant)

**Fallback chain:**

| Mode      | Unicode terminal             | Non-Unicode terminal (`TERM=linux`) |
|-----------|------------------------------|-------------------------------------|
| `sixel`   | sextant                      | luma                                |
| `kitty`   | sextant                      | luma                                |
| `iterm2`  | sextant                      | luma                                |
| `hires`   | kitty → sixel → iterm2 → sextant | kitty → sixel → iterm2 → luma  |
| `sextant` | sextant                      | luma                                |

Mode resolution happens in `getEffectiveGfxMode()` in `canvas-render.ts`.

## Auto-Disable Conditions

Graphics modes are automatically disabled or degraded in certain environments:

| Condition       | Detection                        | Effect                                      |
|-----------------|----------------------------------|---------------------------------------------|
| tmux/screen     | `$TMUX`, `$STY`                  | sixel, kitty disabled                       |
| SSH (remote)    | `$SSH_CLIENT`, `$SSH_CONNECTION` | sixel disabled (bandwidth)                  |
| Non-Unicode TTY | `$TERM=linux/vt100/vt220`        | sextant → luma, Unicode borders → ASCII     |

## Pixel Aspect Ratio

Terminal cells are typically taller than wide. Graphics modes handle this differently:

| Mode    | Pixel Aspect                                                              |
|---------|---------------------------------------------------------------------------|
| sextant | `(3 x cellWidth) / (2 x cellHeight)` - sextant pixels are 2 wide x 3 tall |
| sixel   | 1.0 (square pixels at native resolution)                                  |
| kitty   | 1.0 (square pixels at native resolution)                                  |

The aspect ratio is exposed via `canvas.getPixelAspectRatio()` for:
- Aspect-corrected drawing (`drawCircleCorrected()`)
- Shader `resolution.pixelAspect` uniform
- Image scaling

## Canvas Layers

Canvas maintains two pixel buffers that are composited during rendering:

```
┌─────────────────────────────────────┐
│        Drawing Layer                │  ← onPaint, onShader, draw APIs
│        (_colorBuffer)               │
├─────────────────────────────────────┤
│        Image Layer                  │  ← src prop, video frames
│        (_imageColorBuffer)          │
└─────────────────────────────────────┘
```

**Compositing:** Drawing layer takes priority. Transparent pixels show image layer beneath.

## Files

| File                                 | Purpose                                    |
|--------------------------------------|--------------------------------------------|
| `src/components/canvas.ts`           | Canvas element, buffer management          |
| `src/components/canvas-render.ts`    | Mode selection, rendering dispatch         |
| `src/sixel/`                         | Sixel detection, encoding, palette         |
| `src/kitty/`                         | Kitty detection, encoding                  |
| `src/iterm2/`                        | iTerm2 detection, encoding                 |
| `src/graphics-overlay-manager.ts`    | Sixel/Kitty/iTerm2 overlay output, cleanup |
| `src/utils/terminal-detection.ts`    | Shared multiplexer/remote session/Unicode detection |
| `src/utils/pixel-utils.ts`           | Shared pixel encoding (Uint32 to RGB/RGBA) |
| `src/engine.ts`                      | Render orchestration, delegates to manager |
| `src/input.ts`                       | Detection response routing                 |
| `src/rendering.ts`                   | Overlay detection                          |

## Canvas Size Model

Canvas-family components (`<canvas>`, `<img>`, `<progress>`) maintain two separate size concepts:

| Field                              | Purpose                                    |
|------------------------------------|--------------------------------------------|
| `props.width` / `props.height`     | Declarative value (`"100%"`, `30`, `"fill"`) used by the layout engine |
| `_terminalWidth` / `_terminalHeight` | Resolved numeric terminal-cell size used for buffer allocation, render data, and sixel sizing |

`setSize()` updates `_terminalWidth`/`_terminalHeight`, **not** `props.width`. This separation prevents responsive strings from being clobbered to numbers on resize — which previously caused images to never shrink (the layout engine's `Math.max(props.width, intrinsic)` locked in the stale numeric value). Subclasses should compare against `_terminalWidth` when checking if `setSize` is needed.

## See Also

- [Sixel Architecture](sixel-architecture.md) — Sixel-specific details
- [Kitty Architecture](kitty-architecture.md) — Kitty-specific details
- [Graphics Modes](gfx-modes.md) — User-facing mode documentation
