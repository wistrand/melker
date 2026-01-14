# Image Shader Demo

A mouse-interactive ripple shader effect applied to an image.

Run with: `melker.ts examples/melker-md/image_shader_demo.md`

To see the generated .melker file: `melker.ts examples/melker-md/image_shader_demo.md --convert`

## Policy

Declares permissions required by the app. The `shader` permission enables per-pixel shader callbacks.

```json
{
  "@melker": "policy",
  "name": "Image Shader Demo",
  "permissions": {
    "read": ["."],
    "shader": true
  }
}
```

## Layout

The root layout using ASCII box notation. Hints like `: c = f` set flex direction (column), justify (center), and fill (100% width/height). Button shortcuts like `[ id: Label ]` create buttons inline.

```melker-block
+--root Image Shader Demo---------------------------------+
| : c = f                                                 |
|                    +--title--+                          |
|                                                         |
| +--img-container--------------------------------------+ |
| | : f                                                 | |
| | +--shaderImg--------------------------------------+ | |
| | | type: img                                       | | |
| | |                                                 | | |
| | |                                                 | | |
| | |                                                 | | |
| | +-------------------------------------------------+ | |
| +-----------------------------------------------------+ |
|                                                         |
|                [ exit-btn: Exit ]                       |
+---------------------------------------------------------+
```

This will create a layout like this: 

![Image Shader Demo](image_shader_demo.png)


## Components

Reusable component definitions referenced by ID in the layout.

### Title

```melker-block
+--title-----------------------------------+
| type: text                               |
| text: Mouse Ripple Shader                |
+------------------------------------------+
```

## Styles

CSS-like styles applied to elements by ID or class.

```css
/* @melker style */
#root {
  border: thin;
  padding: 1;
}
#title {
  text-align: center;
}
```

## Image Properties

Non-style properties for the image element. The `@target` specifies which element to configure.

```json
{
  "@target": "#shaderImg",
  "src": "../../media/melker-128.png",
  "objectFit": "contain",
  "dither": "auto",
  "onShader": "$app.rippleShader",
  "shaderFps": 24,
  "width": "100%",
  "height": "100%"
}
```

## Event Handlers

Inline handlers for specific element events.

```typescript
// @melker handler #exit-btn.onClick
$melker.exit();
```

## Script

Main application script. Exported functions are available as `$app.functionName()` in handlers.

```typescript
// @melker script

// ShaderSource type for reference
interface ShaderSource {
  getPixel(x: number, y: number): [number, number, number, number] | null;
  hasImage: boolean;
  width: number;
  height: number;
  mouse: { x: number; y: number };
  mouseUV: { u: number; v: number };
}

// Mouse-interactive ripple shader
export function rippleShader(
  x: number,
  y: number,
  time: number,
  resolution: { width: number; height: number; pixelAspect: number },
  source?: ShaderSource
): [number, number, number] {
  const pixel = source?.getPixel(x, y);
  if (!pixel) return [0, 0, 0];

  const [r, g, b] = pixel;

  // Get mouse position (default to center if not over image)
  const mx = source?.mouse?.x ?? resolution.width / 2;
  const my = source?.mouse?.y ?? resolution.height / 2;

  // No ripple when mouse not over
  if (mx < 0) return [r, g, b];

  // Calculate aspect-corrected distance from mouse
  const dx = x - mx;
  const dy = (y - my) / resolution.pixelAspect;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Create ripple wave
  const ripple = Math.sin(dist * 0.2 - time * 5) * 5;
  const angle = Math.atan2(dy, dx);

  // Displace pixels radially
  const srcX = Math.floor(x + Math.cos(angle) * ripple);
  const srcY = Math.floor(y + Math.sin(angle) * ripple);
  const ripplePixel = source?.getPixel(srcX, srcY);

  return ripplePixel ? [ripplePixel[0], ripplePixel[1], ripplePixel[2]] : [r, g, b];
}

```

## Ready Script

Runs after first render. Use for DOM initialization, starting timers, or updating elements that need to exist first.

```typescript
// @melker script ready
const message = 'Move mouse over image for ripple effect';
$melker.getElementById('title')?.setValue(message);
$melker.logger.info(message);
```

## Notes

This demonstrates:
- `img` element with `onShader` for per-pixel effects
- Mouse-interactive shader using `source.mouse` position (auto-tracked)
- Aspect-corrected distance calculation via `resolution.pixelAspect`
- Radial pixel displacement creating ripple waves
- `// @melker script ready` for post-render initialization
- `[ id: Label ]` button shortcut syntax
- Requires `"shader": true` in policy permissions
