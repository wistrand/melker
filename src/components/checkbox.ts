// Checkbox component implementation

import { Element, BaseProps, Renderable, Focusable, Clickable, Interactive, Bounds, ComponentRenderContext, IntrinsicSizeContext, ClickEvent } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import type { Document } from '../document.ts';

export interface CheckboxProps extends BaseProps {
  title: string;
  checked?: boolean;
  indeterminate?: boolean; // For tri-state checkboxes
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
    if (!title) return;

    // Check if this checkbox is focused
    const isFocused = context.focusedElementId === this.id;

    let checkboxStyle = { ...style };

    // Create checkbox indicator
    let indicator: string;
    if (indeterminate) {
      indicator = '[-]'; // Indeterminate state
    } else if (checked) {
      indicator = '[✓]'; // Checked state
    } else {
      indicator = '[ ]'; // Unchecked state
    }

    const displayText = `${indicator} ${title}`;

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
   * Get the current checked state
   */
  isChecked(): boolean {
    return this.props.checked || false;
  }

  /**
   * Get the current indeterminate state
   */
  isIndeterminate(): boolean {
    return this.props.indeterminate || false;
  }

  /**
   * Set the checked state
   */
  setChecked(checked: boolean): void {
    this.props.checked = checked;
    // Clear indeterminate when explicitly setting checked state
    if (checked !== undefined) {
      this.props.indeterminate = false;
    }
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
      this.setChecked(true);
    } else {
      // Normal toggle
      this.props.checked = !this.props.checked;
    }
  }

  /**
   * Calculate intrinsic size for the checkbox
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const { title } = this.props;
    let width = 0;

    if (title) {
      // Calculate checkbox size: "[✓] " or "[ ] " + title
      width = title.length + 4; // "[?] " + title
    } else {
      width = 4; // Minimum for "[?] "
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

    // Call onClick handler if provided
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
  },
};

registerComponentSchema('checkbox', checkboxSchema);