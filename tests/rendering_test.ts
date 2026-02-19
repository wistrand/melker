// Tests for the basic rendering engine

import { assertEquals, assert } from 'jsr:@std/assert';
import {
  RenderingEngine,
  LayoutNode,
  DualBuffer,
  ContainerElement,
  TextElement,
  Element,
  Bounds,
} from '../mod.ts';
import { COLORS } from '../src/components/color-utils.ts';

Deno.test('RenderingEngine creation', () => {
  const engine = new RenderingEngine();
  assert(engine);
});

Deno.test('Simple text rendering', () => {
  const engine = new RenderingEngine();
  const textElement = new TextElement({ text: 'Hello World' });

  const result = engine.renderElement(textElement, 20, 5);
  const lines = result.split('\n');

  assertEquals(lines[0], 'Hello World         ');
  assertEquals(lines.length, 5);
});

Deno.test('Text with styling', () => {
  const engine = new RenderingEngine();
  const textElement = new TextElement({
    text: 'Styled',
    style: {
      color: COLORS.red,
      fontWeight: 'bold',
    }
  });

  const buffer = new DualBuffer(10, 3);
  const viewport: Bounds = { x: 0, y: 0, width: 10, height: 3 };

  engine.render(textElement, buffer, viewport);
  const diff = buffer.swapAndGetDiff();

  // With flex default, text element stretches to fill viewport (10x3=30 cells)
  assertEquals(diff.length, 30);
  assertEquals(diff[0].cell.char, 'S');
  assertEquals(diff[0].cell.foreground, COLORS.red);
  assertEquals(diff[0].cell.bold, true);
});

Deno.test('Container with border', () => {
  const engine = new RenderingEngine();
  const container = new ContainerElement({
    width: 10,
    height: 5,
    style: {
      border: 'thin',
      borderColor: COLORS.blue,
    }
  });

  const result = engine.renderElement(container, 10, 5);
  const lines = result.split('\n');

  // Check border characters
  assertEquals(lines[0][0], '┌');
  assertEquals(lines[0][9], '┐');
  assertEquals(lines[4][0], '└');
  assertEquals(lines[4][9], '┘');
});

Deno.test('Container with text child', () => {
  const engine = new RenderingEngine();
  const textElement = new TextElement({ text: 'Child' });
  const container = new ContainerElement({
    width: 15,
    height: 5,
    style: { border: 'thin' }
  }, [textElement]);

  const result = engine.renderElement(container, 15, 5);
  const lines = result.split('\n');

  // Check that text appears inside border
  assertEquals(lines[1].substring(1, 6), 'Child');
});

Deno.test('Block layout with multiple children', () => {
  const engine = new RenderingEngine();

  const child1 = new TextElement({ text: 'First', height: 1 });
  const child2 = new TextElement({ text: 'Second', height: 1 });
  const child3 = new TextElement({ text: 'Third', height: 1 });

  const container = new ContainerElement({
    width: 10,
    height: 5,
    style: { display: 'block' }
  }, [child1, child2, child3]);

  const result = engine.renderElement(container, 10, 5);
  const lines = result.split('\n');

  assertEquals(lines[0].substring(0, 5), 'First');
  assertEquals(lines[1].substring(0, 6), 'Second');
  assertEquals(lines[2].substring(0, 5), 'Third');
});


Deno.test('Flex layout', () => {
  const engine = new RenderingEngine();

  const children = [
    new TextElement({ text: 'One' }),
    new TextElement({ text: 'Two' }),
    new TextElement({ text: 'Three' }),
  ];

  const container = new ContainerElement({
    width: 15,
    height: 3,
    style: { display: 'flex', flexDirection: 'row' }
  }, children);

  const buffer = new DualBuffer(15, 3);
  const viewport: Bounds = { x: 0, y: 0, width: 15, height: 3 };

  const layoutTree = engine.render(container, buffer, viewport);

  // Should have 3 child nodes
  assertEquals(layoutTree.children.length, 3);

  // Check horizontal positions (advanced layout distributes space naturally)
  assertEquals(layoutTree.children[0].bounds.x, 0);
  assertEquals(layoutTree.children[1].bounds.x, 3);
  assertEquals(layoutTree.children[2].bounds.x, 6);
  assertEquals(layoutTree.children[0].bounds.width, 3);
  assertEquals(layoutTree.children[1].bounds.width, 3);
  assertEquals(layoutTree.children[2].bounds.width, 5); // Remaining space
});

Deno.test('Text wrapping', () => {
  const engine = new RenderingEngine();
  const textElement = new TextElement({
    text: 'This is a very long text that should wrap across multiple lines',
    style: { textWrap: 'wrap' },
    width: 10,
    height: 5,
  });

  const result = engine.renderElement(textElement, 10, 5);
  const lines = result.split('\n');

  // Text should wrap to multiple lines
  assert(lines[0].trim().length > 0);
  assert(lines[1].trim().length > 0);
  assert(lines[2].trim().length > 0);
});

Deno.test('Auto width calculation', () => {
  const engine = new RenderingEngine();
  const textElement = new TextElement({
    text: 'Test',
    width: 'auto',
  });

  const buffer = new DualBuffer(20, 5);
  const viewport: Bounds = { x: 0, y: 0, width: 20, height: 5 };

  const layoutTree = engine.render(textElement, buffer, viewport);

  // Width should match text length
  assertEquals(layoutTree.bounds.width, 4);
});

Deno.test('Fill width behavior', () => {
  const engine = new RenderingEngine();
  const textElement = new TextElement({
    text: 'Fill',
    width: 'fill',
  });

  const buffer = new DualBuffer(20, 5);
  const viewport: Bounds = { x: 0, y: 0, width: 20, height: 5 };

  const layoutTree = engine.render(textElement, buffer, viewport);

  // Width should fill parent
  assertEquals(layoutTree.bounds.width, 20);
});

Deno.test('Padding and margin', () => {
  const engine = new RenderingEngine();
  const textElement = new TextElement({
    text: 'Test',
    style: {
      margin: 2,
      padding: 1,
      border: 'thin',
    }
  });

  const buffer = new DualBuffer(20, 10);
  const viewport: Bounds = { x: 0, y: 0, width: 20, height: 10 };

  const layoutTree = engine.render(textElement, buffer, viewport);

  // With flex default, element stretches to fill viewport
  assertEquals(layoutTree.bounds.x, 0);
  assertEquals(layoutTree.bounds.y, 0);
  assertEquals(layoutTree.bounds.width, 20); // Flex stretches to viewport width
  assertEquals(layoutTree.bounds.height, 10); // Flex stretches to viewport height
});

Deno.test('Nested containers', () => {
  const engine = new RenderingEngine();

  const innerText = new TextElement({ text: 'Inner' });
  const innerContainer = new ContainerElement({
    style: { border: 'thin' }
  }, [innerText]);

  const outerContainer = new ContainerElement({
    width: 15,
    height: 8,
    style: { border: 'thick' }
  }, [innerContainer]);

  const buffer = new DualBuffer(15, 8);
  const viewport: Bounds = { x: 0, y: 0, width: 15, height: 8 };

  const layoutTree = engine.render(outerContainer, buffer, viewport);

  // Should have nested structure
  assertEquals(layoutTree.children.length, 1);
  assertEquals(layoutTree.children[0].children.length, 1);
  assertEquals(layoutTree.children[0].children[0].element.type, 'text');
});

Deno.test('Clipping bounds', () => {
  const engine = new RenderingEngine();

  // Text that's too large for container
  const textElement = new TextElement({
    text: 'This text is way too long for the small container',
    width: 50,
  });

  const container = new ContainerElement({
    width: 10,
    height: 3,
  }, [textElement]);

  const result = engine.renderElement(container, 10, 3);
  const lines = result.split('\n');

  // Text should be clipped to container size
  assertEquals(lines[0].length, 10);
  assert(lines[0].includes('This text'));
});