// Input component implementation

import { Element, BaseProps, Renderable, Focusable, Interactive, TextSelectable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import { type DualBuffer, type Cell, EMPTY_CHAR } from '../buffer.ts';
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

export class InputElement extends Element implements Renderable, Focusable, Interactive, TextSelectable {
  declare type: 'input';
  declare props: InputProps;
  private _internalValue: string;
  private _cursorPosition: number;
  private _needsRender: boolean = false;
  private _showingCompletions: boolean = false;
  private _completions: string[] = [];
  private _selectedCompletionIndex: number = -1;

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
   * Render the text input to the terminal buffer
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
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
    const maxDisplayWidth = bounds.width;

    // Use element style properties, with fallbacks for visibility
    const elementStyle = this.props.style || {};
    const inputCellStyle: any = {
      ...style,
      background: elementStyle.background || getThemeColor('inputBackground'),
      foreground: value ? (elementStyle.color || getThemeColor('inputForeground')) : getThemeColor('textMuted'), // Placeholder text is muted
    };

    // Clear the input area first - make sure it's visible
    buffer.currentBuffer.fillRect(bounds.x, bounds.y, bounds.width, 1, {
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

    if (textToRender) {
      // Truncate text if it's longer than available width
      let visibleText = textToRender;
      if (textToRender.length > maxDisplayWidth) {
        visibleText = textToRender.substring(textToRender.length - maxDisplayWidth);
      }
      buffer.currentBuffer.setText(bounds.x, bounds.y, visibleText, textStyle);
    }

    // Show completion preview if available and focused
    const isFocused = context.focusedElementId === this.id;
    if (isFocused && this._showingCompletions && this._selectedCompletionIndex >= 0) {
      const completion = this._completions[this._selectedCompletionIndex];
      if (completion && completion.length > value.length) {
        // Show the rest of the completion in a muted style
        const previewText = completion.substring(value.length);
        const previewStartX = bounds.x + value.length;
        const availableWidth = bounds.width - value.length;

        if (previewStartX < bounds.x + bounds.width && availableWidth > 0) {
          const truncatedPreview = previewText.substring(0, availableWidth);

          // First, clear the entire preview area to remove any leftover characters
          for (let i = 0; i < availableWidth; i++) {
            buffer.currentBuffer.setText(previewStartX + i, bounds.y, ' ', inputCellStyle);
          }

          // Then render the new preview text
          buffer.currentBuffer.setText(previewStartX, bounds.y, truncatedPreview, {
            ...textStyle,
            foreground: COLORS.gray,
            // Make it visibly different from regular text
            underline: true
          });
        }
      } else {
        // If no valid preview (e.g., completion is same length or shorter than current value),
        // clear the preview area to remove any leftover characters
        const clearStartX = bounds.x + value.length;
        const clearWidth = bounds.width - value.length;
        if (clearWidth > 0) {
          for (let i = 0; i < clearWidth; i++) {
            buffer.currentBuffer.setText(clearStartX + i, bounds.y, ' ', inputCellStyle);
          }
        }
      }
    }

    // Show cursor only when focused
    if (isFocused) {
      // Calculate cursor position based on the actual value length, not placeholder
      const valueLength = value.length;
      const actualCursorPos = Math.min(cursorPos, valueLength);
      const cursorX = bounds.x + actualCursorPos;

      if (cursorX >= bounds.x && cursorX < bounds.x + bounds.width) {
        // Use reverse video for cursor - works universally across all terminals and themes
        const hasCharAtCursor = actualCursorPos < value.length;

        if (hasCharAtCursor) {
          // Show the character with reverse video (swaps fg/bg)
          // For password format, show * instead of the actual character
          const cursorChar = isPassword ? '*' : value[actualCursorPos];
          buffer.currentBuffer.setText(cursorX, bounds.y, cursorChar, {
            foreground: inputCellStyle.foreground,
            background: inputCellStyle.background,
            reverse: true,
          });
        } else {
          // At empty position: use space with reverse video to show cursor block
          buffer.currentBuffer.setText(cursorX, bounds.y, ' ', {
            foreground: inputCellStyle.foreground,
            background: inputCellStyle.background,
            reverse: true,
          });
        }
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
    } else if (key === 'ArrowUp') {
      if (this._showingCompletions && this._completions.length > 0) {
        this._selectedCompletionIndex = this._selectedCompletionIndex - 1;
        if (this._selectedCompletionIndex < 0) {
          this._selectedCompletionIndex = this._completions.length - 1;
        }
        changed = true;
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
    } catch (error) {
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
   * Fast render - updates only the text content at cached bounds.
   * Skips layout calculation for immediate visual feedback.
   * Returns true if fast render was performed, false if full render needed.
   */
  fastRender(buffer: DualBuffer, bounds: Bounds, isFocused: boolean): boolean {
    // Don't fast render if showing completions (needs full render for dropdown)
    if (this._showingCompletions) {
      return false;
    }

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

    // Clear the input area
    buffer.currentBuffer.fillRect(bounds.x, bounds.y, bounds.width, 1, {
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

    if (textToRender) {
      // Truncate if longer than available width
      let visibleText = textToRender;
      if (textToRender.length > bounds.width) {
        visibleText = textToRender.substring(textToRender.length - bounds.width);
      }
      buffer.currentBuffer.setText(bounds.x, bounds.y, visibleText, textStyle);
    }

    // Render cursor if focused
    if (isFocused) {
      const valueLength = value.length;
      const actualCursorPos = Math.min(cursorPos, valueLength);
      const cursorX = bounds.x + actualCursorPos;

      if (cursorX >= bounds.x && cursorX < bounds.x + bounds.width) {
        const hasCharAtCursor = actualCursorPos < value.length;
        const cursorChar = hasCharAtCursor
          ? (isPassword ? '*' : value[actualCursorPos])
          : ' ';

        buffer.currentBuffer.setText(cursorX, bounds.y, cursorChar, {
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
    onKeyPress: { type: 'handler', description: 'Called on Enter key. Event: { key, target }' },
  },
};

registerComponentSchema('input', inputSchema);