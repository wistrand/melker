// Tests for the auto-resize handling system

import { assertEquals, assert, assertExists } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  ResizeHandler,
  TerminalSize,
  ResizeEvent,
  setupAutoResize,
  initializeGlobalResizeHandler,
  getGlobalResizeHandler,
} from '../src/resize.ts';
import {
  DualBuffer,
  Document,
  RenderingEngine,
  ContainerElement,
  TextElement,
} from '../melker.ts';

Deno.test('ResizeHandler creation and basic properties', () => {
  const initialSize = { width: 100, height: 50 };
  const handler = new ResizeHandler(initialSize);

  assertEquals(handler.currentSize, initialSize);
  assertEquals(handler.isListening, false);
});

Deno.test('ResizeHandler with custom options', () => {
  let resizeEventReceived: ResizeEvent | null = null;

  const handler = new ResizeHandler(
    { width: 80, height: 24 },
    {
      debounceMs: 100,
      autoRender: false,
      onResize: (event) => {
        resizeEventReceived = event;
      },
    }
  );

  assertEquals(handler.currentSize.width, 80);
  assertEquals(handler.currentSize.height, 24);
});

Deno.test('ResizeHandler manual resize', async () => {
  let beforeResizeCalled = false;
  let afterResizeCalled = false;
  let resizeEventReceived: ResizeEvent | null = null;

  const handler = new ResizeHandler(
    { width: 80, height: 24 },
    {
      onBeforeResize: () => { beforeResizeCalled = true; },
      onAfterResize: () => { afterResizeCalled = true; },
      onResize: (event: ResizeEvent) => { resizeEventReceived = event; },
    }
  );

  const newSize = { width: 120, height: 30 };
  await handler.resize(newSize);

  assertEquals(handler.currentSize, newSize);
  assert(beforeResizeCalled);
  assert(afterResizeCalled);
  assertExists(resizeEventReceived);
  assertEquals((resizeEventReceived as ResizeEvent).type, 'resize');
  assertEquals((resizeEventReceived as ResizeEvent).previousSize, { width: 80, height: 24 });
  assertEquals((resizeEventReceived as ResizeEvent).newSize, newSize);
});

Deno.test('ResizeHandler buffer attachment and resize', async () => {
  const buffer = new DualBuffer(80, 24);
  const handler = new ResizeHandler({ width: 80, height: 24 });

  handler.attachBuffer(buffer);

  assertEquals(buffer.width, 80);
  assertEquals(buffer.height, 24);

  await handler.resize({ width: 100, height: 30 });

  assertEquals(buffer.width, 100);
  assertEquals(buffer.height, 30);
  assertEquals(handler.currentSize.width, 100);
  assertEquals(handler.currentSize.height, 30);
});

Deno.test('ResizeHandler document attachment and event dispatch', async () => {
  const document = new Document(new ContainerElement());
  const handler = new ResizeHandler({ width: 80, height: 24 });

  let documentEventReceived: ResizeEvent | null = null;
  document.addEventListener('resize', (event: ResizeEvent) => {
    documentEventReceived = event;
  });

  handler.attachDocument(document);

  await handler.resize({ width: 100, height: 30 });

  assertExists(documentEventReceived);
  assertEquals((documentEventReceived as ResizeEvent).type, 'resize');
  assertEquals((documentEventReceived as ResizeEvent).newSize, { width: 100, height: 30 });
});

Deno.test('ResizeHandler with renderer attachment', async () => {
  const container = new ContainerElement({
    width: 80,
    height: 24,
  }, [
    new TextElement({ text: 'Test Content' }),
  ]);

  const document = new Document(container);
  const buffer = new DualBuffer(80, 24);
  const renderer = new RenderingEngine();

  const handler = new ResizeHandler({ width: 80, height: 24 }, {
    autoRender: true,
  });

  handler.attachDocument(document);
  handler.attachBuffer(buffer);
  handler.attachRenderer(renderer);

  await handler.resize({ width: 100, height: 30 });

  assertEquals(buffer.width, 100);
  assertEquals(buffer.height, 30);
  // Buffer should have some content from auto-render
  const stats = buffer.getStats();
  assert(stats.totalCells === 3000); // 100 * 30
});

Deno.test('ResizeHandler starting and stopping listener', async () => {
  const handler = new ResizeHandler({ width: 80, height: 24 });

  assertEquals(handler.isListening, false);

  await handler.startListening();
  assertEquals(handler.isListening, true);

  handler.stopListening();
  assertEquals(handler.isListening, false);
});

Deno.test('ResizeHandler.create static method', () => {
  const handler = ResizeHandler.create({ width: 120, height: 40 });

  assertEquals(handler.currentSize.width, 120);
  assertEquals(handler.currentSize.height, 40);
});

Deno.test('ResizeHandler.createWithDetection static method', async () => {
  const handler = await ResizeHandler.createWithDetection({
    debounceMs: 200,
    autoRender: false,
  });

  assertExists(handler);
  // Should have detected some reasonable size
  assert(handler.currentSize.width > 0);
  assert(handler.currentSize.height > 0);
});

Deno.test('setupAutoResize utility function', async () => {
  const container = new ContainerElement({
    width: 80,
    height: 24,
  }, [
    new TextElement({ text: 'Auto Resize Test' }),
  ]);

  const document = new Document(container);
  const buffer = new DualBuffer(80, 24);
  const renderer = new RenderingEngine();

  const handler = await setupAutoResize(document, buffer, renderer, {
    debounceMs: 10, // Fast for testing
    autoRender: true,
  });

  assertExists(handler);
  assertEquals(handler.isListening, true);

  // Test that everything is connected
  await handler.resize({ width: 90, height: 25 });

  assertEquals(buffer.width, 90);
  assertEquals(buffer.height, 25);

  handler.stopListening();
});

Deno.test('Global resize handler initialization', async () => {
  const handler = await initializeGlobalResizeHandler({
    debounceMs: 50,
  });

  assertExists(handler);
  assert(handler.currentSize.width > 0);
  assert(handler.currentSize.height > 0);

  const retrievedHandler = await getGlobalResizeHandler();
  assertEquals(handler, retrievedHandler);

  handler.stopListening();
});

Deno.test('ResizeHandler getCurrentTerminalSize', async () => {
  const handler = new ResizeHandler({ width: 80, height: 24 });

  const size = await handler.getCurrentTerminalSize();

  assertExists(size);
  assert(typeof size.width === 'number');
  assert(typeof size.height === 'number');
  assert(size.width > 0);
  assert(size.height > 0);
});

Deno.test('Multiple resize events with debouncing', async () => {
  let resizeCallCount = 0;

  const handler = new ResizeHandler(
    { width: 80, height: 24 },
    {
      debounceMs: 10,
      onResize: () => { resizeCallCount++; },
    }
  );

  // Simulate rapid resize events
  await handler.resize({ width: 81, height: 24 });
  await handler.resize({ width: 82, height: 24 });
  await handler.resize({ width: 83, height: 24 });

  // All resizes should be processed since we're calling manually
  assertEquals(resizeCallCount, 3);
  assertEquals(handler.currentSize.width, 83);
});

Deno.test('ResizeHandler with error handling in callbacks', async () => {
  let errorThrown = false;

  const handler = new ResizeHandler(
    { width: 80, height: 24 },
    {
      onResize: () => {
        errorThrown = true;
        throw new Error('Test error');
      },
    }
  );

  // Should not throw even if callback throws
  await handler.resize({ width: 100, height: 30 });

  assert(errorThrown);
  // Resize should still have completed
  assertEquals(handler.currentSize.width, 100);
  assertEquals(handler.currentSize.height, 30);
});

Deno.test('Complex resize scenario with all components', async () => {
  // Create a complex UI
  const mainContainer = new ContainerElement({
    width: 80,
    height: 24,
    style: { display: 'block' }
  }, [
    new TextElement({ text: 'Header' }),
    new ContainerElement({
      style: {
        display: 'flex',
        flexDirection: 'row'
      }
    }, [
      new TextElement({ text: 'Left Panel' }),
      new TextElement({ text: 'Right Panel' }),
    ]),
    new TextElement({ text: 'Footer' }),
  ]);

  const document = new Document(mainContainer);
  const buffer = new DualBuffer(80, 24);
  const renderer = new RenderingEngine();

  let resizeEvents: ResizeEvent[] = [];

  const handler = await setupAutoResize(document, buffer, renderer, {
    debounceMs: 5,
    autoRender: true,
    onResize: (event) => { resizeEvents.push(event); },
  });

  // Perform several resizes
  await handler.resize({ width: 100, height: 30 });
  await handler.resize({ width: 120, height: 35 });

  assertEquals(resizeEvents.length, 2);
  assertEquals(buffer.width, 120);
  assertEquals(buffer.height, 35);

  // Check that content was rendered
  const stats = buffer.getStats();
  assert(stats.totalCells === 120 * 35);
  assert(stats.nonEmptyCells > 0); // Should have some content

  handler.stopListening();
});