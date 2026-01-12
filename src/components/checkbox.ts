// Checkbox component implementation

import { Element, BaseProps, Renderable, Focusable, Clickable, Interactive, Bounds, ComponentRenderContext, IntrinsicSizeContext, ClickEvent, ChangeEvent } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import type { Document } from '../document.ts';
import { getStringWidth } from '../char-width.ts';

export interface CheckboxProps extends BaseProps {
  title: string;
  checked?: boolean;
  indeterminate?: boolean; // For tri-state checkboxes
  // onChange inherited from BaseProps - event includes { checked: boolean, value: string }
  onClick?: (event: ClickEvent) => void; // Deprecated: use onChange instead
}

export class CheckboxElement extends Element implements Renderable, Focusable, Clickable, Interactive {
  declare type: 'checkbox';
  declare props: CheckboxProps;

  constructor(props: CheckboxProps, children: Element[] = []) {
    const defaultProps: CheckboxProps = {
      checked: false,
      indeterminate: false,
      disabled: false,
      tabIndex: 0,
      ...props,
      style: {
        // Default styles would go here (none currently)
        ...props.style
      },
    };

    super('checkbox', defaultProps, children);
  }

  /**
   * Render the checkbox to the terminal buffer
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    const { title, checked, indeterminate } = this.props;

    // Check if this checkbox is focused
    const isFocused = context.focusedElementId === this.id;

    let checkboxStyle = { ...style };

    // Create checkbox indicator (using ASCII characters for consistent terminal width)
    let indicator: string;
    if (indeterminate) {
      indicator = '[-]'; // Indeterminate state
    } else if (checked) {
      indicator = '[x]'; // Checked state
    } else {
      indicator = '[ ]'; // Unchecked state
    }

    // Display text: just indicator if no title, or indicator + space + title
    const displayText = title ? `${indicator} ${title}` : indicator;

    // Apply focus styling
    if (isFocused) {
      checkboxStyle.bold = true;
    }

    // Truncate if needed
    const maxTextLength = bounds.width;
    let finalText = displayText;
    if (displayText.length > maxTextLength) {
      finalText = displayText.substring(0, maxTextLength);
    }

    buffer.currentBuffer.setText(bounds.x, bounds.y, finalText, checkboxStyle);
  }

  /**
   * Get the current checked state (standard API)
   */
  getValue(): boolean {
    return this.props.checked || false;
  }

  /**
   * Set the checked state (standard API)
   */
  setValue(checked: boolean): void {
    this.props.checked = checked;
    // Clear indeterminate when explicitly setting checked state
    if (checked !== undefined) {
      this.props.indeterminate = false;
    }
  }

  /**
   * Get the current checked state
   * @deprecated Use getValue() instead
   */
  isChecked(): boolean {
    return this.getValue();
  }

  /**
   * Get the current indeterminate state
   */
  isIndeterminate(): boolean {
    return this.props.indeterminate || false;
  }

  /**
   * Set the checked state
   * @deprecated Use setValue() instead
   */
  setChecked(checked: boolean): void {
    this.setValue(checked);
  }

  /**
   * Set the indeterminate state
   */
  setIndeterminate(indeterminate: boolean): void {
    this.props.indeterminate = indeterminate;
    // Clear checked when setting indeterminate
    if (indeterminate) {
      this.props.checked = false;
    }
  }

  /**
   * Toggle the checked state
   */
  toggle(): void {
    if (this.props.indeterminate) {
      // If indeterminate, go to checked
      this.setValue(true);
    } else {
      // Normal toggle
      this.setValue(!this.props.checked);
    }
  }

  /**
   * Calculate intrinsic size for the checkbox
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const { title } = this.props;

    // All indicators have the same width: [x], [ ], [-]
    const indicatorWidth = 3;

    let width: number;
    if (title) {
      // indicator + space + title
      width = indicatorWidth + 1 + getStringWidth(title);
    } else {
      width = indicatorWidth;
    }

    return { width, height: 1 }; // Checkboxes are single line
  }

  /**
   * Check if this checkbox can receive focus
   */
  canReceiveFocus(): boolean {
    return !this.props.disabled;
  }

  /**
   * Handle click event on this checkbox
   */
  handleClick(event: ClickEvent, _document: Document): boolean {
    if (this.props.disabled) return false;

    // Toggle the checked state
    this.toggle();

    const checked = this.props.checked || false;

    // Create change event with checked property
    const changeEvent: ChangeEvent = {
      type: 'change',
      value: String(checked),
      checked: checked,
      target: this.id,
      timestamp: Date.now(),
    };

    // Call onChange handler if provided (preferred)
    if (typeof this.props.onChange === 'function') {
      this.props.onChange(changeEvent);
    }

    // Call onClick handler if provided (backwards compat, deprecated)
    if (typeof this.props.onClick === 'function') {
      this.props.onClick(event);
    }

    return true; // Checkbox state changed, needs re-render
  }

  /**
   * Check if this checkbox is interactive
   */
  isInteractive(): boolean {
    return !this.props.disabled;
  }

  static validate(props: CheckboxProps): boolean {
    if (typeof props.title !== 'string' || props.title.length === 0) {
      return false;
    }
    if (props.checked !== undefined && typeof props.checked !== 'boolean') {
      return false;
    }
    if (props.indeterminate !== undefined && typeof props.indeterminate !== 'boolean') {
      return false;
    }
    return true;
  }
}

// Lint schema for checkbox component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const checkboxSchema: ComponentSchema = {
  description: 'Toggle checkbox with checked/unchecked/indeterminate states',
  props: {
    title: { type: 'string', required: true, description: 'Checkbox label text' },
    checked: { type: 'boolean', description: 'Whether checkbox is checked' },
    indeterminate: { type: 'boolean', description: 'Show partial/mixed state' },
    onChange: { type: 'handler', description: 'Called when checked state changes. Event: { checked: boolean, target, targetId }' },
    onClick: { type: 'handler', description: 'Deprecated: use onChange instead' },
  },
};

registerComponentSchema('checkbox', checkboxSchema);