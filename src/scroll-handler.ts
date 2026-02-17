// Scroll handling for scrollable containers
// Handles scrollbar interaction, wheel events, and arrow key scrolling

import { Element, isScrollableType, isScrollingEnabled, getOverflowAxis } from './types.ts';
import { Document } from './document.ts';
import { RenderingEngine, ScrollbarBounds } from './rendering.ts';
import { pointInBounds, clamp } from './geometry.ts';
import { collectElements, isDescendant, isOpenDialog } from './utils/tree-traversal.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('ScrollHandler');

export interface ScrollbarDragState {
  active: boolean;
  elementId: string;
  axis: 'vertical' | 'horizontal';
  startMousePos: number;
  startScrollPos: number;
  trackStart: number;
  trackLength: number;
  thumbSize: number;
  contentLength: number;
  viewportLength: number;
}

export interface ScrollbarHitInfo {
  elementId: string;
  axis: 'vertical' | 'horizontal';
  onThumb: boolean;
  bounds: ScrollbarBounds;
}

export interface ScrollHandlerContext {
  document: Document;
  renderer: RenderingEngine;
  autoRender: boolean;
  onRender: () => void;
  onRenderDialogOnly?: () => void;
  calculateScrollDimensions: (containerOrId: Element | string) => { width: number; height: number } | null;
}

/**
 * Handles all scrolling-related functionality including scrollbar interaction,
 * mouse wheel events, and keyboard navigation.
 */
export class ScrollHandler {
  private _document: Document;
  private _renderer: RenderingEngine;
  private _autoRender: boolean;
  private _onRender: () => void;
  private _onRenderDialogOnly?: () => void;
  private _calculateScrollDimensions: (containerOrId: Element | string) => { width: number; height: number } | null;
  private _scrollbarDrag: ScrollbarDragState | null = null;

  constructor(context: ScrollHandlerContext) {
    this._document = context.document;
    this._renderer = context.renderer;
    this._autoRender = context.autoRender;
    this._onRender = context.onRender;
    this._onRenderDialogOnly = context.onRenderDialogOnly;
    this._calculateScrollDimensions = context.calculateScrollDimensions;
  }

  /**
   * Check if an element is inside a dialog by searching from root
   */
  private _isInsideDialog(element: Element): boolean {
    const dialogs = collectElements(this._document.root, isOpenDialog);
    for (const dialog of dialogs) {
      if (isDescendant(element, dialog)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Update context settings
   */
  updateContext(context: Partial<ScrollHandlerContext>): void {
    if (context.document) this._document = context.document;
    if (context.renderer) this._renderer = context.renderer;
    if (context.autoRender !== undefined) this._autoRender = context.autoRender;
    if (context.onRender) this._onRender = context.onRender;
    if (context.calculateScrollDimensions) this._calculateScrollDimensions = context.calculateScrollDimensions;
  }

  /**
   * Check if a scrollbar drag is currently active
   */
  isScrollbarDragActive(): boolean {
    return this._scrollbarDrag?.active ?? false;
  }

  /**
   * End the current scrollbar drag
   */
  endScrollbarDrag(): void {
    this._scrollbarDrag = null;
  }

  /**
   * Detect if a click is on a scrollbar track or thumb
   * Returns scrollbar hit info or null if not on a scrollbar
   */
  detectScrollbarClick(x: number, y: number): ScrollbarHitInfo | null {
    const allScrollbarBounds = this._renderer.getAllScrollbarBounds();

    for (const [elementId, bounds] of allScrollbarBounds) {
      // Check vertical scrollbar
      if (bounds.vertical) {
        const track = bounds.vertical.track;
        if (x >= track.x && x < track.x + track.width &&
            y >= track.y && y < track.y + track.height) {
          const thumb = bounds.vertical.thumb;
          const onThumb = y >= thumb.y && y < thumb.y + thumb.height;
          return { elementId, axis: 'vertical', onThumb, bounds };
        }
      }

      // Check horizontal scrollbar
      if (bounds.horizontal) {
        const track = bounds.horizontal.track;
        if (x >= track.x && x < track.x + track.width &&
            y >= track.y && y < track.y + track.height) {
          const thumb = bounds.horizontal.thumb;
          const onThumb = x >= thumb.x && x < thumb.x + thumb.width;
          return { elementId, axis: 'horizontal', onThumb, bounds };
        }
      }
    }

    return null;
  }

  /**
   * Handle scrollbar click - either start drag from thumb or click-to-position on track
   */
  handleScrollbarClick(
    hit: ScrollbarHitInfo,
    mouseX: number,
    mouseY: number
  ): void {
    const element = this._document.getElementById(hit.elementId);
    if (!element) return;

    if (hit.axis === 'vertical' && hit.bounds.vertical) {
      const { track, thumb, contentHeight, viewportHeight } = hit.bounds.vertical;
      const maxScroll = Math.max(0, contentHeight - viewportHeight);
      const thumbSize = thumb.height;

      if (hit.onThumb) {
        // Start drag from current position
        this._scrollbarDrag = {
          active: true,
          elementId: hit.elementId,
          axis: 'vertical',
          startMousePos: mouseY,
          startScrollPos: (element.props.scrollY as number) || 0,
          trackStart: track.y,
          trackLength: track.height,
          thumbSize,
          contentLength: contentHeight,
          viewportLength: viewportHeight,
        };
      } else {
        // Click-to-position: jump to clicked position and start drag
        const trackLength = track.height;
        const availableTrackSpace = Math.max(1, trackLength - thumbSize);
        const clickPosInTrack = mouseY - track.y;

        // Center the thumb on the click position
        const targetThumbStart = clamp(clickPosInTrack - thumbSize / 2, 0, availableTrackSpace);
        const scrollProgress = availableTrackSpace > 0 ? targetThumbStart / availableTrackSpace : 0;
        const newScrollY = Math.round(scrollProgress * maxScroll);

        element.props.scrollY = newScrollY;

        // Start drag from new position
        this._scrollbarDrag = {
          active: true,
          elementId: hit.elementId,
          axis: 'vertical',
          startMousePos: mouseY,
          startScrollPos: newScrollY,
          trackStart: track.y,
          trackLength: trackLength,
          thumbSize,
          contentLength: contentHeight,
          viewportLength: viewportHeight,
        };

        if (this._autoRender) {
          this._onRender();
        }
      }
    } else if (hit.axis === 'horizontal' && hit.bounds.horizontal) {
      const { track, thumb, contentWidth, viewportWidth } = hit.bounds.horizontal;
      const maxScroll = Math.max(0, contentWidth - viewportWidth);
      const thumbSize = thumb.width;

      if (hit.onThumb) {
        // Start drag from current position
        this._scrollbarDrag = {
          active: true,
          elementId: hit.elementId,
          axis: 'horizontal',
          startMousePos: mouseX,
          startScrollPos: (element.props.scrollX as number) || 0,
          trackStart: track.x,
          trackLength: track.width,
          thumbSize,
          contentLength: contentWidth,
          viewportLength: viewportWidth,
        };
      } else {
        // Click-to-position: jump to clicked position and start drag
        const trackLength = track.width;
        const availableTrackSpace = Math.max(1, trackLength - thumbSize);
        const clickPosInTrack = mouseX - track.x;

        // Center the thumb on the click position
        const targetThumbStart = clamp(clickPosInTrack - thumbSize / 2, 0, availableTrackSpace);
        const scrollProgress = availableTrackSpace > 0 ? targetThumbStart / availableTrackSpace : 0;
        const newScrollX = Math.round(scrollProgress * maxScroll);

        element.props.scrollX = newScrollX;

        // Start drag from new position
        this._scrollbarDrag = {
          active: true,
          elementId: hit.elementId,
          axis: 'horizontal',
          startMousePos: mouseX,
          startScrollPos: newScrollX,
          trackStart: track.x,
          trackLength: trackLength,
          thumbSize,
          contentLength: contentWidth,
          viewportLength: viewportWidth,
        };

        if (this._autoRender) {
          this._onRender();
        }
      }
    }
  }

  /**
   * Handle scrollbar drag during mouse move
   * Returns true if drag was handled
   */
  handleScrollbarDrag(mouseX: number, mouseY: number): boolean {
    if (!this._scrollbarDrag) return false;

    const element = this._document.getElementById(this._scrollbarDrag.elementId);
    if (!element) {
      this._scrollbarDrag = null;
      return false;
    }

    const {
      axis,
      startMousePos,
      startScrollPos,
      trackLength,
      thumbSize,
      contentLength,
      viewportLength,
    } = this._scrollbarDrag;

    const maxScroll = Math.max(0, contentLength - viewportLength);
    const availableTrackSpace = Math.max(1, trackLength - thumbSize);

    // Calculate mouse delta
    const mousePos = axis === 'vertical' ? mouseY : mouseX;
    const mouseDelta = mousePos - startMousePos;

    // Convert mouse delta to scroll delta
    // scrollPerPixel = maxScroll / availableTrackSpace
    const scrollDelta = availableTrackSpace > 0 ? (mouseDelta * maxScroll) / availableTrackSpace : 0;
    const newScroll = clamp(Math.round(startScrollPos + scrollDelta), 0, maxScroll);

    // Update scroll position
    if (axis === 'vertical') {
      if (element.props.scrollY !== newScroll) {
        element.props.scrollY = newScroll;
        if (this._autoRender) {
          this._onRender();
        }
      }
    } else {
      if (element.props.scrollX !== newScroll) {
        element.props.scrollX = newScroll;
        if (this._autoRender) {
          this._onRender();
        }
      }
    }

    return true;
  }

  /**
   * Handle mouse wheel scroll event
   */
  handleScrollEvent(event: { x: number; y: number; deltaX?: number; deltaY?: number }): void {
    // Find scrollable containers and handle wheel events for them
    const allContainers = this.findScrollableContainers(this._document.root);

    // Find the topmost scrollable container under the mouse cursor
    const targetContainer = this._findScrollableContainerAtPosition(allContainers, event.x, event.y);

    logger.debug(`ScrollHandler.handleScrollEvent: x=${event.x}, y=${event.y}, deltaY=${event.deltaY}, targetContainer=${targetContainer?.type}/${targetContainer?.id}`);

    if (targetContainer && isScrollingEnabled(targetContainer)) {
      const currentScrollY = (targetContainer.props.scrollY as number) || 0;
      const currentScrollX = (targetContainer.props.scrollX as number) || 0;
      const deltaY = event.deltaY || 0;
      const deltaX = event.deltaX || 0;

      // Resolve per-axis overflow
      const { x: overflowX, y: overflowY } = getOverflowAxis(targetContainer);

      // Calculate actual content dimensions - pass element directly (avoids ID lookup issues)
      const contentDimensions = this._calculateScrollDimensions(targetContainer);

      // Get actual rendered container bounds from rendering engine
      const containerBounds = this._renderer.getContainerBounds(targetContainer);
      const containerHeight = containerBounds?.height || 0;
      const containerWidth = containerBounds?.width || 0;

      logger.debug(`ScrollHandler: contentDimensions=${JSON.stringify(contentDimensions)}, containerHeight=${containerHeight}, containerWidth=${containerWidth}`);

      if (contentDimensions && (containerHeight > 0 || containerWidth > 0)) {
        let updated = false;

        // Handle vertical scrolling (only if overflowY allows it)
        if (deltaY !== 0 && containerHeight > 0 && (overflowY === 'scroll' || overflowY === 'auto')) {
          const maxScrollY = Math.max(0, contentDimensions.height - containerHeight);
          const newScrollY = clamp(currentScrollY + deltaY, 0, maxScrollY);

          logger.debug(`ScrollHandler: currentScrollY=${currentScrollY}, maxScrollY=${maxScrollY}, newScrollY=${newScrollY}`);

          if (newScrollY !== currentScrollY) {
            targetContainer.props.scrollY = newScrollY;
            updated = true;
          }
        }

        // Handle horizontal scrolling (only if overflowX allows it)
        if (deltaX !== 0 && containerWidth > 0 && (overflowX === 'scroll' || overflowX === 'auto')) {
          const maxScrollX = Math.max(0, contentDimensions.width - containerWidth);
          const newScrollX = clamp(currentScrollX + deltaX, 0, maxScrollX);

          if (newScrollX !== currentScrollX) {
            targetContainer.props.scrollX = newScrollX;
            updated = true;
          }
        }

        // Auto-render if anything changed
        if (updated && this._autoRender) {
          // Use fast dialog-only render when scrolling inside a dialog
          if (this._onRenderDialogOnly && this._isInsideDialog(targetContainer)) {
            this._onRenderDialogOnly();
          } else {
            this._onRender();
          }
        }
      }
    }
  }

  /**
   * Handle arrow key scrolling in a scrollable container
   * Returns true if scrolling occurred
   */
  handleArrowKeyScroll(key: string, container: Element): boolean {
    const currentScrollY = (container.props.scrollY as number) || 0;
    const currentScrollX = (container.props.scrollX as number) || 0;
    const scrollStep = 3; // Lines to scroll per arrow key press

    // Resolve per-axis overflow
    const { x: overflowX, y: overflowY } = getOverflowAxis(container);
    const allowVertical = overflowY === 'scroll' || overflowY === 'auto';
    const allowHorizontal = overflowX === 'scroll' || overflowX === 'auto';

    let newScrollY = currentScrollY;
    let newScrollX = currentScrollX;

    switch (key) {
      case 'ArrowUp':
        if (!allowVertical) return false;
        newScrollY = Math.max(0, currentScrollY - scrollStep);
        break;
      case 'ArrowDown':
        if (!allowVertical) return false;
        newScrollY = currentScrollY + scrollStep;
        break;
      case 'ArrowLeft':
        if (!allowHorizontal) return false;
        newScrollX = Math.max(0, currentScrollX - scrollStep);
        break;
      case 'ArrowRight':
        if (!allowHorizontal) return false;
        newScrollX = currentScrollX + scrollStep;
        break;
      default:
        return false;
    }

    // Check if we can scroll in the requested direction
    try {
      const scrollDimensions = this._renderer?.calculateScrollDimensions(container);
      const containerBounds = this._renderer?.getContainerBounds(container);

      if (scrollDimensions && containerBounds) {
        const maxScrollY = Math.max(0, scrollDimensions.height - containerBounds.height);
        const maxScrollX = Math.max(0, scrollDimensions.width - containerBounds.width);

        // Clamp scroll positions to valid range
        newScrollY = clamp(newScrollY, 0, maxScrollY);
        newScrollX = clamp(newScrollX, 0, maxScrollX);

        // Only update if scroll position actually changed
        if (newScrollY !== currentScrollY || newScrollX !== currentScrollX) {
          container.props.scrollY = newScrollY;
          container.props.scrollX = newScrollX;

          // Auto-render if enabled
          if (this._autoRender) {
            this._onRender();
          }

          return true;
        }
      }
    } catch (error) {
      // Scroll bounds calculation can fail for elements not in current layout
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.trace('Failed to calculate scroll bounds', { error: errorMessage });
    }

    return false;
  }

  /**
   * Find all scrollable containers in the element tree
   */
  findScrollableContainers(element: Element): Element[] {
    const scrollableContainers: Element[] = [];

    if (isScrollableType(element.type) && isScrollingEnabled(element)) {
      scrollableContainers.push(element);
    }

    if (element.children) {
      for (const child of element.children) {
        scrollableContainers.push(...this.findScrollableContainers(child));
      }
    }

    return scrollableContainers;
  }

  /**
   * Find the closest scrollable container for an element (including the element itself)
   */
  findScrollableParent(element: Element): Element | null {
    // First check if the element itself is a scrollable container
    if (isScrollableType(element.type) && isScrollingEnabled(element) && this._hasLayoutBounds(element)) {
      return element;
    }

    // Then traverse up the parent chain
    let current = this._findParent(element);

    while (current) {
      if (isScrollableType(current.type) && isScrollingEnabled(current) && this._hasLayoutBounds(current)) {
        return current;
      }
      current = this._findParent(current);
    }

    return null;
  }

  /**
   * Check if an element has layout bounds (is part of the current layout).
   * Elements in inactive tabs or collapsed sections may not have bounds.
   */
  private _hasLayoutBounds(element: Element): boolean {
    return element.id ? !!this._renderer?.getContainerBounds(element) : false;
  }

  /**
   * Find the topmost scrollable container at the given position
   */
  private _findScrollableContainerAtPosition(containers: Element[], x: number, y: number): Element | null {
    // Test containers from last to first (topmost rendered containers first)
    for (let i = containers.length - 1; i >= 0; i--) {
      const container = containers[i];
      const bounds = this._renderer?.getContainerBounds(container);

      if (bounds && pointInBounds(x, y, bounds)) {
        return container;
      }
    }
    return null;
  }


  /**
   * Find the parent element of a given element in the document tree
   */
  private _findParent(element: Element): Element | null {
    if (!this._document) return null;
    return this._findParentInTree(this._document.root, element);
  }

  /**
   * Recursively find parent element in the tree
   */
  private _findParentInTree(root: Element, target: Element): Element | null {
    if (!root.children) return null;

    for (const child of root.children) {
      if (child === target) {
        return root;
      }

      const found = this._findParentInTree(child, target);
      if (found) return found;
    }

    return null;
  }
}
