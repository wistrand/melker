// Element click handling for Melker Engine
// Extracted from engine.ts to reduce file size

import { Document } from './document.ts';
import { RenderingEngine } from './rendering.ts';
import { HitTester } from './hit-test.ts';
import { Element, isClickable, ClickEvent } from './types.ts';
import { createMouseEvent } from './events.ts';
import { type ComponentLogger } from './logging.ts';

export interface ElementClickHandlerDeps {
  document: Document;
  renderer: RenderingEngine;
  hitTester: HitTester;
  logger?: ComponentLogger;
  autoRender: boolean;
  onRender: () => void;
  onRegisterFocusable: (elementId: string) => void;
  onFocusElement: (elementId: string) => boolean;
}

/**
 * Handles element click events for the Melker engine
 */
export class ElementClickHandler {
  private _deps: ElementClickHandlerDeps;

  constructor(deps: ElementClickHandlerDeps) {
    this._deps = deps;
  }

  /**
   * Handle element clicks (focus, button activation, etc.)
   */
  handleElementClick(element: Element, event: any): void {
    this._deps.logger?.debug(`_handleElementClick: element.type=${element.type}, id=${element.id}, at (${event.x}, ${event.y})`);

    // Set focus on clickable elements
    if (this._deps.hitTester.isInteractiveElement(element) && element.id) {
      // Always ensure element is registered before focusing
      try {
        this._deps.onRegisterFocusable(element.id);
      } catch (_error) {
        // Element might already be registered, that's fine
      }

      // Now focus the element (should always work since we just registered it)
      try {
        this._deps.onFocusElement(element.id);

        // Auto-render to show focus changes (cursor, highlighting, etc.)
        if (this._deps.autoRender) {
          this._deps.onRender();
        }
      } catch (_focusError) {
        // Focus failed even after registration - this shouldn't happen
      }
    }

    // Handle clicks on Clickable elements (button, checkbox, radio, etc.)
    if (isClickable(element)) {
      const clickEvent: ClickEvent = {
        type: 'click',
        target: element,
        position: { x: event.x, y: event.y },
        timestamp: Date.now(),
      };

      const handled = element.handleClick(clickEvent, this._deps.document);

      if (handled && this._deps.autoRender) {
        this._deps.onRender();
      }
    }

    // Handle menu-bar clicks
    if (element.type === 'menu-bar') {
      // Convert global coordinates to menu-bar relative coordinates
      const bounds = this._deps.renderer.getContainerBounds(element.id || '');
      if (bounds && (element as any).handleClick) {
        const relativeX = event.x - bounds.x;
        const relativeY = event.y - bounds.y;
        (element as any).handleClick(relativeX, relativeY);

        // Auto-render to show menu changes
        if (this._deps.autoRender) {
          this._deps.onRender();
        }
      }
    }

    // Handle markdown element clicks (for link detection)
    if (element.type === 'markdown') {
      this._deps.logger?.debug(`Engine: Markdown element clicked at (${event.x}, ${event.y}), hasHandleClick: ${!!(element as any).handleClick}`);
      if ((element as any).handleClick) {
        // Pass absolute coordinates - markdown tracks its own render bounds
        const handled = (element as any).handleClick(event.x, event.y);
        this._deps.logger?.debug(`Engine: Markdown handleClick returned: ${handled}`);
        if (handled && this._deps.autoRender) {
          this._deps.onRender();
        }
      }
    }

    // Handle textarea clicks (position cursor)
    if (element.type === 'textarea') {
      const bounds = this._deps.renderer.getContainerBounds(element.id || '');
      if (bounds && (element as any).handleClick) {
        const relativeX = event.x - bounds.x;
        const relativeY = event.y - bounds.y;
        const handled = (element as any).handleClick(relativeX, relativeY);
        if (handled && this._deps.autoRender) {
          this._deps.onRender();
        }
      }
    }

    // Handle canvas clicks (color picker, drawing, etc.)
    if (element.type === 'canvas') {
      if (typeof element.props.onClick === 'function') {
        const clickEvent: ClickEvent = {
          type: 'click',
          target: element,
          position: { x: event.x, y: event.y },
          timestamp: Date.now(),
        };
        element.props.onClick(clickEvent);
        if (this._deps.autoRender) {
          this._deps.onRender();
        }
      }
    }

    // Handle menu-item clicks
    if (element.type === 'menu-item') {
      let handled = false;

      if ((element as any).handleClick) {
        // Use class method if available
        (element as any).handleClick();
        handled = true;
      } else if (typeof element.props.onClick === 'function') {
        // Call onClick handler directly for template-created menu items
        const clickEvent = createMouseEvent(
          'click',
          event.x,
          event.y,
          event.button || 0,
          1,
          element.id
        );
        element.props.onClick(clickEvent);
        handled = true;
      }

      if (handled) {
        // Close the parent menu after clicking a menu item
        this.closeOpenMenus();

        // Auto-render to show any changes
        if (this._deps.autoRender) {
          this._deps.onRender();
        }
      }
    }
  }

  /**
   * Close all open menus
   */
  closeOpenMenus(): void {
    const menuBars = this._deps.document.getElementsByType('menu-bar');
    for (const menuBar of menuBars) {
      const getOpenMenu = (menuBar as any).getOpenMenu;
      if (getOpenMenu && typeof getOpenMenu === 'function') {
        const openMenu = getOpenMenu.call(menuBar);
        if (openMenu && openMenu.props.visible) {
          // Call deactivate if available
          if ((menuBar as any)._deactivate) {
            (menuBar as any)._deactivate();
          } else {
            // Manually close menu
            openMenu.props.visible = false;
            if ((menuBar as any)._openMenu) {
              (menuBar as any)._openMenu = null;
            }
            if ((menuBar as any)._isActivated !== undefined) {
              (menuBar as any)._isActivated = false;
            }
          }
        }
      }
    }
  }
}
