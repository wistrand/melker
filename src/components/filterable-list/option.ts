// Option element - represents a selectable item in filterable list components
import { Element, BaseProps, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../../types.ts';
import type { DualBuffer, Cell } from '../../buffer.ts';
import { registerComponent } from '../../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../../lint.ts';

export interface OptionProps extends BaseProps {
  /** Unique value/identifier for this option */
  value?: string;
  /** Display label (if not using text content) */
  label?: string;
  /** Whether this option is disabled */
  disabled?: boolean;
  /** Keyboard shortcut to display (for command-palette) */
  shortcut?: string;
  /** Individual select handler for this option */
  onSelect?: (event: { type: string; value: string; label: string; targetId: string }) => void;
}

/**
 * OptionElement - A selectable item within combobox, select, autocomplete, or command-palette.
 *
 * This element is a data container - it doesn't render itself.
 * The parent filterable-list component extracts option data and handles rendering.
 *
 * Usage:
 * ```xml
 * <option value="us">United States</option>
 * <option value="uk" shortcut="Ctrl+U">United Kingdom</option>
 * <option value="disabled" disabled="true">Not available</option>
 * ```
 */
export class OptionElement extends Element {
  declare type: 'option';
  declare props: OptionProps;

  constructor(props: OptionProps = {}, children: Element[] = []) {
    const defaultProps: OptionProps = {
      disabled: false,
      ...props,
    };

    super('option', defaultProps, children);
  }

  /**
   * Get the option's value (props.value or text content)
   */
  getValue(): string {
    return this.props.value ?? this.getLabel();
  }

  /**
   * Get the option's display label (props.label or text content)
   */
  getLabel(): string {
    if (this.props.label) {
      return this.props.label;
    }

    // Extract text content from children
    return this._extractTextContent();
  }

  /**
   * Check if this option is disabled
   */
  isDisabled(): boolean {
    return this.props.disabled === true;
  }

  /**
   * Get keyboard shortcut (if any)
   */
  getShortcut(): string | undefined {
    return this.props.shortcut;
  }

  /**
   * Extract text content from children (text elements)
   */
  private _extractTextContent(): string {
    if (!this.children || this.children.length === 0) {
      return '';
    }

    const parts: string[] = [];
    for (const child of this.children) {
      // Text elements use props.text (not props.content)
      if (child.type === 'text' && child.props.text) {
        parts.push(child.props.text);
      } else if (typeof (child as any).textContent === 'string') {
        parts.push((child as any).textContent);
      }
    }

    return parts.join('');
  }

  /**
   * Options don't have intrinsic size - parent handles layout
   */
  intrinsicSize(_context: IntrinsicSizeContext): { width: number; height: number } {
    return { width: 0, height: 0 };
  }

  /**
   * Options don't render themselves - parent handles rendering
   */
  render(_bounds: Bounds, _style: Partial<Cell>, _buffer: DualBuffer, _context: ComponentRenderContext): void {
    // No-op: Parent component renders options
  }
}

// Register the option component
registerComponent({
  type: 'option',
  componentClass: OptionElement,
  defaultProps: {
    disabled: false,
  },
});

// Lint schema for option component
export const optionSchema: ComponentSchema = {
  description: 'Selectable option within combobox, select, autocomplete, or command-palette',
  props: {
    value: { type: 'string', description: 'Unique identifier for this option' },
    label: { type: 'string', description: 'Display label (alternative to text content)' },
    disabled: { type: 'boolean', description: 'Whether option is disabled' },
    shortcut: { type: 'string', description: 'Keyboard shortcut display (e.g., "Ctrl+N")' },
    onSelect: { type: 'function', description: 'Handler called when this option is selected' },
  },
};

registerComponentSchema('option', optionSchema);
