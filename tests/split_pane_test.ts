// Tests for split-pane component

import { assertEquals, assertExists, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  RenderingEngine,
  DualBuffer,
  ContainerElement,
  TextElement,
  Element,
  Bounds,
  isFocusable,
  isDraggable,
  isInteractive,
  isRenderable,
} from '../mod.ts';
import { SplitPaneElement, SplitPaneDivider, SplitPaneProps } from '../src/components/split-pane.ts';

// --- Construction tests ---

Deno.test('SplitPaneElement can be instantiated with defaults', () => {
  const pane = new SplitPaneElement({}, [
    new ContainerElement(),
    new ContainerElement(),
  ]);

  assertExists(pane);
  assertEquals(pane.type, 'split-pane');
  // Accessors provide defaults when style properties are absent
  assertEquals(pane._getDirection(), 'horizontal');
  assertEquals(pane._getMinPaneSize(), 3);
});

Deno.test('SplitPaneElement creates N-1 dividers for N children', () => {
  const children = [
    new ContainerElement(),
    new ContainerElement(),
    new ContainerElement(),
  ];
  const pane = new SplitPaneElement({}, children);

  // children = [pane0, div0, pane1, div1, pane2] = 5
  assertEquals(pane.children?.length, 5);

  // Check dividers are at odd indices
  assertEquals(pane.children![1].type, 'split-pane-divider');
  assertEquals(pane.children![3].type, 'split-pane-divider');
});

Deno.test('SplitPaneElement with 1 child creates no dividers', () => {
  const pane = new SplitPaneElement({}, [new ContainerElement()]);

  assertEquals(pane.children?.length, 1);
  assertEquals(pane.children![0].type, 'container');
});

Deno.test('SplitPaneElement with 0 children creates empty', () => {
  const pane = new SplitPaneElement({}, []);

  assertEquals(pane.children?.length, 0);
});

Deno.test('SplitPaneElement sets direction via style accessor', () => {
  const hPane = new SplitPaneElement({ style: { direction: 'horizontal' } }, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  assertEquals(hPane._getDirection(), 'horizontal');

  const vPane = new SplitPaneElement({ style: { direction: 'vertical' } }, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  assertEquals(vPane._getDirection(), 'vertical');
});

Deno.test('SplitPaneElement defaults to display flex', () => {
  const pane = new SplitPaneElement({}, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  assertEquals(pane.props.style?.display, 'flex');
});

// --- Direction via style ---

Deno.test('SplitPaneElement direction via style is readable by accessor', () => {
  const pane = new SplitPaneElement(
    { style: { direction: 'vertical' } },
    [new ContainerElement(), new ContainerElement()],
  );
  assertEquals(pane.props.style?.direction, 'vertical');
  assertEquals(pane._getDirection(), 'vertical');
});

Deno.test('SplitPaneElement defaults direction to horizontal when not set', () => {
  const pane = new SplitPaneElement(
    {},
    [new ContainerElement(), new ContainerElement()],
  );
  assertEquals(pane._getDirection(), 'horizontal');
});

// --- minPaneSize via style ---

Deno.test('SplitPaneElement minPaneSize via style', () => {
  const pane = new SplitPaneElement(
    { style: { minPaneSize: 10 } },
    [new ContainerElement(), new ContainerElement()],
  );
  assertEquals(pane._getMinPaneSize(), 10);
});

Deno.test('SplitPaneElement defaults minPaneSize to 3 via accessor', () => {
  const pane = new SplitPaneElement(
    {},
    [new ContainerElement(), new ContainerElement()],
  );
  assertEquals(pane._getMinPaneSize(), 3);
});

Deno.test('SplitPaneElement default minPaneSize is 3', () => {
  const pane = new SplitPaneElement({}, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  assertEquals(pane._getMinPaneSize(), 3);
});

// --- Sizes parsing ---

Deno.test('SplitPaneElement parses comma-separated sizes', () => {
  const children = [
    new ContainerElement(),
    new ContainerElement(),
    new ContainerElement(),
  ];
  const pane = new SplitPaneElement({ sizes: '1,2,1' }, children);

  // Check pane flex properties are set proportionally
  // sizes normalized: [0.25, 0.5, 0.25]
  const pane0 = pane.children![0];
  const pane1 = pane.children![2];
  const pane2 = pane.children![4];

  assertEquals(pane0.props.style?.flexGrow, 0.25);
  assertEquals(pane1.props.style?.flexGrow, 0.5);
  assertEquals(pane2.props.style?.flexGrow, 0.25);
});

Deno.test('SplitPaneElement falls back to equal sizes on mismatch', () => {
  const children = [
    new ContainerElement(),
    new ContainerElement(),
  ];
  // 3 sizes for 2 children
  const pane = new SplitPaneElement({ sizes: '1,2,3' }, children);

  const pane0 = pane.children![0];
  const pane1 = pane.children![2];

  assertEquals(pane0.props.style?.flexGrow, 0.5);
  assertEquals(pane1.props.style?.flexGrow, 0.5);
});

Deno.test('SplitPaneElement falls back to equal sizes when no sizes given', () => {
  const children = [
    new ContainerElement(),
    new ContainerElement(),
    new ContainerElement(),
  ];
  const pane = new SplitPaneElement({}, children);

  const pane0 = pane.children![0];
  const pane1 = pane.children![2];
  const pane2 = pane.children![4];

  const expected = 1 / 3;
  assertAlmostEquals(pane0.props.style?.flexGrow, expected);
  assertAlmostEquals(pane1.props.style?.flexGrow, expected);
  assertAlmostEquals(pane2.props.style?.flexGrow, expected);
});

Deno.test('SplitPaneElement accepts array sizes from programmatic API', () => {
  const children = [
    new ContainerElement(),
    new ContainerElement(),
  ];
  const pane = new SplitPaneElement({ sizes: [3, 1] as any }, children);

  const pane0 = pane.children![0];
  const pane1 = pane.children![2];

  assertEquals(pane0.props.style?.flexGrow, 0.75);
  assertEquals(pane1.props.style?.flexGrow, 0.25);
});

// --- Divider flex properties ---

Deno.test('Horizontal dividers have width: 1, no flex grow', () => {
  const pane = new SplitPaneElement({ style: { direction: 'horizontal' } }, [
    new ContainerElement(),
    new ContainerElement(),
  ]);

  const divider = pane.children![1];
  assertEquals(divider.props.style?.width, 1);
  assertEquals(divider.props.style?.flexGrow, 0);
  assertEquals(divider.props.style?.flexShrink, 0);
});

Deno.test('Vertical dividers have height: 1, no flex grow', () => {
  const pane = new SplitPaneElement({ style: { direction: 'vertical' } }, [
    new ContainerElement(),
    new ContainerElement(),
  ]);

  const divider = pane.children![1];
  assertEquals(divider.props.style?.height, 1);
  assertEquals(divider.props.style?.flexGrow, 0);
  assertEquals(divider.props.style?.flexShrink, 0);
});

// --- Divider titles ---

Deno.test('SplitPaneElement parses dividerTitles', () => {
  const pane = new SplitPaneElement(
    { dividerTitles: 'Nav,Info' },
    [new ContainerElement(), new ContainerElement(), new ContainerElement()],
  );

  const div0 = pane.children![1] as SplitPaneDivider;
  const div1 = pane.children![3] as SplitPaneDivider;

  // Title is stored in props.label (inherited from SeparatorElement)
  assertEquals(div0.props.label, 'Nav');
  assertEquals(div1.props.label, 'Info');
});

Deno.test('SplitPaneElement handles missing dividerTitles gracefully', () => {
  const pane = new SplitPaneElement(
    {},
    [new ContainerElement(), new ContainerElement()],
  );

  const div0 = pane.children![1] as SplitPaneDivider;
  assertEquals(div0.props.label, undefined);
});

// --- Divider interface implementations ---

Deno.test('SplitPaneDivider implements Focusable', () => {
  const pane = new SplitPaneElement({}, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  const divider = pane.children![1];

  assert(isFocusable(divider));
  assertEquals((divider as any).canReceiveFocus(), true);
});

Deno.test('SplitPaneDivider implements Draggable', () => {
  const pane = new SplitPaneElement({}, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  const divider = pane.children![1];

  assert(isDraggable(divider));
});

Deno.test('SplitPaneDivider implements Interactive', () => {
  const pane = new SplitPaneElement({}, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  const divider = pane.children![1];

  assert(isInteractive(divider));
  assertEquals((divider as any).isInteractive(), true);
});

Deno.test('SplitPaneDivider implements Renderable', () => {
  const pane = new SplitPaneElement({}, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  const divider = pane.children![1];

  assert(isRenderable(divider));
});

// --- Intrinsic size ---

Deno.test('SplitPaneElement intrinsicSize for horizontal', () => {
  const pane = new SplitPaneElement({ style: { direction: 'horizontal', minPaneSize: 5 } }, [
    new ContainerElement(),
    new ContainerElement(),
    new ContainerElement(),
  ]);

  const size = pane.intrinsicSize({ availableSpace: { width: 100, height: 50 } });
  // 3 panes * 5 chars + 2 dividers = 17
  assertEquals(size.width, 17);
  assertEquals(size.height, 1);
});

Deno.test('SplitPaneElement intrinsicSize for vertical', () => {
  const pane = new SplitPaneElement({ style: { direction: 'vertical', minPaneSize: 4 } }, [
    new ContainerElement(),
    new ContainerElement(),
  ]);

  const size = pane.intrinsicSize({ availableSpace: { width: 100, height: 50 } });
  // 2 panes * 4 chars + 1 divider = 9
  assertEquals(size.width, 4);
  assertEquals(size.height, 9);
});

Deno.test('SplitPaneElement intrinsicSize for 0 children', () => {
  const pane = new SplitPaneElement({}, []);

  const size = pane.intrinsicSize({ availableSpace: { width: 100, height: 50 } });
  assertEquals(size.width, 0);
  assertEquals(size.height, 0);
});

Deno.test('SplitPaneDivider intrinsicSize horizontal', () => {
  const pane = new SplitPaneElement({ style: { direction: 'horizontal' } }, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  const divider = pane.children![1] as SplitPaneDivider;

  // SeparatorElement.intrinsicSize reads orientation from parentStyle.flexDirection
  const size = divider.intrinsicSize({ availableSpace: { width: 100, height: 50 }, parentStyle: { flexDirection: 'row' } });
  assertEquals(size.width, 1);
  assertEquals(size.height, 0);
});

Deno.test('SplitPaneDivider intrinsicSize vertical', () => {
  const pane = new SplitPaneElement({ style: { direction: 'vertical' } }, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  const divider = pane.children![1] as SplitPaneDivider;

  const size = divider.intrinsicSize({ availableSpace: { width: 100, height: 50 }, parentStyle: { flexDirection: 'column' } });
  assertEquals(size.width, 0);
  assertEquals(size.height, 1);
});

// --- Keyboard handling ---

Deno.test('SplitPaneDivider handles ArrowLeft/Right for horizontal', () => {
  const pane = new SplitPaneElement({ style: { direction: 'horizontal' } }, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  const divider = pane.children![1] as SplitPaneDivider;

  // Need bounds for keyboard move to work
  pane.setBounds({ x: 0, y: 0, width: 40, height: 10 });
  (pane as any)._lastBounds = { x: 0, y: 0, width: 40, height: 10 };

  const initialLeft = pane.children![0].props.style?.flexGrow;

  const handled = divider.handleKeyInput('ArrowRight');
  assertEquals(handled, true);

  // Left pane should have grown
  assert(pane.children![0].props.style?.flexGrow > initialLeft);
});

Deno.test('SplitPaneDivider handles ArrowUp/Down for vertical', () => {
  const pane = new SplitPaneElement({ style: { direction: 'vertical' } }, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  const divider = pane.children![1] as SplitPaneDivider;

  (pane as any)._lastBounds = { x: 0, y: 0, width: 40, height: 20 };

  const initialTop = pane.children![0].props.style?.flexGrow;

  const handled = divider.handleKeyInput('ArrowDown');
  assertEquals(handled, true);

  assert(pane.children![0].props.style?.flexGrow > initialTop);
});

Deno.test('SplitPaneDivider ignores irrelevant keys', () => {
  const pane = new SplitPaneElement({ style: { direction: 'horizontal' } }, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  const divider = pane.children![1] as SplitPaneDivider;

  assertEquals(divider.handleKeyInput('Enter'), false);
  assertEquals(divider.handleKeyInput('ArrowUp'), false);  // wrong axis
  assertEquals(divider.handleKeyInput('ArrowDown'), false); // wrong axis
});

Deno.test('Vertical divider ignores horizontal keys', () => {
  const pane = new SplitPaneElement({ style: { direction: 'vertical' } }, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  const divider = pane.children![1] as SplitPaneDivider;

  assertEquals(divider.handleKeyInput('ArrowLeft'), false);
  assertEquals(divider.handleKeyInput('ArrowRight'), false);
});

// --- Keyboard enforces minPaneSize ---

Deno.test('Keyboard move respects minPaneSize from style', () => {
  const pane = new SplitPaneElement({ style: { direction: 'horizontal', minPaneSize: 10 } }, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  const divider = pane.children![1] as SplitPaneDivider;

  // Total width 21 (20 for panes + 1 divider), minPaneSize 10 each
  // So divider can't move at all
  (pane as any)._lastBounds = { x: 0, y: 0, width: 21, height: 10 };

  const handled = divider.handleKeyInput('ArrowLeft');
  assertEquals(handled, false);
});

// --- Drag handling ---

Deno.test('SplitPaneDivider getDragZone returns null without bounds', () => {
  const pane = new SplitPaneElement({}, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  const divider = pane.children![1] as SplitPaneDivider;

  assertEquals(divider.getDragZone(5, 5), null);
});

Deno.test('SplitPaneDivider getDragZone returns divider when in bounds', () => {
  const pane = new SplitPaneElement({}, [
    new ContainerElement(),
    new ContainerElement(),
  ]);
  const divider = pane.children![1] as SplitPaneDivider;

  // Simulate bounds being set during render
  (divider as any)._lastBounds = { x: 10, y: 0, width: 1, height: 20 };

  assertEquals(divider.getDragZone(10, 5), 'divider');
  assertEquals(divider.getDragZone(9, 5), null);
  assertEquals(divider.getDragZone(11, 5), null);
});

Deno.test('SplitPaneDivider drag updates pane sizes', () => {
  const pane = new SplitPaneElement({ style: { direction: 'horizontal' } }, [
    new ContainerElement(),
    new ContainerElement(),
  ]);

  (pane as any)._lastBounds = { x: 0, y: 0, width: 41, height: 10 };

  const initialLeft = pane.children![0].props.style?.flexGrow;

  // Drag divider to the right
  pane._handleDividerDrag(0, 30, 5);

  assert(pane.children![0].props.style?.flexGrow > initialLeft);
});

// --- onResize callback ---

Deno.test('onResize fires on keyboard move', () => {
  let resizeEvent: any = null;

  const pane = new SplitPaneElement(
    {
      style: { direction: 'horizontal' },
      onResize: (event) => { resizeEvent = event; },
    },
    [new ContainerElement(), new ContainerElement()],
  );
  const divider = pane.children![1] as SplitPaneDivider;

  (pane as any)._lastBounds = { x: 0, y: 0, width: 40, height: 10 };

  divider.handleKeyInput('ArrowRight');

  assertExists(resizeEvent);
  assertEquals(resizeEvent.type, 'resize');
  assertEquals(resizeEvent.dividerIndex, 0);
  assertEquals(resizeEvent.sizes.length, 2);
  assertAlmostEquals(resizeEvent.sizes[0] + resizeEvent.sizes[1], 1.0);
});

Deno.test('onResize fires on drag', () => {
  let resizeEvent: any = null;

  const pane = new SplitPaneElement(
    {
      style: { direction: 'horizontal' },
      onResize: (event) => { resizeEvent = event; },
    },
    [new ContainerElement(), new ContainerElement()],
  );

  (pane as any)._lastBounds = { x: 0, y: 0, width: 41, height: 10 };

  pane._handleDividerDrag(0, 25, 5);

  assertExists(resizeEvent);
  assertEquals(resizeEvent.type, 'resize');
  assertEquals(resizeEvent.dividerIndex, 0);
});

// --- Validation ---

Deno.test('SplitPaneElement.validate accepts valid props', () => {
  assertEquals(SplitPaneElement.validate({}), true);
});

Deno.test('SplitPaneElement.validate accepts valid style values', () => {
  assertEquals(SplitPaneElement.validate({ style: { direction: 'horizontal' } }), true);
  assertEquals(SplitPaneElement.validate({ style: { direction: 'vertical' } }), true);
  assertEquals(SplitPaneElement.validate({ style: { minPaneSize: 5 } }), true);
});

Deno.test('SplitPaneElement.validate rejects invalid style values', () => {
  assertEquals(SplitPaneElement.validate({ style: { direction: 'diagonal' as any } }), false);
  assertEquals(SplitPaneElement.validate({ style: { minPaneSize: 0 } }), false);
  assertEquals(SplitPaneElement.validate({ style: { minPaneSize: -1 } }), false);
});

// --- Rendering ---

Deno.test('SplitPaneElement renders horizontal split with divider', () => {
  const engine = new RenderingEngine();

  const left = new ContainerElement({}, [new TextElement({ text: 'L' })]);
  const right = new ContainerElement({}, [new TextElement({ text: 'R' })]);
  const pane = new SplitPaneElement(
    { style: { direction: 'horizontal', width: 21, height: 3 } },
    [left, right],
  );

  const result = engine.renderElement(pane, 21, 3);
  const lines = result.split('\n');

  // There should be a vertical divider character somewhere in the middle
  let foundDivider = false;
  for (const line of lines) {
    if (line.includes('\u2502') || line.includes('|')) {
      foundDivider = true;
      break;
    }
  }
  assert(foundDivider, 'Expected to find a vertical divider character');
});

Deno.test('SplitPaneElement renders vertical split with divider', () => {
  const engine = new RenderingEngine();

  const top = new ContainerElement({}, [new TextElement({ text: 'T' })]);
  const bottom = new ContainerElement({}, [new TextElement({ text: 'B' })]);
  const pane = new SplitPaneElement(
    { style: { direction: 'vertical', width: 10, height: 7 } },
    [top, bottom],
  );

  const result = engine.renderElement(pane, 10, 7);
  const lines = result.split('\n');

  // There should be a horizontal divider line
  let foundDivider = false;
  for (const line of lines) {
    if (line.includes('\u2500') || line.includes('-')) {
      foundDivider = true;
      break;
    }
  }
  assert(foundDivider, 'Expected to find a horizontal divider character');
});

// --- Helper ---

function assertAlmostEquals(actual: number, expected: number, epsilon: number = 0.001): void {
  assert(
    Math.abs(actual - expected) < epsilon,
    `Expected ${actual} to be approximately ${expected} (epsilon: ${epsilon})`,
  );
}
