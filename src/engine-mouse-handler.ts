// Mouse and wheel event handling for MelkerEngine
// Extracted from engine.ts to reduce file size

import { isWheelable } from './types.ts';
import { getGlobalPerformanceDialog } from './performance-dialog.ts';
import { handleToastClick } from './toast/mod.ts';
import { getTooltipManager } from './tooltip/mod.ts';
import { getLogger } from './logging.ts';
import type { HitTester } from './hit-test.ts';

const logger = getLogger('MouseHandler');
import type { ScrollHandler } from './scroll-handler.ts';
import type { TextSelectionHandler } from './text-selection-handler.ts';
import type { GraphicsOverlayManager } from './graphics-overlay-manager.ts';

/**
 * Context providing access to engine dependencies for mouse handling
 */
export interface MouseHandlerContext {
  // Handlers
  hitTester: HitTester;
  scrollHandler: ScrollHandler;
  textSelectionHandler: TextSelectionHandler;
  graphicsOverlayManager: GraphicsOverlayManager;

  // Options
  autoRender: boolean;

  // Engine methods (bound callbacks)
  render: () => void;
  getViewportSize: () => { width: number; height: number };
}

/**
 * Handle wheel events - scrolling, wheelable elements, and scroll handler fallback.
 */
export function handleWheelEvent(event: any, ctx: MouseHandlerContext): void {
  // Hide tooltip on wheel event
  const tooltipManager = getTooltipManager();
  if (tooltipManager.isVisible()) {
    tooltipManager.hideTooltip();
  }

  // Check for Wheelable elements first (e.g., table with scrollable tbody)
  const target = ctx.hitTester.hitTest(event.x, event.y);
  logger.debug(`Engine wheel: target=${target?.type}/${target?.id}, isWheelable=${target ? isWheelable(target) : false}`);

  // Call element's onWheel handler if it exists
  if (target && typeof target.props?.onWheel === 'function') {
    const wheelEvent = {
      type: 'wheel' as const,
      x: event.x,
      y: event.y,
      deltaX: event.deltaX || 0,
      deltaY: event.deltaY || 0,
      target,
      timestamp: Date.now(),
    };
    target.props.onWheel(wheelEvent);
    // Auto-render after handler if enabled
    if (ctx.autoRender) {
      ctx.render();
    }
    return; // Event was handled by the onWheel handler
  }

  if (target && isWheelable(target)) {
    const canHandle = target.canHandleWheel(event.x, event.y);
    logger.debug(`Engine wheel: canHandleWheel=${canHandle}`);
    if (canHandle) {
      const handled = target.handleWheel(event.deltaX || 0, event.deltaY || 0);
      logger.debug(`Engine wheel: handleWheel returned ${handled}`);
      if (handled) {
        ctx.graphicsOverlayManager.markScrollHappened();
        if (ctx.autoRender) {
          ctx.render();
        }
        return; // Event was handled by the Wheelable element
      }
    }
  }
  // Fall through to default scroll handler
  logger.debug(`Engine wheel: falling through to scroll-handler`);
  ctx.graphicsOverlayManager.markScrollHappened();
  ctx.scrollHandler.handleScrollEvent(event);
}

/**
 * Handle mousedown events - toast clicks, performance dialog interaction, text selection.
 */
export function handleMouseDownEvent(event: any, ctx: MouseHandlerContext): void {
  // Check if toast overlay should handle this click
  if (handleToastClick(event.x, event.y)) {
    ctx.render();
    return;
  }

  // Check if performance dialog should handle this
  const perfDialog = getGlobalPerformanceDialog();
  if (perfDialog.isVisible()) {
    // Check close button first
    if (perfDialog.isOnCloseButton(event.x, event.y)) {
      perfDialog.hide();
      ctx.render();
      return;
    }
    // Then check title bar for dragging
    if (perfDialog.isOnTitleBar(event.x, event.y)) {
      perfDialog.startDrag(event.x, event.y);
      return;
    }
  }
  ctx.textSelectionHandler.handleMouseDown(event);
}

/**
 * Handle mousemove events - performance dialog dragging, text selection.
 */
export function handleMouseMoveEvent(event: any, ctx: MouseHandlerContext): void {
  // Check if performance dialog is being dragged
  const perfDialog = getGlobalPerformanceDialog();
  if (perfDialog.isDragging()) {
    const size = ctx.getViewportSize();
    perfDialog.updateDrag(event.x, event.y, size.width, size.height);
    ctx.render();
    return;
  }
  ctx.textSelectionHandler.handleMouseMove(event);
}

/**
 * Handle mouseup events - performance dialog drag end, text selection.
 */
export function handleMouseUpEvent(event: any, ctx: MouseHandlerContext): void {
  // End performance dialog drag if active
  const perfDialog = getGlobalPerformanceDialog();
  if (perfDialog.isDragging()) {
    perfDialog.endDrag();
    return;
  }
  ctx.textSelectionHandler.handleMouseUp(event);
}
