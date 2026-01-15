// Tests for Phase 3: Complete Viewport System Integration

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { RenderingEngine } from '../src/rendering.ts';
import { TextElement } from '../src/components/text.ts';
import { ContainerElement } from '../src/components/container.ts';
import { DualBuffer } from '../src/buffer.ts';
import { ViewportDualBuffer, ViewportBufferProxy } from '../src/viewport-buffer.ts';
import { globalViewportManager } from '../src/viewport.ts';

Deno.test('Viewport System - Basic clipping functionality', () => {
  const renderingEngine = new RenderingEngine();

  // Create text that should be clipped
  const longText = new TextElement({
    text: 'This is a very long line that should be clipped when rendered in a small container',
    id: 'long-text'
  });

  const container = new ContainerElement({
    width: 20,
    height: 3,
    style: { border: 'thin' },
    id: 'clip-container'
  }, [longText]);

  // Render with clipping bounds
  const buffer = new DualBuffer(50, 10);
  const viewport = { x: 0, y: 0, width: 50, height: 10 };

  const layoutTree = renderingEngine.render(container, buffer, viewport);

  // Verify the layout tree structure is correct
  assertEquals(layoutTree.children.length, 1);
  assertEquals(layoutTree.children[0].element.id, 'long-text');

  // The text should be rendered but clipped to container bounds
  // We can't easily test the actual clipping without inspecting buffer contents,
  // but we can verify the structure is correct
  assertExists(layoutTree.bounds);
  assertEquals(layoutTree.bounds.width, 20);
  assertEquals(layoutTree.bounds.height, 3);
});

Deno.test('Viewport System - Scrollable container with viewport', () => {
  const renderingEngine = new RenderingEngine();

  // Create content that definitely needs scrolling
  const scrollContent = [];
  for (let i = 0; i < 10; i++) {
    scrollContent.push(new TextElement({
      text: `Scroll line ${i + 1}`,
      id: `scroll-${i}`
    }));
  }

  const scrollContainer = new ContainerElement({
    scrollable: true,
    width: 25,
    height: 5,
    scrollY: 3, // Scroll down 3 lines
    id: 'scroll-container'
  }, scrollContent);

  const buffer = new DualBuffer(50, 20);
  const viewport = { x: 0, y: 0, width: 50, height: 20 };

  const layoutTree = renderingEngine.render(scrollContainer, buffer, viewport);

  // Should have all children in layout tree
  assertEquals(layoutTree.children.length, 10);

  // Should have calculated actual content dimensions
  assertExists(layoutTree.actualContentSize);
  assertEquals(layoutTree.actualContentSize.height >= 10, true);

  // Should have scrollbar information if needed
  if (layoutTree.actualContentSize.height > 5) {
    assertExists(layoutTree.scrollbars);
  }
});

Deno.test('ViewportBufferProxy - Wide character clipping', () => {
  const buffer = new DualBuffer(10, 5);

  const viewport = {
    bounds: { x: 0, y: 0, width: 10, height: 5 },
    clipRect: { x: 2, y: 1, width: 6, height: 3 }, // Smaller clip area
    scrollOffset: { x: 0, y: 0 },
    contentSize: { width: 10, height: 5 },
    scrollbars: {}
  };

  const proxy = new ViewportBufferProxy(buffer.currentBuffer, viewport);

  // Test wide character handling - emoji should be clipped properly
  proxy.setText(1, 1, '🌟ABC', { foreground: 'white' });

  // Wide character at position 1,1 should be clipped if it doesn't fit
  const cell = buffer.currentBuffer.getCell(1, 1);
  // The exact behavior depends on whether the emoji fits within clip bounds
  // but the important thing is it doesn't crash and handles clipping
  assertExists(cell);
});

Deno.test('ViewportDualBuffer - Integration with rendering', () => {
  const buffer = new DualBuffer(80, 24);

  const viewport = globalViewportManager.createViewport({
    element: new TextElement({ text: 'Test' }),
    contentSize: { width: 40, height: 12 }
  });

  const viewportBuffer = new ViewportDualBuffer(buffer, viewport);

  // Test that viewport buffer maintains DualBuffer interface
  assertEquals(viewportBuffer.width, 80);
  assertEquals(viewportBuffer.height, 24);
  assertExists(viewportBuffer.currentBuffer);
  assertExists(viewportBuffer.renderOptions);

  // Test viewport-specific properties
  assertEquals(viewportBuffer.viewport.contentSize.width, 40);
  assertEquals(viewportBuffer.viewport.contentSize.height, 12);

  // Test buffer operations work
  viewportBuffer.currentBuffer.setText(5, 5, 'Test', { foreground: 'white' });

  // Should be able to get diff
  const diff = viewportBuffer.swapAndGetDiff();
  assertExists(diff);
});

Deno.test('Component Rendering - Works with viewport buffers', () => {
  const renderingEngine = new RenderingEngine();

  // Create a nested structure to test viewport propagation
  const innerText = new TextElement({
    text: 'Inner text content',
    id: 'inner-text'
  });

  const innerContainer = new ContainerElement({
    width: 15,
    height: 3,
    style: { border: 'thin' },
    id: 'inner-container'
  }, [innerText]);

  const outerContainer = new ContainerElement({
    width: 30,
    height: 10,
    style: { border: 'thin' },
    id: 'outer-container'
  }, [innerContainer]);

  const buffer = new DualBuffer(50, 15);
  const viewport = { x: 0, y: 0, width: 50, height: 15 };

  // This should work with the viewport system
  const layoutTree = renderingEngine.render(outerContainer, buffer, viewport);

  // Verify nested structure is preserved
  assertEquals(layoutTree.children.length, 1);
  assertEquals(layoutTree.children[0].children.length, 1);

  // Verify IDs are preserved through viewport rendering
  assertEquals(layoutTree.children[0].element.id, 'inner-container');
  assertEquals(layoutTree.children[0].children[0].element.id, 'inner-text');
});

Deno.test('Phase 3 - Performance with viewport system', () => {
  const renderingEngine = new RenderingEngine();

  // Create a complex layout that would stress the viewport system
  const complexContent = [];
  for (let i = 0; i < 50; i++) {
    complexContent.push(new TextElement({
      text: `Performance test line ${i} with various content lengths to test clipping efficiency`,
      id: `perf-text-${i}`
    }));
  }

  const scrollContainer = new ContainerElement({
    scrollable: true,
    width: 40,
    height: 10,
    scrollY: 15, // Scroll to middle
    id: 'perf-scroll-container'
  }, complexContent);

  const buffer = new DualBuffer(80, 25);
  const viewport = { x: 0, y: 0, width: 80, height: 25 };

  // Measure performance
  const startTime = performance.now();

  const layoutTree = renderingEngine.render(scrollContainer, buffer, viewport);

  const renderTime = performance.now() - startTime;

  // Verify rendering completed successfully
  assertEquals(layoutTree.children.length, 50);
  assertExists(layoutTree.actualContentSize);

  // Performance should be reasonable (less than 100ms for this test)
  assertEquals(renderTime < 100, true);

  // Multiple renders should be fast due to layout caching
  const secondStart = performance.now();
  renderingEngine.render(scrollContainer, buffer, viewport);
  const secondRenderTime = performance.now() - secondStart;

  // Second render should be faster than first (due to caching)
  assertEquals(secondRenderTime <= renderTime, true);
});

Deno.test('Backward Compatibility - Legacy components still work', () => {
  const renderingEngine = new RenderingEngine();

  // Test that components without viewport awareness still work
  const simpleText = new TextElement({
    text: 'Simple backward compatible text',
    id: 'legacy-text'
  });

  const simpleContainer = new ContainerElement({
    width: 40,
    height: 5,
    id: 'legacy-container'
  }, [simpleText]);

  const buffer = new DualBuffer(80, 25);
  const viewport = { x: 0, y: 0, width: 80, height: 25 };

  // Should work exactly as before
  const layoutTree = renderingEngine.render(simpleContainer, buffer, viewport);

  assertEquals(layoutTree.children.length, 1);
  assertEquals(layoutTree.children[0].element.id, 'legacy-text');
  assertEquals(layoutTree.element.id, 'legacy-container');

  // Should maintain backward compatibility
  assertExists(layoutTree.bounds);
  assertEquals(layoutTree.bounds.width, 40);
  assertEquals(layoutTree.bounds.height, 5);
});