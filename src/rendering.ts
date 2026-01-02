// Basic Rendering Engine for converting elements to terminal output
// Integrates the element system with the dual-buffer rendering system

import { Element, Node, Style, Position, Size, Bounds, LayoutProps, BoxSpacing, Renderable, ComponentRenderContext, TextSelection, isRenderable, BORDER_CHARS, type BorderStyle } from './types.ts';
import { clipBounds } from './geometry.ts';
import { DualBuffer, TerminalBuffer, Cell } from './buffer.ts';
import { ClippedDualBuffer } from './clipped-buffer.ts';
import { Viewport, ViewportManager, globalViewportManager, CoordinateTransform } from './viewport.ts';
import { ViewportDualBuffer } from './viewport-buffer.ts';
import { ContainerElement } from './components/container.ts';
import { TextElement } from './components/text.ts';
import { InputElement } from './components/input.ts';
import { ButtonElement } from './components/button.ts';
import { DialogElement } from './components/dialog.ts';
import { SizingModel, globalSizingModel, BoxModel } from './sizing.ts';
import { LayoutEngine, LayoutNode as AdvancedLayoutNode, LayoutContext, globalLayoutEngine } from './layout.ts';
import { getThemeColor } from './theme.ts';
import { ContentMeasurer, globalContentMeasurer } from './content-measurer.ts';
import { getLogger } from './logging.ts';
import { getGlobalErrorHandler, renderErrorPlaceholder } from './error-boundary.ts';

const renderLogger = getLogger('RenderEngine');

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
  // New viewport-based properties
  viewportManager?: ViewportManager;
  elementViewport?: Viewport;
}

export interface LayoutNode {
  element: Element;
  bounds: Bounds;
  visible: boolean;
  children: LayoutNode[];
  computedStyle: Style;
  // Add compatibility fields
  contentBounds?: Bounds;
  layoutProps?: any;
  boxModel?: BoxModel;
  zIndex?: number;
  // Phase 2 additions
  actualContentSize?: Size;
  scrollbars?: {
    vertical?: any; // Will match ScrollbarLayout from viewport.ts
    horizontal?: any;
  };
}

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
  // Cache for selection-only renders
  private _cachedLayoutTree?: LayoutNode;
  private _cachedElement?: Element;
  private _cachedViewport?: Bounds;
  // Scrollbar bounds for drag handling
  private _scrollbarBounds: Map<string, ScrollbarBounds> = new Map();

  constructor(options: {
    sizingModel?: SizingModel;
    layoutEngine?: LayoutEngine;
    viewportManager?: ViewportManager;
  } = {}) {
    this._sizingModel = options.sizingModel || globalSizingModel;
    this._layoutEngine = options.layoutEngine || globalLayoutEngine;
    this._viewportManager = options.viewportManager || globalViewportManager;
  }

  // Main render method that takes an element tree and renders to a buffer
  render(element: Element, buffer: DualBuffer, viewport: Bounds, focusedElementId?: string, textSelection?: TextSelection, hoveredElementId?: string, requestRender?: () => void): LayoutNode {
    // Clear scrollbar bounds for fresh render
    this._scrollbarBounds.clear();

    const context: RenderContext = {
      buffer,
      viewport,
      focusedElementId,
      hoveredElementId,
      textSelection,
      requestRender,
      viewportManager: this._viewportManager,
    };

    // Use advanced layout engine
    const layoutContext: LayoutContext = {
      viewport,
      parentBounds: viewport,
      availableSpace: { width: viewport.width, height: viewport.height },
    };
    const advancedLayoutTree = this._layoutEngine.calculateLayout(element, layoutContext);
    const layoutTree = this._convertAdvancedLayoutNode(advancedLayoutTree);

    // Build layout context map for scroll calculations
    this._currentLayoutContext = new Map();
    this._buildLayoutContext(layoutTree, this._currentLayoutContext);

    // Collect all modal dialogs for separate rendering
    const modals: Element[] = [];
    this._collectModals(element, modals);

    // Create an array to collect menu overlays during rendering
    const menuOverlays: Array<{ element: Element; bounds: Bounds; style: any }> = [];
    (context as any).overlays = menuOverlays;

    // Render normal content first
    this._renderNode(layoutTree, context);

    // Render menu overlays that were collected during normal rendering
    for (const overlay of menuOverlays) {
      const componentContext: ComponentRenderContext = {
        focusedElementId: context.focusedElementId,
        hoveredElementId: context.hoveredElementId,
        requestRender: context.requestRender,
        buffer,
        style: overlay.style,
      };
      if (typeof (overlay.element as any).render === 'function') {
        (overlay.element as any).render(overlay.bounds, overlay.style, buffer, componentContext);
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
        };
        modal.render(viewport, modalCellStyle, buffer, componentContext);

        // Then render the children using the normal layout system
        if (modal.children && modal.children.length > 0) {
          // Calculate dialog content area (inside the dialog borders)
          // Use props if provided, otherwise use defaults
          const widthProp = modal.props.width;
          const heightProp = modal.props.height;
          const dialogWidth = widthProp !== undefined
            ? (widthProp <= 1 ? Math.floor(viewport.width * widthProp) : Math.min(widthProp, viewport.width - 4))
            : Math.min(Math.floor(viewport.width * 0.8), 60);
          const dialogHeight = heightProp !== undefined
            ? (heightProp <= 1 ? Math.floor(viewport.height * heightProp) : Math.min(heightProp, viewport.height - 4))
            : Math.min(Math.floor(viewport.height * 0.7), 20);

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

          // Render each child in the content area
          for (const child of modal.children) {
            const childLayoutContext = {
              viewport: contentBounds,
              parentBounds: contentBounds,
              availableSpace: { width: contentBounds.width, height: contentBounds.height }
            };

            const childLayout = this._layoutEngine.calculateLayout(child, childLayoutContext);
            const childLayoutNode = this._convertAdvancedLayoutNode(childLayout);

            // Store dialog children's bounds in layout context for hit testing
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

    // Apply text selection highlighting AFTER modals so it's visible in dialogs
    if (context.textSelection?.isActive) {
      this._applySelectionHighlight(context.textSelection, buffer);
    }

    // Cache layout tree for selection-only updates
    this._cachedLayoutTree = layoutTree;
    this._cachedElement = element;
    this._cachedViewport = viewport;

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

    // Collect modals and menu overlays
    const modals: Element[] = [];
    this._collectModals(this._cachedElement, modals);
    const menuOverlays: Array<{ element: Element; bounds: Bounds; style: any }> = [];
    (context as any).overlays = menuOverlays;

    // Render content using cached layout (no layout recalculation)
    const renderNodeStart = performance.now();
    this._renderNode(this._cachedLayoutTree, context);
    this.selectionRenderTiming.renderNodeTime = performance.now() - renderNodeStart;

    // Render menu overlays
    const overlaysStart = performance.now();
    for (const overlay of menuOverlays) {
      const componentContext: ComponentRenderContext = {
        focusedElementId: context.focusedElementId,
        hoveredElementId: context.hoveredElementId,
        requestRender: context.requestRender,
        buffer,
        style: overlay.style,
      };
      if (typeof (overlay.element as any).render === 'function') {
        (overlay.element as any).render(overlay.bounds, overlay.style, buffer, componentContext);
      }
    }
    this.selectionRenderTiming.overlaysTime = performance.now() - overlaysStart;

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

  // Extract text from selection (public method for deferred extraction)
  extractSelectionText(selection: TextSelection, buffer: DualBuffer): string {
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

    const { start, end, componentBounds, mode } = selection;

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

      const boundsLeft = componentBounds?.x ?? 0;
      const boundsRight = componentBounds ? componentBounds.x + componentBounds.width - 1 : buffer.currentBuffer.width - 1;

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

        for (let x = lineStartX; x <= lineEndX; x++) {
          this._highlightCell(buffer, x, y);
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
  private _styleToCellStyle(style: Style): Partial<Cell> {
    const cellStyle: Partial<Cell> = {};

    if (style.color) {
      cellStyle.foreground = style.color;
    }
    if (style.backgroundColor) {
      cellStyle.background = style.backgroundColor;
    }
    if (style.fontWeight === 'bold') {
      cellStyle.bold = true;
    }

    return cellStyle;
  }

  // Calculate element bounds within parent using border-box sizing model
  private _calculateBounds(
    element: Element,
    parentBounds: Bounds,
    style: Style
  ): Bounds {
    const props = element.props as LayoutProps;

    // First, determine the requested size
    let requestedWidth: number;
    let requestedHeight: number;

    // Get margin for calculations
    const margin = typeof (style.margin || 0) === 'number'
      ? { top: style.margin as number, right: style.margin as number, bottom: style.margin as number, left: style.margin as number }
      : style.margin as any;

    const marginHorizontal = (margin.left || 0) + (margin.right || 0);
    const marginVertical = (margin.top || 0) + (margin.bottom || 0);

    // Calculate width (check both props and style section)
    const width = style.width !== undefined ? style.width : props.width;
    if (width === 'fill' || width === undefined) {
      requestedWidth = parentBounds.width - marginHorizontal;
    } else if (width === 'auto') {
      requestedWidth = this._calculateAutoWidth(element, style);
    } else if (typeof width === 'string' && (width as string).endsWith('%')) {
      const percentage = parseFloat(width) / 100;
      requestedWidth = Math.floor((parentBounds.width - marginHorizontal) * percentage);
    } else {
      requestedWidth = width;
    }

    // Calculate height (check both props and style section)
    const height = style.height !== undefined ? style.height : props.height;
    if (height === 'fill') {
      requestedHeight = parentBounds.height - marginVertical;
    } else if (height === 'auto' || height === undefined) {
      // Default to auto (content-based) height when not specified
      requestedHeight = this._calculateAutoHeight(element, style);
    } else if (typeof height === 'string' && (height as string).endsWith('%')) {
      const percentage = parseFloat(height) / 100;
      requestedHeight = Math.floor((parentBounds.height - marginVertical) * percentage);
    } else {
      requestedHeight = height;
    }

    // Use sizing model to calculate the complete box model
    const boxModel = this._sizingModel.calculateBoxModel(
      { width: requestedWidth, height: requestedHeight },
      style
    );

    // Constrain to fit within parent bounds
    const maxWidth = parentBounds.width;
    const maxHeight = parentBounds.height;

    const constrainedSize = this._sizingModel.constrainSize(
      { width: requestedWidth, height: requestedHeight },
      style,
      undefined, // no minimum size
      { width: maxWidth, height: maxHeight }
    );

    // Recalculate box model with constrained size
    const finalBoxModel = this._sizingModel.calculateBoxModel(constrainedSize, style);

    // Apply margin as position offset
    return {
      x: parentBounds.x + finalBoxModel.margin.left,
      y: parentBounds.y + finalBoxModel.margin.top,
      width: requestedWidth,  // The requested size already excludes margin
      height: requestedHeight, // The requested size already excludes margin
    };
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
    return this._sizingModel.calculateContentBounds(bounds, style, isScrollable);
  }


  // Check if element should be visible
  private _isVisible(element: Element, bounds: Bounds): boolean {
    return bounds.width > 0 && bounds.height > 0 && element.props.visible !== false;
  }

  // Render a layout node to the buffer
  private _renderNode(node: LayoutNode, context: RenderContext): void {
    // Debug: log visibility
    const gLogger = (globalThis as any).logger;

    if (!node.visible) return;

    try {
      this._renderNodeInternal(node, context);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      getGlobalErrorHandler().captureError(node.element, err, node.bounds);
      renderErrorPlaceholder(context.buffer as DualBuffer, node.bounds, node.element.type, err);
    }
  }

  // Internal render implementation
  private _renderNodeInternal(node: LayoutNode, context: RenderContext): void {
    const { element, bounds, computedStyle } = node;

    // Debug: Log ALL node renders
    const gLogger = (globalThis as any).logger;

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

    if (clippedBounds.width <= 0 || clippedBounds.height <= 0) return;

    // Render background
    this._renderBackground(clippedBounds, computedStyle, context.buffer);

    // Render border
    this._renderBorder(clippedBounds, computedStyle, context.buffer);



    // Render content based on element type
    this._renderContent(element, node.bounds, computedStyle, context.buffer, context);


    // Render children with scroll translation and clipping
    const isScrollable = element.type === 'container' && element.props.scrollable;
    const contentBounds = this._getContentBounds(clippedBounds, computedStyle, isScrollable);

    if (isScrollable) {
      // For scrollable containers, translate children rendering positions by scroll offset
      const scrollX = element.props.scrollX || 0;
      const scrollY = element.props.scrollY || 0;

      // Calculate content dimensions to determine if scrollbars are needed
      const contentDimensions = this.calculateScrollDimensions(element);

      // Check overflow style to determine which scrollbars to show
      // overflow: 'scroll' = both, 'scrollY' = vertical only, 'scrollX' = horizontal only
      const overflow = element.props.style?.overflow;
      const allowVertical = overflow !== 'scrollX'; // Allow vertical unless explicitly scrollX only
      const allowHorizontal = overflow !== 'scrollY' && overflow !== 'scroll'; // Only allow horizontal if not scrollY or scroll

      const needsVerticalScrollbar = allowVertical && contentDimensions.height > contentBounds.height;
      const needsHorizontalScrollbar = allowHorizontal && contentDimensions.width > contentBounds.width;

      // Reduce content bounds to reserve space for scrollbars
      const adjustedContentBounds = {
        ...contentBounds,
        width: needsVerticalScrollbar ? Math.max(1, contentBounds.width - 2) : contentBounds.width,  // Reserve 2 chars for scrollbar and spacing
        height: needsHorizontalScrollbar ? Math.max(1, contentBounds.height - 1) : contentBounds.height
      };

      const childContext: RenderContext = {
        ...context,
        clipRect: adjustedContentBounds, // Clip to adjusted bounds
        parentBounds: adjustedContentBounds,
        parentStyle: computedStyle,
      };

      // Translate children positions by scroll offset for rendering only
      for (const child of node.children) {
        // Create a copy with translated bounds for rendering (recursive for all descendants)
        const translatedChild = this._translateNodeBounds(child, scrollX, scrollY);

        this._renderNode(translatedChild, childContext);
      }

      // Render scroll bars AFTER children to ensure they appear on top
      // Use the main buffer for scrollbars as they need direct access to the buffer
      this._renderScrollbars(element, contentBounds, adjustedContentBounds, this._styleToCellStyle(computedStyle), context.buffer);
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
  }

  // Recursively translate node bounds by scroll offset
  private _translateNodeBounds(node: LayoutNode, scrollX: number, scrollY: number): LayoutNode {
    return {
      ...node,
      bounds: {
        x: node.bounds.x - scrollX,
        y: node.bounds.y - scrollY,
        width: node.bounds.width,
        height: node.bounds.height,
      },
      children: node.children.map(child => this._translateNodeBounds(child, scrollX, scrollY))
    };
  }

  // Render scroll bars for a scrollable container (called after children are rendered)
  private _renderScrollbars(element: Element, contentBounds: Bounds, adjustedContentBounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    if (element.type !== 'container' || !element.props.scrollable) {
      return;
    }

    let { scrollX, scrollY } = element.props;

    // Calculate content dimensions - need to calculate without scroll effects
    const contentDimensions = this.calculateScrollDimensions(element);

    // Check overflow style to determine which scrollbars to show
    // overflow: 'scroll' = both, 'scrollY' = vertical only, 'scrollX' = horizontal only
    const overflow = element.props.style?.overflow;
    const allowVertical = overflow !== 'scrollX'; // Allow vertical unless explicitly scrollX only
    const allowHorizontal = overflow !== 'scrollY' && overflow !== 'scroll'; // Only allow horizontal if not scrollY or scroll

    // Check if scroll bars are needed (and allowed by overflow style)
    const needsVerticalScrollbar = allowVertical && contentDimensions.height > contentBounds.height;
    const needsHorizontalScrollbar = allowHorizontal && contentDimensions.width > contentBounds.width;

    // Validate and clamp scroll positions to prevent invalid scrolling
    // Ensure last content item is always reachable by being slightly more generous
    const maxScrollY = Math.max(0, contentDimensions.height - contentBounds.height + (contentBounds.height > 1 ? 1 : 0));
    const maxScrollX = Math.max(0, contentDimensions.width - contentBounds.width);

    // Clamp scroll values to valid ranges
    scrollY = Math.max(0, Math.min(maxScrollY, scrollY || 0));
    scrollX = Math.max(0, Math.min(maxScrollX, scrollX || 0));

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
      const thumbSize = Math.max(1, Math.min(trackBounds.height, Math.floor(viewportRatio * trackBounds.height)));
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

      this._renderVerticalScrollbar(trackBounds, scrollY || 0, contentDimensions.height, style, buffer);
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
      const thumbSize = Math.max(1, Math.min(trackBounds.width, Math.floor(viewportRatio * trackBounds.width)));
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

      this._renderHorizontalScrollbar(trackBounds, scrollX || 0, contentDimensions.width, style, buffer);
    }

    // Store scrollbar bounds if any scrollbars were rendered
    if (elementId && (scrollbarBoundsEntry.vertical || scrollbarBoundsEntry.horizontal)) {
      this._scrollbarBounds.set(elementId, scrollbarBoundsEntry);
    }
  }

  // Apply scroll translation to a layout node and its children
  private _applyScrollTranslation(node: LayoutNode, offsetX: number, offsetY: number): LayoutNode {
    const translatedNode: LayoutNode = {
      ...node,
      bounds: {
        ...node.bounds,
        x: node.bounds.x + offsetX,
        y: node.bounds.y + offsetY,
      },
      children: node.children.map(child => this._applyScrollTranslation(child, offsetX, offsetY)),
    };

    // Also translate contentBounds if it exists
    if (translatedNode.contentBounds) {
      translatedNode.contentBounds = {
        ...translatedNode.contentBounds,
        x: translatedNode.contentBounds.x + offsetX,
        y: translatedNode.contentBounds.y + offsetY,
      };
    }

    return translatedNode;
  }

  // Render background color
  private _renderBackground(bounds: Bounds, style: Style, buffer: DualBuffer): void {
    if (!style.backgroundColor) return;

    const cell: Cell = {
      char: ' ',
      background: style.backgroundColor,
    };

    buffer.currentBuffer.fillRect(bounds.x, bounds.y, bounds.width, bounds.height, cell);
  }

  // Render border (supports individual sides and colors)
  private _renderBorder(bounds: Bounds, style: Style, buffer: DualBuffer): void {
    const defaultColor = style.borderColor || style.color;

    // Check for individual border sides first, fallback to general border
    const borderTop = style.borderTop || (style.border && style.border !== 'none' ? style.border : undefined);
    const borderBottom = style.borderBottom || (style.border && style.border !== 'none' ? style.border : undefined);
    const borderLeft = style.borderLeft || (style.border && style.border !== 'none' ? style.border : undefined);
    const borderRight = style.borderRight || (style.border && style.border !== 'none' ? style.border : undefined);

    // If no borders defined, exit
    if (!borderTop && !borderBottom && !borderLeft && !borderRight) return;

    // Get individual border colors (fall back to borderColor, then color)
    const topColor = style.borderTopColor || defaultColor;
    const bottomColor = style.borderBottomColor || defaultColor;
    const leftColor = style.borderLeftColor || defaultColor;
    const rightColor = style.borderRightColor || defaultColor;

    // Create cell styles for each side
    const topStyle: Partial<Cell> = { foreground: topColor, background: style.backgroundColor };
    const bottomStyle: Partial<Cell> = { foreground: bottomColor, background: style.backgroundColor };
    const leftStyle: Partial<Cell> = { foreground: leftColor, background: style.backgroundColor };
    const rightStyle: Partial<Cell> = { foreground: rightColor, background: style.backgroundColor };

    // Get border characters (use the first available border style for consistency)
    const activeStyle = (borderTop || borderBottom || borderLeft || borderRight || 'thin') as Exclude<BorderStyle, 'none'>;
    const chars = BORDER_CHARS[activeStyle] || BORDER_CHARS.thin;

    // Draw individual border sides
    if (borderTop && borderTop !== 'none') {
      this._drawHorizontalLine(bounds.x, bounds.y, bounds.width, borderTop, topStyle, buffer, chars);
    }
    if (borderBottom && borderBottom !== 'none') {
      this._drawHorizontalLine(bounds.x, bounds.y + bounds.height - 1, bounds.width, borderBottom, bottomStyle, buffer, chars);
    }
    if (borderLeft && borderLeft !== 'none') {
      this._drawVerticalLine(bounds.x, bounds.y, bounds.height, borderLeft, leftStyle, buffer, chars);
    }
    if (borderRight && borderRight !== 'none') {
      this._drawVerticalLine(bounds.x + bounds.width - 1, bounds.y, bounds.height, borderRight, rightStyle, buffer, chars);
    }

    // Draw corners where borders meet (use top-left color priority for corners)
    if (borderTop && borderLeft) {
      buffer.currentBuffer.setCell(bounds.x, bounds.y, { char: chars.tl, ...topStyle });
    }
    if (borderTop && borderRight) {
      buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y, { char: chars.tr, ...topStyle });
    }
    if (borderBottom && borderLeft) {
      buffer.currentBuffer.setCell(bounds.x, bounds.y + bounds.height - 1, { char: chars.bl, ...bottomStyle });
    }
    if (borderBottom && borderRight) {
      buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y + bounds.height - 1, { char: chars.br, ...bottomStyle });
    }
  }

  // Draw horizontal line for borders
  private _drawHorizontalLine(x: number, y: number, width: number, borderStyle: string, style: Partial<Cell>, buffer: DualBuffer, chars: any): void {
    for (let i = 0; i < width; i++) {
      buffer.currentBuffer.setCell(x + i, y, { char: chars.h, ...style });
    }
  }

  // Draw vertical line for borders
  private _drawVerticalLine(x: number, y: number, height: number, borderStyle: string, style: Partial<Cell>, buffer: DualBuffer, chars: any): void {
    for (let i = 0; i < height; i++) {
      buffer.currentBuffer.setCell(x, y + i, { char: chars.v, ...style });
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
    const cellStyle: Partial<Cell> = {
      foreground: style.color,
      background: style.backgroundColor,
      bold: style.fontWeight === 'bold',
    };

    // Use viewport system only for scrollable containers
    let renderBuffer: DualBuffer | ViewportDualBuffer | ClippedDualBuffer = buffer;
    let elementViewport: Viewport | undefined;
    let coordinateTransform: CoordinateTransform | undefined;

    // Phase 3: Use viewport system for enhanced clipping
    if (context.clipRect && element.type === 'container' && element.props.scrollable) {
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
      // Use ClippedDualBuffer for normal clipping (non-scrollable)
      renderBuffer = new ClippedDualBuffer(buffer as DualBuffer, context.clipRect);
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
      };
      // Pass the overlays array from context if it exists
      if ((context as any).overlays) {
        (componentContext as any).overlays = (context as any).overlays;
      }
      // Pass the actual buffer, components will handle clipping through the buffer interface
      // Wrap in try/catch for error boundary
      try {
        element.render(bounds, cellStyle, renderBuffer as any, componentContext);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
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
  private _buildLayoutContext(node: LayoutNode, context: Map<string, LayoutNode>): void {
    if (node.element.id) {
      context.set(node.element.id, node);
    }
    for (const child of node.children) {
      this._buildLayoutContext(child, context);
    }
  }

  // Calculate actual content dimensions from rendered layout tree
  private _calculateActualContentDimensions(containerNode: LayoutNode): { width: number; height: number } {
    if (!containerNode.children || containerNode.children.length === 0) {
      return { width: 0, height: 0 };
    }

    // For block layout (vertical stacking), calculate dimensions properly
    let totalHeight = 0;
    const containerBounds = containerNode.bounds;

    // Calculate total height by summing child heights
    for (const child of containerNode.children) {
      totalHeight += child.bounds.height;
    }


    // For width, content should generally fit within the container bounds
    // unless there's explicit content overflow (like long unbreakable text)
    const contentWidth = containerBounds.width;

    return {
      width: contentWidth,
      height: totalHeight
    };
  }

  // Fallback method for estimated content dimensions (legacy)
  private _calculateEstimatedContentHeight(container: ContainerElement): number {
    if (!container.children || container.children.length === 0) return 0;

    // Calculate based on layout results - layout should always be available
    let totalHeight = 0;
    for (const child of container.children) {
      // Get actual laid out height
      const childLayoutNode = this._currentLayoutContext?.get(child.id || '');
      if (!childLayoutNode) {
        throw new Error(`No layout context found for child element ${child.id} - layout should always be available during rendering`);
      }

      const style = child.props.style || {};
      const marginBottom = typeof style.marginBottom === 'number' ? style.marginBottom : 0;
      totalHeight += childLayoutNode.bounds.height + marginBottom;
    }

    return totalHeight;
  }

  // Fallback method for estimated content width (legacy)
  private _calculateEstimatedContentWidth(container: ContainerElement): number {
    if (!container.children || container.children.length === 0) return 0;

    // Simple estimation - find longest text content
    let maxWidth = 0;
    for (const child of container.children) {
      if (child.type === 'text' && child.props.text) {
        maxWidth = Math.max(maxWidth, child.props.text.length);
      }
    }
    return maxWidth;
  }

  // Render vertical scrollbar
  private _renderVerticalScrollbar(
    bounds: Bounds,
    scrollY: number,
    contentHeight: number,
    style: Partial<Cell>,
    buffer: DualBuffer
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
    const thumbSize = Math.max(1, Math.min(scrollbarHeight, Math.floor(viewportRatio * scrollbarHeight)));

    // Calculate maximum scroll position
    const maxScrollY = Math.max(0, contentHeight - bounds.height);

    // Clamp scrollY to valid range
    const clampedScrollY = Math.max(0, Math.min(scrollY, maxScrollY));

    // Calculate thumb position (remaining space after accounting for thumb size)
    const availableTrackSpace = Math.max(1, scrollbarHeight - thumbSize);
    const scrollProgress = maxScrollY > 0 ? (clampedScrollY / maxScrollY) : 0;
    const thumbPosition = Math.min(availableTrackSpace, Math.floor(scrollProgress * availableTrackSpace));

    // Render scrollbar track
    const thumbColor = getThemeColor('scrollbarThumb') || style.foreground || 'white';
    const trackColor = getThemeColor('scrollbarTrack') || 'gray';

    for (let y = 0; y < scrollbarHeight; y++) {
      const char = (y >= thumbPosition && y < thumbPosition + thumbSize) ? '█' : '░';
      const color = (y >= thumbPosition && y < thumbPosition + thumbSize) ? thumbColor : trackColor;
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
    buffer: DualBuffer
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
    const thumbSize = Math.max(1, Math.min(scrollbarWidth, Math.floor(viewportRatio * scrollbarWidth)));

    // Calculate maximum scroll position
    const maxScrollX = Math.max(0, contentWidth - bounds.width);

    // Clamp scrollX to valid range
    const clampedScrollX = Math.max(0, Math.min(scrollX, maxScrollX));

    // Calculate thumb position (remaining space after accounting for thumb size)
    const availableTrackSpace = scrollbarWidth - thumbSize;
    const scrollProgress = maxScrollX > 0 ? (clampedScrollX / maxScrollX) : 0;
    const thumbPosition = Math.floor(scrollProgress * availableTrackSpace);

    // Render scrollbar track
    const thumbColor = getThemeColor('scrollbarThumb') || style.foreground || 'white';
    const trackColor = getThemeColor('scrollbarTrack') || 'gray';

    for (let x = 0; x < scrollbarWidth; x++) {
      const char = (x >= thumbPosition && x < thumbPosition + thumbSize) ? '█' : '░';
      const color = (x >= thumbPosition && x < thumbPosition + thumbSize) ? thumbColor : trackColor;
      buffer.currentBuffer.setText(bounds.x + x, scrollbarY, char, {
        foreground: color,
        background: style.background
      });
    }
  }

  // Get container bounds from current layout context
  // For scrollable containers, excludes scrollbar area
  getContainerBounds(containerId: string): Bounds | undefined {
    const layoutNode = this._currentLayoutContext?.get(containerId);
    if (!layoutNode) return undefined;

    // For scrollable containers, return content bounds minus scrollbar space
    if (layoutNode.element.type === 'container' && layoutNode.element.props.scrollable) {
      const contentBounds = layoutNode.contentBounds;

      // If no content bounds, fall back to element bounds
      if (!contentBounds) {
        return layoutNode.bounds;
      }

      // Check if vertical scrollbar is needed
      const contentDimensions = this.calculateScrollDimensions(layoutNode.element);
      const overflow = layoutNode.element.props.style?.overflow;
      const allowVertical = overflow !== 'scrollX';
      const needsVerticalScrollbar = allowVertical && contentDimensions.height > contentBounds.height;

      if (needsVerticalScrollbar) {
        // Reduce width by 2 chars (scrollbar + spacing) to match rendering
        return {
          x: contentBounds.x,
          y: contentBounds.y,
          width: Math.max(1, contentBounds.width - 2),
          height: contentBounds.height,
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

  // Calculate actual scroll dimensions for a scrollable container
  calculateScrollDimensions(container: Element): { width: number; height: number } {
    if (container.type !== 'container' || !container.props.scrollable) {
      return { width: 0, height: 0 };
    }

    // Get the container's layout node which now includes pre-calculated content dimensions
    const containerLayoutNode = this._currentLayoutContext?.get(container.id || '');
    if (!containerLayoutNode) {
      throw new Error(`No layout context found for container ${container.id} - layout should always be available during rendering`);
    }

    // Phase 2: Use layout-provided content dimensions if available
    if (containerLayoutNode.actualContentSize) {
      return containerLayoutNode.actualContentSize;
    }

    // Fallback: Use ContentMeasurer for backward compatibility
    const contentBounds = this._getContentBounds(containerLayoutNode.bounds, containerLayoutNode.computedStyle, true);
    const actualWidth = contentBounds.width;
    return globalContentMeasurer.measureContainer(container, actualWidth);
  }

  // Utility method to render a simple element tree for testing
  renderElement(element: Element, width: number, height: number): string {
    const defaultCell = {
      char: ' ',
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

  // Convert AdvancedLayoutNode to LayoutNode for backward compatibility
  private _convertAdvancedLayoutNode(advanced: AdvancedLayoutNode): LayoutNode {
    return {
      element: advanced.element,
      bounds: advanced.bounds,
      visible: advanced.visible,
      children: advanced.children.map(child => this._convertAdvancedLayoutNode(child)),
      computedStyle: advanced.computedStyle,
      contentBounds: advanced.contentBounds,
      layoutProps: advanced.layoutProps,
      boxModel: advanced.boxModel,
      zIndex: advanced.zIndex,
      // Phase 2 properties
      actualContentSize: advanced.actualContentSize,
      scrollbars: advanced.scrollbars,
    };
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
    };
    modal.render(viewport, modalCellStyle, buffer, componentContext);

    // Render the children using the layout system
    if (modal.children && modal.children.length > 0) {
      // Calculate dialog content area (inside the dialog borders)
      // Use props if provided, otherwise use defaults
      const widthProp = modal.props.width;
      const heightProp = modal.props.height;
      const dialogWidth = widthProp !== undefined
        ? (widthProp <= 1 ? Math.floor(viewport.width * widthProp) : Math.min(widthProp, viewport.width - 4))
        : Math.min(Math.floor(viewport.width * 0.8), 60);
      const dialogHeight = heightProp !== undefined
        ? (heightProp <= 1 ? Math.floor(viewport.height * heightProp) : Math.min(heightProp, viewport.height - 4))
        : Math.min(Math.floor(viewport.height * 0.7), 20);

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

      // Render each child in the content area
      for (const child of modal.children) {
        const childLayoutContext = {
          viewport: contentBounds,
          parentBounds: contentBounds,
          availableSpace: { width: contentBounds.width, height: contentBounds.height }
        };

        const childLayout = this._layoutEngine.calculateLayout(child, childLayoutContext);
        const childLayoutNode = this._convertAdvancedLayoutNode(childLayout);

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