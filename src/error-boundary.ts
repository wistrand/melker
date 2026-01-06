// Error boundary system for graceful component error handling
// Catches render errors and displays fallback UI instead of crashing

import type { DualBuffer } from './buffer.ts';
import type { Element, Bounds } from './types.ts';
import { getThemeColor } from './theme.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('ErrorBoundary');

export interface ComponentError {
  elementId?: string;
  elementType: string;
  error: Error;
  timestamp: number;
  bounds?: Bounds;
}

export interface ErrorOverlayOptions {
  enabled: boolean;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  maxErrors: number;
  autoDismissMs: number;
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  maxErrorsPerWindow: number;  // Max errors before rate limiting kicks in
  windowMs: number;            // Time window in milliseconds
  cooldownMs: number;          // How long to suppress after rate limit triggered
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxErrorsPerWindow: 5,   // 5 errors...
  windowMs: 1000,          // ...per second...
  cooldownMs: 2000,        // ...then suppress for 2 seconds
};

/**
 * Error handler that collects and manages component errors
 * Includes rate limiting to prevent error floods from blocking input
 */
export class ErrorHandler {
  private _errors: ComponentError[] = [];
  private _maxErrors: number;
  private _onError?: (error: ComponentError) => void;

  // Rate limiting state per component (keyed by elementId or elementType)
  private _errorTimestamps: Map<string, number[]> = new Map();
  private _rateLimited: Map<string, number> = new Map(); // key -> cooldown end time
  private _rateLimitConfig: RateLimitConfig;
  private _suppressedCount: Map<string, number> = new Map();

  constructor(options: {
    maxErrors?: number;
    onError?: (error: ComponentError) => void;
    rateLimit?: Partial<RateLimitConfig>;
  } = {}) {
    this._maxErrors = options.maxErrors ?? 10;
    this._onError = options.onError;
    this._rateLimitConfig = { ...DEFAULT_RATE_LIMIT, ...options.rateLimit };
  }

  /**
   * Get component key for rate limiting (prefer id, fallback to type)
   */
  private _getComponentKey(element: Element): string {
    return element.id || `type:${element.type}`;
  }

  /**
   * Check if a component is currently rate limited
   */
  isRateLimited(element: Element): boolean {
    const key = this._getComponentKey(element);
    const cooldownEnd = this._rateLimited.get(key);
    if (cooldownEnd && Date.now() < cooldownEnd) {
      return true;
    }
    // Cooldown expired, remove from map
    if (cooldownEnd) {
      this._rateLimited.delete(key);
      // Log summary of suppressed errors
      const suppressed = this._suppressedCount.get(key) || 0;
      if (suppressed > 0) {
        logger.warn(`Rate limit lifted for ${key}, suppressed ${suppressed} errors`);
        this._suppressedCount.delete(key);
      }
    }
    return false;
  }

  /**
   * Check if error should be rate limited and update tracking
   * Returns true if error should be suppressed
   */
  private _shouldRateLimit(element: Element): boolean {
    const key = this._getComponentKey(element);
    const now = Date.now();
    const config = this._rateLimitConfig;

    // Already rate limited?
    if (this.isRateLimited(element)) {
      // Track suppressed count
      this._suppressedCount.set(key, (this._suppressedCount.get(key) || 0) + 1);
      return true;
    }

    // Get or create timestamp array for this component
    let timestamps = this._errorTimestamps.get(key);
    if (!timestamps) {
      timestamps = [];
      this._errorTimestamps.set(key, timestamps);
    }

    // Add current timestamp and filter out old ones
    timestamps.push(now);
    const windowStart = now - config.windowMs;
    const recentTimestamps = timestamps.filter(t => t > windowStart);
    this._errorTimestamps.set(key, recentTimestamps);

    // Check if we've exceeded the threshold
    if (recentTimestamps.length > config.maxErrorsPerWindow) {
      // Trigger rate limiting
      this._rateLimited.set(key, now + config.cooldownMs);
      this._suppressedCount.set(key, 0);
      logger.warn(`Rate limiting errors for ${key}: ${recentTimestamps.length} errors in ${config.windowMs}ms`);
      return false; // Let this last error through, then suppress
    }

    return false;
  }

  /**
   * Record a component error
   * Returns false if error was rate-limited (suppressed)
   */
  captureError(element: Element, error: Error, bounds?: Bounds): boolean {
    // Check rate limiting first
    if (this._shouldRateLimit(element)) {
      return false; // Error suppressed
    }

    const componentError: ComponentError = {
      elementId: element.id,
      elementType: element.type,
      error,
      timestamp: Date.now(),
      bounds,
    };

    logger.error(`Component render error: ${element.type}`, error, {
      elementId: element.id,
      elementType: element.type,
    });

    this._errors.push(componentError);

    // Keep only the most recent errors
    if (this._errors.length > this._maxErrors) {
      this._errors = this._errors.slice(-this._maxErrors);
    }

    this._onError?.(componentError);
    return true;
  }

  /**
   * Get suppressed error count for a component
   */
  getSuppressedCount(element: Element): number {
    return this._suppressedCount.get(this._getComponentKey(element)) || 0;
  }

  /**
   * Clear rate limiting state (e.g., after user acknowledges errors)
   */
  clearRateLimits(): void {
    this._rateLimited.clear();
    this._errorTimestamps.clear();
    this._suppressedCount.clear();
  }

  /**
   * Get total suppressed error count across all components
   */
  getTotalSuppressedCount(): number {
    let total = 0;
    for (const count of this._suppressedCount.values()) {
      total += count;
    }
    return total;
  }

  /**
   * Check if any component is currently rate limited
   */
  hasRateLimitedComponents(): boolean {
    const now = Date.now();
    for (const cooldownEnd of this._rateLimited.values()) {
      if (now < cooldownEnd) return true;
    }
    return false;
  }

  /**
   * Get all recorded errors
   */
  getErrors(): ComponentError[] {
    return [...this._errors];
  }

  /**
   * Get most recent error
   */
  getLastError(): ComponentError | undefined {
    return this._errors[this._errors.length - 1];
  }

  /**
   * Clear all errors
   */
  clearErrors(): void {
    this._errors = [];
  }

  /**
   * Clear errors older than specified age
   */
  clearOldErrors(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs;
    this._errors = this._errors.filter(e => e.timestamp > cutoff);
  }

  /**
   * Check if there are any errors
   */
  hasErrors(): boolean {
    return this._errors.length > 0;
  }

  /**
   * Get error count
   */
  errorCount(): number {
    return this._errors.length;
  }
}

/**
 * Error overlay for displaying errors on screen
 */
export class ErrorOverlay {
  private _options: ErrorOverlayOptions;
  private _enabled = false;
  private _errorHandler: ErrorHandler;

  constructor(errorHandler: ErrorHandler, options: Partial<ErrorOverlayOptions> = {}) {
    this._errorHandler = errorHandler;
    this._options = {
      enabled: true,
      position: 'bottom-left',
      maxErrors: 3,
      autoDismissMs: 10000,
      ...options,
    };
    this._enabled = this._options.enabled;
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  toggle(): void {
    this._enabled = !this._enabled;
  }

  /**
   * Render error overlay on the buffer
   */
  render(buffer: DualBuffer): void {
    if (!this._enabled) return;

    // Clear old errors
    this._errorHandler.clearOldErrors(this._options.autoDismissMs);

    const errors = this._errorHandler.getErrors().slice(-this._options.maxErrors);
    if (errors.length === 0) return;

    const lines = this._formatErrors(errors);
    const maxWidth = Math.min(
      Math.max(...lines.map(line => line.length)) + 2,
      Math.floor(buffer.width * 0.8)
    );

    const { x, y } = this._calculatePosition(buffer, maxWidth, lines.length);

    this._renderOverlay(buffer, x, y, maxWidth, lines);
  }

  private _formatErrors(errors: ComponentError[]): string[] {
    const lines: string[] = [];

    // Check for rate limiting status
    const suppressed = this._errorHandler.getTotalSuppressedCount();
    const isRateLimited = this._errorHandler.hasRateLimitedComponents();

    if (isRateLimited && suppressed > 0) {
      lines.push(`[!] ${errors.length} error${errors.length > 1 ? 's' : ''} (+${suppressed} suppressed)`);
    } else {
      lines.push(`[!] ${errors.length} error${errors.length > 1 ? 's' : ''}`);
    }

    for (const err of errors) {
      const age = Math.floor((Date.now() - err.timestamp) / 1000);
      const ageStr = age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`;
      const msg = err.error.message.slice(0, 40);
      lines.push(`  ${err.elementType}: ${msg} (${ageStr})`);
    }

    return lines;
  }

  private _calculatePosition(buffer: DualBuffer, width: number, height: number): { x: number; y: number } {
    switch (this._options.position) {
      case 'top-left':
        return { x: 1, y: 1 };
      case 'top-right':
        return { x: buffer.width - width - 1, y: 1 };
      case 'bottom-right':
        return { x: buffer.width - width - 1, y: buffer.height - height - 1 };
      case 'bottom-left':
      default:
        return { x: 1, y: buffer.height - height - 1 };
    }
  }

  private _renderOverlay(buffer: DualBuffer, x: number, y: number, width: number, lines: string[]): void {
    const bgColor = getThemeColor('error') || '#8b0000';
    const textColor = '#ffffff';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].padEnd(width).slice(0, width);
      const lineY = y + i;

      if (lineY < 0 || lineY >= buffer.height) continue;

      for (let j = 0; j < line.length; j++) {
        const cellX = x + j;
        if (cellX < 0 || cellX >= buffer.width) continue;

        buffer.currentBuffer.setCell(cellX, lineY, {
          char: line[j],
          foreground: textColor,
          background: bgColor,
          bold: i === 0,
        });
      }
    }
  }
}

/**
 * Render an error placeholder for a failed component
 */
export function renderErrorPlaceholder(
  buffer: DualBuffer,
  bounds: Bounds,
  elementType: string,
  error: Error
): void {
  const errorColor = getThemeColor('error') || '#ff0000';
  const bgColor = getThemeColor('background') || '#000000';

  // Format: [!] type: message
  const shortMsg = error.message.slice(0, bounds.width - elementType.length - 6);
  const text = `[!] ${elementType}: ${shortMsg}`;
  const displayText = text.slice(0, bounds.width);

  // Render on first line of bounds
  for (let i = 0; i < displayText.length && bounds.x + i < buffer.width; i++) {
    buffer.currentBuffer.setCell(bounds.x + i, bounds.y, {
      char: displayText[i],
      foreground: errorColor,
      background: bgColor,
      bold: true,
    });
  }
}

// Global error handler instance
let globalErrorHandler: ErrorHandler | null = null;
let globalErrorOverlay: ErrorOverlay | null = null;

export function getGlobalErrorHandler(): ErrorHandler {
  if (!globalErrorHandler) {
    globalErrorHandler = new ErrorHandler();
  }
  return globalErrorHandler;
}

export function getGlobalErrorOverlay(): ErrorOverlay {
  if (!globalErrorOverlay) {
    globalErrorOverlay = new ErrorOverlay(getGlobalErrorHandler());
  }
  return globalErrorOverlay;
}
