# Graphics Rendering Modes

Controls how canvas/image pixels are rendered to terminal characters.

## Pixel Aspect Ratio

Terminal character cells are typically taller than wide, so pixel aspect varies by mode. The `canvas.getPixelAspectRatio()` method returns the correct ratio for aspect-correct drawing.

**Calculation:**
- Sixel/Kitty/iTerm2 modes: 1.0 (square pixels at native resolution)
- Half-block: `(2 * cellWidth) / cellHeight` (~1.0, nearly square)
- Sextant/pattern/luma: `(3 * cellWidth) / (2 * cellHeight)` when detected, else `(2/3) * charAspectRatio` prop

Cell size is detected via WindowOps query at startup and used even without sixel support.

**Aspect-corrected methods:** `drawCircleCorrected()`, `drawSquareCorrected()`, `drawLineCorrected()`, `visualToPixel()`, `pixelToVisual()`

## Modes

### sextant (default)

Unicode sextant characters - 2x3 pixels per terminal cell, full color support.

**Best for:** Everything (highest resolution)

**Known limitations:**
- **Rio terminal** does not render Unicode Sextant Block characters (U+1FB00-U+1FB3F) correctly. Use `MELKER_GFX_MODE=iterm2` as a workaround since Rio supports the iTerm2 protocol.

**Testing support:** Run `melker --debug-sextant` to test if your terminal renders sextant characters correctly.

### halfblock

Half-block characters (`▀▄█`) - 1x2 pixels per terminal cell with fg+bg colors.

**Best for:** Basic Unicode terminals (TERM=linux) — automatic fallback when sextant is unavailable

**How it works:**
- Each cell encodes two vertical sub-pixels using upper/lower half-block characters
- Upper pixel = foreground color, lower pixel = background color (or vice versa)
- 4 states per cell: `▀` (upper on), `▄` (lower on), `█` (both on), space (both off)
- 2× vertical resolution over block mode, with two independent colors per cell
- Nearly square pixel aspect ratio (~1.0 on typical terminals)

**Resolution:** 80×48 on 80×24 terminal (vs sextant 160×72, block 80×24)

### block

Colored spaces - 1x1 pixel per terminal cell.

**Best for:** ASCII-only terminals (`TERM=vt100/vt220`), universal fallback

### pattern

ASCII characters with spatial mapping using brightness thresholding.

**Best for:** UI elements, lines, boxes, geometric shapes, shaders

**Character set (17 chars, gamma-adjusted for visual density):**
- Punctuation: ` . , ' \` " _ - | / \ + * =`
- Letters: `L j T y m M B` (geometric shapes, density-matched)
- Density progression: `. , ' \`" _ - | / \` → `+` → `*` → `m M` → `B`

**How it works:**
- Samples 2x3 pixel grid (same as sextant characters)
- Calculates brightness for each pixel
- Thresholds at midpoint between min/max brightness
- Bright pixels become foreground (the ASCII char)
- Dark pixels become background
- Maps 6-bit pattern to ASCII via 64-entry lookup table
- Characters matched to pixel count for consistent visual density

**Pattern mapping by density:**
```
Pixels  Examples              ASCII
0       empty                 (space)
1       corners, dots         . , ' `
2       lines, diagonals      _ - " | / \
3       shapes, junctions     L j T y +
4       medium-dense          * =
5       dense shapes          m M B
6       full block            B
```

**Key pattern examples:**
```
Pattern          Bits       Pixels  ASCII
L-corner         001011     3       L
j-hook           000111     3       j
T-junction       011100     3       T
y-junction       011001     3       y
medium-dense     001111     4       *
m-pillars        011011     5       m
M-shape          011111     5       M
full block       111111     6       B
```

### luma

ASCII characters based on average pixel brightness.

**Best for:** Images, gradients, photos, smooth shading

**How it works:**
```
luma = 0.299*R + 0.587*G + 0.114*B
charIndex = floor(luma / 255 * (ramp.length - 1))
```

**Character ramp (10 levels, light to dark):**
```
 .:-=+*#%@
```

### sixel

True pixel graphics via DEC Sixel protocol - native pixel rendering without character cell limitations.

**Best for:** High-quality images, photos, video on supported terminals

**Requirements:**
- Terminal with sixel support (xterm -ti vt340, mlterm, foot, WezTerm, iTerm2)
- Not running in tmux/screen (multiplexers don't reliably pass sixel)
- Not running over SSH (auto-disabled for bandwidth optimization)

**How it works:**
- Detects sixel support at startup via DA1 escape sequence
- Renders canvas content to sixel format (6-pixel vertical strips)
- Quantizes colors to 256-color palette (keyframe mode for video/shaders)
- Outputs sixel data as overlay after buffer rendering
- Falls back to sextant if sixel not available or disabled

**Palette modes:**
- `cached` - Static images (`<img>` without callbacks): compute once, reuse forever
- `keyframe` - Dynamic content (video, `onShader`, `onPaint`, `onFilter`): cache palette, re-index frames, regenerate on >2% color drift
- `dynamic` - Available but not used (keyframe preferred for performance)

**Pre-quantization dithering** (dynamic content only):
- Applies `blue-noise` dithering by default before 256-color quantization
- 3 bits per channel (8 levels) reduces banding in gradients
- Set `dither="none"` to disable, or specify algorithm (`ordered`, `floyd-steinberg`, etc.)
- Respects `MELKER_DITHER_BITS` env var and `ditherBits` prop

**Limitations:**
- Not all terminals support sixel
- Disabled automatically in tmux/screen and over SSH
- Higher bandwidth than character modes (10-100x larger output)
- Dialog/dropdown occlusion clears sixels (shows through buffer)
- Clipped sixels show `.` placeholder (can't be partially rendered)
- Konsole has right-edge rendering quirk (use mlterm for best results)

**Detection:**
- DA1 query checks for sixel support flag (4)
- XTSMGRAPHICS queries for color registers and geometry (sixel only)
- WindowOps query for cell size in pixels (always queried for accurate aspect ratio)
- Environment-based fallback for known sixel terminals
- Multiplexer detection via `$TMUX`, `$STY`
- SSH detection via `$SSH_CLIENT`, `$SSH_CONNECTION`, `$SSH_TTY`

### kitty

True pixel graphics via Kitty Graphics Protocol - modern terminal graphics with true alpha blending.

**Best for:** High-quality images, photos, video on Kitty-compatible terminals

**Requirements:**
- Terminal with Kitty graphics support (Kitty, Ghostty, WezTerm, Konsole)
- Not running in tmux/screen (multiplexers don't pass Kitty protocol)

**How it works:**
- Detects Kitty support at startup via `a=q` query action
- Renders canvas content to RGBA pixel data
- Encodes as base64 with chunking (max 4096 bytes per chunk)
- Outputs Kitty data as overlay after buffer rendering
- Re-sends image every frame (buffer placeholder overwrites kitty cells)
- Uses content hash caching to avoid re-encoding unchanged content
- Uses stable image IDs for flicker-free in-place replacement
- Falls back to sextant if Kitty not available

**Advantages over sixel:**
- True 32-bit RGBA (no quantization needed)
- Better alpha blending
- PNG passthrough support (future)
- Image ID-based cleanup

**Limitations:**
- Narrower terminal support than sixel
- Disabled automatically in tmux/screen
- Higher bandwidth for raw RGBA than quantized sixel

**Detection:**
- Query action with 1x1 RGB image: `ESC_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA ESC\`
- Environment hints: `KITTY_WINDOW_ID`, `WEZTERM_PANE`, `GHOSTTY_RESOURCES_DIR`
- Multiplexer detection via `$TMUX`, `$STY`

### iterm2

True pixel graphics via iTerm2 Inline Images Protocol - widely supported by modern terminals.

**Best for:** Terminals without Kitty/sixel support but with iTerm2 protocol (Rio, Hyper)

**Requirements:**
- Terminal with iTerm2 protocol support (iTerm2, WezTerm, Konsole, Rio, Hyper)
- Works in tmux with multipart chunking (unlike Kitty)

**How it works:**
- Detects iTerm2 support at startup via environment variables
- Uses full terminal pixel resolution (same as sixel/kitty)
- Renders canvas content to PNG format (uncompressed for speed)
- Encodes as base64 in OSC 1337 escape sequence
- Outputs iTerm2 data as overlay after buffer rendering
- Uses pixel dimensions (`width=Npx`) for correct aspect ratio
- Uses content hash caching to avoid re-encoding unchanged content
- Falls back to sextant if iTerm2 not available

**Advantages:**
- Wide terminal support (more than Kitty)
- Works in tmux (uses multipart chunking)
- True 32-bit RGBA (no quantization)
- Large images supported (single sequence, no size limit)

**Limitations:**
- PNG encoding overhead (~5-15ms per frame)
- No partial/incremental updates
- Slower than Kitty (PNG vs raw RGBA)

**Detection:**
- Environment hints: `ITERM_SESSION_ID`, `LC_TERMINAL`, `TERM_PROGRAM`, `WEZTERM_PANE`, `KONSOLE_VERSION`, `TERM=rio`
- Multiplexer detection enables multipart mode

### hires

Auto-select best available high-resolution graphics mode.

**Best for:** Portable apps that want the best graphics quality on any terminal

**Fallback order:**
1. `kitty` - if Kitty graphics protocol supported
2. `sixel` - if sixel supported
3. `iterm2` - if iTerm2 protocol supported
4. `sextant` / `halfblock` / `block` - tier-based character fallback

**How it works:**
- Checks terminal capabilities at startup
- Automatically selects the highest quality mode available
- No manual configuration needed for cross-terminal compatibility

## Non-Unicode Terminals

Melker uses a three-tier Unicode model: `full` (xterm), `basic` (TERM=linux), `ascii` (vt100/vt220). See [graphics-architecture.md](graphics-architecture.md) for the full tier table.

### TERM=linux (basic tier)

The Linux virtual console supports box-drawing characters and block elements (`▀▄█░▒▓`) but not sextants or braille. Canvas automatically uses **halfblock** mode (1×2 pixels per cell with `▀▄█`).

| Feature          | full (xterm)                   | basic (TERM=linux)                    |
|------------------|--------------------------------|---------------------------------------|
| Graphics mode    | sextant (2x3 Unicode)          | halfblock (1x2 half-block)            |
| Border style     | thin/rounded/double (Unicode)  | thin, double (rounded/thick → thin)   |
| Scrollbar chars  | `█` / `░`                      | `█` / `░`                             |
| Tree connectors  | `├── `, `└── `, `│`            | `├── `, `└── `, `│`                   |
| Theme            | color16 (16 ANSI colors)       | color16 (16 ANSI colors)              |

### TERM=vt100/vt220 (ascii tier)

| Feature          | ascii (vt100/vt220)            |
|------------------|--------------------------------|
| Graphics mode    | block (colored spaces)         |
| Border style     | ascii (`+`, `-`, `\|`)         |
| Scrollbar chars  | `#` / `.`                      |
| Tree connectors  | `\|-- `, `` `-- ``, `\|`      |
| Theme            | bw (no color)                  |

**Detection:** `getUnicodeTier()` in `src/utils/terminal-detection.ts` returns `'full' | 'basic' | 'ascii'`. Cached for the process lifetime.

**Fallback chain:** `sextant → halfblock (basic) → block (ascii)`. Graphics protocol fallbacks (sixel/kitty/iterm2) also follow this chain.

**Border fallback:** `getBorderChars(style)` in `src/types.ts` automatically remaps Unicode border styles. Basic tier gets thin+double; ascii tier gets ASCII box characters.

## Configuration

**Per-element prop (on canvas/img):**
```xml
<img src="image.png" gfxMode="luma" />
<canvas gfxMode="pattern" onPaint="..." />
```

**Environment variable (overrides per-element):**
```bash
MELKER_GFX_MODE=sextant   # default, Unicode sextant chars (2x3 per cell)
MELKER_GFX_MODE=halfblock # half-block chars (1x2 per cell, ▀▄█)
MELKER_GFX_MODE=block     # colored spaces (1x1 per cell)
MELKER_GFX_MODE=pattern   # ASCII spatial mapping
MELKER_GFX_MODE=luma      # ASCII brightness-based
MELKER_GFX_MODE=sixel     # true pixels (requires terminal support)
MELKER_GFX_MODE=kitty     # true pixels via Kitty protocol
MELKER_GFX_MODE=iterm2    # true pixels via iTerm2 protocol
MELKER_GFX_MODE=hires     # auto: kitty → sixel → iterm2 → sextant/halfblock/block
```

**CLI flag (overrides per-element):**
```bash
--gfx-mode=sextant
--gfx-mode=halfblock
--gfx-mode=block
--gfx-mode=pattern
--gfx-mode=luma
--gfx-mode=sixel
--gfx-mode=kitty
--gfx-mode=iterm2
--gfx-mode=hires
```

**Priority:** Global config (env/CLI) > per-element prop > default (sextant)

## Color Support

All modes apply ANSI foreground color:
- Uses averaged color from foreground pixels
- Falls back to theme foreground if no pixel color
- B&W themes strip colors at render time (theme-respecting)

## Auto Theme Detection

When `dither="auto"`, theme and dithering are determined from terminal capabilities:

| TERM / COLORTERM         | Theme Type | Color Support | Dither Bits | Dither (canvas/img) | Dither (video) |
|--------------------------|------------|---------------|-------------|---------------------|----------------|
| `COLORTERM=truecolor`    | fullcolor  | truecolor     | -           | none                | none           |
| `TERM=*256color*`        | color      | 256           | 3           | sierra-stable       | blue-noise     |
| `TERM=xterm/screen/tmux` | gray       | 16            | 1           | sierra-stable       | blue-noise     |
| `TERM=linux/vt100/vt220` | bw         | none          | 1           | sierra-stable       | blue-noise     |
| (fallback)               | bw         | none          | 1           | sierra-stable       | blue-noise     |

Video uses blue-noise for less temporal flicker between frames.

**Override via config:**
- `MELKER_AUTO_DITHER=<algorithm>` - forces dithering even on fullcolor
- `MELKER_DITHER_BITS=<1-8>` - overrides auto bit depth

## Implementation

**Files:**
- `src/config/schema.json` - Config option definition
- `src/components/canvas-terminal.ts` - `PATTERN_TO_ASCII` lookup table, `LUMA_RAMP`
- `src/components/canvas.ts` - `_renderAsciiMode()`, `_renderBlockMode()`, dithered path handling
- `src/components/canvas-render.ts` - `renderSixelPlaceholder()`, `generateSixelOutput()`, `generateKittyOutput()`
- `src/rendering.ts` - Border rendering in block mode
- `src/sixel/detect.ts` - Terminal sixel capability detection
- `src/sixel/encoder.ts` - Sixel format encoder
- `src/sixel/palette.ts` - Color quantization for sixel
- `src/kitty/detect.ts` - Terminal kitty capability detection
- `src/kitty/encoder.ts` - Kitty format encoder
- `src/utils/terminal-detection.ts` - Shared multiplexer/remote session/Unicode detection
- `src/utils/pixel-utils.ts` - Shared pixel encoding (Uint32 to RGB/RGBA bytes)
- `src/engine.ts` - Sixel/Kitty overlay rendering in render pipeline

## Use Cases

- **sextant**: Default, best quality for most use cases
- **halfblock**: Basic Unicode terminals (TERM=linux), automatic sextant fallback
- **block**: ASCII-only terminals (vt100/vt220), universal fallback
- **pattern**: Legacy terminals, SSH to old systems, retro look
- **luma**: Image-heavy content on legacy terminals
- **sixel**: Photos, high-quality images on xterm/mlterm/foot
- **kitty**: Photos, high-quality images on Kitty/Ghostty/WezTerm
- **hires**: Portable apps that want best available graphics

## Comparison

| Mode      | Resolution   | Best for              | Unicode tier | Terminal Support                                |
|-----------|--------------|---------------------- |--------------|-------------------------------------------------|
| sextant   | 2x3 per cell | Everything            | full         | Most modern†                                    |
| halfblock | 1x2 per cell | Linux console         | basic        | TERM=linux, auto fallback from sextant          |
| block     | 1x1 per cell | Universal fallback    | any          | All                                             |
| pattern   | 2x3 per cell | UI, shapes            | any          | All                                             |
| luma      | 2x3 per cell | Images                | any          | All                                             |
| sixel     | True pixels  | High-quality images   | any          | xterm, mlterm, foot, WezTerm, iTerm2, Konsole*  |
| kitty     | True pixels  | High-quality images   | any          | Kitty, Ghostty, WezTerm, Konsole                |
| iterm2    | True pixels  | High-quality images   | any          | iTerm2, WezTerm, Konsole, Rio                   |
| hires     | True pixels  | Portable high-quality | any          | Auto-selects best available                     |

*Konsole has a right-edge rendering quirk. Use mlterm for best sixel quality.

†Rio terminal does not render sextant characters (U+1FB00-U+1FB3F). Use `iterm2` mode instead.

Fallback chain: sextant (full) → halfblock (basic) → block (ascii). Graphics protocols (sixel/kitty/iterm2) follow this chain when protocol is unavailable.

## Demo

See `examples/canvas/gfx-modes.melker` for a visual comparison of:
- Graphics modes (sextant, halfblock, block, pattern, luma)
- Dithering algorithms (none, sierra-stable, floyd-steinberg, atkinson, atkinson-stable, ordered, blue-noise)
- Dither bits (1-4 bit color depth)

## See Also

- [Graphics Architecture](graphics-architecture.md) — Common detection, rendering pipeline, configuration
- [Sixel Architecture](sixel-architecture.md) — Sixel protocol details, palette quantization
- [Kitty Architecture](kitty-architecture.md) — Kitty protocol details, stable image IDs
