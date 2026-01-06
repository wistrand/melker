// Border-Box Sizing Model implementation
// Provides consistent and predictable element sizing calculations

import { Style, BoxSpacing, Bounds, Size } from './types.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('SizingModel');

export interface BoxModel {
  content: Size;
  padding: BoxDimensions;
  border: BoxDimensions;
  margin: BoxDimensions;
  total: Size;
}

export interface BoxDimensions {
  top: number;
  right: number;
  bottom: number;
  left: number;
  horizontal: number; // left + right
  vertical: number;   // top + bottom
}

// Tracks which chrome (padding/border) was collapsed due to insufficient space
export interface ChromeCollapseState {
  paddingCollapsed: BoxDimensions;  // Amount reduced per side
  borderCollapsed: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  };
}

// Return type for calculateContentBounds with optional collapse info
export interface ContentBoundsResult {
  bounds: Bounds;
  chromeCollapse?: ChromeCollapseState;
}

export class SizingModel {
  private _defaultBoxSizing: 'content-box' | 'border-box' = 'border-box';

  constructor(defaultBoxSizing: 'content-box' | 'border-box' = 'border-box') {
    this._defaultBoxSizing = defaultBoxSizing;
  }

  // Calculate complete box model for an element
  calculateBoxModel(
    requestedSize: Size,
    style: Style,
    availableSpace?: Size
  ): BoxModel {
    const boxSizing = style.boxSizing || this._defaultBoxSizing;

    // Calculate dimensions
    const padding = this._calculateBoxDimensions(style.padding || 0);
    const border = this._calculateBorderDimensions(style);
    const margin = this._calculateBoxDimensions(style.margin || 0);

    let content: Size;
    let total: Size;

    if (boxSizing === 'border-box') {
      // Border-box: width/height includes padding and border
      content = this._calculateContentSizeFromBorderBox(
        requestedSize,
        padding,
        border
      );
      total = {
        width: requestedSize.width + margin.horizontal,
        height: requestedSize.height + margin.vertical,
      };
    } else {
      // Content-box: width/height is pure content size
      content = requestedSize;
      total = {
        width: content.width + padding.horizontal + border.horizontal + margin.horizontal,
        height: content.height + padding.vertical + border.vertical + margin.vertical,
      };
    }

    // Ensure non-negative dimensions
    content.width = Math.max(0, content.width);
    content.height = Math.max(0, content.height);
    total.width = Math.max(0, total.width);
    total.height = Math.max(0, total.height);

    return {
      content,
      padding,
      border,
      margin,
      total,
    };
  }

  // Calculate content bounds within an element's total bounds
  // elementBounds represents the element's box (NOT including margin - margin is outside)
  // Returns ContentBoundsResult with bounds and optional chromeCollapse info
  calculateContentBounds(elementBounds: Bounds, style: Style, isScrollable?: boolean): ContentBoundsResult {
    // Note: Margin is OUTSIDE the element bounds, so it should NOT be subtracted from content bounds
    const border = this._calculateBorderDimensions(style);
    const originalPadding = this._calculateBoxDimensions(style.padding || 0);

    let padding = { ...originalPadding };
    let effectiveBorder = { ...border };
    let chromeCollapse: ChromeCollapseState | undefined;

    const MIN_CONTENT = 1;  // Minimum 1 character for content

    // Check horizontal space - do we need to collapse?
    const neededH = border.horizontal + padding.horizontal + MIN_CONTENT;
    if (elementBounds.width < neededH) {
      chromeCollapse = this._initCollapseState();
      const excess = neededH - elementBounds.width;

      // Phase 1: Collapse padding first (proportionally per side)
      const padReduction = Math.min(padding.horizontal, excess);
      if (padReduction > 0) {
        const leftRed = padding.horizontal > 0
          ? Math.ceil(padReduction * (padding.left / padding.horizontal))
          : 0;
        const rightRed = padReduction - leftRed;
        chromeCollapse.paddingCollapsed.left = leftRed;
        chromeCollapse.paddingCollapsed.right = rightRed;
        chromeCollapse.paddingCollapsed.horizontal = padReduction;
        padding.left = Math.max(0, padding.left - leftRed);
        padding.right = Math.max(0, padding.right - rightRed);
        padding.horizontal = padding.left + padding.right;
      }

      // Phase 2: Collapse border if still not enough space
      const remaining = excess - padReduction;
      if (remaining > 0 && effectiveBorder.horizontal > 0) {
        if (remaining >= 1 && effectiveBorder.left > 0) {
          chromeCollapse.borderCollapsed.left = true;
          effectiveBorder.left = 0;
          effectiveBorder.horizontal--;
        }
        if (remaining >= 2 && effectiveBorder.right > 0) {
          chromeCollapse.borderCollapsed.right = true;
          effectiveBorder.right = 0;
          effectiveBorder.horizontal--;
        }
      }
    }

    // Check vertical space - do we need to collapse?
    const neededV = effectiveBorder.vertical + padding.vertical + MIN_CONTENT;
    if (elementBounds.height < neededV) {
      chromeCollapse = chromeCollapse || this._initCollapseState();
      const excess = neededV - elementBounds.height;

      // Phase 1: Collapse padding first (proportionally per side)
      const padReduction = Math.min(padding.vertical, excess);
      if (padReduction > 0) {
        const topRed = padding.vertical > 0
          ? Math.ceil(padReduction * (padding.top / padding.vertical))
          : 0;
        const bottomRed = padReduction - topRed;
        chromeCollapse.paddingCollapsed.top = topRed;
        chromeCollapse.paddingCollapsed.bottom = bottomRed;
        chromeCollapse.paddingCollapsed.vertical = padReduction;
        padding.top = Math.max(0, padding.top - topRed);
        padding.bottom = Math.max(0, padding.bottom - bottomRed);
        padding.vertical = padding.top + padding.bottom;
      }

      // Phase 2: Collapse border if still not enough space
      const remaining = excess - padReduction;
      if (remaining > 0 && effectiveBorder.vertical > 0) {
        if (remaining >= 1 && effectiveBorder.top > 0) {
          chromeCollapse.borderCollapsed.top = true;
          effectiveBorder.top = 0;
          effectiveBorder.vertical--;
        }
        if (remaining >= 2 && effectiveBorder.bottom > 0) {
          chromeCollapse.borderCollapsed.bottom = true;
          effectiveBorder.bottom = 0;
          effectiveBorder.vertical--;
        }
      }
    }

    // Legacy scrollable container handling (keep for aggressive reduction in tiny scrollables)
    if (isScrollable && !chromeCollapse) {
      const availableHeight = elementBounds.height - effectiveBorder.vertical;
      if (availableHeight <= 2) {
        padding = {
          top: 0,
          right: Math.min(padding.right, 1),
          bottom: 0,
          left: Math.min(padding.left, 1),
          horizontal: Math.min(padding.horizontal, 2),
          vertical: 0
        };
      } else if (availableHeight <= 4) {
        padding = {
          ...padding,
          top: Math.min(padding.top, 1),
          bottom: Math.min(padding.bottom, 1),
          vertical: Math.min(padding.vertical, 2)
        };
      }
    }

    // Log collapse if it occurred
    if (chromeCollapse && (chromeCollapse.paddingCollapsed?.horizontal > 0 || chromeCollapse.paddingCollapsed?.vertical > 0 ||
      chromeCollapse.borderCollapsed?.left || chromeCollapse.borderCollapsed?.right ||
      chromeCollapse.borderCollapsed?.top || chromeCollapse.borderCollapsed?.bottom
    )) {
      logger.debug(`Chrome collapsed: bounds=${elementBounds.width}x${elementBounds.height}, ` +
        `padding reduced by ${chromeCollapse.paddingCollapsed.horizontal}h/${chromeCollapse.paddingCollapsed.vertical}v, ` +
        `border collapsed: L=${chromeCollapse.borderCollapsed.left} R=${chromeCollapse.borderCollapsed.right} ` +
        `T=${chromeCollapse.borderCollapsed.top} B=${chromeCollapse.borderCollapsed.bottom}`);
    }

    // Calculate final content dimensions
    const rawWidth = elementBounds.width - effectiveBorder.horizontal - padding.horizontal;
    const rawHeight = elementBounds.height - effectiveBorder.vertical - padding.vertical;

    return {
      bounds: {
        x: elementBounds.x + effectiveBorder.left + padding.left,
        y: elementBounds.y + effectiveBorder.top + padding.top,
        width: Math.max(MIN_CONTENT, rawWidth),
        height: Math.max(MIN_CONTENT, rawHeight),
      },
      chromeCollapse,
    };
  }

  // Initialize an empty chrome collapse state
  private _initCollapseState(): ChromeCollapseState {
    return {
      paddingCollapsed: { top: 0, right: 0, bottom: 0, left: 0, horizontal: 0, vertical: 0 },
      borderCollapsed: { top: false, right: false, bottom: false, left: false },
    };
  }

  // Calculate element bounds for a given content size and style
  calculateElementBounds(
    contentSize: Size,
    style: Style,
    position: { x: number; y: number }
  ): Bounds {
    const boxModel = this.calculateBoxModel(contentSize, style);

    return {
      x: position.x,
      y: position.y,
      width: boxModel.total.width,
      height: boxModel.total.height,
    };
  }

  // Calculate the size needed to fit specific content
  calculateRequiredSize(
    contentSize: Size,
    style: Style
  ): Size {
    const padding = this._calculateBoxDimensions(style.padding || 0);
    const border = this._calculateBorderDimensions(style);
    const margin = this._calculateBoxDimensions(style.margin || 0);

    const boxSizing = style.boxSizing || this._defaultBoxSizing;

    if (boxSizing === 'border-box') {
      const result = {
        width: contentSize.width + padding.horizontal + border.horizontal,
        height: contentSize.height + padding.vertical + border.vertical,
      };


      return result;
    } else {
      return contentSize;
    }
  }

  // Get inner bounds (excluding margin but including border/padding)
  calculateInnerBounds(elementBounds: Bounds, style: Style): Bounds {
    const margin = this._calculateBoxDimensions(style.margin || 0);

    return {
      x: elementBounds.x + margin.left,
      y: elementBounds.y + margin.top,
      width: elementBounds.width - margin.horizontal,
      height: elementBounds.height - margin.vertical,
    };
  }

  // Get border bounds (excluding margin and padding)
  calculateBorderBounds(elementBounds: Bounds, style: Style): Bounds {
    const margin = this._calculateBoxDimensions(style.margin || 0);
    const padding = this._calculateBoxDimensions(style.padding || 0);

    return {
      x: elementBounds.x + margin.left + padding.left,
      y: elementBounds.y + margin.top + padding.top,
      width: elementBounds.width - margin.horizontal - padding.horizontal,
      height: elementBounds.height - margin.vertical - padding.vertical,
    };
  }

  // Calculate minimum size required for an element
  calculateMinSize(style: Style): Size {
    const padding = this._calculateBoxDimensions(style.padding || 0);
    const border = this._calculateBorderDimensions(style);
    const margin = this._calculateBoxDimensions(style.margin || 0);

    return {
      width: padding.horizontal + border.horizontal + margin.horizontal,
      height: padding.vertical + border.vertical + margin.vertical,
    };
  }

  // Constrain size within bounds while respecting box model
  constrainSize(
    requestedSize: Size,
    style: Style,
    minSize?: Size,
    maxSize?: Size
  ): Size {
    const boxModel = this.calculateBoxModel(requestedSize, style);

    let constrainedWidth = requestedSize.width;
    let constrainedHeight = requestedSize.height;

    // Apply minimum constraints
    if (minSize) {
      constrainedWidth = Math.max(constrainedWidth, minSize.width);
      constrainedHeight = Math.max(constrainedHeight, minSize.height);
    }

    // Apply maximum constraints
    if (maxSize) {
      constrainedWidth = Math.min(constrainedWidth, maxSize.width);
      constrainedHeight = Math.min(constrainedHeight, maxSize.height);
    }

    return {
      width: constrainedWidth,
      height: constrainedHeight,
    };
  }

  // Private helper methods

  private _calculateBoxDimensions(spacing: number | BoxSpacing): BoxDimensions {
    if (typeof spacing === 'number') {
      return {
        top: spacing,
        right: spacing,
        bottom: spacing,
        left: spacing,
        horizontal: spacing * 2,
        vertical: spacing * 2,
      };
    }

    const top = spacing.top || 0;
    const right = spacing.right || 0;
    const bottom = spacing.bottom || 0;
    const left = spacing.left || 0;

    return {
      top,
      right,
      bottom,
      left,
      horizontal: left + right,
      vertical: top + bottom,
    };
  }

  private _calculateBorderDimensions(style: Style): BoxDimensions {
    // Check individual border sides first, fallback to general border
    const borderTop = style.borderTop || (style.border && style.border !== 'none' ? style.border : undefined);
    const borderRight = style.borderRight || (style.border && style.border !== 'none' ? style.border : undefined);
    const borderBottom = style.borderBottom || (style.border && style.border !== 'none' ? style.border : undefined);
    const borderLeft = style.borderLeft || (style.border && style.border !== 'none' ? style.border : undefined);

    const topWidth = borderTop && borderTop !== 'none' ? 1 : 0;
    const rightWidth = borderRight && borderRight !== 'none' ? 1 : 0;
    const bottomWidth = borderBottom && borderBottom !== 'none' ? 1 : 0;
    const leftWidth = borderLeft && borderLeft !== 'none' ? 1 : 0;

    return {
      top: topWidth,
      right: rightWidth,
      bottom: bottomWidth,
      left: leftWidth,
      horizontal: leftWidth + rightWidth,
      vertical: topWidth + bottomWidth,
    };
  }

  private _calculateContentSizeFromBorderBox(
    borderBoxSize: Size,
    padding: BoxDimensions,
    border: BoxDimensions
  ): Size {
    return {
      width: borderBoxSize.width - padding.horizontal - border.horizontal,
      height: borderBoxSize.height - padding.vertical - border.vertical,
    };
  }
}

// Global sizing model instance
export const globalSizingModel = new SizingModel('border-box');

// Utility functions for working with spacing values

/**
 * Normalize a spacing value (number or BoxSpacing) to a full BoxSpacing object
 */
export function normalizeSpacing(spacing: number | BoxSpacing | undefined): BoxSpacing {
  if (spacing === undefined) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (typeof spacing === 'number') {
    return { top: spacing, right: spacing, bottom: spacing, left: spacing };
  }
  return {
    top: spacing.top || 0,
    right: spacing.right || 0,
    bottom: spacing.bottom || 0,
    left: spacing.left || 0,
  };
}

/**
 * Add two BoxSpacing objects together
 */
export function addSpacing(a: BoxSpacing, b: BoxSpacing): BoxSpacing {
  return {
    top: (a.top || 0) + (b.top || 0),
    right: (a.right || 0) + (b.right || 0),
    bottom: (a.bottom || 0) + (b.bottom || 0),
    left: (a.left || 0) + (b.left || 0),
  };
}

/**
 * Convert a BoxSpacing to a CSS-like string representation
 * Returns "5" for uniform, "5 10" for vertical/horizontal, or "1 2 3 4" for all different
 */
export function spacingToString(spacing: BoxSpacing): string {
  const top = spacing.top || 0;
  const right = spacing.right || 0;
  const bottom = spacing.bottom || 0;
  const left = spacing.left || 0;

  if (top === right && right === bottom && bottom === left) {
    return String(top);
  }
  if (top === bottom && left === right) {
    return `${top} ${right}`;
  }
  return `${top} ${right} ${bottom} ${left}`;
}