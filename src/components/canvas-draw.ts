// Canvas drawing primitives - extracted from canvas.ts for modularity
// These functions implement the actual drawing algorithms

// Minimal interface for drawing operations
export interface DrawableCanvas {
  setPixel(x: number, y: number, on: boolean): void;
  getPixelAspectRatio(): number;
  setColor(color: number | string): void;
  getColor(): number;
  setColorDirect(color: number): void;
  clear(): void;
  getBufferWidth(): number;
  getBufferHeight(): number;
}

// ============================================
// Basic Drawing Primitives
// ============================================

/**
 * Draw a rectangle outline
 */
export function drawRect(canvas: DrawableCanvas, x: number, y: number, width: number, height: number): void {
  x = Math.floor(x);
  y = Math.floor(y);
  width = Math.floor(width);
  height = Math.floor(height);
  if (width <= 0 || height <= 0) return;

  // Top and bottom edges
  for (let i = 0; i < width; i++) {
    canvas.setPixel(x + i, y, true);
    canvas.setPixel(x + i, y + height - 1, true);
  }

  // Left and right edges
  for (let i = 0; i < height; i++) {
    canvas.setPixel(x, y + i, true);
    canvas.setPixel(x + width - 1, y + i, true);
  }
}

/**
 * Draw a filled rectangle
 */
export function fillRect(canvas: DrawableCanvas, x: number, y: number, width: number, height: number): void {
  x = Math.floor(x);
  y = Math.floor(y);
  width = Math.floor(width);
  height = Math.floor(height);
  if (width <= 0 || height <= 0) return;

  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      canvas.setPixel(x + dx, y + dy, true);
    }
  }
}

/**
 * Draw a filled polygon using scanline fill with even-odd rule.
 * Points are [x, y] pairs. The polygon is implicitly closed (last point connects to first).
 */
export function fillPoly(canvas: DrawableCanvas, points: number[][]): void {
  if (points.length < 3) return;

  // Find bounding box
  let minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    const y = Math.floor(p[1]);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const bufH = canvas.getBufferHeight();
  const bufW = canvas.getBufferWidth();
  if (minY < 0) minY = 0;
  if (maxY >= bufH) maxY = bufH - 1;

  const n = points.length;
  const nodeX: number[] = [];

  // Scanline fill
  for (let y = minY; y <= maxY; y++) {
    nodeX.length = 0;

    // Find intersections with all edges
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = points[i][1], yj = points[j][1];
      if ((yi < y && yj >= y) || (yj < y && yi >= y)) {
        nodeX.push(Math.round(
          points[i][0] + (y - yi) / (yj - yi) * (points[j][0] - points[i][0])
        ));
      }
    }

    // Sort intersections by x
    nodeX.sort((a, b) => a - b);

    // Fill between pairs (even-odd rule)
    for (let i = 0; i < nodeX.length - 1; i += 2) {
      let x0 = nodeX[i];
      let x1 = nodeX[i + 1];
      if (x0 < 0) x0 = 0;
      if (x1 >= bufW) x1 = bufW - 1;
      for (let x = x0; x <= x1; x++) {
        canvas.setPixel(x, y, true);
      }
    }
  }
}

/**
 * Draw a polygon outline. Points are [x, y] pairs.
 * The polygon is implicitly closed (last point connects to first).
 */
export function drawPoly(canvas: DrawableCanvas, points: number[][]): void {
  if (points.length < 2) return;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    drawLine(canvas,
      Math.floor(points[i][0]), Math.floor(points[i][1]),
      Math.floor(points[j][0]), Math.floor(points[j][1]));
  }
}

/**
 * Draw a line using Bresenham's algorithm
 */
export function drawLine(canvas: DrawableCanvas, x0: number, y0: number, x1: number, y1: number): void {
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  x1 = Math.floor(x1);
  y1 = Math.floor(y1);

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let x = x0;
  let y = y0;

  while (true) {
    canvas.setPixel(x, y, true);

    if (x === x1 && y === y1) break;

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Draw a circle outline using midpoint circle algorithm
 */
export function drawCircle(canvas: DrawableCanvas, centerX: number, centerY: number, radius: number): void {
  centerX = Math.floor(centerX);
  centerY = Math.floor(centerY);
  radius = Math.floor(radius);
  if (radius <= 0) return;

  let x = 0;
  let y = radius;
  let d = 3 - 2 * radius;

  while (y >= x) {
    // Draw 8 octants
    canvas.setPixel(centerX + x, centerY + y, true);
    canvas.setPixel(centerX - x, centerY + y, true);
    canvas.setPixel(centerX + x, centerY - y, true);
    canvas.setPixel(centerX - x, centerY - y, true);
    canvas.setPixel(centerX + y, centerY + x, true);
    canvas.setPixel(centerX - y, centerY + x, true);
    canvas.setPixel(centerX + y, centerY - x, true);
    canvas.setPixel(centerX - y, centerY - x, true);

    if (d < 0) {
      d = d + 4 * x + 6;
    } else {
      d = d + 4 * (x - y) + 10;
      y--;
    }
    x++;
  }
}

/**
 * Draw an ellipse outline using midpoint ellipse algorithm
 */
export function drawEllipse(canvas: DrawableCanvas, centerX: number, centerY: number, radiusX: number, radiusY: number): void {
  centerX = Math.floor(centerX);
  centerY = Math.floor(centerY);
  radiusX = Math.floor(radiusX);
  radiusY = Math.floor(radiusY);

  if (radiusX <= 0 || radiusY <= 0) return;

  // Handle circle case
  if (radiusX === radiusY) {
    drawCircle(canvas, centerX, centerY, radiusX);
    return;
  }

  let x = 0;
  let y = radiusY;

  // Decision parameters for regions
  const rx2 = radiusX * radiusX;
  const ry2 = radiusY * radiusY;
  const twoRx2 = 2 * rx2;
  const twoRy2 = 2 * ry2;

  // Region 1
  let p = Math.round(ry2 - rx2 * radiusY + 0.25 * rx2);
  let px = 0;
  let py = twoRx2 * y;

  // Plot initial points
  canvas.setPixel(centerX + x, centerY + y, true);
  canvas.setPixel(centerX - x, centerY + y, true);
  canvas.setPixel(centerX + x, centerY - y, true);
  canvas.setPixel(centerX - x, centerY - y, true);

  // Region 1: slope > -1
  while (px < py) {
    x++;
    px += twoRy2;

    if (p < 0) {
      p += ry2 + px;
    } else {
      y--;
      py -= twoRx2;
      p += ry2 + px - py;
    }

    canvas.setPixel(centerX + x, centerY + y, true);
    canvas.setPixel(centerX - x, centerY + y, true);
    canvas.setPixel(centerX + x, centerY - y, true);
    canvas.setPixel(centerX - x, centerY - y, true);
  }

  // Region 2: slope <= -1
  p = Math.round(ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2);

  while (y > 0) {
    y--;
    py -= twoRx2;

    if (p > 0) {
      p += rx2 - py;
    } else {
      x++;
      px += twoRy2;
      p += rx2 - py + px;
    }

    canvas.setPixel(centerX + x, centerY + y, true);
    canvas.setPixel(centerX - x, centerY + y, true);
    canvas.setPixel(centerX + x, centerY - y, true);
    canvas.setPixel(centerX - x, centerY - y, true);
  }
}

/**
 * Draw a filled circle using midpoint algorithm with horizontal scanlines
 */
export function fillCircle(canvas: DrawableCanvas, centerX: number, centerY: number, radius: number): void {
  centerX = Math.floor(centerX);
  centerY = Math.floor(centerY);
  radius = Math.floor(radius);
  if (radius <= 0) {
    canvas.setPixel(centerX, centerY, true);
    return;
  }

  let x = 0;
  let y = radius;
  let d = 3 - 2 * radius;

  while (y >= x) {
    // Fill horizontal spans for each octant pair
    for (let i = centerX - x; i <= centerX + x; i++) {
      canvas.setPixel(i, centerY + y, true);
      canvas.setPixel(i, centerY - y, true);
    }
    for (let i = centerX - y; i <= centerX + y; i++) {
      canvas.setPixel(i, centerY + x, true);
      canvas.setPixel(i, centerY - x, true);
    }

    if (d < 0) {
      d = d + 4 * x + 6;
    } else {
      d = d + 4 * (x - y) + 10;
      y--;
    }
    x++;
  }
}

/**
 * Draw a filled ellipse using midpoint algorithm with horizontal scanlines
 */
export function fillEllipse(canvas: DrawableCanvas, centerX: number, centerY: number, radiusX: number, radiusY: number): void {
  centerX = Math.floor(centerX);
  centerY = Math.floor(centerY);
  radiusX = Math.floor(radiusX);
  radiusY = Math.floor(radiusY);

  if (radiusX <= 0 || radiusY <= 0) {
    canvas.setPixel(centerX, centerY, true);
    return;
  }
  if (radiusX === radiusY) {
    fillCircle(canvas, centerX, centerY, radiusX);
    return;
  }

  const rx2 = radiusX * radiusX;
  const ry2 = radiusY * radiusY;
  const twoRx2 = 2 * rx2;
  const twoRy2 = 2 * ry2;

  let x = 0;
  let y = radiusY;
  let px = 0;
  let py = twoRx2 * y;

  // Fill initial center line
  for (let i = centerX - radiusX; i <= centerX + radiusX; i++) {
    canvas.setPixel(i, centerY, true);
  }

  // Region 1
  let p = Math.round(ry2 - rx2 * radiusY + 0.25 * rx2);
  let lastY = y;
  while (px < py) {
    x++;
    px += twoRy2;
    if (p < 0) {
      p += ry2 + px;
    } else {
      y--;
      py -= twoRx2;
      p += ry2 + px - py;
    }
    if (y !== lastY) {
      for (let i = centerX - x + 1; i < centerX + x; i++) {
        canvas.setPixel(i, centerY + lastY, true);
        canvas.setPixel(i, centerY - lastY, true);
      }
      lastY = y;
    }
  }

  // Region 2
  p = Math.round(ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2);
  while (y > 0) {
    y--;
    py -= twoRx2;
    if (p > 0) {
      p += rx2 - py;
    } else {
      x++;
      px += twoRy2;
      p += rx2 - py + px;
    }
    for (let i = centerX - x; i <= centerX + x; i++) {
      canvas.setPixel(i, centerY + y, true);
      canvas.setPixel(i, centerY - y, true);
    }
  }
}

/**
 * Draw a visually correct filled circle (appears round on screen).
 * Internally draws a filled ellipse compensating for pixel aspect ratio.
 */
export function fillCircleCorrected(canvas: DrawableCanvas, centerX: number, centerY: number, radius: number): void {
  const aspectRatio = canvas.getPixelAspectRatio();
  const radiusX = Math.round(radius / aspectRatio);
  fillEllipse(canvas, centerX, centerY, radiusX, radius);
}

// ============================================
// Color Drawing Methods
// ============================================

/**
 * Draw a line with a specific color
 */
export function drawLineColor(canvas: DrawableCanvas, x0: number, y0: number, x1: number, y1: number, color: number | string): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  drawLine(canvas, x0, y0, x1, y1);
  canvas.setColorDirect(savedColor);
}

/**
 * Draw a rectangle outline with a specific color
 */
export function drawRectColor(canvas: DrawableCanvas, x: number, y: number, width: number, height: number, color: number | string): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  drawRect(canvas, x, y, width, height);
  canvas.setColorDirect(savedColor);
}

/**
 * Draw a filled rectangle with a specific color
 */
export function fillRectColor(canvas: DrawableCanvas, x: number, y: number, width: number, height: number, color: number | string): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  fillRect(canvas, x, y, width, height);
  canvas.setColorDirect(savedColor);
}

/**
 * Draw a filled polygon with a specific color
 */
export function fillPolyColor(canvas: DrawableCanvas, points: number[][], color: number | string): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  fillPoly(canvas, points);
  canvas.setColorDirect(savedColor);
}

/**
 * Draw a polygon outline with a specific color
 */
export function drawPolyColor(canvas: DrawableCanvas, points: number[][], color: number | string): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  drawPoly(canvas, points);
  canvas.setColorDirect(savedColor);
}

/**
 * Draw a circle outline with a specific color
 */
export function drawCircleColor(canvas: DrawableCanvas, centerX: number, centerY: number, radius: number, color: number | string): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  drawCircle(canvas, centerX, centerY, radius);
  canvas.setColorDirect(savedColor);
}

/**
 * Draw an ellipse outline with a specific color
 */
export function drawEllipseColor(canvas: DrawableCanvas, centerX: number, centerY: number, radiusX: number, radiusY: number, color: number | string): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  drawEllipse(canvas, centerX, centerY, radiusX, radiusY);
  canvas.setColorDirect(savedColor);
}

// ============================================
// Aspect-Corrected Drawing Methods
// ============================================

/**
 * Draw a visually correct circle (appears round on screen).
 * Internally draws an ellipse compensating for pixel aspect ratio.
 */
export function drawCircleCorrected(canvas: DrawableCanvas, centerX: number, centerY: number, radius: number): void {
  const aspectRatio = canvas.getPixelAspectRatio();
  const radiusX = Math.round(radius / aspectRatio);
  const radiusY = radius;
  drawEllipse(canvas, centerX, centerY, radiusX, radiusY);
}

/**
 * Draw a visually correct square (appears square on screen).
 * Internally adjusts width to compensate for pixel aspect ratio.
 */
export function drawSquareCorrected(canvas: DrawableCanvas, x: number, y: number, size: number): void {
  const aspectRatio = canvas.getPixelAspectRatio();
  const width = Math.round(size / aspectRatio);
  const height = size;
  drawRect(canvas, x, y, width, height);
}

/**
 * Draw a visually correct filled square (appears square on screen).
 */
export function fillSquareCorrected(canvas: DrawableCanvas, x: number, y: number, size: number): void {
  const aspectRatio = canvas.getPixelAspectRatio();
  const width = Math.round(size / aspectRatio);
  const height = size;
  fillRect(canvas, x, y, width, height);
}

/**
 * Draw a line with aspect-corrected coordinates.
 * Input coordinates are in "visual" space where 1 unit = same distance in both axes.
 */
export function drawLineCorrected(canvas: DrawableCanvas, x0: number, y0: number, x1: number, y1: number): void {
  const aspectRatio = canvas.getPixelAspectRatio();
  const px0 = Math.round(x0 / aspectRatio);
  const px1 = Math.round(x1 / aspectRatio);
  drawLine(canvas, px0, y0, px1, y1);
}

/**
 * Draw a filled circle with a specific color
 */
export function fillCircleColor(canvas: DrawableCanvas, centerX: number, centerY: number, radius: number, color: number | string): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  fillCircle(canvas, centerX, centerY, radius);
  canvas.setColorDirect(savedColor);
}

/**
 * Draw a filled ellipse with a specific color
 */
export function fillEllipseColor(canvas: DrawableCanvas, centerX: number, centerY: number, radiusX: number, radiusY: number, color: number | string): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  fillEllipse(canvas, centerX, centerY, radiusX, radiusY);
  canvas.setColorDirect(savedColor);
}

/**
 * Fill a visually correct circle with a specific color
 */
export function fillCircleCorrectedColor(canvas: DrawableCanvas, centerX: number, centerY: number, radius: number, color: number | string): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  fillCircleCorrected(canvas, centerX, centerY, radius);
  canvas.setColorDirect(savedColor);
}

/**
 * Draw a visually correct circle with a specific color
 */
export function drawCircleCorrectedColor(canvas: DrawableCanvas, centerX: number, centerY: number, radius: number, color: number | string): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  drawCircleCorrected(canvas, centerX, centerY, radius);
  canvas.setColorDirect(savedColor);
}

/**
 * Draw a visually correct square with a specific color
 */
export function drawSquareCorrectedColor(canvas: DrawableCanvas, x: number, y: number, size: number, color: number | string): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  drawSquareCorrected(canvas, x, y, size);
  canvas.setColorDirect(savedColor);
}

/**
 * Fill a visually correct square with a specific color
 */
export function fillSquareCorrectedColor(canvas: DrawableCanvas, x: number, y: number, size: number, color: number | string): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  fillSquareCorrected(canvas, x, y, size);
  canvas.setColorDirect(savedColor);
}

/**
 * Convert visual coordinates to pixel coordinates.
 * Visual coordinates have equal units in both dimensions.
 * @returns [pixelX, pixelY]
 */
export function visualToPixel(canvas: DrawableCanvas, visualX: number, visualY: number): [number, number] {
  const aspectRatio = canvas.getPixelAspectRatio();
  return [Math.round(visualX / aspectRatio), visualY];
}

/**
 * Convert pixel coordinates to visual coordinates.
 * @returns [visualX, visualY]
 */
export function pixelToVisual(canvas: DrawableCanvas, pixelX: number, pixelY: number): [number, number] {
  const aspectRatio = canvas.getPixelAspectRatio();
  return [pixelX * aspectRatio, pixelY];
}

/**
 * Get buffer size in visual units (where 1 unit = same distance in both axes).
 * Useful for centering and positioning with corrected coordinates.
 */
export function getVisualSize(canvas: DrawableCanvas): { width: number; height: number } {
  const aspectRatio = canvas.getPixelAspectRatio();
  return {
    width: canvas.getBufferWidth() * aspectRatio,
    height: canvas.getBufferHeight()
  };
}
