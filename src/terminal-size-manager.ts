// Terminal size detection, tracking, and resize handling
// Extracted from engine.ts to group related size/resize logic

import { MelkerConfig } from './config/mod.ts';
import { ensureError } from './utils/error.ts';
import { isStdoutEnabled } from './stdout.ts';
import type { HeadlessManager } from './headless.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('TerminalSizeManager');
import {
  getGlobalErrorOverlay as getGlobalScriptErrorOverlay,
} from './error-overlay.ts';

type Size = { width: number; height: number };

type ResizeEvent = {
  type: 'resize';
  previousSize: Size;
  newSize: Size;
  timestamp: number;
};

type CustomResizeHandler = (event: ResizeEvent) => void;

export interface TerminalSizeManagerDeps {
  initialWidth: number;
  initialHeight: number;
  headlessManager?: HeadlessManager;
}

/**
 * Callback for engine-specific work after size is updated.
 * Called with previous and new size so the engine can update
 * buffer, hit tester, root element, dispatch events, etc.
 */
export type ResizeApplyCallback = (previousSize: Size, newSize: Size) => void;

/**
 * Manages terminal size detection, tracking, and resize event dispatch.
 */
export class TerminalSizeManager {
  private _size: Size;
  private _customResizeHandlers: CustomResizeHandler[] = [];
  private _headlessManager?: HeadlessManager;
  private _initialWidth: number;
  private _initialHeight: number;

  constructor(deps: TerminalSizeManagerDeps) {
    this._initialWidth = deps.initialWidth;
    this._initialHeight = deps.initialHeight;
    this._headlessManager = deps.headlessManager;
    this._size = this.detectSize();
  }

  /**
   * Current terminal size.
   */
  get size(): Size {
    return this._size;
  }

  /**
   * Detect terminal size from headless manager, stdout config, or actual terminal.
   */
  detectSize(): Size {
    // If in headless mode, use virtual terminal size
    if (this._headlessManager) {
      return this._headlessManager.terminal;
    }

    // If in stdout mode, use configured stdout dimensions (fallback to actual terminal size)
    if (isStdoutEnabled()) {
      const config = MelkerConfig.get();
      const actualSize = this._detectActualSize();
      return {
        width: config.stdoutWidth ?? actualSize.width,
        height: config.stdoutHeight ?? actualSize.height,
      };
    }

    return this._detectActualSize();
  }

  /**
   * Re-detect and update the current size.
   */
  refreshSize(): void {
    this._size = this.detectSize();
  }

  /**
   * Register a custom resize handler.
   */
  addResizeHandler(handler: CustomResizeHandler): void {
    this._customResizeHandlers.push(handler);
  }

  /**
   * Handle a resize event. Updates size, calls the apply callback for
   * engine-specific work, then dispatches to custom resize handlers.
   */
  handleResize(newSize: Size, onApply: ResizeApplyCallback, autoRender: boolean, forceRender: () => void): void {
    const previousSize = { ...this._size };
    this._size = newSize;

    // Let engine apply buffer/hitTester/rootElement/document updates
    onApply(previousSize, newSize);

    // Call custom resize handlers
    const resizeEvent: ResizeEvent = {
      type: 'resize',
      previousSize,
      newSize,
      timestamp: Date.now(),
    };
    for (const handler of this._customResizeHandlers) {
      try {
        handler(resizeEvent);
      } catch (error) {
        const err = ensureError(error);
        logger.error('Error in resize handler', err);
        getGlobalScriptErrorOverlay().showError(err.message, 'resize handler');
      }
    }

    // Auto-render if enabled - use force render after resize to ensure clean display
    if (autoRender) {
      forceRender();
    }
  }

  /**
   * Detect actual terminal size from Deno.consoleSize.
   */
  private _detectActualSize(): Size {
    try {
      if (typeof Deno !== 'undefined' && Deno.consoleSize) {
        const size = Deno.consoleSize();
        return { width: size.columns, height: size.rows };
      }
    } catch {
      // Fallback to initial options
    }
    return {
      width: this._initialWidth,
      height: this._initialHeight,
    };
  }
}
