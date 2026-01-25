# Sixel Graphics Architecture

## Overview

[Sixel](https://en.wikipedia.org/wiki/Sixel) is a bitmap graphics format from DEC that encodes images as 6-pixel-high vertical strips using ASCII characters. Melker uses sixel for true pixel-level rendering without character cell limitations.

**When to use sixel:**
- High-quality images and photos
- Video playback on supported terminals
- Shader effects where color fidelity matters

**When to avoid:**
- Running over SSH (auto-disabled for bandwidth)
- tmux/screen (auto-disabled, not supported)
- Terminals without sixel support (auto-fallback to sextant)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           APPLICATION                                    │
│  <canvas gfxMode="sixel">  <img gfxMode="sixel">  <video>               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         CANVAS COMPONENT                                 │
│  src/components/canvas.ts                                                │
│  - Manages pixel buffer (RGBA)                                          │
│  - Selects palette mode (cached/keyframe)                               │
│  - Calls rendering pipeline                                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
┌─────────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  canvas-render.ts   │  │   palette.ts    │  │   encoder.ts    │
│  - Mode selection   │  │  - Quantization │  │  - Sixel format │
│  - Placeholder      │  │  - Caching      │  │  - RLE compress │
│  - Fallback logic   │  │  - Keyframe     │  │  - Color defs   │
└─────────────────────┘  └─────────────────┘  └─────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            ENGINE                                        │
│  src/engine.ts                                                           │
│  - Sixel overlay output (after buffer)                                  │
│  - Stale region clearing                                                │
│  - Overlay detection (clear sixels when dialogs visible)                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           TERMINAL                                       │
│  - Receives buffer diff (normal rendering)                              │
│  - Receives sixel overlay (direct pixel output)                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Components

### Detection (`src/sixel/detect.ts`)

Detects terminal sixel capabilities at startup. Uses an async query/response pattern to avoid orphaned stdin reads.

**Capabilities detected:**
- `supported` - Whether sixel is available
- `colorRegisters` - Number of palette colors (typically 256)
- `cellWidth`, `cellHeight` - Pixels per character cell (always queried, used for aspect ratio even without sixel)
- `maxWidth`, `maxHeight` - Maximum sixel dimensions
- `inMultiplexer` - Running in tmux/screen (sixel disabled)
- `isRemote` - Running over SSH (sixel disabled for bandwidth)
- `quirks` - Terminal-specific issues (e.g., `konsole-sixel-edge`)

**Detection queries:**
1. DA1 (`ESC [ c`) - Primary Device Attributes, "4" indicates sixel
2. XTSMGRAPHICS (`ESC [ ? 1 ; 1 S`) - Color register count (sixel only)
3. XTSMGRAPHICS (`ESC [ ? 2 ; 1 S`) - Max graphics geometry (sixel only)
4. WindowOps (`ESC [ 16 t`) - Cell size in pixels (always queried for aspect ratio)

**API:**
```typescript
startSixelDetection(): Promise<SixelCapabilities>
getCachedSixelCapabilities(): SixelCapabilities | null
isSixelAvailable(): boolean
feedDetectionInput(data: Uint8Array): boolean  // Called by input loop
```

### Encoder (`src/sixel/encoder.ts`)

Pure TypeScript sixel encoder. Converts indexed pixel data to sixel format.

**Sixel format:**
```
ESC P q [params] [color defs] [sixel data] ESC \
        │        │             │
        │        │             └── Chars '?' (0x3F) to '~' (0x7E)
        │        └── #reg;2;r%;g%;b%
        └── P1;P2;P3 (aspect, background, grid)
```

- Each character encodes 6 vertical pixels
- `$` = carriage return, `-` = line feed (next 6-pixel row)
- RLE: `!count char` (e.g., `!14@` = repeat `@` 14 times)

**API:**
```typescript
interface SixelEncodeOptions {
  palette: number[];        // RGBA colors (max 256)
  indexed: Uint8Array;      // Pixel indices into palette
  width: number;
  height: number;
  transparentIndex?: number;
  useRLE?: boolean;         // Default: true
}

encodeToSixel(options: SixelEncodeOptions): SixelOutput
positionedSixel(data: string, x: number, y: number): string
```

### Palette (`src/sixel/palette.ts`)

Color quantization and palette management. Sixel is limited to 256 colors per image.

**Palette modes:**

| Mode | Description | Used By |
|------|-------------|---------|
| `cached` | Compute once, reuse forever | Static images, `<img>` without callbacks |
| `keyframe` | Cache palette, re-index frames, regenerate on drift | Video, `<canvas onShader/onPaint>`, `<img onFilter>` |
| `dynamic` | Recompute every frame | Available but not used (keyframe preferred) |
| `fixed` | Standard 6x6x6 RGB cube | Fallback only |

**Pre-quantization dithering:**
- Dynamic content (`onPaint`, `onShader`, `onFilter`) applies dithering before 256-color quantization
- Default: `blue-noise` with 3 bits (8 levels per channel)
- Reduces color banding, especially for gradients
- Respects `dither` prop if explicitly set (`dither="none"` disables)
- Respects `MELKER_DITHER_BITS` env var

**Keyframe mode details:**
- Palette cached from first "good" frame (≥32 colors)
- Subsequent frames re-indexed against cached palette (fast)
- Auto-regenerates when:
  - Mean color error exceeds 2% (scene change)
  - Brightness gap >50 (palette too dark for frame)
  - Initial palette had <32 colors

**API:**
```typescript
interface PaletteResult {
  colors: number[];       // Up to 256 RGBA colors
  indexed: Uint8Array;    // Pixels as palette indices
  transparentIndex: number;
  colorLUT?: Uint8Array;  // 32KB lookup table for O(1) indexing
}

quantizePalette(pixels, mode, maxColors, cacheKey): PaletteResult
```

### Canvas Render (`src/components/canvas-render.ts`)

Handles sixel rendering path and mode selection.

**Mode resolution:**
```typescript
function getEffectiveGfxMode(propsGfxMode?: GfxMode): GfxMode {
  const globalGfxMode = MelkerConfig.get().gfxMode;
  const result = globalGfxMode || propsGfxMode || 'sextant';

  // Auto-fallback if sixel unavailable
  if (result === 'sixel' && !capabilities?.supported) {
    return 'sextant';
  }
  return result;
}
```

**Clipping behavior:**
- Sixel cannot be partially rendered (no clipping support)
- When clipped by viewport/scroll, shows `.` placeholder
- Sextant fallback not feasible (incompatible buffer resolutions)

**Pixel aspect ratio** (`canvas.getPixelAspectRatio()`):
- Sixel mode: returns 1.0 (square pixels)
- Other modes: uses detected cell size when available
- Formula: `(3 * cellWidth) / (2 * cellHeight)` (sextant pixels are 2 wide × 3 tall per cell)
- Fallback: `(2/3) * charAspectRatio` prop when detection unavailable
- Used by: `drawCircleCorrected()`, shaders (`resolution.pixelAspect`), image scaling

## Detection Architecture

The detection uses an async query/response pattern to avoid a critical problem with orphaned stdin reads.

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
│                            STARTUP                                       │
├─────────────────────────────────────────────────────────────────────────┤
│  1. Engine starts input loop (src/input.ts)                             │
│     - Single read point: inputLoop() owns ALL stdin reads               │
│                                                                          │
│  2. Engine calls startSixelDetection()                                  │
│     - Detection ONLY writes queries to stdout                           │
│     - Sets detectionState.phase = 'da1'                                 │
│     - Returns Promise (resolves when detection complete)                │
│                                                                          │
│  3. Input loop reads terminal responses                                 │
│     - Calls feedDetectionInput(data) with raw bytes                     │
│     - Detection state machine processes responses                       │
│     - Returns true if consumed, false to process normally               │
│     - Ctrl+C (0x03) always passed through (never consumed)              │
│                                                                          │
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
- Response validation uses full regex patterns, not simple terminator chars
- 100ms timeout per phase with graceful fallback to defaults

## Rendering Pipeline

Sixel bypasses the dual-buffer character system and renders as an overlay.

**Render sequence:**
```
1. Layout pass - calculate bounds for all elements
2. Paint pass - render UI to buffer (sixel regions get placeholder)
3. Buffer diff - output changed characters
4. Sixel overlay - output sixel graphics at their positions
5. Clear stale - erase sixel regions that moved/disappeared
```

**Overlay/dialog handling:**
Sixel graphics would overwrite dialogs since they bypass the buffer. Solution: detect overlays and clear sixels BEFORE buffer output.

```typescript
// In engine.ts render pipeline:
if (renderer.hasVisibleOverlays() && previousSixelBounds.length > 0) {
  // Clear sixels BEFORE buffer output so dialog is fully visible
  clearStaleSixelAreas([]);
  previousSixelBounds = [];
}
// Then output buffer (includes dialog)
```

**Overlay detection** (`src/rendering.ts`):
- Checks `_overlays` array (dropdown menus, select boxes)
- Checks for open `<dialog>` elements
- Returns true if any overlay is visible

## Terminal Compatibility

**Full support:**
- xterm (with `-ti vt340`)
- mlterm (best sixel quality)
- foot
- WezTerm
- iTerm2
- VS Code terminal

**Partial support:**
- Konsole (right-edge gap quirk)
- Windows Terminal (improving)

**No support:**
- Apple Terminal
- GNOME Terminal (VTE-based)
- tmux/screen (multiplexers)

**Auto-disabled:**
- tmux/screen detected via `$TMUX`, `$STY`
- SSH detected via `$SSH_CLIENT`, `$SSH_CONNECTION`, `$SSH_TTY`

## Configuration

**Environment variable:**
```bash
MELKER_GFX_MODE=sixel
```

**Per-element:**
```xml
<canvas gfxMode="sixel" onPaint="..." />
<img gfxMode="sixel" src="photo.jpg" />
```

**Priority:** Global config > per-element prop > default (sextant)

**Fallback:** If sixel requested but unavailable, automatically falls back to sextant.

## Known Terminal Quirks

### Konsole: Right-Edge Gap

**Symptom:** One-character-wide column on right side shows terminal background.

**Cause:** Konsole's sixel rendering doesn't fully cover character cells. Likely a mismatch between reported cell width and internal metrics.

**Workarounds:**
1. Use mlterm for sixel content
2. Use `gfxMode="sextant"`
3. Scrolling triggers full redraw to prevent artifacts

**Implementation:** Konsole detected via `TERM_PROGRAM`, adds `konsole-sixel-edge` quirk. Engine tracks scroll events and forces full sixel clear + redraw when scrolling with sixel visible.

## Performance

| Content Type | Palette Mode | Quantization | Encoding | Notes |
|--------------|--------------|--------------|----------|-------|
| Static image | cached | Once | ~2-5ms | O(1) after first frame |
| Video | keyframe | Per scene | ~2-5ms | Fast re-indexing between keyframes |
| Shader | keyframe | Per scene | ~2-5ms | Regenerates on >2% color drift |

**Memory:** Full-screen sixel uses 1-5MB vs ~100KB for sextant. Each palette adds 32KB for the color LUT.

**Bandwidth:** Sixel is 10-100x larger than sextant output. This is why sixel is auto-disabled over SSH.

## Performance Optimizations

### Color Lookup Table (LUT)

Instead of O(n) linear search for each pixel's nearest palette color, a 32KB lookup table provides O(1) lookups:

```typescript
// 32x32x32 = 32768 entries (5 bits per RGB channel)
const colorLUT = new Uint8Array(32768);

// Build once per palette (~30ms for 256 colors)
for (r5, g5, b5 in 0..31) {
  lut[r5 << 10 | g5 << 5 | b5] = findNearestColor(r5*8, g5*8, b5*8, palette);
}

// Lookup is O(1) per pixel
const index = lut[(r >> 3) << 10 | (g >> 3) << 5 | (b >> 3)];
```

**Impact:** For keyframe mode re-indexing, reduces from O(unique_colors × 256) comparisons to O(pixels) simple lookups.

### Typed Array Color Tracking

The encoder uses typed arrays instead of JavaScript Set for tracking used colors per row:

```typescript
// Instead of Set<number> with JS object overhead:
const colorUsedBitmap = new Uint8Array(256);  // O(1) membership check
const usedColorsList = new Uint16Array(256);  // O(n) iteration
```

**Impact:** ~2-3x faster row encoding, no GC pressure from Set operations.

### Hot Path Optimization

Debug logging removed from per-frame code paths:
- `encodeToSixel()` - no logging during encoding
- `quantizePalette()` - no logging on cache hits
- `_generateSixelOutput()` - no logging per frame

Info logs retained for infrequent events (keyframe regeneration, detection).

## Files

| File | Purpose |
|------|---------|
| `src/sixel/mod.ts` | Module exports |
| `src/sixel/detect.ts` | Terminal capability detection |
| `src/sixel/encoder.ts` | Sixel format encoder |
| `src/sixel/palette.ts` | Color quantization |
| `src/components/canvas.ts` | Palette mode selection |
| `src/components/canvas-render.ts` | Sixel render path |
| `src/engine.ts` | Sixel overlay output |
| `src/input.ts` | Detection response routing |
| `src/rendering.ts` | Overlay detection |

## References

- [Sixel - Wikipedia](https://en.wikipedia.org/wiki/Sixel)
- [VT330/340 Sixel Graphics Reference](https://vt100.net/docs/vt3xx-gp/chapter14.html)
- [Are We Sixel Yet?](https://www.arewesixelyet.com/)
- [libsixel](https://saitoha.github.io/libsixel/)
