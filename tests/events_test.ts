// Comprehensive tests for the event system

import { assertEquals, assertExists, assert } from 'jsr:@std/assert';
import {
  EventManager,
  getGlobalEventManager,
  createKeyEvent,
  createMouseEvent,
  createFocusEvent,
  createInputEvent,
  isKeyEvent,
  isMouseEvent,
  isFocusEvent,
  isInputEvent,
  type MelkerEvent,
  type EventHandler,
} from '../src/events.ts';

Deno.test('Event System Tests', async (t) => {

  await t.step('EventManager Creation and Basic Operations', () => {
    const eventManager = new EventManager();
    let eventReceived: MelkerEvent | null = null;

    const handler: EventHandler = (event) => {
      eventReceived = event;
    };

    // Register event handler
    eventManager.addEventListener('test-element', 'click', handler);

    // Create and dispatch event
    const clickEvent = createMouseEvent('click', 10, 20, 0, 0, 'test-element');
    const result = eventManager.dispatchEvent(clickEvent);

    assertEquals(result, true);
    assertExists(eventReceived);
    assertEquals((eventReceived as any).type, 'click');
    assertEquals((eventReceived as any).x, 10);
    assertEquals((eventReceived as any).y, 20);
  });

  await t.step('Event Propagation and Bubbling', () => {
    const eventManager = new EventManager();
    const capturedEvents: string[] = [];

    // Set up handlers for propagation test
    eventManager.addEventListener('child', 'click', () => {
      capturedEvents.push('child-bubble');
    });

    eventManager.addEventListener('parent', 'click', () => {
      capturedEvents.push('parent-bubble');
    });

    eventManager.addEventListener('root', 'click', () => {
      capturedEvents.push('root-bubble');
    });

    // Capture phase handlers
    eventManager.addEventListener('parent', 'click', () => {
      capturedEvents.push('parent-capture');
    }, { capture: true });

    eventManager.addEventListener('root', 'click', () => {
      capturedEvents.push('root-capture');
    }, { capture: true });

    // Dispatch event with element path (root -> parent -> child)
    const clickEvent = createMouseEvent('click', 5, 5, 0, 0, 'child');
    eventManager.dispatchEvent(clickEvent, ['child', 'parent', 'root']);

    // Should follow capture phase, target phase, bubble phase
    assertEquals(capturedEvents, [
      'root-capture',
      'parent-capture',
      'child-bubble',
      'parent-bubble',
      'root-bubble'
    ]);
  });

  await t.step('Event Prevention and Stopping Propagation', () => {
    const eventManager = new EventManager();
    const capturedEvents: string[] = [];

    // Handler that prevents default
    eventManager.addEventListener('element1', 'click', (event) => {
      capturedEvents.push('element1');
      event.preventDefault = true;
      return false; // Also prevents default
    });

    // Handler that stops propagation
    eventManager.addEventListener('element2', 'click', (event) => {
      capturedEvents.push('element2');
      event.stopPropagation = true;
    });

    eventManager.addEventListener('parent', 'click', () => {
      capturedEvents.push('parent'); // Should not be called
    });

    // Test preventDefault
    const event1 = createMouseEvent('click', 0, 0, 0, 0, 'element1');
    const result1 = eventManager.dispatchEvent(event1, ['element1', 'parent']);
    assertEquals(result1, false); // Event was prevented
    assertEquals(capturedEvents.includes('element1'), true);

    // Clear events for next test
    capturedEvents.length = 0;

    // Test stopPropagation
    const event2 = createMouseEvent('click', 0, 0, 0, 0, 'element2');
    const result2 = eventManager.dispatchEvent(event2, ['element2', 'parent']);
    assertEquals(result2, true); // Event not prevented, just stopped
    assertEquals(capturedEvents.includes('element2'), true);
    assertEquals(capturedEvents.includes('parent'), false); // Propagation stopped
  });

  await t.step('Once Event Listeners', () => {
    const eventManager = new EventManager();
    let callCount = 0;

    const handler: EventHandler = () => {
      callCount++;
    };

    eventManager.addEventListener('test-element', 'click', handler, { once: true });

    // Dispatch event multiple times
    const clickEvent = createMouseEvent('click', 0, 0, 0, 0, 'test-element');
    eventManager.dispatchEvent(clickEvent);
    eventManager.dispatchEvent(clickEvent);
    eventManager.dispatchEvent(clickEvent);

    // Handler should only be called once
    assertEquals(callCount, 1);
  });

  await t.step('Global Event Handlers', () => {
    const eventManager = new EventManager();
    let globalEventReceived: MelkerEvent | null = null;

    const globalHandler: EventHandler = (event) => {
      globalEventReceived = event;
    };

    eventManager.addGlobalEventListener('keydown', globalHandler);

    // Dispatch key event
    const keyEvent = createKeyEvent('keydown', 'Enter', 'Enter');
    eventManager.dispatchEvent(keyEvent);

    assertExists(globalEventReceived);
    assertEquals((globalEventReceived as any).type, 'keydown');
    assertEquals((globalEventReceived as any).key, 'Enter');
  });

  await t.step('Event Handler Removal', () => {
    const eventManager = new EventManager();
    let callCount = 0;

    const handler: EventHandler = () => {
      callCount++;
    };

    // Add and remove handler
    eventManager.addEventListener('test-element', 'click', handler);
    eventManager.removeEventListener('test-element', 'click', handler);

    // Dispatch event
    const clickEvent = createMouseEvent('click', 0, 0, 0, 0, 'test-element');
    eventManager.dispatchEvent(clickEvent);

    // Handler should not be called
    assertEquals(callCount, 0);
  });

  await t.step('Event Type Checking Utilities', () => {
    const keyEvent = createKeyEvent('keydown', 'a', 'KeyA');
    const mouseEvent = createMouseEvent('click', 10, 10);
    const focusEvent = createFocusEvent('focus', 'element1');
    const inputEvent = createInputEvent('input', 'test value', 'input1');

    assert(isKeyEvent(keyEvent));
    assert(!isKeyEvent(mouseEvent));

    assert(isMouseEvent(mouseEvent));
    assert(!isMouseEvent(keyEvent));

    assert(isFocusEvent(focusEvent));
    assert(!isFocusEvent(inputEvent));

    assert(isInputEvent(inputEvent));
    assert(!isInputEvent(focusEvent));
  });

  await t.step('Key Event Creation with Modifiers', () => {
    const keyEvent = createKeyEvent(
      'keydown',
      'A',
      'KeyA',
      {
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
      },
      'input-element'
    );

    assertEquals(keyEvent.type, 'keydown');
    assertEquals(keyEvent.key, 'A');
    assertEquals(keyEvent.code, 'KeyA');
    assertEquals(keyEvent.ctrlKey, true);
    assertEquals(keyEvent.shiftKey, true);
    assertEquals(keyEvent.altKey, false);
    assertEquals(keyEvent.metaKey, false);
    assertEquals(keyEvent.target, 'input-element');
    assert(typeof keyEvent.timestamp === 'number');
  });

  await t.step('Mouse Event Creation', () => {
    const mouseEvent = createMouseEvent(
      'click',
      25,
      30,
      0, // Left button
      1, // Left button pressed
      'button-element'
    );

    assertEquals(mouseEvent.type, 'click');
    assertEquals(mouseEvent.x, 25);
    assertEquals(mouseEvent.y, 30);
    assertEquals(mouseEvent.button, 0);
    assertEquals(mouseEvent.buttons, 1);
    assertEquals(mouseEvent.target, 'button-element');
    assert(typeof mouseEvent.timestamp === 'number');
  });

  await t.step('Focus Event Creation', () => {
    const focusEvent = createFocusEvent('focus', 'new-element', 'old-element');

    assertEquals(focusEvent.type, 'focus');
    assertEquals(focusEvent.target, 'new-element');
    assertEquals(focusEvent.relatedTarget, 'old-element');
    assert(typeof focusEvent.timestamp === 'number');
  });

  await t.step('Input Event Creation', () => {
    const inputEvent = createInputEvent('change', 'new value', 'input');

    assertEquals(inputEvent.type, 'change');
    assertEquals(inputEvent.value, 'new value');
    assertEquals(inputEvent.target, 'input');
    assert(typeof inputEvent.timestamp === 'number');
  });

  await t.step('EventManager Statistics', () => {
    const eventManager = new EventManager();

    // Add various handlers
    eventManager.addEventListener('element1', 'click', () => {});
    eventManager.addEventListener('element1', 'keydown', () => {});
    eventManager.addEventListener('element2', 'focus', () => {}, { capture: true });
    eventManager.addGlobalEventListener('blur', () => {});
    eventManager.addGlobalEventListener('input', () => {});

    const stats = eventManager.getStats();

    assertEquals(stats.totalHandlers, 3); // 2 regular + 1 capture
    assertEquals(stats.captureHandlers, 1);
    assertEquals(stats.globalHandlers, 2);
    assertEquals(stats.elementCount, 2); // element1 and element2
  });

  await t.step('EventManager Clear', () => {
    const eventManager = new EventManager();
    let callCount = 0;

    const handler: EventHandler = () => {
      callCount++;
    };

    // Add handlers
    eventManager.addEventListener('element', 'click', handler);
    eventManager.addGlobalEventListener('keydown', handler);

    // Clear all handlers
    eventManager.clear();

    // Try to dispatch events
    const clickEvent = createMouseEvent('click', 0, 0, 0, 0, 'element');
    const keyEvent = createKeyEvent('keydown', 'a', 'KeyA');

    eventManager.dispatchEvent(clickEvent);
    eventManager.dispatchEvent(keyEvent);

    // No handlers should be called
    assertEquals(callCount, 0);

    const stats = eventManager.getStats();
    assertEquals(stats.totalHandlers, 0);
    assertEquals(stats.globalHandlers, 0);
  });

  await t.step('Global EventManager Singleton', () => {
    const globalManager1 = getGlobalEventManager();
    const globalManager2 = getGlobalEventManager();

    // Should return the same instance
    assertEquals(globalManager1, globalManager2);

    let eventReceived = false;
    globalManager1.addEventListener('test', 'click', () => {
      eventReceived = true;
    });

    const clickEvent = createMouseEvent('click', 0, 0, 0, 0, 'test');
    globalManager2.dispatchEvent(clickEvent);

    assertEquals(eventReceived, true);
  });

});