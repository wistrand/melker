// Input component implementation

import { Element, type BaseProps, type Renderable, type Focusable, type Interactive, type TextSelectable, type PositionalClickHandler, type Bounds, type ComponentRenderContext, type IntrinsicSizeContext } from '../types.ts';
import { type DualBuffer, type Cell, type DiffCollector, EMPTY_CHAR } from '../buffer.ts';
import { createKeyPressEvent, createChangeEvent } from '../events.ts';
import { getThemeColor } from '../theme.ts';
import { COLORS, parseColor } from './color-utils.ts';

export interface InputProps extends BaseProps {
  value?: string;
  placeholder?: string;
  maxLength?: number;
  readOnly?: boolean;
  cursorPosition?: number;
  format?: 'text' | 'password'; // Default: 'text'. If 'password', renders chars as '*'
  complete?: () => string[]; // Function that returns possible completions
  /**
   * Auto-completion function that returns possible completions for the current input value.
   * Completions are filtered to match the current input value (case-insensitive).
   *
   * Usage:
   * - Ctrl+K: Show/cycle through completions
   * - Arrow Up/Down: Navigate through completions
   * - Enter: Select highlighted completion
   * - Escape: Hide completions
   *
   * Example:
   * ```typescript
   * complete: () => ['option1', 'option2', 'option3']
   * ```
   */
}

// Shared kill buffer for emacs-style Ctrl+Y yank
let _killBuffer: string = '';

export class InputElement extends Element implements Renderable, Focusable, Interactive, TextSelectable, PositionalClickHandler {
  declare type: 'input';
  declare props: InputProps;
  private _internalValue: string;
  private _cursorPosition: number;
  private _needsRender: boolean = false;
  private _showingCompletions: boolean = false;
  private _completions: string[] = [];
  private _selectedCompletionIndex: number = -1;
  private _borderInset = { top: 0, right: 0, bottom: 0, left: 0 };
  private _lastContentWidth: number = 80;

  constructor(props: InputProps = {}, children: Element[] = []) {
    const defaultProps: InputProps = {
      value: '',
      placeholder: '',
      readOnly: false,
      disabled: false,
      tabIndex: 0,
      cursorPosition: 0,
      format: 'text',
      ...props,
      style: {
        // Default styles would go here (none currently)
        ...props.style
      },
    };

    super('input', defaultProps, children);
    this._internalValue = defaultProps.value || '';
    this._cursorPosition = defaultProps.cursorPosition || 0;
  }

  /**
   * Calculate content bounds by insetting for border thickness.
   * Borders are rendered by the pipeline; content must not overlap them.
   */
  private _getContentBounds(bounds: Bounds, computedStyle?: any): Bounds {
    const s = computedStyle || {};
    const hasBorderTop = (s.borderTop || (s.border && s.border !== 'none')) && (s.borderTop !== 'none');
    const hasBorderBottom = (s.borderBottom || (s.border && s.border !== 'none')) && (s.borderBottom !== 'none');
    const hasBorderLeft = (s.borderLeft || (s.border && s.border !== 'none')) && (s.borderLeft !== 'none');
    const hasBorderRight = (s.borderRight || (s.border && s.border !== 'none')) && (s.borderRight !== 'none');
    const top = hasBorderTop ? 1 : 0;
    const bottom = hasBorderBottom ? 1 : 0;
    const left = hasBorderLeft ? 1 : 0;
    const right = hasBorderRight ? 1 : 0;
    this._borderInset = { top, right, bottom, left };
    return {
      x: bounds.x + left,
      y: bounds.y + top,
      width: Math.max(0, bounds.width - left - right),
      height: Math.max(0, bounds.height - top - bottom),
    };
  }

  /**
   * Render the text input to the terminal buffer
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Compute content bounds inset by border thickness
    const cb = this._getContentBounds(bounds, context.computedStyle);
    if (cb.width <= 0 || cb.height <= 0) return;
    this._lastContentWidth = cb.width;

    // Sync props.value to internal _internalValue if changed externally (e.g., by state persistence)
    if (this.props.value !== undefined && this.props.value !== this._internalValue) {
      this._internalValue = this.props.value;
      // Clamp cursor position to valid range
      if (this._cursorPosition > this._internalValue.length) {
        this._cursorPosition = this._internalValue.length;
      }
    }

    const value = this._internalValue;
    const cursorPos = this._cursorPosition;
    const { placeholder } = this.props;

    const displayText = value || placeholder || '';
    const maxDisplayWidth = cb.width;

    // Use element style properties, with fallbacks for visibility
    const elementStyle = this.props.style || {};
    const inputCellStyle: any = {
      ...style,
      background: elementStyle.background || getThemeColor('inputBackground'),
      foreground: value ? (elementStyle.color || getThemeColor('inputForeground')) : getThemeColor('textMuted'), // Placeholder text is muted
    };

    // Clear the input content area first - make sure it's visible
    buffer.currentBuffer.fillRect(cb.x, cb.y, cb.width, 1, {
      char: EMPTY_CHAR,
      background: inputCellStyle.background,
      foreground: inputCellStyle.foreground,
    });

    // Render text content (value takes precedence over placeholder)
    // For password format, mask the value with asterisks
    const isPassword = this.props.format === 'password';
    const maskedValue = isPassword && value ? '*'.repeat(value.length) : value;
    let textToRender = maskedValue || placeholder || '';
    let textStyle = inputCellStyle;

    // Use gray color for placeholder text
    if (!value && placeholder) {
      textStyle = {
        ...inputCellStyle,
        foreground: COLORS.gray,
      };
    }

    // Calculate scroll offset to keep cursor visible
    const actualCursorPos = Math.min(cursorPos, (maskedValue || '').length);
    let scrollOffset = 0;
    if ((maskedValue || '').length > maxDisplayWidth) {
      // Scroll so cursor is always visible, with some context
      if (actualCursorPos < maxDisplayWidth) {
        scrollOffset = 0;
      } else if (actualCursorPos >= (maskedValue || '').length) {
        scrollOffset = (maskedValue || '').length - maxDisplayWidth;
      } else {
        scrollOffset = actualCursorPos - maxDisplayWidth + 1;
      }
    }

    if (textToRender) {
      let visibleText: string;
      if (!value && placeholder) {
        // Placeholder: no scroll
        visibleText = textToRender.substring(0, maxDisplayWidth);
      } else {
        visibleText = textToRender.substring(scrollOffset, scrollOffset + maxDisplayWidth);
      }
      buffer.currentBuffer.setText(cb.x, cb.y, visibleText, textStyle);
    }

    // Show completion preview if available and focused
    const isFocused = context.focusedElementId === this.id;
    if (isFocused && this._showingCompletions && this._selectedCompletionIndex >= 0) {
      const completion = this._completions[this._selectedCompletionIndex];
      if (completion && completion.length > value.length) {
        const previewText = completion.substring(value.length);
        const visibleValueLen = value.length - scrollOffset;
        const previewStartX = cb.x + visibleValueLen;
        const availableWidth = cb.width - visibleValueLen;

        if (previewStartX >= cb.x && previewStartX < cb.x + cb.width && availableWidth > 0) {
          const truncatedPreview = previewText.substring(0, availableWidth);

          for (let i = 0; i < availableWidth; i++) {
            buffer.currentBuffer.setText(previewStartX + i, cb.y, ' ', inputCellStyle);
          }

          buffer.currentBuffer.setText(previewStartX, cb.y, truncatedPreview, {
            ...textStyle,
            foreground: COLORS.gray,
            underline: true
          });
        }
      } else {
        const visibleValueLen = Math.min(value.length - scrollOffset, cb.width);
        const clearStartX = cb.x + visibleValueLen;
        const clearWidth = cb.width - visibleValueLen;
        if (clearWidth > 0) {
          for (let i = 0; i < clearWidth; i++) {
            buffer.currentBuffer.setText(clearStartX + i, cb.y, ' ', inputCellStyle);
          }
        }
      }
    }

    // Show cursor only when focused
    if (isFocused) {
      const cursorX = cb.x + actualCursorPos - scrollOffset;

      if (cursorX >= cb.x && cursorX < cb.x + cb.width) {
        const hasCharAtCursor = actualCursorPos < value.length;
        const cursorChar = hasCharAtCursor
          ? (isPassword ? '*' : value[actualCursorPos])
          : ' ';

        buffer.currentBuffer.setText(cursorX, cb.y, cursorChar, {
          foreground: inputCellStyle.foreground,
          background: inputCellStyle.background,
          reverse: true,
        });
      }
    }

    // Mark as rendered
    this._needsRender = false;
  }

  /**
   * Handle keyboard input for this text input
   */
  handleKeyInput(key: string, ctrlKey: boolean = false, altKey: boolean = false): boolean {
    if (this.props.readOnly || this.props.disabled) {
      return false;
    }


    let changed = false;
    let value = this._internalValue;
    let cursor = this._cursorPosition;

    // Handle backspace character (ASCII 8), DEL (ASCII 127), and normalized 'Backspace'
    // Also handle Ctrl+H which is an alternative backspace representation
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
    } else if (key === 'Home') {
      cursor = 0;
      changed = true;
    } else if (key === 'End') {
      cursor = value.length;
      changed = true;
    } else if (key === 'Escape') {
      if (this._showingCompletions) {
        // Hide completions on Escape
        this._showingCompletions = false;
        this._completions = [];
        this._selectedCompletionIndex = -1;
        changed = true;
      } else {
        value = '';
        cursor = 0;
        changed = true;
      }
    } else if (key === 'k' && ctrlKey) {
      // Handle Ctrl+K for auto-completion (accessible alternative)
      if (this.props.complete) {
        if (!this._showingCompletions) {
          // Start showing completions
          this._updateCompletions(value);
          if (this._completions.length > 0) {
            this._showingCompletions = true;
            this._selectedCompletionIndex = 0;
            changed = true;
          }
        } else {
          // Cycle through completions
          this._selectedCompletionIndex = (this._selectedCompletionIndex + 1) % this._completions.length;
          changed = true;
        }
      }
      return true; // Consume Ctrl+K event
    } else if (key === 'a' && ctrlKey) {
      // Emacs: Ctrl+A - move to beginning of line
      cursor = 0;
      changed = true;
    } else if (key === 'e' && ctrlKey) {
      // Emacs: Ctrl+E - move to end of line
      cursor = value.length;
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
    } else if (key === 'd' && ctrlKey) {
      // Emacs: Ctrl+D - delete character at cursor
      if (cursor < value.length) {
        value = value.slice(0, cursor) + value.slice(cursor + 1);
        changed = true;
      }
    } else if (key === 'u' && ctrlKey) {
      // Emacs: Ctrl+U - kill from beginning to cursor
      if (cursor > 0) {
        _killBuffer = value.slice(0, cursor);
        value = value.slice(cursor);
        cursor = 0;
        changed = true;
      }
    } else if (key === 'w' && ctrlKey) {
      // Emacs: Ctrl+W - kill previous word
      if (cursor > 0) {
        // Find word boundary (skip trailing spaces, then skip word chars)
        let wordStart = cursor;
        // Skip any spaces before cursor
        while (wordStart > 0 && value[wordStart - 1] === ' ') {
          wordStart--;
        }
        // Skip word characters
        while (wordStart > 0 && value[wordStart - 1] !== ' ') {
          wordStart--;
        }
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
    } else if (key === 'ArrowDown') {
      if (this._showingCompletions && this._completions.length > 0) {
        this._selectedCompletionIndex = (this._selectedCompletionIndex + 1) % this._completions.length;
        changed = true;
        return true;
      }
      // Single-line input: ArrowDown = End
      if (cursor < value.length) {
        cursor = value.length;
        changed = true;
      } else if (typeof this.props.onKeyPress === 'function') {
        // At end of input — emit for history navigation
        this.props.onKeyPress(createKeyPressEvent('ArrowDown', { target: this.id }));
        return true;
      }
    } else if (key === 'ArrowUp') {
      if (this._showingCompletions && this._completions.length > 0) {
        this._selectedCompletionIndex = this._selectedCompletionIndex - 1;
        if (this._selectedCompletionIndex < 0) {
          this._selectedCompletionIndex = this._completions.length - 1;
        }
        changed = true;
        return true;
      }
      // Single-line input: ArrowUp = Home
      if (cursor > 0) {
        cursor = 0;
        changed = true;
      } else if (typeof this.props.onKeyPress === 'function') {
        // At start of input — emit for history navigation
        this.props.onKeyPress(createKeyPressEvent('ArrowUp', { target: this.id }));
        return true;
      }
    } else if (key === 'Enter') {
      // Handle completion selection or normal Enter
      if (this._showingCompletions && this._selectedCompletionIndex >= 0) {
        // Apply the selected completion
        const selectedCompletion = this._completions[this._selectedCompletionIndex];
        value = selectedCompletion;
        cursor = selectedCompletion.length;
        this._showingCompletions = false;
        this._completions = [];
        this._selectedCompletionIndex = -1;
        changed = true;
        // Don't return early - let the changed logic handle the state update
      } else {
        // Trigger onKeyPress for Enter (but don't change the input value)
        if (typeof this.props.onKeyPress === 'function') {
          this.props.onKeyPress(createKeyPressEvent('Enter', {
            target: this.id
          }));
        }
        return true; // Only return early if no completion was applied
      }
    } else if (key.length >= 1 && !ctrlKey && !altKey) {
      // Regular character input - accept printable characters including Unicode
      // Exclude control characters (0-31) but allow all other characters including extended Unicode
      const charCode = key.charCodeAt(0);
      if (charCode >= 32) { // Printable characters (ASCII and Unicode)
        if (!this.props.maxLength || value.length < this.props.maxLength) {
          value = value.slice(0, cursor) + key + value.slice(cursor);
          cursor = cursor + key.length; // Handle multi-byte characters
          changed = true;

          // Hide completions when typing
          if (this._showingCompletions) {
            this._showingCompletions = false;
            this._completions = [];
            this._selectedCompletionIndex = -1;
          }
        }
      }
    }

    if (changed) {
      this._internalValue = value;
      this._cursorPosition = cursor;
      this.props.value = value;
      this.props.cursorPosition = cursor;
      this._needsRender = true;

      // Trigger onChange callback
      if (typeof this.props.onChange === 'function') {
        this.props.onChange(createChangeEvent(value, this.id));
      }
    }

    return changed;
  }

  /**
   * Get current display value
   */
  getValue(): string {
    return this._internalValue;
  }

  /**
   * Get cursor position
   */
  getCursorPosition(): number {
    return this._cursorPosition;
  }

  /**
   * Check if this input needs re-rendering
   */
  needsRender(): boolean {
    return this._needsRender;
  }

  /**
   * Mark as rendered
   */
  markRendered(): void {
    this._needsRender = false;
  }

  /**
   * Handle click to position cursor
   */
  handleClick(relativeX: number, _relativeY: number): boolean {
    if (this.props.readOnly || this.props.disabled) return false;

    const value = this._internalValue;
    const contentX = relativeX - this._borderInset.left;
    const contentWidth = this._lastContentWidth;
    const cursor = this._cursorPosition;

    // Calculate scroll offset (same logic as render)
    let scrollOffset = 0;
    if (value.length > contentWidth) {
      if (cursor < contentWidth) {
        scrollOffset = 0;
      } else if (cursor >= value.length) {
        scrollOffset = value.length - contentWidth;
      } else {
        scrollOffset = cursor - contentWidth + 1;
      }
    }
    const newCursor = Math.min(value.length, Math.max(0, scrollOffset + contentX));

    if (newCursor !== this._cursorPosition) {
      this._cursorPosition = newCursor;
      this.props.cursorPosition = newCursor;
      this._needsRender = true;
      return true;
    }
    return false;
  }

  /**
   * Set value programmatically
   */
  setValue(value: string, cursorPos?: number): void {
    this._internalValue = value;
    this._cursorPosition = cursorPos !== undefined ? cursorPos : value.length;
    this.props.value = value;
    this.props.cursorPosition = this._cursorPosition;
    this._needsRender = true;
  }

  /**
   * Insert text at cursor position (used for paste operations).
   * For single-line input, newlines are stripped.
   */
  insertText(text: string): void {
    if (this.props.readOnly || this.props.disabled) return;

    // Strip newlines for single-line input
    const toInsert = text.replace(/[\r\n]/g, '');
    if (toInsert.length === 0) return;

    let value = this._internalValue;
    let cursor = this._cursorPosition;

    value = value.slice(0, cursor) + toInsert + value.slice(cursor);
    cursor += toInsert.length;

    if (this.props.maxLength && value.length > this.props.maxLength) {
      value = value.slice(0, this.props.maxLength);
      cursor = Math.min(cursor, value.length);
    }

    this._internalValue = value;
    this._cursorPosition = cursor;
    this.props.value = value;
    this.props.cursorPosition = cursor;
    this._needsRender = true;
  }

  /**
   * Update completions based on current input value
   */
  private _updateCompletions(currentValue: string): void {
    if (!this.props.complete) {
      this._completions = [];
      return;
    }

    try {
      const allCompletions = this.props.complete();
      // Filter completions that start with the current value (case-insensitive)
      this._completions = allCompletions.filter(completion =>
        completion.toLowerCase().startsWith(currentValue.toLowerCase())
      );
    } catch {
      // If complete function fails, clear completions
      this._completions = [];
    }
  }

  /**
   * Get current completion text for display
   */
  getCompletionText(): string {
    if (!this._showingCompletions || this._selectedCompletionIndex < 0) {
      return '';
    }
    return this._completions[this._selectedCompletionIndex] || '';
  }

  /**
   * Check if completions are currently being shown
   */
  isShowingCompletions(): boolean {
    return this._showingCompletions;
  }

  /**
   * Get all current completions
   */
  getCompletions(): string[] {
    return [...this._completions];
  }

  /**
   * Calculate intrinsic size for the input component
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const { value, placeholder } = this.props;

    // Use value length or placeholder length, or minimum width
    const valueLength = value?.length || 0;
    const placeholderLength = placeholder?.length || 0;
    const calculatedWidth = Math.max(valueLength, placeholderLength, 10); // minimum 10 chars

    return { width: calculatedWidth, height: 1 };
  }

  /**
   * Check if this input can receive focus
   */
  canReceiveFocus(): boolean {
    return !this.props.disabled && !this.props.readOnly;
  }

  /**
   * Check if this input is interactive
   */
  isInteractive(): boolean {
    return !this.props.disabled && !this.props.readOnly;
  }

  /**
   * Check if this input supports text selection
   */
  isTextSelectable(): boolean {
    return true;
  }

  static validate(props: InputProps): boolean {
    if (props.maxLength !== undefined && (typeof props.maxLength !== 'number' || props.maxLength < 0)) {
      return false;
    }
    if (props.value !== undefined && typeof props.value !== 'string') {
      return false;
    }
    if (props.placeholder !== undefined && typeof props.placeholder !== 'string') {
      return false;
    }
    return true;
  }

  /**
   * Fast render - generates diffs for the input content directly.
   * Skips layout calculation and buffer copy for immediate visual feedback.
   * Returns null if fast render not possible, otherwise BufferDiff[].
   */
  fastRender(collector: DiffCollector, bounds: Bounds, isFocused: boolean): boolean {
    // Don't fast render if showing completions (needs full render for dropdown)
    if (this._showingCompletions) {
      return false;
    }

    // Apply cached border inset from last full render
    const bi = this._borderInset;
    const cb: Bounds = {
      x: bounds.x + bi.left,
      y: bounds.y + bi.top,
      width: Math.max(0, bounds.width - bi.left - bi.right),
      height: Math.max(0, bounds.height - bi.top - bi.bottom),
    };
    if (cb.width <= 0 || cb.height <= 0) return false;

    const value = this._internalValue;
    const cursorPos = this._cursorPosition;
    const { placeholder } = this.props;
    const isPassword = this.props.format === 'password';

    // Get styles - colors are already parsed to numbers at entry points
    const elementStyle = this.props.style || {};
    const bg = parseColor(elementStyle.background) || getThemeColor('inputBackground');
    const fg = value
      ? (parseColor(elementStyle.color) || getThemeColor('inputForeground'))
      : getThemeColor('textMuted');

    // Clear the input content area
    collector.fillRect(cb.x, cb.y, cb.width, 1, {
      char: EMPTY_CHAR,
      background: bg,
      foreground: fg,
    });

    // Render text content
    const maskedValue = isPassword && value ? '*'.repeat(value.length) : value;
    const textToRender = maskedValue || placeholder || '';
    const textStyle = (!value && placeholder)
      ? { foreground: COLORS.gray, background: bg }
      : { foreground: fg, background: bg };

    // Calculate scroll offset to keep cursor visible
    const actualCursorPos = Math.min(cursorPos, (maskedValue || '').length);
    let scrollOffset = 0;
    if ((maskedValue || '').length > cb.width) {
      if (actualCursorPos < cb.width) {
        scrollOffset = 0;
      } else if (actualCursorPos >= (maskedValue || '').length) {
        scrollOffset = (maskedValue || '').length - cb.width;
      } else {
        scrollOffset = actualCursorPos - cb.width + 1;
      }
    }

    if (textToRender) {
      let visibleText: string;
      if (!value && placeholder) {
        visibleText = textToRender.substring(0, cb.width);
      } else {
        visibleText = textToRender.substring(scrollOffset, scrollOffset + cb.width);
      }
      collector.setText(cb.x, cb.y, visibleText, textStyle);
    }

    // Render cursor if focused
    if (isFocused) {
      const cursorX = cb.x + actualCursorPos - scrollOffset;

      if (cursorX >= cb.x && cursorX < cb.x + cb.width) {
        const hasCharAtCursor = actualCursorPos < value.length;
        const cursorChar = hasCharAtCursor
          ? (isPassword ? '*' : value[actualCursorPos])
          : ' ';

        collector.setText(cursorX, cb.y, cursorChar, {
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
   * Returns false for operations that need full render (completions, etc.)
   */
  canFastRender(): boolean {
    return !this._showingCompletions;
  }
}

// Lint schema for input component
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const inputSchema: ComponentSchema = {
  description: 'Single-line text input field',
  props: {
    value: { type: 'string', description: 'Current input value' },
    placeholder: { type: 'string', description: 'Placeholder text when empty' },
    maxLength: { type: 'number', description: 'Maximum character limit' },
    readOnly: { type: 'boolean', description: 'Prevent editing' },
    cursorPosition: { type: 'number', description: 'Cursor position in text' },
    format: { type: 'string', enum: ['text', 'password'], description: 'Input format: text (default) or password (masked with *)' },
    complete: { type: 'function', description: 'Tab completion callback' },
    onChange: { type: 'handler', description: 'Called when value changes. Event: { value: string, target }' },
    onKeyPress: { type: 'handler', description: 'Called on Enter, ArrowUp (at start), ArrowDown (at end). Event: { key, target }' },
  },
};

registerComponentSchema('input', inputSchema);

// Register input component
registerComponent({
  type: 'input',
  componentClass: InputElement,
  defaultProps: {
    value: '',
    placeholder: '',
    readOnly: false,
    disabled: false,
    tabIndex: 0,
    cursorPosition: 0,
  },
  validate: (props) => InputElement.validate(props as any),
});