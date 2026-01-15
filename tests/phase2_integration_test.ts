// Tests for Phase 2: Layout Engine Integration with Viewport System

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { LayoutEngine } from '../src/layout.ts';
import { RenderingEngine } from '../src/rendering.ts';
import { TextElement } from '../src/components/text.ts';
import { ContainerElement } from '../src/components/container.ts';
import { DualBuffer } from '../src/buffer.ts';

Deno.test('Layout Engine - Real content dimensions instead of virtual space', () => {
  const layoutEngine = new LayoutEngine();

  // Create scrollable container with known content
  const child1 = new TextElement({ text: 'Line 1', id: 'child1' });
  const child2 = new TextElement({ text: 'Line 2', id: 'child2' });
  const child3 = new TextElement({ text: 'Line 3', id: 'child3' });

  const container = new ContainerElement({
    scrollable: true,
    width: 20,
    height: 5,
    id: 'scrollable-container'
  }, [child1, child2, child3]);

  const context = {
    viewport: { x: 0, y: 0, width: 50, height: 25 },
    parentBounds: { x: 0, y: 0, width: 20, height: 5 },
    availableSpace: { width: 20, height: 5 }
  };

  const layoutNode = layoutEngine.calculateLayout(container, context);

  // Should have calculated actual content dimensions
  assertExists(layoutNode.actualContentSize);
  assertEquals(layoutNode.actualContentSize.height >= 3, true); // At least 3 lines
  assertEquals(layoutNode.actualContentSize.width > 0, true);

  // Should have layout for each child
  assertEquals(layoutNode.children.length, 3);
});

Deno.test('Layout Engine - Scrollbar calculations in layout phase', () => {
  const layoutEngine = new LayoutEngine();

  // Create container that definitely needs scrolling
  const children = [];
  for (let i = 0; i < 10; i++) {
    children.push(new TextElement({ text: `Long line ${i} that contains content`, id: `line-${i}` }));
  }

  const container = new ContainerElement({
    scrollable: true,
    width: 20,
    height: 5, // Small height to force vertical scrolling
    id: 'scroll-container'
  }, children);

  const context = {
    viewport: { x: 0, y: 0, width: 50, height: 25 },
    parentBounds: { x: 0, y: 0, width: 20, height: 5 },
    availableSpace: { width: 20, height: 5 }
  };

  const layoutNode = layoutEngine.calculateLayout(container, context);

  // Should have pre-calculated scrollbars
  assertExists(layoutNode.scrollbars);

  // With 10 lines in a height of 5, should need vertical scrollbar
  if (layoutNode.actualContentSize && layoutNode.actualContentSize.height > 5) {
    assertExists(layoutNode.scrollbars.vertical);
    assertEquals(layoutNode.scrollbars.vertical.visible, true);
  }
});

Deno.test('RenderingEngine - Uses layout-provided content dimensions', () => {
  const renderingEngine = new RenderingEngine();

  // Create scrollable container
  const child1 = new TextElement({ text: 'Content line 1', id: 'content1' });
  const child2 = new TextElement({ text: 'Content line 2', id: 'content2' });

  const container = new ContainerElement({
    scrollable: true,
    width: 25,
    height: 10,
    id: 'test-scroll-container'
  }, [child1, child2]);

  // First render to establish layout context
  const buffer = new DualBuffer(50, 20);
  const viewport = { x: 0, y: 0, width: 50, height: 20 };
  renderingEngine.render(container, buffer, viewport);

  // Now calculate scroll dimensions - should use layout-provided data
  const dimensions = renderingEngine.calculateScrollDimensions(container);

  assertExists(dimensions);
  assertEquals(dimensions.width > 0, true);
  assertEquals(dimensions.height > 0, true);
  // Should have dimensions for 2 text lines
  assertEquals(dimensions.height >= 2, true);
});

Deno.test('Integration - Layout and Rendering work together', () => {
  const renderingEngine = new RenderingEngine();

  // Create a more complex layout
  const textContent = [];
  for (let i = 1; i <= 8; i++) {
    textContent.push(new TextElement({
      text: `This is line ${i} with some content that might be long`,
      id: `line-${i}`
    }));
  }

  const scrollContainer = new ContainerElement({
    scrollable: true,
    width: 30,
    height: 5, // Smaller than content to force scrolling
    id: 'main-scroll-container'
  }, textContent);

  const outerContainer = new ContainerElement({
    width: 40,
    height: 20,
    id: 'outer-container'
  }, [scrollContainer]);

  // Render the entire tree
  const buffer = new DualBuffer(80, 25);
  const viewport = { x: 0, y: 0, width: 80, height: 25 };
  const layoutTree = renderingEngine.render(outerContainer, buffer, viewport);

  // Verify the layout tree has proper structure
  assertEquals(layoutTree.children.length, 1); // outer container has 1 child

  const scrollContainerNode = layoutTree.children[0];
  assertEquals(scrollContainerNode.element.id, 'main-scroll-container');
  assertEquals(scrollContainerNode.children.length, 8); // Should have all 8 text elements

  // Verify scrollable container has content dimensions
  assertExists(scrollContainerNode.actualContentSize);
  assertEquals(scrollContainerNode.actualContentSize.height >= 8, true); // At least 8 lines

  // Verify scroll calculations work
  const scrollDimensions = renderingEngine.calculateScrollDimensions(scrollContainer);
  assertEquals(scrollDimensions.height >= 8, true);
});

Deno.test('Phase 2 - No virtual space hack dependency', () => {
  const layoutEngine = new LayoutEngine();

  // Create a container that would have triggered the virtual space hack
  const largeContent = [];
  for (let i = 0; i < 50; i++) {
    largeContent.push(new TextElement({
      text: `Line ${i}`,
      id: `large-content-${i}`
    }));
  }

  const container = new ContainerElement({
    scrollable: true,
    width: 20,
    height: 8,
    id: 'large-container'
  }, largeContent);

  const context = {
    viewport: { x: 0, y: 0, width: 50, height: 25 },
    parentBounds: { x: 0, y: 0, width: 20, height: 8 },
    availableSpace: { width: 20, height: 8 }
  };

  const layoutNode = layoutEngine.calculateLayout(container, context);

  // Should have real content dimensions, not 10000
  assertExists(layoutNode.actualContentSize);
  assertEquals(layoutNode.actualContentSize.height < 10000, true); // Not the virtual space
  assertEquals(layoutNode.actualContentSize.height >= 50, true); // But realistic for 50 lines

  // The availableSpace in child context should be based on real content, not virtual
  // We can't directly test the internal child context, but we can verify children are laid out properly
  assertEquals(layoutNode.children.length, 50);

  // First child should have reasonable bounds
  const firstChild = layoutNode.children[0];
  assertEquals(firstChild.bounds.height < 10000, true); // Not affected by virtual space hack
});

Deno.test('Performance - Layout calculations are done once', () => {
  const renderingEngine = new RenderingEngine();

  // Create content that would be expensive to measure repeatedly
  const content = [];
  for (let i = 0; i < 20; i++) {
    content.push(new TextElement({
      text: `Performance test line ${i} with substantial content that could be expensive to measure repeatedly`,
      id: `perf-${i}`
    }));
  }

  const container = new ContainerElement({
    scrollable: true,
    width: 40,
    height: 10,
    id: 'perf-container'
  }, content);

  // First render - establishes layout
  const buffer = new DualBuffer(80, 25);
  const viewport = { x: 0, y: 0, width: 80, height: 25 };
  const startTime = performance.now();

  renderingEngine.render(container, buffer, viewport);

  const renderTime = performance.now() - startTime;

  // Multiple calls to calculateScrollDimensions should be fast (using cached layout data)
  const calcStart = performance.now();

  for (let i = 0; i < 10; i++) {
    const dimensions = renderingEngine.calculateScrollDimensions(container);
    assertEquals(dimensions.height >= 20, true); // Verify it works
  }

  const calcTime = performance.now() - calcStart;

  // The calculations should be much faster than the initial render
  // since they use pre-calculated layout data
  assertEquals(calcTime < renderTime, true);
});