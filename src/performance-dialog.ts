// Performance dialog for live stats monitoring
// Toggled with Ctrl+Shift+P, shows engine and layout statistics

import type { DualBuffer } from './buffer.ts';
import type { Bounds } from './types.ts';
import { getThemeColor } from './theme.ts';

export interface PerformanceStats {
  // Render stats
  fps: number;
  renderTime: number;
  renderTimeAvg: number;
  renderCount: number;

  // Layout stats
  layoutTime: number;
  layoutTimeAvg: number;
  layoutNodeCount: number;

  // Buffer stats
  totalCells: number;
  changedCells: number;
  bufferUtilization: number;

  // Memory
  memoryUsage: number;

  // Error stats
  errorCount: number;
  suppressedErrors: number;
}

export interface PerformanceDialogOptions {
  width: number;
  height: number;
}

const DEFAULT_WIDTH = 32;
const DEFAULT_HEIGHT = 14;

/**
 * Performance monitoring dialog
 * Non-modal, draggable overlay showing live engine stats
 */
export class PerformanceDialog {
  private _visible = false;
  private _offsetX = 0;
  private _offsetY = 0;
  private _width: number;
  private _height: number;

  // Drag state
  private _isDragging = false;
  private _dragStartX = 0;
  private _dragStartY = 0;
  private _dragStartOffsetX = 0;
  private _dragStartOffsetY = 0;

  // Stats history for averages
  private _renderTimes: number[] = [];
  private _layoutTimes: number[] = [];
  private _lastFpsUpdate = 0;
  private _framesSinceLastFps = 0;
  private _currentFps = 0;

  // Current bounds (for hit testing)
  private _bounds: Bounds | null = null;

  constructor(options: Partial<PerformanceDialogOptions> = {}) {
    this._width = options.width ?? DEFAULT_WIDTH;
    this._height = options.height ?? DEFAULT_HEIGHT;
  }

  isVisible(): boolean {
    return this._visible;
  }

  toggle(): void {
    this._visible = !this._visible;
  }

  show(): void {
    this._visible = true;
  }

  hide(): void {
    this._visible = false;
  }

  getBounds(): Bounds | null {
    return this._bounds;
  }

  /**
   * Record a render time for averaging
   */
  recordRenderTime(ms: number): void {
    this._renderTimes.push(ms);
    if (this._renderTimes.length > 60) {
      this._renderTimes.shift();
    }

    // Update FPS calculation
    this._framesSinceLastFps++;
    const now = performance.now();
    const elapsed = now - this._lastFpsUpdate;
    if (elapsed >= 1000) {
      this._currentFps = (this._framesSinceLastFps / elapsed) * 1000;
      this._framesSinceLastFps = 0;
      this._lastFpsUpdate = now;
    }
  }

  /**
   * Record a layout time for averaging
   */
  recordLayoutTime(ms: number): void {
    this._layoutTimes.push(ms);
    if (this._layoutTimes.length > 60) {
      this._layoutTimes.shift();
    }
  }

  /**
   * Get average render time
   */
  getAverageRenderTime(): number {
    if (this._renderTimes.length === 0) return 0;
    return this._renderTimes.reduce((a, b) => a + b, 0) / this._renderTimes.length;
  }

  /**
   * Get average layout time
   */
  getAverageLayoutTime(): number {
    if (this._layoutTimes.length === 0) return 0;
    return this._layoutTimes.reduce((a, b) => a + b, 0) / this._layoutTimes.length;
  }

  /**
   * Get current FPS
   */
  getFps(): number {
    return this._currentFps;
  }

  /**
   * Check if point is on close button [X]
   */
  isOnCloseButton(x: number, y: number): boolean {
    if (!this._bounds) return false;
    // Close button is at top-right corner of title bar
    const closeX = this._bounds.x + this._bounds.width - 4;
    return (
      x >= closeX &&
      x < this._bounds.x + this._bounds.width - 1 &&
      y === this._bounds.y
    );
  }

  /**
   * Check if point is on title bar (for drag), excluding close button
   */
  isOnTitleBar(x: number, y: number): boolean {
    if (!this._bounds) return false;
    if (this.isOnCloseButton(x, y)) return false;
    return (
      x >= this._bounds.x &&
      x < this._bounds.x + this._bounds.width &&
      y === this._bounds.y
    );
  }

  /**
   * Check if point is inside dialog
   */
  isInside(x: number, y: number): boolean {
    if (!this._bounds) return false;
    return (
      x >= this._bounds.x &&
      x < this._bounds.x + this._bounds.width &&
      y >= this._bounds.y &&
      y < this._bounds.y + this._bounds.height
    );
  }

  /**
   * Start dragging
   */
  startDrag(x: number, y: number): void {
    this._isDragging = true;
    this._dragStartX = x;
    this._dragStartY = y;
    this._dragStartOffsetX = this._offsetX;
    this._dragStartOffsetY = this._offsetY;
  }

  /**
   * Update drag position
   */
  updateDrag(x: number, y: number, viewportWidth: number, viewportHeight: number): void {
    if (!this._isDragging) return;

    const deltaX = x - this._dragStartX;
    const deltaY = y - this._dragStartY;

    // Calculate new offset with bounds checking
    let newOffsetX = this._dragStartOffsetX + deltaX;
    let newOffsetY = this._dragStartOffsetY + deltaY;

    // Calculate dialog position at center
    const centerX = Math.floor((viewportWidth - this._width) / 2);
    const centerY = Math.floor((viewportHeight - this._height) / 2);

    // Clamp to viewport
    const minX = -centerX;
    const maxX = viewportWidth - this._width - centerX;
    const minY = -centerY;
    const maxY = viewportHeight - this._height - centerY;

    newOffsetX = Math.max(minX, Math.min(maxX, newOffsetX));
    newOffsetY = Math.max(minY, Math.min(maxY, newOffsetY));

    this._offsetX = newOffsetX;
    this._offsetY = newOffsetY;
  }

  /**
   * End dragging
   */
  endDrag(): void {
    this._isDragging = false;
  }

  /**
   * Check if currently dragging
   */
  isDragging(): boolean {
    return this._isDragging;
  }

  /**
   * Render the performance dialog
   */
  render(buffer: DualBuffer, stats: PerformanceStats): void {
    if (!this._visible) return;

    const viewportWidth = buffer.width;
    const viewportHeight = buffer.height;

    // Calculate position (centered + offset)
    const x = Math.floor((viewportWidth - this._width) / 2) + this._offsetX;
    const y = Math.floor((viewportHeight - this._height) / 2) + this._offsetY;

    // Store bounds for hit testing
    this._bounds = { x, y, width: this._width, height: this._height };

    // Colors
    const bgColor = getThemeColor('background') || '#1a1a2e';
    const borderColor = getThemeColor('border') || '#4a4a6a';
    const titleBg = getThemeColor('primary') || '#3b82f6';
    const textColor = getThemeColor('textPrimary') || '#e0e0e0';
    const labelColor = getThemeColor('textSecondary') || '#888888';
    const goodColor = '#22c55e';
    const warnColor = '#eab308';
    const badColor = '#ef4444';

    // Draw background
    for (let dy = 0; dy < this._height; dy++) {
      for (let dx = 0; dx < this._width; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px >= 0 && px < viewportWidth && py >= 0 && py < viewportHeight) {
          buffer.currentBuffer.setCell(px, py, {
            char: ' ',
            foreground: textColor,
            background: bgColor,
          });
        }
      }
    }

    // Draw border
    this._drawBorder(buffer, x, y, borderColor, bgColor);

    // Draw title bar with close button [X]
    const title = ' Performance ';
    const closeBtn = '[X]';
    const titleX = x + Math.floor((this._width - title.length) / 2);
    const closeX = x + this._width - 4; // Position for [X]
    for (let i = 0; i < this._width; i++) {
      const px = x + i;
      if (px >= 0 && px < viewportWidth && y >= 0 && y < viewportHeight) {
        let char: string;
        let fg = '#ffffff';
        // Check if in close button area
        if (px >= closeX && px < closeX + 3) {
          char = closeBtn[px - closeX];
          fg = '#ff6b6b'; // Red-ish for close button
        } else if (px >= titleX && px < titleX + title.length) {
          char = title[px - titleX];
        } else if (i === 0) {
          char = '\u250c';
        } else if (i === this._width - 1) {
          char = '\u2510';
        } else {
          char = '\u2500';
        }
        buffer.currentBuffer.setCell(px, y, {
          char,
          foreground: fg,
          background: titleBg,
          bold: true,
        });
      }
    }

    // Format and draw stats
    const lines = this._formatStats(stats);
    for (let i = 0; i < lines.length; i++) {
      const lineY = y + 2 + i;
      if (lineY >= viewportHeight - 1) break;

      const { label, value, color } = lines[i];
      const labelStr = label.padEnd(12);
      const valueStr = value.padStart(this._width - 16);

      // Draw label
      for (let j = 0; j < labelStr.length; j++) {
        const px = x + 2 + j;
        if (px >= 0 && px < viewportWidth - 1) {
          buffer.currentBuffer.setCell(px, lineY, {
            char: labelStr[j],
            foreground: labelColor,
            background: bgColor,
          });
        }
      }

      // Draw value
      for (let j = 0; j < valueStr.length; j++) {
        const px = x + 2 + labelStr.length + j;
        if (px >= 0 && px < viewportWidth - 1) {
          buffer.currentBuffer.setCell(px, lineY, {
            char: valueStr[j],
            foreground: color || textColor,
            background: bgColor,
            bold: true,
          });
        }
      }
    }

    // Draw hint at bottom
    const hint = 'F6 or [X] to close';
    const hintY = y + this._height - 2;
    const hintX = x + Math.floor((this._width - hint.length) / 2);
    for (let i = 0; i < hint.length; i++) {
      const px = hintX + i;
      if (px >= 0 && px < viewportWidth && hintY >= 0 && hintY < viewportHeight) {
        buffer.currentBuffer.setCell(px, hintY, {
          char: hint[i],
          foreground: labelColor,
          background: bgColor,
        });
      }
    }
  }

  private _drawBorder(buffer: DualBuffer, x: number, y: number, borderColor: string, bgColor: string): void {
    const w = this._width;
    const h = this._height;
    const vw = buffer.width;
    const vh = buffer.height;

    // Box drawing characters
    const chars = {
      tl: '\u250c', tr: '\u2510', bl: '\u2514', br: '\u2518',
      h: '\u2500', v: '\u2502'
    };

    // Draw corners and edges
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || px >= vw || py < 0 || py >= vh) continue;

        let char = '';
        if (dy === 0) {
          if (dx === 0) char = chars.tl;
          else if (dx === w - 1) char = chars.tr;
          else char = chars.h;
        } else if (dy === h - 1) {
          if (dx === 0) char = chars.bl;
          else if (dx === w - 1) char = chars.br;
          else char = chars.h;
        } else if (dx === 0 || dx === w - 1) {
          char = chars.v;
        }

        if (char) {
          buffer.currentBuffer.setCell(px, py, {
            char,
            foreground: borderColor,
            background: bgColor,
          });
        }
      }
    }
  }

  private _formatStats(stats: PerformanceStats): Array<{ label: string; value: string; color?: string }> {
    const formatMs = (ms: number) => `${ms.toFixed(1)}ms`;
    const formatBytes = (bytes: number) => {
      if (bytes < 1024) return `${bytes}B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    };

    // Color based on thresholds
    const fpsColor = stats.fps >= 30 ? '#22c55e' : stats.fps >= 15 ? '#eab308' : '#ef4444';
    const renderColor = stats.renderTime < 16 ? '#22c55e' : stats.renderTime < 33 ? '#eab308' : '#ef4444';
    const layoutColor = stats.layoutTime < 5 ? '#22c55e' : stats.layoutTime < 10 ? '#eab308' : '#ef4444';

    return [
      { label: 'FPS', value: stats.fps.toFixed(1), color: fpsColor },
      { label: 'Render', value: formatMs(stats.renderTime), color: renderColor },
      { label: 'Render avg', value: formatMs(stats.renderTimeAvg) },
      { label: 'Layout', value: formatMs(stats.layoutTime), color: layoutColor },
      { label: 'Layout avg', value: formatMs(stats.layoutTimeAvg) },
      { label: 'Nodes', value: String(stats.layoutNodeCount) },
      { label: 'Cells', value: `${stats.changedCells}/${stats.totalCells}` },
      { label: 'Memory', value: formatBytes(stats.memoryUsage) },
      { label: 'Renders', value: String(stats.renderCount) },
      { label: 'Errors', value: stats.errorCount > 0 ? String(stats.errorCount) : '-',
        color: stats.errorCount > 0 ? '#ef4444' : undefined },
    ];
  }
}

// Global instance
let globalPerformanceDialog: PerformanceDialog | null = null;

export function getGlobalPerformanceDialog(): PerformanceDialog {
  if (!globalPerformanceDialog) {
    globalPerformanceDialog = new PerformanceDialog();
  }
  return globalPerformanceDialog;
}
