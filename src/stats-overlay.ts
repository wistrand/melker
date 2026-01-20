// Statistics overlay for debugging and performance monitoring
// Displays buffer and rendering statistics when enabled via MELKER_SHOW_STATS

import type { BufferStats, DualBuffer } from './buffer.ts';
import { getThemeColor } from './theme.ts';
import { COLORS } from './components/color-utils.ts';
import { MelkerConfig } from './config/mod.ts';

export interface StatsOverlayOptions {
  enabled: boolean;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity: number;
  updateInterval: number; // ms
}

export class StatsOverlay {
  private _options: StatsOverlayOptions;
  private _lastUpdate = 0;
  private _enabled = false;

  constructor(options: Partial<StatsOverlayOptions> = {}) {
    this._options = {
      enabled: false,
      position: 'top-right',
      opacity: 0.8,
      updateInterval: 100,
      ...options
    };

    // Check environment variable
    this._enabled = this._checkEnvironmentVariable();
    this._options.enabled = this._enabled;
  }

  private _checkEnvironmentVariable(): boolean {
    return MelkerConfig.get().debugShowStats;
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  // Render stats overlay on the buffer
  render(buffer: DualBuffer, stats: BufferStats | null): void {
    if (!this._enabled || !stats) return;

    // Additional safety check
    try {

    const currentTime = Date.now();
    if (currentTime - this._lastUpdate < this._options.updateInterval) {
      return;
    }
    this._lastUpdate = currentTime;

    const overlayText = this._formatStats(stats);
    const lines = overlayText.split('\n');
    const maxWidth = Math.max(...lines.map(line => line.length));

    const { x, y } = this._calculatePosition(buffer, maxWidth, lines.length);

    // Render compact stats directly without box
    this._renderStatsText(buffer, x, y, lines);
    } catch (error) {
      // Silently fail if stats overlay has issues
      console.warn('Stats overlay error:', error);
    }
  }

  private _formatStats(stats: BufferStats | null): string {
    // Extra defensive check
    if (!stats || typeof stats !== 'object') {
      return `Stats: Loading...`;
    }

    const formatNumber = (num: number, decimals = 1) => {
      if (num === undefined || num === null || isNaN(num)) return '0';
      return num.toFixed(decimals);
    };
    const formatBytes = (bytes: number) => {
      if (!bytes || isNaN(bytes)) return '0B';
      if (bytes < 1024) return `${bytes}B`;
      if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024)}KB`;
      return `${formatNumber(bytes / (1024 * 1024))}MB`;
    };

    // Provide safe defaults for all stats with extra safety
    const safeStats = {
      totalCells: (stats && typeof stats.totalCells === 'number') ? stats.totalCells : 0,
      nonEmptyCells: (stats && typeof stats.nonEmptyCells === 'number') ? stats.nonEmptyCells : 0,
      changedCells: (stats && typeof stats.changedCells === 'number') ? stats.changedCells : 0,
      bufferUtilization: (stats && typeof stats.bufferUtilization === 'number') ? stats.bufferUtilization : 0,
      renderFrequency: (stats && typeof stats.renderFrequency === 'number') ? stats.renderFrequency : 0,
      frameCount: (stats && typeof stats.frameCount === 'number') ? stats.frameCount : 0,
      lastRenderTime: (stats && typeof stats.lastRenderTime === 'number') ? stats.lastRenderTime : 0,
      averageRenderTime: (stats && typeof stats.averageRenderTime === 'number') ? stats.averageRenderTime : 0,
      memoryUsage: (stats && typeof stats.memoryUsage === 'number') ? stats.memoryUsage : 0
    };

    // Compact single-line format
    return [
      `Buf:${safeStats.nonEmptyCells}/${safeStats.totalCells}`,
      `${formatNumber(safeStats.bufferUtilization)}%`,
      `FPS:${formatNumber(safeStats.renderFrequency)}`,
      `${formatNumber(safeStats.lastRenderTime)}ms`,
      `${formatBytes(safeStats.memoryUsage)}`
    ].join(' ');
  }

  private _calculatePosition(buffer: DualBuffer, width: number, height: number): { x: number, y: number } {
    // Always position in upper right corner, compact style
    const x = Math.max(0, buffer.width - width - 1);
    const y = 0;

    return { x, y };
  }

  private _renderStatsText(
    buffer: DualBuffer,
    x: number,
    y: number,
    lines: string[]
  ): void {
    // Use a semi-transparent dark background for contrast
    const bgColor = COLORS.black;
    const textColor = getThemeColor('textSecondary') ?? COLORS.gray;

    // Draw text content directly
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 0 && y + i < buffer.height) {
        // Clear background for the text line
        for (let j = 0; j < line.length && x + j < buffer.width; j++) {
          buffer.currentBuffer.setCell(x + j, y + i, {
            char: line[j],
            foreground: textColor,
            background: bgColor,
            bold: false
          });
        }
      }
    }
  }

  // Toggle overlay visibility
  toggle(): void {
    this._enabled = !this._enabled;
    this._options.enabled = this._enabled;
  }

  // Set overlay position
  setPosition(position: StatsOverlayOptions['position']): void {
    this._options.position = position;
  }

  // Update overlay options
  updateOptions(options: Partial<StatsOverlayOptions>): void {
    this._options = { ...this._options, ...options };
    if (options.enabled !== undefined) {
      this._enabled = options.enabled;
    }
  }
}

// Global stats overlay instance
let globalStatsOverlay: StatsOverlay | null = null;

export function getGlobalStatsOverlay(): StatsOverlay {
  if (!globalStatsOverlay) {
    globalStatsOverlay = new StatsOverlay();
  }
  return globalStatsOverlay;
}

export function isStatsOverlayEnabled(): boolean {
  return getGlobalStatsOverlay().isEnabled();
}