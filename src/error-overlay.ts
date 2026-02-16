// Error overlay for displaying script errors — Amiga Guru Meditation style
// Shows a bordered box at the bottom of the screen with red text on black

import type { DualBuffer } from './buffer.ts';
import { BORDER_CHARS } from './types.ts';
import { getThemeColor } from './theme.ts';
import { COLORS, parseColor } from './components/color-utils.ts';
import { getGlobalLoggerOptions } from './logging.ts';

export interface ErrorInfo {
  message: string;
  location?: string;  // filepath:line:column
  timestamp: number;
}

const GURU_BORDER = BORDER_CHARS.thin;

// Left-align text within a given width, truncating or padding as needed
function padLine(text: string, width: number): string {
  if (text.length > width) return text.slice(0, width - 3) + '...';
  return text.padEnd(width, ' ');
}

/**
 * Build a guru meditation box: thin border, padding lines, content lines.
 * Returns an array of full-width strings ready to render.
 */
export function buildGuruBox(contentLines: string[], innerWidth: number, title?: string): string[] {
  const { h, v, tl, tr, bl, br } = GURU_BORDER;
  const lines: string[] = [];

  if (title && innerWidth >= title.length + 4) {
    const label = ` ${title} `;
    const leftLen = Math.floor((innerWidth - label.length) / 2);
    const rightLen = innerWidth - leftLen - label.length;
    lines.push(tl + h.repeat(leftLen) + label + h.repeat(rightLen) + tr);
  } else {
    lines.push(tl + h.repeat(innerWidth) + tr);
  }
  lines.push(v + ' '.repeat(innerWidth) + v);
  for (const content of contentLines) {
    lines.push(v + padLine(`  ${content}`, innerWidth) + v);
  }
  lines.push(v + ' '.repeat(innerWidth) + v);
  lines.push(bl + h.repeat(innerWidth) + br);

  return lines;
}

/**
 * Render guru box lines to a buffer at the given position.
 * Red text/border on black background.
 */
export function renderGuruBox(
  buffer: DualBuffer,
  x: number,
  y: number,
  lines: string[],
  width: number,
): void {
  const textColor = getThemeColor('error') ?? parseColor('#cc0000')!;
  const bgColor = COLORS.black;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineY = y + i;

    if (lineY < 0 || lineY >= buffer.height) continue;

    for (let j = 0; j < width; j++) {
      const cellX = x + j;
      if (cellX < 0 || cellX >= buffer.width) continue;

      const char = j < line.length ? line[j] : ' ';
      buffer.currentBuffer.setCell(cellX, lineY, {
        char,
        foreground: textColor,
        background: bgColor,
      });
    }
  }
}

export class ErrorOverlay {
  private _currentError: ErrorInfo | null = null;
  private _displayDuration = 15000; // Auto-hide after 15 seconds
  private _enabled = true;

  constructor() {}

  isEnabled(): boolean {
    return this._enabled;
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  showError(message: string, location?: string): void {
    this._currentError = {
      message,
      location,
      timestamp: Date.now()
    };
  }

  clearError(): void {
    this._currentError = null;
  }

  hasError(): boolean {
    if (!this._currentError) return false;
    if (Date.now() - this._currentError.timestamp > this._displayDuration) {
      this._currentError = null;
      return false;
    }
    return true;
  }

  render(buffer: DualBuffer): void {
    if (!this._enabled || !this.hasError() || !this._currentError) return;

    const error = this._currentError;
    const width = buffer.width;
    const innerWidth = width - 2;

    const contentLines = this._formatContent(error);
    const lines = buildGuruBox(contentLines, innerWidth, 'Script Error');

    const startY = Math.max(0, buffer.height - lines.length);
    renderGuruBox(buffer, 0, startY, lines, width);
  }

  private _formatContent(error: ErrorInfo): string[] {
    const content: string[] = [];

    const messageParts = error.message.split('\n');
    const firstLine = messageParts[0] || error.message;
    content.push(firstLine);

    if (error.location) {
      content.push(error.location);
    }

    const loggerOpts = getGlobalLoggerOptions();
    if (loggerOpts.logFile) {
      content.push(`Log: ${loggerOpts.logFile}`);
    }

    return content;
  }

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

export function showScriptError(message: string, location?: string): void {
  getGlobalErrorOverlay().showError(message, location);
}

export function clearScriptError(): void {
  getGlobalErrorOverlay().clearError();
}
