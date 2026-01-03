// Unified Viewport System for Layout and Clipping
import { Bounds, Element, Size, isScrollableType } from './types.ts';
import { clipBounds } from './geometry.ts';

export interface ScrollbarLayout {
  bounds: Bounds;
  trackLength: number;
  thumbPosition: number;
  thumbSize: number;
  visible: boolean;
}

/**
 * Unified viewport concept that replaces fragmented clipping logic
 */
export interface Viewport {
  // Physical bounds within the terminal
  bounds: Bounds;

  // Clipping rectangle (subset of bounds)
  clipRect: Bounds;

  // Current scroll offset
  scrollOffset: { x: number; y: number };

  // Total content dimensions (calculated, not estimated)
  contentSize: Size;

  // Scrollbar layout information
  scrollbars: {
    vertical?: ScrollbarLayout;
    horizontal?: ScrollbarLayout;
  };
}

export interface ViewportCreateOptions {
  element: Element;
  parentViewport?: Viewport;
  contentSize?: Size;
  scrollable?: boolean;
}

/**
 * ViewportManager provides immutable viewport operations
 * eliminating the need for complex coordinate translations
 */
export class ViewportManager {

  /**
   * Create a new viewport for an element
   */
  createViewport(options: ViewportCreateOptions): Viewport {
    const { element, parentViewport, contentSize, scrollable = false } = options;

    // Start with element's natural bounds
    const bounds: Bounds = this._calculateElementBounds(element, parentViewport);

    // Initialize clipping to the full bounds
    let clipRect = { ...bounds };

    // If we have a parent viewport, clip to it
    if (parentViewport) {
      clipRect = clipBounds(clipRect, parentViewport.clipRect);
    }

    // Get current scroll offset from element props
    const scrollOffset = {
      x: (element.props.scrollX as number) || 0,
      y: (element.props.scrollY as number) || 0
    };

    // Calculate content size (use provided or default)
    const actualContentSize = contentSize || { width: bounds.width, height: bounds.height };

    // Create viewport
    const viewport: Viewport = {
      bounds,
      clipRect,
      scrollOffset,
      contentSize: actualContentSize,
      scrollbars: {}
    };

    // Calculate scrollbars if this is scrollable
    if (scrollable && isScrollableType(element.type) && element.props.scrollable) {
      viewport.scrollbars = this._calculateScrollbars(bounds, actualContentSize, scrollOffset);

      // Adjust clip rect to account for scrollbars
      viewport.clipRect = this._adjustClipRectForScrollbars(viewport.clipRect, viewport.scrollbars);
    }

    return viewport;
  }

  /**
   * Update scroll offset immutably
   */
  updateScrollOffset(viewport: Viewport, deltaX: number, deltaY: number): Viewport {
    const newScrollOffset = {
      x: viewport.scrollOffset.x + deltaX,
      y: viewport.scrollOffset.y + deltaY
    };

    // Clamp to valid ranges
    const clampedScrollOffset = this.clampScrollOffset({ ...viewport, scrollOffset: newScrollOffset });

    return {
      ...viewport,
      scrollOffset: clampedScrollOffset.scrollOffset,
      scrollbars: this._calculateScrollbars(viewport.bounds, viewport.contentSize, clampedScrollOffset.scrollOffset)
    };
  }

  /**
   * Clamp scroll offset to valid ranges
   */
  clampScrollOffset(viewport: Viewport): Viewport {
    const maxScrollX = Math.max(0, viewport.contentSize.width - viewport.clipRect.width);
    const maxScrollY = Math.max(0, viewport.contentSize.height - viewport.clipRect.height);

    const clampedScrollOffset = {
      x: Math.max(0, Math.min(maxScrollX, viewport.scrollOffset.x)),
      y: Math.max(0, Math.min(maxScrollY, viewport.scrollOffset.y))
    };

    return {
      ...viewport,
      scrollOffset: clampedScrollOffset
    };
  }

  /**
   * Calculate element bounds within parent viewport
   */
  private _calculateElementBounds(element: Element, parentViewport?: Viewport): Bounds {
    // For now, use simple bounds - this will be enhanced with proper layout integration
    if (parentViewport) {
      return {
        x: parentViewport.bounds.x,
        y: parentViewport.bounds.y,
        width: parentViewport.bounds.width,
        height: parentViewport.bounds.height
      };
    }

    // Default bounds for root elements
    return {
      x: 0,
      y: 0,
      width: (element.props.width as number) || 80,
      height: (element.props.height as number) || 24
    };
  }

  /**
   * Calculate scrollbar layouts
   */
  private _calculateScrollbars(
    containerBounds: Bounds,
    contentSize: Size,
    scrollOffset: { x: number; y: number }
  ): { vertical?: ScrollbarLayout; horizontal?: ScrollbarLayout } {
    const result: { vertical?: ScrollbarLayout; horizontal?: ScrollbarLayout } = {};

    const needsVertical = contentSize.height > containerBounds.height;
    const needsHorizontal = contentSize.width > containerBounds.width;

    if (needsVertical) {
      result.vertical = this._calculateVerticalScrollbar(containerBounds, contentSize.height, scrollOffset.y);
    }

    if (needsHorizontal) {
      result.horizontal = this._calculateHorizontalScrollbar(containerBounds, contentSize.width, scrollOffset.x);
    }

    return result;
  }

  private _calculateVerticalScrollbar(containerBounds: Bounds, contentHeight: number, scrollY: number): ScrollbarLayout {
    const trackLength = containerBounds.height;
    const viewportRatio = containerBounds.height / contentHeight;
    const thumbSize = Math.max(1, Math.min(trackLength, Math.floor(viewportRatio * trackLength)));

    const maxScrollY = Math.max(0, contentHeight - containerBounds.height);
    const scrollProgress = maxScrollY > 0 ? (scrollY / maxScrollY) : 0;
    const availableTrackSpace = Math.max(1, trackLength - thumbSize);
    const thumbPosition = Math.min(availableTrackSpace, Math.floor(scrollProgress * availableTrackSpace));

    return {
      bounds: {
        x: containerBounds.x + containerBounds.width - 1,
        y: containerBounds.y,
        width: 1,
        height: trackLength
      },
      trackLength,
      thumbPosition,
      thumbSize,
      visible: true
    };
  }

  private _calculateHorizontalScrollbar(containerBounds: Bounds, contentWidth: number, scrollX: number): ScrollbarLayout {
    const trackLength = containerBounds.width;
    const viewportRatio = containerBounds.width / contentWidth;
    const thumbSize = Math.max(1, Math.min(trackLength, Math.floor(viewportRatio * trackLength)));

    const maxScrollX = Math.max(0, contentWidth - containerBounds.width);
    const scrollProgress = maxScrollX > 0 ? (scrollX / maxScrollX) : 0;
    const availableTrackSpace = Math.max(1, trackLength - thumbSize);
    const thumbPosition = Math.min(availableTrackSpace, Math.floor(scrollProgress * availableTrackSpace));

    return {
      bounds: {
        x: containerBounds.x,
        y: containerBounds.y + containerBounds.height - 1,
        width: trackLength,
        height: 1
      },
      trackLength,
      thumbPosition,
      thumbSize,
      visible: true
    };
  }

  /**
   * Adjust clip rect to reserve space for scrollbars
   */
  private _adjustClipRectForScrollbars(
    clipRect: Bounds,
    scrollbars: { vertical?: ScrollbarLayout; horizontal?: ScrollbarLayout }
  ): Bounds {
    const adjustedRect = { ...clipRect };

    if (scrollbars.vertical) {
      adjustedRect.width = Math.max(1, adjustedRect.width - 1);
    }

    if (scrollbars.horizontal) {
      adjustedRect.height = Math.max(1, adjustedRect.height - 1);
    }

    return adjustedRect;
  }
}

/**
 * Coordinate transformation utilities
 */
export class CoordinateTransform {
  constructor(private _viewport: Viewport) {}

  transformPoint(point: { x: number; y: number }): { x: number; y: number } {
    return {
      x: point.x - this._viewport.scrollOffset.x,
      y: point.y - this._viewport.scrollOffset.y
    };
  }

  transformBounds(bounds: Bounds): Bounds {
    const topLeft = this.transformPoint({ x: bounds.x, y: bounds.y });
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bounds.width,
      height: bounds.height
    };
  }

  isVisible(bounds: Bounds): boolean {
    const transformed = this.transformBounds(bounds);
    const clip = this._viewport.clipRect;

    return !(transformed.x + transformed.width <= clip.x ||
             transformed.y + transformed.height <= clip.y ||
             transformed.x >= clip.x + clip.width ||
             transformed.y >= clip.y + clip.height);
  }

  /**
   * Check if a point is visible within the viewport
   */
  isPointVisible(x: number, y: number): boolean {
    const transformed = this.transformPoint({ x, y });
    const clip = this._viewport.clipRect;

    return transformed.x >= clip.x && transformed.x < clip.x + clip.width &&
           transformed.y >= clip.y && transformed.y < clip.y + clip.height;
  }
}

// Export global instance for convenient usage
export const globalViewportManager = new ViewportManager();