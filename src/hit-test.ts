// Hit testing for finding elements at screen coordinates
// Handles dialogs, menus, and regular element tree traversal

import { Element, isInteractive, isTextSelectable } from './types.ts';
import { Document } from './document.ts';
import { RenderingEngine } from './rendering.ts';
import { ComponentLogger } from './logging.ts';

export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };

export interface HitTestContext {
  document: Document;
  renderer: RenderingEngine;
  viewportSize: { width: number; height: number };
  logger?: ComponentLogger;
}

/**
 * Hit testing system for finding elements at screen coordinates.
 * Handles overlay elements (dialogs, menus) and regular element tree traversal.
 */
export class HitTester {
  private _document: Document;
  private _renderer: RenderingEngine;
  private _viewportSize: { width: number; height: number };
  private _logger?: ComponentLogger;

  constructor(context: HitTestContext) {
    this._document = context.document;
    this._renderer = context.renderer;
    this._viewportSize = context.viewportSize;
    this._logger = context.logger;
  }

  /**
   * Update context (e.g., when viewport resizes)
   */
  updateContext(context: Partial<HitTestContext>): void {
    if (context.document) this._document = context.document;
    if (context.renderer) this._renderer = context.renderer;
    if (context.viewportSize) this._viewportSize = context.viewportSize;
    if (context.logger !== undefined) this._logger = context.logger;
  }

  /**
   * Hit testing to find the element at given coordinates
   */
  hitTest(x: number, y: number): Element | undefined {
    // Trace logging for hit test events
    this._logger?.trace('Hit test triggered', {
      mouseX: x,
      mouseY: y,
    });

    // First check open dialogs (they are rendered as top-most overlays)
    const dialogHit = this._hitTestOpenDialogs(x, y);
    if (dialogHit) {
      return dialogHit;
    }

    // Then check open menus (they are rendered as overlays on top)
    const menuHit = this._hitTestOpenMenus(x, y);
    if (menuHit) {
      return menuHit;
    }

    // We need to traverse the layout tree to find which element is at the given coordinates
    // Start with no scroll offset accumulation
    return this._hitTestElement(this._document.root, x, y, 0, 0);
  }

  /**
   * Check if a point is within bounds
   */
  pointInBounds(x: number, y: number, bounds: Bounds): boolean {
    return x >= bounds.x && x < bounds.x + bounds.width &&
           y >= bounds.y && y < bounds.y + bounds.height;
  }

  /**
   * Check if an element is interactive (can receive mouse events)
   */
  isInteractiveElement(element: Element): boolean {
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
   * Clamp a position to within the given bounds
   */
  clampToBounds(pos: Point, bounds: Bounds): Point {
    return {
      x: Math.max(bounds.x, Math.min(bounds.x + bounds.width - 1, pos.x)),
      y: Math.max(bounds.y, Math.min(bounds.y + bounds.height - 1, pos.y)),
    };
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

      // Calculate dialog bounds (centered in viewport)
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
      const dialogX = Math.floor((viewportWidth - dialogWidth) / 2);
      const dialogY = Math.floor((viewportHeight - dialogHeight) / 2);

      const dialogBounds = {
        x: dialogX,
        y: dialogY,
        width: dialogWidth,
        height: dialogHeight
      };

      // Check if click is within dialog bounds
      if (this.pointInBounds(x, y, dialogBounds)) {
        // Calculate content area bounds (inside borders and title)
        const titleHeight = dialog.props.title ? 3 : 1;
        const contentBounds = {
          x: dialogBounds.x + 1,
          y: dialogBounds.y + titleHeight,
          width: dialogBounds.width - 2,
          height: dialogBounds.height - titleHeight - 1
        };

        // Search for interactive elements within dialog children
        const hit = this._hitTestDialogChildren(dialog, x, y, contentBounds);
        if (hit) {
          return hit;
        }

        // Click is in dialog but not on an interactive element
        return dialog;
      }
    }

    return undefined;
  }

  /**
   * Hit test dialog children recursively using rendered bounds
   */
  private _hitTestDialogChildren(element: Element, x: number, y: number, _contentBounds: Bounds): Element | undefined {
    if (!element.children || element.children.length === 0) {
      return undefined;
    }

    for (const child of element.children) {
      // Try to get the rendered bounds for this child
      const childBounds = child.id ? this._renderer.getContainerBounds(child.id) : undefined;

      if (childBounds && this.pointInBounds(x, y, childBounds)) {
        // If it's a container, recursively search its children FIRST
        if (child.type === 'container' && child.children && child.children.length > 0) {
          const nestedHit = this._hitTestDialogChildren(child, x, y, childBounds);
          if (nestedHit) {
            return nestedHit;
          }
        }

        // If it's an interactive or text-selectable element, return it
        if (this.isInteractiveElement(child) || this.isTextSelectableElement(child)) {
          return child;
        }
      } else if (!childBounds) {
        // No bounds stored - check recursively if has children, or return if interactive
        if (child.children && child.children.length > 0) {
          const nestedHit = this._hitTestDialogChildren(child, x, y, _contentBounds);
          if (nestedHit) {
            return nestedHit;
          }
        } else if (this.isInteractiveElement(child) && this.pointInBounds(x, y, _contentBounds)) {
          // Interactive element without stored bounds - use parent content bounds
          return child;
        }
      }
    }

    return undefined;
  }

  /**
   * Hit test open menus (rendered as overlays)
   */
  private _hitTestOpenMenus(x: number, y: number): Element | undefined {
    // Find all menu-bars in the document
    const menuBars = this._document.getElementsByType('menu-bar');

    for (const menuBar of menuBars) {
      // Check if menu-bar has an open menu
      const getOpenMenu = (menuBar as any).getOpenMenu;
      if (!getOpenMenu || typeof getOpenMenu !== 'function') {
        continue;
      }

      const openMenu = getOpenMenu.call(menuBar);
      if (!openMenu || !openMenu.props.visible) {
        continue;
      }

      // Get menu-bar bounds to calculate menu position
      const menuBarBounds = this._renderer.getContainerBounds(menuBar.id || '');
      if (!menuBarBounds) {
        continue;
      }

      // Calculate menu bounds (below menu-bar)
      // Get menu intrinsic size
      let menuWidth = 20;
      let menuHeight = 3;
      if (openMenu.intrinsicSize) {
        const size = openMenu.intrinsicSize({});
        menuWidth = size.width;
        menuHeight = size.height;
      }

      // Calculate X position based on selected menu index
      let menuX = menuBarBounds.x + 1;
      const selectedIndex = (menuBar as any)._selectedMenuIndex || 0;
      const menus = (menuBar as any).props.menus || [];
      for (let i = 0; i < selectedIndex && i < menus.length; i++) {
        const title = menus[i].props.title || `Menu ${i + 1}`;
        menuX += title.length + 2;
      }

      const menuBounds = {
        x: menuX,
        y: menuBarBounds.y + 1, // Below menu-bar
        width: Math.min(menuWidth, 50),
        height: Math.min(menuHeight, 15)
      };

      // Check if click is within menu bounds
      if (this.pointInBounds(x, y, menuBounds)) {
        // Calculate which menu item was clicked based on y position
        // Menu items start at y + 1 (inside border)
        const relativeY = y - menuBounds.y - 1; // -1 for top border

        if (relativeY >= 0 && relativeY < openMenu.children.length) {
          const clickedItem = openMenu.children[relativeY];
          if (clickedItem && (clickedItem.type === 'menu-item' || clickedItem.type === 'menu-separator')) {
            this._logger?.trace('Hit test found menu item', {
              menuItemId: clickedItem.id,
              relativeY,
              x,
              y
            });
            // Return the menu item (only if it's interactive)
            if (clickedItem.type === 'menu-item' && !clickedItem.props.disabled) {
              return clickedItem;
            }
          }
        }

        // Click is in menu but not on an item, return the menu itself
        return openMenu;
      }
    }

    return undefined;
  }

  /**
   * Recursively test an element and its children for hit testing
   * @param element - Element to test
   * @param x - Mouse x coordinate
   * @param y - Mouse y coordinate
   * @param scrollOffsetX - Accumulated scroll offset in X direction
   * @param scrollOffsetY - Accumulated scroll offset in Y direction
   */
  private _hitTestElement(element: Element, x: number, y: number, scrollOffsetX: number, scrollOffsetY: number): Element | undefined {
    // Skip invisible elements - they don't participate in hit testing
    if (element.props?.visible === false) return undefined;

    // Get element bounds from the renderer if available
    const bounds = this._renderer.getContainerBounds(element.id || '');

    this._logger?.trace('Hit test element', {
      type: element.type,
      id: element.id,
      hasBounds: !!bounds,
      bounds: bounds ? `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}` : 'none',
      point: `${x},${y}`,
      inBounds: bounds ? this.pointInBounds(x, y, bounds) : false,
    });

    if (bounds && this.pointInBounds(x, y, bounds)) {
      // For scrollable containers, transform coordinates for children
      let childX = x;
      let childY = y;

      if (element.type === 'container' && element.props.scrollable) {
        const elementScrollX = (element.props.scrollX as number) || 0;
        const elementScrollY = (element.props.scrollY as number) || 0;

        // Transform coordinates for children by this container's scroll offset
        childX = x - elementScrollX;
        childY = y - elementScrollY;

        // Trace logging for all scrollable containers
        this._logger?.trace('Hit test with scrollable container', {
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

      // Check children first (they are on top)
      if (element.children) {
        for (const child of element.children) {
          // Use transformed coordinates for children, but keep original accumulated offsets for tracking
          const hitChild = this._hitTestElement(child, childX, childY, scrollOffsetX, scrollOffsetY);
          if (hitChild) {
            return hitChild;
          }
        }
      }

      // If no child hit, return this element if it's interactive or text-selectable
      if (this.isInteractiveElement(element) || this.isTextSelectableElement(element)) {
        return element;
      }
    }

    return undefined;
  }
}
