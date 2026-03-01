// Basic Rendering Engine for converting elements to terminal output
// Integrates the element system with the dual-buffer rendering system

import { Element, Style, Bounds, LayoutProps, ComponentRenderContext, TextSelection, isRenderable, getBorderChars, type BorderStyle, type PackedRGBA, isScrollableType, isScrollingEnabled, getOverflowAxis, type Overlay, hasSelectableText, hasSelectionHighlightBounds } from './types.ts';
import { setGlobalRequestRender, getGlobalLogger } from './global-accessors.ts';
import { clipBounds, clamp } from './geometry.ts';
import { DualBuffer, Cell, EMPTY_CHAR } from './buffer.ts';
import { Viewport, ViewportManager, globalViewportManager, CoordinateTransform } from './viewport.ts';
import { ViewportDualBuffer, createClipViewport } from './viewport-buffer.ts';
import { ContainerElement } from './components/container.ts';
import { DialogElement } from './components/dialog.ts';
import { SizingModel, globalSizingModel, ChromeCollapseState } from './sizing.ts';
import { LayoutEngine, LayoutNode, LayoutContext, globalLayoutEngine } from './layout.ts';
import { getThemeColor, getThemeManager } from './theme.ts';
import { COLORS, parseColor, unpackRGBA, packRGBA } from './components/color-utils.ts';
import { SRGB_TO_LINEAR, linearToSrgb } from './color/oklab.ts';
import { ContentMeasurer, globalContentMeasurer } from './content-measurer.ts';
import { getLogger } from './logging.ts';
import { ensureError } from './utils/error.ts';
import type { Stylesheet, StyleContext } from './stylesheet.ts';
import { getGlobalErrorHandler, renderErrorPlaceholder } from './error-boundary.ts';
import { getGlobalPerformanceDialog } from './performance-dialog.ts';
import { MelkerConfig } from './config/mod.ts';
import { parseDimension } from './utils/dimensions.ts';
import { getUnicodeTier } from './utils/terminal-detection.ts';

const renderLogger = getLogger('RenderEngine');
const TABLE_TYPES = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']);

export interface RenderContext {
  buffer: DualBuffer;
  viewport: Bounds;
  parentBounds?: Bounds;
  clipRect?: Bounds;
  parentStyle?: Style;
  focusedElementId?: string;
  hoveredElementId?: string;
  textSelection?: TextSelection;
  requestRender?: () => void;  // Callback for components to request a re-render
  requestCachedRender?: () => void;  // Callback for cached-layout render (skips layout recalculation)
  // New viewport-based properties
  viewportManager?: ViewportManager;
  elementViewport?: Viewport;
  // Scroll offset from parent scrollable container (for click coordinate translation)
  scrollOffset?: { x: number; y: number };
  // Cumulative scroll offset for rendering (applied to node bounds on-the-fly)
  renderScrollX?: number;
  renderScrollY?: number;
  // Overlay collection for dropdown menus, tooltips, etc.
  overlays?: Overlay[];
}

export type { LayoutNode } from './layout.ts';

// Scrollbar bounds for hit testing and drag handling
export interface ScrollbarBounds {
  vertical?: {
    track: Bounds;
    thumb: Bounds;
    contentHeight: number;
    viewportHeight: number;
  };
  horizontal?: {
    track: Bounds;
    thumb: Bounds;
    contentWidth: number;
    viewportWidth: number;
  };
}

export class RenderingEngine {
  private _getDefaultStyle(): Style {
    return {
      color: getThemeColor('textPrimary'),
      backgroundColor: getThemeColor('background'),
      fontWeight: 'normal',
      fontStyle: 'normal',
      textDecoration: 'none',
      border: 'none',
      borderColor: getThemeColor('border'),
      padding: 0,
      margin: 0,
      boxSizing: 'border-box',
    };
  }

  private _sizingModel: SizingModel;
  private _layoutEngine: LayoutEngine;
  private _viewportManager: ViewportManager;
  private _currentLayoutContext?: Map<string, LayoutNode>;
  // Track cumulative scroll offset for each element (for connector bounds adjustment)
  private _scrollOffsets?: Map<string, { x: number; y: number }>;
  // Dynamically registered element bounds (for components that render children internally like tables)
  private _dynamicBounds?: Map<string, Bounds>;
  // Cache for selection-only renders
  private _cachedLayoutTree?: LayoutNode;
  private _cachedElement?: Element;
  private _cachedViewport?: Bounds;
  // Cache for modal layouts (avoids recalculating on every render)
  private _cachedModalLayouts: Map<Element, { bounds: Bounds; layouts: LayoutNode[] }> = new Map();
  // Scrollbar bounds for drag handling
  private _scrollbarBounds: Map<string, ScrollbarBounds> = new Map();
  // Per-frame cache for scroll content dimensions
  private _scrollDimensionsCache: Map<string, { width: number; height: number }> = new Map();
  // Document reference for element lookup
  private _document?: { getElementById(id: string): Element | undefined; stylesheets?: readonly Stylesheet[] };
  // Per-render container query config (set at start of render, used by modal layout)
  private _containerQueryStylesheets?: readonly Stylesheet[];
  private _containerQueryStyleContext?: StyleContext;

  constructor(options: {
    sizingModel?: SizingModel;
    layoutEngine?: LayoutEngine;
    viewportManager?: ViewportManager;
  } = {}) {
    this._sizingModel = options.sizingModel || globalSizingModel;
    this._layoutEngine = options.layoutEngine || globalLayoutEngine;
    this._viewportManager = options.viewportManager || globalViewportManager;
  }

  // Set document reference for element lookup (needed for tbody bounds)
  setDocument(document: { getElementById(id: string): Element | undefined; stylesheets?: readonly Stylesheet[] }): void {
    this._document = document;
  }

  /**
   * Find element bounds from cached layout tree (for fast rendering)
   */
  findElementBounds(elementId: string): Bounds | null {
    if (!this._cachedLayoutTree) return null;
    return this._findBoundsInTree(elementId, this._cachedLayoutTree);
  }

  private _findBoundsInTree(elementId: string, node: LayoutNode): Bounds | null {
    if (node.element?.id === elementId) {
      return node.bounds;
    }
    for (const child of node.children || []) {
      const found = this._findBoundsInTree(elementId, child);
      if (found) return found;
    }
    return null;
  }

  /**
   * Find the cumulative scroll offset for an element from all scrollable parent containers
   */
  private _findScrollOffset(elementId: string): { x: number; y: number } {
    if (!this._cachedLayoutTree) return { x: 0, y: 0 };
    const result = { x: 0, y: 0 };
    this._accumulateScrollOffset(elementId, this._cachedLayoutTree, result);
    return result;
  }

  private _accumulateScrollOffset(
    elementId: string,
    node: LayoutNode,
    result: { x: number; y: number },
    parentScrollX = 0,
    parentScrollY = 0
  ): boolean {
    // Check if this node is the target element
    if (node.element?.id === elementId) {
      result.x = parentScrollX;
      result.y = parentScrollY;
      return true;
    }

    // Calculate scroll offset if this is a scrollable container
    let scrollX = parentScrollX;
    let scrollY = parentScrollY;
    if (node.element && isScrollableType(node.element.type) && isScrollingEnabled(node.element)) {
      scrollX += (node.element.props.scrollX as number) || 0;
      scrollY += (node.element.props.scrollY as number) || 0;
    }

    // Recurse into children
    for (const child of node.children || []) {
      if (this._accumulateScrollOffset(elementId, child, result, scrollX, scrollY)) {
        return true;
      }
    }
    return false;
  }

  // Collected overlays for the current render pass
  private _overlays: Overlay[] = [];

  // Main render method that takes an element tree and renders to a buffer
  render(element: Element, buffer: DualBuffer, viewport: Bounds, focusedElementId?: string, textSelection?: TextSelection, hoveredElementId?: string, requestRender?: () => void, requestCachedRender?: () => void): LayoutNode {
    // Store requestRender globally so components can access it even if not passed through context
    if (requestRender) {
      setGlobalRequestRender(requestRender);
    }

    // Clear per-frame caches
    this._scrollbarBounds.clear();
    this._scrollDimensionsCache.clear();

    // Clear overlays for fresh render
    this._overlays = [];
    // Note: Modal layout cache is NOT cleared here - it invalidates based on bounds changes

    const context: RenderContext = {
      buffer,
      viewport,
      focusedElementId,
      hoveredElementId,
      textSelection,
      requestRender,
      requestCachedRender,
      viewportManager: this._viewportManager,
      overlays: this._overlays,
    };

    // Use advanced layout engine — check for container query and pseudo-class rules
    const stylesheets = this._document?.stylesheets;
    const hasContainerRules = stylesheets?.some(ss => ss.hasContainerRules);
    const hasPseudoRules = stylesheets?.some(ss => ss.hasPseudoClassRules);
    const needStylesheets = hasContainerRules || hasPseudoRules;
    if (needStylesheets) {
      this._containerQueryStylesheets = stylesheets;
      this._containerQueryStyleContext = { terminalWidth: viewport.width, terminalHeight: viewport.height };
    } else {
      this._containerQueryStylesheets = undefined;
      this._containerQueryStyleContext = undefined;
    }
    const layoutContext: LayoutContext = {
      viewport,
      parentBounds: viewport,
      availableSpace: { width: viewport.width, height: viewport.height },
      focusedElementId,
      hoveredElementId,
      ...(needStylesheets ? {
        stylesheets,
        styleContext: this._containerQueryStyleContext,
      } : undefined),
    };
    const advancedLayoutTree = this._layoutEngine.calculateLayout(element, layoutContext);
    const layoutTree = advancedLayoutTree;
    getGlobalPerformanceDialog().markLayoutEnd();

    // Build layout context map for scroll calculations
    this._currentLayoutContext = new Map();
    this._scrollOffsets = new Map();
    this._dynamicBounds = new Map();
    this._cachedModalLayouts.clear();
    this._buildLayoutContext(layoutTree, this._currentLayoutContext);

    // Collect all modal dialogs for separate rendering
    const modals: Element[] = [];
    this._collectModals(element, modals);

    // Render normal content first
    this._renderNode(layoutTree, context);

    // Render overlays (dropdowns, tooltips) after normal content but before modals
    this._renderOverlays(buffer, viewport);

    // Apply low-contrast effect if there's a modal without backdrop (fullcolor theme only)
    const themeManager = getThemeManager();
    const theme = themeManager.getCurrentTheme();
    if (theme.type === 'fullcolor') {
      const hasModalWithoutBackdrop = modals.some(modal =>
        modal instanceof DialogElement &&
        modal.props.open &&
        modal.props.modal === true &&
        modal.props.backdrop === false
      );
      if (hasModalWithoutBackdrop) {
        buffer.currentBuffer.applyLowContrastEffect(theme.mode === 'dark');
      }
    }

    // Render modals on top with full viewport access
    for (const modal of modals) {
      if (modal instanceof DialogElement && modal.props.open) {
        // First render the dialog backdrop and frame
        const modalStyle = this._computeStyle(modal.props.style || {});
        const modalCellStyle = this._styleToCellStyle(modalStyle);
        const componentContext: ComponentRenderContext = {
          focusedElementId: context.focusedElementId,
          hoveredElementId: context.hoveredElementId,
          requestRender: context.requestRender,
          buffer,
          style: modalCellStyle,
          getElementBounds: (elementId: string) => {
            const dynamicBounds = this._dynamicBounds?.get(elementId);
            if (dynamicBounds) return dynamicBounds;
            const layoutBounds = this._currentLayoutContext?.get(elementId)?.bounds;
            if (!layoutBounds) return undefined;
            const scrollOffset = this._scrollOffsets?.get(elementId);
            if (!scrollOffset || (scrollOffset.x === 0 && scrollOffset.y === 0)) {
              return layoutBounds;
            }
            return {
              x: layoutBounds.x - scrollOffset.x,
              y: layoutBounds.y - scrollOffset.y,
              width: layoutBounds.width,
              height: layoutBounds.height,
            };
          },
          registerElementBounds: (elementId: string, elementBounds: Bounds) => {
            if (!this._dynamicBounds) {
              this._dynamicBounds = new Map();
            }
            this._dynamicBounds.set(elementId, elementBounds);
          },
        };
        modal.render(viewport, modalCellStyle, buffer, componentContext);

        // Then render the children using the normal layout system
        if (modal.children && modal.children.length > 0) {
          // Calculate dialog content area (inside the dialog borders)
          // Use parseDimension for consistent handling of numbers, percentages, "fill"
          const defaultWidth = Math.min(Math.floor(viewport.width * 0.8), 60);
          const defaultHeight = Math.min(Math.floor(viewport.height * 0.7), 20);
          const dialogWidth = Math.min(
            parseDimension(modal.props.width, viewport.width, defaultWidth),
            viewport.width - 4
          );
          const dialogHeight = Math.min(
            parseDimension(modal.props.height, viewport.height, defaultHeight),
            viewport.height - 4
          );

          // Apply drag offset to centered position
          const offsetX = modal.props.offsetX || 0;
          const offsetY = modal.props.offsetY || 0;
          const dialogX = Math.floor((viewport.width - dialogWidth) / 2) + offsetX;
          const dialogY = Math.floor((viewport.height - dialogHeight) / 2) + offsetY;

          // Content area (inside borders and title)
          const titleHeight = modal.props.title ? 3 : 1; // Title + separator or just border
          const contentBounds = {
            x: viewport.x + dialogX + 1,  // Inside left border
            y: viewport.y + dialogY + titleHeight,  // Below title
            width: dialogWidth - 2,      // Inside borders
            height: dialogHeight - titleHeight - 1  // Above bottom border
          };

          // Lay out dialog children collectively as a flex column.
          // Temporarily clear width/height from props and style so the layout
          // engine uses contentBounds (the area inside borders/title) rather
          // than the dialog's own declared dimensions.
          const savedWidth = modal.props.width;
          const savedHeight = modal.props.height;
          const savedStyleWidth = modal.props.style?.width;
          const savedStyleHeight = modal.props.style?.height;
          modal.props.width = undefined;
          modal.props.height = undefined;
          if (modal.props.style) {
            modal.props.style.width = undefined;
            modal.props.style.height = undefined;
          }
          const dialogLayoutContext: LayoutContext = {
            viewport: contentBounds,
            parentBounds: contentBounds,
            availableSpace: { width: contentBounds.width, height: contentBounds.height },
            focusedElementId,
            hoveredElementId,
            ...(this._containerQueryStylesheets ? {
              stylesheets: this._containerQueryStylesheets,
              styleContext: this._containerQueryStyleContext,
            } : undefined),
          };
          const dialogLayout = this._layoutEngine.calculateLayout(modal, dialogLayoutContext);
          modal.props.width = savedWidth;
          modal.props.height = savedHeight;
          if (modal.props.style) {
            modal.props.style.width = savedStyleWidth;
            modal.props.style.height = savedStyleHeight;
          }

          for (const childLayoutNode of dialogLayout.children) {
            if (this._currentLayoutContext) {
              this._buildLayoutContext(childLayoutNode, this._currentLayoutContext);
            }

            const childContext = {
              buffer,
              viewport: contentBounds,
              parentBounds: contentBounds,
              focusedElementId: context.focusedElementId,
              hoveredElementId: context.hoveredElementId
            };

            this._renderNode(childLayoutNode, childContext);
          }
        }
      }
    }

    // Render overlays registered by modal children (e.g. combobox dropdowns inside dialogs)
    this._renderOverlays(buffer, viewport);

    // Apply text selection highlighting AFTER modals so it's visible in dialogs
    if (context.textSelection?.isActive) {
      this._applySelectionHighlight(context.textSelection, buffer);
    }

    // Cache layout tree for selection-only updates
    this._cachedLayoutTree = layoutTree;
    this._cachedElement = element;
    this._cachedViewport = viewport;
    getGlobalPerformanceDialog().markBufferEnd();

    return layoutTree;
  }

  // Selection-only render - skips layout calculation, reuses cached layout
  // Timing stats for selection rendering (updated each call, logged by engine)
  public selectionRenderTiming = {
    renderNodeTime: 0,
    highlightTime: 0,
    overlaysTime: 0,
    modalsTime: 0,
  };

  renderSelectionOnly(buffer: DualBuffer, textSelection: TextSelection, focusedElementId?: string, hoveredElementId?: string, requestRender?: () => void): boolean {
    if (!this._cachedLayoutTree || !this._cachedElement || !this._cachedViewport) {
      return false; // No cached layout, need full render
    }

    // Store requestRender globally so components can access it even if not passed through context
    if (requestRender) {
      setGlobalRequestRender(requestRender);
    }

    // Reset timing for this render
    this.selectionRenderTiming = { renderNodeTime: 0, highlightTime: 0, overlaysTime: 0, modalsTime: 0 };

    const context: RenderContext = {
      buffer,
      viewport: this._cachedViewport,
      focusedElementId,
      hoveredElementId,
      textSelection,
      requestRender,
      viewportManager: this._viewportManager,
    };

    // Collect modals
    const modals: Element[] = [];
    this._collectModals(this._cachedElement, modals);

    // Render content using cached layout (no layout recalculation)
    const renderNodeStart = performance.now();
    this._renderNode(this._cachedLayoutTree, context);
    this.selectionRenderTiming.renderNodeTime = performance.now() - renderNodeStart;

    // Apply low-contrast effect if there's a modal without backdrop (fullcolor theme only)
    const themeManager = getThemeManager();
    const theme = themeManager.getCurrentTheme();
    if (theme.type === 'fullcolor') {
      const hasModalWithoutBackdrop = modals.some(modal =>
        modal instanceof DialogElement &&
        (modal as any).props?.open &&
        (modal as any).props?.modal === true &&
        (modal as any).props?.backdrop === false
      );
      if (hasModalWithoutBackdrop) {
        buffer.currentBuffer.applyLowContrastEffect(theme.mode === 'dark');
      }
    }

    // Render modals on top
    const modalsStart = performance.now();
    for (const modal of modals) {
      if ((modal as any).props?.open) {
        this._renderModal(modal, context);
      }
    }
    this.selectionRenderTiming.modalsTime = performance.now() - modalsStart;

    // Apply selection highlighting AFTER modals so it's visible in dialogs
    if (textSelection?.isActive) {
      const highlightStart = performance.now();
      this._applySelectionHighlight(textSelection, buffer);
      this.selectionRenderTiming.highlightTime = performance.now() - highlightStart;
    }

    return true;
  }

  // Canvas-only render - skips layout calculation, reuses cached layout tree.
  // Used when only canvas pixel data changed (shader frames) and nothing layout-affecting has changed.
  renderCachedLayout(buffer: DualBuffer, focusedElementId?: string, textSelection?: TextSelection, hoveredElementId?: string, requestRender?: () => void): boolean {
    if (!this._cachedLayoutTree || !this._cachedElement || !this._cachedViewport) {
      return false; // No cached layout, need full render
    }

    // Store requestRender globally so components can access it even if not passed through context
    if (requestRender) {
      setGlobalRequestRender(requestRender);
    }

    // Clear per-frame caches
    this._scrollbarBounds.clear();
    this._scrollDimensionsCache.clear();
    this._overlays = [];

    const viewport = this._cachedViewport;

    const context: RenderContext = {
      buffer,
      viewport,
      focusedElementId,
      hoveredElementId,
      textSelection,
      requestRender,
      viewportManager: this._viewportManager,
      overlays: this._overlays,
    };

    // Re-render content using cached layout (no layout recalculation)
    this._renderNode(this._cachedLayoutTree, context);

    // Render overlays (dropdowns, tooltips)
    this._renderOverlays(buffer, viewport);

    // Collect modals
    const modals: Element[] = [];
    this._collectModals(this._cachedElement, modals);

    // Apply low-contrast effect if there's a modal without backdrop (fullcolor theme only)
    const themeManager = getThemeManager();
    const theme = themeManager.getCurrentTheme();
    if (theme.type === 'fullcolor') {
      const hasModalWithoutBackdrop = modals.some(modal =>
        modal instanceof DialogElement &&
        modal.props.open &&
        modal.props.modal === true &&
        modal.props.backdrop === false
      );
      if (hasModalWithoutBackdrop) {
        buffer.currentBuffer.applyLowContrastEffect(theme.mode === 'dark');
      }
    }

    // Render modals on top
    for (const modal of modals) {
      if (modal instanceof DialogElement && modal.props.open) {
        this._renderModal(modal, context);
      }
    }

    // Render overlays registered by modal children (e.g. combobox dropdowns inside dialogs)
    this._renderOverlays(buffer, viewport);

    // Apply text selection highlighting AFTER modals so it's visible in dialogs
    if (textSelection?.isActive) {
      this._applySelectionHighlight(textSelection, buffer);
    }

    getGlobalPerformanceDialog().markBufferEnd();
    return true;
  }

  // Dialog-only render - re-renders main content from cache, then modals at new position
  // Used during dialog drag/resize - skips layout calculation, uses cached layout tree
  renderDialogOnly(buffer: DualBuffer, focusedElementId?: string, hoveredElementId?: string, requestRender?: () => void): boolean {
    if (!this._cachedLayoutTree || !this._cachedElement || !this._cachedViewport) {
      return false; // No cached layout, need full render
    }

    // Clear buffer for fresh render
    buffer.clear();

    // Store requestRender globally
    if (requestRender) {
      setGlobalRequestRender(requestRender);
    }

    const context: RenderContext = {
      buffer,
      viewport: this._cachedViewport,
      focusedElementId,
      hoveredElementId,
      requestRender,
      viewportManager: this._viewportManager,
    };

    // Re-render main content using cached layout (no layout recalculation)
    this._renderNode(this._cachedLayoutTree, context);

    // Render overlays
    this._renderOverlays(buffer, this._cachedViewport);

    // Collect modals
    const modals: Element[] = [];
    this._collectModals(this._cachedElement, modals);

    // Apply low-contrast effect if there's a modal without backdrop (fullcolor theme only)
    const themeManager = getThemeManager();
    const theme = themeManager.getCurrentTheme();
    if (theme.type === 'fullcolor') {
      const hasModalWithoutBackdrop = modals.some(modal =>
        modal instanceof DialogElement &&
        (modal as DialogElement).props.open &&
        (modal as DialogElement).props.modal === true &&
        (modal as DialogElement).props.backdrop === false
      );
      if (hasModalWithoutBackdrop) {
        buffer.currentBuffer.applyLowContrastEffect(theme.mode === 'dark');
      }
    }

    // Render modals at their new positions
    for (const modal of modals) {
      if ((modal as any).props?.open) {
        this._renderModal(modal, context);
      }
    }

    // Render overlays registered by modal children (e.g. combobox dropdowns inside dialogs)
    this._renderOverlays(buffer, this._cachedViewport);

    return true;
  }

  // Extract text from selection (public method for deferred extraction)
  extractSelectionText(selection: TextSelection, buffer: DualBuffer): string {
    // Check if the selected component provides custom selectable text
    if (selection.componentId && this._document) {
      const element = this._document.getElementById(selection.componentId);
      if (element && hasSelectableText(element)) {
        // Calculate selection bounds relative to component
        const { start, end, componentBounds } = selection;
        if (componentBounds) {
          const x1 = Math.min(start.x, end.x) - componentBounds.x;
          const x2 = Math.max(start.x, end.x) - componentBounds.x;
          const y1 = Math.min(start.y, end.y) - componentBounds.y;
          const y2 = Math.max(start.y, end.y) - componentBounds.y;
          return element.getSelectableText({ startX: x1, endX: x2, startY: y1, endY: y2 });
        }
        return element.getSelectableText();
      }
    }
    return this._extractTextFromBuffer(selection, buffer);
  }

  // Extract text from buffer for selection (uses previousBuffer - the displayed frame)
  private _extractTextFromBuffer(selection: TextSelection, buffer: DualBuffer): string {
    const { start, end, componentBounds, mode } = selection;
    // Use previousBuffer as it contains the last rendered (displayed) frame
    const termBuffer = buffer.previousBuffer;

    let selectedText = '';

    if (mode === 'global') {
      // Global mode: strict rectangular selection
      const x1 = Math.min(start.x, end.x);
      const y1 = Math.min(start.y, end.y);
      const x2 = Math.max(start.x, end.x);
      const y2 = Math.max(start.y, end.y);

      for (let y = y1; y <= y2; y++) {
        let lineText = '';
        for (let x = x1; x <= x2; x++) {
          const cell = termBuffer.getCell(x, y);
          if (cell && cell.char) {
            lineText += cell.char;
          }
        }
        selectedText += lineText.trimEnd();
        if (y < y2) selectedText += '\n';
      }
    } else {
      // Component mode: text-editor style flow selection
      const isStartBeforeEnd = (start.y < end.y) || (start.y === end.y && start.x <= end.x);
      const firstPos = isStartBeforeEnd ? start : end;
      const lastPos = isStartBeforeEnd ? end : start;

      const boundsLeft = componentBounds?.x ?? 0;
      const boundsRight = componentBounds ? componentBounds.x + componentBounds.width - 1 : termBuffer.width - 1;

      for (let y = firstPos.y; y <= lastPos.y; y++) {
        let lineStartX: number;
        let lineEndX: number;

        if (firstPos.y === lastPos.y) {
          // Single line selection
          lineStartX = firstPos.x;
          lineEndX = lastPos.x;
        } else if (y === firstPos.y) {
          // First line: from click position to end of line
          lineStartX = firstPos.x;
          lineEndX = boundsRight;
        } else if (y === lastPos.y) {
          // Last line: from start of line to mouse position
          lineStartX = boundsLeft;
          lineEndX = lastPos.x;
        } else {
          // Middle lines: full width
          lineStartX = boundsLeft;
          lineEndX = boundsRight;
        }

        let lineText = '';
        for (let x = lineStartX; x <= lineEndX; x++) {
          const cell = termBuffer.getCell(x, y);
          if (cell && cell.char) {
            lineText += cell.char;
          }
        }
        selectedText += lineText.trimEnd();
        if (y < lastPos.y) selectedText += '\n';
      }
    }

    return selectedText.trim();
  }

  // Apply text selection highlighting with inverted colors
  private _applySelectionHighlight(selection: TextSelection, buffer: DualBuffer): void {
    if (!selection.isActive) return;

    const { start, end, componentBounds, mode, componentId } = selection;

    if (mode === 'global') {
      // Global mode: strict rectangular selection
      const x1 = Math.min(start.x, end.x);
      const y1 = Math.min(start.y, end.y);
      const x2 = Math.max(start.x, end.x);
      const y2 = Math.max(start.y, end.y);

      for (let y = y1; y <= y2; y++) {
        for (let x = x1; x <= x2; x++) {
          this._highlightCell(buffer, x, y);
        }
      }
    } else {
      // Component mode: text-editor style flow selection
      // Determine which position comes first in reading order
      const isStartBeforeEnd = (start.y < end.y) || (start.y === end.y && start.x <= end.x);
      const firstPos = isStartBeforeEnd ? start : end;
      const lastPos = isStartBeforeEnd ? end : start;

      // Get scroll offset from parent scrollable containers
      const scrollOffset = componentId ? this._findScrollOffset(componentId) : { x: 0, y: 0 };

      // Adjust selection positions for scroll (subtract scroll offset to get screen position)
      const adjustedFirstPos = { x: firstPos.x - scrollOffset.x, y: firstPos.y - scrollOffset.y };
      const adjustedLastPos = { x: lastPos.x - scrollOffset.x, y: lastPos.y - scrollOffset.y };

      // Adjust component bounds for scroll
      const boundsLeft = (componentBounds?.x ?? 0) - scrollOffset.x;
      const boundsRight = componentBounds ? componentBounds.x + componentBounds.width - 1 - scrollOffset.x : buffer.currentBuffer.width - 1;
      const boundsTop = (componentBounds?.y ?? 0) - scrollOffset.y;
      const boundsBottom = componentBounds ? componentBounds.y + componentBounds.height - 1 - scrollOffset.y : buffer.currentBuffer.height - 1;

      // Check if component provides custom highlight bounds (e.g., segment display snapping to char boundaries)
      let alignedBounds: { startX: number; endX: number; startY?: number; endY?: number } | undefined;
      if (componentId && componentBounds && this._document) {
        const element = this._document.getElementById(componentId);
        if (element && hasSelectionHighlightBounds(element)) {
          // Convert screen coordinates to element-relative coordinates (use original relative positions)
          const relStartX = Math.min(firstPos.x, lastPos.x) - (componentBounds?.x ?? 0);
          const relEndX = Math.max(firstPos.x, lastPos.x) - (componentBounds?.x ?? 0);
          const relStartY = Math.min(firstPos.y, lastPos.y) - (componentBounds?.y ?? 0);
          const relEndY = Math.max(firstPos.y, lastPos.y) - (componentBounds?.y ?? 0);
          alignedBounds = element.getSelectionHighlightBounds(relStartX, relEndX, relStartY, relEndY);
        }
      }

      // If component provides aligned bounds, highlight within those bounds
      // Use Y bounds if provided (for row-based components like horizontal data-bars),
      // otherwise highlight entire component height (for column-based like segment displays)
      if (alignedBounds) {
        const lineStartX = boundsLeft + alignedBounds.startX;
        const lineEndX = boundsLeft + alignedBounds.endX;
        const highlightStartY = alignedBounds.startY !== undefined ? boundsTop + alignedBounds.startY : boundsTop;
        const highlightEndY = alignedBounds.endY !== undefined ? boundsTop + alignedBounds.endY : boundsBottom;
        for (let y = highlightStartY; y <= highlightEndY; y++) {
          for (let x = lineStartX; x <= lineEndX; x++) {
            this._highlightCell(buffer, x, y);
          }
        }
      } else {
        // Standard flow selection for text editors (use adjusted positions for scroll)
        for (let y = adjustedFirstPos.y; y <= adjustedLastPos.y; y++) {
          let lineStartX: number;
          let lineEndX: number;

          if (adjustedFirstPos.y === adjustedLastPos.y) {
            // Single line selection
            lineStartX = adjustedFirstPos.x;
            lineEndX = adjustedLastPos.x;
          } else if (y === adjustedFirstPos.y) {
            // First line: from click position to end of line
            lineStartX = adjustedFirstPos.x;
            lineEndX = boundsRight;
          } else if (y === adjustedLastPos.y) {
            // Last line: from start of line to mouse position
            lineStartX = boundsLeft;
            lineEndX = adjustedLastPos.x;
          } else {
            // Middle lines: full width
            lineStartX = boundsLeft;
            lineEndX = boundsRight;
          }

          for (let x = lineStartX; x <= lineEndX; x++) {
            this._highlightCell(buffer, x, y);
          }
        }
      }
    }
  }

  private _highlightCell(buffer: DualBuffer, x: number, y: number): void {
    const existingCell = buffer.currentBuffer.getCell(x, y);
    if (existingCell) {
      const highlightedCell: Cell = {
        ...existingCell,
        reverse: !existingCell.reverse,
      };
      buffer.currentBuffer.setCell(x, y, highlightedCell);
    }
  }

  // Compute style by merging element style with parent style
  private _computeStyle(elementStyle: Style, parentStyle?: Style): Style {
    return {
      ...this._getDefaultStyle(),
      ...parentStyle,
      ...elementStyle,
    };
  }

  // Convert Style to Partial<Cell> format for components
  // Style colors may be strings (ColorInput) - parse them to PackedRGBA
  /** Blend a color toward a background using opacity in linear light space. */
  private _blendOpacity(color: PackedRGBA, opacity: number, bgColor: PackedRGBA): PackedRGBA {
    const fg = unpackRGBA(color);
    const bg = unpackRGBA(bgColor);
    const invOpacity = 1 - opacity;
    return packRGBA(
      linearToSrgb(SRGB_TO_LINEAR[fg.r] * opacity + SRGB_TO_LINEAR[bg.r] * invOpacity),
      linearToSrgb(SRGB_TO_LINEAR[fg.g] * opacity + SRGB_TO_LINEAR[bg.g] * invOpacity),
      linearToSrgb(SRGB_TO_LINEAR[fg.b] * opacity + SRGB_TO_LINEAR[bg.b] * invOpacity),
    );
  }

  private _styleToCellStyle(style: Style, parentBgColor?: PackedRGBA): Partial<Cell> {
    const cellStyle: Partial<Cell> = {};

    if (style.color) {
      cellStyle.foreground = parseColor(style.color);
    }
    if (style.backgroundColor) {
      cellStyle.background = parseColor(style.backgroundColor);
    }
    if (style.fontWeight === 'bold') {
      cellStyle.bold = true;
    }

    const needsBlend = (style.opacity !== undefined && style.opacity < 1) ||
      (style.backgroundOpacity !== undefined && style.backgroundOpacity < 1);
    if (needsBlend) {
      const bg = parentBgColor ?? parseColor(getThemeColor('background')) ?? 0x000000FF;
      // Apply backgroundOpacity to bg first (before opacity applies to both)
      if (style.backgroundOpacity !== undefined && style.backgroundOpacity < 1 && cellStyle.background !== undefined) {
        cellStyle.background = this._blendOpacity(cellStyle.background, style.backgroundOpacity, bg);
      }
      // Apply opacity to both fg and bg
      if (style.opacity !== undefined && style.opacity < 1) {
        if (cellStyle.foreground !== undefined) {
          cellStyle.foreground = this._blendOpacity(cellStyle.foreground, style.opacity, bg);
        }
        if (cellStyle.background !== undefined) {
          cellStyle.background = this._blendOpacity(cellStyle.background, style.opacity, bg);
        }
      }
    }

    return cellStyle;
  }

  // Calculate automatic width based on content and style
  private _calculateAutoWidth(element: Element, style: Style): number {
    let contentWidth: number;

    if (element.type === 'text') {
      const props = element.props as { text: string };
      contentWidth = props.text ? props.text.length : 1;
    } else if (element.type === 'input') {
      const props = element.props as { placeholder?: string; value?: string };
      const displayText = props.value || props.placeholder || '';
      contentWidth = Math.max(displayText.length, 20); // Minimum 20 chars for input
    } else {
      contentWidth = 1; // Minimum content width
    }

    // Use sizing model to get the required size including padding, border, margin
    const requiredSize = this._sizingModel.calculateRequiredSize(
      { width: contentWidth, height: 1 },
      style
    );

    return requiredSize.width;
  }

  // Calculate automatic height based on content and style
  private _calculateAutoHeight(element: Element, style: Style): number {
    let contentHeight: number;

    if (element.type === 'text') {
      const props = element.props as { text: string; wrap?: boolean };
      if (props.wrap && props.text) {
        // Simple wrapping calculation - would need width context for accurate results
        contentHeight = Math.ceil(props.text.length / 20); // Assume 20 char width
      } else {
        contentHeight = 1;
      }
    } else if (element.type === 'input') {
      contentHeight = 1; // Text inputs are single line
    } else {
      contentHeight = 1; // Minimum content height
    }

    // Use sizing model to get the required size including padding, border, margin
    const requiredSize = this._sizingModel.calculateRequiredSize(
      { width: 1, height: contentHeight },
      style
    );

    return requiredSize.height;
  }

  // Get content bounds (inside padding/border) using sizing model
  private _getContentBounds(bounds: Bounds, style: Style, isScrollable?: boolean): Bounds {
    return this._sizingModel.calculateContentBounds(bounds, style, isScrollable).bounds;
  }


  // Render a layout node to the buffer
  private _renderNode(node: LayoutNode, context: RenderContext): void {
    // Debug: log visibility
    const gLogger = getGlobalLogger();

    if (!node.visible) return;

    // Skip effectively invisible elements
    if (node.computedStyle.opacity !== undefined && node.computedStyle.opacity < 0.05) return;

    try {
      this._renderNodeInternal(node, context);
    } catch (error) {
      const err = ensureError(error);
      const rsx = context.renderScrollX || 0;
      const rsy = context.renderScrollY || 0;
      const errorBounds = (rsx || rsy) ? {
        x: node.bounds.x - rsx, y: node.bounds.y - rsy,
        width: node.bounds.width, height: node.bounds.height,
      } : node.bounds;
      getGlobalErrorHandler().captureError(node.element, err, errorBounds);
      renderErrorPlaceholder(context.buffer as DualBuffer, errorBounds, node.element.type, err);
    }
  }

  // Internal render implementation
  private _renderNodeInternal(node: LayoutNode, context: RenderContext): void {
    const { element, computedStyle } = node;
    // Apply cumulative scroll offset to translate layout bounds to screen coordinates
    const rsx = context.renderScrollX || 0;
    const rsy = context.renderScrollY || 0;
    const bounds = (rsx || rsy) ? {
      x: node.bounds.x - rsx,
      y: node.bounds.y - rsy,
      width: node.bounds.width,
      height: node.bounds.height,
    } : node.bounds;

    // Debug: Log ALL node renders
    const gLogger = getGlobalLogger();

    // Skip dialog elements - they are rendered separately by _renderModal
    // to ensure proper layering and avoid double rendering
    if (element.type === 'dialog') {
      return;
    }

    // Apply simple bounds clipping for background and border rendering
    const clippedBounds = clipBounds(bounds, context.clipRect || context.viewport);

    // Debug: Log clipping issues
    if (element.type === 'text' && (clippedBounds.width <= 0 || clippedBounds.height <= 0)) {
      renderLogger.trace(`[CLIP-DEBUG] text element clipped out, id="${element.id || 'none'}", bounds=${JSON.stringify(bounds)}, clippedBounds=${JSON.stringify(clippedBounds)}, clipRect=${JSON.stringify(context.clipRect)}, viewport=${JSON.stringify(context.viewport)}`);
    }

    // Skip elements with no visible bounds, except connectors which draw based on connected elements
    if (clippedBounds.width <= 0 || clippedBounds.height <= 0) {
      if (element.type !== 'connector') {
        return;
      }
    }

    // Resolve parent background color for opacity blending (shared by background, border, content)
    const parentBg = context.parentStyle?.backgroundColor
      ? parseColor(context.parentStyle.backgroundColor)
      : undefined;

    // Render background
    this._renderBackground(clippedBounds, computedStyle, context.buffer, parentBg);

    // Render border (skip collapsed borders if chrome was collapsed due to insufficient space)
    // Pass original bounds, clipped bounds, and clip rect for proper border visibility checks
    const clipRect = context.clipRect || context.viewport;

    // Apply focus border color to containers with <command> children
    let borderStyle = computedStyle;
    const isCommandFocused = context.focusedElementId && element.id === context.focusedElementId
        && element.children?.some(c => c.type === 'command' && !c.props.disabled && !c.props.global);
    if (isCommandFocused) {
      const focusColor = getThemeColor('focusBorder');
      if (focusColor !== undefined && computedStyle.border && computedStyle.border !== 'none') {
        borderStyle = { ...computedStyle, borderColor: focusColor };
      }
    }

    this._renderBorder(bounds, clippedBounds, clipRect, borderStyle, context.buffer, node.chromeCollapse, parentBg);

    // Render content based on element type
    this._renderContent(element, bounds, computedStyle, context.buffer, context);

    // Skip children rendering for table elements - they handle their own child rendering
    if (TABLE_TYPES.has(element.type)) {
      return;
    }

    // Render children with scroll translation and clipping
    const isScrollable = isScrollableType(element.type) && isScrollingEnabled(element);
    const contentBounds = this._getContentBounds(clippedBounds, computedStyle, isScrollable);

    if (isScrollable) {
      // For scrollable containers, translate children rendering positions by scroll offset
      const scrollX = element.props.scrollX || 0;
      const scrollY = element.props.scrollY || 0;

      // Calculate content dimensions to determine if scrollbars are needed
      const contentDimensions = this.calculateScrollDimensions(element);

      // Resolve per-axis overflow to determine which scrollbars to show
      const { x: overflowX, y: overflowY } = getOverflowAxis(element);
      const allowVertical = overflowY === 'scroll' || overflowY === 'auto';
      const allowHorizontal = overflowX === 'scroll' || overflowX === 'auto';

      const needsVerticalScrollbar = allowVertical && contentDimensions.height > contentBounds.height;
      const needsHorizontalScrollbar = allowHorizontal && contentDimensions.width > contentBounds.width;

      // Reduce content bounds to reserve space for scrollbars
      const adjustedContentBounds = {
        ...contentBounds,
        width: needsVerticalScrollbar ? Math.max(1, contentBounds.width - 2) : contentBounds.width,  // Reserve 2 chars for scrollbar and spacing
        height: needsHorizontalScrollbar ? Math.max(1, contentBounds.height - 1) : contentBounds.height
      };

      // Build clip rect: expand on axes where overflow is 'visible' so content isn't clipped
      const clipRect = {
        x: overflowX === 'visible' ? 0 : adjustedContentBounds.x,
        y: overflowY === 'visible' ? 0 : adjustedContentBounds.y,
        width: overflowX === 'visible' ? 99999 : adjustedContentBounds.width,
        height: overflowY === 'visible' ? 99999 : adjustedContentBounds.height,
      };

      // Only apply scroll offset on axes that have scrolling enabled
      const effectiveScrollX = allowHorizontal ? scrollX : 0;
      const effectiveScrollY = allowVertical ? scrollY : 0;

      const childContext: RenderContext = {
        ...context,
        clipRect,
        parentBounds: adjustedContentBounds,
        parentStyle: computedStyle,
        scrollOffset: { x: effectiveScrollX, y: effectiveScrollY },
        renderScrollX: rsx + effectiveScrollX,
        renderScrollY: rsy + effectiveScrollY,
      };

      // Render children — scroll offset is applied on-the-fly via renderScrollX/Y
      for (const child of node.children) {
        this._renderNode(child, childContext);
      }

      // Render scroll bars AFTER children to ensure they appear on top
      // Use the main buffer for scrollbars as they need direct access to the buffer
      this._renderScrollbars(element, contentBounds, adjustedContentBounds, this._styleToCellStyle(computedStyle), context.buffer, context.focusedElementId);
    } else {
      // Normal container - no scroll translation
      const childContext: RenderContext = {
        ...context,
        clipRect: contentBounds,
        parentBounds: contentBounds,
        parentStyle: computedStyle,
      };

      for (const child of node.children) {
        this._renderNode(child, childContext);
      }
    }

    // Draw focus marker for containers with <command> children (after all children)
    if (isCommandFocused) {
      const focusColor = getThemeColor('focusBorder');
      if (focusColor !== undefined) {
        const mx = bounds.x + bounds.width - 1;
        const my = bounds.y;
        context.buffer.currentBuffer.setCell(mx, my, {
          char: '*',
          foreground: focusColor,
          background: parseColor(computedStyle.backgroundColor) || 0,
          bold: false,
          reverse: false,
          underline: false,
        });
      }
    }
  }

  // Render scroll bars for a scrollable container (called after children are rendered)
  private _renderScrollbars(element: Element, contentBounds: Bounds, adjustedContentBounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, focusedElementId?: string): void {
    if (!isScrollableType(element.type) || !isScrollingEnabled(element)) {
      return;
    }

    let { scrollX, scrollY } = element.props;

    // Calculate content dimensions - need to calculate without scroll effects
    const contentDimensions = this.calculateScrollDimensions(element);

    // Resolve per-axis overflow to determine which scrollbars to show
    const { x: overflowX, y: overflowY } = getOverflowAxis(element);
    const allowVertical = overflowY === 'scroll' || overflowY === 'auto';
    const allowHorizontal = overflowX === 'scroll' || overflowX === 'auto';

    // Check if scroll bars are needed (and allowed by overflow style)
    const needsVerticalScrollbar = allowVertical && contentDimensions.height > contentBounds.height;
    const needsHorizontalScrollbar = allowHorizontal && contentDimensions.width > contentBounds.width;

    // Validate and clamp scroll positions to prevent invalid scrolling
    // Ensure last content item is always reachable by being slightly more generous
    const maxScrollY = Math.max(0, contentDimensions.height - contentBounds.height + (contentBounds.height > 1 ? 1 : 0));
    const maxScrollX = Math.max(0, contentDimensions.width - contentBounds.width);

    // Clamp scroll values to valid ranges
    scrollY = clamp(scrollY || 0, 0, maxScrollY);
    scrollX = clamp(scrollX || 0, 0, maxScrollX);

    // Update the element's scroll properties if they were clamped
    if (scrollY !== element.props.scrollY) {
      element.props.scrollY = scrollY;
    }
    if (scrollX !== element.props.scrollX) {
      element.props.scrollX = scrollX;
    }

    // Initialize scrollbar bounds for this element
    const elementId = element.id || '';
    const scrollbarBoundsEntry: ScrollbarBounds = {};

    // Render vertical scrollbar in reserved space (not overlaying content)
    if (needsVerticalScrollbar) {
      const trackBounds = {
        x: contentBounds.x + adjustedContentBounds.width + 1, // +1 for spacing between content and scrollbar
        y: contentBounds.y,
        width: 1,
        height: adjustedContentBounds.height
      };

      // Calculate thumb bounds for hit testing
      const viewportRatio = adjustedContentBounds.height / contentDimensions.height;
      const thumbSize = clamp(Math.floor(viewportRatio * trackBounds.height), 1, trackBounds.height);
      const availableTrackSpace = Math.max(1, trackBounds.height - thumbSize);
      const scrollProgress = maxScrollY > 0 ? ((scrollY || 0) / maxScrollY) : 0;
      const thumbPosition = Math.min(availableTrackSpace, Math.floor(scrollProgress * availableTrackSpace));

      const thumbBounds = {
        x: trackBounds.x,
        y: trackBounds.y + thumbPosition,
        width: 1,
        height: thumbSize
      };

      scrollbarBoundsEntry.vertical = {
        track: trackBounds,
        thumb: thumbBounds,
        contentHeight: contentDimensions.height,
        viewportHeight: adjustedContentBounds.height
      };

      const focused = !!(focusedElementId && element.id === focusedElementId);
      this._renderVerticalScrollbar(trackBounds, scrollY || 0, contentDimensions.height, style, buffer, focused);
    }

    // Render horizontal scrollbar in reserved space (not overlaying content)
    if (needsHorizontalScrollbar) {
      const trackBounds = {
        x: contentBounds.x,
        y: contentBounds.y + adjustedContentBounds.height,
        width: adjustedContentBounds.width,
        height: 1
      };

      // Calculate thumb bounds for hit testing
      const viewportRatio = adjustedContentBounds.width / contentDimensions.width;
      const thumbSize = clamp(Math.floor(viewportRatio * trackBounds.width), 1, trackBounds.width);
      const availableTrackSpace = Math.max(1, trackBounds.width - thumbSize);
      const scrollProgress = maxScrollX > 0 ? ((scrollX || 0) / maxScrollX) : 0;
      const thumbPosition = Math.min(availableTrackSpace, Math.floor(scrollProgress * availableTrackSpace));

      const thumbBounds = {
        x: trackBounds.x + thumbPosition,
        y: trackBounds.y,
        width: thumbSize,
        height: 1
      };

      scrollbarBoundsEntry.horizontal = {
        track: trackBounds,
        thumb: thumbBounds,
        contentWidth: contentDimensions.width,
        viewportWidth: adjustedContentBounds.width
      };

      const hFocused = !!(focusedElementId && element.id === focusedElementId);
      this._renderHorizontalScrollbar(trackBounds, scrollX || 0, contentDimensions.width, style, buffer, hFocused);
    }

    // Store scrollbar bounds if any scrollbars were rendered
    if (elementId && (scrollbarBoundsEntry.vertical || scrollbarBoundsEntry.horizontal)) {
      this._scrollbarBounds.set(elementId, scrollbarBoundsEntry);
    }
  }


  // Render background color
  private _renderBackground(bounds: Bounds, style: Style, buffer: DualBuffer, parentBgColor?: PackedRGBA): void {
    if (!style.backgroundColor) return;

    let bgColor = parseColor(style.backgroundColor);
    if (bgColor === undefined) return;

    // Apply opacity blending
    const needsBlend = (style.opacity !== undefined && style.opacity < 1) ||
      (style.backgroundOpacity !== undefined && style.backgroundOpacity < 1);
    if (needsBlend) {
      const bg = parentBgColor ?? parseColor(getThemeColor('background')) ?? 0x000000FF;
      if (style.backgroundOpacity !== undefined && style.backgroundOpacity < 1) {
        bgColor = this._blendOpacity(bgColor, style.backgroundOpacity, bg);
      }
      if (style.opacity !== undefined && style.opacity < 1) {
        bgColor = this._blendOpacity(bgColor, style.opacity, bg);
      }
    }

    const cell: Cell = {
      char: EMPTY_CHAR,
      background: bgColor,
    };

    buffer.currentBuffer.fillRect(bounds.x, bounds.y, bounds.width, bounds.height, cell);
  }

  // Render border (supports individual sides and colors)
  // originalBounds: the element's actual bounds before clipping
  // clippedBounds: the bounds after clipping to the visible area
  // clipRect: the clipping rectangle (visible viewport)
  // chromeCollapse indicates which borders were collapsed due to insufficient space
  private _renderBorder(originalBounds: Bounds, clippedBounds: Bounds, clipRect: Bounds, style: Style, buffer: DualBuffer, chromeCollapse?: ChromeCollapseState, parentBgColor?: PackedRGBA): void {
    const defaultColor = style.borderColor || style.color;

    // Check for individual border sides first, fallback to general border
    let borderTop = style.borderTop || (style.border && style.border !== 'none' ? style.border : undefined);
    let borderBottom = style.borderBottom || (style.border && style.border !== 'none' ? style.border : undefined);
    let borderLeft = style.borderLeft || (style.border && style.border !== 'none' ? style.border : undefined);
    let borderRight = style.borderRight || (style.border && style.border !== 'none' ? style.border : undefined);

    // Skip collapsed borders
    if (chromeCollapse) {
      if (chromeCollapse.borderCollapsed.top) borderTop = undefined;
      if (chromeCollapse.borderCollapsed.bottom) borderBottom = undefined;
      if (chromeCollapse.borderCollapsed.left) borderLeft = undefined;
      if (chromeCollapse.borderCollapsed.right) borderRight = undefined;
    }

    // Calculate actual border positions from original bounds
    const topBorderY = originalBounds.y;
    const bottomBorderY = originalBounds.y + originalBounds.height - 1;
    const leftBorderX = originalBounds.x;
    const rightBorderX = originalBounds.x + originalBounds.width - 1;

    // Hide borders whose position is outside the visible clip rect
    // Use > (not >=) because clipRect width/height may be off-by-one for scroll containers
    if (topBorderY < clipRect.y || topBorderY > clipRect.y + clipRect.height) borderTop = undefined;
    if (bottomBorderY < clipRect.y || bottomBorderY > clipRect.y + clipRect.height) borderBottom = undefined;
    if (leftBorderX < clipRect.x || leftBorderX > clipRect.x + clipRect.width) borderLeft = undefined;
    if (rightBorderX < clipRect.x || rightBorderX > clipRect.x + clipRect.width) borderRight = undefined;

    // If no borders defined, exit
    if (!borderTop && !borderBottom && !borderLeft && !borderRight) return;

    // Parse colors only for borders that exist (avoid unnecessary parseColor calls)
    const parsedDefaultColor = parseColor(defaultColor);
    const parsedBgColor = parseColor(style.backgroundColor);
    const useBlockBorders = MelkerConfig.get().gfxMode === 'block';

    // Only parse per-side colors and create styles for borders that exist
    // In block mode, use foreground color as background (spaces need bg color to be visible)
    let topStyle!: Partial<Cell>;
    if (borderTop) {
      const c = parseColor(style.borderTopColor) || parsedDefaultColor;
      topStyle = useBlockBorders ? { background: c || parsedBgColor } : { foreground: c, background: parsedBgColor };
    }
    let bottomStyle!: Partial<Cell>;
    if (borderBottom) {
      const c = parseColor(style.borderBottomColor) || parsedDefaultColor;
      bottomStyle = useBlockBorders ? { background: c || parsedBgColor } : { foreground: c, background: parsedBgColor };
    }
    let leftStyle!: Partial<Cell>;
    if (borderLeft) {
      const c = parseColor(style.borderLeftColor) || parsedDefaultColor;
      leftStyle = useBlockBorders ? { background: c || parsedBgColor } : { foreground: c, background: parsedBgColor };
    }
    let rightStyle!: Partial<Cell>;
    if (borderRight) {
      const c = parseColor(style.borderRightColor) || parsedDefaultColor;
      rightStyle = useBlockBorders ? { background: c || parsedBgColor } : { foreground: c, background: parsedBgColor };
    }

    // Apply opacity blending to border colors
    const needsBorderBlend = (style.opacity !== undefined && style.opacity < 1) ||
      (style.backgroundOpacity !== undefined && style.backgroundOpacity < 1);
    if (needsBorderBlend) {
      const bg = parentBgColor ?? parseColor(getThemeColor('background')) ?? 0x000000FF;
      for (const s of [topStyle, bottomStyle, leftStyle, rightStyle]) {
        if (!s) continue;
        if (style.backgroundOpacity !== undefined && style.backgroundOpacity < 1 && s.background !== undefined) {
          s.background = this._blendOpacity(s.background, style.backgroundOpacity, bg);
        }
        if (style.opacity !== undefined && style.opacity < 1) {
          if (s.foreground !== undefined) s.foreground = this._blendOpacity(s.foreground, style.opacity, bg);
          if (s.background !== undefined) s.background = this._blendOpacity(s.background, style.opacity, bg);
        }
      }
    }

    // Get border characters (use the first available border style for consistency)
    // In block mode, always use 'block' style (spaces)
    // getBorderChars handles unicode fallback to 'ascii' automatically
    const activeStyle = useBlockBorders
      ? 'block' as Exclude<BorderStyle, 'none'>
      : ((borderTop || borderBottom || borderLeft || borderRight || 'thin') as Exclude<BorderStyle, 'none'>);
    const chars = getBorderChars(activeStyle);

    // Calculate line extents based on which borders are visible
    // If a border is visible, extend lines to that border position
    // If a border is hidden (outside clip), extend lines to the clip edge
    const lineStartX = borderLeft ? leftBorderX : clippedBounds.x;
    const lineEndX = borderRight ? rightBorderX + 1 : clippedBounds.x + clippedBounds.width;
    const lineWidth = lineEndX - lineStartX;
    const lineStartY = borderTop ? topBorderY : clippedBounds.y;
    const lineEndY = borderBottom ? bottomBorderY + 1 : clippedBounds.y + clippedBounds.height;
    const lineHeight = lineEndY - lineStartY;

    // Draw individual border sides
    // Border top gap support (used by tabs to open the active tab into content below)
    const gap = borderTop && borderTop !== 'none' ? style._borderTopGap as { start: number; end: number } | undefined : undefined;
    if (borderTop && borderTop !== 'none') {
      if (gap) {
        const gapStartX = leftBorderX + gap.start;
        const gapEndX = leftBorderX + gap.end;
        const junctionAfterGap = gapEndX + 1;
        // Pre-gap horizontal: lineStartX to gapStartX - 1
        const preGapLen = gapStartX - lineStartX;
        if (preGapLen > 0) {
          this._drawHorizontalLine(lineStartX, topBorderY, preGapLen, borderTop, topStyle, buffer, chars);
        }
        // Post-gap horizontal: after junction to lineEndX
        const postGapStart = junctionAfterGap + 1;
        const postGapLen = lineEndX - postGapStart;
        if (postGapLen > 0) {
          this._drawHorizontalLine(postGapStart, topBorderY, postGapLen, borderTop, topStyle, buffer, chars);
        }
        // Junction ┘ at gapStartX (if not at left edge)
        if (gapStartX > leftBorderX) {
          buffer.currentBuffer.setCell(gapStartX, topBorderY, { char: chars.br, ...topStyle });
        }
        // Junction └ after gap (if within bounds)
        if (junctionAfterGap <= rightBorderX) {
          buffer.currentBuffer.setCell(junctionAfterGap, topBorderY, { char: chars.bl, ...topStyle });
        }
      } else {
        this._drawHorizontalLine(lineStartX, topBorderY, lineWidth, borderTop, topStyle, buffer, chars);

        // Draw border title centered in top border
        if (style.borderTitle) {
          const title = ` ${style.borderTitle} `;
          const titleLen = title.length;
          const availableWidth = lineWidth - 2; // Exclude corners
          if (titleLen <= availableWidth) {
            const startX = lineStartX + 1 + Math.floor((availableWidth - titleLen) / 2);
            const titleCell = { char: '', ...topStyle };
            for (let i = 0; i < titleLen; i++) {
              titleCell.char = title[i];
              buffer.currentBuffer.setCell(startX + i, topBorderY, titleCell);
            }
          }
        }
      }
    }
    if (borderBottom && borderBottom !== 'none') {
      this._drawHorizontalLine(lineStartX, bottomBorderY, lineWidth, borderBottom, bottomStyle, buffer, chars);
    }
    if (borderLeft && borderLeft !== 'none') {
      this._drawVerticalLine(leftBorderX, lineStartY, lineHeight, borderLeft, leftStyle, buffer, chars);
    }
    if (borderRight && borderRight !== 'none') {
      this._drawVerticalLine(rightBorderX, lineStartY, lineHeight, borderRight, rightStyle, buffer, chars);
    }

    // Draw corners AFTER all border lines (corners overwrite line endpoints)
    if (borderTop && borderLeft) {
      if (gap) {
        const gapStartX = leftBorderX + gap.start;
        const gapEndX = leftBorderX + gap.end;
        if (leftBorderX < gapStartX || leftBorderX > gapEndX) {
          buffer.currentBuffer.setCell(leftBorderX, topBorderY, { char: (style._borderCornerTL as string) || chars.tl, ...topStyle });
        }
      } else {
        buffer.currentBuffer.setCell(leftBorderX, topBorderY, { char: (style._borderCornerTL as string) || chars.tl, ...topStyle });
      }
    }
    if (borderTop && borderRight) {
      if (gap) {
        const gapStartX = leftBorderX + gap.start;
        const gapEndX = leftBorderX + gap.end;
        if (rightBorderX < gapStartX || rightBorderX > gapEndX) {
          buffer.currentBuffer.setCell(rightBorderX, topBorderY, { char: (style._borderCornerTR as string) || chars.tr, ...topStyle });
        }
      } else {
        buffer.currentBuffer.setCell(rightBorderX, topBorderY, { char: (style._borderCornerTR as string) || chars.tr, ...topStyle });
      }
    }
    if (borderBottom && borderLeft) {
      buffer.currentBuffer.setCell(leftBorderX, bottomBorderY, { char: chars.bl, ...bottomStyle });
    }
    if (borderBottom && borderRight) {
      buffer.currentBuffer.setCell(rightBorderX, bottomBorderY, { char: chars.br, ...bottomStyle });
    }
  }

  // Draw horizontal line for borders
  private _drawHorizontalLine(x: number, y: number, width: number, borderStyle: string, style: Partial<Cell>, buffer: DualBuffer, chars: any): void {
    const cell = { char: chars.h, ...style };
    for (let i = 0; i < width; i++) {
      buffer.currentBuffer.setCell(x + i, y, cell);
    }
  }

  // Draw vertical line for borders
  private _drawVerticalLine(x: number, y: number, height: number, borderStyle: string, style: Partial<Cell>, buffer: DualBuffer, chars: any): void {
    const cell = { char: chars.v, ...style };
    for (let i = 0; i < height; i++) {
      buffer.currentBuffer.setCell(x, y + i, cell);
    }
  }


  // Render element content
  private _renderContent(
    element: Element,
    bounds: Bounds,
    style: Style,
    buffer: DualBuffer | ViewportDualBuffer,
    context: RenderContext
  ): void {
    let fgColor = parseColor(style.color);
    let bgColor = parseColor(style.backgroundColor);

    // Resolve parent bg for opacity blending (also passed to components for canvas pixel blending)
    const contentParentBg = (context.parentStyle?.backgroundColor
      ? parseColor(context.parentStyle.backgroundColor)
      : undefined) ?? parseColor(getThemeColor('background')) ?? 0x000000FF;

    const needsBlend = (style.opacity !== undefined && style.opacity < 1) ||
      (style.backgroundOpacity !== undefined && style.backgroundOpacity < 1);
    if (needsBlend) {
      if (style.backgroundOpacity !== undefined && style.backgroundOpacity < 1 && bgColor !== undefined) {
        bgColor = this._blendOpacity(bgColor, style.backgroundOpacity, contentParentBg);
      }
      if (style.opacity !== undefined && style.opacity < 1) {
        if (fgColor !== undefined) fgColor = this._blendOpacity(fgColor, style.opacity, contentParentBg);
        if (bgColor !== undefined) bgColor = this._blendOpacity(bgColor, style.opacity, contentParentBg);
      }
    }

    const cellStyle: Partial<Cell> = {
      foreground: fgColor,
      background: bgColor,
      bold: style.fontWeight === 'bold',
      italic: style.fontStyle === 'italic',
      underline: style.textDecoration === 'underline',
      dim: style.dim,
      reverse: style.reverse,
    };

    // Use viewport system only for scrollable containers
    let renderBuffer: DualBuffer | ViewportDualBuffer = buffer;
    let elementViewport: Viewport | undefined;
    let coordinateTransform: CoordinateTransform | undefined;

    // Phase 3: Use viewport system for enhanced clipping
    if (context.clipRect && isScrollableType(element.type) && isScrollingEnabled(element)) {
      // Only use viewport system for scrollable containers
      const viewportManager = context.viewportManager || globalViewportManager;

      // Get content dimensions from layout if available (Phase 2 integration)
      const layoutNode = this._currentLayoutContext?.get(element.id || '');
      const contentSize = layoutNode?.actualContentSize || this.calculateScrollDimensions(element);

      elementViewport = viewportManager.createViewport({
        element,
        contentSize,
        scrollable: true
      });

      coordinateTransform = new CoordinateTransform(elementViewport);
      renderBuffer = new ViewportDualBuffer(buffer as DualBuffer, elementViewport);
    } else if (context.clipRect) {
      // Use ViewportDualBuffer with simple clip viewport for non-scrollable clipping
      renderBuffer = new ViewportDualBuffer(buffer as DualBuffer, createClipViewport(context.clipRect));
    }


    // Store bounds on element for getBounds() access
    element.setBounds(bounds);

    // Check if element implements Renderable interface
    if (isRenderable(element)) {
      const componentContext: ComponentRenderContext = {
        buffer: renderBuffer,
        style: cellStyle,
        focusedElementId: context.focusedElementId,
        hoveredElementId: context.hoveredElementId,
        requestRender: context.requestRender,
        requestCachedRender: context.requestCachedRender,
        parentBgColor: contentParentBg, // For canvas pixel opacity blending
        scrollOffset: context.scrollOffset, // Pass scroll offset for click translation
        viewport: context.viewport, // Full viewport for modal overlays
        // Allow components to register their scrollbar bounds for scroll-handler integration
        registerScrollbarBounds: (elementId: string, scrollbarBounds: ScrollbarBounds) => {
          this._scrollbarBounds.set(elementId, scrollbarBounds);
        },
        // Allow components to register overlays (dropdowns, tooltips)
        registerOverlay: (overlay: Overlay) => {
          this._overlays.push(overlay);
        },
        // Allow components to look up element bounds by ID (for connectors)
        // Bounds are adjusted for cumulative scroll offset from parent scrollable containers
        getElementBounds: (elementId: string) => {
          // First check dynamically registered bounds (e.g., from table cells)
          const dynamicBounds = this._dynamicBounds?.get(elementId);
          if (dynamicBounds) return dynamicBounds;
          // Then check layout context
          const layoutBounds = this._currentLayoutContext?.get(elementId)?.bounds;
          if (!layoutBounds) return undefined;
          const scrollOffset = this._scrollOffsets?.get(elementId);
          if (!scrollOffset || (scrollOffset.x === 0 && scrollOffset.y === 0)) {
            return layoutBounds;
          }
          // Return bounds adjusted for scroll offset
          return {
            x: layoutBounds.x - scrollOffset.x,
            y: layoutBounds.y - scrollOffset.y,
            width: layoutBounds.width,
            height: layoutBounds.height,
          };
        },
        // Get all element bounds (for connector obstacle avoidance)
        // Bounds are adjusted for cumulative scroll offset from parent scrollable containers
        getAllElementBounds: () => {
          const bounds = new Map<string, Bounds>();
          // Include dynamically registered bounds (e.g., from table cells)
          if (this._dynamicBounds) {
            for (const [id, b] of this._dynamicBounds.entries()) {
              bounds.set(id, b);
            }
          }
          if (this._currentLayoutContext) {
            for (const [id, info] of this._currentLayoutContext.entries()) {
              if (info.bounds) {
                const scrollOffset = this._scrollOffsets?.get(id);
                if (!scrollOffset || (scrollOffset.x === 0 && scrollOffset.y === 0)) {
                  bounds.set(id, info.bounds);
                } else {
                  bounds.set(id, {
                    x: info.bounds.x - scrollOffset.x,
                    y: info.bounds.y - scrollOffset.y,
                    width: info.bounds.width,
                    height: info.bounds.height,
                  });
                }
              }
            }
          }
          return bounds;
        },
        // Allow components to register element bounds dynamically (for table cells, etc.)
        registerElementBounds: (elementId: string, elementBounds: Bounds) => {
          if (!this._dynamicBounds) {
            this._dynamicBounds = new Map();
          }
          this._dynamicBounds.set(elementId, elementBounds);
        },
      };
      // Pass computed style so components can read layout properties (padding, etc.)
      componentContext.computedStyle = style;
      // Pass the overlays array from context if it exists (for read access)
      if (context.overlays) {
        componentContext.overlays = context.overlays;
      }
      // Pass the actual buffer, components will handle clipping through the buffer interface
      // Wrap in try/catch for error boundary
      try {
        element.render(bounds, cellStyle, renderBuffer as any, componentContext);
      } catch (error) {
        const err = ensureError(error);
        getGlobalErrorHandler().captureError(element, err, bounds);
        renderErrorPlaceholder(buffer as DualBuffer, bounds, element.type, err);
      }
    } else {
      // Fallback for elements that don't implement Renderable (like containers)
      switch (element.type) {
        case 'container':
        case 'tabs':
        case 'tab':
          // These are treated like containers - just render their children
          this._renderContainer(element as ContainerElement, bounds, cellStyle, renderBuffer as any);
          break;

        default:
          // Render unknown elements as their type name for debugging
          renderBuffer.currentBuffer.setText(bounds.x, bounds.y, `<${element.type}>`, cellStyle);
          break;
      }
    }
  }


  // Render container element (scrollbars now handled separately after children)
  private _renderContainer(
    element: ContainerElement,
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: any
  ): void {
    // Container-specific rendering logic can go here
    // Scrollbars are now rendered after children via _renderScrollbars()
  }

  // Build layout context map for quick lookup during rendering
  // Also tracks cumulative scroll offsets for connector bounds adjustment
  private _buildLayoutContext(
    node: LayoutNode,
    context: Map<string, LayoutNode>,
    scrollOffset: { x: number; y: number } = { x: 0, y: 0 }
  ): void {
    if (node.element.id) {
      context.set(node.element.id, node);
      // Store the cumulative scroll offset for this element
      if (this._scrollOffsets) {
        this._scrollOffsets.set(node.element.id, { ...scrollOffset });
      }
    }

    // Check if this element is scrollable and accumulate its scroll offset
    let childScrollOffset = scrollOffset;
    if (isScrollableType(node.element.type) && isScrollingEnabled(node.element)) {
      const scrollX = node.element.props.scrollX ?? 0;
      const scrollY = node.element.props.scrollY ?? 0;
      childScrollOffset = {
        x: scrollOffset.x + scrollX,
        y: scrollOffset.y + scrollY,
      };
    }

    for (const child of node.children) {
      this._buildLayoutContext(child, context, childScrollOffset);
    }
  }

  // Render vertical scrollbar
  private _renderVerticalScrollbar(
    bounds: Bounds,
    scrollY: number,
    contentHeight: number,
    style: Partial<Cell>,
    buffer: DualBuffer,
    focused = false
  ): void {
    const scrollbarX = bounds.x;  // Use bounds.x directly since bounds are already positioned correctly
    const scrollbarHeight = bounds.height;

    // Prevent division by zero and handle edge cases
    if (contentHeight <= 0 || scrollbarHeight <= 0) {
      return;
    }

    // If content fits within bounds, no scrollbar needed
    if (contentHeight <= bounds.height) {
      return;
    }

    // Calculate scrollbar thumb size (minimum 1, maximum scrollbarHeight)
    const viewportRatio = bounds.height / contentHeight;
    const thumbSize = clamp(Math.floor(viewportRatio * scrollbarHeight), 1, scrollbarHeight);

    // Calculate maximum scroll position
    const maxScrollY = Math.max(0, contentHeight - bounds.height);

    // Clamp scrollY to valid range
    const clampedScrollY = clamp(scrollY, 0, maxScrollY);

    // Calculate thumb position (remaining space after accounting for thumb size)
    const availableTrackSpace = Math.max(1, scrollbarHeight - thumbSize);
    const scrollProgress = maxScrollY > 0 ? (clampedScrollY / maxScrollY) : 0;
    const thumbPosition = Math.min(availableTrackSpace, Math.floor(scrollProgress * availableTrackSpace));

    // Render scrollbar track — use focusBorder color when container is focused
    const focusBorderColor = focused ? getThemeColor('focusBorder') : undefined;
    const thumbColor = focusBorderColor ?? getThemeColor('scrollbarThumb') ?? style.foreground ?? COLORS.white;
    const trackColor = focused
      ? (focusBorderColor ?? getThemeColor('scrollbarTrack') ?? COLORS.gray)
      : (getThemeColor('scrollbarTrack') ?? COLORS.gray);

    const unicodeOk = getUnicodeTier() !== 'ascii';
    for (let y = 0; y < scrollbarHeight; y++) {
      const isThumb = y >= thumbPosition && y < thumbPosition + thumbSize;
      const char = isThumb ? (unicodeOk ? '█' : '#') : (unicodeOk ? '░' : '.');
      const color = isThumb ? thumbColor : trackColor;
      buffer.currentBuffer.setText(scrollbarX, bounds.y + y, char, {
        foreground: color,
        background: style.background
      });
    }
  }

  // Render horizontal scrollbar
  private _renderHorizontalScrollbar(
    bounds: Bounds,
    scrollX: number,
    contentWidth: number,
    style: Partial<Cell>,
    buffer: DualBuffer,
    focused = false
  ): void {
    const scrollbarY = bounds.y;  // Use bounds.y directly since bounds are already positioned correctly
    const scrollbarWidth = bounds.width;

    // Prevent division by zero and handle edge cases
    if (contentWidth <= 0 || scrollbarWidth <= 0) {
      return;
    }

    // If content fits within bounds, no scrollbar needed
    if (contentWidth <= bounds.width) {
      return;
    }

    // Calculate scrollbar thumb size (minimum 1, maximum scrollbarWidth)
    const viewportRatio = bounds.width / contentWidth;
    const thumbSize = clamp(Math.floor(viewportRatio * scrollbarWidth), 1, scrollbarWidth);

    // Calculate maximum scroll position
    const maxScrollX = Math.max(0, contentWidth - bounds.width);

    // Clamp scrollX to valid range
    const clampedScrollX = clamp(scrollX, 0, maxScrollX);

    // Calculate thumb position (remaining space after accounting for thumb size)
    const availableTrackSpace = scrollbarWidth - thumbSize;
    const scrollProgress = maxScrollX > 0 ? (clampedScrollX / maxScrollX) : 0;
    const thumbPosition = Math.floor(scrollProgress * availableTrackSpace);

    // Render scrollbar track — use focusBorder color when container is focused
    const focusBorderColor = focused ? getThemeColor('focusBorder') : undefined;
    const thumbColor = focusBorderColor ?? getThemeColor('scrollbarThumb') ?? style.foreground ?? COLORS.white;
    const trackColor = focused
      ? (focusBorderColor ?? getThemeColor('scrollbarTrack') ?? COLORS.gray)
      : (getThemeColor('scrollbarTrack') ?? COLORS.gray);

    const unicodeOk = getUnicodeTier() !== 'ascii';
    for (let x = 0; x < scrollbarWidth; x++) {
      const isThumb = x >= thumbPosition && x < thumbPosition + thumbSize;
      const char = isThumb ? (unicodeOk ? '█' : '#') : (unicodeOk ? '░' : '.');
      const color = isThumb ? thumbColor : trackColor;
      buffer.currentBuffer.setText(bounds.x + x, scrollbarY, char, {
        foreground: color,
        background: style.background
      });
    }
  }

  // Get container bounds from current layout context
  // For scrollable containers, excludes scrollbar area
  getContainerBounds(containerOrId: Element | string): Bounds | undefined {
    // Resolve element if given an ID string
    const containerId = typeof containerOrId === 'string' ? containerOrId : (containerOrId.id || '');
    const element = typeof containerOrId === 'string' ? this._document?.getElementById(containerOrId) : containerOrId;

    // For tbody elements, ALWAYS use actual bounds set by table component
    // The table component calculates the correct viewport size for its scrollable tbody,
    // which may differ from what the layout engine calculates
    if (element?.type === 'tbody') {
      const tbody = element as any;
      if (typeof tbody.getActualBounds === 'function') {
        const actualBounds = tbody.getActualBounds();
        if (actualBounds) return actualBounds;
      }
    }

    // First check dynamically registered bounds (e.g., from mermaid elements, table cells)
    // These are elements rendered via renderElementSubtree that aren't in the main layout tree
    const dynamicBounds = this._dynamicBounds?.get(containerId);
    if (dynamicBounds) {
      renderLogger.trace(`getContainerBounds(${containerId}): found in dynamicBounds ${dynamicBounds.x},${dynamicBounds.y} ${dynamicBounds.width}x${dynamicBounds.height}`);
      return dynamicBounds;
    }

    const layoutNode = this._currentLayoutContext?.get(containerId);
    if (!layoutNode) {
      renderLogger.trace(`getContainerBounds(${containerId}): not in dynamicBounds or layoutContext`);
      return undefined;
    }

    // For scrollable containers, return content bounds minus scrollbar space
    if (isScrollableType(layoutNode.element.type) && isScrollingEnabled(layoutNode.element)) {
      const contentBounds = layoutNode.contentBounds;

      // If no content bounds, fall back to element bounds
      if (!contentBounds) {
        return layoutNode.bounds;
      }

      // Check if scrollbars are needed (reduce bounds to match rendering)
      const contentDimensions = this.calculateScrollDimensions(layoutNode.element);
      const { x: overflowX, y: overflowY } = getOverflowAxis(layoutNode.element);
      const needsVerticalScrollbar = (overflowY === 'scroll' || overflowY === 'auto') && contentDimensions.height > contentBounds.height;
      const needsHorizontalScrollbar = (overflowX === 'scroll' || overflowX === 'auto') && contentDimensions.width > contentBounds.width;

      if (needsVerticalScrollbar || needsHorizontalScrollbar) {
        return {
          x: contentBounds.x,
          y: contentBounds.y,
          width: needsVerticalScrollbar ? Math.max(1, contentBounds.width - 2) : contentBounds.width,
          height: needsHorizontalScrollbar ? Math.max(1, contentBounds.height - 1) : contentBounds.height,
        };
      }

      return contentBounds;
    }

    return layoutNode.bounds;
  }

  // Get scrollbar bounds for a container (for hit testing and drag handling)
  getScrollbarBounds(containerId: string): ScrollbarBounds | undefined {
    return this._scrollbarBounds.get(containerId);
  }

  // Get all scrollbar bounds (for iterating over all scrollable containers)
  getAllScrollbarBounds(): Map<string, ScrollbarBounds> {
    return this._scrollbarBounds;
  }

  /**
   * Public method for components to render a vertical scrollbar
   * Used by table and other components that handle their own scrolling
   */
  renderVerticalScrollbar(
    bounds: Bounds,
    scrollY: number,
    contentHeight: number,
    style: Partial<Cell>,
    buffer: DualBuffer
  ): void {
    this._renderVerticalScrollbar(bounds, scrollY, contentHeight, style, buffer);
  }

  // Calculate actual scroll dimensions for a scrollable container (cached per frame)
  calculateScrollDimensions(container: Element): { width: number; height: number } {
    if (!isScrollableType(container.type) || !isScrollingEnabled(container)) {
      return { width: 0, height: 0 };
    }

    const cacheKey = container.id || '';
    const cached = this._scrollDimensionsCache.get(cacheKey);
    if (cached) return cached;

    let result: { width: number; height: number };

    // For tbody elements, use the actual content height set by the table component
    // This is necessary because tbody row heights depend on column widths calculated by the table
    if (container.type === 'tbody') {
      const tbody = container as any;
      if (typeof tbody.getActualContentHeight === 'function') {
        const actualHeight = tbody.getActualContentHeight();
        if (actualHeight > 0) {
          result = { width: 0, height: actualHeight };
          this._scrollDimensionsCache.set(cacheKey, result);
          return result;
        }
      }
    }

    // Get the container's layout node which now includes pre-calculated content dimensions
    const containerLayoutNode = this._currentLayoutContext?.get(cacheKey);
    if (!containerLayoutNode) {
      throw new Error(`No layout context found for container ${container.id} - layout should always be available during rendering`);
    }

    // Phase 2: Use layout-provided content dimensions if available
    if (containerLayoutNode.actualContentSize) {
      result = containerLayoutNode.actualContentSize;
    } else {
      // Fallback: Use ContentMeasurer for backward compatibility
      const contentBounds = this._getContentBounds(containerLayoutNode.bounds, containerLayoutNode.computedStyle, true);
      const actualWidth = contentBounds.width;
      result = globalContentMeasurer.measureContainer(container, actualWidth);
    }

    this._scrollDimensionsCache.set(cacheKey, result);
    return result;
  }

  // Utility method to render a simple element tree for testing
  renderElement(element: Element, width: number, height: number): string {
    const defaultCell = {
      char: EMPTY_CHAR,
      background: getThemeColor('background'),
      foreground: getThemeColor('textPrimary')
    };
    const buffer = new DualBuffer(width, height, defaultCell);
    const viewport: Bounds = { x: 0, y: 0, width, height };

    this.render(element, buffer, viewport);

    // Get the content before swapping (current buffer has the rendered content)
    const result = buffer.currentBuffer.toString();
    return result;
  }

  // Render a modal dialog
  private _renderModal(modal: Element, context: RenderContext): void {
    if (!(modal instanceof DialogElement) || !modal.props.open) {
      return;
    }

    const buffer = context.buffer;
    const viewport = context.viewport;

    // Render the dialog backdrop and frame
    const modalStyle = this._computeStyle(modal.props.style || {});
    const modalCellStyle = this._styleToCellStyle(modalStyle);
    const componentContext: ComponentRenderContext = {
      focusedElementId: context.focusedElementId,
      hoveredElementId: context.hoveredElementId,
      requestRender: context.requestRender,
      buffer,
      style: modalCellStyle,
      getElementBounds: (elementId: string) => {
        const dynamicBounds = this._dynamicBounds?.get(elementId);
        if (dynamicBounds) return dynamicBounds;
        const layoutBounds = this._currentLayoutContext?.get(elementId)?.bounds;
        if (!layoutBounds) return undefined;
        const scrollOffset = this._scrollOffsets?.get(elementId);
        if (!scrollOffset || (scrollOffset.x === 0 && scrollOffset.y === 0)) {
          return layoutBounds;
        }
        return {
          x: layoutBounds.x - scrollOffset.x,
          y: layoutBounds.y - scrollOffset.y,
          width: layoutBounds.width,
          height: layoutBounds.height,
        };
      },
      registerElementBounds: (elementId: string, elementBounds: Bounds) => {
        if (!this._dynamicBounds) {
          this._dynamicBounds = new Map();
        }
        this._dynamicBounds.set(elementId, elementBounds);
      },
    };
    modal.render(viewport, modalCellStyle, buffer, componentContext);

    // Render the children using the layout system
    if (modal.children && modal.children.length > 0) {
      // Calculate dialog content area (inside the dialog borders)
      // Use parseDimension for consistent handling of numbers, percentages, "fill"
      const defaultWidth = Math.min(Math.floor(viewport.width * 0.8), 60);
      const defaultHeight = Math.min(Math.floor(viewport.height * 0.7), 20);
      const dialogWidth = Math.min(
        parseDimension(modal.props.width, viewport.width, defaultWidth),
        viewport.width - 4
      );
      const dialogHeight = Math.min(
        parseDimension(modal.props.height, viewport.height, defaultHeight),
        viewport.height - 4
      );

      // Apply drag offset to centered position
      const offsetX = modal.props.offsetX || 0;
      const offsetY = modal.props.offsetY || 0;
      const dialogX = Math.floor((viewport.width - dialogWidth) / 2) + offsetX;
      const dialogY = Math.floor((viewport.height - dialogHeight) / 2) + offsetY;

      // Content area (inside borders and title)
      const titleHeight = modal.props.title ? 3 : 1; // Title + separator or just border
      const contentBounds: Bounds = {
        x: viewport.x + dialogX + 1,  // Inside left border
        y: viewport.y + dialogY + titleHeight,  // Below title
        width: dialogWidth - 2,      // Inside borders
        height: dialogHeight - titleHeight - 1  // Above bottom border
      };

      // Check if we can use cached layout for this modal
      const cached = this._cachedModalLayouts.get(modal);
      const boundsMatch = cached &&
        cached.bounds.x === contentBounds.x &&
        cached.bounds.y === contentBounds.y &&
        cached.bounds.width === contentBounds.width &&
        cached.bounds.height === contentBounds.height;

      let childLayouts: LayoutNode[];

      if (boundsMatch && cached) {
        // Use cached layout
        childLayouts = cached.layouts;
      } else {
        // Lay out dialog children collectively as a flex column.
        // Temporarily clear width/height from props and style so the layout
        // engine uses contentBounds rather than the dialog's own declared dimensions.
        const savedWidth = modal.props.width;
        const savedHeight = modal.props.height;
        const savedStyleWidth = modal.props.style?.width;
        const savedStyleHeight = modal.props.style?.height;
        modal.props.width = undefined;
        modal.props.height = undefined;
        if (modal.props.style) {
          modal.props.style.width = undefined;
          modal.props.style.height = undefined;
        }
        const dialogLayoutContext: LayoutContext = {
          viewport: contentBounds,
          parentBounds: contentBounds,
          availableSpace: { width: contentBounds.width, height: contentBounds.height },
          focusedElementId: context.focusedElementId,
          hoveredElementId: context.hoveredElementId,
          ...(this._containerQueryStylesheets ? {
            stylesheets: this._containerQueryStylesheets,
            styleContext: this._containerQueryStyleContext,
          } : undefined),
        };
        const dialogLayout = this._layoutEngine.calculateLayout(modal, dialogLayoutContext);
        modal.props.width = savedWidth;
        modal.props.height = savedHeight;
        if (modal.props.style) {
          modal.props.style.width = savedStyleWidth;
          modal.props.style.height = savedStyleHeight;
        }
        childLayouts = dialogLayout.children;
        // Cache the layout
        this._cachedModalLayouts.set(modal, { bounds: { ...contentBounds }, layouts: childLayouts });
      }

      // Render each child using the (possibly cached) layout
      for (const childLayoutNode of childLayouts) {
        // Store dialog children's bounds in layout context for hit testing
        if (this._currentLayoutContext) {
          this._buildLayoutContext(childLayoutNode, this._currentLayoutContext);
        }

        const childContext: RenderContext = {
          buffer,
          viewport: contentBounds,
          parentBounds: contentBounds,
          focusedElementId: context.focusedElementId,
          hoveredElementId: context.hoveredElementId,
          textSelection: context.textSelection,
          requestRender: context.requestRender,
          viewportManager: context.viewportManager,
        };

        this._renderNode(childLayoutNode, childContext);
      }
    }
  }

  // Render overlays (dropdowns, tooltips, etc.) on top of normal content
  private _renderOverlays(buffer: DualBuffer, viewport: Bounds): void {
    if (this._overlays.length === 0) return;

    // Sort overlays by z-index (lower z-index rendered first, higher on top)
    const sortedOverlays = [...this._overlays].sort((a, b) => a.zIndex - b.zIndex);

    for (const overlay of sortedOverlays) {
      // Clip overlay bounds to viewport
      const clippedBounds: Bounds = {
        x: Math.max(overlay.bounds.x, viewport.x),
        y: Math.max(overlay.bounds.y, viewport.y),
        width: Math.min(overlay.bounds.x + overlay.bounds.width, viewport.x + viewport.width) - Math.max(overlay.bounds.x, viewport.x),
        height: Math.min(overlay.bounds.y + overlay.bounds.height, viewport.y + viewport.height) - Math.max(overlay.bounds.y, viewport.y),
      };

      // Skip if overlay is completely outside viewport
      if (clippedBounds.width <= 0 || clippedBounds.height <= 0) continue;

      // Call the overlay's render function with the original bounds
      // The render function is responsible for its own content
      overlay.render(buffer, overlay.bounds, {});
    }
  }

  // Get collected overlays for hit testing
  getOverlays(): Overlay[] {
    return this._overlays;
  }

  // Register an overlay (used by components during render)
  registerOverlay(overlay: Overlay): void {
    this._overlays.push(overlay);
  }

  /**
   * Check if any UI overlays or dialogs are currently visible.
   * Used by sixel rendering to know when to hide graphics.
   */
  hasVisibleOverlays(): boolean {
    // Check for dropdown overlays (select, combobox, command palette)
    if (this._overlays.length > 0) {
      return true;
    }

    // Check for open dialogs (using cached root element from last render)
    if (this._cachedElement) {
      const modals: Element[] = [];
      this._collectModals(this._cachedElement, modals);
      const hasOpenDialog = modals.some(modal =>
        (modal as any).props?.open === true
      );
      if (hasOpenDialog) {
        return true;
      }
    }

    return false;
  }

  // Collect all modal dialogs from the element tree
  private _collectModals(element: Element, modals: Element[]): void {
    if (element.type === 'dialog') {
      modals.push(element);
    }

    if (element.children) {
      for (const child of element.children) {
        this._collectModals(child, modals);
      }
    }
  }
}

/**
 * Render an element subtree into a buffer at specified bounds.
 * This is a standalone helper for components that need to render nested element trees.
 * Used by markdown to render mermaid graphs inline.
 *
 * If a context with registerElementBounds is provided, element bounds will be registered
 * with the main renderer, enabling proper hit testing and interaction.
 */
export function renderElementSubtree(
  element: Element,
  buffer: DualBuffer,
  bounds: Bounds,
  context?: ComponentRenderContext
): void {
  // Normalize bounds to ensure all values are valid numbers (NaN/null → 0)
  const safeBounds: Bounds = {
    x: Number.isFinite(bounds.x) ? bounds.x : 0,
    y: Number.isFinite(bounds.y) ? bounds.y : 0,
    width: Number.isFinite(bounds.width) ? bounds.width : 80,
    height: Number.isFinite(bounds.height) ? bounds.height : 24,
  };

  // Use an isolated layout engine to avoid shared state with the parent render
  const renderer = new RenderingEngine({ layoutEngine: new LayoutEngine() });

  // Create a wrapper context that forwards registerElementBounds to the parent context
  // This allows elements rendered in the subtree to be found by hit testing
  const wrapperContext: ComponentRenderContext = {
    buffer,
    style: context?.style || {},
    focusedElementId: context?.focusedElementId,
    hoveredElementId: context?.hoveredElementId,
    requestRender: context?.requestRender,
    scrollOffset: context?.scrollOffset,
    viewport: context?.viewport,
    getElementBounds: context?.getElementBounds,
    getAllElementBounds: context?.getAllElementBounds,
    // Forward registerElementBounds to parent context
    registerElementBounds: context?.registerElementBounds,
  };

  // Render the subtree - pass focusedElementId and hoveredElementId so inputs show cursor
  const layoutTree = renderer.render(
    element,
    buffer,
    safeBounds,
    context?.focusedElementId,    // Pass focused element so inputs show cursor
    undefined,                     // textSelection - not needed for subtree
    context?.hoveredElementId,    // Pass hovered element for hover effects
    context?.requestRender        // Pass requestRender callback
  );

  // Register all element bounds from the layout tree with the parent context
  // This enables hit testing for elements rendered in the subtree
  if (context?.registerElementBounds) {
    registerBoundsFromLayoutTree(layoutTree, context.registerElementBounds);
  }
}

/**
 * Recursively register element bounds from a layout tree
 */
function registerBoundsFromLayoutTree(
  node: LayoutNode,
  registerElementBounds: (elementId: string, bounds: Bounds) => void
): void {
  if (node.element && node.bounds && node.element.id) {
    registerElementBounds(node.element.id, node.bounds);
  }
  if (node.children) {
    for (const child of node.children) {
      registerBoundsFromLayoutTree(child, registerElementBounds);
    }
  }
}