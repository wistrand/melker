// Tests for lint schema validation - ensures lint schemas match types.ts definitions

import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { BASE_STYLES_SCHEMA, BASE_PROPS_SCHEMA } from '../src/lint.ts';

// Explicitly declared properties in the Style interface from types.ts
// This list must be kept in sync with the Style interface
// Note: Style has [key: string]: any so we use string[] instead of (keyof Style)[]
const STYLE_INTERFACE_PROPERTIES: string[] = [
  // Colors
  'color',
  'backgroundColor',
  'borderColor',

  // Font
  'fontWeight',

  // Border
  'border',
  'borderTop',
  'borderBottom',
  'borderLeft',
  'borderRight',

  // Spacing
  'padding',
  'margin',
  'marginBottom',

  // Layout
  'boxSizing',
  'textWrap',
  'display',
  'position',
  'overflow',
  'width',
  'height',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',

  // Flexbox
  'flex',
  'flexDirection',
  'flexWrap',
  'justifyContent',
  'alignItems',
  'alignContent',
  'alignSelf',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'gap',

  // Text
  'textAlign',
  'verticalAlign',
];

// Explicitly declared properties in LayoutProps interface from types.ts
const LAYOUT_PROPS_INTERFACE_PROPERTIES: string[] = [
  'width',
  'height',
  'display',
  'overflow',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'flexDirection',
  'justifyContent',
  'alignItems',
  'flexGrow',
  'flexShrink',
  'gap',
];

// Explicitly declared properties in BaseProps (excluding LayoutProps and EventHandlers)
const BASE_PROPS_INTERFACE_PROPERTIES: string[] = [
  'id',
  'class',
  'classList',
  'style',
  'tabIndex',
  'disabled',
];

// Event handler props
const EVENT_HANDLER_PROPS: string[] = [
  'onClick',
  'onKeyPress',
  'onFocus',
  'onBlur',
  'onChange',
];

Deno.test('BASE_STYLES_SCHEMA contains all Style interface properties', () => {
  const schemaKeys = Object.keys(BASE_STYLES_SCHEMA);
  const missingFromSchema: string[] = [];

  for (const prop of STYLE_INTERFACE_PROPERTIES) {
    if (!schemaKeys.includes(prop)) {
      missingFromSchema.push(prop);
    }
  }

  assertEquals(
    missingFromSchema,
    [],
    `Style interface properties missing from BASE_STYLES_SCHEMA: ${missingFromSchema.join(', ')}`
  );
});

Deno.test('BASE_PROPS_SCHEMA contains all BaseProps interface properties', () => {
  const schemaKeys = Object.keys(BASE_PROPS_SCHEMA);
  const missingFromSchema: string[] = [];

  // Check base props
  for (const prop of BASE_PROPS_INTERFACE_PROPERTIES) {
    if (!schemaKeys.includes(prop)) {
      missingFromSchema.push(prop);
    }
  }

  // Check event handlers
  for (const prop of EVENT_HANDLER_PROPS) {
    if (!schemaKeys.includes(prop)) {
      missingFromSchema.push(prop);
    }
  }

  assertEquals(
    missingFromSchema,
    [],
    `BaseProps interface properties missing from BASE_PROPS_SCHEMA: ${missingFromSchema.join(', ')}`
  );
});

Deno.test('BASE_STYLES_SCHEMA includes all LayoutProps that are style-related', () => {
  const schemaKeys = Object.keys(BASE_STYLES_SCHEMA);
  const missingFromSchema: string[] = [];

  for (const prop of LAYOUT_PROPS_INTERFACE_PROPERTIES) {
    if (!schemaKeys.includes(prop)) {
      missingFromSchema.push(prop);
    }
  }

  assertEquals(
    missingFromSchema,
    [],
    `LayoutProps properties missing from BASE_STYLES_SCHEMA: ${missingFromSchema.join(', ')}`
  );
});

Deno.test('gap property is in both Style interface and BASE_STYLES_SCHEMA', () => {
  // This was a specific fix - ensure it stays in sync
  assert(
    STYLE_INTERFACE_PROPERTIES.includes('gap'),
    'gap should be in Style interface properties list'
  );
  assert(
    'gap' in BASE_STYLES_SCHEMA,
    'gap should be in BASE_STYLES_SCHEMA'
  );
  assertEquals(
    BASE_STYLES_SCHEMA.gap.type,
    'number',
    'gap should have type number'
  );
});

Deno.test('flexbox properties are complete in BASE_STYLES_SCHEMA', () => {
  const flexboxProps = [
    'flex',
    'flexDirection',
    'flexWrap',
    'justifyContent',
    'alignItems',
    'alignContent',
    'alignSelf',
    'flexGrow',
    'flexShrink',
    'flexBasis',
    'gap',
  ];

  const schemaKeys = Object.keys(BASE_STYLES_SCHEMA);
  const missing = flexboxProps.filter(p => !schemaKeys.includes(p));

  assertEquals(
    missing,
    [],
    `Flexbox properties missing from BASE_STYLES_SCHEMA: ${missing.join(', ')}`
  );
});

Deno.test('positioning properties are complete in BASE_STYLES_SCHEMA', () => {
  const positioningProps = [
    'position',
    'top',
    'right',
    'bottom',
    'left',
    'zIndex',
  ];

  const schemaKeys = Object.keys(BASE_STYLES_SCHEMA);
  const missing = positioningProps.filter(p => !schemaKeys.includes(p));

  assertEquals(
    missing,
    [],
    `Positioning properties missing from BASE_STYLES_SCHEMA: ${missing.join(', ')}`
  );
});

Deno.test('border properties are complete in BASE_STYLES_SCHEMA', () => {
  const borderProps = [
    'border',
    'borderTop',
    'borderBottom',
    'borderLeft',
    'borderRight',
    'borderColor',
  ];

  const schemaKeys = Object.keys(BASE_STYLES_SCHEMA);
  const missing = borderProps.filter(p => !schemaKeys.includes(p));

  assertEquals(
    missing,
    [],
    `Border properties missing from BASE_STYLES_SCHEMA: ${missing.join(', ')}`
  );
});

Deno.test('text alignment properties are complete in BASE_STYLES_SCHEMA', () => {
  const textAlignProps = [
    'textAlign',
    'verticalAlign',
  ];

  const schemaKeys = Object.keys(BASE_STYLES_SCHEMA);
  const missing = textAlignProps.filter(p => !schemaKeys.includes(p));

  assertEquals(
    missing,
    [],
    `Text alignment properties missing from BASE_STYLES_SCHEMA: ${missing.join(', ')}`
  );
});

Deno.test('BASE_STYLES_SCHEMA enum values are valid for flexDirection', () => {
  const schema = BASE_STYLES_SCHEMA.flexDirection;
  assert(schema, 'flexDirection should exist in schema');
  assert(schema.enum, 'flexDirection should have enum values');

  const expectedValues = ['row', 'column', 'row-reverse', 'column-reverse'];
  assertEquals(
    schema.enum.sort(),
    expectedValues.sort(),
    'flexDirection enum values should match Style interface type'
  );
});

Deno.test('BASE_STYLES_SCHEMA enum values are valid for justifyContent', () => {
  const schema = BASE_STYLES_SCHEMA.justifyContent;
  assert(schema, 'justifyContent should exist in schema');
  assert(schema.enum, 'justifyContent should have enum values');

  const expectedValues = ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly'];
  assertEquals(
    schema.enum.sort(),
    expectedValues.sort(),
    'justifyContent enum values should match Style interface type'
  );
});

Deno.test('BASE_STYLES_SCHEMA enum values are valid for alignItems', () => {
  const schema = BASE_STYLES_SCHEMA.alignItems;
  assert(schema, 'alignItems should exist in schema');
  assert(schema.enum, 'alignItems should have enum values');

  const expectedValues = ['flex-start', 'flex-end', 'center', 'stretch', 'baseline'];
  assertEquals(
    schema.enum.sort(),
    expectedValues.sort(),
    'alignItems enum values should match Style interface type'
  );
});

Deno.test('BASE_STYLES_SCHEMA enum values are valid for display', () => {
  const schema = BASE_STYLES_SCHEMA.display;
  assert(schema, 'display should exist in schema');
  assert(schema.enum, 'display should have enum values');

  const expectedValues = ['block', 'flex'];
  assertEquals(
    schema.enum.sort(),
    expectedValues.sort(),
    'display enum values should match Style interface type'
  );
});

Deno.test('BASE_STYLES_SCHEMA enum values are valid for position', () => {
  const schema = BASE_STYLES_SCHEMA.position;
  assert(schema, 'position should exist in schema');
  assert(schema.enum, 'position should have enum values');

  const expectedValues = ['static', 'relative', 'absolute', 'fixed'];
  assertEquals(
    schema.enum.sort(),
    expectedValues.sort(),
    'position enum values should match Style interface type'
  );
});

Deno.test('BASE_STYLES_SCHEMA enum values are valid for overflow', () => {
  const schema = BASE_STYLES_SCHEMA.overflow;
  assert(schema, 'overflow should exist in schema');
  assert(schema.enum, 'overflow should have enum values');

  const expectedValues = ['visible', 'hidden', 'scroll'];
  assertEquals(
    schema.enum.sort(),
    expectedValues.sort(),
    'overflow enum values should match Style interface type'
  );
});

Deno.test('BASE_STYLES_SCHEMA enum values are valid for border styles', () => {
  const borderProps = ['border', 'borderTop', 'borderBottom', 'borderLeft', 'borderRight'];
  const expectedValues = ['none', 'thin', 'thick', 'double', 'rounded', 'dashed', 'dashed-rounded', 'ascii', 'ascii-rounded'];

  for (const prop of borderProps) {
    const schema = BASE_STYLES_SCHEMA[prop];
    assert(schema, `${prop} should exist in schema`);
    assert(schema.enum, `${prop} should have enum values`);
    assertEquals(
      schema.enum.sort(),
      expectedValues.sort(),
      `${prop} enum values should match Style interface type`
    );
  }
});
