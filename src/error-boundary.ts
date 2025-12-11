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
 * Error handler that collects and manages component errors
 */
export class ErrorHandler {
  private _errors: ComponentError[] = [];
  private _maxErrors: number;
  private _onError?: (error: ComponentError) => void;

  constructor(options: { maxErrors?: number; onError?: (error: ComponentError) => void } = {}) {
    this._maxErrors = options.maxErrors ?? 10;
    this._onError = options.onError;
  }

  /**
   * Record a component error
   */
  captureError(element: Element, error: Error, bounds?: Bounds): void {
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

    lines.push(`[!] ${errors.length} error${errors.length > 1 ? 's' : ''}`);

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
