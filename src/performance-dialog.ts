// Performance dialog for live stats monitoring
// Toggled with Ctrl+Shift+P, shows engine and layout statistics

import type { DualBuffer } from './buffer.ts';
import { BORDER_CHARS, type Bounds } from './types.ts';
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

  // Input latency stats (total and breakdown)
  inputLatency: number;
  inputLatencyAvg: number;
  // Latency breakdown (all in ms)
  handlerTime: number;   // Event handling + script execution
  waitTime: number;      // Debounce delay (render requested -> render started)
  layoutTime2: number;   // Layout calculation only
  bufferTime: number;    // Rendering to buffer
  applyTime: number;     // Writing to terminal

  // Shader stats
  shaderCount: number;       // Number of active shaders
  shaderFrameTime: number;   // Last shader frame time (ms)
  shaderFrameTimeAvg: number; // Average shader frame time (ms)
  shaderFps: number;         // Shader frames per second
  shaderPixels: number;      // Total pixels being rendered by shaders
}

export interface PerformanceDialogOptions {
  width: number;
  height: number;
}

const DEFAULT_WIDTH = 32;
const DEFAULT_HEIGHT = 23;  // Increased to fit shader stats

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
  private _inputLatencies: number[] = [];
  private _lastFpsUpdate = 0;
  private _framesSinceLastFps = 0;
  private _currentFps = 0;

  // Input latency tracking
  private _inputStartTime = 0;
  private _lastInputLatency = 0;

  // Shader stats tracking
  private _shaderFrameTimes: number[] = [];
  private _lastShaderFpsUpdate = 0;
  private _shaderFramesSinceLastFps = 0;
  private _currentShaderFps = 0;
  private _activeShaderIds = new Set<string>();
  private _lastShaderFrameTime = 0;
  private _totalShaderPixels = 0;

  // Latency breakdown tracking
  private _renderRequestedTime = 0;
  private _renderStartTime = 0;
  private _layoutEndTime = 0;
  private _bufferEndTime = 0;
  private _lastHandlerTime = 0;
  private _lastWaitTime = 0;
  private _lastLayoutTime2 = 0;
  private _lastBufferTime = 0;
  private _lastApplyTime = 0;

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
   * Mark the start of input processing (call when input event is received)
   */
  markInputStart(): void {
    this._inputStartTime = performance.now();
  }

  /**
   * Record input-to-render latency (call after render completes)
   */
  recordInputLatency(): void {
    if (this._inputStartTime > 0) {
      const latency = performance.now() - this._inputStartTime;
      this._lastInputLatency = latency;
      this._inputLatencies.push(latency);
      if (this._inputLatencies.length > 60) {
        this._inputLatencies.shift();
      }
      this._inputStartTime = 0; // Reset for next input
    }
  }

  /**
   * Get average input latency
   */
  getAverageInputLatency(): number {
    if (this._inputLatencies.length === 0) return 0;
    return this._inputLatencies.reduce((a, b) => a + b, 0) / this._inputLatencies.length;
  }

  /**
   * Get last recorded input latency
   */
  getLastInputLatency(): number {
    return this._lastInputLatency;
  }

  /**
   * Mark when render is requested (call before debounce, e.g., in _debouncedInputRender)
   */
  markRenderRequested(): void {
    this._renderRequestedTime = performance.now();
    // Calculate handler time (input received -> render requested)
    if (this._inputStartTime > 0) {
      this._lastHandlerTime = this._renderRequestedTime - this._inputStartTime;
    } else {
      this._lastHandlerTime = 0;
    }
  }

  /**
   * Mark the start of render phase (call at beginning of render())
   */
  markRenderStart(): void {
    this._renderStartTime = performance.now();
    // Calculate wait time (render requested -> render started, i.e., debounce delay)
    if (this._renderRequestedTime > 0) {
      this._lastWaitTime = this._renderStartTime - this._renderRequestedTime;
      this._renderRequestedTime = 0; // Reset for next cycle
    } else {
      // Direct render (no debounce) - handler time is input -> render start
      if (this._inputStartTime > 0) {
        this._lastHandlerTime = this._renderStartTime - this._inputStartTime;
      }
      this._lastWaitTime = 0;
    }
  }

  /**
   * Mark the end of layout phase (call after calculateLayout())
   */
  markLayoutEnd(): void {
    this._layoutEndTime = performance.now();
    if (this._renderStartTime > 0) {
      this._lastLayoutTime2 = this._layoutEndTime - this._renderStartTime;
    }
  }

  /**
   * Mark the end of buffer rendering (call after _renderNode() completes)
   */
  markBufferEnd(): void {
    this._bufferEndTime = performance.now();
    if (this._layoutEndTime > 0) {
      this._lastBufferTime = this._bufferEndTime - this._layoutEndTime;
    }
  }

  /**
   * Mark the end of apply phase (call after _renderOptimized())
   */
  markApplyEnd(): void {
    const now = performance.now();
    if (this._bufferEndTime > 0) {
      this._lastApplyTime = now - this._bufferEndTime;
    }
  }

  /**
   * Get latency breakdown
   */
  getLatencyBreakdown(): { handler: number; wait: number; layout: number; buffer: number; apply: number } {
    return {
      handler: this._lastHandlerTime,
      wait: this._lastWaitTime,
      layout: this._lastLayoutTime2,
      buffer: this._lastBufferTime,
      apply: this._lastApplyTime,
    };
  }

  /**
   * Get current FPS
   */
  getFps(): number {
    return this._currentFps;
  }

  // ============ Shader Stats Methods ============

  /**
   * Register a shader (call when shader starts)
   * @param id Unique identifier for the shader (e.g., canvas element id)
   * @param pixelCount Number of pixels the shader renders
   */
  registerShader(id: string, pixelCount: number): void {
    this._activeShaderIds.add(id);
    // Recalculate total pixels
    // Note: This is a simple approach - for accurate per-shader tracking,
    // we'd need to store pixel counts per shader
    this._totalShaderPixels += pixelCount;
  }

  /**
   * Unregister a shader (call when shader stops)
   * @param id Unique identifier for the shader
   * @param pixelCount Number of pixels the shader was rendering
   */
  unregisterShader(id: string, pixelCount: number): void {
    this._activeShaderIds.delete(id);
    this._totalShaderPixels = Math.max(0, this._totalShaderPixels - pixelCount);
    // Reset stats if no shaders active
    if (this._activeShaderIds.size === 0) {
      this._shaderFrameTimes = [];
      this._currentShaderFps = 0;
      this._lastShaderFrameTime = 0;
      this._totalShaderPixels = 0;
    }
  }

  /**
   * Record a shader frame time
   * @param ms Time in milliseconds for this shader frame
   */
  recordShaderFrameTime(ms: number): void {
    this._lastShaderFrameTime = ms;
    this._shaderFrameTimes.push(ms);
    if (this._shaderFrameTimes.length > 60) {
      this._shaderFrameTimes.shift();
    }

    // Update shader FPS calculation
    this._shaderFramesSinceLastFps++;
    const now = performance.now();
    const elapsed = now - this._lastShaderFpsUpdate;
    if (elapsed >= 1000) {
      this._currentShaderFps = (this._shaderFramesSinceLastFps / elapsed) * 1000;
      this._shaderFramesSinceLastFps = 0;
      this._lastShaderFpsUpdate = now;
    }
  }

  /**
   * Get average shader frame time
   */
  getAverageShaderFrameTime(): number {
    if (this._shaderFrameTimes.length === 0) return 0;
    return this._shaderFrameTimes.reduce((a, b) => a + b, 0) / this._shaderFrameTimes.length;
  }

  /**
   * Get current shader FPS
   */
  getShaderFps(): number {
    return this._currentShaderFps;
  }

  /**
   * Get number of active shaders
   */
  getActiveShaderCount(): number {
    return this._activeShaderIds.size;
  }

  /**
   * Get last shader frame time
   */
  getLastShaderFrameTime(): number {
    return this._lastShaderFrameTime;
  }

  /**
   * Get total shader pixels
   */
  getTotalShaderPixels(): number {
    return this._totalShaderPixels;
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
    const titleBg = getThemeColor('background') || '#1a1a2e';
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
    const borderChars = BORDER_CHARS.thin;
    for (let i = 0; i < this._width; i++) {
      const px = x + i;
      if (px >= 0 && px < viewportWidth && y >= 0 && y < viewportHeight) {
        let char: string;
        let fg = borderColor;
        // Check if in close button area
        if (px >= closeX && px < closeX + 3) {
          char = closeBtn[px - closeX];
          fg = textColor;
        } else if (px >= titleX && px < titleX + title.length) {
          char = title[px - titleX];
        } else if (i === 0) {
          char = borderChars.tl;
        } else if (i === this._width - 1) {
          char = borderChars.tr;
        } else {
          char = borderChars.h;
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

    // Use predefined border characters
    const chars = BORDER_CHARS.thin;

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

    // Calculate max FPS from average render time (theoretical capability)
    const maxFps = stats.renderTimeAvg > 0 ? 1000 / stats.renderTimeAvg : 0;

    // Color based on thresholds
    const maxFpsColor = maxFps >= 60 ? '#22c55e' : maxFps >= 30 ? '#eab308' : '#ef4444';
    const renderColor = stats.renderTime < 16 ? '#22c55e' : stats.renderTime < 33 ? '#eab308' : '#ef4444';
    const layoutColor = stats.layoutTime < 5 ? '#22c55e' : stats.layoutTime < 10 ? '#eab308' : '#ef4444';
    // Input latency: <50ms good, <100ms ok, >100ms bad
    const latencyColor = stats.inputLatency < 50 ? '#22c55e' : stats.inputLatency < 100 ? '#eab308' : '#ef4444';

    // Format latency breakdown as compact string (h=handler, w=wait/debounce, l=layout, b=buffer, a=apply)
    // Pad each number to 2 chars for stability
    const pad = (n: number) => n.toFixed(0).padStart(2, ' ');
    const hasBreakdown = stats.handlerTime > 0 || stats.waitTime > 0 || stats.layoutTime2 > 0 || stats.bufferTime > 0 || stats.applyTime > 0;
    const breakdownStr = hasBreakdown
      ? `${pad(stats.handlerTime)}+${pad(stats.waitTime)}+${pad(stats.layoutTime2)}+${pad(stats.bufferTime)}+${pad(stats.applyTime)}`
      : '-';

    // Shader stats (only show if shaders are active)
    const hasShaders = stats.shaderCount > 0;
    // Color for shader frame time: <16ms good (60fps capable), <33ms ok (30fps), >33ms bad
    const shaderTimeColor = stats.shaderFrameTime < 16 ? '#22c55e' : stats.shaderFrameTime < 33 ? '#eab308' : '#ef4444';

    const lines: Array<{ label: string; value: string; color?: string }> = [
      { label: 'Max FPS', value: maxFps > 0 ? maxFps.toFixed(0) : '-', color: maxFpsColor },
      { label: 'Renders/s', value: stats.fps.toFixed(1) },
      { label: 'Render', value: formatMs(stats.renderTime), color: renderColor },
      { label: 'Render avg', value: formatMs(stats.renderTimeAvg) },
      { label: 'Layout', value: formatMs(stats.layoutTime), color: layoutColor },
      { label: 'Layout avg', value: formatMs(stats.layoutTimeAvg) },
      { label: 'Input lat', value: stats.inputLatency > 0 ? formatMs(stats.inputLatency) : '-', color: stats.inputLatency > 0 ? latencyColor : undefined },
      { label: 'Input avg', value: stats.inputLatencyAvg > 0 ? formatMs(stats.inputLatencyAvg) : '-' },
      { label: 'Breakdown', value: breakdownStr },
      { label: '', value: 'h+w+l+b+a' },
    ];

    // Add shader stats section if shaders are running
    if (hasShaders) {
      lines.push({ label: '--- Shaders', value: `${stats.shaderCount} active ---` });
      lines.push({ label: 'Shader FPS', value: stats.shaderFps > 0 ? stats.shaderFps.toFixed(1) : '-' });
      lines.push({ label: 'Frame time', value: formatMs(stats.shaderFrameTime), color: shaderTimeColor });
      lines.push({ label: 'Frame avg', value: formatMs(stats.shaderFrameTimeAvg) });
      lines.push({ label: 'Pixels', value: stats.shaderPixels > 1000 ? `${(stats.shaderPixels / 1000).toFixed(1)}k` : String(stats.shaderPixels) });
    }

    lines.push({ label: 'Nodes', value: String(stats.layoutNodeCount) });
    lines.push({ label: 'Cells', value: `${stats.changedCells}/${stats.totalCells}` });
    lines.push({ label: 'Memory', value: formatBytes(stats.memoryUsage) });
    lines.push({ label: 'Renders', value: String(stats.renderCount) });
    lines.push({ label: 'Errors', value: stats.errorCount > 0 ? String(stats.errorCount) : '-',
      color: stats.errorCount > 0 ? '#ef4444' : undefined });

    return lines;
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
