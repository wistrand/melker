// Radio button component implementation

import { Element, BaseProps, Renderable, Focusable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';

export interface RadioProps extends BaseProps {
  title: string;
  value: string | number;
  checked?: boolean;
  name?: string; // Radio group name
}

export class RadioElement extends Element implements Renderable, Focusable {
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
   * Get the current checked state
   */
  isChecked(): boolean {
    return this.props.checked || false;
  }

  /**
   * Set the checked state
   */
  setChecked(checked: boolean): void {
    this.props.checked = checked;
  }

  /**
   * Toggle the checked state
   */
  toggle(): void {
    this.props.checked = !this.props.checked;
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
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const radioSchema: ComponentSchema = {
  description: 'Radio button for single selection within a group',
  props: {
    title: { type: 'string', required: true, description: 'Radio button label' },
    value: { type: ['string', 'number'], required: true, description: 'Value when selected' },
    checked: { type: 'boolean', description: 'Whether this option is selected' },
    name: { type: 'string', description: 'Group name for mutual exclusion' },
  },
};

registerComponentSchema('radio', radioSchema);