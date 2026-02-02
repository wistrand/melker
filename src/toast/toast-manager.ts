// Toast Manager - singleton service for managing toast notifications

import type {
  ToastEntry,
  ToastOptions,
  ToastConfig,
  ToastType,
} from './types.ts';
import { DEFAULT_TOAST_CONFIG } from './types.ts';

/** Generate unique toast ID */
function generateId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Toast Manager singleton.
 * Manages toast lifecycle, auto-dismiss, and inactivity tracking.
 */
export class ToastManager {
  private _toasts: ToastEntry[] = [];
  private _lastActivity: number = 0;
  private _config: ToastConfig;
  private _requestRender?: () => void;
  private _expiryTimer?: number;

  constructor(config?: Partial<ToastConfig>) {
    this._config = { ...DEFAULT_TOAST_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<ToastConfig>): void {
    this._config = { ...this._config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ToastConfig {
    return { ...this._config };
  }

  /**
   * Set render request function (called when toasts change)
   */
  setRequestRender(fn: () => void): void {
    this._requestRender = fn;
  }

  /**
   * Show a toast notification.
   * If an identical message (same text and type) is already displayed,
   * resets the expiration timer on the existing toast instead.
   */
  show(message: string, options?: ToastOptions): string {
    const type: ToastType = options?.type ?? 'info';
    const duration = options?.duration ?? this._config.defaultDuration;
    const closable = options?.closable ?? true;
    const bell = options?.bell ?? (this._config.bell && type === 'error');

    // Check for existing toast with same message and type
    const existing = this._toasts.find(t => t.message === message && t.type === type);
    if (existing) {
      // Reset expiration by updating createdAt and increment count
      existing.createdAt = Date.now();
      existing.duration = duration;
      existing.count++;
      this._lastActivity = Date.now();
      this._scheduleExpiryTimer();
      this._requestRender?.();
      return existing.id;
    }

    const toast: ToastEntry = {
      id: generateId(),
      message,
      type,
      createdAt: Date.now(),
      duration,
      closable,
      bell,
      action: options?.action,
      count: 1,
    };

    // Dismiss oldest if at max capacity
    while (this._toasts.length >= this._config.maxVisible) {
      this._toasts.shift(); // Remove oldest (first)
    }

    this._toasts.push(toast);
    this._lastActivity = Date.now();

    // Ring bell for error toasts if enabled
    if (bell) {
      this._ringBell();
    }

    // Schedule expiry timer
    this._scheduleExpiryTimer();

    // Request render
    this._requestRender?.();

    return toast.id;
  }

  /**
   * Dismiss a specific toast
   */
  dismiss(id: string): void {
    const index = this._toasts.findIndex(t => t.id === id);
    if (index !== -1) {
      this._toasts.splice(index, 1);
      this._lastActivity = Date.now();
      this._scheduleExpiryTimer();
      this._requestRender?.();
    }
  }

  /**
   * Dismiss all toasts
   */
  dismissAll(): void {
    if (this._toasts.length > 0) {
      this._toasts = [];
      // Clear expiry timer
      if (this._expiryTimer !== undefined) {
        clearTimeout(this._expiryTimer);
        this._expiryTimer = undefined;
      }
      this._requestRender?.();
    }
  }

  /**
   * Check if there are visible toasts (and clean up expired ones)
   */
  hasVisibleToasts(): boolean {
    this._cleanupExpired();
    return this._toasts.length > 0;
  }

  /**
   * Get active toasts (cleaned up)
   */
  getActiveToasts(): ToastEntry[] {
    this._cleanupExpired();
    return [...this._toasts];
  }

  /**
   * Reset inactivity timer (called on user interaction)
   */
  resetInactivity(): void {
    this._lastActivity = Date.now();
    // Reschedule expiry timer since inactivity timeout changed
    if (this._toasts.length > 0) {
      this._scheduleExpiryTimer();
    }
  }

  /**
   * Check if inactive long enough to dismiss all
   */
  isInactive(): boolean {
    if (this._toasts.length === 0) return false;
    return Date.now() - this._lastActivity > this._config.inactivityTimeout;
  }

  /**
   * Handle click at coordinates (returns true if handled)
   */
  handleClick(x: number, y: number, bounds: { x: number; y: number; width: number; height: number }): boolean {
    // Calculate relative position
    const relX = x - bounds.x;
    const relY = y - bounds.y;

    // Check if click is on close-all button (on border)
    // Layout: border/closeAll(0) + toasts(1..N) + border/closeAll(N+1)
    const closeAllY = this._config.position === 'bottom' ? this._toasts.length + 1 : 0;
    if (relY === closeAllY) {
      this.dismissAll();
      return true;
    }

    // Check individual toast close buttons
    const toastStartY = 1;
    const toastIndex = relY - toastStartY;
    if (toastIndex >= 0 && toastIndex < this._toasts.length) {
      const toast = this._toasts[toastIndex];

      // Close button is at right edge
      if (toast.closable && relX >= bounds.width - 4) {
        this.dismiss(toast.id);
        this._lastActivity = Date.now();
        return true;
      }

      // Action button (if present) - positioned before close button
      if (toast.action) {
        const actionWidth = toast.action.label.length + 4;
        const actionStart = bounds.width - 4 - actionWidth;
        if (relX >= actionStart && relX < actionStart + actionWidth) {
          toast.action.onClick();
          this.dismiss(toast.id);
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Ring terminal bell
   */
  private _ringBell(): void {
    try {
      Deno.stdout.writeSync(new TextEncoder().encode('\x07'));
    } catch {
      // Ignore errors (e.g., in headless mode)
    }
  }

  /**
   * Schedule timer for next toast expiry
   */
  private _scheduleExpiryTimer(): void {
    // Clear existing timer
    if (this._expiryTimer !== undefined) {
      clearTimeout(this._expiryTimer);
      this._expiryTimer = undefined;
    }

    if (this._toasts.length === 0) return;

    const now = Date.now();

    // Find the earliest expiry time
    let nextExpiry = Infinity;

    for (const toast of this._toasts) {
      const expiresAt = toast.createdAt + toast.duration;
      if (expiresAt < nextExpiry) {
        nextExpiry = expiresAt;
      }
    }

    // Also consider inactivity timeout
    const inactivityExpiry = this._lastActivity + this._config.inactivityTimeout;
    if (inactivityExpiry < nextExpiry) {
      nextExpiry = inactivityExpiry;
    }

    // Schedule timer
    const delay = Math.max(0, nextExpiry - now);
    this._expiryTimer = setTimeout(() => {
      this._expiryTimer = undefined;
      // Cleanup will happen in _cleanupExpired during render
      this._requestRender?.();
      // Reschedule if there are still toasts
      if (this._toasts.length > 0) {
        this._scheduleExpiryTimer();
      }
    }, delay) as unknown as number;
  }

  /**
   * Remove expired toasts
   */
  private _cleanupExpired(): void {
    const now = Date.now();
    const before = this._toasts.length;

    this._toasts = this._toasts.filter(toast => {
      const age = now - toast.createdAt;
      return age < toast.duration;
    });

    // Also check global inactivity
    if (this._toasts.length > 0 && this.isInactive()) {
      this._toasts = [];
    }

    if (this._toasts.length !== before) {
      this._requestRender?.();
    }
  }
}

// Global toast manager instance
let globalToastManager: ToastManager | null = null;

/**
 * Get the global toast manager instance
 */
export function getToastManager(): ToastManager {
  if (!globalToastManager) {
    globalToastManager = new ToastManager();
  }
  return globalToastManager;
}

/**
 * Initialize toast manager with config
 */
export function initToastManager(config?: Partial<ToastConfig>): ToastManager {
  globalToastManager = new ToastManager(config);
  return globalToastManager;
}
