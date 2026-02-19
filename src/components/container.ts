// Container component implementation

import { Element, BaseProps, Renderable, Focusable, TextSelectable, IntrinsicSizeContext, Bounds, ComponentRenderContext, isRenderable, hasIntrinsicSize, isScrollingEnabled } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';

export interface ContainerProps extends BaseProps {
  scrollable?: boolean;
  scrollX?: number;
  scrollY?: number;
}

// Type for container and container-like elements (used by scrolling system)
export type ContainerLikeType = 'container' | 'thead' | 'tbody' | 'tfoot';

export class ContainerElement extends Element implements Renderable, Focusable, TextSelectable {
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
  static getDefaultStyle(): { display: string; flexDirection: string; overflow: string } {
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
   * Scrollable containers can receive keyboard focus for arrow-key scrolling.
   */
  canReceiveFocus(): boolean {
    return isScrollingEnabled(this);
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

    const isWrap = style.flexWrap === 'wrap' || style.flexWrap === 'wrap-reverse';

    // Helper: get child intrinsicSize with per-frame cache support
    const cache = context._sizeCache;
    const aw = context.availableSpace.width;
    const ah = context.availableSpace.height;
    const getChildSize = (child: Element & { intrinsicSize(ctx: IntrinsicSizeContext): { width: number; height: number } }) => {
      if (cache) {
        const cached = cache.get(child);
        if (cached && cached.aw === aw && cached.ah === ah) return cached.result;
        const result = child.intrinsicSize(context);
        cache.set(child, { aw, ah, result });
        return result;
      }
      return child.intrinsicSize(context);
    };

    if (isFlexRow) {
      // Row layout: sum widths, take max height
      // When flex-wrap is active, simulate line-breaking to compute correct total height
      const childSizes: Array<{ w: number; h: number }> = [];
      for (const child of this.children) {
        if (hasIntrinsicSize(child)) {
          const intrinsicSize = getChildSize(child);
          // Use explicit numeric dimensions if available, otherwise use intrinsic size + border space
          let childWidth = typeof child.props?.style?.width === 'number' ? child.props.style.width : intrinsicSize.width;
          let childHeight = typeof child.props?.style?.height === 'number' ? child.props.style.height : intrinsicSize.height;

          // Calculate border + padding to get outer size
          // Uses max(declared, intrinsic + border + padding) to match _calculateFlexItems
          // which computes flexBasis = max(explicitDim, intrinsicOuter)
          const hasBorder = child.props?.style?.border && child.props.style.border !== 'none';
          const borderW = hasBorder ? 2 : 0;
          const borderH = hasBorder ? 2 : 0;
          const childPadding = child.props?.style?.padding;
          let padW = 0, padH = 0;
          if (childPadding !== undefined) {
            padW = typeof childPadding === 'number' ? childPadding * 2 : ((childPadding.left || 0) + (childPadding.right || 0));
            padH = typeof childPadding === 'number' ? childPadding * 2 : ((childPadding.top || 0) + (childPadding.bottom || 0));
          }
          childWidth = Math.max(childWidth, intrinsicSize.width + borderW + padW);
          childHeight = Math.max(childHeight, intrinsicSize.height + borderH + padH);

          // Add child margin to size calculations
          const childMargin = child.props?.style?.margin;
          let marginH = 0;
          let marginV = 0;
          if (childMargin !== undefined) {
            marginH = typeof childMargin === 'number' ? childMargin * 2 : ((childMargin.left || 0) + (childMargin.right || 0));
            marginV = typeof childMargin === 'number' ? childMargin * 2 : ((childMargin.top || 0) + (childMargin.bottom || 0));
          }

          const outerW = childWidth + marginH;
          const outerH = childHeight + marginV;
          childSizes.push({ w: outerW, h: outerH });
          totalWidth += outerW;
          totalHeight = Math.max(totalHeight, outerH);
          if (childWidth > 0) childCount++;
        }
      }

      if (isWrap && context.availableSpace.width > 0) {
        // Simulate line-breaking to determine wrapped height
        const availW = context.availableSpace.width;
        let lineWidth = 0;
        let lineHeight = 0;
        let lineChildCount = 0;
        let rowCount = 0;
        totalHeight = 0;

        for (const cs of childSizes) {
          if (cs.w <= 0) continue; // zero-width children don't affect wrapping
          const gapBefore = lineChildCount > 0 ? gap : 0;
          if (lineChildCount > 0 && lineWidth + gapBefore + cs.w > availW) {
            // Wrap to new line
            totalHeight += lineHeight;
            rowCount++;
            lineWidth = cs.w;
            lineHeight = cs.h;
            lineChildCount = 1;
          } else {
            lineWidth += gapBefore + cs.w;
            lineHeight = Math.max(lineHeight, cs.h);
            lineChildCount++;
          }
        }
        // Add last line
        if (lineChildCount > 0) {
          totalHeight += lineHeight;
          rowCount++;
        }
        // Add inter-row gaps
        if (rowCount > 1) {
          totalHeight += gap * (rowCount - 1);
        }
      } else {
        // No wrap: add gaps between children (row: horizontal gaps)
        if (childCount > 1) {
          totalWidth += gap * (childCount - 1);
        }
      }
    } else {
      // Column layout or block: take max width, sum heights
      for (const child of this.children) {
        if (hasIntrinsicSize(child)) {
          const intrinsicSize = getChildSize(child);
          // Use explicit numeric dimensions if available, otherwise use intrinsic size + border space
          let childWidth = typeof child.props?.style?.width === 'number' ? child.props.style.width : intrinsicSize.width;
          let childHeight = typeof child.props?.style?.height === 'number' ? child.props.style.height : intrinsicSize.height;

          // Calculate border + padding to get outer size (same as row path)
          const hasBorder = child.props?.style?.border && child.props.style.border !== 'none';
          const borderW = hasBorder ? 2 : 0;
          const borderH = hasBorder ? 2 : 0;
          const childPadding = child.props?.style?.padding;
          let padW = 0, padH = 0;
          if (childPadding !== undefined) {
            padW = typeof childPadding === 'number' ? childPadding * 2 : ((childPadding.left || 0) + (childPadding.right || 0));
            padH = typeof childPadding === 'number' ? childPadding * 2 : ((childPadding.top || 0) + (childPadding.bottom || 0));
          }
          childWidth = Math.max(childWidth, intrinsicSize.width + borderW + padW);
          childHeight = Math.max(childHeight, intrinsicSize.height + borderH + padH);

          // Add child margin to height calculation
          const childMargin = child.props?.style?.margin;
          let marginV = 0;
          if (childMargin !== undefined) {
            marginV = typeof childMargin === 'number' ? childMargin * 2 : ((childMargin.top || 0) + (childMargin.bottom || 0));
          }

          totalWidth = Math.max(totalWidth, childWidth);
          totalHeight += childHeight + marginV;
          // Only count children with non-zero height for gap calculation
          // (e.g., connectors return 0x0 and shouldn't contribute to gap spacing)
          if (childHeight > 0) childCount++;
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
    // Note: style defaults are handled by ContainerElement constructor
    // Don't add style here as it would override stylesheet styles
    scrollable: false,
    scrollX: 0,
    scrollY: 0,
  },
  validate: (props) => ContainerElement.validate(props as any),
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