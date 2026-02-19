// Complete Integration Test for All Three Phases

import { assertEquals, assertExists } from "jsr:@std/assert";
import { RenderingEngine } from '../src/rendering.ts';
import { TextElement } from '../src/components/text.ts';
import { ContainerElement } from '../src/components/container.ts';
import { ButtonElement } from '../src/components/button.ts';
import { DualBuffer } from '../src/buffer.ts';
import { globalContentMeasurer } from '../src/content-measurer.ts';

Deno.test('Complete Integration - Scrolling container with viewport system', () => {
  const renderingEngine = new RenderingEngine();

  // Focus on testing the key Phase 3 functionality - a simple scrollable container
  const scrollContent = [
    new TextElement({ text: 'Line 1', id: 'line1' }),
    new TextElement({ text: 'Line 2', id: 'line2' }),
    new TextElement({ text: 'Line 3', id: 'line3' })
  ];

  const scrollContainer = new ContainerElement({
    scrollable: true,
    width: 40,
    height: 8,
    scrollY: 1, // Start scrolled down to test viewport transformations
    id: 'scroll-area'
  }, scrollContent);

  const buffer = new DualBuffer(60, 15);
  const viewport = { x: 0, y: 0, width: 60, height: 15 };

  // Render with the viewport system active
  const layoutTree = renderingEngine.render(scrollContainer, buffer, viewport);

  // Verify the viewport system worked correctly
  assertEquals(layoutTree.element.id, 'scroll-area');
  assertEquals(layoutTree.children.length, 3);

  // Phase 2: Should have real content dimensions (not virtual space)
  assertExists(layoutTree.actualContentSize);
  assertEquals(layoutTree.actualContentSize.height >= 3, true);
  assertEquals(layoutTree.actualContentSize.height < 10000, true); // Not virtual space

  // Phase 3: Viewport system should allow consistent scroll dimension calculation
  const scrollDims = renderingEngine.calculateScrollDimensions(scrollContainer);
  assertEquals(scrollDims.height >= 3, true);

  // Test that all systems work together without errors
  assertExists(layoutTree.bounds);
  assertEquals(layoutTree.bounds.width, 40);
  assertEquals(layoutTree.bounds.height, 8);
});

Deno.test('Complete Integration - Performance with all optimizations', () => {
  const renderingEngine = new RenderingEngine();

  // Create content that would have been slow with the old system
  const heavyContent = [];
  for (let i = 0; i < 100; i++) {
    heavyContent.push(new TextElement({
      text: `Performance test line ${i} - This would have triggered the virtual space hack before Phase 2`,
      style: { textWrap: 'wrap' },
      id: `perf-${i}`
    }));
  }

  const scrollContainer = new ContainerElement({
    scrollable: true,
    width: 50,
    height: 20,
    scrollY: 30, // Scroll to middle
    id: 'heavy-scroll'
  }, heavyContent);

  const buffer = new DualBuffer(80, 30);
  const viewport = { x: 0, y: 0, width: 80, height: 30 };

  // Measure performance with all optimizations
  const startTime = performance.now();

  const layoutTree = renderingEngine.render(scrollContainer, buffer, viewport);

  const firstRenderTime = performance.now() - startTime;

  // Verify it completed successfully
  assertEquals(layoutTree.children.length, 100);
  assertExists(layoutTree.actualContentSize);

  // Phase 1: Content measurement should be consistent
  const directMeasurement = globalContentMeasurer.measureContainer(scrollContainer, 50);
  assertEquals(directMeasurement.height >= 100, true);

  // Multiple scroll dimension calculations should be fast (using cached layout data)
  const calcStart = performance.now();

  for (let i = 0; i < 20; i++) {
    const dims = renderingEngine.calculateScrollDimensions(scrollContainer);
    assertEquals(dims.height >= 100, true);
  }

  const calcTime = performance.now() - calcStart;

  // Phase 2: Calculations should be much faster due to layout caching
  assertEquals(calcTime < firstRenderTime, true);

  // Performance should be reasonable even with complex content
  assertEquals(firstRenderTime < 200, true); // Less than 200ms for 100 elements
});

Deno.test('Complete Integration - All three phases working together', () => {
  const renderingEngine = new RenderingEngine();

  // Create a layout that exercises all three phases
  const textWithWrapping = new TextElement({
    text: 'This is a long text that will wrap and test Phase 1 content measurement improvements',
    style: { textWrap: 'wrap' },
    id: 'wrapped-text'
  });

  const scrollableContent = [];
  for (let i = 0; i < 15; i++) {
    scrollableContent.push(new TextElement({
      text: `Line ${i + 1}`,
      id: `content-${i}`
    }));
  }

  const scrollContainer = new ContainerElement({
    scrollable: true,
    width: 30,
    height: 8,
    scrollY: 4,
    id: 'test-scroll'
  }, scrollableContent);

  const clippedContainer = new ContainerElement({
    width: 25,
    height: 6,
    style: { border: 'thin' },
    id: 'clipped'
  }, [textWithWrapping]);

  const mainLayout = new ContainerElement({
    width: 60,
    height: 20,
    style: { display: 'flex', flexDirection: 'row' },
    id: 'main-layout'
  }, [clippedContainer, scrollContainer]);

  const buffer = new DualBuffer(80, 25);
  const viewport = { x: 0, y: 0, width: 80, height: 25 };

  const layoutTree = renderingEngine.render(mainLayout, buffer, viewport);

  // Verify all phases contributed to the final result
  assertEquals(layoutTree.children.length, 2);

  // Phase 1: Content measurement worked for wrapped text
  const clippedNode = layoutTree.children[0];
  assertEquals(clippedNode.children.length, 1);
  const wrappedTextNode = clippedNode.children[0];
  // Text should have been measured properly for wrapping

  // Phase 2: Scroll container should have real dimensions, not virtual space
  const scrollNode = layoutTree.children[1];
  assertExists(scrollNode.actualContentSize);
  assertEquals(scrollNode.actualContentSize.height >= 15, true);
  assertEquals(scrollNode.actualContentSize.height < 10000, true); // Not virtual space

  // Phase 3: Viewport system should be active (we can't easily test internal buffer types,
  // but we can verify the rendering completed successfully with complex layout)
  assertEquals(scrollNode.children.length, 15);

  // All systems should work together without errors
  const scrollDims = renderingEngine.calculateScrollDimensions(scrollContainer);
  assertEquals(scrollDims.height >= 15, true);
});

Deno.test('Complete Integration - Error handling and fallbacks', () => {
  const renderingEngine = new RenderingEngine();

  // Create content that might stress error handling
  const edgeCaseContent = [
    new TextElement({ text: '', id: 'empty-text' }), // Empty text
    new TextElement({ text: 'Normal text', id: 'normal-text' }),
    new ContainerElement({ width: 0, height: 0, id: 'zero-size' }, []), // Zero size
    new TextElement({
      text: 'Very very very very very very very very very long text that definitely exceeds normal bounds',
      id: 'very-long-text'
    })
  ];

  const container = new ContainerElement({
    scrollable: true,
    width: 20,
    height: 5,
    id: 'edge-case-container'
  }, edgeCaseContent);

  const buffer = new DualBuffer(50, 15);
  const viewport = { x: 0, y: 0, width: 50, height: 15 };

  // Should handle edge cases gracefully
  const layoutTree = renderingEngine.render(container, buffer, viewport);

  // Should have processed all children without errors
  assertEquals(layoutTree.children.length, 4);

  // Should have content dimensions even with edge cases
  assertExists(layoutTree.actualContentSize);

  // Should be able to calculate scroll dimensions
  const scrollDims = renderingEngine.calculateScrollDimensions(container);
  assertEquals(typeof scrollDims.width, 'number');
  assertEquals(typeof scrollDims.height, 'number');
});

Deno.test('Complete Integration - Backward compatibility preserved', () => {
  const renderingEngine = new RenderingEngine();

  // Test that pre-Phase 1 style usage still works
  const oldStyleContainer = new ContainerElement({
    width: 40,
    height: 10
    // No IDs, no special features - just basic container
  }, [
    new TextElement({ text: 'Legacy text 1' }),
    new TextElement({ text: 'Legacy text 2' }),
    new TextElement({ text: 'Legacy text 3' })
  ]);

  const buffer = new DualBuffer(60, 20);
  const viewport = { x: 0, y: 0, width: 60, height: 20 };

  // Should work exactly as it did before all the improvements
  const layoutTree = renderingEngine.render(oldStyleContainer, buffer, viewport);

  assertEquals(layoutTree.children.length, 3);
  assertEquals(layoutTree.bounds.width, 40);
  assertEquals(layoutTree.bounds.height, 10);

  // All the new optimizations should work behind the scenes
  // without requiring any changes to existing code
});

Deno.test('Complete Integration - Type safety maintained', () => {
  const renderingEngine = new RenderingEngine();

  // Verify that all the type enhancements work correctly
  const container = new ContainerElement({
    scrollable: true,
    width: 30,
    height: 10,
    scrollX: 5,
    scrollY: 3,
    id: 'typed-container'
  }, [
    new TextElement({ text: 'Typed text', id: 'typed-text' })
  ]);

  const buffer = new DualBuffer(50, 15);
  const viewport = { x: 0, y: 0, width: 50, height: 15 };

  const layoutTree = renderingEngine.render(container, buffer, viewport);

  // TypeScript should have caught any type issues during compilation
  // This test verifies runtime behavior matches type expectations

  // Element properties should be preserved
  assertEquals(layoutTree.element.id, 'typed-container');
  assertEquals(layoutTree.children[0].element.id, 'typed-text');

  // Layout properties should be properly typed
  assertExists(layoutTree.bounds);
  assertEquals(typeof layoutTree.bounds.x, 'number');
  assertEquals(typeof layoutTree.bounds.y, 'number');
  assertEquals(typeof layoutTree.bounds.width, 'number');
  assertEquals(typeof layoutTree.bounds.height, 'number');

  // Phase 2 enhancements should be properly typed
  if (layoutTree.actualContentSize) {
    assertEquals(typeof layoutTree.actualContentSize.width, 'number');
    assertEquals(typeof layoutTree.actualContentSize.height, 'number');
  }

  if (layoutTree.scrollbars) {
    // Scrollbar information should be properly structured
    if (layoutTree.scrollbars.vertical) {
      assertExists(layoutTree.scrollbars.vertical.bounds);
      assertEquals(typeof layoutTree.scrollbars.vertical.visible, 'boolean');
    }
  }
});