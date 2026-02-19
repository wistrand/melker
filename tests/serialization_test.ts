// Tests for serialization functionality

import { assertEquals, assertThrows } from 'jsr:@std/assert';
import {
  createElement,
  elementToJson,
  elementFromJson,
  serializeElement,
  deserializeElement,
  validateSerializedElement,
} from '../mod.ts';
import { ContainerElement } from '../src/components/container.ts';
import { TextElement } from '../src/components/text.ts';
import { ButtonElement } from '../src/components/button.ts';

Deno.test('serializeElement creates correct structure', () => {
  const child = new TextElement({ text: 'Hello World', id: 'text1' });
  const element = new ContainerElement({ id: 'container1', width: 100 }, [child]);

  const serialized = serializeElement(element);

  assertEquals(serialized.type, 'container');
  assertEquals(serialized.id, 'container1');
  assertEquals(serialized.props.width, 100);
  assertEquals(serialized.children?.length || 0, 1);
  assertEquals(serialized.children?.[0]?.type, 'text');
  assertEquals(serialized.children?.[0]?.props.text, 'Hello World');
});

Deno.test('deserializeElement recreates correct structure', () => {
  const serialized = {
    type: 'container',
    id: 'test-container',
    props: { width: 200, height: 150 },
    children: [{
      type: 'text',
      id: 'test-text',
      props: { text: 'Test content', style: { textWrap: 'wrap' } },
      children: []
    }]
  };

  const element = deserializeElement(serialized);

  assertEquals(element.type, 'container');
  assertEquals(element.id, 'test-container');
  assertEquals(element.props.width, 200);
  assertEquals(element.props.height, 150);
  assertEquals(element.children?.length || 0, 1);
  assertEquals(element.children?.[0]?.type, 'text');
  assertEquals(element.children?.[0]?.props.text, 'Test content');
  assertEquals(element.children?.[0]?.props.style?.textWrap, 'wrap');
});

Deno.test('elementToJson converts element to JSON string', () => {
  const button = new ButtonElement({ label: 'Click me', id: 'btn1' });
  const json = elementToJson(button);

  const parsed = JSON.parse(json);
  assertEquals(parsed.type, 'button');
  assertEquals(parsed.id, 'btn1');
  assertEquals(parsed.props.label, 'Click me');
  assertEquals(parsed.children, []);
});

Deno.test('elementFromJson recreates element from JSON string', () => {
  const json = `{
    "type": "button",
    "id": "test-btn",
    "props": {
      "label": "Test Button",
      "variant": "primary"
    },
    "children": []
  }`;

  const element = elementFromJson(json);

  assertEquals(element.type, 'button');
  assertEquals(element.id, 'test-btn');
  assertEquals(element.props.label, 'Test Button');
  assertEquals(element.props.variant, 'primary');
});

Deno.test('Round-trip serialization preserves structure', () => {
  const textEl = new TextElement({ text: 'Original text', style: { textWrap: 'nowrap' } });
  const buttonEl = new ButtonElement({ label: 'Original button', variant: 'secondary' });
  const original = new ContainerElement({ width: 300, style: { display: 'block' } }, [textEl, buttonEl]);

  const json = elementToJson(original);
  const recreated = elementFromJson(json);

  assertEquals(recreated.type, original.type);
  assertEquals(recreated.props.width, original.props.width);
  assertEquals(recreated.props.style?.display, original.props.style?.display);
  assertEquals(recreated.children?.length || 0, original.children?.length || 0);

  assertEquals(recreated.children?.[0]?.type, 'text');
  assertEquals(recreated.children?.[0]?.props.text, 'Original text');

  assertEquals(recreated.children?.[1]?.type, 'button');
  assertEquals(recreated.children?.[1]?.props.label, 'Original button');
  assertEquals(recreated.children?.[1]?.props.variant, 'secondary');
});

Deno.test('validateSerializedElement validates correct structures', () => {
  const validStructure = {
    type: 'container',
    id: 'valid',
    props: { width: 100 },
    children: []
  };

  assertEquals(validateSerializedElement(validStructure), true);
});

Deno.test('validateSerializedElement rejects invalid structures', () => {
  // Missing type
  assertEquals(validateSerializedElement({ id: 'test', props: {}, children: [] }), false);

  // Invalid type
  assertEquals(validateSerializedElement({ type: 'invalid-type', id: 'test', props: {}, children: [] }), false);

  // Missing props
  assertEquals(validateSerializedElement({ type: 'container', id: 'test', children: [] }), false);

  // Non-array children
  assertEquals(validateSerializedElement({ type: 'container', id: 'test', props: {}, children: 'invalid' }), false);
});

Deno.test('Serialization handles nested structures', () => {
  const innerText = new TextElement({ text: 'Inner' });
  const innerContainer = new ContainerElement({ width: 100 }, [innerText]);
  const outerContainer = new ContainerElement({ width: 200 }, [innerContainer]);

  const serialized = serializeElement(outerContainer);
  const recreated = deserializeElement(serialized);

  assertEquals(recreated.type, 'container');
  assertEquals(recreated.props.width, 200);
  assertEquals(recreated.children?.length || 0, 1);
  assertEquals(recreated.children?.[0]?.type, 'container');
  assertEquals(recreated.children?.[0]?.props.width, 100);
  assertEquals(recreated.children?.[0]?.children?.length || 0, 1);
  assertEquals(recreated.children?.[0]?.children?.[0]?.type, 'text');
  assertEquals(recreated.children?.[0]?.children?.[0]?.props.text, 'Inner');
});

// Parent relationships no longer exist - test removed

Deno.test('elementFromJson throws on invalid JSON', () => {
  assertThrows(
    () => elementFromJson('invalid json'),
    Error,
    'Failed to parse element JSON'
  );
});

Deno.test('deserializeElement throws on invalid element type', () => {
  const invalidSerialized = {
    type: 'unknown-type',
    id: 'test',
    props: {},
    children: []
  };

  assertThrows(
    () => deserializeElement(invalidSerialized),
    Error,
    'Invalid element type: unknown-type'
  );
});