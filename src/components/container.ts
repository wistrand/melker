// Container component implementation

import { Element, BaseProps, Renderable, TextSelectable, IntrinsicSizeContext, Bounds, ComponentRenderContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';

export interface ContainerProps extends BaseProps {
  scrollable?: boolean;
  scrollX?: number;
  scrollY?: number;
}

export class ContainerElement extends Element implements Renderable, TextSelectable {
  declare type: 'container';
  declare props: ContainerProps;

  constructor(props: ContainerProps = {}, children: Element[] = []) {
    // Don't add style defaults here - let stylesheet and layout system handle them
    // This allows stylesheet styles to override defaults properly
    const defaultProps: ContainerProps = {
      scrollable: false,
      scrollX: 0,
      scrollY: 0,
      ...props,
    };

    super('container', defaultProps, children);
  }

  /**
   * Get default styles for containers (used by layout system)
   */
  static getDefaultStyle() {
    return {
      display: 'flex',
      flexDirection: 'column',
      overflow: 'visible',
    };
  }

  /**
   * Render method for Renderable interface (containers are rendered by the layout system)
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Containers are typically rendered by the layout system, not directly
    // This method exists to satisfy the Renderable interface
  }

  /**
   * Calculate intrinsic size for the container
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    // For containers, calculate size based on children
    if (!this.children || this.children.length === 0) {
      return { width: 0, height: 0 };
    }

    // For flex containers, calculate minimum space needed for children
    const containerProps = this.props as ContainerProps & { style?: any };
    const style = containerProps?.style;

    // Determine flex direction - check both object and string styles
    let isFlexRow = false;
    if (typeof style === 'object' && style !== null) {
      isFlexRow = style.display === 'flex' &&
                  (style.flexDirection === 'row' || !style.flexDirection);
    }
    // Note: string styles are parsed by the layout system, default to column for containers

    // Get gap value from style
    let gap = 0;
    if (typeof style === 'object' && style !== null && typeof style.gap === 'number') {
      gap = style.gap;
    }

    let totalWidth = 0;
    let totalHeight = 0;
    let childCount = 0;

    if (isFlexRow) {
      // Row layout: sum widths, take max height
      for (const child of this.children) {
        if ((child as any).intrinsicSize) {
          const intrinsicSize = (child as any).intrinsicSize(context);
          // Use explicit numeric dimensions if available, otherwise use intrinsic size + border space
          let childWidth = typeof child.props?.style?.width === 'number' ? child.props.style.width : intrinsicSize.width;
          let childHeight = typeof child.props?.style?.height === 'number' ? child.props.style.height : intrinsicSize.height;

          // Add border space for elements without explicit dimensions but with borders
          if (child.props?.style?.border && child.props?.style?.width === undefined) {
            childWidth += 2; // Add left + right border
          }
          if (child.props?.style?.border && child.props?.style?.height === undefined) {
            childHeight += 2; // Add top + bottom border
          }

          totalWidth += childWidth;
          totalHeight = Math.max(totalHeight, childHeight);
          childCount++;
        }
      }
      // Add gaps between children (row: horizontal gaps)
      if (childCount > 1) {
        totalWidth += gap * (childCount - 1);
      }
    } else {
      // Column layout or block: take max width, sum heights
      for (const child of this.children) {
        if ((child as any).intrinsicSize) {
          const intrinsicSize = (child as any).intrinsicSize(context);
          // Use explicit numeric dimensions if available, otherwise use intrinsic size + border space
          let childWidth = typeof child.props?.style?.width === 'number' ? child.props.style.width : intrinsicSize.width;
          let childHeight = typeof child.props?.style?.height === 'number' ? child.props.style.height : intrinsicSize.height;

          // Add border space for elements without explicit dimensions but with borders
          if (child.props?.style?.border && child.props?.style?.width === undefined) {
            childWidth += 2; // Add left + right border
          }
          if (child.props?.style?.border && child.props?.style?.height === undefined) {
            childHeight += 2; // Add top + bottom border
          }

          totalWidth = Math.max(totalWidth, childWidth);
          totalHeight += childHeight;
          childCount++;
        }
      }
      // Add gaps between children (column: vertical gaps)
      if (childCount > 1) {
        totalHeight += gap * (childCount - 1);
      }
    }

    return { width: totalWidth, height: totalHeight };
  }

  /**
   * Check if this container supports text selection
   */
  isTextSelectable(): boolean {
    return true;
  }

  static validate(props: ContainerProps): boolean {
    if (props.width !== undefined && typeof props.width !== 'number' && props.width !== 'auto' && props.width !== 'fill') {
      return false;
    }
    if (props.height !== undefined && typeof props.height !== 'number' && props.height !== 'auto' && props.height !== 'fill') {
      return false;
    }
    return true;
  }
}

// Lint schema for container component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const containerSchema: ComponentSchema = {
  description: 'Flexbox layout container for grouping and arranging child elements',
  props: {
    scrollable: { type: 'boolean', description: 'Enable scrolling when content overflows' },
    scrollX: { type: 'number', description: 'Horizontal scroll offset' },
    scrollY: { type: 'number', description: 'Vertical scroll offset' },
  },
};

registerComponentSchema('container', containerSchema);