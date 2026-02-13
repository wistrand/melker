// Textarea component implementation - multiline text input

import { Element, BaseProps, Renderable, Focusable, Interactive, TextSelectable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import { type DualBuffer, type Cell, type DiffCollector, EMPTY_CHAR } from '../buffer.ts';
import { type KeyPressEvent, createKeyPressEvent, createChangeEvent } from '../events.ts';
import { getThemeColor } from '../theme.ts';
import { createDebouncedAction, type DebouncedAction } from '../utils/timing.ts';
import { COLORS, parseColor } from './color-utils.ts';
import { clamp } from '../geometry.ts';

export interface TextareaProps extends BaseProps {
  value?: string;
  placeholder?: string;
  maxLength?: number;
  readOnly?: boolean;
  rows?: number;      // Visible rows (default: 4)
  cols?: number;      // Visible columns for intrinsic width (default: 40)
  wrap?: 'soft' | 'off';  // soft=visual wrap (default), off=no wrap
  onKeyPress?: (event: KeyPressEvent) => boolean | void;  // Return true to prevent default
}

// Shared kill buffer for emacs-style Ctrl+Y yank (shared with input.ts)
let _killBuffer: string = '';

interface DisplayLine {
  text: string;
  logicalLineIndex: number;  // Which \n-delimited line this came from
  offsetInLogical: number;   // Character offset within logical line
  absoluteStart: number;     // Start position in _value
}

export class TextareaElement extends Element implements Renderable, Focusable, Interactive, TextSelectable {
  declare type: 'textarea';
  declare props: TextareaProps;
  private _value: string;
  private _cursorPos: number;
  private _scrollY: number = 0;
  private _needsRender: boolean = false;
  private _cachedDisplayLines: DisplayLine[] | null = null;
  private _cachedWidth: number = 0;
  private _lastRenderedHeight: number = 0;
  private _heightStabilized: boolean = false;
  // Debounced action for change notifications (50ms batching for paste)
  private _debouncedChangeAction: DebouncedAction;
  private _pendingChars: string = ''; // Buffer for batching rapid character input
  // Debounced action for flushing pending chars (5ms batching)
  private _debouncedFlushCharsAction: DebouncedAction;

  constructor(props: TextareaProps = {}, children: Element[] = []) {
    const defaultProps: TextareaProps = {
      value: '',
      placeholder: '',
      readOnly: false,
      disabled: false,
      tabIndex: 0,
      // rows: undefined - omit to allow expandable mode
      cols: 40,
      wrap: 'soft',
      ...props,
      style: {
        ...props.style
      },
    };

    super('textarea', defaultProps, children);
    this._value = defaultProps.value || '';
    this._cursorPos = 0;

    // Initialize debounced change notification (50ms batching for paste operations)
    this._debouncedChangeAction = createDebouncedAction(() => {
      if (typeof this.props.onChange === 'function') {
        this.props.onChange(createChangeEvent(this._value, this.id));
      }
    }, 50);

    // Initialize debounced char flush (5ms batching for rapid character input)
    this._debouncedFlushCharsAction = createDebouncedAction(() => {
      this._flushPendingCharsInternal();
    }, 5);
  }

  /**
   * Split text into logical lines (by newline) then wrap each line
   */
  private _computeDisplayLines(width: number): DisplayLine[] {
    if (this._cachedDisplayLines && this._cachedWidth === width) {
      return this._cachedDisplayLines;
    }

    const displayLines: DisplayLine[] = [];
    const logicalLines = this._value.split('\n');
    let absolutePos = 0;

    for (let lineIdx = 0; lineIdx < logicalLines.length; lineIdx++) {
      const line = logicalLines[lineIdx];

      if (this.props.wrap === 'off' || line.length <= width || width <= 0) {
        // No wrapping or line fits
        displayLines.push({
          text: line,
          logicalLineIndex: lineIdx,
          offsetInLogical: 0,
          absoluteStart: absolutePos,
        });
      } else {
        // Wrap line at width boundary
        let offset = 0;
        while (offset < line.length) {
          const chunk = line.substring(offset, offset + width);
          displayLines.push({
            text: chunk,
            logicalLineIndex: lineIdx,
            offsetInLogical: offset,
            absoluteStart: absolutePos + offset,
          });
          offset += width;
        }
        // Handle empty line case
        if (line.length === 0) {
          displayLines.push({
            text: '',
            logicalLineIndex: lineIdx,
            offsetInLogical: 0,
            absoluteStart: absolutePos,
          });
        }
      }

      absolutePos += line.length + 1; // +1 for the newline
    }

    // Ensure at least one line
    if (displayLines.length === 0) {
      displayLines.push({
        text: '',
        logicalLineIndex: 0,
        offsetInLogical: 0,
        absoluteStart: 0,
      });
    }

    this._cachedDisplayLines = displayLines;
    this._cachedWidth = width;
    return displayLines;
  }

  /**
   * Invalidate display line cache and reset height stabilization
   */
  private _invalidateCache(): void {
    this._cachedDisplayLines = null;
    this._heightStabilized = false; // Allow two-pass layout on next render
  }

  /**
   * Debounced change notification - batches rapid input (like paste)
   */
  private _notifyChange(): void {
    this._debouncedChangeAction.call();
  }

  /**
   * Internal flush implementation - called by debounced action
   */
  private _flushPendingCharsInternal(): void {
    if (this._pendingChars.length === 0) return;

    const chars = this._pendingChars;
    this._pendingChars = '';

    // Check max length
    let toInsert = chars;
    if (this.props.maxLength) {
      const available = this.props.maxLength - this._value.length;
      if (available <= 0) return;
      if (toInsert.length > available) {
        toInsert = toInsert.slice(0, available);
      }
    }

    // Single string operation for all batched chars
    this._value = this._value.slice(0, this._cursorPos) + toInsert + this._value.slice(this._cursorPos);
    this._cursorPos += toInsert.length;
    this.props.value = this._value;
    this._needsRender = true;
    this._invalidateCache();
    this._notifyChange();
  }

  /**
   * Flush pending character buffer - inserts accumulated chars in one operation
   */
  private _flushPendingChars(): void {
    // Cancel the debounced action and execute immediately
    this._debouncedFlushCharsAction.flush();
  }

  /**
   * Queue a character for batched insertion (used during paste)
   */
  private _queueChar(char: string): boolean {
    this._pendingChars += char;
    this._debouncedFlushCharsAction.call();
    return true;
  }

  /**
   * Convert cursor position to display row/col
   */
  private _cursorToDisplayPos(width: number): { row: number; col: number } {
    const displayLines = this._computeDisplayLines(width);
    let pos = 0;

    for (let row = 0; row < displayLines.length; row++) {
      const line = displayLines[row];
      const lineEnd = line.absoluteStart + line.text.length;

      // Check if cursor is in this line
      if (this._cursorPos >= line.absoluteStart && this._cursorPos <= lineEnd) {
        return { row, col: this._cursorPos - line.absoluteStart };
      }

      // Handle newline position (cursor at end of logical line before newline)
      if (row < displayLines.length - 1) {
        const nextLine = displayLines[row + 1];
        if (nextLine.logicalLineIndex !== line.logicalLineIndex) {
          // Next line is a different logical line, so there's a newline between
          if (this._cursorPos === lineEnd) {
            return { row, col: line.text.length };
          }
        }
      }
    }

    // Cursor at end
    const lastRow = displayLines.length - 1;
    return { row: lastRow, col: displayLines[lastRow].text.length };
  }

  /**
   * Convert display row/col to cursor position
   */
  private _displayPosToCursor(row: number, col: number, width: number): number {
    const displayLines = this._computeDisplayLines(width);

    // Handle empty displayLines (shouldn't happen, but be defensive)
    if (displayLines.length === 0) {
      return 0;
    }

    if (row < 0) row = 0;
    if (row >= displayLines.length) row = displayLines.length - 1;

    const line = displayLines[row];
    // Defensive check in case line is somehow undefined
    if (!line) {
      return 0;
    }

    const maxCol = line.text.length;
    if (col > maxCol) col = maxCol;
    if (col < 0) col = 0;

    return line.absoluteStart + col;
  }

  /**
   * Render the textarea to the terminal buffer
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Flush any pending batched chars before rendering
    if (this._pendingChars.length > 0) {
      this._flushPendingChars();
    }

    // Sync props.value to internal _value if changed externally (e.g., by state persistence)
    if (this.props.value !== undefined && this.props.value !== this._value) {
      this._value = this.props.value;
      this._invalidateCache();
      // Clamp cursor position to valid range
      if (this._cursorPos > this._value.length) {
        this._cursorPos = this._value.length;
      }
    }

    const value = this._value;
    const { placeholder } = this.props;

    // Use element style properties, with fallbacks
    const elementStyle = this.props.style || {};
    const textareaStyle: any = {
      ...style,
      background: elementStyle.background || getThemeColor('inputBackground'),
      foreground: value ? (elementStyle.color || getThemeColor('inputForeground')) : getThemeColor('textMuted'),
    };

    // Clear the textarea area
    buffer.currentBuffer.fillRect(bounds.x, bounds.y, bounds.width, bounds.height, {
      char: EMPTY_CHAR,
      background: textareaStyle.background,
      foreground: textareaStyle.foreground,
    });

    const displayLines = this._computeDisplayLines(bounds.width);
    const isFocused = context.focusedElementId === this.id;

    // Only use internal scroll if rows is set (fixed height mode)
    // Otherwise render all lines and let parent container handle scrolling
    const useInternalScroll = this.props.rows !== undefined;

    // Adjust scroll to keep cursor visible (only in internal scroll mode)
    if (useInternalScroll && isFocused) {
      const cursorDisplay = this._cursorToDisplayPos(bounds.width);
      if (cursorDisplay.row < this._scrollY) {
        this._scrollY = cursorDisplay.row;
      } else if (cursorDisplay.row >= this._scrollY + bounds.height) {
        this._scrollY = cursorDisplay.row - bounds.height + 1;
      }
    } else if (!useInternalScroll) {
      this._scrollY = 0; // No internal scroll
    }

    // Determine how many lines to render
    const linesToRender = useInternalScroll ? bounds.height : displayLines.length;

    // Show placeholder if empty
    if (!value && placeholder) {
      const placeholderStyle = { ...textareaStyle, foreground: COLORS.gray };
      const placeholderLines = placeholder.split('\n');
      for (let y = 0; y < Math.min(placeholderLines.length, linesToRender); y++) {
        const text = placeholderLines[y].substring(0, bounds.width);
        buffer.currentBuffer.setText(bounds.x, bounds.y + y, text, placeholderStyle);
      }
    } else {
      // Render lines
      for (let y = 0; y < linesToRender; y++) {
        const lineIdx = this._scrollY + y;
        if (lineIdx < displayLines.length) {
          const line = displayLines[lineIdx];
          const text = line.text.substring(0, bounds.width);
          buffer.currentBuffer.setText(bounds.x, bounds.y + y, text, textareaStyle);
        }
      }
    }

    // Render cursor when focused
    if (isFocused) {
      const cursorDisplay = this._cursorToDisplayPos(bounds.width);
      const cursorScreenY = cursorDisplay.row - this._scrollY;

      // In external scroll mode, render cursor at absolute position (parent clips)
      // In internal scroll mode, only render if within bounds
      const maxY = useInternalScroll ? bounds.height : displayLines.length;
      if (cursorScreenY >= 0 && cursorScreenY < maxY) {
        const cursorX = bounds.x + Math.min(cursorDisplay.col, bounds.width - 1);
        const cursorY = bounds.y + cursorScreenY;

        // Get the character at cursor position
        const lineIdx = cursorDisplay.row;
        const line = displayLines[lineIdx];
        const hasCharAtCursor = line && cursorDisplay.col < line.text.length;

        // Use reverse video for cursor - works universally across all terminals and themes
        if (hasCharAtCursor) {
          // Show the character with reverse video (swaps fg/bg)
          buffer.currentBuffer.setText(cursorX, cursorY, line.text[cursorDisplay.col], {
            foreground: textareaStyle.foreground,
            background: textareaStyle.background,
            reverse: true,
          });
        } else {
          // At empty position: use space with reverse video to show cursor block
          buffer.currentBuffer.setText(cursorX, cursorY, ' ', {
            foreground: textareaStyle.foreground,
            background: textareaStyle.background,
            reverse: true,
          });
        }
      }
    }

    // Track content height for scrollable parent containers
    const previousHeight = this._lastRenderedHeight;
    this._lastRenderedHeight = displayLines.length;

    // If height changed and not yet stabilized, request re-layout
    // This implements "two-pass" layout for scrollable containers
    if (this._lastRenderedHeight !== previousHeight && !this._heightStabilized) {
      this._heightStabilized = true;

      // Request re-render for layout update
      if (context.requestRender) {
        setTimeout(() => {
          context.requestRender?.();
        }, 10);
      }
    } else if (this._lastRenderedHeight === previousHeight && previousHeight > 0) {
      this._heightStabilized = true;
    }

    this._needsRender = false;
  }

  /**
   * Handle keyboard input
   */
  handleKeyInput(key: string, ctrlKey: boolean = false, altKey: boolean = false, shiftKey: boolean = false): boolean {
    if (this.props.readOnly || this.props.disabled) {
      return false;
    }

    // Trigger onKeyPress callback if defined
    // If it returns true, prevent default textarea behavior
    if (typeof this.props.onKeyPress === 'function') {
      const preventDefault = this.props.onKeyPress(createKeyPressEvent(key, {
        target: this.id,
        ctrlKey,
        altKey,
        shiftKey,
      }));
      if (preventDefault === true) {
        return true;  // Event handled, don't process further
      }
    }

    // For control keys (not regular chars), flush any pending batched chars first
    const isRegularChar = key.length >= 1 && !ctrlKey && !altKey && key.charCodeAt(0) >= 32;
    if (!isRegularChar && this._pendingChars.length > 0) {
      this._flushPendingChars();
    }

    let changed = false;
    let value = this._value;
    let cursor = this._cursorPos;

    const isBackspace = key === 'Backspace' ||
                       (key.length === 1 && key.charCodeAt(0) === 8) ||
                       (key.length === 1 && key.charCodeAt(0) === 127) ||
                       (ctrlKey && key.toLowerCase() === 'h');

    if (isBackspace) {
      if (cursor > 0) {
        value = value.slice(0, cursor - 1) + value.slice(cursor);
        cursor = cursor - 1;
        changed = true;
      }
    } else if (key === 'Delete') {
      if (cursor < value.length) {
        value = value.slice(0, cursor) + value.slice(cursor + 1);
        changed = true;
      }
    } else if (key === 'ArrowLeft') {
      if (cursor > 0) {
        cursor = cursor - 1;
        changed = true;
      }
    } else if (key === 'ArrowRight') {
      if (cursor < value.length) {
        cursor = cursor + 1;
        changed = true;
      }
    } else if (key === 'ArrowUp') {
      // Move to same column in previous display line
      const width = this._cachedWidth || 40;
      const pos = this._cursorToDisplayPos(width);
      if (pos.row > 0) {
        const newCursor = this._displayPosToCursor(pos.row - 1, pos.col, width);
        if (newCursor !== this._cursorPos) {
          this._cursorPos = newCursor;
          this._needsRender = true;
        }
      }
      return true; // Consume event even if no change
    } else if (key === 'ArrowDown') {
      // Move to same column in next display line
      const width = this._cachedWidth || 40;
      const displayLines = this._computeDisplayLines(width);
      const pos = this._cursorToDisplayPos(width);
      if (pos.row < displayLines.length - 1) {
        const newCursor = this._displayPosToCursor(pos.row + 1, pos.col, width);
        if (newCursor !== this._cursorPos) {
          this._cursorPos = newCursor;
          this._needsRender = true;
        }
      }
      return true; // Consume event even if no change
    } else if (key === 'Home') {
      if (ctrlKey) {
        // Ctrl+Home: start of text
        cursor = 0;
      } else {
        // Home: start of current display line
        const width = this._cachedWidth || 40;
        const pos = this._cursorToDisplayPos(width);
        cursor = this._displayPosToCursor(pos.row, 0, width);
      }
      changed = true;
    } else if (key === 'End') {
      if (ctrlKey) {
        // Ctrl+End: end of text
        cursor = value.length;
      } else {
        // End: end of current display line
        const width = this._cachedWidth || 40;
        const displayLines = this._computeDisplayLines(width);
        const pos = this._cursorToDisplayPos(width);
        cursor = this._displayPosToCursor(pos.row, displayLines[pos.row].text.length, width);
      }
      changed = true;
    } else if (key === 'PageUp') {
      const height = this.props.rows || 4;
      const width = this._cachedWidth || 40;
      const pos = this._cursorToDisplayPos(width);
      const newRow = Math.max(0, pos.row - height);
      cursor = this._displayPosToCursor(newRow, pos.col, width);
      changed = true;
    } else if (key === 'PageDown') {
      const height = this.props.rows || 4;
      const width = this._cachedWidth || 40;
      const displayLines = this._computeDisplayLines(width);
      const pos = this._cursorToDisplayPos(width);
      const newRow = Math.min(displayLines.length - 1, pos.row + height);
      cursor = this._displayPosToCursor(newRow, pos.col, width);
      changed = true;
    } else if (key === 'Escape') {
      // Clear text
      value = '';
      cursor = 0;
      changed = true;
    } else if (key === 'a' && ctrlKey) {
      // Emacs: Ctrl+A - move to beginning of current line
      const width = this._cachedWidth || 40;
      const pos = this._cursorToDisplayPos(width);
      cursor = this._displayPosToCursor(pos.row, 0, width);
      changed = true;
    } else if (key === 'e' && ctrlKey) {
      // Emacs: Ctrl+E - move to end of current line
      const width = this._cachedWidth || 40;
      const displayLines = this._computeDisplayLines(width);
      const pos = this._cursorToDisplayPos(width);
      cursor = this._displayPosToCursor(pos.row, displayLines[pos.row].text.length, width);
      changed = true;
    } else if (key === 'f' && ctrlKey) {
      // Emacs: Ctrl+F - move forward one character
      if (cursor < value.length) {
        cursor = cursor + 1;
        changed = true;
      }
    } else if (key === 'b' && ctrlKey) {
      // Emacs: Ctrl+B - move backward one character
      if (cursor > 0) {
        cursor = cursor - 1;
        changed = true;
      }
    } else if (key === 'n' && ctrlKey) {
      // Emacs: Ctrl+N - next line
      const width = this._cachedWidth || 40;
      const displayLines = this._computeDisplayLines(width);
      const pos = this._cursorToDisplayPos(width);
      if (pos.row < displayLines.length - 1) {
        const newCursor = this._displayPosToCursor(pos.row + 1, pos.col, width);
        if (newCursor !== this._cursorPos) {
          this._cursorPos = newCursor;
          this._needsRender = true;
        }
      }
      return true;
    } else if (key === 'p' && ctrlKey) {
      // Emacs: Ctrl+P - previous line
      const width = this._cachedWidth || 40;
      const pos = this._cursorToDisplayPos(width);
      if (pos.row > 0) {
        const newCursor = this._displayPosToCursor(pos.row - 1, pos.col, width);
        if (newCursor !== this._cursorPos) {
          this._cursorPos = newCursor;
          this._needsRender = true;
        }
      }
      return true;
    } else if (key === 'd' && ctrlKey) {
      // Emacs: Ctrl+D - delete character at cursor
      if (cursor < value.length) {
        value = value.slice(0, cursor) + value.slice(cursor + 1);
        changed = true;
      }
    } else if (key === 'k' && ctrlKey) {
      // Emacs: Ctrl+K - kill from cursor to end of line
      const width = this._cachedWidth || 40;
      const displayLines = this._computeDisplayLines(width);
      const pos = this._cursorToDisplayPos(width);
      const line = displayLines[pos.row];
      const lineEnd = line.absoluteStart + line.text.length;

      if (cursor < lineEnd) {
        // Kill to end of display line
        _killBuffer = value.slice(cursor, lineEnd);
        value = value.slice(0, cursor) + value.slice(lineEnd);
        changed = true;
      } else if (cursor < value.length && value[cursor] === '\n') {
        // Kill the newline
        _killBuffer = '\n';
        value = value.slice(0, cursor) + value.slice(cursor + 1);
        changed = true;
      }
    } else if (key === 'u' && ctrlKey) {
      // Emacs: Ctrl+U - kill from beginning of line to cursor
      const width = this._cachedWidth || 40;
      const pos = this._cursorToDisplayPos(width);
      const lineStart = this._displayPosToCursor(pos.row, 0, width);

      if (cursor > lineStart) {
        _killBuffer = value.slice(lineStart, cursor);
        value = value.slice(0, lineStart) + value.slice(cursor);
        cursor = lineStart;
        changed = true;
      }
    } else if (key === 'w' && ctrlKey) {
      // Emacs: Ctrl+W - kill previous word
      if (cursor > 0) {
        let wordStart = cursor;
        while (wordStart > 0 && value[wordStart - 1] === ' ') wordStart--;
        while (wordStart > 0 && value[wordStart - 1] !== ' ' && value[wordStart - 1] !== '\n') wordStart--;
        _killBuffer = value.slice(wordStart, cursor);
        value = value.slice(0, wordStart) + value.slice(cursor);
        cursor = wordStart;
        changed = true;
      }
    } else if (key === 'y' && ctrlKey) {
      // Emacs: Ctrl+Y - yank (paste) killed text
      if (_killBuffer) {
        value = value.slice(0, cursor) + _killBuffer + value.slice(cursor);
        cursor = cursor + _killBuffer.length;
        changed = true;
      }
    } else if (key === 'Enter') {
      // Insert newline
      if (!this.props.maxLength || value.length < this.props.maxLength) {
        value = value.slice(0, cursor) + '\n' + value.slice(cursor);
        cursor = cursor + 1;
        changed = true;
      }
    } else if (key.length >= 1 && !ctrlKey && !altKey) {
      // Regular character input - use batched queue for paste performance
      // Accept all printable characters including Unicode (åäö, emoji, CJK, etc.)
      const charCode = key.charCodeAt(0);
      if (charCode >= 32) {
        // Queue for batched insertion
        return this._queueChar(key);
      }
    }

    if (changed) {
      this._value = value;
      this._cursorPos = cursor;
      this.props.value = value;
      this._needsRender = true;
      this._invalidateCache();
      this._notifyChange(); // Debounced - batches rapid input
    }

    return changed;
  }

  /**
   * Get current value
   */
  getValue(): string {
    // Flush any pending batched chars first
    if (this._pendingChars.length > 0) {
      this._flushPendingChars();
    }
    return this._value;
  }

  /**
   * Set value programmatically
   */
  setValue(value: string, cursorPos?: number): void {
    this._value = value;
    this._cursorPos = cursorPos !== undefined ? cursorPos : value.length;
    this.props.value = value;
    this._needsRender = true;
    this._invalidateCache();
  }

  /**
   * Get cursor position
   */
  getCursorPosition(): number {
    return this._cursorPos;
  }

  /**
   * Set cursor position
   */
  setCursorPosition(pos: number): void {
    this._cursorPos = clamp(pos, 0, this._value.length);
    this._needsRender = true;
  }

  /**
   * Get logical line count (newline-delimited)
   */
  getLineCount(): number {
    return this._value.split('\n').length;
  }

  /**
   * Get display line count (after wrapping)
   */
  getDisplayLineCount(width?: number): number {
    return this._computeDisplayLines(width || this._cachedWidth || 40).length;
  }

  /**
   * Get cursor's display row (0-indexed)
   * Useful for scrolling to keep cursor visible
   */
  getCursorDisplayRow(width?: number): number {
    const w = width || this._cachedWidth || 40;
    const pos = this._cursorToDisplayPos(w);
    return pos.row;
  }

  /**
   * Handle mouse click to position cursor
   * @param relativeX - X coordinate relative to textarea bounds
   * @param relativeY - Y coordinate relative to textarea bounds
   * @returns true if cursor was moved
   */
  handleClick(relativeX: number, relativeY: number): boolean {
    if (this.props.readOnly || this.props.disabled) {
      return false;
    }

    // Flush any pending chars first
    if (this._pendingChars.length > 0) {
      this._flushPendingChars();
    }

    const width = this._cachedWidth || 40;
    const displayLines = this._computeDisplayLines(width);

    // Convert click Y to display row (accounting for internal scroll)
    const displayRow = relativeY + this._scrollY;

    // Clamp to valid row range
    const row = clamp(displayRow, 0, displayLines.length - 1);

    // Clamp column to line length
    const lineLength = displayLines[row]?.text.length || 0;
    const col = clamp(relativeX, 0, lineLength);

    // Convert display position to cursor position
    const newCursorPos = this._displayPosToCursor(row, col, width);

    if (newCursorPos !== this._cursorPos) {
      this._cursorPos = newCursorPos;
      this._needsRender = true;
      return true;
    }

    return false;
  }

  /**
   * Insert text at cursor
   */
  insertText(text: string): void {
    if (this.props.readOnly || this.props.disabled) return;

    let newValue = this._value.slice(0, this._cursorPos) + text + this._value.slice(this._cursorPos);
    if (this.props.maxLength && newValue.length > this.props.maxLength) {
      newValue = newValue.slice(0, this.props.maxLength);
    }

    this._value = newValue;
    this._cursorPos = Math.min(this._cursorPos + text.length, newValue.length);
    this.props.value = this._value;
    this._needsRender = true;
    this._invalidateCache();
    this._notifyChange(); // Debounced
  }

  needsRender(): boolean {
    return this._needsRender;
  }

  markRendered(): void {
    this._needsRender = false;
  }

  /**
   * Clean up timers - call this when destroying the element
   */
  cleanup(): void {
    this._debouncedChangeAction.cancel();
    this._debouncedFlushCharsAction.cancel();
  }

  /**
   * Calculate intrinsic size
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    // Use available width from context if provided, otherwise use cols prop
    const availableWidth = context.availableSpace?.width || this.props.cols || 40;
    const width = this.props.cols ?? availableWidth;

    // If rows specified, use fixed height (internal scrolling)
    if (this.props.rows) {
      return { width, height: this.props.rows };
    }

    // Use actual rendered height if available (most accurate for scrollable parents)
    if (this._lastRenderedHeight > 0) {
      return { width: availableWidth, height: this._lastRenderedHeight };
    }

    // Otherwise compute from content
    const displayLines = this._computeDisplayLines(availableWidth);
    return { width: availableWidth, height: Math.max(displayLines.length, 1) };
  }

  canReceiveFocus(): boolean {
    return !this.props.disabled && !this.props.readOnly;
  }

  /**
   * Check if this textarea is interactive
   */
  isInteractive(): boolean {
    return !this.props.disabled && !this.props.readOnly;
  }

  /**
   * Check if this textarea supports text selection
   */
  isTextSelectable(): boolean {
    return true;
  }

  static validate(props: TextareaProps): boolean {
    if (props.maxLength !== undefined && (typeof props.maxLength !== 'number' || props.maxLength < 0)) {
      return false;
    }
    if (props.value !== undefined && typeof props.value !== 'string') {
      return false;
    }
    if (props.rows !== undefined && (typeof props.rows !== 'number' || props.rows < 1)) {
      return false;
    }
    if (props.cols !== undefined && (typeof props.cols !== 'number' || props.cols < 1)) {
      return false;
    }
    return true;
  }

  /**
   * Fast render - generates diffs for the textarea content directly.
   * Skips layout calculation and buffer copy for immediate visual feedback.
   */
  fastRender(collector: DiffCollector, bounds: Bounds, isFocused: boolean): boolean {
    // Flush any pending batched chars before rendering
    if (this._pendingChars.length > 0) {
      this._flushPendingChars();
    }

    const value = this._value;
    const { placeholder } = this.props;

    // Get styles - parse colors to PackedRGBA
    const elementStyle = this.props.style || {};
    const bg = parseColor(elementStyle.background) || getThemeColor('inputBackground');
    const fg = value
      ? (parseColor(elementStyle.color) || getThemeColor('inputForeground'))
      : getThemeColor('textMuted');

    // Clear the textarea area
    collector.fillRect(bounds.x, bounds.y, bounds.width, bounds.height, {
      char: EMPTY_CHAR,
      background: bg,
      foreground: fg,
    });

    const displayLines = this._computeDisplayLines(bounds.width);

    // Only use internal scroll if rows is set (fixed height mode)
    const useInternalScroll = this.props.rows !== undefined;

    // Adjust scroll to keep cursor visible (only in internal scroll mode)
    if (useInternalScroll && isFocused) {
      const cursorDisplay = this._cursorToDisplayPos(bounds.width);
      if (cursorDisplay.row < this._scrollY) {
        this._scrollY = cursorDisplay.row;
      } else if (cursorDisplay.row >= this._scrollY + bounds.height) {
        this._scrollY = cursorDisplay.row - bounds.height + 1;
      }
    } else if (!useInternalScroll) {
      this._scrollY = 0;
    }

    const linesToRender = useInternalScroll ? bounds.height : displayLines.length;

    // Show placeholder if empty
    if (!value && placeholder) {
      const placeholderLines = placeholder.split('\n');
      for (let y = 0; y < Math.min(placeholderLines.length, linesToRender); y++) {
        const text = placeholderLines[y].substring(0, bounds.width);
        collector.setText(bounds.x, bounds.y + y, text, {
          foreground: COLORS.gray,
          background: bg,
        });
      }
    } else {
      // Render lines
      for (let y = 0; y < linesToRender; y++) {
        const lineIdx = this._scrollY + y;
        if (lineIdx < displayLines.length) {
          const line = displayLines[lineIdx];
          const text = line.text.substring(0, bounds.width);
          collector.setText(bounds.x, bounds.y + y, text, {
            foreground: fg,
            background: bg,
          });
        }
      }
    }

    // Render cursor when focused
    if (isFocused) {
      const cursorDisplay = this._cursorToDisplayPos(bounds.width);
      const cursorScreenY = cursorDisplay.row - this._scrollY;
      const maxY = useInternalScroll ? bounds.height : displayLines.length;

      if (cursorScreenY >= 0 && cursorScreenY < maxY) {
        const cursorX = bounds.x + Math.min(cursorDisplay.col, bounds.width - 1);
        const cursorY = bounds.y + cursorScreenY;

        const lineIdx = cursorDisplay.row;
        const line = displayLines[lineIdx];
        const hasCharAtCursor = line && cursorDisplay.col < line.text.length;
        const cursorChar = hasCharAtCursor ? line.text[cursorDisplay.col] : ' ';

        collector.setText(cursorX, cursorY, cursorChar, {
          foreground: fg,
          background: bg,
          reverse: true,
        });
      }
    }

    return true;
  }

  /**
   * Check if the last key input can be fast rendered.
   */
  canFastRender(): boolean {
    return true; // Textarea can always fast render
  }
}

// Lint schema for textarea component
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const textareaSchema: ComponentSchema = {
  description: 'Multi-line text input area with scrolling',
  props: {
    value: { type: 'string', description: 'Current text content' },
    placeholder: { type: 'string', description: 'Placeholder text when empty' },
    maxLength: { type: 'number', description: 'Maximum character limit' },
    readOnly: { type: 'boolean', description: 'Prevent editing' },
    rows: { type: 'number', description: 'Visible rows (height hint)' },
    cols: { type: 'number', description: 'Visible columns (width hint)' },
    wrap: { type: 'string', enum: ['soft', 'off'], description: 'Text wrapping mode' },
    onChange: { type: 'handler', description: 'Called when value changes. Event: { value: string, target }' },
    onKeyPress: { type: 'handler', description: 'Called on key press. Return true to prevent default. Event: { key, ctrlKey, altKey, shiftKey, target }' },
  },
};

registerComponentSchema('textarea', textareaSchema);

// Register textarea component
registerComponent({
  type: 'textarea',
  componentClass: TextareaElement,
  defaultProps: {
    value: '',
    placeholder: '',
    readOnly: false,
    disabled: false,
    tabIndex: 0,
    // rows: undefined - omit to allow expandable mode in scrollable containers
    cols: 40,
    wrap: 'soft',
  },
  validate: (props) => TextareaElement.validate(props as any),
});
