// Text selection handling for Melker Engine
// Extracted from engine.ts to reduce file size

import { Document } from './document.ts';
import { DualBuffer } from './buffer.ts';
import { RenderingEngine } from './rendering.ts';
import { Element, TextSelection, Bounds, isDraggable, Draggable, hasShaderMethods } from './types.ts';
import { clampToBounds } from './geometry.ts';
import {
  EventManager,
  createMouseEvent,
} from './events.ts';
import { HitTester } from './hit-test.ts';
import { ScrollHandler } from './scroll-handler.ts';
import { getLogger } from './logging.ts';
import { DialogElement } from './components/dialog.ts';
import { Command, isPermissionError } from './runtime/mod.ts';
import { CommandPaletteElement } from './components/filterable-list/command-palette.ts';
import { createThrottledAction, type ThrottledAction } from './utils/timing.ts';
import { isStatsOverlayEnabled, getGlobalStatsOverlay } from './stats-overlay.ts';
import { getGlobalPerformanceDialog, type PerformanceStats } from './performance-dialog.ts';
import { getGlobalErrorHandler } from './error-boundary.ts';
import { getUIAnimationManager } from './ui-animation-manager.ts';
import { getToastManager } from './toast/mod.ts';
import { getTooltipManager, TooltipManager } from './tooltip/mod.ts';
import type { TooltipProvider } from './tooltip/mod.ts';

const logger = getLogger('text-selection');

export interface TextSelectionHandlerOptions {
  autoRender: boolean;
}

export interface TextSelectionHandlerDeps {
  getBuffer: () => DualBuffer;
  hitTester: HitTester;
  scrollHandler: ScrollHandler;
  document: Document;
  renderer: RenderingEngine;
  eventManager: EventManager;
  onRender: () => void;
  onRenderDialogOnly: () => void;  // Fast render for dialog drag/resize
  onRenderOptimized: () => void;  // Apply buffer to terminal (optimized diff rendering)
  onElementClick: (element: Element, event: any) => void;
}

/**
 * Handles text selection via mouse interactions
 */
export class TextSelectionHandler {
  private _options: TextSelectionHandlerOptions;
  private _deps: TextSelectionHandlerDeps;

  // Selection state
  private _textSelection: TextSelection = {
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    isActive: false,
    mode: 'component',
  };
  private _isSelecting = false;
  // Throttled action for selection render updates (~60fps)
  private _throttledSelectionRender!: ThrottledAction;
  private _lastClickTime = 0;
  private _lastClickPos = { x: -1, y: -1 };
  private _clickCount = 0;
  private _hoveredElementId: string | null = null;

  // Dialog drag state
  private _draggingDialog: DialogElement | null = null;
  // Dialog resize state
  private _resizingDialog: DialogElement | null = null;
  // Command palette drag state
  private _draggingPalette: CommandPaletteElement | null = null;
  // Throttled action for dialog drag/resize renders (~60fps)
  private _throttledDialogRender!: ThrottledAction;
  // Throttled action for generic draggable element renders (~60fps)
  private _throttledDragRender!: ThrottledAction;
  // Generic draggable element state
  private _draggingElement: (Element & Draggable) | null = null;
  private _dragZone: string | null = null;

  // Focus-based tooltip state
  private _focusedElementId: string | null = null;
  private _focusTooltipCleanup: (() => void) | null = null;

  // Selection performance timing stats
  private _selectionTimingStats = {
    moveCount: 0,
    hitTestTotal: 0,
    hitTestMax: 0,
    selectionUpdateTotal: 0,
    renderRequestCount: 0,
    renderTotal: 0,
    renderMax: 0,
    startTime: 0,
  };

  // Detailed render timing for logging
  private _renderDetailedStats = {
    renderNodeTotal: 0,
    highlightTotal: 0,
    overlaysTotal: 0,
    modalsTotal: 0,
    terminalOutputTotal: 0,
    bufferClearTotal: 0,
  };

  constructor(options: TextSelectionHandlerOptions, deps: TextSelectionHandlerDeps) {
    this._options = options;
    this._deps = deps;

    // Initialize throttled selection render (~60fps, leading + trailing edges)
    this._throttledSelectionRender = createThrottledAction(
      () => this._renderSelectionOnly(),
      16,  // ~60fps
      { leading: true, trailing: true }
    );

    // Initialize throttled dialog drag/resize render (~60fps) using fast dialog-only path
    this._throttledDialogRender = createThrottledAction(
      () => this._deps.onRenderDialogOnly(),
      16,  // ~60fps
      { leading: true, trailing: true }
    );

    // Initialize throttled generic drag render (~60fps) for split-pane dividers etc.
    this._throttledDragRender = createThrottledAction(
      () => this._deps.onRender(),
      16,  // ~60fps
      { leading: true, trailing: true }
    );

    // Set up focus event listeners for keyboard-triggered tooltips
    this._initFocusTooltipListeners();
  }

  /**
   * Walk tree to find an open command palette (system palette may not be in registry).
   */
  private _findOpenCommandPalette(element: Element): CommandPaletteElement | null {
    if (element.type === 'command-palette' && element.props?.open === true) {
      return element instanceof CommandPaletteElement ? element : null;
    }
    if (element.children) {
      for (const child of element.children) {
        const found = this._findOpenCommandPalette(child);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Initialize focus/blur event listeners for keyboard-accessible tooltips
   */
  private _initFocusTooltipListeners(): void {
    const handleFocus = (event: any) => {
      if (event.type === 'focus' && event.target) {
        this._focusedElementId = event.target;
        this._handleFocusTooltip(event.target);
      }
    };

    const handleBlur = (event: any) => {
      if (event.type === 'blur' && event.target === this._focusedElementId) {
        this._focusedElementId = null;
        // Hide tooltip if it was showing for this element
        const tooltipManager = getTooltipManager();
        if (tooltipManager.getTargetElementId() === event.target) {
          tooltipManager.hideTooltip();
        }
      }
    };

    this._deps.eventManager.addGlobalEventListener('focus', handleFocus);
    this._deps.eventManager.addGlobalEventListener('blur', handleBlur);

    // Store cleanup function
    this._focusTooltipCleanup = () => {
      this._deps.eventManager.removeGlobalEventListener('focus', handleFocus);
      this._deps.eventManager.removeGlobalEventListener('blur', handleBlur);
    };
  }

  /**
   * Handle tooltip for focused element (keyboard navigation)
   */
  private _handleFocusTooltip(elementId: string): void {
    const element = this._deps.document.getElementById(elementId);
    if (!element) return;

    // Check if element has tooltip
    const tooltipProp = element.props?.tooltip;
    const hasTooltip = tooltipProp !== undefined;
    const hasTooltipHandler = typeof element.props?.onTooltip === 'function';
    const isAutoTooltip = tooltipProp === 'auto';

    if (!hasTooltip && !hasTooltipHandler) return;

    // Get element bounds for positioning
    const bounds = element.getBounds();
    if (!bounds) return;

    // Position tooltip at center of element
    const screenX = bounds.x + Math.floor(bounds.width / 2);
    const screenY = bounds.y;

    // Calculate relative coordinates (center)
    const relX = Math.floor(bounds.width / 2);
    const relY = Math.floor(bounds.height / 2);

    // Get component-specific context if available
    const tooltipProvider = element as unknown as TooltipProvider;
    const context = tooltipProvider.getTooltipContext?.(relX, relY);

    const tooltipManager = getTooltipManager();
    const focusDelay = tooltipManager.getFocusShowDelay();

    // Get tooltip content
    if (hasTooltipHandler) {
      const tooltipEvent = TooltipManager.buildEvent(element, screenX, screenY, bounds, context);
      const result = element.props.onTooltip(tooltipEvent);
      if (result instanceof Promise) {
        result.then((content: string | undefined) => {
          if (content && this._focusedElementId === elementId) {
            tooltipManager.scheduleTooltip(element, content, screenX, screenY, bounds, focusDelay);
          }
        }).catch(() => {});
      } else if (result) {
        tooltipManager.scheduleTooltip(element, result as string, screenX, screenY, bounds, focusDelay);
      }
    } else if (isAutoTooltip) {
      if (context && tooltipProvider.getDefaultTooltip) {
        const content = tooltipProvider.getDefaultTooltip(context);
        if (content) {
          tooltipManager.scheduleTooltip(element, content, screenX, screenY, bounds, focusDelay);
        }
      } else if (typeof (element as any).getValue === 'function') {
        // Fallback: use getValue() for components without TooltipProvider
        const value = (element as any).getValue();
        if (value !== undefined && value !== null) {
          const content = String(value);
          if (content) {
            tooltipManager.scheduleTooltip(element, content, screenX, screenY, bounds, focusDelay);
          }
        }
      }
    } else if (hasTooltip && tooltipProp !== 'auto') {
      tooltipManager.scheduleTooltip(element, tooltipProp, screenX, screenY, bounds, focusDelay);
    }
  }

  /**
   * Handle mouse down events for text selection and element interaction
   */
  handleMouseDown(event: any): void {
    // Hide tooltip on mouse down
    getTooltipManager().hideTooltip();

    // Reset selection timing stats for new potential drag
    this._selectionTimingStats = {
      moveCount: 0,
      hitTestTotal: 0,
      hitTestMax: 0,
      selectionUpdateTotal: 0,
      renderRequestCount: 0,
      renderTotal: 0,
      renderMax: 0,
      startTime: performance.now(),
    };
    // Reset detailed render stats
    this._renderDetailedStats = {
      renderNodeTotal: 0,
      highlightTotal: 0,
      overlaysTotal: 0,
      modalsTotal: 0,
      terminalOutputTotal: 0,
      bufferClearTotal: 0,
    };
    // Reset throttle for fresh drag
    this._throttledSelectionRender.reset();

    // Check for scrollbar click before other interactions
    const scrollbarHit = this._deps.scrollHandler.detectScrollbarClick(event.x, event.y);
    if (scrollbarHit && event.button === 0) {
      this._deps.scrollHandler.handleScrollbarClick(scrollbarHit, event.x, event.y);
      return; // Don't process text selection when clicking scrollbar
    }

    // Check for dialog title bar drag or resize corner before other interactions
    if (event.button === 0) {
      const dialogs = this._deps.document.getElementsByType('dialog');
      for (const dialog of dialogs) {
        if (dialog instanceof DialogElement && dialog.props.open) {
          // Check for resize corner first (takes priority over drag)
          if (dialog.props.resizable && dialog.isOnResizeCorner(event.x, event.y)) {
            dialog.startResize(event.x, event.y);
            this._resizingDialog = dialog;
            return; // Don't process other interactions when resizing dialog
          }
          // Check for title bar drag
          if (dialog.props.draggable && dialog.isOnTitleBar(event.x, event.y)) {
            dialog.startDrag(event.x, event.y);
            this._draggingDialog = dialog;
            return; // Don't process text selection when dragging dialog
          }
        }
      }

      // Check for command palette title bar drag (walk tree since system palette
      // may not be in the element registry — it's injected after initialization)
      const openPalette = this._findOpenCommandPalette(this._deps.document.root);
      if (openPalette && openPalette.isOnTitleBar(event.x, event.y)) {
        openPalette.startDrag(event.x, event.y);
        this._draggingPalette = openPalette;
        return; // Don't process text selection when dragging palette
      }
    }

    // Check for overlay clicks first (dropdowns, tooltips, etc.)
    // Overlays render on top of normal content, so they should receive clicks first
    const overlays = this._deps.renderer.getOverlays();
    let clickedOnOverlay = false;
    let clickedOverlayId: string | undefined;

    // Check overlays in reverse order (highest z-index first)
    for (let i = overlays.length - 1; i >= 0; i--) {
      const overlay = overlays[i];
      const hitBounds = overlay.hitTestBounds || overlay.bounds;
      if (event.x >= hitBounds.x && event.x < hitBounds.x + hitBounds.width &&
          event.y >= hitBounds.y && event.y < hitBounds.y + hitBounds.height) {
        // Click is on this overlay
        clickedOnOverlay = true;
        clickedOverlayId = overlay.id;
        if (overlay.onClick) {
          const handled = overlay.onClick(event.x, event.y);
          if (handled) {
            // Request re-render after overlay click
            if (this._options.autoRender) {
              this._deps.onRender();
            }
            return; // Overlay consumed the click
          }
        }
        // If overlay doesn't handle click, continue to normal processing
        // but let the overlay's parent element handle it
        break;
      }
    }

    // Check for click-outside on overlays that weren't clicked
    // This handles dismiss-on-click-outside behavior for dropdowns
    let needsRender = false;
    for (const overlay of overlays) {
      if (overlay.onClickOutside && overlay.id !== clickedOverlayId) {
        // Check if click is within overlay bounds
        const hitBounds = overlay.hitTestBounds || overlay.bounds;
        const isInsideOverlay = event.x >= hitBounds.x && event.x < hitBounds.x + hitBounds.width &&
                                event.y >= hitBounds.y && event.y < hitBounds.y + hitBounds.height;

        // Check if click is within any excluded bounds (like the trigger element)
        let isInsideExcluded = false;
        if (overlay.excludeBounds) {
          for (const excludeBounds of overlay.excludeBounds) {
            if (event.x >= excludeBounds.x && event.x < excludeBounds.x + excludeBounds.width &&
                event.y >= excludeBounds.y && event.y < excludeBounds.y + excludeBounds.height) {
              isInsideExcluded = true;
              break;
            }
          }
        }

        // If click is outside overlay and not in excluded bounds, trigger callback
        if (!isInsideOverlay && !isInsideExcluded) {
          overlay.onClickOutside();
          needsRender = true;
        }
      }
    }

    if (needsRender && this._options.autoRender) {
      this._deps.onRender();
    }

    // Perform hit testing to find the element at the clicked coordinates
    const targetElement = this._deps.hitTester.hitTest(event.x, event.y);
    const isAltPressed = event.altKey;

    // Dispatch mousedown event to document with target information
    this._deps.document.dispatchEvent({
      type: 'mousedown',
      x: event.x,
      y: event.y,
      button: event.button || 0,
      target: targetElement?.id,
      timestamp: Date.now(),
    });

    // Call element's onMouseDown handler if it exists
    if (targetElement && typeof targetElement.props.onMouseDown === 'function') {
      const mouseDownEvent = {
        type: 'mousedown' as const,
        x: event.x,
        y: event.y,
        button: event.button || 0,
        shiftKey: event.shift || false,
        ctrlKey: event.ctrl || false,
        altKey: event.alt || false,
        target: targetElement,
        timestamp: Date.now(),
      };
      targetElement.props.onMouseDown(mouseDownEvent);
    }

    if (event.button === 0) { // Left mouse button
      // Track multi-click (double/triple click)
      const now = Date.now();
      const samePosition = Math.abs(event.x - this._lastClickPos.x) <= 1 &&
                          Math.abs(event.y - this._lastClickPos.y) <= 1;
      const quickClick = now - this._lastClickTime < 400;

      if (samePosition && quickClick) {
        this._clickCount = (this._clickCount % 3) + 1;
      } else {
        this._clickCount = 1;
      }
      this._lastClickTime = now;
      this._lastClickPos = { x: event.x, y: event.y };

      // Handle element interactions (focus, button clicks) - but not during Alt+click
      if (targetElement && !isAltPressed) {
        this._deps.onElementClick(targetElement, event);
      }

      // Check for draggable elements (scrollbars, resizers, etc.)
      if (targetElement && !isAltPressed && isDraggable(targetElement)) {
        const dragZone = targetElement.getDragZone(event.x, event.y);
        if (dragZone) {
          this._draggingElement = targetElement;
          this._dragZone = dragZone;
          targetElement.handleDragStart(dragZone, event.x, event.y);
          return; // Don't start text selection when dragging
        }
      }

      // Alt+click: Global rectangular selection (includes chrome/borders)
      if (isAltPressed) {
        this._clickCount = 1; // Reset click count for alt+click
        this._isSelecting = true;
        this._textSelection = {
          start: { x: event.x, y: event.y },
          end: { x: event.x, y: event.y },
          isActive: false,
          mode: 'global',
        };
      }
      // Normal click on text-selectable component: Component-constrained selection
      else if (targetElement && this._deps.hitTester.isTextSelectableElement(targetElement)) {
        const bounds = this._getSelectionBounds(targetElement);
        logger.debug('Text selection attempt', {
          elementId: targetElement.id,
          elementType: targetElement.type,
          hasBounds: !!bounds,
          bounds: bounds ? `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}` : 'none'
        });
        if (bounds) {
          const clampedPos = clampToBounds({ x: event.x, y: event.y }, bounds);
          logger.debug('Selection bounds found, starting selection', {
            clickCount: this._clickCount,
            clampedPos: `${clampedPos.x},${clampedPos.y}`,
            originalPos: `${event.x},${event.y}`
          });

          if (this._clickCount === 2) {
            // Double-click: select word
            const wordBounds = this._getWordBoundsAt(clampedPos.x, clampedPos.y, bounds);
            this._isSelecting = false;
            this._textSelection = {
              start: { x: wordBounds.startX, y: clampedPos.y },
              end: { x: wordBounds.endX, y: clampedPos.y },
              isActive: true,
              componentId: targetElement.id,
              componentBounds: bounds,
              mode: 'component',
            };
            // Extract text immediately for double-click
            this._textSelection.selectedText = this._extractSelectedText();
            if (this._options.autoRender) {
              this._deps.onRender();
            }
          } else if (this._clickCount === 3) {
            // Triple-click: select line
            this._isSelecting = false;
            this._textSelection = {
              start: { x: bounds.x, y: clampedPos.y },
              end: { x: bounds.x + bounds.width - 1, y: clampedPos.y },
              isActive: true,
              componentId: targetElement.id,
              componentBounds: bounds,
              mode: 'component',
            };
            // Extract text immediately for triple-click
            this._textSelection.selectedText = this._extractSelectedText();
            if (this._options.autoRender) {
              this._deps.onRender();
            }
          } else {
            // Single click: start drag selection
            this._isSelecting = true;
            this._textSelection = {
              start: clampedPos,
              end: clampedPos,
              isActive: false,
              componentId: targetElement.id,
              componentBounds: bounds,
              mode: 'component',
            };
            logger.debug('Started drag selection', {
              isSelecting: this._isSelecting,
              start: `${clampedPos.x},${clampedPos.y}`,
              componentId: targetElement.id
            });
          }
        }
      }
      // Normal click on non-text-selectable, non-interactive element: Clear selection
      else if (!targetElement || !this._deps.hitTester.isInteractiveElement(targetElement)) {
        logger.debug('Clearing selection', {
          hasTarget: !!targetElement,
          targetId: targetElement?.id,
          targetType: targetElement?.type,
          isTextSelectable: targetElement ? this._deps.hitTester.isTextSelectableElement(targetElement) : false,
          isInteractive: targetElement ? this._deps.hitTester.isInteractiveElement(targetElement) : false
        });
        this._clearSelection();
      }
    }
  }

  /**
   * Handle mouse move events for text selection
   */
  handleMouseMove(event: any): void {
    // Handle dialog resize first (throttled to ~60fps)
    if (this._resizingDialog) {
      if (this._resizingDialog.updateResize(event.x, event.y)) {
        this._throttledDialogRender.trigger();
      }
      return;
    }

    // Handle dialog drag (throttled to ~60fps)
    if (this._draggingDialog) {
      if (this._draggingDialog.updateDrag(event.x, event.y)) {
        this._throttledDialogRender.trigger();
      }
      return;
    }

    // Handle command palette drag (throttled to ~60fps, uses full render since palette is an overlay)
    if (this._draggingPalette) {
      if (this._draggingPalette.updateDrag(event.x, event.y)) {
        this._throttledDragRender.trigger();
      }
      return;
    }

    // Handle scrollbar drag first
    if (this._deps.scrollHandler.isScrollbarDragActive()) {
      this._deps.scrollHandler.handleScrollbarDrag(event.x, event.y);
      return;
    }

    // Handle generic draggable element (throttled to ~60fps)
    if (this._draggingElement && this._dragZone) {
      this._draggingElement.handleDragMove(this._dragZone, event.x, event.y);
      this._throttledDragRender.trigger();
      return;
    }

    // Track timing during selection drag
    const isTracking = this._isSelecting;
    if (isTracking) {
      this._selectionTimingStats.moveCount++;
    }

    // Perform hit testing to find the element under the mouse
    const hitTestStart = performance.now();
    const hoveredElement = this._deps.hitTester.hitTest(event.x, event.y);
    const hitTestTime = performance.now() - hitTestStart;
    if (isTracking) {
      this._selectionTimingStats.hitTestTotal += hitTestTime;
      this._selectionTimingStats.hitTestMax = Math.max(this._selectionTimingStats.hitTestMax, hitTestTime);
    }

    const hoveredElementId = hoveredElement?.id || null;

    // Check if the hovered element has changed
    if (hoveredElementId !== this._hoveredElementId) {
      // Fire mouseout event for the previously hovered element
      if (this._hoveredElementId) {
        const prevElement = this._deps.document.getElementById(this._hoveredElementId);
        // Auto-clear shader mouse position when leaving element with shader
        if (prevElement && prevElement.props?.onShader && hasShaderMethods(prevElement)) {
          prevElement.clearShaderMouse();
        }
        // Call onMouseOut handler directly if present
        if (prevElement && typeof prevElement.props?.onMouseOut === 'function') {
          const mouseOutEvent = {
            type: 'mouseout',
            x: event.x,
            y: event.y,
            button: event.button || 0,
            target: prevElement,
            timestamp: Date.now(),
          };
          prevElement.props.onMouseOut(mouseOutEvent);
        }
        this._deps.eventManager.dispatchEvent({
          type: 'mouseout',
          x: event.x,
          y: event.y,
          button: event.button || 0,
          buttons: 0,
          target: this._hoveredElementId,
          timestamp: Date.now(),
        });
      }

      // Fire mouseover event for the newly hovered element
      if (hoveredElementId) {
        // Call onMouseOver handler directly if present
        if (hoveredElement && typeof hoveredElement.props?.onMouseOver === 'function') {
          const mouseOverEvent = {
            type: 'mouseover',
            x: event.x,
            y: event.y,
            button: event.button || 0,
            target: hoveredElement,
            timestamp: Date.now(),
          };
          hoveredElement.props.onMouseOver(mouseOverEvent);
        }
        this._deps.eventManager.dispatchEvent({
          type: 'mouseover',
          x: event.x,
          y: event.y,
          button: event.button || 0,
          buttons: 0,
          target: hoveredElementId,
          timestamp: Date.now(),
        });
      }

      this._hoveredElementId = hoveredElementId;

      // Re-render to update hover states
      if (this._options.autoRender) {
        this._deps.onRender();
      }
    }

    // Dispatch mousemove event to document
    this._deps.document.dispatchEvent({
      type: 'mousemove',
      x: event.x,
      y: event.y,
      button: event.button || 0,
      timestamp: Date.now(),
    });

    // Auto-update shader mouse position for elements with onShader
    if (hoveredElement && hoveredElement.props?.onShader && hasShaderMethods(hoveredElement)) {
      hoveredElement.updateShaderMouse(event.x, event.y);
    }

    // Check drag zone hover feedback (e.g. column resize indicators)
    if (hoveredElement && isDraggable(hoveredElement) && hoveredElement.handleDragHover) {
      if (hoveredElement.handleDragHover(event.x, event.y) && this._options.autoRender) {
        this._deps.onRender();
      }
    }

    // Call onMouseMove handler on the hovered element (if it has one)
    if (hoveredElement && typeof hoveredElement.props?.onMouseMove === 'function') {
      const mouseEvent = {
        type: 'mousemove',
        x: event.x,
        y: event.y,
        button: event.button || 0,
        target: hoveredElement,
        timestamp: Date.now(),
      };
      hoveredElement.props.onMouseMove(mouseEvent);
    }

    // Handle tooltip
    this._handleTooltip(hoveredElement, event.x, event.y);

    if (this._isSelecting) {
      logger.debug('Mouse move during selection', {
        isSelecting: this._isSelecting,
        mode: this._textSelection.mode,
        pos: `${event.x},${event.y}`
      });
      const selectionUpdateStart = performance.now();
      if (this._textSelection.mode === 'global') {
        // Global mode: no clamping
        this._textSelection.end = { x: event.x, y: event.y };
      } else if (this._textSelection.componentBounds) {
        // Component mode: clamp to bounds
        this._textSelection.end = clampToBounds(
          { x: event.x, y: event.y },
          this._textSelection.componentBounds
        );
      }
      this._textSelection.isActive = true;
      this._selectionTimingStats.selectionUpdateTotal += performance.now() - selectionUpdateStart;

      // Throttled selection-only render (skips layout calculation)
      // Guarantees render every 16ms during continuous movement (~60fps)
      if (this._options.autoRender) {
        this._selectionTimingStats.renderRequestCount++;
        this._throttledSelectionRender.call();
      }
    }
  }

  /**
   * Handle mouse up events for text selection
   */
  handleMouseUp(event: any): void {
    // End dialog resize if active
    if (this._resizingDialog) {
      this._resizingDialog.endResize();
      this._resizingDialog = null;
      this._throttledDialogRender.flush(); // Ensure final position is rendered
      return; // Don't process other mouse up events
    }

    // End dialog drag if active
    if (this._draggingDialog) {
      this._draggingDialog.endDrag();
      this._draggingDialog = null;
      this._throttledDialogRender.flush(); // Ensure final position is rendered
      return; // Don't process other mouse up events
    }

    // End command palette drag if active
    if (this._draggingPalette) {
      this._draggingPalette.endDrag();
      this._draggingPalette = null;
      this._throttledDragRender.flush(); // Ensure final position is rendered
      return; // Don't process other mouse up events
    }

    // End scrollbar drag if active
    if (this._deps.scrollHandler.isScrollbarDragActive()) {
      this._deps.scrollHandler.endScrollbarDrag();
      return; // Don't process other mouse up events
    }

    // End generic draggable element drag if active
    if (this._draggingElement && this._dragZone) {
      this._draggingElement.handleDragEnd(this._dragZone, event.x, event.y);
      this._draggingElement = null;
      this._dragZone = null;
      this._throttledDragRender.flush(); // Ensure final position is rendered
      return; // Don't process other mouse up events
    }

    // Perform hit testing to find the element at the release coordinates
    const targetElement = this._deps.hitTester.hitTest(event.x, event.y);

    // Dispatch mouseup event to document with target information
    this._deps.document.dispatchEvent({
      type: 'mouseup',
      x: event.x,
      y: event.y,
      button: event.button || 0,
      target: targetElement?.id,
      timestamp: Date.now(),
    });

    // Call element's onMouseUp handler if it exists
    if (targetElement && typeof targetElement.props.onMouseUp === 'function') {
      const mouseUpEvent = {
        type: 'mouseup' as const,
        x: event.x,
        y: event.y,
        button: event.button || 0,
        target: targetElement,
        timestamp: Date.now(),
      };
      targetElement.props.onMouseUp(mouseUpEvent);
    }

    if (event.button === 0 && this._isSelecting) { // Left mouse button
      this._isSelecting = false;

      // Cancel any pending throttled render
      this._throttledSelectionRender.cancel();

      // If we have a valid selection, keep it active and extract final text
      if (this._textSelection.isActive) {
        this._textSelection.selectedText = this._extractSelectedText();
      } else {
        // No selection made, clear it
        this._clearSelection();
      }

      // Log selection timing stats if there was actual selection drag
      const stats = this._selectionTimingStats;
      const detailed = this._renderDetailedStats;
      if (stats.moveCount > 0) {
        const totalTime = performance.now() - stats.startTime;
        const renderCount = stats.renderTotal > 0 ? Math.round(stats.renderTotal / stats.renderMax) : 0;
        logger.debug('Selection drag timing stats:', {
          totalDragTime: `${totalTime.toFixed(1)}ms`,
          mouseMoveEvents: stats.moveCount,
          hitTest: {
            total: `${stats.hitTestTotal.toFixed(2)}ms`,
            avg: `${(stats.hitTestTotal / stats.moveCount).toFixed(2)}ms`,
            max: `${stats.hitTestMax.toFixed(2)}ms`,
          },
          selectionUpdate: {
            total: `${stats.selectionUpdateTotal.toFixed(2)}ms`,
            avg: `${(stats.selectionUpdateTotal / stats.moveCount).toFixed(2)}ms`,
          },
          render: {
            requestCount: stats.renderRequestCount,
            actualRenders: renderCount,
            totalTime: `${stats.renderTotal.toFixed(2)}ms`,
            maxSingle: `${stats.renderMax.toFixed(2)}ms`,
          },
          renderBreakdown: {
            bufferClear: `${detailed.bufferClearTotal.toFixed(2)}ms`,
            renderNode: `${detailed.renderNodeTotal.toFixed(2)}ms`,
            highlight: `${detailed.highlightTotal.toFixed(2)}ms`,
            overlays: `${detailed.overlaysTotal.toFixed(2)}ms`,
            modals: `${detailed.modalsTotal.toFixed(2)}ms`,
            terminalOutput: `${detailed.terminalOutputTotal.toFixed(2)}ms`,
          },
        });
      }

      // Re-render immediately to finalize selection state
      if (this._options.autoRender) {
        this._deps.onRender();
      }
    }
  }

  /**
   * Get word boundaries at a specific position in the buffer
   */
  private _getWordBoundsAt(x: number, y: number, bounds: Bounds): { startX: number; endX: number } {
    const buffer = this._deps.getBuffer();
    if (!buffer) return { startX: x, endX: x };

    // Use previousBuffer as it contains the last rendered frame
    // (currentBuffer is cleared after swap)
    const termBuffer = buffer.previousBuffer;

    const getChar = (cx: number): string => {
      const cell = termBuffer.getCell(cx, y);
      return cell?.char || '';
    };

    // Check if character at position is a word character
    const isWordChar = (cx: number): boolean => {
      const char = getChar(cx);
      if (!char || char === ' ') return false;


      // Allow : only after http or https
      if (char === ':') {
        const preceding = getChar(cx - 4) + getChar(cx - 3) + getChar(cx - 2) + getChar(cx - 1);
        return preceding === 'http' || preceding === 'https';
      }

      return /[\w\u00C0-\u024F\/.:-]/.test(char); // Letters, numbers, underscore, accented chars
    };

    // If clicked on non-word char, just select that char
    if (!isWordChar(x)) {
      return { startX: x, endX: x };
    }

    // Find word start
    let startX = x;
    while (startX > bounds.x && isWordChar(startX - 1)) {
      startX--;
    }

    // Find word end
    let endX = x;
    while (endX < bounds.x + bounds.width - 1 && isWordChar(endX + 1)) {
      endX++;
    }

    return { startX, endX };
  }

  /**
   * Clear the current text selection
   */
  private _clearSelection(): void {
    this._textSelection = {
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      isActive: false,
      mode: 'component',
    };
    this._isSelecting = false;
  }

  /**
   * Get selection bounds for an element, accounting for scrollable parent containers
   */
  private _getSelectionBounds(element: Element): Bounds | undefined {
    const elementBounds = this._deps.renderer.getContainerBounds(element.id || '');

    if (!elementBounds) return undefined;

    // Find scrollable parent and constrain bounds
    const scrollableParent = this._deps.scrollHandler.findScrollableParent(element);
    if (scrollableParent) {
      const parentBounds = this._deps.renderer.getContainerBounds(scrollableParent.id || '');
      if (parentBounds) {
        // Constrain element bounds to scrollable parent bounds
        const constrainedRight = Math.min(
          elementBounds.x + elementBounds.width,
          parentBounds.x + parentBounds.width
        );
        return {
          x: elementBounds.x,
          y: elementBounds.y,
          width: Math.max(1, constrainedRight - elementBounds.x),
          height: elementBounds.height,
        };
      }
    }

    return elementBounds;
  }

  /**
   * Extract text from the selected area
   */
  private _extractSelectedText(): string {
    const buffer = this._deps.getBuffer();
    if (!buffer || !this._textSelection.isActive) {
      return '';
    }
    // Extract text from the displayed buffer (previousBuffer contains last rendered frame)
    return this._deps.renderer.extractSelectionText(this._textSelection, buffer);
  }

  /**
   * Optimized render for selection updates only - skips layout calculation
   */
  private _renderSelectionOnly(): void {
    const buffer = this._deps.getBuffer();
    if (!buffer) return;

    const renderStart = performance.now();

    // Clear the buffer for rendering
    const clearStart = performance.now();
    buffer.currentBuffer.clear();
    this._renderDetailedStats.bufferClearTotal += performance.now() - clearStart;

    // Try selection-only render (uses cached layout)
    const success = this._deps.renderer.renderSelectionOnly(
      buffer,
      this._textSelection,
      this._deps.document.focusedElement?.id,
      this._hoveredElementId || undefined,
      () => this._deps.onRender()
    );

    if (!success) {
      // Fallback to full render if no cached layout
      this._deps.onRender();
      return;
    }

    // Accumulate detailed timing from renderer
    const rt = this._deps.renderer.selectionRenderTiming;
    this._renderDetailedStats.renderNodeTotal += rt.renderNodeTime;
    this._renderDetailedStats.highlightTotal += rt.highlightTime;
    this._renderDetailedStats.overlaysTotal += rt.overlaysTime;
    this._renderDetailedStats.modalsTotal += rt.modalsTime;

    // Render stats overlay if enabled (stats are from previous frame's swapAndGetDiff)
    if (isStatsOverlayEnabled()) {
      try {
        const statsOverlay = getGlobalStatsOverlay();
        const stats = buffer.stats;
        if (stats) {
          statsOverlay.render(buffer, stats);
        }
      } catch {
        // Silently ignore stats overlay errors
      }
    }

    // Render performance dialog if visible
    const perfDialog = getGlobalPerformanceDialog();
    if (perfDialog.isVisible()) {
      try {
        const errorHandler = getGlobalErrorHandler();
        const breakdown = perfDialog.getLatencyBreakdown();
        const perfStats: PerformanceStats = {
          fps: perfDialog.getFps(),
          renderTime: 0, // Not tracked in selection-only render
          renderTimeAvg: perfDialog.getAverageRenderTime(),
          renderCount: 0,
          layoutTime: 0,
          layoutTimeAvg: perfDialog.getAverageLayoutTime(),
          layoutNodeCount: 0,
          totalCells: buffer.stats?.totalCells || 0,
          changedCells: buffer.stats?.changedCells || 0,
          bufferUtilization: buffer.stats?.bufferUtilization || 0,
          memoryUsage: buffer.stats?.memoryUsage || 0,
          errorCount: errorHandler.errorCount(),
          suppressedErrors: errorHandler.getTotalSuppressedCount(),
          inputLatency: perfDialog.getLastInputLatency(),
          inputLatencyAvg: perfDialog.getAverageInputLatency(),
          handlerTime: breakdown.handler,
          waitTime: breakdown.wait,
          layoutTime2: breakdown.layout,
          bufferTime: breakdown.buffer,
          applyTime: breakdown.apply,
          // Shader stats
          shaderCount: perfDialog.getActiveShaderCount(),
          shaderFrameTime: perfDialog.getLastShaderFrameTime(),
          shaderFrameTimeAvg: perfDialog.getAverageShaderFrameTime(),
          shaderFps: perfDialog.getShaderFps(),
          shaderPixels: perfDialog.getTotalShaderPixels(),
          // Animation stats
          animationCount: getUIAnimationManager().count,
          animationTick: getUIAnimationManager().currentTick,
          // Terminal size
          terminalWidth: buffer.width,
          terminalHeight: buffer.height,
        };
        perfDialog.render(buffer, perfStats);
      } catch {
        // Silently ignore performance dialog errors
      }
    }

    // Apply to terminal
    const terminalStart = performance.now();
    this._deps.onRenderOptimized();
    this._renderDetailedStats.terminalOutputTotal += performance.now() - terminalStart;

    // Track render timing
    const renderTime = performance.now() - renderStart;
    this._selectionTimingStats.renderTotal += renderTime;
    this._selectionTimingStats.renderMax = Math.max(this._selectionTimingStats.renderMax, renderTime);
  }

  /**
   * Copy the current selection to system clipboard
   * Supports Linux (X11/Wayland), macOS, and WSL2
   */
  copySelectionToClipboard(): void {
    if (!this._textSelection.isActive || !this._textSelection.selectedText) {
      return;
    }

    const text = this._textSelection.selectedText;

    // Platform-specific clipboard commands
    const commands = [
      // macOS
      { cmd: 'pbcopy', args: [] },
      // Linux X11
      { cmd: 'xclip', args: ['-selection', 'clipboard'] },
      { cmd: 'xsel', args: ['--clipboard', '--input'] },
      // Linux Wayland
      { cmd: 'wl-copy', args: [] },
      // WSL2 (Windows clipboard)
      { cmd: 'clip.exe', args: [] },
    ];

    // Try each command asynchronously
    this._tryClipboardCommands(commands, text);
  }

  private async _tryClipboardCommands(
    commands: Array<{ cmd: string; args: string[] }>,
    text: string
  ): Promise<void> {
    let permissionDenied = false;
    for (const { cmd, args } of commands) {
      try {
        const process = new Command(cmd, {
          args,
          stdin: 'piped',
          stdout: 'null',
          stderr: 'null',
        });
        const child = process.spawn();
        const writer = child.stdin.getWriter();
        await writer.write(new TextEncoder().encode(text));
        await writer.close();
        const status = await child.status;
        if (status.success) {
          logger.info("copied " + text.length + " chars to clipboard using " + cmd);
          getToastManager().show(`Copied ${text.length} chars to clipboard`, { type: 'success', duration: 2000 });
          return; // Success
        }
      } catch (e) {
        // NotCapable = missing permission, warn user; other errors just debug
        if (isPermissionError(e)) {
          logger.warn(`Clipboard command '${cmd}' not permitted: ${e instanceof Error ? e.message : String(e)}`);
          permissionDenied = true;
        } else {
          logger.debug(`Clipboard command '${cmd}' failed: ${e}`);
        }
        // Try next command
      }
    }
    if (permissionDenied) {
      logger.warn('Clipboard copy failed - permission denied (add clipboard: true to policy or run with --allow-clipboard)');
      getToastManager().show('Clipboard copy failed - add clipboard: true to policy', { type: 'error', duration: 4000 });
    } else {
      logger.warn('No clipboard command available (tried pbcopy, xclip, xsel, wl-copy, clip.exe)');
      getToastManager().show('Clipboard copy failed - no clipboard command available', { type: 'error', duration: 4000 });
    }
  }

  /**
   * Get current text selection (for external access)
   */
  getTextSelection(): TextSelection {
    return { ...this._textSelection };
  }

  /**
   * Handle tooltip display for hovered element
   */
  private _handleTooltip(hoveredElement: Element | null | undefined, screenX: number, screenY: number): void {
    const tooltipManager = getTooltipManager();

    if (!hoveredElement) {
      tooltipManager.hideTooltip();
      return;
    }

    // Check if element has tooltip prop or onTooltip handler
    const tooltipProp = hoveredElement.props?.tooltip;
    const hasTooltip = tooltipProp !== undefined;
    const hasTooltipHandler = typeof hoveredElement.props?.onTooltip === 'function';
    const isAutoTooltip = tooltipProp === 'auto';

    if (!hasTooltip && !hasTooltipHandler) {
      tooltipManager.hideTooltip();
      return;
    }

    // Get element bounds
    const bounds = hoveredElement.getBounds();
    if (!bounds) {
      tooltipManager.hideTooltip();
      return;
    }

    // Calculate relative coordinates
    const relX = screenX - bounds.x;
    const relY = screenY - bounds.y;

    // Get component-specific context if available
    const tooltipProvider = hoveredElement as unknown as TooltipProvider;
    const context = tooltipProvider.getTooltipContext?.(relX, relY);

    // Get tooltip content
    if (hasTooltipHandler) {
      // Build tooltip event for handler
      const tooltipEvent = TooltipManager.buildEvent(
        hoveredElement,
        screenX,
        screenY,
        bounds,
        context
      );
      // Handlers are wrapped as async functions, so we need to handle the Promise
      const result = hoveredElement.props.onTooltip(tooltipEvent);
      if (result instanceof Promise) {
        result.then((content: string | undefined) => {
          if (content) {
            tooltipManager.scheduleTooltip(hoveredElement, content, screenX, screenY, bounds);
          } else {
            tooltipManager.hideTooltip();
          }
        }).catch(() => {
          tooltipManager.hideTooltip();
        });
      } else if (result) {
        // Synchronous result (shouldn't happen but handle it)
        tooltipManager.scheduleTooltip(hoveredElement, result as string, screenX, screenY, bounds);
      } else {
        tooltipManager.hideTooltip();
      }
    } else if (isAutoTooltip) {
      // Use component's default tooltip formatter
      if (context && tooltipProvider.getDefaultTooltip) {
        const content = tooltipProvider.getDefaultTooltip(context);
        if (content) {
          tooltipManager.scheduleTooltip(hoveredElement, content, screenX, screenY, bounds);
        } else {
          tooltipManager.hideTooltip();
        }
      } else if (typeof (hoveredElement as any).getValue === 'function') {
        // Fallback: use getValue() for components without TooltipProvider
        const value = (hoveredElement as any).getValue();
        if (value !== undefined && value !== null) {
          const content = String(value);
          if (content) {
            tooltipManager.scheduleTooltip(hoveredElement, content, screenX, screenY, bounds);
          } else {
            tooltipManager.hideTooltip();
          }
        } else {
          tooltipManager.hideTooltip();
        }
      } else {
        tooltipManager.hideTooltip();
      }
    } else if (hasTooltip) {
      tooltipManager.scheduleTooltip(hoveredElement, tooltipProp, screenX, screenY, bounds);
    } else {
      tooltipManager.hideTooltip();
    }
  }

  /**
   * Get the ID of the currently hovered element
   */
  getHoveredElementId(): string | null {
    return this._hoveredElementId;
  }

  /**
   * Check if currently selecting
   */
  isSelecting(): boolean {
    return this._isSelecting;
  }

  /**
   * Render optimized output to terminal (called by engine after selection render)
   * Returns the render detailed stats for terminal output timing
   */
  getRenderDetailedStats() {
    return this._renderDetailedStats;
  }

  /**
   * Update terminal output timing stat
   */
  addTerminalOutputTime(time: number): void {
    this._renderDetailedStats.terminalOutputTotal += time;
  }

  /**
   * Reset all selection state and cancel pending timers
   * Called during engine cleanup/stop
   */
  cleanup(): void {
    // Cancel any pending throttled selection render
    this._throttledSelectionRender.cancel();

    // Clean up focus tooltip listeners
    if (this._focusTooltipCleanup) {
      this._focusTooltipCleanup();
      this._focusTooltipCleanup = null;
    }

    // Clear selection state
    this._clearSelection();
    this._hoveredElementId = null;
    this._focusedElementId = null;
    this._lastClickTime = 0;
    this._lastClickPos = { x: -1, y: -1 };
    this._clickCount = 0;
  }
}
