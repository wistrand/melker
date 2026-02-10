// Focus management system for melker terminal UI
// Handles tab order, focus indicators, and keyboard navigation

import { getGlobalEventManager, createFocusEvent, type EventManager } from './events.ts';
import { type Element } from './types.ts';
import { type Document } from './document.ts';
import { getLogger } from './logging.ts';
import { hasElementWithId } from './utils/tree-traversal.ts';

const logger = getLogger('FocusManager');

export interface FocusableElement {
  id: string;
  tabIndex: number;
  disabled: boolean;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FocusOptions {
  preventScroll?: boolean;
  programmatic?: boolean;
}

export interface FocusTrappingOptions {
  containerId: string;
  restoreFocus?: boolean;
  initialFocus?: string;
}

/**
 * Focus manager that handles keyboard navigation and focus state
 */
export class FocusManager {
  private _focusedElementId: string | null = null;
  private _focusableElementIds = new Set<string>();
  private _tabOrder: string[] = [];
  private _focusTraps: FocusTrappingOptions[] = [];
  private _eventManager: EventManager;
  private _document: Document | null = null;
  private _boundsProvider?: (elementId: string) => { x: number; y: number; width: number; height: number } | undefined;

  constructor(eventManager?: EventManager, document?: Document) {
    this._eventManager = eventManager || getGlobalEventManager();
    this._document = document || null;
  }

  /**
   * Set the document instance for element validation
   */
  setDocument(document: Document): void {
    this._document = document;
  }

  /**
   * Set bounds provider for getting actual layout bounds
   */
  setBoundsProvider(provider: (elementId: string) => { x: number; y: number; width: number; height: number } | undefined): void {
    this._boundsProvider = provider;
  }

  /**
   * Get current state of a focusable element by ID (on demand)
   */
  private _getFocusableElement(elementId: string): FocusableElement | null {
    if (!this._document) {
      return null;
    }

    const element = this._document.getElementById(elementId);
    if (!element) {
      // Element no longer exists, remove it from focusable IDs
      this._focusableElementIds.delete(elementId);
      return null;
    }

    // Get bounds - elements in inactive tabs may not have bounds
    const bounds = this._getElementBounds(element);
    if (!bounds) {
      // No bounds means element is not currently visible/rendered
      // Return null so it's excluded from tab order
      return null;
    }

    return {
      id: elementId,
      tabIndex: this._getElementTabIndex(element),
      disabled: this._isElementDisabled(element),
      visible: this._isElementVisible(element),
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  }

  /**
   * Fast variant of _getFocusableElement that skips the expensive _isElementVisible()
   * parent-chain walk. Used when caller already verified visibility (e.g., syncFocusableElements).
   */
  private _getFocusableElementFast(elementId: string): FocusableElement | null {
    if (!this._document) return null;

    const element = this._document.getElementById(elementId);
    if (!element) {
      this._focusableElementIds.delete(elementId);
      return null;
    }

    const bounds = this._getElementBounds(element);
    if (!bounds) return null;

    return {
      id: elementId,
      tabIndex: this._getElementTabIndex(element),
      disabled: this._isElementDisabled(element),
      visible: true, // Caller guarantees visibility
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  }

  /**
   * Get element bounds, or null if not available (e.g., element in inactive tab)
   */
  private _getElementBounds(element: Element): { x: number; y: number; width: number; height: number } | null {
    if (!this._boundsProvider || !element.id) {
      return null;
    }
    return this._boundsProvider(element.id) || null;
  }

  /**
   * Find element by ID using tree traversal (same approach as engine)
   * Also searches subtree elements inside components that render inline subtrees
   */
  private _findElementById(element: Element, targetId: string): Element | null {
    if (element.id === targetId) {
      return element;
    }

    // Check subtree elements if this component has any
    // Subtree elements are rendered inline but not as children (e.g., mermaid graphs in markdown)
    const component = element as any;
    if (typeof component.getSubtreeElements === 'function') {
      const subtreeElements = component.getSubtreeElements() as Element[];
      for (const subtreeRoot of subtreeElements) {
        const found = this._findElementById(subtreeRoot, targetId);
        if (found) return found;
      }
    }

    if (element.children) {
      for (const child of element.children) {
        const found = this._findElementById(child, targetId);
        if (found) return found;
      }
    }

    return null;
  }

  /**
   * Register a focusable element by ID
   * @param elementId - The ID of the element to register as focusable
   * Note: Element is validated on-demand during focus operations, not at registration time
   */
  registerFocusableElement(elementId: string): void {
    if (!this._document) {
      throw new Error('Cannot register focusable element: Document not set in FocusManager');
    }

    // Simply store the element ID - validation happens on-demand in _getFocusableElement
    this._focusableElementIds.add(elementId);
    this._updateTabOrder();
  }

  /**
   * Unregister a focusable element
   */
  unregisterFocusableElement(elementId: string): void {
    if (this._focusedElementId === elementId) {
      this._focusedElementId = null;
    }
    this._focusableElementIds.delete(elementId);
    this._updateTabOrder();
  }

  /**
   * Refresh tab order (elements are always current from document)
   */
  refreshTabOrder(): void {
    this._updateTabOrder();
  }

  /**
   * Get the currently focused element ID
   */
  getFocusedElement(): string | null {
    return this._focusedElementId;
  }

  /**
   * Check if an element is currently focused
   */
  isFocused(elementId: string): boolean {
    return this._focusedElementId === elementId;
  }

  /**
   * Check if an element is registered as focusable and currently visible/enabled
   */
  isFocusable(elementId: string): boolean {
    const element = this._getFocusableElement(elementId);
    return element !== null && element.visible && !element.disabled;
  }

  /**
   * Focus an element by ID
   */
  focus(elementId: string, options: FocusOptions = {}): boolean {
    const element = this._getFocusableElement(elementId);
    if (!element || element.disabled || !element.visible) {
      logger.debug(`Focus failed for ${elementId}: element=${!!element}, disabled=${element?.disabled}, visible=${element?.visible}`);
      return false;
    }

    // Check if element is within a focus trap
    if (!this._isElementAccessible(elementId)) {
      return false;
    }

    const previousFocus = this._focusedElementId;

    // Blur current element if different
    if (previousFocus && previousFocus !== elementId) {
      this._dispatchBlurEvent(previousFocus, elementId);
    }

    // Set new focus
    this._focusedElementId = elementId;

    // Also update document focus if we have a document
    if (this._document) {
      this._document.focus(elementId);
    }

    // Dispatch focus event
    this._dispatchFocusEvent(elementId, previousFocus);

    return true;
  }

  /**
   * Blur the currently focused element
   */
  blur(): boolean {
    if (!this._focusedElementId) {
      return false;
    }

    const elementId = this._focusedElementId;
    this._focusedElementId = null;

    this._dispatchBlurEvent(elementId);
    return true;
  }

  /**
   * Move focus to the next focusable element
   */
  focusNext(): boolean {
    const currentIndex = this._focusedElementId
      ? this._getAccessibleTabOrder().indexOf(this._focusedElementId)
      : -1;

    const tabOrder = this._getAccessibleTabOrder();
    if (tabOrder.length === 0) return false;

    let nextIndex = currentIndex + 1;
    if (nextIndex >= tabOrder.length) {
      nextIndex = 0; // Wrap to first
    }

    return this.focus(tabOrder[nextIndex]);
  }

  /**
   * Move focus to the previous focusable element
   */
  focusPrevious(): boolean {
    const currentIndex = this._focusedElementId
      ? this._getAccessibleTabOrder().indexOf(this._focusedElementId)
      : -1;

    const tabOrder = this._getAccessibleTabOrder();
    if (tabOrder.length === 0) return false;

    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = tabOrder.length - 1; // Wrap to last
    }

    return this.focus(tabOrder[prevIndex]);
  }

  /**
   * Focus the first focusable element
   */
  focusFirst(): boolean {
    const tabOrder = this._getAccessibleTabOrder();
    if (tabOrder.length === 0) return false;
    return this.focus(tabOrder[0]);
  }

  /**
   * Focus the last focusable element
   */
  focusLast(): boolean {
    const tabOrder = this._getAccessibleTabOrder();
    if (tabOrder.length === 0) return false;
    return this.focus(tabOrder[tabOrder.length - 1]);
  }

  /**
   * Set up focus trapping within a container (e.g., for modals)
   */
  trapFocus(options: FocusTrappingOptions): void {
    this._focusTraps.push(options);

    // Defer initial focus to allow render cycle to complete
    // This ensures element bounds are available for focus validation
    setTimeout(() => {
      // Focus initial element if specified
      if (options.initialFocus) {
        if (!this.focus(options.initialFocus)) {
          // If initial focus fails, try first element in container
          const containerElements = this._getElementsInContainer(options.containerId);
          if (containerElements.length > 0) {
            this.focus(containerElements[0]);
          }
        }
      } else {
        // Focus first element in container
        const containerElements = this._getElementsInContainer(options.containerId);
        if (containerElements.length > 0) {
          this.focus(containerElements[0]);
        }
      }
    }, 0);
  }

  /**
   * Remove focus trapping
   */
  releaseFocusTrap(containerId: string, restoreFocus: boolean = true): void {
    const trapIndex = this._focusTraps.findIndex(trap => trap.containerId === containerId);
    if (trapIndex === -1) return;

    const trap = this._focusTraps[trapIndex];
    this._focusTraps.splice(trapIndex, 1);

    // Restore focus to previous element if requested
    if (restoreFocus && trap.restoreFocus) {
      // Implementation would restore focus to the previously focused element
      // This would require storing the previous focus state when trap was created
    }
  }

  /**
   * Get all focusable elements in tab order
   */
  getTabOrder(): string[] {
    return [...this._tabOrder];
  }

  /**
   * Get accessible tab order (respecting focus traps)
   */
  private _getAccessibleTabOrder(): string[] {
    if (this._focusTraps.length === 0) {
      return this._tabOrder;
    }

    // If there are focus traps, only include elements within the active trap
    const activeTrap = this._focusTraps[this._focusTraps.length - 1];
    return this._getElementsInContainer(activeTrap.containerId)
      .filter(elementId => this._tabOrder.includes(elementId))
      .sort((a, b) => this._tabOrder.indexOf(a) - this._tabOrder.indexOf(b));
  }

  /**
   * Check if an element is accessible given current focus traps
   */
  private _isElementAccessible(elementId: string): boolean {
    if (this._focusTraps.length === 0) {
      return true;
    }

    const activeTrap = this._focusTraps[this._focusTraps.length - 1];
    return this._getElementsInContainer(activeTrap.containerId).includes(elementId);
  }

  /**
   * Get all focusable elements within a container
   */
  private _getElementsInContainer(containerId: string): string[] {
    if (!this._document) {
      return [];
    }

    const container = this._document.getElementById(containerId);
    if (!container) {
      return [];
    }

    // Helper to check if an element is a descendant of the container
    const isDescendant = (elementId: string): boolean => {
      const element = this._document!.getElementById(elementId);
      if (!element) return false;
      return hasElementWithId(elementId, container);
    };

    return Array.from(this._focusableElementIds)
      .filter(id => {
        const element = this._getFocusableElement(id);
        return element && element.visible && !element.disabled && isDescendant(id);
      });
  }

  /**
   * Update tab order based on tabIndex values
   * @param skipVisibilityCheck - When true, skip expensive parent-chain visibility walk
   *   (safe when IDs came from findFocusableElements which already pruned invisible branches)
   */
  private _updateTabOrder(skipVisibilityCheck = false): void {
    const elements: FocusableElement[] = [];

    // Get current state of all focusable elements on demand
    for (const elementId of this._focusableElementIds) {
      const element = skipVisibilityCheck
        ? this._getFocusableElementFast(elementId)
        : this._getFocusableElement(elementId);
      if (element && element.visible && !element.disabled) {
        elements.push(element);
      }
    }

    // Sort elements by tab index and position
    elements.sort((a, b) => {
      // Sort by tabIndex, then by document order (could use y, x coordinates)
      if (a.tabIndex !== b.tabIndex) {
        return a.tabIndex - b.tabIndex;
      }
      // Secondary sort by position (y first, then x)
      if (a.y !== b.y) {
        return a.y - b.y;
      }
      return a.x - b.x;
    });

    this._tabOrder = elements.map(el => el.id);
  }

  /**
   * Dispatch a focus event
   */
  private _dispatchFocusEvent(target: string, relatedTarget?: string | null): void {
    const event = createFocusEvent('focus', target, relatedTarget || undefined);
    this._eventManager.dispatchEvent(event);
  }

  /**
   * Dispatch a blur event
   */
  private _dispatchBlurEvent(target: string, relatedTarget?: string | null): void {
    const event = createFocusEvent('blur', target, relatedTarget || undefined);
    this._eventManager.dispatchEvent(event);
  }

  /**
   * Get focus manager statistics
   */
  getStats(): {
    totalElements: number;
    focusableElements: number;
    focusedElement: string | null;
    activeFocusTraps: number;
    tabOrderLength: number;
  } {
    const focusableElements: FocusableElement[] = [];
    for (const elementId of this._focusableElementIds) {
      const element = this._getFocusableElement(elementId);
      if (element) {
        focusableElements.push(element);
      }
    }

    const focusableCount = focusableElements.filter(el => el.visible && !el.disabled).length;

    return {
      totalElements: this._focusableElementIds.size,
      focusableElements: focusableCount,
      focusedElement: this._focusedElementId,
      activeFocusTraps: this._focusTraps.length,
      tabOrderLength: this._tabOrder.length,
    };
  }

  /**
   * Helper methods to extract element properties for focus management
   */
  private _getElementTabIndex(element: Element): number {
    if (element.props.tabIndex !== undefined) {
      return element.props.tabIndex;
    }
    return getDefaultTabIndex(element.type);
  }

  private _isElementDisabled(element: Element): boolean {
    return Boolean(element.props.disabled);
  }

  private _isElementVisible(element: Element): boolean {
    // Check element's own visibility
    if (element.props.visible === false) {
      return false;
    }

    // Dialogs use 'open' prop instead of 'visible'
    if (element.type === 'dialog' && element.props.open !== true) {
      return false;
    }

    // Check parent visibility recursively
    // If any parent is not visible, this element is also not visible
    if (!this._document) {
      return true; // Default to visible if no document
    }

    const parent = this._findParentElement(this._document.root, element.id);
    if (parent) {
      return this._isElementVisible(parent);
    }

    // Default to visible if not explicitly set and no invisible parent
    return true;
  }

  /**
   * Find parent element of a given element ID
   * Also searches subtree elements inside components that render inline subtrees
   */
  private _findParentElement(current: Element, targetId: string): Element | null {
    // Check subtree elements if this component has any
    const component = current as any;
    if (typeof component.getSubtreeElements === 'function') {
      const subtreeElements = component.getSubtreeElements() as Element[];
      for (const subtreeRoot of subtreeElements) {
        // If the subtree root itself is the target, parent is the component
        if (subtreeRoot.id === targetId) {
          return current;
        }
        // Search within the subtree
        const foundInSubtree = this._findParentElement(subtreeRoot, targetId);
        if (foundInSubtree) {
          return foundInSubtree;
        }
      }
    }

    if (!current.children) {
      return null;
    }

    for (const child of current.children) {
      if (child.id === targetId) {
        return current;
      }

      const foundInChild = this._findParentElement(child, targetId);
      if (foundInChild) {
        return foundInChild;
      }
    }

    return null;
  }

  private _getElementX(element: Element): number {
    if (!this._boundsProvider) {
      throw new Error('Bounds provider not set - layout bounds should always be available for focus management');
    }
    if (!element.id) {
      throw new Error(`Element must have an ID for focus management bounds lookup`);
    }
    const bounds = this._boundsProvider(element.id);
    if (!bounds) {
      throw new Error(`No layout bounds found for element ${element.id} - layout should always be available`);
    }
    return bounds.x;
  }

  private _getElementY(element: Element): number {
    if (!this._boundsProvider) {
      throw new Error('Bounds provider not set - layout bounds should always be available for focus management');
    }
    if (!element.id) {
      throw new Error(`Element must have an ID for focus management bounds lookup`);
    }
    const bounds = this._boundsProvider(element.id);
    if (!bounds) {
      throw new Error(`No layout bounds found for element ${element.id} - layout should always be available`);
    }
    return bounds.y;
  }

  private _getElementWidth(element: Element): number {
    if (!this._boundsProvider) {
      throw new Error('Bounds provider not set - layout bounds should always be available for focus management');
    }
    if (!element.id) {
      throw new Error(`Element must have an ID for focus management bounds lookup`);
    }
    const bounds = this._boundsProvider(element.id);
    if (!bounds) {
      throw new Error(`No layout bounds found for element ${element.id} - layout should always be available`);
    }
    return bounds.width;
  }

  private _getElementHeight(element: Element): number {
    if (!this._boundsProvider) {
      throw new Error('Bounds provider not set - layout bounds should always be available for focus management');
    }
    if (!element.id) {
      throw new Error(`Element must have an ID for focus management bounds lookup`);
    }
    const bounds = this._boundsProvider(element.id);
    if (!bounds) {
      throw new Error(`No layout bounds found for element ${element.id} - layout should always be available`);
    }
    return bounds.height;
  }

  /**
   * Clear all focus state
   */
  clear(): void {
    this._focusedElementId = null;
    this._focusableElementIds.clear();
    this._tabOrder = [];
    this._focusTraps = [];
  }

  /**
   * Sync focusable elements - remove IDs not in the provided set and add new ones
   * This ensures the registry stays in sync with what's actually in the document
   */
  syncFocusableElements(currentIds: Set<string>): void {
    // Remove IDs that are no longer valid
    for (const id of this._focusableElementIds) {
      if (!currentIds.has(id)) {
        this._focusableElementIds.delete(id);
      }
    }

    // Add new IDs
    for (const id of currentIds) {
      this._focusableElementIds.add(id);
    }

    // Skip visibility check — currentIds came from findFocusableElements()
    // which already pruned invisible branches (closed dialogs, visible:false, etc.)
    this._updateTabOrder(true);
  }
}

// Global focus manager instance
let globalFocusManager: FocusManager | undefined;

export function getGlobalFocusManager(): FocusManager {
  if (!globalFocusManager) {
    globalFocusManager = new FocusManager();
  }
  return globalFocusManager;
}

export function setGlobalFocusManager(manager: FocusManager): void {
  globalFocusManager = manager;
}

/**
 * Focus navigation helper for common keyboard shortcuts
 */
export class FocusNavigator {
  private _focusManager: FocusManager;
  private _eventManager: EventManager;

  constructor(focusManager?: FocusManager, eventManager?: EventManager) {
    this._focusManager = focusManager || getGlobalFocusManager();
    this._eventManager = eventManager || getGlobalEventManager();

    this._setupKeyboardHandlers();
  }

  /**
   * Set up default keyboard navigation handlers
   */
  private _setupKeyboardHandlers(): void {
    this._eventManager.addGlobalEventListener('keydown', (event) => {
      if (event.type !== 'keydown') return;

      const keyEvent = event as any; // We know it's a KeyEvent

      switch (keyEvent.key) {
        // Tab handling is now done by the engine with proper tabIndex support
        // case 'Tab':
        //   if (keyEvent.shiftKey) {
        //     this._focusManager.focusPrevious();
        //   } else {
        //     this._focusManager.focusNext();
        //   }
        //   return false; // Prevent default

        case 'Home':
          if (keyEvent.ctrlKey) {
            this._focusManager.focusFirst();
            return false;
          }
          break;

        case 'End':
          if (keyEvent.ctrlKey) {
            this._focusManager.focusLast();
            return false;
          }
          break;

        case 'Escape':
          // Could be used to exit focus traps or blur current element
          this._focusManager.blur();
          break;
      }

      return undefined; // Satisfy TypeScript return value requirement
    });
  }
}

/**
 * Utility functions for focus management
 */

/**
 * Check if an element should be focusable based on its properties
 */
export function shouldBeFocusable(
  element: { disabled?: boolean; tabIndex?: number; visible?: boolean }
): boolean {
  return (
    !element.disabled &&
    element.visible !== false &&
    (element.tabIndex === undefined || element.tabIndex >= 0)
  );
}

/**
 * Calculate default tab index based on element type
 */
export function getDefaultTabIndex(elementType: string): number {
  // Interactive elements get tab index 0 by default
  const interactiveElements = ['button', 'input', 'select', 'textarea'];
  return interactiveElements.includes(elementType.toLowerCase()) ? 0 : -1;
}