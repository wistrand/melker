// Hit testing for finding elements at screen coordinates
// Handles dialogs and regular element tree traversal

import { Element, isInteractive, isTextSelectable, isScrollableType, isFocusCapturable } from './types.ts';
import { Document } from './document.ts';
import { RenderingEngine } from './rendering.ts';
import { getLogger } from './logging.ts';
import { Point, Bounds, pointInBounds } from './geometry.ts';

export type { Point, Bounds };

const logger = getLogger('hit-test');

export interface HitTestContext {
  document: Document;
  renderer: RenderingEngine;
  viewportSize: { width: number; height: number };
}

/**
 * Hit testing system for finding elements at screen coordinates.
 * Handles overlay elements (dialogs) and regular element tree traversal.
 */
export class HitTester {
  private _document: Document;
  private _renderer: RenderingEngine;
  private _viewportSize: { width: number; height: number };

  constructor(context: HitTestContext) {
    this._document = context.document;
    this._renderer = context.renderer;
    this._viewportSize = context.viewportSize;
  }

  /**
   * Update context (e.g., when viewport resizes)
   */
  updateContext(context: Partial<HitTestContext>): void {
    if (context.document) this._document = context.document;
    if (context.renderer) this._renderer = context.renderer;
    if (context.viewportSize) this._viewportSize = context.viewportSize;
  }

  /**
   * Hit testing to find the element at given coordinates
   */
  hitTest(x: number, y: number): Element | undefined {
    // Debug logging for hit test events
    logger.trace(`Hit test at (${x}, ${y})`);

    // First check open dialogs (they are rendered as top-most overlays)
    const dialogHit = this._hitTestOpenDialogs(x, y);
    if (dialogHit) {
      return dialogHit;
    }

    // We need to traverse the layout tree to find which element is at the given coordinates
    // Start with no scroll offset accumulation
    const result = this._hitTestElement(this._document.root, x, y, 0, 0);
    logger.trace(`Hit test result: ${result?.type}/${result?.id}, isClickable=${result ? 'handleClick' in result : 'N/A'}`);
    return result;
  }

  /**
   * Check if an element is interactive (can receive mouse events)
   */
  isInteractiveElement(element: Element): boolean {
    // Elements with mouse handlers are interactive
    if (element.props) {
      if (typeof element.props.onClick === 'function') return true;
      if (typeof element.props.onMouseMove === 'function') return true;
      if (typeof element.props.onMouseOver === 'function') return true;
      if (typeof element.props.onMouseOut === 'function') return true;
      if (typeof element.props.onMouseDown === 'function') return true;
      if (typeof element.props.onMouseUp === 'function') return true;
      // Elements with shaders need mouse tracking for source.mouse
      if (element.props.onShader) return true;
    }
    if (isInteractive(element)) {
      return element.isInteractive();
    }
    return false;
  }

  /**
   * Check if an element supports text selection
   */
  isTextSelectableElement(element: Element): boolean {
    if (isTextSelectable(element)) {
      return element.isTextSelectable();
    }
    return false;
  }

  /**
   * Hit test open dialogs (rendered as top-most overlays)
   */
  private _hitTestOpenDialogs(x: number, y: number): Element | undefined {
    // Find all dialogs in the document
    const dialogs = this._document.getElementsByType('dialog');

    for (const dialog of dialogs) {
      // Check if dialog is open
      if (!dialog.props.open) {
        continue;
      }

      // Calculate dialog bounds (centered in viewport, with drag offset)
      const viewportWidth = this._viewportSize.width;
      const viewportHeight = this._viewportSize.height;
      const widthProp = dialog.props.width;
      const heightProp = dialog.props.height;
      const dialogWidth = widthProp !== undefined
        ? (widthProp <= 1 ? Math.floor(viewportWidth * widthProp) : Math.min(widthProp as number, viewportWidth - 4))
        : Math.min(Math.floor(viewportWidth * 0.8), 60);
      const dialogHeight = heightProp !== undefined
        ? (heightProp <= 1 ? Math.floor(viewportHeight * heightProp) : Math.min(heightProp as number, viewportHeight - 4))
        : Math.min(Math.floor(viewportHeight * 0.7), 20);

      // Apply drag offset to centered position
      const offsetX = (dialog.props.offsetX as number) || 0;
      const offsetY = (dialog.props.offsetY as number) || 0;
      const dialogX = Math.floor((viewportWidth - dialogWidth) / 2) + offsetX;
      const dialogY = Math.floor((viewportHeight - dialogHeight) / 2) + offsetY;

      const dialogBounds = {
        x: dialogX,
        y: dialogY,
        width: dialogWidth,
        height: dialogHeight
      };

      // Check if click is within dialog bounds
      if (pointInBounds(x, y, dialogBounds)) {
        // Calculate content area bounds (inside borders and title)
        const titleHeight = dialog.props.title ? 3 : 1;
        const contentBounds = {
          x: dialogBounds.x + 1,
          y: dialogBounds.y + titleHeight,
          width: dialogBounds.width - 2,
          height: dialogBounds.height - titleHeight - 1
        };

        logger.trace('Dialog hit test', {
          dialogId: dialog.id,
          clickPos: `${x},${y}`,
          contentBounds: `${contentBounds.x},${contentBounds.y} ${contentBounds.width}x${contentBounds.height}`,
          childCount: dialog.children?.length || 0
        });

        // Search for interactive elements within dialog children
        const hit = this._hitTestDialogChildren(dialog, x, y, contentBounds);
        if (hit) {
          logger.debug('Dialog hit test result', { hitId: hit.id, hitType: hit.type });
          return hit;
        }

        // Click is in dialog but not on an interactive element
        logger.debug('Dialog hit test - no hit, returning dialog');
        return dialog;
      }

      // Click is outside dialog bounds - if modal, block interaction with elements behind
      if (dialog.props.modal) {
        logger.debug('Modal dialog blocking click outside bounds', { dialogId: dialog.id });
        return dialog;
      }
    }

    return undefined;
  }

  /**
   * Hit test dialog children recursively using rendered bounds
   * @param containingTable - Track the containing table for table part handling
   */
  private _hitTestDialogChildren(element: Element, x: number, y: number, _contentBounds: Bounds, containingTable?: Element): Element | undefined {
    if (!element.children || element.children.length === 0) {
      return undefined;
    }

    for (const child of element.children) {
      // Skip invisible elements - they don't participate in hit testing
      if (child.props?.visible === false) continue;

      // Track if we're entering a table
      const isTable = child.type === 'table';
      const tableForChildren = isTable ? child : containingTable;

      // Try to get the rendered bounds for this child
      const childBounds = child.id ? this._renderer.getContainerBounds(child.id) : undefined;

      logger.debug('Dialog hit test child', {
        childId: child.id,
        childType: child.type,
        hasBounds: !!childBounds,
        childBounds: childBounds ? `${childBounds.x},${childBounds.y} ${childBounds.width}x${childBounds.height}` : 'none',
        clickPos: `${x},${y}`,
        inBounds: childBounds ? pointInBounds(x, y, childBounds) : false,
        isTextSelectable: this.isTextSelectableElement(child),
        hasChildren: !!(child.children && child.children.length > 0)
      });

      if (childBounds && pointInBounds(x, y, childBounds)) {
        // Check if this component captures focus for all its children
        // If so, return this component instead of searching children
        if (isFocusCapturable(child) &&
            child.capturesFocusForChildren() &&
            this.isInteractiveElement(child)) {
          logger.debug('Dialog hit test found (captures focus for children)', { id: child.id, type: child.type });
          return child;
        }

        // If it has children, recursively search them FIRST (not just containers - also tabs, etc.)
        if (child.children && child.children.length > 0) {
          const nestedHit = this._hitTestDialogChildren(child, x, y, childBounds, tableForChildren);
          if (nestedHit) {
            return nestedHit;
          }
        }

        // If it's an interactive or text-selectable element, return it
        if (this.isInteractiveElement(child) || this.isTextSelectableElement(child)) {
          logger.debug('Dialog hit test found', { id: child.id, type: child.type });
          return child;
        }

        // Special handling for table parts: if we're inside a table and hit a table part,
        // return the containing table instead (if it's interactive)
        if (this._isTablePart(child) && containingTable && this.isInteractiveElement(containingTable)) {
          logger.debug(`Dialog hit test: table part ${child.type}/${child.id} -> returning table ${containingTable.id}`);
          return containingTable;
        }
      } else if (!childBounds) {
        // No bounds stored - check recursively if has children, or return if interactive/text-selectable
        if (child.children && child.children.length > 0) {
          const nestedHit = this._hitTestDialogChildren(child, x, y, _contentBounds, tableForChildren);
          if (nestedHit) {
            return nestedHit;
          }
        } else if ((this.isInteractiveElement(child) || this.isTextSelectableElement(child)) && pointInBounds(x, y, _contentBounds)) {
          // Interactive or text-selectable element without stored bounds - use parent content bounds
          logger.debug('Dialog hit test found (no bounds)', { id: child.id, type: child.type });
          return child;
        }
      }
    }

    return undefined;
  }

  /**
   * Check if an element is a table internal part (not the table itself)
   * These elements should not be returned from hit testing - clicks should go to the table
   */
  private _isTablePart(element: Element): boolean {
    return element.type === 'tbody' || element.type === 'thead' || element.type === 'tfoot' ||
           element.type === 'tr' || element.type === 'td' || element.type === 'th';
  }

  /**
   * Find the containing table for a table part element
   */
  private _findContainingTable(element: Element): Element | undefined {
    // Walk up the element tree to find the table
    // Since we don't have parent pointers, we need to search from the root
    return this._findTableContaining(this._document.root, element);
  }

  private _findTableContaining(current: Element, target: Element): Element | undefined {
    if (current.type === 'table') {
      // Check if this table contains the target
      if (this._containsElement(current, target)) {
        return current;
      }
    }
    if (current.children) {
      for (const child of current.children) {
        const result = this._findTableContaining(child, target);
        if (result) return result;
      }
    }
    return undefined;
  }

  private _containsElement(parent: Element, target: Element): boolean {
    if (parent === target) return true;
    if (parent.children) {
      for (const child of parent.children) {
        if (this._containsElement(child, target)) return true;
      }
    }
    return false;
  }

  /**
   * Recursively test an element and its children for hit testing
   * @param element - Element to test
   * @param x - Mouse x coordinate
   * @param y - Mouse y coordinate
   * @param scrollOffsetX - Accumulated scroll offset in X direction
   * @param scrollOffsetY - Accumulated scroll offset in Y direction
   * @param containingTable - The containing table element if we're inside a table
   */
  private _hitTestElement(element: Element, x: number, y: number, scrollOffsetX: number, scrollOffsetY: number, containingTable?: Element): Element | undefined {
    // Skip invisible elements - they don't participate in hit testing
    if (element.props?.visible === false) return undefined;

    // Get element bounds from the renderer if available
    const bounds = this._renderer.getContainerBounds(element.id || '');

    // Track if we're inside a table
    const isTable = element.type === 'table';
    const tableForChildren = isTable ? element : containingTable;

    // Log for table, container, select, combobox, and segment-display elements
    if (isTable || element.type === 'container' || element.type === 'select' || element.type === 'combobox' || element.type === 'segment-display') {
      const isInt = this.isInteractiveElement(element);
      const isTextSel = this.isTextSelectableElement(element);
      logger.debug(`Hit test ${element.type}: id=${element.id}, pos=(${x},${y}), hasBounds=${!!bounds}, bounds=${bounds ? `(${bounds.x},${bounds.y}) ${bounds.width}x${bounds.height}` : 'none'}, inBounds=${bounds ? pointInBounds(x, y, bounds) : false}, isInteractive=${isInt}, isTextSelectable=${isTextSel}`);
    }

    // For scrollable containers with bounds, transform coordinates for children
    // But ONLY if the click is within the scrollable container's bounds
    let childX = x;
    let childY = y;
    let isInsideScrollable = true;

    if (bounds && isScrollableType(element.type) && element.props.scrollable) {
      // If click is outside the scrollable container's bounds, don't search its children
      if (!pointInBounds(x, y, bounds)) {
        isInsideScrollable = false;
      } else {
        const elementScrollX = (element.props.scrollX as number) || 0;
        const elementScrollY = (element.props.scrollY as number) || 0;

        // Transform screen coordinates to content coordinates by ADDING scroll offset
        // (rendering subtracts scroll, so hit test must add to invert)
        childX = x + elementScrollX;
        childY = y + elementScrollY;

        // Trace logging for all scrollable containers
        logger.trace('Hit test with scrollable container', {
          elementId: element.id || 'unknown',
          elementScrollX,
          elementScrollY,
          mouseX: x,
          mouseY: y,
          transformedChildX: childX,
          transformedChildY: childY,
          hasScrollX: elementScrollX !== 0,
          hasScrollY: elementScrollY !== 0,
        });
      }
    }

    // Check if this component captures focus for all its children
    // If so, return this component instead of searching children
    if (bounds && pointInBounds(x, y, bounds) &&
        isFocusCapturable(element) &&
        element.capturesFocusForChildren() &&
        this.isInteractiveElement(element)) {
      logger.debug('Hit test found (captures focus for children)', { id: element.id, type: element.type });
      return element;
    }

    // Check children first (they are on top)
    // IMPORTANT: Always check children even if parent has no bounds (anonymous containers)
    // BUT skip children of scrollable containers if click is outside their bounds
    if (element.children && isInsideScrollable) {
      for (const child of element.children) {
        // Use transformed coordinates for children, but keep original accumulated offsets for tracking
        const hitChild = this._hitTestElement(child, childX, childY, scrollOffsetX, scrollOffsetY, tableForChildren);
        if (hitChild) {
          return hitChild;
        }
      }
    }

    // If we have bounds and point is inside, check if this element should be returned
    if (bounds && pointInBounds(x, y, bounds)) {
      // If no child hit, check if this element should be returned
      if (this.isInteractiveElement(element) || this.isTextSelectableElement(element)) {
        return element;
      }

      // Special handling for table parts: if we're inside a table and hit a table part,
      // return the containing table instead (if it's interactive)
      if (this._isTablePart(element) && containingTable && this.isInteractiveElement(containingTable)) {
        logger.debug(`Hit test: table part ${element.type}/${element.id} -> returning table ${containingTable.id}`);
        return containingTable;
      }
    }

    return undefined;
  }
}
