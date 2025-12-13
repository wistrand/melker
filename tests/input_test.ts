// Tests for input processing system

import { assertEquals, assertExists, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  TerminalInputProcessor,
  getGlobalInputProcessor,
  type RawKeyInput,
  type RawMouseInput,
} from '../src/input.ts';
import { EventManager, isKeyEvent, isMouseEvent } from '../src/events.ts';

Deno.test('Input Processing Tests', async (t) => {

  await t.step('TerminalInputProcessor Creation and Configuration', () => {
    const processor = new TerminalInputProcessor({
      enableMouse: true,
      enableFocusEvents: false,
      enableRawMode: false, // Disable for testing
      mouseReporting: 'basic',
    });

    const stats = processor.getStats();
    assertEquals(stats.enabledFeatures.includes('mouse'), true);
    assertEquals(stats.enabledFeatures.includes('focus'), false);
    assertEquals(stats.mouseReporting, 'basic');
    assertEquals(stats.isListening, false);
  });

  await t.step('Raw Key Input Processing', () => {
    const processor = new TerminalInputProcessor();

    // Test regular character
    const charInput: RawKeyInput = {
      sequence: 'a',
      name: 'a',
    };

    const keyEvent = processor.processKeyInput(charInput);
    assertExists(keyEvent);
    assertEquals(keyEvent.type, 'keydown');
    assertEquals(keyEvent.key, 'a');
    assertEquals(keyEvent.code, 'KeyA');
    assertEquals(keyEvent.ctrlKey, false);

    // Test control key
    const ctrlInput: RawKeyInput = {
      sequence: '\x01',
      name: 'a',
      ctrl: true,
    };

    const ctrlEvent = processor.processKeyInput(ctrlInput);
    assertExists(ctrlEvent);
    assertEquals(ctrlEvent.key, 'a');
    assertEquals(ctrlEvent.ctrlKey, true);

    // Test special key
    const escapeInput: RawKeyInput = {
      sequence: '\x1b[A',
      name: 'up',
    };

    const escapeEvent = processor.processKeyInput(escapeInput);
    assertExists(escapeEvent);
    assertEquals(escapeEvent.key, 'ArrowUp');
    assertEquals(escapeEvent.code, 'ArrowUp');
  });

  await t.step('Raw Mouse Input Processing', () => {
    const processor = new TerminalInputProcessor();

    // Test mouse click
    const mouseInput: RawMouseInput = {
      type: 'mousedown',
      x: 10,
      y: 5,
      button: 0, // Left button
      buttons: 1,
      shift: false,
      alt: false,
      ctrl: false,
    };

    const mouseEvent = processor.processMouseInput(mouseInput);
    assertExists(mouseEvent);
    assertEquals(mouseEvent.type, 'mousedown');
    assertEquals(mouseEvent.x, 9); // Converted to 0-based
    assertEquals(mouseEvent.y, 4); // Converted to 0-based
    assertEquals(mouseEvent.button, 0);
    assertEquals(mouseEvent.buttons, 1);

    // Test mouse move
    const moveInput: RawMouseInput = {
      type: 'mousemove',
      x: 1,
      y: 1,
      button: 0, // No button
      buttons: 0,
    };

    const moveEvent = processor.processMouseInput(moveInput);
    assertExists(moveEvent);
    assertEquals(moveEvent.type, 'mousemove');
  });

  await t.step('Raw Input Data Processing', () => {
    const processor = new TerminalInputProcessor();

    // Test single character
    const charData = new TextEncoder().encode('a');
    const charEvents = processor.processRawInput(charData);
    assertEquals(charEvents.length, 1);
    assert(isKeyEvent(charEvents[0]));
    assertEquals(charEvents[0].key, 'a');

    // Test escape sequence (arrow key)
    const arrowData = new TextEncoder().encode('\x1b[A');
    const arrowEvents = processor.processRawInput(arrowData);
    assertEquals(arrowEvents.length, 1);
    assert(isKeyEvent(arrowEvents[0]));
    assertEquals(arrowEvents[0].key, 'ArrowUp');

    // Test SGR mouse sequence
    const mouseData = new TextEncoder().encode('\x1b[<0;10;5M'); // Left click at 10,5
    const mouseEvents = processor.processRawInput(mouseData);
    assertEquals(mouseEvents.length, 1);
    assert(isMouseEvent(mouseEvents[0]));
    assertEquals(mouseEvents[0].x, 9); // Converted to 0-based (10-1)
    assertEquals(mouseEvents[0].y, 4); // Converted to 0-based (5-1)
  });

  await t.step('Key Sequence Parsing', () => {
    const processor = new TerminalInputProcessor();

    // Test control characters
    const ctrlCData = new TextEncoder().encode('\x03'); // Ctrl+C
    const ctrlCEvents = processor.processRawInput(ctrlCData);
    assertEquals(ctrlCEvents.length, 1);
    assert(isKeyEvent(ctrlCEvents[0]));
    assertEquals(ctrlCEvents[0].key, 'c');
    assertEquals(ctrlCEvents[0].ctrlKey, true);

    // Test Enter key
    const enterData = new TextEncoder().encode('\r');
    const enterEvents = processor.processRawInput(enterData);
    assertEquals(enterEvents.length, 1);
    assert(isKeyEvent(enterEvents[0]));
    assertEquals(enterEvents[0].key, 'Enter');

    // Test Tab key
    const tabData = new TextEncoder().encode('\t');
    const tabEvents = processor.processRawInput(tabData);
    assertEquals(tabEvents.length, 1);
    assert(isKeyEvent(tabEvents[0]));
    assertEquals(tabEvents[0].key, 'Tab');

    // Test Escape key
    const escData = new TextEncoder().encode('\x1b');
    const escEvents = processor.processRawInput(escData);
    assertEquals(escEvents.length, 1);
    assert(isKeyEvent(escEvents[0]));
    assertEquals(escEvents[0].key, 'Escape');
  });

  await t.step('Function Key Parsing', () => {
    const processor = new TerminalInputProcessor();

    // Test F1 key
    const f1Data = new TextEncoder().encode('\x1b[11~');
    const f1Events = processor.processRawInput(f1Data);
    assertEquals(f1Events.length, 1);
    assert(isKeyEvent(f1Events[0]));
    assertEquals(f1Events[0].key, 'F1');

    // Test modified key (Ctrl+Arrow)
    const ctrlArrowData = new TextEncoder().encode('\x1b[1;5A'); // Ctrl+Up
    const ctrlArrowEvents = processor.processRawInput(ctrlArrowData);
    assertEquals(ctrlArrowEvents.length, 1);
    assert(isKeyEvent(ctrlArrowEvents[0]));
    assertEquals(ctrlArrowEvents[0].key, 'ArrowUp');
    assertEquals(ctrlArrowEvents[0].ctrlKey, true);
  });

  await t.step('Mouse Sequence Parsing', () => {
    const processor = new TerminalInputProcessor();

    // Test SGR mouse press
    const pressData = new TextEncoder().encode('\x1b[<0;15;10M');
    const pressEvents = processor.processRawInput(pressData);
    assertEquals(pressEvents.length, 1);
    assert(isMouseEvent(pressEvents[0]));
    assertEquals(pressEvents[0].type, 'mousedown');
    assertEquals(pressEvents[0].x, 14); // 15-1 for 0-based
    assertEquals(pressEvents[0].y, 9);  // 10-1 for 0-based
    assertEquals(pressEvents[0].button, 0);

    // Test SGR mouse release
    const releaseData = new TextEncoder().encode('\x1b[<0;15;10m'); // lowercase 'm'
    const releaseEvents = processor.processRawInput(releaseData);
    assertEquals(releaseEvents.length, 1);
    assert(isMouseEvent(releaseEvents[0]));
    assertEquals(releaseEvents[0].type, 'mouseup');

    // Test X10 mouse format (legacy)
    // \x20 = 32 (button=0), \x25 = 37 (x=5), \x21 = 33 (y=1) after subtracting 32
    const x10Data = new TextEncoder().encode('\x1b[M\x20\x25\x21');
    const x10Events = processor.processRawInput(x10Data);
    assertEquals(x10Events.length, 1);
    assert(isMouseEvent(x10Events[0]));
    assertEquals(x10Events[0].x, 4); // 5-1 for 0-based (37-32-1)
    assertEquals(x10Events[0].y, 0); // 1-1 for 0-based (33-32-1)
  });

  await t.step('Key Code Generation', () => {
    const processor = new TerminalInputProcessor();

    // Test letter key codes
    const aInput: RawKeyInput = { sequence: 'a', name: 'a' };
    const aEvent = processor.processKeyInput(aInput);
    assertEquals(aEvent?.code, 'KeyA');

    const zInput: RawKeyInput = { sequence: 'z', name: 'z' };
    const zEvent = processor.processKeyInput(zInput);
    assertEquals(zEvent?.code, 'KeyZ');

    // Test number key codes
    const num5Input: RawKeyInput = { sequence: '5', name: '5' };
    const num5Event = processor.processKeyInput(num5Input);
    assertEquals(num5Event?.code, 'Digit5');

    // Test special key codes
    const spaceInput: RawKeyInput = { sequence: ' ', name: 'space' };
    const spaceEvent = processor.processKeyInput(spaceInput);
    assertEquals(spaceEvent?.code, 'Space');

    // Test function key codes
    const f12Input: RawKeyInput = { sequence: '\x1b[24~', name: 'f12' };
    const f12Event = processor.processKeyInput(f12Input);
    assertEquals(f12Event?.code, 'F12');
  });

  await t.step('Event Manager Integration', () => {
    const eventManager = new EventManager();
    const processor = new TerminalInputProcessor({}, eventManager);

    let receivedEvent: any = null;

    eventManager.addGlobalEventListener('keydown', (event) => {
      receivedEvent = event;
    });

    // Process key input
    const keyInput: RawKeyInput = {
      sequence: 'x',
      name: 'x',
    };

    const keyEvent = processor.processKeyInput(keyInput);
    if (keyEvent) {
      eventManager.dispatchEvent(keyEvent);
    }

    assertExists(receivedEvent);
    assertEquals(receivedEvent.type, 'keydown');
    assertEquals(receivedEvent.key, 'x');
  });

  await t.step('Multiple Input Sequences', () => {
    const processor = new TerminalInputProcessor();

    // Test multiple characters in one input
    const multiData = new TextEncoder().encode('hello');
    const multiEvents = processor.processRawInput(multiData);
    assertEquals(multiEvents.length, 5);

    for (let i = 0; i < 5; i++) {
      assert(isKeyEvent(multiEvents[i]));
      assertEquals((multiEvents[i] as any).key, 'hello'[i]);
    }

    // Test mixed input (character + escape sequence)
    const mixedData = new TextEncoder().encode('a\x1b[B'); // 'a' + Down arrow
    const mixedEvents = processor.processRawInput(mixedData);
    assertEquals(mixedEvents.length, 2);

    assert(isKeyEvent(mixedEvents[0]));
    assertEquals((mixedEvents[0] as any).key, 'a');

    assert(isKeyEvent(mixedEvents[1]));
    assertEquals((mixedEvents[1] as any).key, 'ArrowDown');
  });

  await t.step('Edge Cases and Error Handling', () => {
    const processor = new TerminalInputProcessor();

    // Test empty input
    const emptyData = new TextEncoder().encode('');
    const emptyEvents = processor.processRawInput(emptyData);
    assertEquals(emptyEvents.length, 0);

    // Test incomplete escape sequence
    const incompleteData = new TextEncoder().encode('\x1b[');
    const incompleteEvents = processor.processRawInput(incompleteData);
    // Should still create an event, even if malformed
    assertEquals(incompleteEvents.length, 1);

    // Test null input for key processing
    const nullInput: RawKeyInput = {
      sequence: '',
      name: undefined,
    };
    const nullEvent = processor.processKeyInput(nullInput);
    assertEquals(nullEvent, null);

    // Test negative mouse coordinates
    const negativeMouseInput: RawMouseInput = {
      type: 'mousedown',
      x: -5,
      y: -3,
      button: 0,
      buttons: 1,
    };
    const negativeMouseEvent = processor.processMouseInput(negativeMouseInput);
    assertExists(negativeMouseEvent);
    assertEquals(negativeMouseEvent.x, 0); // Should clamp to 0
    assertEquals(negativeMouseEvent.y, 0); // Should clamp to 0
  });

  await t.step('Global Input Processor Singleton', () => {
    const globalProcessor1 = getGlobalInputProcessor();
    const globalProcessor2 = getGlobalInputProcessor();

    // Should return the same instance
    assertEquals(globalProcessor1, globalProcessor2);

    // Test that it works
    const testInput: RawKeyInput = {
      sequence: 'test',
      name: 'test',
    };

    const event1 = globalProcessor1.processKeyInput(testInput);
    const event2 = globalProcessor2.processKeyInput(testInput);

    assertEquals((event1 as any)?.key, (event2 as any)?.key);
  });

  await t.step('Input Statistics and Configuration', () => {
    const processor = new TerminalInputProcessor({
      enableMouse: true,
      enableFocusEvents: true,
      enableRawMode: false,
      mouseReporting: 'drag',
    });

    const stats = processor.getStats();
    assertEquals(stats.enabledFeatures.length, 3); // mouse, focus, and mapMetaToAlt (default)
    assertEquals(stats.enabledFeatures.includes('mouse'), true);
    assertEquals(stats.enabledFeatures.includes('focus'), true);
    assertEquals(stats.enabledFeatures.includes('mapMetaToAlt'), true);
    assertEquals(stats.mapMetaToAlt, true); // Enabled by default
    assertEquals(stats.mouseReporting, 'drag');
    assertEquals(stats.rawModeEnabled, false);
  });

});