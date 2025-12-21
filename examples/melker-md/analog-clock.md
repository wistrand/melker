# Analog Clock

An analog clock rendered on a pixel canvas with hour, minute, and second hands.

Run with: `deno run --allow-all melker.ts examples/melker-md/analog-clock.md`

## Layout

The first `melker-block` is the root. Uses column layout with centered content.

```melker-block
+--root Analog Clock-------------------------------------------+
| : c = f                                                      |
|                      +--title--+                             |
|                                                              |
| +--canvas-container----------------------------------------+ |
| |                         12                               | |
| |                    .----'----.                           | |
| |                   /     |     \                          | |
| |                9 |      +---   | 3                       | |
| |                   \           /                          | |
| |                    `----.----'                           | |
| |                         6                                | |
| +----------------------------------------------------------+ |
|                                                              |
| +--button-row----------------------------------------------+ |
| | +--status-btn---+                       +--exit-btn----+ | |
| +----------------------------------------------------------+ |
|                                                              |
|                     +--help-text--+                          |
+--------------------------------------------------------------+
```

## Components

### Title

```melker-block
+--title-----------------------------------+
| type: text                               |
| text: Analog Clock                       |
+------------------------------------------+
```

### Canvas Container

The canvas fills the available space and auto-resizes with the terminal.

```melker-block
+--canvas-container------------------------+
| : f                                      |
| +--clockCanvas-------------------------+ |
| | type: canvas                         | |
| +--------------------------------------+ |
+------------------------------------------+
```

### Button Row

```melker-block
+--button-row---------------------------------------------------+
| : r 2 =                                                       |
| +--status-btn--+ +--exit-btn--+                               |
| | type: button | | type:      |                               |
| | title: Clock | | button     |                               |
| | title:       | | title:     |                               |
| | Running      | | Exit       |                               |
| +--------------+ +------------+                               |
+---------------------------------------------------------------+
```

### Help Text

```melker-block
+--help-text---------------------------------------------------+
| type: text                                                   |
| text: Analog clock auto-starts on load - Press Ctrl+C to exit|
+--------------------------------------------------------------+
```

## Styles

```css
/* @melker style */
#root {
  border: thin;
  padding: 1;
}
#title {
  font-weight: bold;
  margin-bottom: 1;
  text-align: center;
}
#clockCanvas {
  width: fill;
  height: fill;
}
#status-btn {
  background-color: blue;
  color: white;
  padding: 1;
}
#exit-btn {
  background-color: gray;
  color: white;
  padding: 1;
}
#help-text {
  color: yellow;
  margin-top: 1;
  text-align: center;
}
```

## Canvas Properties

Non-style properties for the canvas element:

```json
{
  "@target": "#clockCanvas",
  "width": 60,
  "height": 20,
  "onPaint": "drawClock(event.canvas)"
}
```

## Event Handlers

```typescript
// @melker handler #exit-btn.onClick
$melker.exit();
```

## Script

The clock draws on a canvas using aspect-ratio corrected methods for visually
round circles. It auto-starts when the engine mounts and updates every second.

```typescript
// @melker script

// Analog clock rendering using Melker's pixel canvas
// Uses aspect-ratio corrected methods for visually round circles
function drawClock(canvas: any): void {
  // Get layout bounds and resize canvas to fit
  const bounds = canvas.getBounds();
  if (!bounds) return;

  if (canvas.props.width !== bounds.width || canvas.props.height !== bounds.height) {
    canvas.setSize(bounds.width, bounds.height);
  }

  const now = new Date();

  // Clear canvas
  canvas.clear();

  // Work in visual coordinates (equal units in both dimensions)
  const visSize = canvas.getVisualSize();
  const visCenterX = visSize.width / 2;
  const visCenterY = visSize.height / 2;
  const radius = Math.min(visCenterX, visCenterY) - 4;

  // Convert visual center to pixel for drawCircleCorrected
  const [pxCenterX, pxCenterY] = canvas.visualToPixel(visCenterX, visCenterY);

  // Draw outer circle (takes pixel center, visual radius)
  canvas.drawCircleCorrected(pxCenterX, pxCenterY, radius);

  // Draw hour markers (12, 3, 6, 9) - use visual coords with drawLineCorrected
  for (let i = 0; i < 12; i += 3) {
    const angle = (i * Math.PI) / 6;
    const x1 = visCenterX + (radius - 6) * Math.cos(angle - Math.PI / 2);
    const y1 = visCenterY + (radius - 6) * Math.sin(angle - Math.PI / 2);
    const x2 = visCenterX + (radius - 2) * Math.cos(angle - Math.PI / 2);
    const y2 = visCenterY + (radius - 2) * Math.sin(angle - Math.PI / 2);

    canvas.drawLineCorrected(x1, y1, x2, y2);
  }

  // Calculate hand angles
  const hours = now.getHours() % 12;
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  const hourAngle = (hours + minutes / 60) * (Math.PI / 6);
  const minuteAngle = minutes * (Math.PI / 30);
  const secondAngle = seconds * (Math.PI / 30);

  // Draw hour hand (shortest)
  const hourLength = radius * 0.4;
  const hourX = visCenterX + hourLength * Math.cos(hourAngle - Math.PI / 2);
  const hourY = visCenterY + hourLength * Math.sin(hourAngle - Math.PI / 2);
  canvas.drawLineCorrected(visCenterX, visCenterY, hourX, hourY);

  // Draw minute hand (medium length)
  const minuteLength = radius * 0.6;
  const minuteX = visCenterX + minuteLength * Math.cos(minuteAngle - Math.PI / 2);
  const minuteY = visCenterY + minuteLength * Math.sin(minuteAngle - Math.PI / 2);
  canvas.drawLineCorrected(visCenterX, visCenterY, minuteX, minuteY);

  // Draw second hand (longest)
  const secondLength = radius * 0.8;
  const secondX = visCenterX + secondLength * Math.cos(secondAngle - Math.PI / 2);
  const secondY = visCenterY + secondLength * Math.sin(secondAngle - Math.PI / 2);
  canvas.drawLineCorrected(visCenterX, visCenterY, secondX, secondY);

  // Draw center dot
  canvas.fillRect(pxCenterX - 1, pxCenterY - 1, 3, 3);
}

// Auto-start the clock when engine is fully mounted
$melker.engine.onMount(() => {
  const canvas = $melker.getElementById('clockCanvas');
  if (canvas) {
    // Update every second
    setInterval(() => {
      drawClock(canvas);
      $melker.engine.render();
    }, 1000);
  }
});

exports = { drawClock };
```

## Syntax Reference

| Hint | Meaning |
|------|---------|
| `c` | column direction |
| `r` | row direction |
| `=` | justify center |
| `f` | fill (width + height 100%) |
| `*N` | flex: N |
| `0`-`9` | gap value |
