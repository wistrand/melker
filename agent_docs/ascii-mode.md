# ASCII Mode Rendering

Renders canvas/image pixels as ASCII characters for terminals without Unicode/sextant support.

## Two Sub-modes

### 1. Pattern Mode (`--ascii-mode=pattern`)

Maps 2x3 pixel blocks to spatially-similar ASCII characters using brightness thresholding.

**Best for:** UI elements, lines, boxes, geometric shapes, shaders

**How it works:**
- Samples 2x3 pixel grid (same as sextant characters)
- Calculates brightness for each pixel
- Thresholds at midpoint between min/max brightness
- Bright pixels become foreground (the ASCII char)
- Dark pixels become background
- Maps 6-bit pattern to ASCII via 64-entry lookup table

**Pattern mapping examples:**
```
Pattern          Bits       ASCII
top-left         100000     '
top-right        010000     '
bottom-left      000010     ,
bottom-right     000001     ,
top row          110000     "
bottom row       000011     _
left column      101010     |
right column     010101     |
full block       111111     #
diagonal         100001     \
```

### 2. Luminance Mode (`--ascii-mode=luma`)

Maps average pixel brightness to a density character ramp.

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

**Environment variable:**
```bash
MELKER_ASCII_MODE=pattern   # spatial pattern matching
MELKER_ASCII_MODE=luma      # luminance-based density
MELKER_ASCII_MODE=off       # disabled (default, use sextant/block)
```

**CLI flag:**
```bash
--ascii-mode=pattern
--ascii-mode=luma
```

## Color Support

Both modes apply ANSI foreground color to the ASCII characters:
- Uses averaged color from foreground pixels
- Falls back to theme foreground if no pixel color
- B&W themes strip colors at render time (theme-respecting)

## Implementation

**Files:**
- `src/config/schema.json` - Config option definition
- `src/components/canvas-terminal.ts` - `PATTERN_TO_ASCII` lookup table, `LUMA_RAMP`
- `src/components/canvas.ts` - `_renderAsciiMode()` and dithered path handling

## Use Cases

- Terminals without Unicode support
- SSH to legacy systems
- Text-only logging/output
- Screen reader compatibility
- Retro aesthetic

## Comparison

| Mode | Resolution | Best for | Color |
|------|------------|----------|-------|
| Sextant (default) | 2x3 per cell | Everything | Full |
| Block | 1x1 per cell | Compatibility | Full |
| ASCII pattern | 2x3 per cell | UI, shapes | Yes |
| ASCII luma | 2x3 per cell | Images | Yes |
