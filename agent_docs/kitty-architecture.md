# Kitty Graphics Architecture

## Summary

- Modern protocol sending base64-encoded pixel data; 24-bit color with true alpha, no quantization
- Best quality for images, video, and shader effects; auto-disabled in tmux/screen
- Supports chunked transfer and placement IDs for efficient updates

See [Graphics Architecture](graphics-architecture.md) for common concepts (detection pattern, rendering pipeline, configuration).

## Overview

The [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) is a modern terminal graphics protocol that encodes images as base64-encoded pixel data. Supports 24-bit color with true alpha blending, no quantization needed.

**When to use kitty:**
- High-quality images with transparency
- Video playback (no palette overhead)
- Shader effects (better gradients than sixel)

**When to avoid:**
- tmux/screen (auto-disabled, not supported)
- Terminals without kitty support (auto-fallback to sextant)

## Protocol Format

```
ESC _G <control>;<payload> ESC \
       │         │
       │         └── Base64-encoded pixel data
       └── key=value pairs (a=T, f=32, s=width, v=height, i=id, q=2)
```

**Key parameters:**

| Key   | Description                                                        |
|-------|--------------------------------------------------------------------|
| `a`   | Action: `t` transmit, `T` transmit+display, `d` delete, `q` query  |
| `f`   | Format: `24` RGB, `32` RGBA, `100` PNG                             |
| `s,v` | Source width, height in pixels                                     |
| `c,r` | Display columns, rows                                              |
| `i`   | Image ID (24-bit)                                                  |
| `m`   | More data: `1` intermediate chunk, `0` final                       |
| `q`   | Quiet: `2` suppress all responses                                  |

**Chunking:** Data must be split into ≤4096 byte chunks.

## Components

### Detection (`src/kitty/detect.ts`)

**Capabilities detected:**
- `supported` - Whether kitty graphics is available
- `cellWidth`, `cellHeight` - Pixels per character cell
- `inMultiplexer` - Running in tmux/screen

**Detection flow:**
1. Check environment hints (fast path):
   - `KITTY_WINDOW_ID` - Kitty terminal
   - `WEZTERM_PANE` - WezTerm
   - `GHOSTTY_RESOURCES_DIR` - Ghostty
2. Skip query if no hints (fast-fail on unsupported terminals)
3. Send query: `ESC_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA ESC\ ESC[c`
4. Success: `ESC_Gi=31;OK ESC\` before DA1 response

### Encoder (`src/kitty/encoder.ts`)

Converts RGBA pixel data to kitty protocol format.

```typescript
interface KittyEncodeOptions {
  pixels: Uint32Array;      // RGBA packed pixels
  width: number;
  height: number;
  format?: 'rgb' | 'rgba';
  imageId?: number;         // Stable ID for in-place replacement
  columns?: number;         // Display width in columns
  rows?: number;            // Display height in rows
}

encodeToKitty(options: KittyEncodeOptions): KittyOutput
positionedKitty(output: KittyOutput, col: number, row: number): string
generateImageId(): number
deleteKittyImage(imageId: number): string
```

## Stable Image IDs

Each canvas element gets a stable `_kittyStableImageId` generated once. This ID is reused for all frames, allowing Kitty to replace images in-place.

**Without stable IDs:**
```
Frame 1: Display ID=100
Frame 2: Display ID=101, delete ID=100  ← flicker!
```

**With stable IDs:**
```
Frame 1: Display ID=100
Frame 2: Display ID=100 (replaces)  ← no flicker
```

Kitty's `a=T` action automatically replaces an existing image at the same ID.

## Content Caching

`CanvasRenderState` maintains per-element cache:
- `_kittyContentHash` - FNV-1a hash of composited buffer
- `_kittyCachedOutput` - Encoded kitty data
- `_kittyCachedBounds` - Position and size

Cache invalidates automatically when content, position, or size changes. Cached outputs skip re-transmission (already displayed with same stable ID).

## Terminal Compatibility

**Full support:** Kitty, Ghostty, WezTerm, Konsole

**Partial:** iTerm2

**No support:** Alacritty, tmux/screen, Apple Terminal, GNOME Terminal

## Performance

| Content Type | Notes                               |
|--------------|-------------------------------------|
| Static image | O(1) after first frame (cached)     |
| Video        | ~1-2ms encoding (no quantization)   |
| Shader       | ~1-2ms encoding (better than sixel) |

**Advantages over sixel:**
- No quantization step
- No palette management
- True alpha blending
- Better gradients (no 256-color limit)

## Future: PNG Passthrough

Kitty supports direct PNG transmission via `f=100`:
- Store original PNG bytes when loading
- Use PNG passthrough for static `<img>` elements
- Fall back to RGBA for dynamic content

## Files

| File                   | Purpose               |
|------------------------|-----------------------|
| `src/kitty/mod.ts`     | Module exports        |
| `src/kitty/types.ts`   | Type definitions      |
| `src/kitty/detect.ts`              | Capability detection                  |
| `src/kitty/encoder.ts`             | Kitty format encoder                  |
| `src/utils/terminal-detection.ts`  | Shared multiplexer/remote detection   |
| `src/utils/pixel-utils.ts`         | Shared pixel encoding (Uint32→bytes)  |

## See Also

- [graphics-architecture.md](graphics-architecture.md) — Common graphics pipeline
- [sixel-architecture.md](sixel-architecture.md) — Sixel graphics protocol
- [gfx-modes.md](gfx-modes.md) — All graphics modes

## References

- [Kitty Graphics Protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/)
- [Kitty Query Terminal](https://sw.kovidgoyal.net/kitty/kittens/query_terminal/)
