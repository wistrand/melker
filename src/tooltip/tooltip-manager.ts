// Tooltip Manager - singleton service for managing tooltip display

import type {
  TooltipConfig,
  TooltipState,
  TooltipEvent,
  TooltipContext,
} from './types.ts';
import { DEFAULT_TOOLTIP_CONFIG } from './types.ts';
import type { Element, Bounds } from '../types.ts';

/**
 * Tooltip Manager singleton.
 * Manages tooltip lifecycle, delay timer, and positioning.
 */
export class TooltipManager {
  private _config: TooltipConfig;
  private _state: TooltipState | null = null;
  private _pendingTimer?: number;
  private _requestRender?: () => void;
  private _lastContent: string | null = null;
  private _lastElementId: string | null = null;

  constructor(config?: Partial<TooltipConfig>) {
    this._config = { ...DEFAULT_TOOLTIP_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<TooltipConfig>): void {
    this._config = { ...this._config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): TooltipConfig {
    return { ...this._config };
  }

  /**
   * Set render request function (called when tooltip changes)
   */
  setRequestRender(fn: () => void): void {
    this._requestRender = fn;
  }

  /**
   * Schedule a tooltip to appear after delay.
   * If same element and content, does nothing.
   * If same element but different content, updates immediately if visible.
   * @param delayOverride Optional delay override (e.g., longer delay for focus tooltips)
   */
  scheduleTooltip(
    element: Element,
    content: string,
    screenX: number,
    screenY: number,
    elementBounds: Bounds,
    delayOverride?: number
  ): void {
    const elementId = element.id;

    // Same element, same content - do nothing
    if (elementId === this._lastElementId && content === this._lastContent) {
      // Update anchor position for mouse-following tooltips
      if (this._state?.visible) {
        this._state.anchorX = screenX;
        this._state.anchorY = screenY;
      }
      return;
    }

    // Same element, different content - update immediately if visible
    if (elementId === this._lastElementId && this._state?.visible) {
      this._state.content = content;
      this._state.anchorX = screenX;
      this._state.anchorY = screenY;
      this._state.elementBounds = elementBounds;
      this._lastContent = content;
      this._requestRender?.();
      return;
    }

    // Different element - clear and reschedule
    this._clearPendingTimer();
    this._lastElementId = elementId;
    this._lastContent = content;

    // Schedule tooltip after delay
    this._state = {
      elementId,
      content,
      anchorX: screenX,
      anchorY: screenY,
      elementBounds,
      scheduledAt: Date.now(),
      visible: false,
    };

    const delay = delayOverride ?? this._config.showDelay;
    this._pendingTimer = setTimeout(() => {
      this._pendingTimer = undefined;
      if (this._state && this._state.elementId === elementId) {
        this._state.visible = true;
        this._requestRender?.();
      }
    }, delay) as unknown as number;
  }

  /**
   * Get the focus show delay from config
   */
  getFocusShowDelay(): number {
    return this._config.focusShowDelay;
  }

  /**
   * Update tooltip position (for mouse following)
   */
  updatePosition(screenX: number, screenY: number): void {
    if (this._state) {
      this._state.anchorX = screenX;
      this._state.anchorY = screenY;
      if (this._state.visible) {
        this._requestRender?.();
      }
    }
  }

  /**
   * Hide tooltip immediately
   */
  hideTooltip(): void {
    this._clearPendingTimer();
    if (this._state) {
      this._state = null;
      this._lastElementId = null;
      this._lastContent = null;
      this._requestRender?.();
    }
  }

  /**
   * Check if tooltip is visible
   */
  isVisible(): boolean {
    return this._state?.visible ?? false;
  }

  /**
   * Get current tooltip state
   */
  getState(): TooltipState | null {
    return this._state;
  }

  /**
   * Check if there's an active tooltip (visible or pending)
   */
  isActive(): boolean {
    return this._state !== null;
  }

  /**
   * Get the element ID of the current tooltip target
   */
  getTargetElementId(): string | null {
    return this._state?.elementId ?? null;
  }

  /**
   * Build a TooltipEvent for a component
   */
  static buildEvent(
    element: Element,
    screenX: number,
    screenY: number,
    elementBounds: Bounds,
    context?: TooltipContext
  ): TooltipEvent {
    return {
      x: screenX - elementBounds.x,
      y: screenY - elementBounds.y,
      screenX,
      screenY,
      element,
      context,
    };
  }

  /**
   * Clear pending timer
   */
  private _clearPendingTimer(): void {
    if (this._pendingTimer !== undefined) {
      clearTimeout(this._pendingTimer);
      this._pendingTimer = undefined;
    }
  }
}

// Global tooltip manager instance
let globalTooltipManager: TooltipManager | null = null;

/**
 * Get the global tooltip manager instance
 */
export function getTooltipManager(): TooltipManager {
  if (!globalTooltipManager) {
    globalTooltipManager = new TooltipManager();
  }
  return globalTooltipManager;
}

/**
 * Initialize tooltip manager with config
 */
export function initTooltipManager(config?: Partial<TooltipConfig>): TooltipManager {
  globalTooltipManager = new TooltipManager(config);
  return globalTooltipManager;
}
