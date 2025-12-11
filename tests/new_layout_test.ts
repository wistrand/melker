// Tests for the new layout engine and content measurement improvements

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { ContentMeasurer, globalContentMeasurer } from '../src/content-measurer.ts';
import { Viewport, ViewportManager, globalViewportManager, CoordinateTransform } from '../src/viewport.ts';
import { ViewportDualBuffer, ViewportBufferProxy } from '../src/viewport-buffer.ts';
import { DualBuffer } from '../src/buffer.ts';
import { TextElement } from '../src/components/text.ts';
import { ContainerElement } from '../src/components/container.ts';
import { RenderingEngine } from '../src/rendering.ts';

Deno.test('ContentMeasurer - Basic element measurement', () => {
  const measurer = new ContentMeasurer();

  // Test text element measurement
  const textElement = new TextElement({ text: 'Hello World' });
  const size = measurer.measureElement(textElement, 80);

  assertEquals(size.width, 11); // Length of "Hello World"
  assertEquals(size.height, 1); // Single line
});

Deno.test('ContentMeasurer - Container measurement', () => {
  const measurer = new ContentMeasurer();

  // Test container with multiple text children
  const child1 = new TextElement({ text: 'First line' });
  const child2 = new TextElement({ text: 'Second line' });
  const container = new ContainerElement({}, [child1, child2]);

  const size = measurer.measureContainer(container, 80);

  assertEquals(size.width, 11); // Length of "Second line" (longest)
  assertEquals(size.height, 2); // Two lines
});

Deno.test('ContentMeasurer - Wrapped text measurement', () => {
  const measurer = new ContentMeasurer();

  // Test text that should wrap
  const longText = 'This is a very long line that should wrap to multiple lines';
  const textElement = new TextElement({
    text: longText,
    style: { textWrap: 'wrap' }
  });

  const size = measurer.measureElement(textElement, 20); // Narrow width

  assertEquals(size.width, 20); // Width constrained to available
  // Height should be > 1 due to wrapping (exact calculation may vary)
  assertEquals(size.height > 1, true);
});

Deno.test('ViewportManager - Basic viewport creation', () => {
  const manager = new ViewportManager();
  const element = new TextElement({ text: 'Test' });

  const viewport = manager.createViewport({
    element,
    contentSize: { width: 100, height: 50 }
  });

  assertExists(viewport.bounds);
  assertExists(viewport.clipRect);
  assertExists(viewport.scrollOffset);
  assertExists(viewport.contentSize);
  assertEquals(viewport.contentSize.width, 100);
  assertEquals(viewport.contentSize.height, 50);
});

Deno.test('ViewportManager - Scroll offset clamping', () => {
  const manager = new ViewportManager();
  const element = new TextElement({ text: 'Test' });

  const viewport = manager.createViewport({
    element,
    contentSize: { width: 200, height: 100 }
  });

  // Set viewport bounds smaller than content
  viewport.bounds = { x: 0, y: 0, width: 50, height: 25 };
  viewport.clipRect = { x: 0, y: 0, width: 50, height: 25 };

  // Test scroll offset clamping
  const invalidViewport = {
    ...viewport,
    scrollOffset: { x: -10, y: 200 } // Invalid offsets
  };

  const clampedViewport = manager.clampScrollOffset(invalidViewport);

  assertEquals(clampedViewport.scrollOffset.x, 0); // Clamped to 0
  assertEquals(clampedViewport.scrollOffset.y <= 75, true); // Clamped to max valid
});

Deno.test('CoordinateTransform - Point transformation', () => {
  const viewport: Viewport = {
    bounds: { x: 0, y: 0, width: 80, height: 24 },
    clipRect: { x: 0, y: 0, width: 80, height: 24 },
    scrollOffset: { x: 10, y: 5 },
    contentSize: { width: 200, height: 100 },
    scrollbars: {}
  };

  const transform = new CoordinateTransform(viewport);

  const originalPoint = { x: 20, y: 15 };
  const transformedPoint = transform.transformPoint(originalPoint);

  assertEquals(transformedPoint.x, 10); // 20 - 10 scroll offset
  assertEquals(transformedPoint.y, 10); // 15 - 5 scroll offset
});

Deno.test('CoordinateTransform - Visibility checking', () => {
  const viewport: Viewport = {
    bounds: { x: 0, y: 0, width: 80, height: 24 },
    clipRect: { x: 10, y: 5, width: 60, height: 15 },
    scrollOffset: { x: 0, y: 0 },
    contentSize: { width: 80, height: 24 },
    scrollbars: {}
  };

  const transform = new CoordinateTransform(viewport);

  // Point inside clip rect
  assertEquals(transform.isPointVisible(15, 10), true);

  // Point outside clip rect
  assertEquals(transform.isPointVisible(5, 3), false);
  assertEquals(transform.isPointVisible(75, 22), false);
});

Deno.test('ViewportBufferProxy - Basic operations', () => {
  const buffer = new DualBuffer(80, 24);
  const viewport: Viewport = {
    bounds: { x: 0, y: 0, width: 80, height: 24 },
    clipRect: { x: 10, y: 5, width: 60, height: 15 }, // Smaller clip area
    scrollOffset: { x: 0, y: 0 },
    contentSize: { width: 80, height: 24 },
    scrollbars: {}
  };

  const proxy = new ViewportBufferProxy(buffer.currentBuffer, viewport);

  // Set cell inside visible area - should work
  proxy.setCell(15, 10, { char: 'A' });
  const cell1 = buffer.currentBuffer.getCell(15, 10);
  assertEquals(cell1?.char, 'A');

  // Set cell outside visible area - should be ignored
  proxy.setCell(5, 3, { char: 'B' });
  const cell2 = buffer.currentBuffer.getCell(5, 3);
  assertEquals(cell2?.char, ' '); // Should remain empty
});

Deno.test('ViewportDualBuffer - Integration test', () => {
  const buffer = new DualBuffer(80, 24);
  const viewport: Viewport = {
    bounds: { x: 0, y: 0, width: 80, height: 24 },
    clipRect: { x: 0, y: 0, width: 80, height: 24 },
    scrollOffset: { x: 0, y: 0 },
    contentSize: { width: 80, height: 24 },
    scrollbars: {}
  };

  const viewportBuffer = new ViewportDualBuffer(buffer, viewport);

  assertEquals(viewportBuffer.width, 80);
  assertEquals(viewportBuffer.height, 24);
  assertEquals(viewportBuffer.viewport.bounds.width, 80);

  // Test buffer operations
  viewportBuffer.currentBuffer.setText(10, 5, 'Test', { foreground: 'white' });

  const cell = buffer.currentBuffer.getCell(10, 5);
  assertEquals(cell?.char, 'T');
});

Deno.test('RenderingEngine - Improved scroll dimensions calculation', () => {
  const engine = new RenderingEngine();

  // Create container with multiple text children
  const child1 = new TextElement({ text: 'Line 1', height: 1, id: 'child1' });
  const child2 = new TextElement({ text: 'Line 2 is longer', height: 1, id: 'child2' });
  const child3 = new TextElement({ text: 'Line 3', height: 1, id: 'child3' });

  const container = new ContainerElement({
    scrollable: true,
    width: 20,
    height: 5,
    id: 'test-container'
  }, [child1, child2, child3]);

  // First render the container to establish layout context
  const buffer = new DualBuffer(50, 10);
  const viewport = { x: 0, y: 0, width: 50, height: 10 };
  engine.render(container, buffer, viewport);

  // Now calculateScrollDimensions should work with layout context
  const dimensions = engine.calculateScrollDimensions(container);

  // Should calculate based on ContentMeasurer
  assertEquals(dimensions.width > 0, true);
  assertEquals(dimensions.height > 0, true);
  // With 3 text elements, height should be at least 3
  assertEquals(dimensions.height >= 3, true);
});

Deno.test('Global instances - Proper singleton behavior', () => {
  // Test that global instances are properly initialized
  assertExists(globalContentMeasurer);
  assertExists(globalViewportManager);

  // Test that they can be used consistently
  const element = new TextElement({ text: 'Test' });
  const size = globalContentMeasurer.measureElement(element, 80);
  assertEquals(size.width, 4);
  assertEquals(size.height, 1);

  const viewport = globalViewportManager.createViewport({
    element,
    contentSize: size
  });
  assertExists(viewport);
});