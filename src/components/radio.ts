// Radio button component implementation

import { Element, BaseProps, Renderable, Focusable, Clickable, Interactive, Bounds, ComponentRenderContext, IntrinsicSizeContext, ClickEvent, ChangeEvent } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import type { Document } from '../document.ts';

export interface RadioProps extends BaseProps {
  title: string;
  value: string | number;
  checked?: boolean;
  name?: string; // Radio group name
  // onChange inherited from BaseProps - event includes { checked: boolean, value: string }
  onClick?: (event: ClickEvent) => void; // Deprecated: use onChange instead
}

export class RadioElement extends Element implements Renderable, Focusable, Clickable, Interactive {
  declare type: 'radio';
  declare props: RadioProps;

  constructor(props: RadioProps, children: Element[] = []) {
    const defaultProps: RadioProps = {
      checked: false,
      disabled: false,
      tabIndex: 0,
      ...props,
      style: {
        // Default styles would go here (none currently)
        paddingLeft: 1,
        ...props.style
      },
    };

    super('radio', defaultProps, children);
  }

  /**
   * Render the radio button to the terminal buffer
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    const { title, checked } = this.props;
    if (!title) return;

    // Check if this radio button is focused
    const isFocused = context.focusedElementId === this.id;

    let radioStyle = { ...style };

    // Create radio button indicator
    const indicator = checked ? '(●)' : '( )';
    const displayText = `${indicator} ${title}`;

    // Apply focus styling
    if (isFocused) {
      radioStyle.bold = true;
    }

    // Truncate if needed
    const maxTextLength = bounds.width;
    let finalText = displayText;
    if (displayText.length > maxTextLength) {
      finalText = displayText.substring(0, maxTextLength);
    }

    buffer.currentBuffer.setText(bounds.x, bounds.y, finalText, radioStyle);
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
  }

  /**
   * Toggle the checked state
   */
  toggle(): void {
    this.setValue(!this.props.checked);
  }

  /**
   * Calculate intrinsic size for the radio button
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const { title } = this.props;
    let width = 0;

    if (title) {
      // Calculate radio size: "(●) " or "( ) " + title
      width = title.length + 4; // "(?) " + title
    } else {
      width = 4; // Minimum for "(?) "
    }

    return { width, height: 1 }; // Radio buttons are single line
  }

  /**
   * Check if this radio button can receive focus
   */
  canReceiveFocus(): boolean {
    return !this.props.disabled;
  }

  /**
   * Handle click event on this radio button
   */
  handleClick(event: ClickEvent, document: Document): boolean {
    if (this.props.disabled) return false;

    const groupName = this.props.name;

    // Uncheck all other radios in the same group
    if (groupName) {
      const allRadios = document.getElementsByType('radio');
      for (const radio of allRadios) {
        if (radio.props.name === groupName && radio !== this) {
          radio.props.checked = false;
        }
      }
    }

    // Check this radio
    this.props.checked = true;

    // Create change event with checked property
    const changeEvent: ChangeEvent = {
      type: 'change',
      value: String(this.props.value),
      checked: true,
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

    return true; // Radio state changed, needs re-render
  }

  /**
   * Check if this radio button is interactive
   */
  isInteractive(): boolean {
    return !this.props.disabled;
  }

  static validate(props: RadioProps): boolean {
    if (typeof props.title !== 'string' || props.title.length === 0) {
      return false;
    }
    if (props.value === undefined) {
      return false;
    }
    if (props.checked !== undefined && typeof props.checked !== 'boolean') {
      return false;
    }
    if (props.name !== undefined && typeof props.name !== 'string') {
      return false;
    }
    return true;
  }
}

// Lint schema for radio component
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const radioSchema: ComponentSchema = {
  description: 'Radio button for single selection within a group',
  props: {
    title: { type: 'string', required: true, description: 'Radio button label' },
    value: { type: ['string', 'number'], required: true, description: 'Value when selected' },
    checked: { type: 'boolean', description: 'Whether this option is selected' },
    name: { type: 'string', description: 'Group name for mutual exclusion' },
    onChange: { type: 'handler', description: 'Called when selection changes. Event: { checked: boolean, value: string, target }' },
    onClick: { type: 'handler', description: 'Deprecated: use onChange instead' },
  },
};

registerComponentSchema('radio', radioSchema);

// Register radio component
registerComponent({
  type: 'radio',
  componentClass: RadioElement,
  defaultProps: {
    checked: false,
    disabled: false,
    tabIndex: 0,
  },
  validate: (props) => RadioElement.validate(props as any),
});