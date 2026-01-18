# Graphics Rendering Modes

Controls how canvas/image pixels are rendered to terminal characters.

## Modes

### sextant (default)

Unicode sextant characters - 2x3 pixels per terminal cell, full color support.

**Best for:** Everything (highest resolution)

### block

Colored spaces - 1x1 pixel per terminal cell.

**Best for:** Terminals without Unicode support, simpler rendering

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

## Configuration

**Per-element prop (on canvas/img):**
```xml
<img src="image.png" gfxMode="luma" />
<canvas gfxMode="pattern" onPaint="..." />
```

**Environment variable (overrides per-element):**
```bash
MELKER_GFX_MODE=sextant   # default, Unicode sextant chars
MELKER_GFX_MODE=block     # colored spaces
MELKER_GFX_MODE=pattern   # ASCII spatial mapping
MELKER_GFX_MODE=luma      # ASCII brightness-based
```

**CLI flag (overrides per-element):**
```bash
--gfx-mode=sextant
--gfx-mode=block
--gfx-mode=pattern
--gfx-mode=luma
```

**Priority:** Global config (env/CLI) > per-element prop > default (sextant)

## Color Support

All modes apply ANSI foreground color:
- Uses averaged color from foreground pixels
- Falls back to theme foreground if no pixel color
- B&W themes strip colors at render time (theme-respecting)

## Auto Theme Detection

When `dither="auto"`, theme and dithering are determined from terminal capabilities:

| TERM / COLORTERM | Theme Type | Color Support | Dither Bits | Dither (canvas/img) | Dither (video) |
|------------------|------------|---------------|-------------|---------------------|----------------|
| `COLORTERM=truecolor` | fullcolor | truecolor | - | none | none |
| `TERM=*256color*` | color | 256 | 3 | sierra-stable | blue-noise |
| `TERM=xterm/screen/tmux` | gray | 16 | 1 | sierra-stable | blue-noise |
| (fallback) | bw | none | 1 | sierra-stable | blue-noise |

Video uses blue-noise for less temporal flicker between frames.

**Override via config:**
- `MELKER_AUTO_DITHER=<algorithm>` - forces dithering even on fullcolor
- `MELKER_DITHER_BITS=<1-8>` - overrides auto bit depth

## Implementation

**Files:**
- `src/config/schema.json` - Config option definition
- `src/components/canvas-terminal.ts` - `PATTERN_TO_ASCII` lookup table, `LUMA_RAMP`
- `src/components/canvas.ts` - `_renderAsciiMode()`, `_renderBlockMode()`, dithered path handling
- `src/rendering.ts` - Border rendering in block mode

## Use Cases

- **sextant**: Default, best quality
- **block**: Terminals without Nerd Fonts
- **pattern**: Legacy terminals, SSH to old systems, retro look
- **luma**: Image-heavy content on legacy terminals

## Comparison

| Mode | Resolution | Best for | Unicode |
|------|------------|----------|---------|
| sextant | 2x3 per cell | Everything | Required |
| block | 1x1 per cell | Compatibility | No |
| pattern | 2x3 per cell | UI, shapes | No |
| luma | 2x3 per cell | Images | No |

## Demo

See `examples/melker/gfx_modes_demo.melker` for a visual comparison of:
- Graphics modes (sextant, block, pattern, luma)
- Dithering algorithms (none, sierra-stable, floyd-steinberg, atkinson, atkinson-stable, ordered, blue-noise)
- Dither bits (1-4 bit color depth)
