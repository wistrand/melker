// Element click handling for Melker Engine
// Extracted from engine.ts to reduce file size

import { Document } from './document.ts';
import { RenderingEngine } from './rendering.ts';
import { HitTester } from './hit-test.ts';
import { Element, isClickable, ClickEvent, hasPositionalClickHandler } from './types.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('ElementClickHandler');

export interface ElementClickHandlerDeps {
  document: Document;
  renderer: RenderingEngine;
  hitTester: HitTester;
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
    logger.debug(`_handleElementClick: element.type=${element.type}, id=${element.id}, at (${event.x}, ${event.y})`);

    // Set focus on clickable elements
    if (this._deps.hitTester.isInteractiveElement(element) && element.id) {
      // Register element as focusable (idempotent operation)
      this._deps.onRegisterFocusable(element.id);

      // Focus the element - bounds should be registered via renderElementSubtree
      this._deps.onFocusElement(element.id);

      // Auto-render to show focus changes (cursor, highlighting, etc.)
      if (this._deps.autoRender) {
        this._deps.onRender();
      }
    }

    // Handle clicks on Clickable elements (button, checkbox, radio, etc.)
    // Note: markdown has handleClick but with different signature (x, y) - handled separately below
    logger.debug(`Checking isClickable for ${element.type}/${element.id}: ${isClickable(element)}`);
    if (isClickable(element) && element.type !== 'markdown') {
      const clickEvent: ClickEvent = {
        type: 'click',
        target: element,
        position: { x: event.x, y: event.y },
        timestamp: Date.now(),
      };

      logger.debug(`Calling handleClick on ${element.type}/${element.id}`);
      const handled = element.handleClick(clickEvent, this._deps.document);
      logger.debug(`handleClick returned: ${handled}`);

      if (handled && this._deps.autoRender) {
        this._deps.onRender();
      }
    }

    // Handle markdown element clicks (for link detection)
    if (element.type === 'markdown' && hasPositionalClickHandler(element)) {
      logger.debug(`Engine: Markdown element clicked at (${event.x}, ${event.y}), hasHandleClick: true`);
      // Pass absolute coordinates - markdown tracks its own render bounds
      const handled = element.handleClick(event.x, event.y);
      logger.debug(`Engine: Markdown handleClick returned: ${handled}`);
      if (handled && this._deps.autoRender) {
        this._deps.onRender();
      }
    }

    // Handle textarea clicks (position cursor)
    if (element.type === 'textarea' && hasPositionalClickHandler(element)) {
      const bounds = this._deps.renderer.getContainerBounds(element.id || '');
      if (bounds) {
        const relativeX = event.x - bounds.x;
        const relativeY = event.y - bounds.y;
        const handled = element.handleClick(relativeX, relativeY);
        if (handled && this._deps.autoRender) {
          this._deps.onRender();
        }
      }
    }

    // Handle canvas-derived element clicks (canvas, img, video, progress)
    if (element.type === 'canvas' || element.type === 'img' || element.type === 'video' || element.type === 'progress') {
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

  }
}
