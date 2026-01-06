// Group element - groups options under a header in filterable list components
import { Element, BaseProps, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../../types.ts';
import type { DualBuffer, Cell } from '../../buffer.ts';
import { registerComponent } from '../../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../../lint.ts';
import { OptionElement } from './option.ts';
import { getLogger } from '../../logging.ts';

const logger = getLogger('filterable-list');

export interface GroupProps extends BaseProps {
  /** Header label for this group */
  label: string;
}

/**
 * GroupElement - Groups options under a header in filterable list components.
 *
 * This element is a data container - it doesn't render itself.
 * The parent filterable-list component extracts group data and handles rendering.
 *
 * Usage:
 * ```xml
 * <group label="File">
 *   <option value="file.new" shortcut="Ctrl+N">New File</option>
 *   <option value="file.open" shortcut="Ctrl+O">Open...</option>
 * </group>
 * ```
 */
export class GroupElement extends Element {
  declare type: 'group';
  declare props: GroupProps;

  /** Validated option children */
  private _optionElements: OptionElement[] = [];

  constructor(props: GroupProps = { label: '' }, children: Element[] = []) {
    // Filter children to only accept option elements
    const optionElements: OptionElement[] = [];
    for (const child of children) {
      if (child.type === 'option') {
        optionElements.push(child as OptionElement);
      } else {
        logger.warn(`Group only accepts option children, ignoring ${child.type}`);
      }
    }

    const defaultProps: GroupProps = {
      ...props,
    };

    super('group', defaultProps, optionElements);
    this._optionElements = optionElements;
  }

  /**
   * Get the group's header label
   */
  getLabel(): string {
    return this.props.label || '';
  }

  /**
   * Get all option elements in this group
   */
  getOptions(): OptionElement[] {
    return this._optionElements;
  }

  /**
   * Get option count
   */
  getOptionCount(): number {
    return this._optionElements.length;
  }

  /**
   * Groups don't have intrinsic size - parent handles layout
   */
  intrinsicSize(_context: IntrinsicSizeContext): { width: number; height: number } {
    return { width: 0, height: 0 };
  }

  /**
   * Groups don't render themselves - parent handles rendering
   */
  render(_bounds: Bounds, _style: Partial<Cell>, _buffer: DualBuffer, _context: ComponentRenderContext): void {
    // No-op: Parent component renders groups
  }
}

// Register the group component
registerComponent({
  type: 'group',
  componentClass: GroupElement,
  defaultProps: {
    label: '',
  },
});

// Lint schema for group component
export const groupSchema: ComponentSchema = {
  description: 'Groups options under a header in combobox, select, autocomplete, or command-palette',
  props: {
    label: { type: 'string', required: true, description: 'Header text for this group' },
  },
};

registerComponentSchema('group', groupSchema);
