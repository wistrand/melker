// Container component implementation

import { Element, BaseProps, Renderable, TextSelectable, IntrinsicSizeContext, Bounds, ComponentRenderContext, isRenderable, hasIntrinsicSize } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';

export interface ContainerProps extends BaseProps {
  scrollable?: boolean;
  scrollX?: number;
  scrollY?: number;
}

// Type for container and container-like elements (used by scrolling system)
export type ContainerLikeType = 'container' | 'thead' | 'tbody' | 'tfoot';

export class ContainerElement extends Element implements Renderable, TextSelectable {
  declare type: ContainerLikeType;
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
    // For flex containers, calculate minimum space needed for children
    const containerProps = this.props as ContainerProps & { style?: any };
    const rawStyle = containerProps?.style || {};

    // Check for explicit style dimensions (user intent takes priority)
    const explicitWidth = typeof rawStyle.width === 'number' ? rawStyle.width : undefined;
    const explicitHeight = typeof rawStyle.height === 'number' ? rawStyle.height : undefined;

    // If both dimensions are explicit, return them directly
    if (explicitWidth !== undefined && explicitHeight !== undefined) {
      return { width: explicitWidth, height: explicitHeight };
    }

    // For containers, calculate size based on children
    if (!this.children || this.children.length === 0) {
      return {
        width: explicitWidth ?? 0,
        height: explicitHeight ?? 0,
      };
    }

    // Apply container type defaults (same as layout engine's _computeStyle)
    // This ensures intrinsic size calculation matches layout behavior
    const typeDefaults = ContainerElement.getDefaultStyle();
    const style = {
      ...typeDefaults,
      ...rawStyle,  // User/stylesheet styles override defaults
    };

    // Determine flex direction
    const isFlexRow = style.display === 'flex' &&
                      (style.flexDirection === 'row' || style.flexDirection === 'row-reverse');

    // Get gap value from style
    const gap = typeof style.gap === 'number' ? style.gap : 0;

    let totalWidth = 0;
    let totalHeight = 0;
    let childCount = 0;

    if (isFlexRow) {
      // Row layout: sum widths, take max height
      for (const child of this.children) {
        if (hasIntrinsicSize(child)) {
          const intrinsicSize = child.intrinsicSize(context);
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

          // Add horizontal padding space for elements without explicit dimensions but with padding
          // Note: Only add horizontal padding here; vertical padding is handled by layout engine
          // to avoid double-counting (layout engine adds padding when sizing flex items)
          const childPadding = child.props?.style?.padding;
          if (childPadding !== undefined && child.props?.style?.width === undefined) {
            const padH = typeof childPadding === 'number' ? childPadding * 2 : ((childPadding.left || 0) + (childPadding.right || 0));
            childWidth += padH;
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
        if (hasIntrinsicSize(child)) {
          const intrinsicSize = child.intrinsicSize(context);
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

          // Add horizontal padding space for elements without explicit dimensions but with padding
          // Note: Only add horizontal padding here; vertical padding is handled by layout engine
          const childPadding = child.props?.style?.padding;
          if (childPadding !== undefined && child.props?.style?.width === undefined) {
            const padH = typeof childPadding === 'number' ? childPadding * 2 : ((childPadding.left || 0) + (childPadding.right || 0));
            childWidth += padH;
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

    // Note: Do NOT add own padding/border here - layout engine adds them separately
    // (intrinsicSize returns content size only, layout adds padding + border for outer size)
    // Child borders are added above because we need to know total space children will occupy

    return {
      // Use explicit dimension if set, otherwise use calculated child size
      width: explicitWidth ?? totalWidth,
      height: explicitHeight ?? totalHeight,
    };
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

// Register container component for createElement to create ContainerElement instances
import { registerComponent } from '../element.ts';

registerComponent({
  type: 'container',
  componentClass: ContainerElement,
  defaultProps: {
    style: ContainerElement.getDefaultStyle(),
  },
});

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