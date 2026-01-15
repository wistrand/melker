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