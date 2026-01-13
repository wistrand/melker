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

**Environment variable:**
```bash
MELKER_GFX_MODE=sextant   # default, Unicode sextant chars
MELKER_GFX_MODE=block     # colored spaces
MELKER_GFX_MODE=pattern   # ASCII spatial mapping
MELKER_GFX_MODE=luma      # ASCII brightness-based
```

**CLI flag:**
```bash
--gfx-mode=sextant
--gfx-mode=block
--gfx-mode=pattern
--gfx-mode=luma
```

## Color Support

All modes apply ANSI foreground color:
- Uses averaged color from foreground pixels
- Falls back to theme foreground if no pixel color
- B&W themes strip colors at render time (theme-respecting)

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
