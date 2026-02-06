// Buffer overlay rendering pipeline
// Renders stats, error, tooltip, toast, and performance overlays onto the buffer
// Extracted from engine.ts to deduplicate code shared between render() and forceRender()

import { DualBuffer } from './buffer.ts';
import {
  getGlobalStatsOverlay,
  isStatsOverlayEnabled,
} from './stats-overlay.ts';
import {
  getGlobalErrorHandler,
  getGlobalErrorOverlay,
} from './error-boundary.ts';
import {
  getGlobalPerformanceDialog,
  type PerformanceStats,
} from './performance-dialog.ts';
import {
  getGlobalErrorOverlay as getGlobalScriptErrorOverlay,
} from './error-overlay.ts';
import {
  renderToastOverlay,
} from './toast/mod.ts';
import {
  renderTooltipOverlay,
} from './tooltip/mod.ts';
import {
  getUIAnimationManager,
} from './ui-animation-manager.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('BufferOverlays');

export interface BufferOverlayContext {
  lastRenderTime: number;
  lastLayoutTime: number;
  layoutNodeCount: number;
  renderCount: number;
}

/**
 * Render all buffer overlays (stats, errors, tooltips, toasts, performance dialog).
 * Called by both render() and forceRender() after the main UI has been rendered to the buffer.
 */
export function renderBufferOverlays(buffer: DualBuffer, ctx: BufferOverlayContext): void {
  // Update stats first (without swapping buffers)
  buffer.updateStatsOnly();

  // Render stats overlay if enabled (now with current stats)
  if (isStatsOverlayEnabled()) {
    try {
      const statsOverlay = getGlobalStatsOverlay();
      const stats = buffer.stats;
      if (stats) {
        statsOverlay.render(buffer, stats);
      }
    } catch (error) {
      // Silently ignore stats overlay errors to prevent breaking the main app
      logger.warn('Stats overlay warning', { error: String(error) });
    }
  }

  // Render error overlay if there are errors
  try {
    getGlobalErrorOverlay().render(buffer);
  } catch {
    // Silently ignore error overlay errors
  }

  // Render script error overlay if there are script errors
  try {
    getGlobalScriptErrorOverlay().render(buffer);
  } catch {
    // Silently ignore script error overlay errors
  }

  // Render tooltip overlay if visible
  try {
    renderTooltipOverlay(buffer);
  } catch (err) {
    logger.error('Tooltip overlay error', err instanceof Error ? err : new Error(String(err)));
  }

  // Render toast overlay if there are toasts
  try {
    renderToastOverlay(buffer);
  } catch {
    // Silently ignore toast overlay errors
  }

  // Render performance dialog if visible
  const perfDialog = getGlobalPerformanceDialog();
  if (perfDialog.isVisible()) {
    try {
      const errorHandler = getGlobalErrorHandler();
      const breakdown = perfDialog.getLatencyBreakdown();
      const perfStats: PerformanceStats = {
        fps: perfDialog.getFps(),
        renderTime: ctx.lastRenderTime,
        renderTimeAvg: perfDialog.getAverageRenderTime(),
        renderCount: ctx.renderCount,
        layoutTime: ctx.lastLayoutTime,
        layoutTimeAvg: perfDialog.getAverageLayoutTime(),
        layoutNodeCount: ctx.layoutNodeCount,
        totalCells: buffer.stats?.totalCells || 0,
        changedCells: buffer.stats?.changedCells || 0,
        bufferUtilization: buffer.stats?.bufferUtilization || 0,
        memoryUsage: buffer.stats?.memoryUsage || 0,
        errorCount: errorHandler.errorCount(),
        suppressedErrors: errorHandler.getTotalSuppressedCount(),
        inputLatency: perfDialog.getLastInputLatency(),
        inputLatencyAvg: perfDialog.getAverageInputLatency(),
        handlerTime: breakdown.handler,
        waitTime: breakdown.wait,
        layoutTime2: breakdown.layout,
        bufferTime: breakdown.buffer,
        applyTime: breakdown.apply,
        // Shader stats
        shaderCount: perfDialog.getActiveShaderCount(),
        shaderFrameTime: perfDialog.getLastShaderFrameTime(),
        shaderFrameTimeAvg: perfDialog.getAverageShaderFrameTime(),
        shaderFps: perfDialog.getShaderFps(),
        shaderPixels: perfDialog.getTotalShaderPixels(),
        // Animation stats
        animationCount: getUIAnimationManager().count,
        animationTick: getUIAnimationManager().currentTick,
      };
      perfDialog.render(buffer, perfStats);
    } catch {
      // Silently ignore performance dialog errors
    }
  }
}
