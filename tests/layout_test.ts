// Tests for the Advanced Layout Engine

import { assertEquals, assertNotEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  LayoutEngine,
  AdvancedLayoutNode as LayoutNode,
  LayoutContext,
  AdvancedLayoutProps,
  globalLayoutEngine,
  ContainerElement,
  TextElement,
  Element,
  Bounds,
  Size,
} from '../mod.ts';

Deno.test('LayoutEngine creation', () => {
  const engine = new LayoutEngine();
  assert(engine);
});

Deno.test('Basic block layout calculation', () => {
  const engine = new LayoutEngine();

  const child1 = new TextElement({ text: 'First', height: 2 });
  const child2 = new TextElement({ text: 'Second', height: 3 });
  const container = new ContainerElement({
    width: 20,
    height: 10,
    style: { display: 'block' }
  }, [child1, child2]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 20, height: 10 },
    parentBounds: { x: 0, y: 0, width: 20, height: 10 },
    availableSpace: { width: 20, height: 10 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 2);
  assertEquals(layoutTree.children[0].bounds.y, 0);
  assertEquals(layoutTree.children[1].bounds.y, layoutTree.children[0].bounds.height);
});

Deno.test('Flexbox row layout', () => {
  const engine = new LayoutEngine();

  const child1 = new TextElement({ text: 'A', flexGrow: 1 });
  const child2 = new TextElement({ text: 'B', flexGrow: 2 });
  const child3 = new TextElement({ text: 'C', flexGrow: 1 });

  const container = new ContainerElement({
    width: 20,
    height: 5,
    style: {
      display: 'flex',
      flexDirection: 'row'
    }
  }, [child1, child2, child3]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 20, height: 5 },
    parentBounds: { x: 0, y: 0, width: 20, height: 5 },
    availableSpace: { width: 20, height: 5 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 3);

  // Check horizontal positioning
  assertEquals(layoutTree.children[0].bounds.x, 0);
  assert(layoutTree.children[1].bounds.x > layoutTree.children[0].bounds.x);
  assert(layoutTree.children[2].bounds.x > layoutTree.children[1].bounds.x);

  // Check flex growth - child2 should be twice as wide as child1/child3
  const width1 = layoutTree.children[0].bounds.width;
  const width2 = layoutTree.children[1].bounds.width;
  const width3 = layoutTree.children[2].bounds.width;

  assert(Math.abs(width2 - (width1 * 2)) < 2); // Allow small rounding differences
  assert(Math.abs(width1 - width3) < 1);
});

Deno.test('Flexbox column layout', () => {
  const engine = new LayoutEngine();

  const child1 = new TextElement({ text: 'Top' });
  const child2 = new TextElement({ text: 'Bottom' });

  const container = new ContainerElement({
    width: 15,
    height: 10,
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between'
    }
  }, [child1, child2]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 15, height: 10 },
    parentBounds: { x: 0, y: 0, width: 15, height: 10 },
    availableSpace: { width: 15, height: 10 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 2);
  assertEquals(layoutTree.children[0].bounds.y, 0);
  assert(layoutTree.children[1].bounds.y > layoutTree.children[0].bounds.y);
});

Deno.test('Flexbox justify-content center', () => {
  const engine = new LayoutEngine();

  const child = new TextElement({ text: 'Centered' });

  const container = new ContainerElement({
    width: 20,
    height: 5,
    style: {
      display: 'flex',
      justifyContent: 'center'
    }
  }, [child]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 20, height: 5 },
    parentBounds: { x: 0, y: 0, width: 20, height: 5 },
    availableSpace: { width: 20, height: 5 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 1);

  // Child should be centered horizontally
  const child1 = layoutTree.children[0];
  const expectedX = (20 - child1.bounds.width) / 2;
  assert(Math.abs(child1.bounds.x - expectedX) < 1);
});





Deno.test('Absolute positioning', () => {
  const engine = new LayoutEngine();

  const absoluteChild = new TextElement({
    text: 'Absolute',
    width: 15,
    height: 3,
    style: {
      position: 'absolute',
      top: 5,
      left: 10
    }
  });

  const normalChild = new TextElement({ text: 'Normal' });

  const container = new ContainerElement({
    width: 50,
    height: 30,
    style: { position: 'relative' }
  }, [normalChild, absoluteChild]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 50, height: 30 },
    parentBounds: { x: 0, y: 0, width: 50, height: 30 },
    availableSpace: { width: 50, height: 30 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 2);

  // Find the absolute and normal children
  const normalNode = layoutTree.children.find(child =>
    (child.element as any).props.text === 'Normal'
  );
  const absoluteNode = layoutTree.children.find(child =>
    (child.element as any).props.text === 'Absolute'
  );

  assert(normalNode);
  assert(absoluteNode);

  // Normal child should be at origin
  assertEquals(normalNode.bounds.x, 0);
  assertEquals(normalNode.bounds.y, 0);

  // Absolute child should be positioned according to top/left
  assertEquals(absoluteNode.bounds.x, 10);
  assertEquals(absoluteNode.bounds.y, 5);
  assertEquals(absoluteNode.bounds.width, 15);
  assertEquals(absoluteNode.bounds.height, 3);
});

Deno.test('Z-index layering', () => {
  const engine = new LayoutEngine();

  const child1 = new TextElement({ text: 'Back', zIndex: 1 });
  const child2 = new TextElement({ text: 'Front', zIndex: 10 });
  const child3 = new TextElement({ text: 'Middle', zIndex: 5 });

  const container = new ContainerElement({
    width: 20,
    height: 10,
  }, [child1, child2, child3]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 20, height: 10 },
    parentBounds: { x: 0, y: 0, width: 20, height: 10 },
    availableSpace: { width: 20, height: 10 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 3);

  // Check z-index values are preserved
  const zIndexes = layoutTree.children.map(child => child.zIndex);
  assert(zIndexes.includes(1));
  assert(zIndexes.includes(5));
  assert(zIndexes.includes(10));
});

Deno.test('Complex nested layout', () => {
  const engine = new LayoutEngine();

  // Create a complex layout with nested containers
  const flexItems = [
    new TextElement({ text: 'Flex Item 1', flexGrow: 1 }),
    new TextElement({ text: 'Flex Item 2', flexGrow: 2 }),
  ];

  const flexContainer = new ContainerElement({
    height: 5,
    style: {
      display: 'flex',
      flexDirection: 'row'
    }
  }, flexItems);

  const columnItems = [
    new TextElement({ text: 'Column A' }),
    new TextElement({ text: 'Column B' }),
  ];

  const columnContainer = new ContainerElement({
    height: 8,
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, columnItems);

  const mainContainer = new ContainerElement({
    width: 30,
    height: 17, // Increased to fit both containers (5 + 8 + margin)
    style: { display: 'block' }
  }, [flexContainer, columnContainer]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 30, height: 17 },
    parentBounds: { x: 0, y: 0, width: 30, height: 17 },
    availableSpace: { width: 30, height: 17 },
  };

  const layoutTree = engine.calculateLayout(mainContainer, context);

  assertEquals(layoutTree.children.length, 2);

  const flexNode = layoutTree.children[0];
  const columnNode = layoutTree.children[1];

  // Flex container should have 2 children
  assertEquals(flexNode.children.length, 2);

  // Column container should have 2 children (in vertical flex layout)
  assertEquals(columnNode.children.length, 2);

  // Flex container should be at top
  assertEquals(flexNode.bounds.y, 0);
  assertEquals(flexNode.bounds.height, 5);

  // Column container should be below flex container
  assertEquals(columnNode.bounds.y, flexNode.bounds.height);
  assertEquals(columnNode.bounds.height, 8);
});


Deno.test('Global layout engine instance', () => {
  assert(globalLayoutEngine);
  assert(globalLayoutEngine instanceof LayoutEngine);
});

Deno.test('Flexbox gap spacing', () => {
  const engine = new LayoutEngine();

  const child1 = new TextElement({ text: 'A', style: { width: 5 } });
  const child2 = new TextElement({ text: 'B', style: { width: 5 } });
  const child3 = new TextElement({ text: 'C', style: { width: 5 } });

  const container = new ContainerElement({
    width: 30,
    height: 5,
    style: {
      display: 'flex',
      flexDirection: 'row',
      gap: 3
    }
  }, [child1, child2, child3]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 30, height: 5 },
    parentBounds: { x: 0, y: 0, width: 30, height: 5 },
    availableSpace: { width: 30, height: 5 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 3);

  // Check gap spacing between items
  const pos1 = layoutTree.children[0].bounds.x;
  const pos2 = layoutTree.children[1].bounds.x;
  const pos3 = layoutTree.children[2].bounds.x;
  const width1 = layoutTree.children[0].bounds.width;
  const width2 = layoutTree.children[1].bounds.width;

  // Gap of 3 between items
  assertEquals(pos2, pos1 + width1 + 3);
  assertEquals(pos3, pos2 + width2 + 3);
});

Deno.test('Flexbox column gap spacing', () => {
  const engine = new LayoutEngine();

  const child1 = new TextElement({ text: 'A' });
  const child2 = new TextElement({ text: 'B' });

  const container = new ContainerElement({
    width: 20,
    height: 20,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, [child1, child2]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 20, height: 20 },
    parentBounds: { x: 0, y: 0, width: 20, height: 20 },
    availableSpace: { width: 20, height: 20 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 2);

  const y1 = layoutTree.children[0].bounds.y;
  const y2 = layoutTree.children[1].bounds.y;
  const height1 = layoutTree.children[0].bounds.height;

  // Gap of 2 between items in column layout
  assertEquals(y2, y1 + height1 + 2);
});

Deno.test('Flexbox min-width constraint prevents shrinking', () => {
  const engine = new LayoutEngine();

  // Create items that would normally shrink, but one has minWidth
  const child1 = new TextElement({ text: 'AAAAAAAAAA', style: { minWidth: 15 } }); // 10 chars, minWidth 15
  const child2 = new TextElement({ text: 'BBBBBBBBBB' }); // 10 chars, no constraint

  const container = new ContainerElement({
    width: 20, // Less than both items' intrinsic width
    height: 5,
    style: {
      display: 'flex',
      flexDirection: 'row'
    }
  }, [child1, child2]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 20, height: 5 },
    parentBounds: { x: 0, y: 0, width: 20, height: 5 },
    availableSpace: { width: 20, height: 5 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 2);

  // First child should respect minWidth of 15
  assert(layoutTree.children[0].bounds.width >= 15,
    `Expected width >= 15, got ${layoutTree.children[0].bounds.width}`);
});

Deno.test('Flexbox max-width constraint prevents growing', () => {
  const engine = new LayoutEngine();

  // Create items with flex-grow, but one has maxWidth
  const child1 = new TextElement({ text: 'A', flexGrow: 1, style: { maxWidth: 10 } });
  const child2 = new TextElement({ text: 'B', flexGrow: 1 });

  const container = new ContainerElement({
    width: 40,
    height: 5,
    style: {
      display: 'flex',
      flexDirection: 'row'
    }
  }, [child1, child2]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 40, height: 5 },
    parentBounds: { x: 0, y: 0, width: 40, height: 5 },
    availableSpace: { width: 40, height: 5 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 2);

  // First child should be capped at maxWidth of 10
  assert(layoutTree.children[0].bounds.width <= 10,
    `Expected width <= 10, got ${layoutTree.children[0].bounds.width}`);

  // Second child should get the remaining space
  assert(layoutTree.children[1].bounds.width > layoutTree.children[0].bounds.width,
    'Second child should be wider than constrained first child');
});

Deno.test('Flexbox min-height constraint on cross axis', () => {
  const engine = new LayoutEngine();

  const child1 = new TextElement({ text: 'A', style: { minHeight: 8 } });
  const child2 = new TextElement({ text: 'B' });

  const container = new ContainerElement({
    width: 30,
    height: 10,
    style: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'flex-start' // Don't stretch
    }
  }, [child1, child2]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 30, height: 10 },
    parentBounds: { x: 0, y: 0, width: 30, height: 10 },
    availableSpace: { width: 30, height: 10 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 2);

  // First child should respect minHeight of 8
  assert(layoutTree.children[0].bounds.height >= 8,
    `Expected height >= 8, got ${layoutTree.children[0].bounds.height}`);
});

Deno.test('Flexbox explicit height not stretched', () => {
  const engine = new LayoutEngine();

  // Child with explicit height should not stretch even with align-items: stretch
  const child1 = new TextElement({ text: 'A', height: 3 });
  const child2 = new TextElement({ text: 'B' }); // No explicit height, should stretch

  const container = new ContainerElement({
    width: 30,
    height: 10,
    style: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'stretch'
    }
  }, [child1, child2]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 30, height: 10 },
    parentBounds: { x: 0, y: 0, width: 30, height: 10 },
    availableSpace: { width: 30, height: 10 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 2);

  // First child with explicit height should stay at 3
  assertEquals(layoutTree.children[0].bounds.height, 3);

  // Second child should stretch to container height
  assert(layoutTree.children[1].bounds.height > layoutTree.children[0].bounds.height,
    'Second child should stretch taller than first');
});

Deno.test('Flexbox flex-shrink', () => {
  const engine = new LayoutEngine();

  // Items with different shrink factors
  const child1 = new TextElement({ text: 'AAAAAAAAAA', style: { flexShrink: 1 } }); // 10 chars
  const child2 = new TextElement({ text: 'BBBBBBBBBB', style: { flexShrink: 2 } }); // 10 chars, shrinks more

  const container = new ContainerElement({
    width: 15, // Force shrinking (20 chars total, only 15 available)
    height: 5,
    style: {
      display: 'flex',
      flexDirection: 'row'
    }
  }, [child1, child2]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 15, height: 5 },
    parentBounds: { x: 0, y: 0, width: 15, height: 5 },
    availableSpace: { width: 15, height: 5 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 2);

  const width1 = layoutTree.children[0].bounds.width;
  const width2 = layoutTree.children[1].bounds.width;

  // Child2 has flexShrink: 2, so it should shrink more than child1
  assert(width1 > width2,
    `Child1 (shrink:1) should be wider than child2 (shrink:2): ${width1} vs ${width2}`);
});

Deno.test('Flexbox wrap creates multiple lines', () => {
  const engine = new LayoutEngine();

  // Create items that don't fit on one line
  const child1 = new TextElement({ text: 'A', style: { width: 15 } });
  const child2 = new TextElement({ text: 'B', style: { width: 15 } });
  const child3 = new TextElement({ text: 'C', style: { width: 15 } });

  const container = new ContainerElement({
    width: 35, // Only fits 2 items per line (15 + 15 = 30 < 35, but 45 > 35)
    height: 10,
    style: {
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap'
    }
  }, [child1, child2, child3]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 35, height: 10 },
    parentBounds: { x: 0, y: 0, width: 35, height: 10 },
    availableSpace: { width: 35, height: 10 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 3);

  // First two items should be on the same line (same y)
  assertEquals(layoutTree.children[0].bounds.y, layoutTree.children[1].bounds.y);

  // Third item should wrap to next line (different y)
  assert(layoutTree.children[2].bounds.y > layoutTree.children[0].bounds.y,
    'Third item should wrap to next line');
});

Deno.test('Flexbox align-items flex-end', () => {
  const engine = new LayoutEngine();

  const child1 = new TextElement({ text: 'A', style: { height: 2 } });
  const child2 = new TextElement({ text: 'B', style: { height: 4 } });

  const container = new ContainerElement({
    width: 30,
    height: 10,
    style: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'flex-end'
    }
  }, [child1, child2]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 30, height: 10 },
    parentBounds: { x: 0, y: 0, width: 30, height: 10 },
    availableSpace: { width: 30, height: 10 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 2);

  // Both items should be aligned to the bottom
  // The bottom edge of both items should be at the same position
  const bottom1 = layoutTree.children[0].bounds.y + layoutTree.children[0].bounds.height;
  const bottom2 = layoutTree.children[1].bounds.y + layoutTree.children[1].bounds.height;

  assertEquals(bottom1, bottom2);
});

Deno.test('Flexbox space-evenly distribution', () => {
  const engine = new LayoutEngine();

  const child1 = new TextElement({ text: 'A', style: { width: 4 } });
  const child2 = new TextElement({ text: 'B', style: { width: 4 } });
  const child3 = new TextElement({ text: 'C', style: { width: 4 } });

  const container = new ContainerElement({
    width: 24, // 4+4+4=12 content, 12 remaining, divided into 4 spaces of 3 each
    height: 5,
    style: {
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'space-evenly'
    }
  }, [child1, child2, child3]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 24, height: 5 },
    parentBounds: { x: 0, y: 0, width: 24, height: 5 },
    availableSpace: { width: 24, height: 5 },
  };

  const layoutTree = engine.calculateLayout(container, context);

  assertEquals(layoutTree.children.length, 3);

  // With space-evenly, space is distributed evenly
  // 24 - 12 = 12 remaining, divided into 4 equal spaces = 3 each
  const x1 = layoutTree.children[0].bounds.x;
  const x2 = layoutTree.children[1].bounds.x;
  const x3 = layoutTree.children[2].bounds.x;

  // First item should start after first space
  assert(x1 > 0, 'First item should have space before it');

  // Items should be evenly spaced
  const gap1to2 = x2 - (x1 + 4);
  const gap2to3 = x3 - (x2 + 4);
  assert(Math.abs(gap1to2 - gap2to3) <= 1, 'Gaps should be approximately equal');
});

Deno.test('Flexbox max-width constrains nested children', () => {
  const engine = new LayoutEngine();

  // Create a nested container where the inner content is wider than max-width
  // This tests that max-width properly constrains the available space for children
  const innerChild1 = new TextElement({ text: 'A', style: { width: 20 } });
  const innerChild2 = new TextElement({ text: 'B', style: { width: 20 } });
  const innerChild3 = new TextElement({ text: 'C', style: { width: 20 } });

  // Inner container with flex-wrap - total content width is 60 (20*3)
  const innerContainer = new ContainerElement({
    height: 5,
    style: {
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap'
    }
  }, [innerChild1, innerChild2, innerChild3]);

  // Outer container with max-width=50 - should constrain inner to 50
  const outerContainer = new ContainerElement({
    style: {
      display: 'flex',
      flexDirection: 'column',
      maxWidth: 50
    }
  }, [innerContainer]);

  // Root with full width
  const root = new ContainerElement({
    width: 100,
    height: 20,
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, [outerContainer]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 100, height: 20 },
    parentBounds: { x: 0, y: 0, width: 100, height: 20 },
    availableSpace: { width: 100, height: 20 },
  };

  const layoutTree = engine.calculateLayout(root, context);

  // Find the outer container (first child of root)
  const outerNode = layoutTree.children[0];

  // Outer container should be constrained to max-width of 50
  assert(outerNode.bounds.width <= 50,
    `Outer container width should be <= 50 (max-width), got ${outerNode.bounds.width}`);

  // Inner container should also be constrained to the outer's width
  const innerNode = outerNode.children[0];
  assert(innerNode.bounds.width <= 50,
    `Inner container width should be <= 50, got ${innerNode.bounds.width}`);

  // With width 50 and items of width 20, only 2 items fit per line
  // So the third item should wrap to a second line
  const child1Y = innerNode.children[0].bounds.y;
  const child2Y = innerNode.children[1].bounds.y;
  const child3Y = innerNode.children[2].bounds.y;

  // First two items should be on same line
  assertEquals(child1Y, child2Y, 'First two items should be on same line');

  // Third item should be on a different line (wrapped)
  assert(child3Y > child1Y,
    `Third item should wrap to next line (y=${child3Y} should be > ${child1Y})`);
});

Deno.test('Flexbox stretch respects container bounds', () => {
  const engine = new LayoutEngine();

  // Create a container where children would stretch beyond parent if not constrained
  const innerChild = new ContainerElement({
    height: 3,
    style: {
      display: 'flex',
      flexDirection: 'row'
    }
  }, [
    new TextElement({ text: 'Wide content here', style: { width: 80 } })
  ]);

  // Outer container with max-width - inner should stretch to this, not beyond
  const outerContainer = new ContainerElement({
    style: {
      display: 'flex',
      flexDirection: 'column',
      maxWidth: 40
    }
  }, [innerChild]);

  const root = new ContainerElement({
    width: 100,
    height: 10,
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, [outerContainer]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 100, height: 10 },
    parentBounds: { x: 0, y: 0, width: 100, height: 10 },
    availableSpace: { width: 100, height: 10 },
  };

  const layoutTree = engine.calculateLayout(root, context);

  const outerNode = layoutTree.children[0];
  const innerNode = outerNode.children[0];

  // Outer should be constrained to max-width
  assert(outerNode.bounds.width <= 40,
    `Outer should respect max-width of 40, got ${outerNode.bounds.width}`);

  // Inner should stretch to outer's width, not beyond
  assert(innerNode.bounds.width <= outerNode.bounds.width,
    `Inner (${innerNode.bounds.width}) should not exceed outer (${outerNode.bounds.width})`);
});

// ===========================================================================
// Position: relative
// ===========================================================================

Deno.test('position relative - top/left offset in flex column', () => {
  const engine = new LayoutEngine();

  const child1 = new TextElement({ text: 'A', height: 3 });
  const child2 = new TextElement({
    text: 'B',
    height: 3,
    style: { position: 'relative', top: 5, left: 10 },
  });
  const child3 = new TextElement({ text: 'C', height: 3 });

  const root = new ContainerElement({
    width: 40, height: 30,
    style: { display: 'flex', flexDirection: 'column' },
  }, [child1, child2, child3]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 40, height: 30 },
    parentBounds: { x: 0, y: 0, width: 40, height: 30 },
    availableSpace: { width: 40, height: 30 },
  };

  const tree = engine.calculateLayout(root, context);
  const [n1, n2, n3] = tree.children;

  // child1: normal position
  assertEquals(n1.bounds.x, 0);
  assertEquals(n1.bounds.y, 0);

  // child2: offset by top:5, left:10 from its normal flow position (y=3)
  assertEquals(n2.bounds.x, 10);
  assertEquals(n2.bounds.y, 8); // 3 (normal) + 5 (top offset)

  // child3: should NOT be affected by child2's offset (relative preserves flow space)
  // In flex, child3 follows after child2's normal-flow slot
  assertEquals(n3.bounds.x, 0);
});

Deno.test('position relative - bottom/right offset in flex column', () => {
  const engine = new LayoutEngine();

  const child = new TextElement({
    text: 'X',
    height: 3,
    style: { position: 'relative', bottom: 2, right: 5 },
  });

  const root = new ContainerElement({
    width: 40, height: 20,
    style: { display: 'flex', flexDirection: 'column' },
  }, [child]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 40, height: 20 },
    parentBounds: { x: 0, y: 0, width: 40, height: 20 },
    availableSpace: { width: 40, height: 20 },
  };

  const tree = engine.calculateLayout(root, context);
  const node = tree.children[0];

  // bottom:2 means y shifts by -2, right:5 means x shifts by -5
  assertEquals(node.bounds.y, -2);
  assertEquals(node.bounds.x, -5);
});

Deno.test('position relative - top wins over bottom', () => {
  const engine = new LayoutEngine();

  const child = new TextElement({
    text: 'X',
    height: 3,
    style: { position: 'relative', top: 4, bottom: 99 },
  });

  const root = new ContainerElement({
    width: 40, height: 20,
    style: { display: 'flex', flexDirection: 'column' },
  }, [child]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 40, height: 20 },
    parentBounds: { x: 0, y: 0, width: 40, height: 20 },
    availableSpace: { width: 40, height: 20 },
  };

  const tree = engine.calculateLayout(root, context);
  // top takes precedence over bottom
  assertEquals(tree.children[0].bounds.y, 4);
});

Deno.test('position relative - left wins over right', () => {
  const engine = new LayoutEngine();

  const child = new TextElement({
    text: 'X',
    height: 3,
    style: { position: 'relative', left: 7, right: 99 },
  });

  const root = new ContainerElement({
    width: 40, height: 20,
    style: { display: 'flex', flexDirection: 'column' },
  }, [child]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 40, height: 20 },
    parentBounds: { x: 0, y: 0, width: 40, height: 20 },
    availableSpace: { width: 40, height: 20 },
  };

  const tree = engine.calculateLayout(root, context);
  // left takes precedence over right
  assertEquals(tree.children[0].bounds.x, 7);
});

Deno.test('position relative - offset in flex row', () => {
  const engine = new LayoutEngine();

  const child1 = new TextElement({ text: 'A', width: 10, height: 3 });
  const child2 = new TextElement({
    text: 'B',
    width: 10,
    height: 3,
    style: { position: 'relative', top: 3, left: 5 },
  });

  const root = new ContainerElement({
    width: 40, height: 20,
    style: { display: 'flex', flexDirection: 'row' },
  }, [child1, child2]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 40, height: 20 },
    parentBounds: { x: 0, y: 0, width: 40, height: 20 },
    availableSpace: { width: 40, height: 20 },
  };

  const tree = engine.calculateLayout(root, context);
  const [n1, n2] = tree.children;

  // child1: normal position
  assertEquals(n1.bounds.x, 0);
  assertEquals(n1.bounds.y, 0);

  // child2: offset from normal flow position (x=10 in row)
  assertEquals(n2.bounds.x, 15); // 10 (normal) + 5 (left offset)
  assertEquals(n2.bounds.y, 3);  // 0 (normal) + 3 (top offset)
});

Deno.test('position relative - no offset when position is static', () => {
  const engine = new LayoutEngine();

  const child = new TextElement({
    text: 'X',
    height: 3,
    style: { top: 10, left: 10 },
  });

  const root = new ContainerElement({
    width: 40, height: 20,
    style: { display: 'flex', flexDirection: 'column' },
  }, [child]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 40, height: 20 },
    parentBounds: { x: 0, y: 0, width: 40, height: 20 },
    availableSpace: { width: 40, height: 20 },
  };

  const tree = engine.calculateLayout(root, context);
  // Without position: relative, top/left are ignored
  assertEquals(tree.children[0].bounds.x, 0);
  assertEquals(tree.children[0].bounds.y, 0);
});

Deno.test('position relative - children inherit offset position', () => {
  const engine = new LayoutEngine();

  const inner = new TextElement({ text: 'inner', height: 2 });
  const outer = new ContainerElement({
    width: 20, height: 5,
    style: { position: 'relative', top: 10, left: 15, display: 'flex', flexDirection: 'column' },
  }, [inner]);

  const root = new ContainerElement({
    width: 40, height: 30,
    style: { display: 'flex', flexDirection: 'column' },
  }, [outer]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 40, height: 30 },
    parentBounds: { x: 0, y: 0, width: 40, height: 30 },
    availableSpace: { width: 40, height: 30 },
  };

  const tree = engine.calculateLayout(root, context);
  const outerNode = tree.children[0];
  const innerNode = outerNode.children[0];

  // Outer container is offset
  assertEquals(outerNode.bounds.x, 15);
  assertEquals(outerNode.bounds.y, 10);

  // Inner child inherits the offset position (laid out inside the offset parent)
  assertEquals(innerNode.bounds.x, 15);
  assertEquals(innerNode.bounds.y, 10);
});

Deno.test('position relative - preserves element size', () => {
  const engine = new LayoutEngine();

  const child = new TextElement({
    text: 'sized',
    width: 15,
    height: 4,
    style: { position: 'relative', top: 3, left: 7 },
  });

  const root = new ContainerElement({
    width: 40, height: 20,
    style: { display: 'flex', flexDirection: 'column' },
  }, [child]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 40, height: 20 },
    parentBounds: { x: 0, y: 0, width: 40, height: 20 },
    availableSpace: { width: 40, height: 20 },
  };

  const tree = engine.calculateLayout(root, context);
  const node = tree.children[0];

  // Size should not change due to relative offset
  assertEquals(node.bounds.width, 15);
  assertEquals(node.bounds.height, 4);
  // Position is offset
  assertEquals(node.bounds.x, 7);
  assertEquals(node.bounds.y, 3);
});

Deno.test('position relative - in block layout', () => {
  const engine = new LayoutEngine();

  const child1 = new TextElement({ text: 'A', height: 3 });
  const child2 = new TextElement({
    text: 'B',
    height: 3,
    style: { position: 'relative', top: 4, left: 8 },
  });

  const root = new ContainerElement({
    width: 40, height: 20,
    style: { display: 'block' },
  }, [child1, child2]);

  const context: LayoutContext = {
    viewport: { x: 0, y: 0, width: 40, height: 20 },
    parentBounds: { x: 0, y: 0, width: 40, height: 20 },
    availableSpace: { width: 40, height: 20 },
  };

  const tree = engine.calculateLayout(root, context);
  const [n1, n2] = tree.children;

  // child1: normal
  assertEquals(n1.bounds.x, 0);
  assertEquals(n1.bounds.y, 0);

  // child2: normal flow y=3, then offset by top:4, left:8
  assertEquals(n2.bounds.x, 8);
  assertEquals(n2.bounds.y, 7); // 3 + 4
});