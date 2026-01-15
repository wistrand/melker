// Tests for the dual-buffer system

import { assertEquals, assertNotEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  TerminalBuffer,
  DualBuffer,
  Cell,
  TerminalRenderer,
} from '../mod.ts';

Deno.test('TerminalBuffer creation and basic operations', () => {
  const buffer = new TerminalBuffer(10, 5);

  assertEquals(buffer.width, 10);
  assertEquals(buffer.height, 5);

  // Check default cells
  const cell = buffer.getCell(0, 0);
  assertEquals(cell?.char, ' ');
});

Deno.test('TerminalBuffer setCell and getCell', () => {
  const buffer = new TerminalBuffer(5, 5);

  const testCell: Cell = {
    char: 'A',
    foreground: 'red',
    bold: true,
  };

  buffer.setCell(2, 3, testCell);
  const retrieved = buffer.getCell(2, 3);

  assertEquals(retrieved?.char, 'A');
  assertEquals(retrieved?.foreground, 'red');
  assertEquals(retrieved?.bold, true);
});

Deno.test('TerminalBuffer bounds checking', () => {
  const buffer = new TerminalBuffer(3, 3);

  // Out of bounds should be handled gracefully
  buffer.setCell(-1, 0, { char: 'X' }); // Should not crash
  buffer.setCell(0, -1, { char: 'X' }); // Should not crash
  buffer.setCell(3, 0, { char: 'X' }); // Should not crash
  buffer.setCell(0, 3, { char: 'X' }); // Should not crash

  // Out of bounds get should return undefined
  assertEquals(buffer.getCell(-1, 0), undefined);
  assertEquals(buffer.getCell(3, 0), undefined);
});

Deno.test('TerminalBuffer setText', () => {
  const buffer = new TerminalBuffer(10, 3);

  buffer.setText(2, 1, 'Hello', { foreground: 'blue' });

  assertEquals(buffer.getCell(2, 1)?.char, 'H');
  assertEquals(buffer.getCell(3, 1)?.char, 'e');
  assertEquals(buffer.getCell(4, 1)?.char, 'l');
  assertEquals(buffer.getCell(5, 1)?.char, 'l');
  assertEquals(buffer.getCell(6, 1)?.char, 'o');

  // Check styling
  assertEquals(buffer.getCell(2, 1)?.foreground, 'blue');
  assertEquals(buffer.getCell(6, 1)?.foreground, 'blue');
});

Deno.test('TerminalBuffer setText with overflow', () => {
  const buffer = new TerminalBuffer(5, 2);

  // Text should be clipped at buffer boundary
  buffer.setText(3, 0, 'Hello World');

  assertEquals(buffer.getCell(3, 0)?.char, 'H');
  assertEquals(buffer.getCell(4, 0)?.char, 'e');
  assertEquals(buffer.getCell(0, 1)?.char, ' '); // Should be default
});

Deno.test('TerminalBuffer fillRect', () => {
  const buffer = new TerminalBuffer(5, 5);

  buffer.fillRect(1, 1, 3, 2, { char: '#', foreground: 'red' });

  // Check filled area
  for (let y = 1; y < 3; y++) {
    for (let x = 1; x < 4; x++) {
      assertEquals(buffer.getCell(x, y)?.char, '#');
      assertEquals(buffer.getCell(x, y)?.foreground, 'red');
    }
  }

  // Check unfilled areas remain default
  assertEquals(buffer.getCell(0, 0)?.char, ' ');
  assertEquals(buffer.getCell(4, 4)?.char, ' ');
});

Deno.test('TerminalBuffer drawBorder', () => {
  const buffer = new TerminalBuffer(5, 4);

  buffer.drawBorder(0, 0, 5, 4, { foreground: 'blue' }, 'thin');

  // Check corners
  assertEquals(buffer.getCell(0, 0)?.char, '┌');
  assertEquals(buffer.getCell(4, 0)?.char, '┐');
  assertEquals(buffer.getCell(0, 3)?.char, '└');
  assertEquals(buffer.getCell(4, 3)?.char, '┘');

  // Check edges
  assertEquals(buffer.getCell(2, 0)?.char, '─'); // Top
  assertEquals(buffer.getCell(2, 3)?.char, '─'); // Bottom
  assertEquals(buffer.getCell(0, 1)?.char, '│'); // Left
  assertEquals(buffer.getCell(4, 1)?.char, '│'); // Right

  // Check interior remains empty
  assertEquals(buffer.getCell(2, 1)?.char, ' ');

  // Check styling
  assertEquals(buffer.getCell(0, 0)?.foreground, 'blue');
});

Deno.test('TerminalBuffer border styles', () => {
  const buffer = new TerminalBuffer(3, 3);

  // Test thick border
  buffer.clear();
  buffer.drawBorder(0, 0, 3, 3, {}, 'thick');
  assertEquals(buffer.getCell(0, 0)?.char, '┏');
  assertEquals(buffer.getCell(1, 0)?.char, '━');

  // Test double border
  buffer.clear();
  buffer.drawBorder(0, 0, 3, 3, {}, 'double');
  assertEquals(buffer.getCell(0, 0)?.char, '╔');
  assertEquals(buffer.getCell(1, 0)?.char, '═');
});

Deno.test('TerminalBuffer diff calculation', () => {
  const buffer1 = new TerminalBuffer(3, 3);
  const buffer2 = new TerminalBuffer(3, 3);

  // Initially identical
  let diff = buffer1.diff(buffer2);
  assertEquals(diff.length, 0);

  // Make some changes to buffer2
  buffer2.setCell(0, 0, { char: 'A' });
  buffer2.setCell(2, 2, { char: 'B', foreground: 'red' });

  diff = buffer2.diff(buffer1);
  assertEquals(diff.length, 2);

  // Check diff details
  const diffA = diff.find(d => d.x === 0 && d.y === 0);
  const diffB = diff.find(d => d.x === 2 && d.y === 2);

  assert(diffA);
  assertEquals(diffA.cell.char, 'A');

  assert(diffB);
  assertEquals(diffB.cell.char, 'B');
  assertEquals(diffB.cell.foreground, 'red');
});

Deno.test('TerminalBuffer resize', () => {
  const buffer = new TerminalBuffer(3, 3);

  buffer.setText(0, 0, 'ABC');
  buffer.setText(0, 1, 'DEF');
  buffer.setText(0, 2, 'GHI');

  // Resize to larger
  buffer.resize(5, 5);
  assertEquals(buffer.width, 5);
  assertEquals(buffer.height, 5);

  // Check preserved content
  assertEquals(buffer.getCell(0, 0)?.char, 'A');
  assertEquals(buffer.getCell(2, 1)?.char, 'F');

  // Check new areas are empty
  assertEquals(buffer.getCell(3, 0)?.char, ' ');
  assertEquals(buffer.getCell(0, 3)?.char, ' ');

  // Resize to smaller
  buffer.resize(2, 2);
  assertEquals(buffer.width, 2);
  assertEquals(buffer.height, 2);

  // Check preserved content within new bounds
  assertEquals(buffer.getCell(0, 0)?.char, 'A');
  assertEquals(buffer.getCell(1, 1)?.char, 'E');
});

Deno.test('TerminalBuffer clone and copyFrom', () => {
  const original = new TerminalBuffer(3, 3);
  original.setText(0, 0, 'TEST');
  original.setCell(2, 2, { char: 'X', foreground: 'red' });

  const cloned = original.clone();

  assertEquals(cloned.width, original.width);
  assertEquals(cloned.height, original.height);
  assertEquals(cloned.getCell(0, 0)?.char, 'T');
  assertEquals(cloned.getCell(2, 2)?.char, 'X');
  assertEquals(cloned.getCell(2, 2)?.foreground, 'red');

  // Modify clone shouldn't affect original
  cloned.setCell(1, 1, { char: 'Y' });
  assertEquals(original.getCell(1, 1)?.char, ' ');
  assertEquals(cloned.getCell(1, 1)?.char, 'Y');
});

Deno.test('TerminalBuffer toString', () => {
  const buffer = new TerminalBuffer(5, 3);

  buffer.setText(0, 0, 'HELLO');
  buffer.setText(0, 1, 'WORLD');
  buffer.setText(0, 2, 'TEST!');

  const str = buffer.toString();
  const lines = str.split('\n');

  assertEquals(lines.length, 3);
  assertEquals(lines[0], 'HELLO');
  assertEquals(lines[1], 'WORLD');
  assertEquals(lines[2], 'TEST!');
});

Deno.test('DualBuffer creation and basic operations', () => {
  const dualBuffer = new DualBuffer(10, 5);

  assertEquals(dualBuffer.width, 10);
  assertEquals(dualBuffer.height, 5);
  assertEquals(dualBuffer.currentBuffer.width, 10);
  assertEquals(dualBuffer.currentBuffer.height, 5);
});

Deno.test('DualBuffer swapAndGetDiff', () => {
  const dualBuffer = new DualBuffer(3, 3);

  // Frame 1: Add some content
  dualBuffer.currentBuffer.setText(0, 0, 'ABC');
  const diff1 = dualBuffer.swapAndGetDiff();

  // Only 3 cells should be different from empty buffer (ABC)
  assertEquals(diff1.length, 3);

  // Frame 2: Minimal change
  dualBuffer.currentBuffer.setText(0, 0, 'ABX'); // Only last char changed
  const diff2 = dualBuffer.swapAndGetDiff();

  // Should only detect the one changed cell
  assertEquals(diff2.length, 1);
  assertEquals(diff2[0].x, 2);
  assertEquals(diff2[0].y, 0);
  assertEquals(diff2[0].cell.char, 'X');
});

Deno.test('DualBuffer forceRedraw', () => {
  const dualBuffer = new DualBuffer(3, 3);

  dualBuffer.currentBuffer.setText(0, 0, 'TEST');
  const forceDiff = dualBuffer.forceRedraw();

  // Force redraw should return all cells
  assertEquals(forceDiff.length, 9);

  // Next normal diff should show no changes
  const normalDiff = dualBuffer.swapAndGetDiff();
  assertEquals(normalDiff.length, 0);
});

Deno.test('DualBuffer resize', () => {
  const dualBuffer = new DualBuffer(3, 3);

  dualBuffer.resize(5, 4);

  assertEquals(dualBuffer.width, 5);
  assertEquals(dualBuffer.height, 4);
  assertEquals(dualBuffer.currentBuffer.width, 5);
  assertEquals(dualBuffer.currentBuffer.height, 4);
});

Deno.test('DualBuffer render options', () => {
  const dualBuffer = new DualBuffer(5, 5);

  const initialOptions = dualBuffer.renderOptions;
  assertEquals(initialOptions.cursorVisible, false);

  dualBuffer.setRenderOptions({
    cursorVisible: true,
    cursorX: 10,
    cursorY: 5,
    title: 'Test Window',
  });

  const updatedOptions = dualBuffer.renderOptions;
  assertEquals(updatedOptions.cursorVisible, true);
  assertEquals(updatedOptions.cursorX, 10);
  assertEquals(updatedOptions.cursorY, 5);
  assertEquals(updatedOptions.title, 'Test Window');
});

Deno.test('DualBuffer statistics', () => {
  const dualBuffer = new DualBuffer(10, 10);

  let stats = dualBuffer.getStats();
  assertEquals(stats.totalCells, 100);
  assertEquals(stats.nonEmptyCells, 0);
  assertEquals(stats.bufferUtilization, 0);

  // Add some content
  dualBuffer.currentBuffer.setText(0, 0, 'Hello Test');

  stats = dualBuffer.getStats();
  assertEquals(stats.totalCells, 100);
  assertEquals(stats.nonEmptyCells, 9); // "Hello Test" = 9 non-space chars
  assertEquals(stats.bufferUtilization, 0.09);
});

Deno.test('TerminalRenderer creation and options', () => {
  const renderer = new TerminalRenderer({
    colorSupport: '256',
    enableMouse: true,
    alternateScreen: false,
  });

  const options = renderer.options;
  assertEquals(options.colorSupport, '256');
  assertEquals(options.enableMouse, true);
  assertEquals(options.alternateScreen, false);
  assertEquals(options.enableKeypad, true); // Default
});

Deno.test('TerminalRenderer initialization state', () => {
  const renderer = new TerminalRenderer();

  assertEquals(renderer.isInitialized, false);
});

// Note: We can't easily test the actual terminal output without mocking,
// but we can test the public interface and logic