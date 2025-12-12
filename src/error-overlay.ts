// Error overlay for displaying script errors without destroying the UI
// Shows a compact 3-line overlay at the bottom of the screen

import type { DualBuffer } from './buffer.ts';
import { getThemeColor } from './theme.ts';
import { getGlobalLoggerOptions } from './logging.ts';

export interface ErrorInfo {
  message: string;
  location?: string;  // filepath:line:column
  timestamp: number;
}

export class ErrorOverlay {
  private _currentError: ErrorInfo | null = null;
  private _displayDuration = 5000; // Auto-hide after 5 seconds
  private _enabled = true;

  constructor() {}

  isEnabled(): boolean {
    return this._enabled;
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  // Show an error in the overlay
  showError(message: string, location?: string): void {
    this._currentError = {
      message,
      location,
      timestamp: Date.now()
    };
  }

  // Clear the current error
  clearError(): void {
    this._currentError = null;
  }

  // Check if there's an active error to display
  hasError(): boolean {
    if (!this._currentError) return false;

    // Auto-hide after duration
    if (Date.now() - this._currentError.timestamp > this._displayDuration) {
      this._currentError = null;
      return false;
    }
    return true;
  }

  // Render error overlay on the buffer (3 lines at bottom)
  render(buffer: DualBuffer): void {
    if (!this._enabled || !this.hasError() || !this._currentError) return;

    const error = this._currentError;
    const lines = this._formatError(error, buffer.width);

    // Position at bottom of screen
    const startY = Math.max(0, buffer.height - 3);

    // Render the 3 lines
    this._renderErrorLines(buffer, 0, startY, lines, buffer.width);
  }

  private _formatError(error: ErrorInfo, maxWidth: number): string[] {
    const lines: string[] = [];

    // Line 1: Location or "Script Error"
    const locationLine = error.location
      ? `Error: ${error.location}`
      : 'Script Error';
    lines.push(this._truncateLine(locationLine, maxWidth));

    // Line 2: First line of error message (truncated)
    const messageParts = error.message.split('\n');
    const firstLine = messageParts[0] || error.message;
    lines.push(this._truncateLine(`  ${firstLine}`, maxWidth));

    // Line 3: Log file location
    const loggerOpts = getGlobalLoggerOptions();
    const logFile = loggerOpts.logFile || '(no log file)';
    lines.push(this._truncateLine(`  Full log: ${logFile}`, maxWidth));

    return lines;
  }

  private _truncateLine(line: string, maxWidth: number): string {
    if (line.length <= maxWidth) {
      return line.padEnd(maxWidth, ' ');
    }
    return line.substring(0, maxWidth - 3) + '...';
  }

  private _renderErrorLines(
    buffer: DualBuffer,
    x: number,
    y: number,
    lines: string[],
    width: number
  ): void {
    // Use red background for error visibility
    const bgColor = getThemeColor('error') || '#cc0000';
    const textColor = '#ffffff';

    for (let i = 0; i < lines.length && i < 3; i++) {
      const line = lines[i];
      const lineY = y + i;

      if (lineY >= buffer.height) continue;

      // Fill the entire line width
      for (let j = 0; j < width; j++) {
        const char = j < line.length ? line[j] : ' ';
        buffer.currentBuffer.setCell(x + j, lineY, {
          char,
          foreground: textColor,
          background: bgColor,
          bold: i === 0  // Bold for first line (location)
        });
      }
    }
  }

  // Set how long errors are displayed (in ms)
  setDisplayDuration(ms: number): void {
    this._displayDuration = ms;
  }
}

// Global error overlay instance
let globalErrorOverlay: ErrorOverlay | null = null;

export function getGlobalErrorOverlay(): ErrorOverlay {
  if (!globalErrorOverlay) {
    globalErrorOverlay = new ErrorOverlay();
  }
  return globalErrorOverlay;
}

// Convenience function to show an error
export function showScriptError(message: string, location?: string): void {
  getGlobalErrorOverlay().showError(message, location);
}

// Convenience function to clear errors
export function clearScriptError(): void {
  getGlobalErrorOverlay().clearError();
}
