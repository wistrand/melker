# iTerm2 Graphics Architecture

See [Graphics Architecture](graphics-architecture.md) for common concepts (detection pattern, rendering pipeline, configuration).

## Overview

The [iTerm2 Inline Images Protocol](https://iterm2.com/documentation-images.html) encodes images as base64-encoded PNG/JPEG/GIF data in OSC escape sequences. Widely supported by modern terminals beyond iTerm2.

**When to use iterm2:**
- Terminals that support iTerm2 protocol (Rio, WezTerm, Konsole, Hyper)
- When kitty and sixel aren't available
- Good balance of compatibility and quality

**When to avoid:**
- Kitty/sixel-capable terminals (those are preferred in `hires` mode)
- High-frame-rate content (PNG encoding overhead)

## Protocol Format

**Single sequence (default):**
```
ESC ] 1337 ; File = [params] : <base64-data> BEL
```

**Multipart sequence (tmux only):**
```
ESC ] 1337 ; MultipartFile = [params] BEL
ESC ] 1337 ; FilePart = <base64-chunk> BEL
...
ESC ] 1337 ; FileEnd BEL
```

**Note:** Multipart is only used when explicitly running in tmux. Most terminals (WezTerm, Rio, Konsole) don't support multipart but handle large single sequences fine.

**Key parameters:**

| Parameter             | Description                                      |
|-----------------------|--------------------------------------------------|
| `inline=1`            | Display image (not download)                     |
| `width=N` / `width=Npx` | Display width in cells or pixels               |
| `height=N` / `height=Npx` | Display height in cells or pixels            |
| `preserveAspectRatio` | `1` maintain ratio (default), `0` stretch        |
| `size=N`              | File size in bytes (for progress)                |
| `name=base64`         | Filename (base64 encoded)                        |

## Components

### Detection (`src/iterm2/detect.ts`)

**Environment-based detection** (no terminal queries needed):

| Variable            | Terminal                    |
|---------------------|-----------------------------|
| `ITERM_SESSION_ID`  | iTerm2                      |
| `TERM_PROGRAM`      | iTerm.app, WezTerm, Konsole |
| `LC_TERMINAL`       | iTerm2                      |
| `WEZTERM_PANE`      | WezTerm                     |
| `KONSOLE_VERSION`   | Konsole                     |
| `TERM=rio`          | Rio                         |

**Capabilities detected:**
- `supported` - Protocol available
- `inMultiplexer` - Running in tmux/screen (enables multipart)
- `useMultipart` - Whether to use chunked transfer
- `terminalProgram` - Detected terminal name

### Encoder (`src/iterm2/encoder.ts`)

Converts RGBA pixel data to iTerm2 protocol format via PNG.

```typescript
interface ITermEncodeOptions {
  pixels: Uint32Array;           // RGBA packed pixels (0xRRGGBBAA)
  width: number;                 // Image width in pixels
  height: number;                // Image height in pixels
  displayWidth?: number | string;  // Display size (cells or "Npx")
  displayHeight?: number | string;
  preserveAspectRatio?: boolean;
  useMultipart?: boolean;
}

encodeToITerm2(options: ITermEncodeOptions): ITermOutput
encodeImageToITerm2(options): ITermOutput  // PNG passthrough
positionedITerm2(output: ITermOutput, col: number, row: number): string
```

**PNG encoding:** Uses `fast-png` with compression level 0 (no compression) for maximum encoding speed. iTerm2 handles decompression.

## Aspect Ratio Handling

Terminal cells are not square (typically ~1:2 width:height in pixels). Melker handles this by:

1. Query cell dimensions via sixel detection (e.g., Rio: 12x24 pixels)
2. Calculate target pixel dimensions: `terminalWidth * cellWidth`, `terminalHeight * cellHeight`
3. Pass pixel dimensions with `px` suffix: `width=1200px;height=960px`
4. Set `preserveAspectRatio=0` since we specify exact dimensions

This lets iTerm2 scale the image to fill the cell area correctly.

## Content Caching

`CanvasRenderState` maintains per-element cache:
- `_itermContentHash` - FNV-1a hash of composited buffer
- `_itermCachedOutput` - Encoded iTerm2 data
- `_itermCachedBounds` - Position and size

Cache invalidates when content, position, or size changes.

## Terminal Compatibility

**Full support:** iTerm2, WezTerm, Konsole, Rio, Hyper

**No support:** Alacritty, Apple Terminal, GNOME Terminal (use sixel), VS Code terminal

## Performance

| Aspect          | Notes                                           |
|-----------------|-------------------------------------------------|
| PNG encoding    | ~5-15ms depending on size (no compression)      |
| Base64 encoding | ~1-2ms                                          |
| Caching         | O(1) for unchanged content                      |
| Scaling         | Done by terminal (GPU-accelerated)              |

**Comparison:**
- Faster than sixel (no quantization/palette)
- Slower than kitty (PNG overhead vs raw RGBA)
- More compatible than kitty (wider terminal support)

## Fallback Chain

In `hires` mode, graphics protocols are tried in order:
1. **Kitty** - Best performance, limited compatibility
2. **Sixel** - Good compatibility, quantization overhead
3. **iTerm2** - Wide compatibility, PNG overhead
4. **Sextant** - Universal fallback (Unicode characters)

## Files

| File                   | Purpose              |
|------------------------|----------------------|
| `src/iterm2/mod.ts`    | Module exports       |
| `src/iterm2/types.ts`  | Type definitions     |
| `src/iterm2/detect.ts` | Capability detection |
| `src/iterm2/encoder.ts`| PNG/iTerm2 encoder   |

## See Also

- [graphics-architecture.md](graphics-architecture.md) - Common graphics pipeline
- [kitty-architecture.md](kitty-architecture.md) - Kitty graphics protocol
- [sixel-architecture.md](sixel-architecture.md) - Sixel graphics protocol
- [gfx-modes.md](gfx-modes.md) - All graphics modes

## References

- [iTerm2 Inline Images Protocol](https://iterm2.com/documentation-images.html)
- [iTerm2 Proprietary Escape Codes](https://iterm2.com/documentation-escape-codes.html)
