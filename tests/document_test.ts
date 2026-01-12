// Tests for Document class functionality

import { assertEquals, assertExists, assertNotEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  Document,
  createDocument,
  ContainerElement,
  InputElement,
  TextElement,
  ButtonElement,
} from '../mod.ts';

Deno.test('Document creation with root element', () => {
  const root = new ContainerElement({ width: 400 }, [
    new TextElement({ text: 'Test', id: 'text1' }),
    new ButtonElement({ label: 'Click', id: 'btn1' }),
  ]);

  const doc = new Document(root);

  assertEquals(doc.root, root);
  assertEquals(doc.elementCount, 3); // root + 2 children
});

Deno.test('Document auto-generates IDs when enabled', () => {
  const root = new ContainerElement({}, [
    new TextElement({ text: 'Test' }), // No ID provided
    new ButtonElement({ label: 'Click' }), // No ID provided
  ]);

  const doc = createDocument(root, { autoGenerateIds: true });

  // All elements should have IDs
  const allElements = doc.getAllElements();
  allElements.forEach(element => {
    assertExists(element.id);
    assertEquals(typeof element.id, 'string');
  });
});

Deno.test('Document respects existing IDs', () => {
  const root = new ContainerElement({ id: 'root' }, [
    new TextElement({ text: 'Test', id: 'existing-text' }),
    new ButtonElement({ label: 'Click', id: 'existing-btn' }),
  ]);

  const doc = new Document(root);

  assertEquals(doc.getElementById('root'), root);
  assertEquals(doc.getElementById('existing-text')?.props.text, 'Test');
  assertEquals(doc.getElementById('existing-btn')?.props.label, 'Click');
});

Deno.test('Document element registry operations', () => {
  const root = new ContainerElement({ id: 'root' });
  const text = new TextElement({ text: 'Test', id: 'text' });
  const button = new ButtonElement({ label: 'Click', id: 'button' });

  root.children = [text, button];

  const doc = new Document(root);

  // Test getElementById
  assertEquals(doc.getElementById('root'), root);
  assertEquals(doc.getElementById('text'), text);
  assertEquals(doc.getElementById('button'), button);
  assertEquals(doc.getElementById('nonexistent'), undefined);

  // Test getElementsByType
  const textElements = doc.getElementsByType('text');
  assertEquals(textElements.length, 1);
  assertEquals(textElements[0], text);

  const buttonElements = doc.getElementsByType('button');
  assertEquals(buttonElements.length, 1);
  assertEquals(buttonElements[0], button);

  // Test getAllElements
  const allElements = doc.getAllElements();
  assertEquals(allElements.length, 3);
});

Deno.test('Document focus management', () => {
  const root = new ContainerElement({ id: 'root' });
  const input1 = new InputElement({ placeholder: 'Input 1', id: 'input1' });
  const input2 = new InputElement({ placeholder: 'Input 2', id: 'input2' });

  root.children = [input1, input2];

  const doc = createDocument(root, { trackFocusedElement: true });

  // Initially no focus
  assertEquals(doc.focusedElement, undefined);

  // Focus first input
  const focusResult1 = doc.focus('input1');
  assertEquals(focusResult1, true);
  assertEquals(doc.focusedElement, input1);

  // Focus second input
  const focusResult2 = doc.focus(input2);
  assertEquals(focusResult2, true);
  assertEquals(doc.focusedElement, input2);

  // Blur
  doc.blur();
  assertEquals(doc.focusedElement, undefined);

  // Focus non-existent element
  const focusResult3 = doc.focus('nonexistent');
  assertEquals(focusResult3, false);
});

Deno.test('Document focus management disabled', () => {
  const root = new ContainerElement({ id: 'root' });
  const input = new InputElement({ placeholder: 'Input', id: 'input' });

  root.children = [input];

  const doc = createDocument(root, { trackFocusedElement: false });

  // Focus should fail when disabled
  const focusResult = doc.focus('input');
  assertEquals(focusResult, false);
  assertEquals(doc.focusedElement, undefined);
});

Deno.test('Document event handling', () => {
  const root = new ContainerElement({ id: 'root' });
  const button = new ButtonElement({ label: 'Click', id: 'button' });

  root.children = [button];

  const doc = createDocument(root, { enableEventHandling: true });

  let eventFired = false;
  let eventData: any = null;

  // Add document-level event listener
  doc.addEventListener('test-event', (event) => {
    eventFired = true;
    eventData = event;
  });

  // Dispatch event
  const testEvent = {
    type: 'test-event',
    target: button,
    data: 'test-data',
  };

  doc.dispatchEvent(testEvent);

  assertEquals(eventFired, true);
  assertEquals(eventData, testEvent);
});

Deno.test('Document element management', () => {
  const root = new ContainerElement({ id: 'root' });
  const initialChild = new TextElement({ text: 'Initial', id: 'initial' });

  root.children = [initialChild];

  const doc = new Document(root);

  // Initial state
  assertEquals(doc.elementCount, 2);

  // Add new element
  const newElement = new ButtonElement({ label: 'New', id: 'new-btn' });
  doc.addElement(newElement);

  assertEquals(doc.elementCount, 3);
  assertEquals(doc.getElementById('new-btn'), newElement);

  // Remove element
  const removeResult = doc.removeElement('initial');
  assertEquals(removeResult, true);
  assertEquals(doc.getElementById('initial'), undefined);

  // Try to remove non-existent element
  const removeResult2 = doc.removeElement('nonexistent');
  assertEquals(removeResult2, false);
});

Deno.test('Document search functionality', () => {
  const root = new ContainerElement({ id: 'root' });
  const text1 = new TextElement({ text: 'Hello', style: { textWrap: 'wrap' }, id: 'text1' });
  const text2 = new TextElement({ text: 'World', style: { textWrap: 'nowrap' }, id: 'text2' });
  const button = new ButtonElement({ label: 'Click', variant: 'primary', id: 'button' });

  root.children = [text1, text2, button];

  const doc = new Document(root);

  // Test findElements
  const wrappedTexts = doc.findElements(el =>
    el.type === 'text' && el.props.style?.textWrap === 'wrap'
  );
  assertEquals(wrappedTexts.length, 1);
  assertEquals(wrappedTexts[0], text1);

  // Test findElementsByProps
  const primaryElements = doc.findElementsByProps({ variant: 'primary' });
  assertEquals(primaryElements.length, 1);
  assertEquals(primaryElements[0], button);

  const noWrapTextElements = doc.findElements(el =>
    el.type === 'text' && el.props.style?.textWrap === 'nowrap'
  );
  assertEquals(noWrapTextElements.length, 1);
  assertEquals(noWrapTextElements[0], text2);
});

Deno.test('Document traversal', () => {
  const root = new ContainerElement({ id: 'root' });
  const child = new ContainerElement({ id: 'child' });
  const grandchild = new TextElement({ text: 'Deep', id: 'grandchild' });

  child.children = [grandchild];
  root.children = [child];

  const doc = new Document(root);

  const visitedElements: string[] = [];

  doc.traverseDocument((element) => {
    visitedElements.push(element.id);
  });

  assertEquals(visitedElements.length, 3);
  assertEquals(visitedElements, ['root', 'child', 'grandchild']);
});

Deno.test('Document statistics', () => {
  const root = new ContainerElement({ id: 'root' });
  const container = new ContainerElement({ id: 'container' });
  const text1 = new TextElement({ text: 'Text 1', id: 'text1' });
  const text2 = new TextElement({ text: 'Text 2', id: 'text2' });
  const button = new ButtonElement({ label: 'Button', id: 'button' });

  container.children = [text1, text2];
  root.children = [container, button];

  const doc = new Document(root);

  const stats = doc.getDocumentStats();

  assertEquals(stats.totalElements, 5);
  assertEquals(stats.elementsWithIds, 5);
  assertEquals(stats.elementsByType['container'], 2);
  assertEquals(stats.elementsByType['text'], 2);
  assertEquals(stats.elementsByType['button'], 1);
  assertEquals(stats.maxDepth, 2);
  assertEquals(stats.focusedElement, undefined);
});

Deno.test('Document utility methods', () => {
  const root = new ContainerElement({ id: 'root' });
  const doc = new Document(root);

  // Test ID generation
  const id1 = doc.generateElementId();
  const id2 = doc.generateElementId();

  assertEquals(typeof id1, 'string');
  assertEquals(typeof id2, 'string');
  assertNotEquals(id1, id2);

  // Test debug string
  const debugStr = doc.toDebugString();
  assertEquals(typeof debugStr, 'string');
  assertEquals(debugStr.includes('Document'), true);
  assertEquals(debugStr.includes('root'), true);
});

Deno.test('Document refresh functionality', () => {
  const root = new ContainerElement({ id: 'root' });
  const child = new TextElement({ text: 'Child', id: 'child' });

  root.children = [child];

  const doc = new Document(root);

  // Initial state
  assertEquals(doc.elementCount, 2);

  // Manually add element to root without registering
  const newChild = new ButtonElement({ label: 'Manual', id: 'manual' });
  if (!root.children) {
    root.children = [];
  }
  root.children.push(newChild);

  // Before refresh, new element not in registry
  assertEquals(doc.getElementById('manual'), undefined);

  // After refresh, new element should be registered
  doc.refreshDocument();
  assertEquals(doc.getElementById('manual'), newChild);
  assertEquals(doc.elementCount, 3);
});

Deno.test('Document asTree() method', () => {
  const root = new ContainerElement({ id: 'root', width: 400 });
  const text = new TextElement({ text: 'Hello World', id: 'text' });
  const button = new ButtonElement({ label: 'Click Me', variant: 'primary', id: 'button' });

  root.children = [text, button];

  const doc = new Document(root);

  const tree = doc.asTree();

  // Basic structure checks
  assertEquals(typeof tree, 'string');
  assertEquals(tree.includes('container#root'), true);
  assertEquals(tree.includes('text#text'), true);
  assertEquals(tree.includes('button#button'), true);

  // Tree structure characters
  assertEquals(tree.includes('├──'), true);
  assertEquals(tree.includes('└──'), true);

  // Properties display
  assertEquals(tree.includes('width: 400'), true);
  assertEquals(tree.includes('"Hello World"'), true);
  assertEquals(tree.includes('"Click Me"'), true);
  assertEquals(tree.includes('variant: primary'), true);
});

Deno.test('Document asTree() with focus indicator', () => {
  const root = new ContainerElement({ id: 'root' });
  const input = new InputElement({ placeholder: 'Enter text', id: 'input' });

  root.children = [input];

  const doc = createDocument(root, { trackFocusedElement: true });

  // Tree without focus
  const treeWithoutFocus = doc.asTree();
  assertEquals(treeWithoutFocus.includes('*focused*'), false);

  // Focus the input
  doc.focus('input');

  // Tree with focus
  const treeWithFocus = doc.asTree();
  assertEquals(treeWithFocus.includes('*focused*'), true);
  assertEquals(treeWithFocus.includes('input#input'), true);
});

Deno.test('Document asTree() with nested structure', () => {
  const root = new ContainerElement({ id: 'root' });
  const dialog = new ContainerElement({ id: 'dialog' });
  const nestedText = new TextElement({ text: 'Nested', id: 'nested' });

  dialog.children = [nestedText];
  root.children = [dialog];

  const doc = new Document(root);
  const tree = doc.asTree();

  // Check hierarchical structure
  assertEquals(tree.includes('container#root'), true);
  assertEquals(tree.includes('└── container#dialog'), true); // Only one child, so └── not ├──
  assertEquals(tree.includes('└── text#nested'), true);
  assertEquals(tree.includes('"Nested"'), true);

  // Check tree structure - has proper indentation
  assertEquals(tree.includes('    └──'), true); // Four space indentation for nested elements
});