// Button component implementation

import { Element, BaseProps, Renderable, Focusable, Clickable, Interactive, TextSelectable, Bounds, ComponentRenderContext, IntrinsicSizeContext, ClickEvent } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import type { Document } from '../document.ts';

export interface ButtonProps extends BaseProps {
  title: string;
  variant?: 'default' | 'primary' | 'secondary' | 'plain';
}

export class ButtonElement extends Element implements Renderable, Focusable, Clickable, Interactive, TextSelectable {
  declare type: 'button';
  declare props: ButtonProps;

  // Store last render bounds for click detection
  private _lastRenderBounds: Bounds | null = null;

  constructor(props: ButtonProps, children: Element[] = []) {
    const defaultProps: ButtonProps = {
      variant: 'default',
      disabled: false,
      tabIndex: 0,
      ...props,
      style: {
        // Default styles would go here (none currently)
        ...props.style
      },
    };

    super('button', defaultProps, children);
  }

  /**
   * Render the button to the terminal buffer
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Store bounds for click detection
    this._lastRenderBounds = bounds;

    const { title } = this.props;
    if (!title) return;

    // Debug: Check for invalid bounds
    if (isNaN(bounds.x) || isNaN(bounds.y) || isNaN(bounds.width) || isNaN(bounds.height)) {
      console.error(`Button render error: Invalid bounds for button "${title}":`, {
        bounds,
        buttonId: this.id,
        props: this.props
      });
      throw new Error(`Invalid bounds for button "${title}": x=${bounds.x}, y=${bounds.y}, width=${bounds.width}, height=${bounds.height}`);
    }

    // Check if this button is focused or hovered
    const isFocused = context.focusedElementId === this.id;
    const isHovered = context.hoveredElementId === this.id;


    // Check if button has a custom border style or is plain variant
    const style$ = this.props.style;
    const hasBorder = style$?.border || style$?.borderLeft || style$?.borderRight || style$?.borderTop || style$?.borderBottom;
    const isPlain = this.props.variant === 'plain';

    let buttonStyle = { ...style };
    let displayText: string;

    if (hasBorder || isPlain) {
      // If button has a border or is plain, render without brackets
      displayText = title;
      if (isFocused) {
        if (isPlain) {
          // For plain buttons, show focus with background or bold
          buttonStyle.bold = true;
        } else {
          buttonStyle.bold = true;
        }
      }

      // Add underline when button is hovered (but not when focused to avoid conflict)
      if (isHovered && !isFocused) {
        buttonStyle.underline = true;
      }

      // Calculate individual border widths
      const borderLeftWidth = (style$?.border || style$?.borderLeft) ? 1 : 0;
      const borderRightWidth = (style$?.border || style$?.borderRight) ? 1 : 0;
      const borderTopWidth = (style$?.border || style$?.borderTop) ? 1 : 0;
      const borderBottomWidth = (style$?.border || style$?.borderBottom) ? 1 : 0;

      const paddingValue = this.props.style?.padding || 0;
      const paddingLeft = typeof paddingValue === 'number' ? paddingValue : (paddingValue.left || 0);
      const paddingTop = typeof paddingValue === 'number' ? paddingValue : (paddingValue.top || 0);
      const paddingRight = typeof paddingValue === 'number' ? paddingValue : (paddingValue.right || 0);
      const paddingBottom = typeof paddingValue === 'number' ? paddingValue : (paddingValue.bottom || 0);

      // Content must not overlap with borders - calculate inner content area
      const contentBounds: Bounds = {
        x: bounds.x + borderLeftWidth + paddingLeft,
        y: bounds.y + borderTopWidth + paddingTop,
        width: Math.max(0, bounds.width - borderLeftWidth - borderRightWidth - paddingLeft - paddingRight),
        height: Math.max(0, bounds.height - borderTopWidth - borderBottomWidth - paddingTop - paddingBottom)
      };


      // Only render text if we have valid content area
      if (contentBounds.width <= 0 || contentBounds.height <= 0) {
        return;
      }

      // Truncate if needed
      const maxTextLength = contentBounds.width;
      if (displayText.length > maxTextLength) {
        displayText = title.substring(0, maxTextLength);
      }

      // Calculate vertical position based on vertical-align
      const verticalAlign = this.props.style?.verticalAlign || 'center';
      let textY = contentBounds.y;

      if (contentBounds.height > 1) {
        switch (verticalAlign) {
          case 'top':
            textY = contentBounds.y;
            break;
          case 'bottom':
            textY = contentBounds.y + contentBounds.height - 1;
            break;
          case 'center':
          default:
            textY = contentBounds.y + Math.floor((contentBounds.height - 1) / 2);
            break;
        }
      }

      // Calculate horizontal position based on text-align
      const textAlign = this.props.style?.textAlign || 'center';
      let textX = contentBounds.x;

      if (contentBounds.width > displayText.length) {
        switch (textAlign) {
          case 'left':
            textX = contentBounds.x;
            break;
          case 'right':
            textX = contentBounds.x + contentBounds.width - displayText.length;
            break;
          case 'center':
          default:
            textX = contentBounds.x + Math.floor((contentBounds.width - displayText.length) / 2);
            break;
        }
      }

      buffer.currentBuffer.setText(textX, textY, displayText, buttonStyle);
    } else {
      // Default button style: render brackets separately so only label can be bold
      const maxTextLength = bounds.width;
      let truncatedLabel = title;

      // Account for "[ " and " ]" (4 characters)
      if (title.length + 4 > maxTextLength) {
        const innerMaxLength = Math.max(1, maxTextLength - 4);
        truncatedLabel = title.substring(0, innerMaxLength);
      }

      // Calculate horizontal position based on text-align for bracket style
      const textAlign = this.props.style?.textAlign || 'center';
      const fullButtonWidth = 4 + truncatedLabel.length; // "[ " + label + " ]"
      let buttonStartX = bounds.x;

      if (bounds.width > fullButtonWidth) {
        switch (textAlign) {
          case 'left':
            buttonStartX = bounds.x;
            break;
          case 'right':
            buttonStartX = bounds.x + bounds.width - fullButtonWidth;
            break;
          case 'center':
          default:
            buttonStartX = bounds.x + Math.floor((bounds.width - fullButtonWidth) / 2);
            break;
        }
      }

      // Render opening bracket
      buffer.currentBuffer.setText(buttonStartX, bounds.y, '[ ', buttonStyle);

      // Render label (bold if focused, or add focus indicator if already bold)
      const isAlreadyBold = buttonStyle.bold === true;
      let labelStyle = buttonStyle;
      let focusedLabel = truncatedLabel;

      if (isFocused) {
        if (isAlreadyBold) {
          // Button is already bold, add underline as focus indicator
          labelStyle = { ...buttonStyle, underline: true };
        } else {
          // Button is not bold, make it bold when focused
          labelStyle = { ...buttonStyle, bold: true };
        }
      } else if (isHovered) {
        // Add underline when button is hovered (but not when focused to avoid conflict)
        labelStyle = { ...buttonStyle, underline: true };
      }
      buffer.currentBuffer.setText(buttonStartX + 2, bounds.y, focusedLabel, labelStyle);

      // Render closing bracket
      buffer.currentBuffer.setText(buttonStartX + 2 + focusedLabel.length, bounds.y, ' ]', buttonStyle);
    }
  }

  /**
   * Calculate intrinsic size for the button
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const { title, variant } = this.props;
    const style$ = this.props.style;

    // Check for any border (matches render logic)
    const hasBorder = style$?.border || style$?.borderLeft || style$?.borderRight || style$?.borderTop || style$?.borderBottom;
    const isPlain = variant === 'plain';

    // Calculate border widths
    const borderLeftWidth = (style$?.border || style$?.borderLeft) ? 1 : 0;
    const borderRightWidth = (style$?.border || style$?.borderRight) ? 1 : 0;

    let width = 0;

    if (title) {
      const labelLength = title.length;

      if (hasBorder || isPlain) {
        // Content size is just the text width plus borders
        width = labelLength + borderLeftWidth + borderRightWidth;
      } else {
        // Default button style adds "[ ]" around title
        width = labelLength + 4; // "[ " + label + " ]"
      }
    } else {
      if (hasBorder || isPlain) {
        width = borderLeftWidth + borderRightWidth;
      } else {
        width = 4; // Minimum for "[ ]"
      }
    }

    return { width, height: 1 }; // Buttons are single line
  }

  /**
   * Check if this button can receive focus
   */
  canReceiveFocus(): boolean {
    return !this.props.disabled;
  }

  /**
   * Handle click event on this button
   */
  handleClick(event: ClickEvent, _document: Document): boolean {
    if (this.props.disabled) return false;

    // Check if click is within our bounds (if bounds are available)
    if (this._lastRenderBounds && event.position) {
      const { x, y } = event.position;
      const b = this._lastRenderBounds;
      if (x < b.x || x >= b.x + b.width || y < b.y || y >= b.y + b.height) {
        // Click is outside button bounds
        return false;
      }
    }

    // Call onClick handler if provided
    if (typeof this.props.onClick === 'function') {
      this.props.onClick(event);
    }

    return true; // Button was clicked, needs re-render
  }

  /**
   * Check if this button is interactive
   */
  isInteractive(): boolean {
    return !this.props.disabled;
  }

  /**
   * Check if this button supports text selection
   */
  isTextSelectable(): boolean {
    return true;
  }

  static validate(props: ButtonProps): boolean {
    if (typeof props.title !== 'string' || props.title.length === 0) {
      return false;
    }
    if (props.variant !== undefined && !['default', 'primary', 'secondary', 'plain'].includes(props.variant)) {
      return false;
    }
    return true;
  }
}

// Lint schema for button component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const buttonSchema: ComponentSchema = {
  description: 'Clickable button with keyboard and mouse support',
  props: {
    title: { type: 'string', required: true, description: 'Button label text' },
    variant: { type: 'string', enum: ['default', 'primary', 'secondary', 'plain'], description: 'Visual style variant' },
  },
};

registerComponentSchema('button', buttonSchema);