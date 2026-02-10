// Content measurement utilities for layout calculations
import { Element, Size, IntrinsicSizeContext, BoxSpacing, isRenderable } from './types.ts';

export interface ContentMeasureContext {
  availableWidth: number;
  parentStyle?: any;
}

/**
 * ContentMeasurer provides consistent content dimension calculations
 * across all layout operations, eliminating the need for ad-hoc measurements
 */
export class ContentMeasurer {

  /**
   * Measure the total content dimensions for a container element
   */
  measureContainer(container: Element, availableWidth: number): Size {
    if (!container.children || container.children.length === 0) {
      return { width: 0, height: 0 };
    }

    // Fast path for scrollable containers with many children
    // Uses sampling to estimate total height instead of measuring all children
    const FAST_PATH_THRESHOLD = 50;
    if (container.props?.scrollable && container.children.length > FAST_PATH_THRESHOLD) {
      return this._measureContainerFastPath(container, availableWidth);
    }

    // Get gap from container style (for flex containers)
    const containerStyle = container.props?.style || {};
    const gap = this._parseNumberValue(containerStyle.gap) || 0;
    const flexDirection = containerStyle.flexDirection || containerStyle['flex-direction'] || 'column';
    const isRow = flexDirection === 'row' || flexDirection === 'row-reverse';

    const flexWrap = containerStyle.flexWrap || containerStyle['flex-wrap'];
    const isWrap = flexWrap === 'wrap' || flexWrap === 'wrap-reverse';

    let totalHeight = 0;
    let totalWidth = 0;
    let maxHeight = 0;
    let maxWidth = 0;
    let visibleChildCount = 0;
    const childSizes: Array<{ w: number; h: number }> = [];

    for (const child of container.children) {
      const childSize = this.measureElement(child, availableWidth);
      const childMargin = this._getChildMargin(child);

      const childHeightWithMargin = childSize.height + (childMargin.top || 0) + (childMargin.bottom || 0);
      const childWidthWithMargin = childSize.width + (childMargin.left || 0) + (childMargin.right || 0);

      totalHeight += childHeightWithMargin;
      totalWidth += childWidthWithMargin;
      maxHeight = Math.max(maxHeight, childHeightWithMargin);
      maxWidth = Math.max(maxWidth, childWidthWithMargin);

      childSizes.push({ w: childWidthWithMargin, h: childHeightWithMargin });
      // Only count children with non-zero main-axis size for gap calculation
      const mainSize = isRow ? childWidthWithMargin : childHeightWithMargin;
      if (mainSize > 0) visibleChildCount++;
    }

    // Add gaps between children
    if (visibleChildCount > 1 && gap > 0) {
      if (isRow) {
        totalWidth += (visibleChildCount - 1) * gap;
      } else {
        totalHeight += (visibleChildCount - 1) * gap;
      }
    }

    let resultWidth: number;
    let resultHeight: number;

    if (isRow && isWrap && availableWidth > 0) {
      // Simulate line-breaking to determine wrapped height
      let lineWidth = 0;
      let lineHeight = 0;
      let lineChildCount = 0;
      let rowCount = 0;
      let wrappedHeight = 0;

      for (const cs of childSizes) {
        if (cs.w <= 0) continue;
        const gapBefore = lineChildCount > 0 ? gap : 0;
        if (lineChildCount > 0 && lineWidth + gapBefore + cs.w > availableWidth) {
          wrappedHeight += lineHeight;
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
      if (lineChildCount > 0) {
        wrappedHeight += lineHeight;
        rowCount++;
      }
      if (rowCount > 1) {
        wrappedHeight += gap * (rowCount - 1);
      }
      resultWidth = totalWidth;
      resultHeight = wrappedHeight;
    } else {
      // For row layout: width is sum, height is max
      // For column layout: width is max, height is sum
      resultWidth = isRow ? totalWidth : maxWidth;
      resultHeight = isRow ? maxHeight : totalHeight;
    }

    return { width: maxWidth, height: resultHeight };
  }

  /**
   * Measure a single element's dimensions consistently
   */
  measureElement(element: Element, availableWidth: number): Size {
    let size: Size;

    // Always use intrinsicSize if available - this is the authoritative measurement
    if (isRenderable(element)) {
      const context: IntrinsicSizeContext = {
        availableSpace: { width: availableWidth, height: Infinity }
      };
      size = element.intrinsicSize(context);
    } else {
      // Fallback for legacy elements without intrinsicSize
      size = this._estimateElementSize(element, availableWidth);
    }

    // For containers, intrinsicSize returns content-only dimensions.
    // Add padding and border to get the outer box size.
    if (element.type === 'container') {
      const style = element.props?.style || {};
      const padding = this._getPaddingValues(style.padding);
      const border = style.border ? 1 : 0; // thin border = 1
      size = {
        width: size.width + (padding.left || 0) + (padding.right || 0) + border * 2,
        height: size.height + (padding.top || 0) + (padding.bottom || 0) + border * 2,
      };
    }

    return size;
  }

  /**
   * Parse padding value into BoxSpacing
   */
  private _getPaddingValues(padding: any): BoxSpacing {
    if (padding === undefined || padding === null) {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }
    if (typeof padding === 'number') {
      return { top: padding, right: padding, bottom: padding, left: padding };
    }
    if (typeof padding === 'object') {
      return {
        top: this._parseNumberValue(padding.top) || 0,
        right: this._parseNumberValue(padding.right) || 0,
        bottom: this._parseNumberValue(padding.bottom) || 0,
        left: this._parseNumberValue(padding.left) || 0,
      };
    }
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  /**
   * Get margin values for an element
   */
  private _getChildMargin(element: Element): BoxSpacing {
    const style = (element.props && element.props.style) || {};
    const margin = style.margin || style.marginBottom || 0;

    if (typeof margin === 'number') {
      return { top: margin, right: margin, bottom: margin, left: margin };
    }

    if (typeof margin === 'object') {
      return {
        top: this._parseNumberValue(margin.top) || 0,
        right: this._parseNumberValue(margin.right) || 0,
        bottom: this._parseNumberValue(margin.bottom) || 0,
        left: this._parseNumberValue(margin.left) || 0
      };
    }

    // Handle specific margin properties
    return {
      top: this._parseNumberValue(style.marginTop) || 0,
      right: this._parseNumberValue(style.marginRight) || 0,
      bottom: this._parseNumberValue(style.marginBottom) || 0,
      left: this._parseNumberValue(style.marginLeft) || 0
    };
  }

  /**
   * Fast path measurement for scrollable containers with many children
   * Uses sampling to estimate total height instead of measuring all children
   */
  private _measureContainerFastPath(container: Element, availableWidth: number): Size {
    const children = container.children!;
    const childCount = children.length;

    // Get gap from container style
    const containerStyle = container.props?.style || {};
    const gap = this._parseNumberValue(containerStyle.gap) || 0;

    // Sample first few children to estimate row height
    const sampleSize = Math.min(10, childCount);
    let totalSampleHeight = 0;
    let maxWidth = 0;

    for (let i = 0; i < sampleSize; i++) {
      const child = children[i];
      const childSize = this.measureElement(child, availableWidth);
      const childMargin = this._getChildMargin(child);

      totalSampleHeight += childSize.height + (childMargin.top || 0) + (childMargin.bottom || 0);
      maxWidth = Math.max(maxWidth, childSize.width + (childMargin.left || 0) + (childMargin.right || 0));
    }

    // Estimate total height: average row height * count + gaps between rows
    // Gap is added separately, not baked into the average, to avoid systematic underestimation
    const avgRowHeight = totalSampleHeight / sampleSize;
    const totalGaps = (childCount - 1) * gap;
    const estimatedTotalHeight = Math.ceil(avgRowHeight * childCount + totalGaps);

    return { width: maxWidth, height: estimatedTotalHeight };
  }

  /**
   * Parse a value that might be a string or number into a number
   */
  private _parseNumberValue(value: any): number {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  /**
   * Fallback size estimation for elements without intrinsicSize
   */
  private _estimateElementSize(element: Element, availableWidth: number): Size {
    switch (element.type) {
      case 'text':
        return this._estimateTextSize(element, availableWidth);

      case 'input':
        return this._estimateInputSize(element);

      case 'button':
        return this._estimateButtonSize(element);

      case 'container': {
        // For containers, recursively measure children and add padding/border
        const contentSize = this.measureContainer(element, availableWidth);
        const style = element.props?.style || {};
        const padding = this._parseNumberValue(style.padding) || 0;
        const border = style.border ? 1 : 0; // thin border = 1
        const extraSpace = (padding + border) * 2;
        return {
          width: contentSize.width + extraSpace,
          height: contentSize.height + extraSpace,
        };
      }

      default:
        // Conservative fallback for unknown element types
        return { width: 10, height: 1 };
    }
  }

  private _estimateTextSize(element: Element, availableWidth: number): Size {
    const props = element.props as any;
    const text = props.text || props.content || '';

    if (!text) {
      return { width: 0, height: 0 };
    }

    if (props.wrap === false) {
      // No wrapping - single line
      return { width: text.length, height: 1 };
    }

    // Estimate wrapped text dimensions
    const lines = Math.ceil(text.length / Math.max(1, availableWidth));
    return {
      width: Math.min(text.length, availableWidth),
      height: Math.max(1, lines)
    };
  }

  private _estimateInputSize(element: Element): Size {
    const props = element.props as any;
    const value = props.value || '';
    const placeholder = props.placeholder || '';
    const displayLength = Math.max(value.length, placeholder.length, 10); // Min 10 chars

    return { width: displayLength, height: 1 };
  }

  private _estimateButtonSize(element: Element): Size {
    const props = element.props as any;
    const title = props.title || props.label || '';

    // Button needs padding around text
    return { width: title.length + 4, height: 3 };
  }
}

// Export a global instance for convenient usage
export const globalContentMeasurer = new ContentMeasurer();