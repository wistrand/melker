// Document class for managing runtime information about a root element

import { Element } from './types.ts';
import { findElementById, traverseElements } from './element.ts';

export interface DocumentOptions {
  autoGenerateIds?: boolean;
  trackFocusedElement?: boolean;
  enableEventHandling?: boolean;
}

export class Document {
  private _root: Element;
  _elementRegistry: Map<string, Element> = new Map();
  private _focusedElement?: Element;
  private _eventListeners: Map<string, Set<(event: any) => void>> = new Map();
  private _options: Required<DocumentOptions>;
  private _elementIdCounter = 0;

  constructor(root: Element, options: DocumentOptions = {}) {
    this._options = {
      autoGenerateIds: true,
      trackFocusedElement: true,
      enableEventHandling: true,
      ...options,
    };

    this._root = root;
    this._initialize();
  }

  // Root element access
  get root(): Element {
    return this._root;
  }

  set root(element: Element) {
    this._root = element;
    this._initialize();
  }

  // Element registry management
  get elementCount(): number {
    return this._elementRegistry.size;
  }

  getAllElements(): Element[] {
    return Array.from(this._elementRegistry.values());
  }

  getElementById(id: string): Element | undefined {
    return this._elementRegistry.get(id);
  }

  getElementsByType(type: string): Element[] {
    return this.getAllElements().filter(el => el.type === type);
  }

  // Focus management
  get focusedElement(): Element | undefined {
    return this._focusedElement;
  }

  focus(elementOrId: Element | string): boolean {
    if (!this._options.trackFocusedElement) {
      return false;
    }

    const element = typeof elementOrId === 'string'
      ? this.getElementById(elementOrId)
      : elementOrId;

    if (!element || !this._elementRegistry.has(element.id)) {
      return false;
    }

    // Blur previous element
    if (this._focusedElement) {
      this._triggerEvent(this._focusedElement, {
        type: 'blur',
        target: this._focusedElement,
        timestamp: Date.now(),
      });
    }

    // Focus new element
    this._focusedElement = element;
    this._triggerEvent(element, {
      type: 'focus',
      target: element,
      timestamp: Date.now(),
    });

    return true;
  }

  blur(): void {
    if (this._focusedElement) {
      this._triggerEvent(this._focusedElement, {
        type: 'blur',
        target: this._focusedElement,
        timestamp: Date.now(),
      });
      this._focusedElement = undefined;
    }
  }

  // Event handling
  addEventListener(eventType: string, callback: (event: any) => void): void {
    if (!this._eventListeners.has(eventType)) {
      this._eventListeners.set(eventType, new Set());
    }
    this._eventListeners.get(eventType)!.add(callback);
  }

  removeEventListener(eventType: string, callback: (event: any) => void): void {
    const listeners = this._eventListeners.get(eventType);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this._eventListeners.delete(eventType);
      }
    }
  }

  dispatchEvent(event: any): void {
    const listeners = this._eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(event);
        } catch (error) {
          console.error(`Error in event listener for ${event.type}:`, error);
        }
      });
    }
  }

  // Element lifecycle management
  addElement(element: Element): void {
    this._registerElement(element);
  }

  removeElement(elementOrId: Element | string): boolean {
    const element = typeof elementOrId === 'string'
      ? this.getElementById(elementOrId)
      : elementOrId;

    if (!element) {
      return false;
    }

    // Remove from registry
    this._elementRegistry.delete(element.id);

    // Clear focus if this element was focused
    if (this._focusedElement === element) {
      this._focusedElement = undefined;
    }

    // Recursively remove children
    if (element.children) {
      element.children.forEach(child => this.removeElement(child));
    }

    return true;
  }

  // Search and traversal
  findElements(predicate: (element: Element) => boolean): Element[] {
    return this.getAllElements().filter(predicate);
  }

  findElementsByProps(props: Record<string, any>): Element[] {
    return this.findElements(element => {
      return Object.entries(props).every(([key, value]) =>
        element.props[key] === value
      );
    });
  }

  traverseDocument(callback: (element: Element) => void, visitChildren = true): void {
    traverseElements(this._root, callback, visitChildren);
  }

  // Utility methods
  generateElementId(): string {
    return `doc-${++this._elementIdCounter}`;
  }

  refreshDocument(): void {
    this._initialize();
  }

  // Statistics and debugging
  getDocumentStats(): {
    totalElements: number;
    elementsByType: Record<string, number>;
    elementsWithIds: number;
    focusedElement?: string;
    maxDepth: number;
  } {
    const elementsByType: Record<string, number> = {};
    const elementsWithIds = Array.from(this._elementRegistry.keys()).length;
    let maxDepth = 0;

    const calculateDepth = (element: Element, depth = 0): number => {
      maxDepth = Math.max(maxDepth, depth);
      elementsByType[element.type] = (elementsByType[element.type] || 0) + 1;

      if (element.children) {
        return Math.max(...element.children.map(child => calculateDepth(child, depth + 1)));
      }
      return depth;
    };

    calculateDepth(this._root);

    return {
      totalElements: this.elementCount,
      elementsByType,
      elementsWithIds,
      focusedElement: this._focusedElement?.id,
      maxDepth,
    };
  }

  toDebugString(): string {
    const stats = this.getDocumentStats();
    return `Document {
  root: ${this._root.type}#${this._root.id}
  elements: ${stats.totalElements}
  focused: ${stats.focusedElement || 'none'}
  depth: ${stats.maxDepth}
  types: ${JSON.stringify(stats.elementsByType)}
}`;
  }

  asTree(): string {
    return this._buildTreeString(this._root, '', true);
  }

  /**
   * Get the document tree as a structured object for debugging
   */
  asStructuredTree(): any {
    return this._buildStructuredTree(this._root);
  }

  private _buildStructuredTree(element: Element): any {
    if (!element) return null;

    return {
      id: element.id,
      type: element.type,
      props: { ...element.props },
      children: element.children?.map(child => this._buildStructuredTree(child)) || []
    };
  }

  // Private methods
  private _initialize(): void {
    // Preserve the currently focused element ID during reinitialization
    const previousFocusedElementId = this._focusedElement?.id;

    this._elementRegistry.clear();
    this._focusedElement = undefined;

    // Register all elements in the tree
    this.traverseDocument(element => {
      this._registerElement(element);
    });

    // Restore focus to the previously focused element if it still exists
    if (previousFocusedElementId) {
      const restoredElement = this.getElementById(previousFocusedElementId);
      if (restoredElement) {
        this._focusedElement = restoredElement;
      }
    }
  }

  private _registerElement(element: Element): void {
    // Auto-generate ID if needed
    if (this._options.autoGenerateIds && !element.id) {
      element.id = this.generateElementId();
    }

    // Register in element registry
    if (element.id) {
      this._elementRegistry.set(element.id, element);
    }
  }

  /**
   * Public method to trigger events on elements (for click handling, etc.)
   */
  triggerElementEvent(element: Element, event: any): void {
    this._triggerEvent(element, event);
  }

  private _triggerEvent(element: Element, event: any): void {
    if (!this._options.enableEventHandling) {
      return;
    }

    // Trigger element's own event handler
    const eventName = `on${event.type.charAt(0).toUpperCase() + event.type.slice(1)}`;
    const handler = element.props[eventName];
    if (typeof handler === 'function') {
      try {
        handler(event);
      } catch (error) {
        console.error(`Error in element event handler for ${event.type}:`, error);
      }
    }

    // Dispatch to document-level listeners
    this.dispatchEvent(event);
  }

  private _buildTreeString(element: Element, prefix: string, isLast: boolean): string {
    // Build the node representation
    let result = prefix;

    // Add tree branch characters
    if (prefix !== '') {
      result += isLast ? '└── ' : '├── ';
    }

    // Add element info
    result += this._formatElementNode(element);
    result += '\n';

    // Process children if they exist
    if (element.children && element.children.length > 0) {
      const childPrefix = prefix + (isLast ? '    ' : '│   ');

      element.children.forEach((child, index) => {
        const isLastChild = index === element.children!.length - 1;
        result += this._buildTreeString(child, childPrefix, isLastChild);
      });
    }

    return result;
  }

  private _formatElementNode(element: Element): string {
    let result = element.type;

    // Add ID if present
    if (element.id) {
      result += `#${element.id}`;
    }

    // Add key properties based on element type
    const keyProps = this._getKeyProperties(element);
    if (keyProps.length > 0) {
      result += ` [${keyProps.join(', ')}]`;
    }

    // Add focus indicator
    if (this._focusedElement === element) {
      result += ' *focused*';
    }

    return result;
  }

  private _getKeyProperties(element: Element): string[] {
    const props: string[] = [];

    // Common properties to display
    switch (element.type) {
      case 'text':
        if (element.props.text) {
          const text = element.props.text.toString();
          const displayText = text.length > 20 ? text.substring(0, 17) + '...' : text;
          props.push(`"${displayText}"`);
        }
        if (element.props.wrap === false) {
          props.push('nowrap');
        }
        break;

      case 'input':
        if (element.props.placeholder) {
          props.push(`placeholder: "${element.props.placeholder}"`);
        }
        if (element.props.value) {
          props.push(`value: "${element.props.value}"`);
        }
        if (element.props.maxLength) {
          props.push(`maxLength: ${element.props.maxLength}`);
        }
        break;

      case 'button':
        if (element.props.title) {
          props.push(`"${element.props.title}"`);
        }
        if (element.props.variant && element.props.variant !== 'default') {
          props.push(`variant: ${element.props.variant}`);
        }
        if (element.props.disabled) {
          props.push('disabled');
        }
        break;

      case 'radio':
        if (element.props.title) {
          props.push(`"${element.props.title}"`);
        }
        if (element.props.value !== undefined) {
          props.push(`value: ${element.props.value}`);
        }
        if (element.props.checked) {
          props.push('checked');
        }
        if (element.props.name) {
          props.push(`name: "${element.props.name}"`);
        }
        if (element.props.disabled) {
          props.push('disabled');
        }
        break;

      case 'checkbox':
        if (element.props.title) {
          props.push(`"${element.props.title}"`);
        }
        if (element.props.checked) {
          props.push('checked');
        }
        if (element.props.indeterminate) {
          props.push('indeterminate');
        }
        if (element.props.disabled) {
          props.push('disabled');
        }
        break;

      case 'container':
        if (element.props.width) {
          props.push(`width: ${element.props.width}`);
        }
        if (element.props.height) {
          props.push(`height: ${element.props.height}`);
        }
        if (element.props.style?.display && element.props.style.display !== 'block') {
          props.push(`display: ${element.props.style.display}`);
        }
        break;

      case 'dialog':
        if (element.props.title) {
          props.push(`title: "${element.props.title}"`);
        }
        if (element.props.modal) {
          props.push('modal');
        }
        break;

      default:
        // For custom elements, show some common props
        if (element.props?.name) {
          props.push(`name: "${element.props.name}"`);
        }
        if (element.props?.title) {
          props.push(`title: "${element.props.title}"`);
        }
        if (element.props?.value !== undefined && element.props?.value !== null) {
          props.push(`value: ${element.props.value}`);
        }
        break;
    }

    return props;
  }
}

// Utility function to create a document with a root element
export function createDocument(root: Element, options?: DocumentOptions): Document {
  return new Document(root, options);
}