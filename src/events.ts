// Event system infrastructure for melker terminal UI
// Keeps event handling separate from element instances

export type EventType =
  | 'keypress'
  | 'keydown'
  | 'keyup'
  | 'click'
  | 'mousedown'
  | 'mouseup'
  | 'mousemove'
  | 'mouseover'
  | 'mouseout'
  | 'wheel'
  | 'focus'
  | 'blur'
  | 'change'
  | 'input'
  | 'submit'
  | 'selectionchange'
  | 'custom';

export interface BaseEvent {
  type: EventType;
  target?: string; // Element ID
  timestamp: number;
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

export interface KeyEvent extends BaseEvent {
  type: 'keypress' | 'keydown' | 'keyup';
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface MouseEvent extends BaseEvent {
  type: 'click' | 'mousedown' | 'mouseup' | 'mousemove' | 'mouseover' | 'mouseout';
  x: number;
  y: number;
  button: number; // 0=left, 1=middle, 2=right
  buttons: number; // Bitmask of pressed buttons
  altKey?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
}

export interface WheelEvent extends BaseEvent {
  type: 'wheel';
  x: number;
  y: number;
  deltaX: number; // Horizontal scroll amount
  deltaY: number; // Vertical scroll amount (positive = scroll down, negative = scroll up)
  deltaZ: number; // Z-axis scroll (usually 0)
}

export interface FocusEvent extends BaseEvent {
  type: 'focus' | 'blur';
  relatedTarget?: string; // Element ID of previous/next focused element
}

export interface InputEvent extends BaseEvent {
  type: 'change' | 'input' | 'submit';
  value: string;
}

export type MelkerEvent = KeyEvent | MouseEvent | WheelEvent | FocusEvent | InputEvent | KeyPressEvent | ChangeEvent | SelectionChangeEvent | CustomEvent;

// Specific event types for component handlers
export interface KeyPressEvent extends BaseEvent {
  type: 'keypress';
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface ChangeEvent extends BaseEvent {
  type: 'change';
  value: string;
  // Optional properties for checkbox/radio
  checked?: boolean;
}

export interface SelectionChangeEvent extends BaseEvent {
  type: 'selectionchange';
  selectedItems: number[];
  focusedItem?: number;
  lastSelectedItem?: number;
}

export interface CustomEvent extends BaseEvent {
  type: 'custom';
  name: string;
  detail?: unknown;
}

export type EventHandler<T extends MelkerEvent = MelkerEvent> = (event: T) => void | boolean;

export interface EventRegistration {
  elementId: string;
  eventType: EventType;
  handler: EventHandler;
  options?: {
    capture?: boolean;
    once?: boolean;
    passive?: boolean;
  };
}

/**
 * Centralized event manager that keeps event handlers separate from elements
 */
export class EventManager {
  private _handlers = new Map<string, EventRegistration[]>();
  private _captureHandlers = new Map<string, EventRegistration[]>();
  private _globalHandlers = new Map<EventType, EventHandler[]>();

  /**
   * Register an event handler for a specific element
   */
  addEventListener(
    elementId: string,
    eventType: EventType,
    handler: EventHandler,
    options: { capture?: boolean; once?: boolean; passive?: boolean } = {}
  ): void {
    const registration: EventRegistration = {
      elementId,
      eventType,
      handler,
      options,
    };

    const key = `${elementId}:${eventType}`;
    const handlerMap = options.capture ? this._captureHandlers : this._handlers;

    if (!handlerMap.has(key)) {
      handlerMap.set(key, []);
    }

    handlerMap.get(key)!.push(registration);
  }

  /**
   * Remove an event handler
   */
  removeEventListener(
    elementId: string,
    eventType: EventType,
    handler: EventHandler,
    options: { capture?: boolean } = {}
  ): void {
    const key = `${elementId}:${eventType}`;
    const handlerMap = options.capture ? this._captureHandlers : this._handlers;
    const handlers = handlerMap.get(key);

    if (handlers) {
      const index = handlers.findIndex(reg => reg.handler === handler);
      if (index !== -1) {
        handlers.splice(index, 1);
        if (handlers.length === 0) {
          handlerMap.delete(key);
        }
      }
    }
  }

  /**
   * Add a global event handler (not tied to specific element)
   */
  addGlobalEventListener(eventType: EventType, handler: EventHandler): void {
    if (!this._globalHandlers.has(eventType)) {
      this._globalHandlers.set(eventType, []);
    }

    this._globalHandlers.get(eventType)!.push(handler);
  }

  /**
   * Remove a global event handler
   */
  removeGlobalEventListener(eventType: EventType, handler: EventHandler): void {
    const handlers = this._globalHandlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
        if (handlers.length === 0) {
          this._globalHandlers.delete(eventType);
        }
      }
    }
  }

  /**
   * Dispatch an event through the event system with proper propagation
   */
  dispatchEvent(event: MelkerEvent, elementPath: string[] = []): boolean {
    // Create mutable event for preventDefault/stopPropagation
    const mutableEvent = { ...event };
    let propagationStopped = false;

    // Capture phase - from root to target
    if (event.target && elementPath.length > 0) {
      for (let i = elementPath.length - 1; i >= 0; i--) {
        if (propagationStopped) break;

        const elementId = elementPath[i];
        const key = `${elementId}:${event.type}`;
        const captureHandlers = this._captureHandlers.get(key) || [];

        for (const registration of captureHandlers) {
          const result = registration.handler(mutableEvent);
          if (result === false || mutableEvent.preventDefault) {
            mutableEvent.preventDefault = true;
          }
          if (mutableEvent.stopPropagation) {
            propagationStopped = true;
            break;
          }

          // Remove once listeners
          if (registration.options?.once) {
            this.removeEventListener(
              registration.elementId,
              registration.eventType,
              registration.handler,
              { capture: true }
            );
          }
        }
      }
    }

    // Target phase - handle event on target element
    if (!propagationStopped && event.target) {
      const key = `${event.target}:${event.type}`;
      const targetHandlers = this._handlers.get(key) || [];

      for (const registration of targetHandlers) {
        const result = registration.handler(mutableEvent);
        if (result === false || mutableEvent.preventDefault) {
          mutableEvent.preventDefault = true;
        }
        if (mutableEvent.stopPropagation) {
          propagationStopped = true;
          break;
        }

        // Remove once listeners
        if (registration.options?.once) {
          this.removeEventListener(
            registration.elementId,
            registration.eventType,
            registration.handler
          );
        }
      }
    }

    // Bubble phase - from target to root
    if (!propagationStopped && elementPath.length > 0) {
      for (let i = 1; i < elementPath.length; i++) {
        if (propagationStopped) break;

        const elementId = elementPath[i];
        const key = `${elementId}:${event.type}`;
        const bubbleHandlers = this._handlers.get(key) || [];

        for (const registration of bubbleHandlers) {
          const result = registration.handler(mutableEvent);
          if (result === false || mutableEvent.preventDefault) {
            mutableEvent.preventDefault = true;
          }
          if (mutableEvent.stopPropagation) {
            propagationStopped = true;
            break;
          }

          // Remove once listeners
          if (registration.options?.once) {
            this.removeEventListener(
              registration.elementId,
              registration.eventType,
              registration.handler
            );
          }
        }
      }
    }

    // Global handlers (always execute unless event was prevented)
    if (!mutableEvent.preventDefault) {
      const globalHandlers = this._globalHandlers.get(event.type) || [];
      for (const handler of globalHandlers) {
        handler(mutableEvent);
      }
    }

    return !mutableEvent.preventDefault;
  }

  /**
   * Get all registered handlers for debugging
   */
  getHandlers(): {
    handlers: Map<string, EventRegistration[]>;
    captureHandlers: Map<string, EventRegistration[]>;
    globalHandlers: Map<EventType, EventHandler[]>;
  } {
    return {
      handlers: new Map(this._handlers),
      captureHandlers: new Map(this._captureHandlers),
      globalHandlers: new Map(this._globalHandlers),
    };
  }

  /**
   * Clear all event handlers
   */
  clear(): void {
    this._handlers.clear();
    this._captureHandlers.clear();
    this._globalHandlers.clear();
  }

  /**
   * Get statistics about registered handlers
   */
  getStats(): {
    totalHandlers: number;
    captureHandlers: number;
    globalHandlers: number;
    elementCount: number;
  } {
    let totalHandlers = 0;
    let captureHandlers = 0;
    let globalHandlers = 0;
    const uniqueElements = new Set<string>();

    // Count regular handlers
    for (const [key, handlers] of this._handlers) {
      totalHandlers += handlers.length;
      const elementId = key.split(':')[0];
      uniqueElements.add(elementId);
    }

    // Count capture handlers
    for (const [key, handlers] of this._captureHandlers) {
      captureHandlers += handlers.length;
      const elementId = key.split(':')[0];
      uniqueElements.add(elementId);
    }

    // Count global handlers
    for (const handlers of this._globalHandlers.values()) {
      globalHandlers += handlers.length;
    }

    return {
      totalHandlers: totalHandlers + captureHandlers,
      captureHandlers,
      globalHandlers,
      elementCount: uniqueElements.size,
    };
  }
}

// Global event manager instance
let globalEventManager: EventManager | undefined;

export function getGlobalEventManager(): EventManager {
  if (!globalEventManager) {
    globalEventManager = new EventManager();
  }
  return globalEventManager;
}

export function setGlobalEventManager(manager: EventManager): void {
  globalEventManager = manager;
}

// Utility functions for common event operations

/**
 * Check if an event is a keyboard event
 */
export function isKeyEvent(event: MelkerEvent): event is KeyEvent {
  return ['keypress', 'keydown', 'keyup'].includes(event.type);
}

/**
 * Check if an event is a mouse event
 */
export function isMouseEvent(event: MelkerEvent): event is MouseEvent {
  return ['click', 'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout'].includes(event.type);
}

/**
 * Check if an event is a wheel event
 */
export function isWheelEvent(event: MelkerEvent): event is WheelEvent {
  return event.type === 'wheel';
}

/**
 * Check if an event is a focus event
 */
export function isFocusEvent(event: MelkerEvent): event is FocusEvent {
  return ['focus', 'blur'].includes(event.type);
}

/**
 * Check if an event is an input event
 */
export function isInputEvent(event: MelkerEvent): event is InputEvent {
  return ['change', 'input', 'submit'].includes(event.type);
}

/**
 * Create a keyboard event
 */
export function createKeyEvent(
  type: 'keypress' | 'keydown' | 'keyup',
  key: string,
  code: string,
  modifiers: {
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    metaKey?: boolean;
  } = {},
  target?: string
): KeyEvent {
  return {
    type,
    key,
    code,
    ctrlKey: modifiers.ctrlKey || false,
    altKey: modifiers.altKey || false,
    shiftKey: modifiers.shiftKey || false,
    metaKey: modifiers.metaKey || false,
    target,
    timestamp: Date.now(),
  };
}

/**
 * Create a mouse event
 */
export function createMouseEvent(
  type: 'click' | 'mousedown' | 'mouseup' | 'mousemove' | 'mouseover' | 'mouseout',
  x: number,
  y: number,
  button: number = 0,
  buttons: number = 0,
  target?: string,
  modifiers?: { altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean }
): MouseEvent {
  return {
    type,
    x,
    y,
    button,
    buttons,
    target,
    timestamp: Date.now(),
    altKey: modifiers?.altKey,
    shiftKey: modifiers?.shiftKey,
    ctrlKey: modifiers?.ctrlKey,
  };
}

/**
 * Create a wheel event
 */
export function createWheelEvent(
  x: number,
  y: number,
  deltaX: number = 0,
  deltaY: number = 0,
  deltaZ: number = 0,
  target?: string
): WheelEvent {
  return {
    type: 'wheel',
    x,
    y,
    deltaX,
    deltaY,
    deltaZ,
    target,
    timestamp: Date.now(),
  };
}

/**
 * Create a focus event
 */
export function createFocusEvent(
  type: 'focus' | 'blur',
  target?: string,
  relatedTarget?: string
): FocusEvent {
  return {
    type,
    target,
    relatedTarget,
    timestamp: Date.now(),
  };
}

/**
 * Create an input event
 */
export function createInputEvent(
  type: 'change' | 'input' | 'submit',
  value: string,
  target?: string
): InputEvent {
  return {
    type,
    value,
    target,
    timestamp: Date.now(),
  };
}

// Specific event creators for component use
export function createKeyPressEvent(
  key: string,
  modifiers: {
    code?: string;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    metaKey?: boolean;
    target?: string;
  } = {}
): KeyPressEvent {
  return {
    type: 'keypress',
    key,
    code: modifiers.code || key,
    ctrlKey: modifiers.ctrlKey || false,
    altKey: modifiers.altKey || false,
    shiftKey: modifiers.shiftKey || false,
    metaKey: modifiers.metaKey || false,
    target: modifiers.target,
    timestamp: Date.now(),
  };
}

export function createChangeEvent(
  value: string,
  target?: string
): ChangeEvent {
  return {
    type: 'change',
    value,
    target,
    timestamp: Date.now(),
  };
}

export function createSelectionChangeEvent(options: {
  selectedItems: number[];
  focusedItem?: number;
  lastSelectedItem?: number;
  target?: string;
}): SelectionChangeEvent {
  return {
    type: 'selectionchange',
    selectedItems: options.selectedItems,
    focusedItem: options.focusedItem,
    lastSelectedItem: options.lastSelectedItem,
    target: options.target,
    timestamp: Date.now(),
  };
}