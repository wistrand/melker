// Tests for CanvasElement rendering

import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { CanvasElement } from '../mod.ts';
import { packRGBA, unpackRGBA, rgbaToCss, cssToRgba } from '../src/components/canvas.ts';

// ============================================
// Canvas Creation and Initialization
// ============================================

Deno.test('CanvasElement creation with dimensions', () => {
  const canvas = new CanvasElement({ width: 10, height: 5 });

  assertEquals(canvas.type, 'canvas');
  assertEquals(canvas.props.width, 10);
  assertEquals(canvas.props.height, 5);
});

Deno.test('CanvasElement buffer size calculation', () => {
  // Each terminal char = 2x3 pixel block
  const canvas = new CanvasElement({ width: 10, height: 5 });
  const size = canvas.getBufferSize();

  // 10 columns * 2 pixels = 20 width
  // 5 rows * 3 pixels = 15 height
  assertEquals(size.width, 20);
  assertEquals(size.height, 15);
});

Deno.test('CanvasElement with scale factor', () => {
  const canvas = new CanvasElement({ width: 10, height: 5, scale: 2 });
  const size = canvas.getBufferSize();

  // With scale 2: 10 * 2 * 2 = 40 width, 5 * 3 * 2 = 30 height
  assertEquals(size.width, 40);
  assertEquals(size.height, 30);
});

Deno.test('CanvasElement pixel aspect ratio', () => {
  const canvas = new CanvasElement({ width: 10, height: 5, charAspectRatio: 0.5 });
  const ratio = canvas.getPixelAspectRatio();

  // Pixel aspect = (2/3) * charAspectRatio = (2/3) * 0.5 = 0.333...
  assert(Math.abs(ratio - (2/3 * 0.5)) < 0.001);
});

// ============================================
// Pixel Operations
// ============================================

Deno.test('CanvasElement setPixel and getPixel', () => {
  const canvas = new CanvasElement({ width: 5, height: 5 });

  // Initially all pixels are off
  assertEquals(canvas.getPixel(0, 0), false);

  // Set a pixel
  canvas.setPixel(3, 4, true);
  assertEquals(canvas.getPixel(3, 4), true);

  // Clear it
  canvas.setPixel(3, 4, false);
  assertEquals(canvas.getPixel(3, 4), false);
});

Deno.test('CanvasElement pixel bounds checking', () => {
  const canvas = new CanvasElement({ width: 5, height: 5 });
  const size = canvas.getBufferSize();

  // Setting out of bounds should not crash
  canvas.setPixel(-1, 0, true);
  canvas.setPixel(0, -1, true);
  canvas.setPixel(size.width, 0, true);
  canvas.setPixel(0, size.height, true);

  // Getting out of bounds should return false
  assertEquals(canvas.getPixel(-1, 0), false);
  assertEquals(canvas.getPixel(size.width, 0), false);
});

Deno.test('CanvasElement clear', () => {
  const canvas = new CanvasElement({ width: 5, height: 5 });

  // Set some pixels
  canvas.setPixel(0, 0, true);
  canvas.setPixel(5, 5, true);
  canvas.setPixel(9, 14, true);

  assertEquals(canvas.getPixel(0, 0), true);

  // Clear
  canvas.clear();

  assertEquals(canvas.getPixel(0, 0), false);
  assertEquals(canvas.getPixel(5, 5), false);
  assertEquals(canvas.getPixel(9, 14), false);
});

Deno.test('CanvasElement clearRect', () => {
  const canvas = new CanvasElement({ width: 10, height: 10 });

  // Fill the canvas with pixels
  canvas.fillRect(0, 0, 20, 30);

  assertEquals(canvas.getPixel(5, 5), true);
  assertEquals(canvas.getPixel(15, 20), true);

  // Clear a rectangular region
  canvas.clearRect(4, 4, 4, 4);

  // Inside cleared region should be false
  assertEquals(canvas.getPixel(5, 5), false);
  assertEquals(canvas.getPixel(6, 6), false);

  // Outside cleared region should still be true
  assertEquals(canvas.getPixel(0, 0), true);
  assertEquals(canvas.getPixel(15, 20), true);
});

// ============================================
// Color Operations
// ============================================

Deno.test('CanvasElement setColor and getColor', () => {
  const canvas = new CanvasElement({ width: 5, height: 5 });

  // Default color is white (0xFFFFFFFF)
  assertEquals(canvas.getColor(), 0xFFFFFFFF);

  // Set color using packed value
  canvas.setColor(0xFF0000FF); // Red, fully opaque
  assertEquals(canvas.getColor(), 0xFF0000FF);

  // Set color using CSS string
  canvas.setColor('#00FF00');
  const color = canvas.getColor();
  const { r, g, b } = unpackRGBA(color);
  assertEquals(r, 0);
  assertEquals(g, 255);
  assertEquals(b, 0);
});

Deno.test('CanvasElement setPixelColor and getPixelColor', () => {
  const canvas = new CanvasElement({ width: 5, height: 5 });

  // Set pixel with specific color
  canvas.setPixelColor(3, 4, 0x00FF00FF, true);

  assertEquals(canvas.getPixel(3, 4), true);
  assertEquals(canvas.getPixelColor(3, 4), 0x00FF00FF);
});

// ============================================
// Color Utility Functions
// ============================================

Deno.test('packRGBA and unpackRGBA', () => {
  const packed = packRGBA(255, 128, 64, 200);
  const unpacked = unpackRGBA(packed);

  assertEquals(unpacked.r, 255);
  assertEquals(unpacked.g, 128);
  assertEquals(unpacked.b, 64);
  assertEquals(unpacked.a, 200);
});

Deno.test('packRGBA default alpha', () => {
  const packed = packRGBA(100, 150, 200);
  const unpacked = unpackRGBA(packed);

  assertEquals(unpacked.a, 255); // Default alpha is 255
});

Deno.test('cssToRgba parses hex colors', () => {
  // 6-digit hex
  const packed1 = cssToRgba('#FF8040');
  const color1 = unpackRGBA(packed1);
  assertEquals(color1.r, 255);
  assertEquals(color1.g, 128);
  assertEquals(color1.b, 64);
  assertEquals(color1.a, 255);

  // 3-digit hex
  const packed2 = cssToRgba('#F80');
  const color2 = unpackRGBA(packed2);
  assertEquals(color2.r, 255);
  assertEquals(color2.g, 136);
  assertEquals(color2.b, 0);
});

Deno.test('cssToRgba parses rgb() colors', () => {
  const packed = cssToRgba('rgb(100, 150, 200)');
  const color = unpackRGBA(packed);
  assertEquals(color.r, 100);
  assertEquals(color.g, 150);
  assertEquals(color.b, 200);
  assertEquals(color.a, 255);
});

Deno.test('cssToRgba parses rgba() colors', () => {
  const packed = cssToRgba('rgba(100, 150, 200, 0.5)');
  const color = unpackRGBA(packed);
  assertEquals(color.r, 100);
  assertEquals(color.g, 150);
  assertEquals(color.b, 200);
  assertEquals(color.a, 128); // 0.5 * 255 = 127.5 -> 128
});

Deno.test('rgbaToCss converts to rgb string', () => {
  const packed = packRGBA(255, 128, 64, 255);
  const css = rgbaToCss(packed);
  assertEquals(css, 'rgb(255,128,64)');
});

// ============================================
// Drawing Primitives
// ============================================

Deno.test('CanvasElement drawRect', () => {
  const canvas = new CanvasElement({ width: 10, height: 10 });

  canvas.drawRect(2, 2, 6, 4);

  // Top edge
  assertEquals(canvas.getPixel(2, 2), true);
  assertEquals(canvas.getPixel(7, 2), true);

  // Left edge
  assertEquals(canvas.getPixel(2, 5), true);

  // Right edge
  assertEquals(canvas.getPixel(7, 5), true);

  // Bottom edge
  assertEquals(canvas.getPixel(2, 5), true);
  assertEquals(canvas.getPixel(7, 5), true);

  // Inside should be empty
  assertEquals(canvas.getPixel(4, 3), false);
});

Deno.test('CanvasElement fillRect', () => {
  const canvas = new CanvasElement({ width: 10, height: 10 });

  canvas.fillRect(2, 2, 4, 3);

  // All pixels inside should be filled
  assertEquals(canvas.getPixel(2, 2), true);
  assertEquals(canvas.getPixel(3, 3), true);
  assertEquals(canvas.getPixel(5, 4), true);

  // Outside should be empty
  assertEquals(canvas.getPixel(1, 1), false);
  assertEquals(canvas.getPixel(6, 5), false);
});

Deno.test('CanvasElement drawLine horizontal', () => {
  const canvas = new CanvasElement({ width: 10, height: 10 });

  canvas.drawLine(2, 5, 8, 5);

  // All points on the line should be set
  for (let x = 2; x <= 8; x++) {
    assertEquals(canvas.getPixel(x, 5), true, `Pixel at (${x}, 5) should be set`);
  }

  // Points not on the line should be off
  assertEquals(canvas.getPixel(2, 4), false);
  assertEquals(canvas.getPixel(2, 6), false);
});

Deno.test('CanvasElement drawLine vertical', () => {
  const canvas = new CanvasElement({ width: 10, height: 10 });

  canvas.drawLine(5, 2, 5, 8);

  // All points on the line should be set
  for (let y = 2; y <= 8; y++) {
    assertEquals(canvas.getPixel(5, y), true, `Pixel at (5, ${y}) should be set`);
  }
});

Deno.test('CanvasElement drawLine diagonal', () => {
  const canvas = new CanvasElement({ width: 10, height: 10 });

  canvas.drawLine(0, 0, 9, 9);

  // Diagonal line should have pixels along the path
  assertEquals(canvas.getPixel(0, 0), true);
  assertEquals(canvas.getPixel(4, 4), true);
  assertEquals(canvas.getPixel(9, 9), true);
});

Deno.test('CanvasElement drawCircle', () => {
  const canvas = new CanvasElement({ width: 20, height: 20 });

  canvas.drawCircle(20, 30, 8);

  // Center should be empty (it's an outline)
  assertEquals(canvas.getPixel(20, 30), false);

  // Points on the circle should be set (approximately)
  // Top of circle
  assertEquals(canvas.getPixel(20, 22), true);
  // Bottom of circle
  assertEquals(canvas.getPixel(20, 38), true);
});

Deno.test('CanvasElement drawEllipse', () => {
  const canvas = new CanvasElement({ width: 20, height: 20 });

  canvas.drawEllipse(20, 30, 10, 5);

  // Center should be empty
  assertEquals(canvas.getPixel(20, 30), false);

  // Points on the ellipse should be set
  // Leftmost point
  assertEquals(canvas.getPixel(10, 30), true);
  // Rightmost point
  assertEquals(canvas.getPixel(30, 30), true);
});

// ============================================
// Color Drawing Methods
// ============================================

Deno.test('CanvasElement drawLineColor', () => {
  const canvas = new CanvasElement({ width: 10, height: 5 });

  canvas.drawLineColor(0, 5, 10, 5, '#FF0000');

  assertEquals(canvas.getPixel(5, 5), true);
  const color = canvas.getPixelColor(5, 5);
  const { r, g, b } = unpackRGBA(color);
  assertEquals(r, 255);
  assertEquals(g, 0);
  assertEquals(b, 0);
});

Deno.test('CanvasElement fillRectColor', () => {
  const canvas = new CanvasElement({ width: 10, height: 10 });

  canvas.fillRectColor(2, 2, 4, 4, '#00FF00');

  assertEquals(canvas.getPixel(3, 3), true);
  const color = canvas.getPixelColor(3, 3);
  const { r, g, b } = unpackRGBA(color);
  assertEquals(r, 0);
  assertEquals(g, 255);
  assertEquals(b, 0);
});

// ============================================
// Dirty State Tracking
// ============================================

Deno.test('CanvasElement dirty state tracking', () => {
  const canvas = new CanvasElement({ width: 5, height: 5 });

  // Initially dirty after creation (clear is called)
  assertEquals(canvas.isDirty(), true);

  // Mark clean
  canvas['_markClean']();
  assertEquals(canvas.isDirty(), false);

  // Drawing makes it dirty
  canvas.setPixel(1, 1, true);
  assertEquals(canvas.isDirty(), true);

  // Mark clean again
  canvas['_markClean']();
  assertEquals(canvas.isDirty(), false);

  // clear() makes it dirty
  canvas.clear();
  assertEquals(canvas.isDirty(), true);
});

// ============================================
// Resize Operations
// ============================================

Deno.test('CanvasElement setSize', () => {
  const canvas = new CanvasElement({ width: 5, height: 5 });

  assertEquals(canvas.getBufferSize().width, 10);
  assertEquals(canvas.getBufferSize().height, 15);

  // Resize
  canvas.setSize(10, 8);

  assertEquals(canvas.getBufferSize().width, 20);
  assertEquals(canvas.getBufferSize().height, 24);
});

Deno.test('CanvasElement setSize clears buffer', () => {
  const canvas = new CanvasElement({ width: 5, height: 5 });

  // Draw something
  canvas.setPixel(2, 2, true);

  // Resize - this clears the canvas
  canvas.setSize(10, 10);

  // Buffer should be cleared after resize
  assertEquals(canvas.getPixel(2, 2), false);
});
