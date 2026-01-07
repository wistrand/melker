// Tests for the Border-Box Sizing Model

import { assertEquals, assertNotEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  SizingModel,
  BoxModel,
  BoxDimensions,
  globalSizingModel,
  normalizeSpacing,
  addSpacing,
  spacingToString,
  Style,
  BoxSpacing,
  Size,
  Bounds,
} from '../mod.ts';

Deno.test('SizingModel creation with default border-box', () => {
  const model = new SizingModel();
  const boxModel = model.calculateBoxModel({ width: 100, height: 50 }, {});

  assertEquals(boxModel.content.width, 100);
  assertEquals(boxModel.content.height, 50);
  assertEquals(boxModel.total.width, 100);
  assertEquals(boxModel.total.height, 50);
});

Deno.test('SizingModel creation with content-box', () => {
  const model = new SizingModel('content-box');
  const boxModel = model.calculateBoxModel({ width: 100, height: 50 }, {});

  assertEquals(boxModel.content.width, 100);
  assertEquals(boxModel.content.height, 50);
  assertEquals(boxModel.total.width, 100);
  assertEquals(boxModel.total.height, 50);
});

Deno.test('Border-box sizing with padding', () => {
  const model = new SizingModel('border-box');
  const style: Style = {
    padding: 10,
    boxSizing: 'border-box',
  };

  const boxModel = model.calculateBoxModel({ width: 100, height: 50 }, style);

  // In border-box, content size is reduced by padding
  assertEquals(boxModel.content.width, 80); // 100 - (10*2)
  assertEquals(boxModel.content.height, 30); // 50 - (10*2)
  assertEquals(boxModel.total.width, 100);  // Requested size
  assertEquals(boxModel.total.height, 50);  // Requested size
  assertEquals(boxModel.padding.horizontal, 20);
  assertEquals(boxModel.padding.vertical, 20);
});

Deno.test('Content-box sizing with padding', () => {
  const model = new SizingModel('content-box');
  const style: Style = {
    padding: 10,
    boxSizing: 'content-box',
  };

  const boxModel = model.calculateBoxModel({ width: 100, height: 50 }, style);

  // In content-box, content size is preserved
  assertEquals(boxModel.content.width, 100);
  assertEquals(boxModel.content.height, 50);
  assertEquals(boxModel.total.width, 120); // 100 + (10*2)
  assertEquals(boxModel.total.height, 70); // 50 + (10*2)
});

Deno.test('Border-box sizing with border', () => {
  const model = new SizingModel('border-box');
  const style: Style = {
    border: 'thin',
    boxSizing: 'border-box',
  };

  const boxModel = model.calculateBoxModel({ width: 100, height: 50 }, style);

  // Border takes 1px on each side
  assertEquals(boxModel.content.width, 98); // 100 - (1*2)
  assertEquals(boxModel.content.height, 48); // 50 - (1*2)
  assertEquals(boxModel.total.width, 100);
  assertEquals(boxModel.total.height, 50);
  assertEquals(boxModel.border.horizontal, 2);
  assertEquals(boxModel.border.vertical, 2);
});

Deno.test('Border-box sizing with padding, border, and margin', () => {
  const model = new SizingModel('border-box');
  const style: Style = {
    padding: 5,
    border: 'thin',
    margin: 10,
    boxSizing: 'border-box',
  };

  const boxModel = model.calculateBoxModel({ width: 100, height: 50 }, style);

  // Content = requested - padding - border
  assertEquals(boxModel.content.width, 88); // 100 - (5*2) - (1*2)
  assertEquals(boxModel.content.height, 38); // 50 - (5*2) - (1*2)

  // Total includes margin
  assertEquals(boxModel.total.width, 120); // 100 + (10*2)
  assertEquals(boxModel.total.height, 70);  // 50 + (10*2)
});

Deno.test('Content-box sizing with padding, border, and margin', () => {
  const model = new SizingModel('content-box');
  const style: Style = {
    padding: 5,
    border: 'thin',
    margin: 10,
    boxSizing: 'content-box',
  };

  const boxModel = model.calculateBoxModel({ width: 100, height: 50 }, style);

  // Content size is preserved
  assertEquals(boxModel.content.width, 100);
  assertEquals(boxModel.content.height, 50);

  // Total = content + padding + border + margin
  assertEquals(boxModel.total.width, 132); // 100 + (5*2) + (1*2) + (10*2)
  assertEquals(boxModel.total.height, 82);  // 50 + (5*2) + (1*2) + (10*2)
});

Deno.test('BoxSpacing with individual values', () => {
  const model = new SizingModel('border-box');
  const style: Style = {
    padding: { top: 2, right: 4, bottom: 6, left: 8 },
    boxSizing: 'border-box',
  };

  const boxModel = model.calculateBoxModel({ width: 100, height: 50 }, style);

  assertEquals(boxModel.padding.top, 2);
  assertEquals(boxModel.padding.right, 4);
  assertEquals(boxModel.padding.bottom, 6);
  assertEquals(boxModel.padding.left, 8);
  assertEquals(boxModel.padding.horizontal, 12); // 8 + 4
  assertEquals(boxModel.padding.vertical, 8);    // 2 + 6

  // Content is reduced by padding
  assertEquals(boxModel.content.width, 88); // 100 - 12
  assertEquals(boxModel.content.height, 42); // 50 - 8
});

Deno.test('calculateContentBounds', () => {
  const model = new SizingModel('border-box');
  const elementBounds: Bounds = { x: 10, y: 20, width: 100, height: 60 };
  const style: Style = {
    margin: 5,  // Margin is OUTSIDE element bounds, not subtracted from content
    border: 'thin',
    padding: 3,
  };

  const contentBoundsResult = model.calculateContentBounds(elementBounds, style);

  // Content starts after border + padding (margin is OUTSIDE element bounds)
  assertEquals(contentBoundsResult.bounds.x, 14); // 10 + 1 + 3
  assertEquals(contentBoundsResult.bounds.y, 24); // 20 + 1 + 3

  // Content size is reduced by border + padding on both sides (NOT margin)
  const expectedWidth = 100 - (1*2) - (3*2); // 92
  const expectedHeight = 60 - (1*2) - (3*2); // 52
  assertEquals(contentBoundsResult.bounds.width, expectedWidth);
  assertEquals(contentBoundsResult.bounds.height, expectedHeight);
});

Deno.test('calculateElementBounds', () => {
  const model = new SizingModel('border-box');
  const contentSize: Size = { width: 80, height: 40 };
  const style: Style = {
    margin: 5,
    border: 'thin',
    padding: 3,
    boxSizing: 'border-box',
  };
  const position = { x: 10, y: 20 };

  const elementBounds = model.calculateElementBounds(contentSize, style, position);

  assertEquals(elementBounds.x, 10);
  assertEquals(elementBounds.y, 20);

  // In border-box, the contentSize becomes the border-box size
  // Total includes margin
  assertEquals(elementBounds.width, 90); // 80 + (5*2)
  assertEquals(elementBounds.height, 50); // 40 + (5*2)
});

Deno.test('calculateRequiredSize for border-box', () => {
  const model = new SizingModel('border-box');
  const contentSize: Size = { width: 80, height: 40 };
  const style: Style = {
    padding: 5,
    border: 'thin',
    boxSizing: 'border-box',
  };

  const requiredSize = model.calculateRequiredSize(contentSize, style);

  // Required size = content + padding + border
  assertEquals(requiredSize.width, 92); // 80 + (5*2) + (1*2)
  assertEquals(requiredSize.height, 52); // 40 + (5*2) + (1*2)
});

Deno.test('calculateRequiredSize for content-box', () => {
  const model = new SizingModel('content-box');
  const contentSize: Size = { width: 80, height: 40 };
  const style: Style = {
    padding: 5,
    border: 'thin',
    boxSizing: 'content-box',
  };

  const requiredSize = model.calculateRequiredSize(contentSize, style);

  // Content-box: required size = content size
  assertEquals(requiredSize.width, 80);
  assertEquals(requiredSize.height, 40);
});

Deno.test('calculateMinSize', () => {
  const model = new SizingModel();
  const style: Style = {
    margin: 5,
    border: 'thin',
    padding: 3,
  };

  const minSize = model.calculateMinSize(style);

  // Minimum size to accommodate margin + border + padding
  assertEquals(minSize.width, 18); // (5+1+3) * 2
  assertEquals(minSize.height, 18); // (5+1+3) * 2
});

Deno.test('constrainSize with min and max bounds', () => {
  const model = new SizingModel();
  const style: Style = {};

  const requestedSize: Size = { width: 100, height: 50 };
  const minSize: Size = { width: 80, height: 60 };
  const maxSize: Size = { width: 120, height: 40 };

  const constrainedSize = model.constrainSize(requestedSize, style, minSize, maxSize);

  // Width stays within bounds: max(80, min(100, 120)) = 100
  // Height constrained by min: max(60, min(50, 40)) = 60 (but then min with 40) = 40... wait
  assertEquals(constrainedSize.width, 100);
  assertEquals(constrainedSize.height, 40); // Constrained by max
});

Deno.test('normalizeSpacing utility', () => {
  const uniformSpacing = normalizeSpacing(5);
  assertEquals(uniformSpacing.top, 5);
  assertEquals(uniformSpacing.right, 5);
  assertEquals(uniformSpacing.bottom, 5);
  assertEquals(uniformSpacing.left, 5);

  const customSpacing = normalizeSpacing({ top: 1, right: 2, bottom: 3, left: 4 });
  assertEquals(customSpacing.top, 1);
  assertEquals(customSpacing.right, 2);
  assertEquals(customSpacing.bottom, 3);
  assertEquals(customSpacing.left, 4);

  const partialSpacing = normalizeSpacing({ top: 1, left: 3 });
  assertEquals(partialSpacing.top, 1);
  assertEquals(partialSpacing.right, 0);
  assertEquals(partialSpacing.bottom, 0);
  assertEquals(partialSpacing.left, 3);
});

Deno.test('addSpacing utility', () => {
  const a: BoxSpacing = { top: 1, right: 2, bottom: 3, left: 4 };
  const b: BoxSpacing = { top: 5, right: 6, bottom: 7, left: 8 };

  const sum = addSpacing(a, b);

  assertEquals(sum.top, 6);
  assertEquals(sum.right, 8);
  assertEquals(sum.bottom, 10);
  assertEquals(sum.left, 12);
});

Deno.test('spacingToString utility', () => {
  assertEquals(spacingToString({ top: 5, right: 5, bottom: 5, left: 5 }), '5');
  assertEquals(spacingToString({ top: 5, right: 10, bottom: 5, left: 10 }), '5 10');
  assertEquals(spacingToString({ top: 1, right: 2, bottom: 3, left: 4 }), '1 2 3 4');
});

Deno.test('Global sizing model default behavior', () => {
  const boxModel = globalSizingModel.calculateBoxModel({ width: 100, height: 50 }, {});

  // Global model uses border-box by default
  assertEquals(boxModel.content.width, 100);
  assertEquals(boxModel.content.height, 50);
  assertEquals(boxModel.total.width, 100);
  assertEquals(boxModel.total.height, 50);
});

Deno.test('Zero and negative size handling', () => {
  const model = new SizingModel('border-box');
  const style: Style = {
    padding: 20,
    border: 'thin',
    boxSizing: 'border-box',
  };

  // Request a size smaller than padding + border
  const boxModel = model.calculateBoxModel({ width: 10, height: 5 }, style);

  // Content size should not go negative
  assertEquals(boxModel.content.width, 0);
  assertEquals(boxModel.content.height, 0);
  assert(boxModel.total.width >= 0);
  assert(boxModel.total.height >= 0);
});

Deno.test('Border styles affect border dimensions', () => {
  const model = new SizingModel();

  const noBorderStyle: Style = { border: 'none' };
  const thinBorderStyle: Style = { border: 'thin' };
  const thickBorderStyle: Style = { border: 'thick' };

  const noBorder = model.calculateBoxModel({ width: 100, height: 50 }, noBorderStyle);
  const thinBorder = model.calculateBoxModel({ width: 100, height: 50 }, thinBorderStyle);
  const thickBorder = model.calculateBoxModel({ width: 100, height: 50 }, thickBorderStyle);

  assertEquals(noBorder.border.horizontal, 0);
  assertEquals(thinBorder.border.horizontal, 2); // 1px on each side
  assertEquals(thickBorder.border.horizontal, 2); // Same as thin in current implementation
});