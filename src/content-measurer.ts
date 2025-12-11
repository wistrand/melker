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

    let totalHeight = 0;
    let maxWidth = 0;
    const childMeasurements: Array<{ element: Element; size: Size; margin: any }> = [];

    for (const child of container.children) {
      const childSize = this.measureElement(child, availableWidth);
      const childMargin = this._getChildMargin(child);

      totalHeight += childSize.height + (childMargin.top || 0) + (childMargin.bottom || 0);
      maxWidth = Math.max(maxWidth, childSize.width + (childMargin.left || 0) + (childMargin.right || 0));

      childMeasurements.push({ element: child, size: childSize, margin: childMargin });
    }

    // Debug: Uncomment to debug content measurement issues
    // if (container.props?.scrollable && container.props?.id) {
    //   console.log(`[ContentMeasurer] Container ${container.props.id}: total content size`, {
    //     containerId: container.props.id,
    //     childCount: container.children.length,
    //     availableWidth,
    //     calculatedSize: { width: maxWidth, height: totalHeight },
    //     childMeasurements: childMeasurements.map(m => ({
    //       type: m.element.type,
    //       id: m.element.props?.id || 'none',
    //       size: m.size,
    //       margin: m.margin
    //     }))
    //   });
    // }

    return { width: maxWidth, height: totalHeight };
  }

  /**
   * Measure a single element's dimensions consistently
   */
  measureElement(element: Element, availableWidth: number): Size {
    // Always use intrinsicSize if available - this is the authoritative measurement
    if (isRenderable(element)) {
      const context: IntrinsicSizeContext = {
        availableSpace: { width: availableWidth, height: Infinity }
      };
      return element.intrinsicSize(context);
    }

    // Fallback for legacy elements without intrinsicSize
    return this._estimateElementSize(element, availableWidth);
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

      case 'container':
        // For containers, recursively measure children
        return this.measureContainer(element, availableWidth);

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