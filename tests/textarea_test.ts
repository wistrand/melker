// Tests for textarea component

import { assertEquals, assertExists, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { TextareaElement, TextareaProps } from '../src/components/textarea.ts';

Deno.test('Textarea element can be instantiated', () => {
  const textarea = new TextareaElement();
  assertExists(textarea);
  assertEquals(textarea.type, 'textarea');
});

Deno.test('Textarea element has default props', () => {
  const textarea = new TextareaElement();
  assertEquals(textarea.props.value, '');
  assertEquals(textarea.props.placeholder, '');
  assertEquals(textarea.props.readOnly, false);
  assertEquals(textarea.props.disabled, false);
  assertEquals(textarea.props.rows, undefined); // rows is undefined by default (expandable mode)
  assertEquals(textarea.props.cols, 40);
  assertEquals(textarea.props.wrap, 'soft');
});

Deno.test('Textarea element accepts custom props', () => {
  const textarea = new TextareaElement({
    value: 'Hello\nWorld',
    placeholder: 'Enter text...',
    rows: 10,
    cols: 80,
    wrap: 'off',
    maxLength: 500,
  });
  assertEquals(textarea.props.value, 'Hello\nWorld');
  assertEquals(textarea.props.placeholder, 'Enter text...');
  assertEquals(textarea.props.rows, 10);
  assertEquals(textarea.props.cols, 80);
  assertEquals(textarea.props.wrap, 'off');
  assertEquals(textarea.props.maxLength, 500);
});

Deno.test('Textarea validates props correctly', () => {
  assertEquals(TextareaElement.validate({ value: 'test' }), true);
  assertEquals(TextareaElement.validate({ maxLength: 100 }), true);
  assertEquals(TextareaElement.validate({ rows: 5 }), true);
  assertEquals(TextareaElement.validate({ cols: 60 }), true);
  assertEquals(TextareaElement.validate({}), true);

  // Invalid props
  assertEquals(TextareaElement.validate({ maxLength: -1 }), false);
  assertEquals(TextareaElement.validate({ rows: 0 }), false);
  assertEquals(TextareaElement.validate({ cols: -5 }), false);
  assertEquals(TextareaElement.validate({ value: 123 as any }), false);
});

Deno.test('Textarea getValue and setValue', () => {
  const textarea = new TextareaElement({ value: 'initial' });
  assertEquals(textarea.getValue(), 'initial');

  textarea.setValue('new value');
  assertEquals(textarea.getValue(), 'new value');
  assertEquals(textarea.getCursorPosition(), 9); // At end of 'new value'

  textarea.setValue('test', 2);
  assertEquals(textarea.getValue(), 'test');
  assertEquals(textarea.getCursorPosition(), 2);
});

Deno.test('Textarea getLineCount', () => {
  const textarea = new TextareaElement({ value: 'line1\nline2\nline3' });
  assertEquals(textarea.getLineCount(), 3);

  textarea.setValue('single line');
  assertEquals(textarea.getLineCount(), 1);

  textarea.setValue('');
  assertEquals(textarea.getLineCount(), 1); // Empty string splits to ['']
});

Deno.test('Textarea handles character input', () => {
  const textarea = new TextareaElement({ value: '' });

  textarea.handleKeyInput('H', false, false);
  assertEquals(textarea.getValue(), 'H');

  textarea.handleKeyInput('i', false, false);
  assertEquals(textarea.getValue(), 'Hi');

  assertEquals(textarea.getCursorPosition(), 2);
  textarea.cleanup();
});

Deno.test('Textarea handles Enter key for newlines', () => {
  const textarea = new TextareaElement({ value: 'line1' });
  textarea.setCursorPosition(5);

  textarea.handleKeyInput('Enter', false, false);
  assertEquals(textarea.getValue(), 'line1\n');

  textarea.handleKeyInput('l', false, false);
  textarea.handleKeyInput('i', false, false);
  textarea.handleKeyInput('n', false, false);
  textarea.handleKeyInput('e', false, false);
  textarea.handleKeyInput('2', false, false);
  assertEquals(textarea.getValue(), 'line1\nline2');
  assertEquals(textarea.getLineCount(), 2);
  textarea.cleanup();
});

Deno.test('Textarea handles Backspace', () => {
  const textarea = new TextareaElement({ value: 'Hello' });
  textarea.setCursorPosition(5);

  textarea.handleKeyInput('Backspace', false, false);
  assertEquals(textarea.getValue(), 'Hell');

  textarea.handleKeyInput('Backspace', false, false);
  assertEquals(textarea.getValue(), 'Hel');
  textarea.cleanup();
});

Deno.test('Textarea handles Delete', () => {
  const textarea = new TextareaElement({ value: 'Hello' });
  textarea.setCursorPosition(0);

  textarea.handleKeyInput('Delete', false, false);
  assertEquals(textarea.getValue(), 'ello');

  textarea.handleKeyInput('Delete', false, false);
  assertEquals(textarea.getValue(), 'llo');
  textarea.cleanup();
});

Deno.test('Textarea handles arrow keys', () => {
  const textarea = new TextareaElement({ value: 'abc' });
  textarea.setCursorPosition(3);

  textarea.handleKeyInput('ArrowLeft', false, false);
  assertEquals(textarea.getCursorPosition(), 2);

  textarea.handleKeyInput('ArrowLeft', false, false);
  assertEquals(textarea.getCursorPosition(), 1);

  textarea.handleKeyInput('ArrowRight', false, false);
  assertEquals(textarea.getCursorPosition(), 2);
  textarea.cleanup();
});

Deno.test('Textarea handles Home and End', () => {
  const textarea = new TextareaElement({ value: 'line1\nline2' });
  textarea.setCursorPosition(8); // Middle of line2

  textarea.handleKeyInput('Home', false, false);
  // Should go to start of current display line
  assertEquals(textarea.getCursorPosition(), 6); // Start of 'line2'

  textarea.handleKeyInput('End', false, false);
  // Should go to end of current display line
  assertEquals(textarea.getCursorPosition(), 11); // End of 'line2'
  textarea.cleanup();
});

Deno.test('Textarea handles Ctrl+Home and Ctrl+End', () => {
  const textarea = new TextareaElement({ value: 'line1\nline2\nline3' });
  textarea.setCursorPosition(8);

  textarea.handleKeyInput('Home', true, false);
  assertEquals(textarea.getCursorPosition(), 0); // Start of text

  textarea.handleKeyInput('End', true, false);
  assertEquals(textarea.getCursorPosition(), 17); // End of text
  textarea.cleanup();
});

Deno.test('Textarea handles vertical navigation', () => {
  const textarea = new TextareaElement({ value: 'abc\ndef\nghi', cols: 40 });

  textarea.setCursorPosition(1); // Position at 'b' in first line

  textarea.handleKeyInput('ArrowDown', false, false);
  assertEquals(textarea.getCursorPosition(), 5); // Position at 'e' in second line

  textarea.handleKeyInput('ArrowDown', false, false);
  assertEquals(textarea.getCursorPosition(), 9); // Position at 'h' in third line

  textarea.handleKeyInput('ArrowUp', false, false);
  assertEquals(textarea.getCursorPosition(), 5); // Back to 'e'
});

Deno.test('Textarea Emacs keybindings - navigation', () => {
  const textarea = new TextareaElement({ value: 'test' });
  textarea.setCursorPosition(2);

  // Ctrl+F - forward
  textarea.handleKeyInput('f', true, false);
  assertEquals(textarea.getCursorPosition(), 3);

  // Ctrl+B - backward
  textarea.handleKeyInput('b', true, false);
  assertEquals(textarea.getCursorPosition(), 2);

  // Ctrl+A - beginning of line
  textarea.handleKeyInput('a', true, false);
  assertEquals(textarea.getCursorPosition(), 0);

  // Ctrl+E - end of line
  textarea.handleKeyInput('e', true, false);
  assertEquals(textarea.getCursorPosition(), 4);
  textarea.cleanup();
});

Deno.test('Textarea Emacs keybindings - Ctrl+N and Ctrl+P', () => {
  const textarea = new TextareaElement({ value: 'line1\nline2\nline3', cols: 40 });
  textarea.setCursorPosition(2); // At 'n' in line1

  // Ctrl+N - next line
  textarea.handleKeyInput('n', true, false);
  assertEquals(textarea.getCursorPosition(), 8); // At 'n' in line2

  // Ctrl+P - previous line
  textarea.handleKeyInput('p', true, false);
  assertEquals(textarea.getCursorPosition(), 2); // Back to 'n' in line1
});

Deno.test('Textarea Emacs keybindings - Ctrl+D delete', () => {
  const textarea = new TextareaElement({ value: 'hello' });
  textarea.setCursorPosition(0);

  textarea.handleKeyInput('d', true, false);
  assertEquals(textarea.getValue(), 'ello');
  textarea.cleanup();
});

Deno.test('Textarea Emacs keybindings - Ctrl+K kill to end of line', () => {
  const textarea = new TextareaElement({ value: 'hello world' });
  textarea.setCursorPosition(6); // After 'hello '

  textarea.handleKeyInput('k', true, false);
  assertEquals(textarea.getValue(), 'hello ');
  textarea.cleanup();
});

Deno.test('Textarea Emacs keybindings - Ctrl+U kill to start of line', () => {
  const textarea = new TextareaElement({ value: 'hello world' });
  textarea.setCursorPosition(6); // After 'hello '

  textarea.handleKeyInput('u', true, false);
  assertEquals(textarea.getValue(), 'world');
  assertEquals(textarea.getCursorPosition(), 0);
  textarea.cleanup();
});

Deno.test('Textarea Emacs keybindings - Ctrl+Y yank', () => {
  const textarea = new TextareaElement({ value: 'hello world' });
  textarea.setCursorPosition(5); // After 'hello'

  // Kill ' world'
  textarea.handleKeyInput('k', true, false);
  assertEquals(textarea.getValue(), 'hello');

  // Move to start and yank
  textarea.handleKeyInput('a', true, false);
  textarea.handleKeyInput('y', true, false);
  assertEquals(textarea.getValue(), ' worldhello');
  textarea.cleanup();
});

Deno.test('Textarea Emacs keybindings - Ctrl+W kill word', () => {
  const textarea = new TextareaElement({ value: 'hello world' });
  textarea.setCursorPosition(11); // At end

  textarea.handleKeyInput('w', true, false);
  assertEquals(textarea.getValue(), 'hello ');
  assertEquals(textarea.getCursorPosition(), 6);
  textarea.cleanup();
});

Deno.test('Textarea respects maxLength', () => {
  const textarea = new TextareaElement({ value: '', maxLength: 5 });

  textarea.handleKeyInput('a', false, false);
  textarea.handleKeyInput('b', false, false);
  textarea.handleKeyInput('c', false, false);
  textarea.handleKeyInput('d', false, false);
  textarea.handleKeyInput('e', false, false);
  assertEquals(textarea.getValue(), 'abcde');

  // Should not add more
  textarea.handleKeyInput('f', false, false);
  assertEquals(textarea.getValue(), 'abcde');
  textarea.cleanup();
});

Deno.test('Textarea respects readOnly', () => {
  const textarea = new TextareaElement({ value: 'readonly', readOnly: true });

  const result = textarea.handleKeyInput('x', false, false);
  assertEquals(result, false);
  assertEquals(textarea.getValue(), 'readonly');
});

Deno.test('Textarea respects disabled', () => {
  const textarea = new TextareaElement({ value: 'disabled', disabled: true });

  const result = textarea.handleKeyInput('x', false, false);
  assertEquals(result, false);
  assertEquals(textarea.getValue(), 'disabled');
});

Deno.test('Textarea insertText method', () => {
  const textarea = new TextareaElement({ value: 'hello' });
  textarea.setCursorPosition(5);

  textarea.insertText(' world');
  assertEquals(textarea.getValue(), 'hello world');
  assertEquals(textarea.getCursorPosition(), 11);
  textarea.cleanup();
});

Deno.test('Textarea insertText respects maxLength', () => {
  const textarea = new TextareaElement({ value: 'hi', maxLength: 5 });
  textarea.setCursorPosition(2);

  textarea.insertText('12345');
  assertEquals(textarea.getValue(), 'hi123'); // Truncated to maxLength
  textarea.cleanup();
});

Deno.test('Textarea canReceiveFocus', () => {
  const normalTextarea = new TextareaElement();
  assertEquals(normalTextarea.canReceiveFocus(), true);

  const disabledTextarea = new TextareaElement({ disabled: true });
  assertEquals(disabledTextarea.canReceiveFocus(), false);

  const readOnlyTextarea = new TextareaElement({ readOnly: true });
  assertEquals(readOnlyTextarea.canReceiveFocus(), false);
});

Deno.test('Textarea intrinsicSize with rows', () => {
  const textarea = new TextareaElement({ rows: 10, cols: 50 });
  const size = textarea.intrinsicSize({} as any);
  assertEquals(size.width, 50);
  assertEquals(size.height, 10);
});

Deno.test('Textarea intrinsicSize without rows expands to content', () => {
  const textarea = new TextareaElement({ value: 'line1\nline2\nline3', cols: 40 });
  // Remove rows to test content expansion
  textarea.props.rows = undefined;
  const size = textarea.intrinsicSize({} as any);
  assertEquals(size.width, 40);
  assertEquals(size.height, 3); // 3 lines of content
});

Deno.test('Textarea handles Escape to clear', () => {
  const textarea = new TextareaElement({ value: 'some text' });

  textarea.handleKeyInput('Escape', false, false);
  assertEquals(textarea.getValue(), '');
  assertEquals(textarea.getCursorPosition(), 0);
  textarea.cleanup();
});

Deno.test('Textarea handles PageUp and PageDown', () => {
  const textarea = new TextareaElement({
    value: 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8',
    rows: 4,
    cols: 40,
  });
  textarea.setCursorPosition(0); // Start at beginning

  textarea.handleKeyInput('PageDown', false, false);
  // Should move down by 4 rows (the rows value)
  const posAfterPageDown = textarea.getCursorPosition();
  assert(posAfterPageDown > 0); // Should have moved

  textarea.handleKeyInput('PageUp', false, false);
  // Should move back
  assertEquals(textarea.getCursorPosition(), 0);
  textarea.cleanup();
});

Deno.test('Textarea onChange callback is triggered', async () => {
  let changeCount = 0;
  let lastValue = '';

  const textarea = new TextareaElement({
    value: '',
    onChange: (event: any) => {
      changeCount++;
      lastValue = event.value;
    },
  });

  textarea.handleKeyInput('a', false, false);
  // onChange is debounced (50ms), so wait for it
  await new Promise(resolve => setTimeout(resolve, 60));
  assertEquals(changeCount, 1);
  assertEquals(lastValue, 'a');

  textarea.handleKeyInput('b', false, false);
  await new Promise(resolve => setTimeout(resolve, 60));
  assertEquals(changeCount, 2);
  assertEquals(lastValue, 'ab');
  textarea.cleanup();
});

Deno.test('Textarea getDisplayLineCount with wrapping', () => {
  const textarea = new TextareaElement({
    value: 'This is a long line that should wrap',
    cols: 10,
    wrap: 'soft',
  });

  const displayLines = textarea.getDisplayLineCount(10);
  // 'This is a long line that should wrap' is 36 chars
  // At width 10, should wrap to 4 lines (36/10 = 3.6, ceil = 4)
  assertEquals(displayLines, 4);
});

Deno.test('Textarea getDisplayLineCount without wrapping', () => {
  const textarea = new TextareaElement({
    value: 'This is a long line',
    cols: 10,
    wrap: 'off',
  });

  const displayLines = textarea.getDisplayLineCount(10);
  // With wrap='off', no wrapping occurs
  assertEquals(displayLines, 1);
});
