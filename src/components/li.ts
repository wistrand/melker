// List Item component - wrapper for list item content with markers
import { Element, BaseProps, Renderable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { getThemeColor } from '../theme.ts';

export interface LiProps extends BaseProps {
  // Li components provide list styling with markers and indentation
  // They can contain any child components (text, buttons, containers, etc.)
  marker?: string; // Custom list marker (defaults to '-')
  indent?: number; // Custom indentation level (defaults to 2)
  focused?: boolean; // Whether this li is currently focused
  selected?: boolean; // Whether this li is currently selected
  selectionMode?: 'none' | 'single' | 'multiple'; // Selection mode from parent list
}

export class LiElement extends Element implements Renderable {
  declare type: 'li';
  declare props: LiProps;

  constructor(props: LiProps = {}, children: Element[] = []) {
    const defaultIndent = props.indent ?? 2;

    const defaultProps: LiProps = {
      style: {
        display: 'block',
        paddingLeft: defaultIndent, // Default indentation
        ...props.style
      },
      marker: props.marker ?? '-', // Default list marker
      indent: defaultIndent,
      disabled: false,
      ...props,
    };

    super('li', defaultProps, children);
  }

  getIntrinsicSize(_context: IntrinsicSizeContext) {
    // Li elements should take the full width of their container
    // Height is determined by their content
    return {
      minWidth: 1,
      minHeight: 1,
      maxWidth: Infinity,
      maxHeight: Infinity
    };
  }

  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    // Li elements should take full width available
    // Height is calculated based on content (typically 1 line for simple content)
    const width = context.availableSpace.width || 1;

    // For now, assume single line height - this could be enhanced
    // to calculate based on child content
    const height = 1;

    return { width, height };
  }

  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Li components provide structure and indentation
    // The parent list component handles all marker rendering
    // so we don't need to render anything here - just let the layout system
    // handle child rendering with the proper indentation (paddingLeft)
  }

  // Validation for li props
  static validate(props: LiProps): boolean {
    // Li components are simple wrappers with minimal validation requirements
    return true;
  }
}

// Lint schema for li component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const liSchema: ComponentSchema = {
  description: 'List item within a list container',
  props: {
    marker: { type: 'string', description: 'Custom bullet/number marker' },
    indent: { type: 'number', description: 'Indentation level' },
    focused: { type: 'boolean', description: 'Item has focus' },
    selected: { type: 'boolean', description: 'Item is selected' },
    selectionMode: { type: 'string', enum: ['none', 'single', 'multiple'], description: 'Selection mode (inherited from list)' },
  },
};

registerComponentSchema('li', liSchema);