# Canvas & Graphics

Canvas and graphics examples demonstrating pixel-based rendering.

## Running

```bash
./melker.ts examples/canvas/analog-clock.melker
./melker.ts examples/canvas/shaders/plasma-shader.melker
```

## Canvas Basics

| File | Description |
|------|-------------|
| `basics.melker` | Canvas drawing primitives |
| `dithering.melker` | Dithering algorithms comparison |
| `gfx-modes.melker` | GFX modes (sextant, block, pattern, luma) |
| `checkerboard.melker` | Simple checkerboard pattern |
| `svg-path.melker` | SVG path drawing with animated star and Bezier curves |

## Clocks

| File | Description |
|------|-------------|
| `analog-clock.melker` | Canvas-based analog clock with aspect correction |
| `text-analog-clock.melker` | Text-based clock display |

## Shaders (`shaders/`)

Per-pixel shader effects using `onShader` callback.

| File | Description |
|------|-------------|
| `plasma-shader.melker` | Classic plasma effect |
| `metaballs.melker` | Metaballs animation |
| `synthwave-shader.melker` | Synthwave sun and grid |
| `noise.melker` | 3D noise patterns (simplex, perlin, fbm) |
| `seascape.melker` | Ocean water simulation |
| `fractal-tunnel.melker` | Fractal tunnel fly-through |
| `perspex-lattice.melker` | Glass lattice refraction |
| `image-shader.melker` | Image with shader overlay |

## Images (`images/`)

| File | Description |
|------|-------------|
| `image-demo.melker` | Image loading and display |
| `image-demo2.melker` | Additional image examples |
| `data-url-image.melker` | Inline base64-encoded images |

## Video (`video/`)

| File | Description |
|------|-------------|
| `video-demo.melker` | Video playback with FFmpeg |

## Canvas Features

Canvas uses sextant characters (2x3 pixel blocks per terminal character).

**Auto-sizing with onPaint:**
```xml
<canvas
  id="myCanvas"
  width="60" height="20"
  style="width: fill; height: fill"
  onPaint="draw(event.canvas)"
/>
```

**Aspect-ratio corrected drawing:**
```typescript
const visSize = canvas.getVisualSize();
const [px, py] = canvas.visualToPixel(visSize.width/2, visSize.height/2);
canvas.drawCircleCorrected(px, py, radius);
```

**SVG path drawing (Bezier curves, arcs):**
```typescript
// Cubic Bezier curve
canvas.drawPathSVGColor('M 10 20 C 15 5 25 5 30 20', '#FF6600');

// Filled star shape
canvas.fillPathSVGColor('M 20 0 L 25 15 L 40 15 L 28 24 L 33 40 L 20 30 L 7 40 L 12 24 L 0 15 L 15 15 Z', '#FFAA00');
```

**Shaders (per-pixel):**
```xml
<canvas onShader="(x, y, t) => colorFromCoords(x, y, t)" />
```

Requires `shader: true` in policy permissions.
