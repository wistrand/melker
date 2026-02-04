# Sixel Graphics Architecture

See [Graphics Architecture](graphics-architecture.md) for common concepts (detection pattern, rendering pipeline, configuration).

## Overview

[Sixel](https://en.wikipedia.org/wiki/Sixel) is a bitmap graphics format from DEC that encodes images as 6-pixel-high vertical strips using ASCII characters. Limited to 256 colors per image, requires palette quantization.

**When to use sixel:**
- Wide terminal support (more than kitty)
- High-quality images and photos
- Video playback

**When to avoid:**
- SSH (auto-disabled for bandwidth)
- tmux/screen (auto-disabled)
- Terminals without sixel support (auto-fallback to sextant)

## Protocol Format

```
ESC P q [params] [color defs] [sixel data] ESC \
        │        │             │
        │        │             └── Chars '?' (0x3F) to '~' (0x7E)
        │        └── #reg;2;r%;g%;b%
        └── P1;P2;P3 (aspect, background, grid)
```

- Each character encodes 6 vertical pixels as a bitmask
- `$` = carriage return, `-` = line feed (next 6-pixel row)
- RLE: `!count char` (e.g., `!14@` = repeat `@` 14 times)

## Components

### Detection (`src/sixel/detect.ts`)

**Capabilities detected:**
- `supported` - Whether sixel is available
- `colorRegisters` - Number of palette colors (typically 256)
- `cellWidth`, `cellHeight` - Pixels per character cell
- `maxWidth`, `maxHeight` - Maximum sixel dimensions
- `inMultiplexer` - Running in tmux/screen
- `isRemote` - Running over SSH
- `quirks` - Terminal-specific issues (e.g., `konsole-sixel-edge`)

**Detection queries:**
1. DA1 (`ESC [ c`) - Primary Device Attributes, "4" indicates sixel
2. XTSMGRAPHICS (`ESC [ ? 1 ; 1 S`) - Color register count
3. XTSMGRAPHICS (`ESC [ ? 2 ; 1 S`) - Max graphics geometry
4. WindowOps (`ESC [ 16 t`) - Cell size in pixels

### Encoder (`src/sixel/encoder.ts`)

Converts indexed pixel data to sixel format with RLE compression.

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

Color quantization for 256-color limit.

**Palette modes:**

| Mode       | Description                    | Used By                 |
|------------|--------------------------------|-------------------------|
| `cached`   | Compute once, reuse forever    | Static `<img>`          |
| `keyframe` | Cache palette, re-index frames | Video, shaders, filters |

**Keyframe mode:**
- Palette cached from first "good" frame (≥32 colors)
- Subsequent frames re-indexed against cached palette (fast)
- Auto-regenerates on >2% color error or brightness gap

**Pre-quantization dithering:**
- Dynamic content applies dithering before 256-color quantization
- Default: `blue-noise` with 3 bits
- Reduces color banding for gradients

```typescript
interface PaletteResult {
  colors: number[];       // Up to 256 RGBA colors
  indexed: Uint8Array;    // Pixels as palette indices
  transparentIndex: number;
  colorLUT?: Uint8Array;  // 32KB lookup table for O(1) indexing
}

quantizePalette(pixels, mode, maxColors, cacheKey): PaletteResult
```

## Terminal Compatibility

**Full support:** xterm (with `-ti vt340`), mlterm, foot, WezTerm, iTerm2, VS Code terminal

**Partial:** Konsole (right-edge gap quirk)

**No support:** Apple Terminal, GNOME Terminal, tmux/screen

## Known Quirks

### Konsole: Right-Edge Gap

**Symptom:** One-character-wide column on right side shows terminal background.

**Cause:** Konsole's sixel rendering doesn't fully cover character cells.

**Workaround:** Detected via `TERM_PROGRAM`, adds `konsole-sixel-edge` quirk. Engine forces full redraw when scrolling with sixel visible.

## Performance

| Content Type | Palette Mode | Notes                                |
|--------------|--------------|--------------------------------------|
| Static image | cached       | O(1) after first frame               |
| Video        | keyframe     | Fast re-indexing between keyframes   |
| Shader       | keyframe     | Regenerates on >2% color drift       |

**Optimizations:**
- Color LUT: 32KB table for O(1) palette lookups instead of O(n) search
- Typed arrays for color tracking (no GC pressure)
- No logging in hot paths

**Memory:** 1-5MB for full-screen sixel. 32KB per palette LUT.

**Bandwidth:** 10-100x larger than sextant (why SSH is auto-disabled).

## Files

| File                   | Purpose              |
|------------------------|----------------------|
| `src/sixel/mod.ts`     | Module exports       |
| `src/sixel/detect.ts`  | Capability detection |
| `src/sixel/encoder.ts` | Sixel format encoder |
| `src/sixel/palette.ts` | Color quantization   |

## See Also

- [graphics-architecture.md](graphics-architecture.md) — Common graphics pipeline
- [kitty-architecture.md](kitty-architecture.md) — Kitty graphics protocol
- [gfx-modes.md](gfx-modes.md) — All graphics modes

## References

- [Sixel - Wikipedia](https://en.wikipedia.org/wiki/Sixel)
- [VT330/340 Sixel Graphics Reference](https://vt100.net/docs/vt3xx-gp/chapter14.html)
- [Are We Sixel Yet?](https://www.arewesixelyet.com/)
