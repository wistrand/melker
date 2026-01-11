// List Item component - wrapper for list item content with markers
import { Element, BaseProps, Renderable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { getThemeColor } from '../theme.ts';
import { getLogger } from '../logging.ts';

const liLogger = getLogger('li');

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
        // No paddingLeft - li.render() handles marker + text layout
        // Ensure li doesn't shrink to 0 height in flex container
        flexShrink: 0,
        height: 1,
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
    // Debug: log bounds for each li
    liLogger.debug(`li.render: id=${this.id}, bounds=${JSON.stringify(bounds)}, focused=${this.props.focused}`);

    // Li components render: marker + child content (text, etc.)
    const { focused, selected } = this.props;

    // Determine marker based on focused/selected state
    let marker: string;
    let markerStyle: Partial<Cell> = { ...style };

    if (focused && selected) {
      marker = '*';
      markerStyle.foreground = getThemeColor('focusPrimary');
      markerStyle.background = getThemeColor('focusBackground');
    } else if (focused) {
      marker = '>';
      markerStyle.foreground = getThemeColor('focusPrimary');
      markerStyle.background = getThemeColor('focusBackground');
    } else if (selected) {
      marker = '*';
      markerStyle.foreground = getThemeColor('primary');
    } else {
      marker = '-';
      markerStyle.foreground = getThemeColor('textSecondary');
    }

    // Render marker at the start of the line
    buffer.currentBuffer.setCell(bounds.x, bounds.y, {
      char: marker,
      foreground: markerStyle.foreground,
      background: markerStyle.background,
    });

    // Get the text content from child text elements and render after marker
    if (this.children && this.children.length > 0) {
      for (const child of this.children) {
        if (child.type === 'text' && child.props?.text) {
          const text = String(child.props.text);

          // Leave space for marker + space, truncate to fit remaining width
          const textX = bounds.x + 2;
          const availableWidth = bounds.width - 2;
          const displayText = text.length > availableWidth
            ? text.substring(0, availableWidth)
            : text;

          // Render text after the marker
          buffer.currentBuffer.setText(textX, bounds.y, displayText, style);
        }
      }
    }
  }

  // Validation for li props
  static validate(props: LiProps): boolean {
    // Li components are simple wrappers with minimal validation requirements
    return true;
  }
}

// Lint schema for li component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';
import { registerComponent } from '../element.ts';

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

// Register li component for createElement
registerComponent({
  type: 'li',
  componentClass: LiElement,
  defaultProps: {
    style: {
      display: 'block',
      flexShrink: 0,
      height: 1,
    },
  },
});