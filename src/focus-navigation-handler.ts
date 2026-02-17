// Focus navigation handling for Melker Engine
// Extracted from engine.ts to reduce file size

import { Document } from './document.ts';
import { FocusManager } from './focus.ts';
import { HitTester } from './hit-test.ts';
import { Element, isFocusable } from './types.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('FocusNavigation');

export interface FocusNavigationHandlerDeps {
  document: Document;
  focusManager: FocusManager;
  hitTester: HitTester;
  autoRender: boolean;
  onRender: () => void;
  onRegisterFocusable: (elementId: string) => void;
  onFocusElement: (elementId: string) => boolean;
}

/**
 * Handles focus navigation and element tree traversal for the Melker engine
 */
export class FocusNavigationHandler {
  private _deps: FocusNavigationHandlerDeps;

  constructor(deps: FocusNavigationHandlerDeps) {
    this._deps = deps;
  }

  /**
   * Automatically detect and register focusable elements
   */
  autoRegisterFocusableElements(skipAutoRender = false): void {
    if (!this._deps.document) return;

    const focusableElements = this.findFocusableElements(this._deps.document.root);

    // Debug logging for focus registration
    logger.trace('Auto-registering focusable elements', {
      totalElements: focusableElements.length,
      elementTypes: focusableElements.map(el => ({ type: el.type, id: el.id || 'no-id' })),
    });

    // Collect all valid focusable element IDs
    const currentIds = new Set<string>();
    for (const element of focusableElements) {
      if (element.id) {
        currentIds.add(element.id);
      }
    }

    // Sync focus manager - removes stale IDs and adds new ones
    this._deps.focusManager.syncFocusableElements(currentIds);

    // Only auto-focus if NO element is focused and we have focusable elements
    if (!this._deps.document.focusedElement && focusableElements.length > 0) {
      const firstFocusable = focusableElements[0];
      if (firstFocusable?.id) {
        try {
          const focused = this._deps.onFocusElement(firstFocusable.id);
          // Auto-render to show initial focus state (unless skipped)
          // Only render if focus actually succeeded to avoid infinite loop
          if (focused && this._deps.autoRender && !skipAutoRender) {
            this._deps.onRender();
          }
        } catch (_error) {
          // Focus failed, ignore
        }
      }
    }
  }

  /**
   * Find all focusable elements in the element tree
   * Also searches mermaid elements inside markdown components
   */
  findFocusableElements(element: Element): Element[] {
    const focusableElements: Element[] = [];

    // Skip invisible branches entirely — elements inside invisible parents
    // are never focusable, so there's no need to recurse into them
    if (element.props.visible === false) return focusableElements;
    if (element.type === 'dialog' && element.props.open !== true) return focusableElements;

    // Debug logging for element inspection
    if (element.type === 'button') {
      logger.trace('Found button element during focus detection', {
        type: element.type,
        id: element.id || 'no-id',
        hasCanReceiveFocus: isFocusable(element),
        isInteractive: this._deps.hitTester.isInteractiveElement(element),
        disabled: element.props.disabled,
      });
    }

    // Check if element can receive focus using the Focusable interface
    if (isFocusable(element)) {
      try {
        if (element.canReceiveFocus()) {
          focusableElements.push(element);
        }
      } catch (error) {
        // Fallback: element might not properly implement canReceiveFocus
        logger.warn(`Error checking focus capability for element ${element.type}`, { error: String(error) });
      }
    } else if (this._deps.hitTester.isInteractiveElement(element) && element.id) {
      // Fallback for interactive elements without canReceiveFocus method
      // Only include if element has an ID and is not disabled
      if (!element.props.disabled) {
        logger.trace('Adding interactive element to focusable list', {
          type: element.type,
          id: element.id,
        });
        focusableElements.push(element);
      }
    }

    // Check mermaid elements if this is a markdown component
    // Mermaid elements are not in the document tree but contain interactive elements
    if (element.type === 'markdown') {
      const markdown = element as any;
      if (typeof markdown.getMermaidElements === 'function') {
        const mermaidElements = markdown.getMermaidElements() as Element[];
        for (const mermaidRoot of mermaidElements) {
          focusableElements.push(...this.findFocusableElements(mermaidRoot));
        }
      }
    }

    if (element.children) {
      for (const child of element.children) {
        focusableElements.push(...this.findFocusableElements(child));
      }
    }

    return focusableElements;
  }

  /**
   * Register an element and all its children with the document
   */
  registerElementTree(element: Element): void {
    this._deps.document.addElement(element);
    if (element.children) {
      for (const child of element.children) {
        this.registerElementTree(child);
      }
    }
  }

  /**
   * Handle directional (arrow key) focus navigation.
   * Moves focus to the nearest focusable element in the given direction.
   * Returns true if focus moved.
   */
  handleDirectionalNavigation(direction: 'up' | 'down' | 'left' | 'right'): boolean {
    if (!this._deps.focusManager) return false;

    const success = this._deps.focusManager.focusInDirection(direction);
    if (success && this._deps.autoRender) {
      this._deps.onRender();
    }
    return success;
  }

  /**
   * Handle Tab key navigation between focusable elements
   */
  handleTabNavigation(reverse: boolean = false): void {
    if (!this._deps.focusManager) return;

    // Use the focus manager's proper tab navigation
    const success = reverse ? this._deps.focusManager.focusPrevious() : this._deps.focusManager.focusNext();

    if (success) {
      // Auto-render to show focus change
      if (this._deps.autoRender) {
        this._deps.onRender();
      }
    } else {
      // If focus manager navigation failed, try to focus first element as fallback
      this._deps.focusManager.focusFirst();

      if (this._deps.autoRender) {
        this._deps.onRender();
      }
    }
  }
}
