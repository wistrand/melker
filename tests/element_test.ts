// Tests for element data model

import { assertEquals, assertExists, assertNotEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  createElement,
  findElementById,
  traverseElements,
  appendChild,
  cloneElement,
} from '../src/melker.ts';

Deno.test('createElement creates basic element', () => {
  const element = createElement('container', {});

  assertEquals(element.type, 'container');
  assertEquals(element.children?.length, 0);
  assertExists(element.id);
  assertEquals(element.id.length > 0, true);
});

Deno.test('createElement with props sets properties', () => {
  const element = createElement('button', {
    title: 'Click me',
    variant: 'primary',
    disabled: true,
    id: 'test-button',
  });

  assertEquals(element.props.title, 'Click me');
  assertEquals(element.props.variant, 'primary');
  assertEquals(element.props.disabled, true);
  assertEquals(element.id, 'test-button');
});

Deno.test('createElement with children creates structure', () => {
  const child1 = createElement('text', { text: 'Child 1' });
  const child2 = createElement('button', { title: 'Child 2' });
  const parent = createElement('container', {}, child1, child2);

  assertEquals(parent.children?.length || 0, 2);
  assertEquals(parent.children?.[0], child1);
  assertEquals(parent.children?.[1], child2);
});

Deno.test('findElementById finds elements by ID', () => {
  const child = createElement('text', { text: 'Find me', id: 'target-element' });

  const parent = createElement('container', { id: 'parent-element' }, child);

  const found = findElementById(parent, 'target-element');
  assertEquals(found, child);

  const notFound = findElementById(parent, 'non-existent');
  assertEquals(notFound, null);
});

Deno.test('findElementById searches nested structures', () => {
  const deepChild = createElement('text', { text: 'Deep child', id: 'deep-target' });

  const middleChild = createElement('container', { id: 'middle' }, deepChild);

  const root = createElement('container', { id: 'root' }, middleChild);

  const found = findElementById(root, 'deep-target');
  assertEquals(found, deepChild);
});

Deno.test('traverseElements visits all elements', () => {
  const visited: string[] = [];

  const child1 = createElement('text', { text: 'Child 1', id: 'child1' });

  const child2 = createElement('button', { title: 'Child 2', id: 'child2' });

  const parent = createElement('container', { id: 'parent' }, child1, child2);

  traverseElements(parent, (element) => {
    visited.push(element.id);
  });

  assertEquals(visited, ['parent', 'child1', 'child2']);
});

Deno.test('traverseElements can skip children', () => {
  const visited: string[] = [];

  const child = createElement('text', { text: 'Child', id: 'child' });

  const parent = createElement('container', { id: 'parent' }, child);

  traverseElements(parent, (element) => {
    visited.push(element.id);
  }, false);

  assertEquals(visited, ['parent']);
});

Deno.test('appendChild adds child to parent', () => {
  const parent = createElement('container', { id: 'parent' });

  const child = createElement('text', {text: 'New child', id: 'child'});

  appendChild(parent, child);

  assertEquals(parent.children?.length || 0, 1);
  assertEquals(parent.children?.[0], child);
  // Parent references no longer exist
});

Deno.test('appendChild adds child to parent', () => {
  const parent1 = createElement('container', {id: 'parent1'});

  const parent2 = createElement('container', {id: 'parent2'});

  const child = createElement('text', {text: 'Moving child', id: 'child'});

  appendChild(parent1, child);
  appendChild(parent2, child);

  // Without parent tracking, child exists in both parents
  assertEquals(parent1.children?.length || 0, 1);
  assertEquals(parent2.children?.length || 0, 1);
});

// removeElement function removed - tests no longer applicable

Deno.test('cloneElement creates deep copy', () => {
  const child = createElement('text', { text: 'Original child', id: 'child' });

  const original = createElement('container', { width: 100, id: 'original' }, child);

  const cloned = cloneElement(original);

  assertEquals(cloned.type, original.type);
  assertEquals(cloned.props.width, original.props.width);
  assertEquals(cloned.children?.length || 0, original.children?.length || 0);

  // Check that cloning creates different object references
  assert(cloned !== original, 'Cloned element should be a different object reference');
  assert(cloned.children?.[0] !== child, 'Cloned child should be a different object reference');
  assertEquals(cloned.children?.[0]?.type, child.type);
  assertEquals(cloned.children?.[0]?.props.text, child.props.text);
});

Deno.test('cloneElement with new props merges correctly', () => {
  const original = createElement('button', { title: 'Original', variant: 'default', id: 'original' });

  const cloned = cloneElement(original, { variant: 'primary', disabled: true });

  assertEquals(cloned.props.title, 'Original'); // Original prop preserved
  assertEquals(cloned.props.variant, 'primary'); // New prop overrides
  assertEquals(cloned.props.disabled, true); // New prop added
});