// Auto-resize handling system for terminal UI applications

import { DualBuffer } from './buffer.ts';
import { Document } from './document.ts';
import { RenderingEngine } from './rendering.ts';
import { debounce } from './utils/timing.ts';

export interface TerminalSize {
  width: number;
  height: number;
}

export interface ResizeEvent {
  type: 'resize';
  previousSize: TerminalSize;
  newSize: TerminalSize;
  timestamp: number;
}

export interface ResizeHandlerOptions {
  /**
   * Debounce time in milliseconds to prevent too frequent resize handling
   * @default 50
   */
  debounceMs?: number;

  /**
   * Whether to automatically re-render when resize occurs
   * @default true
   */
  autoRender?: boolean;

  /**
   * Whether to preserve content on resize
   * @default true
   */
  preserveContent?: boolean;

  /**
   * Custom resize handler function
   */
  onResize?: (event: ResizeEvent) => void | Promise<void>;

  /**
   * Handler called before resize occurs
   */
  onBeforeResize?: (event: ResizeEvent) => void | Promise<void>;

  /**
   * Handler called after resize is complete
   */
  onAfterResize?: (event: ResizeEvent) => void | Promise<void>;
}

export class ResizeHandler {
  private _currentSize: TerminalSize;
  private _buffer?: DualBuffer;
  private _document?: Document;
  private _renderer?: RenderingEngine;
  private _options: Required<ResizeHandlerOptions>;
  private _isListening = false;
  private _resizeController?: AbortController;
  private _pollTimer?: number;
  // Debounced resize handler
  private _debouncedDetectAndUpdateSize: () => void;

  constructor(
    initialSize: TerminalSize,
    options: ResizeHandlerOptions = {}
  ) {
    this._currentSize = { ...initialSize };
    this._options = {
      debounceMs: 50,
      autoRender: true,
      preserveContent: true,
      onResize: () => {},
      onBeforeResize: () => {},
      onAfterResize: () => {},
      ...options,
    };

    // Create debounced resize detection function
    this._debouncedDetectAndUpdateSize = debounce(async () => {
      try {
        await this._detectAndUpdateSize();
      } catch (error) {
        console.error('Error handling resize:', error);
      }
    }, this._options.debounceMs);
  }

  get currentSize(): TerminalSize {
    return { ...this._currentSize };
  }

  get isListening(): boolean {
    return this._isListening;
  }

  /**
   * Attach a dual buffer to be automatically resized
   */
  attachBuffer(buffer: DualBuffer): void {
    this._buffer = buffer;
  }

  /**
   * Attach a document to receive resize events
   */
  attachDocument(document: Document): void {
    this._document = document;
  }

  /**
   * Attach a rendering engine for automatic re-rendering
   */
  attachRenderer(renderer: RenderingEngine): void {
    this._renderer = renderer;
  }

  /**
   * Start listening for terminal resize events
   */
  async startListening(): Promise<void> {
    if (this._isListening) return;

    this._resizeController = new AbortController();
    this._isListening = true;

    // Check if we're in a Deno environment with stdin access
    if (typeof Deno !== 'undefined' && Deno.stdin) {
      try {
        // Set up signal handler for SIGWINCH (window change)
        const sigwinchHandler = async () => {
          await this._handleResize();
        };

        // Listen for resize signals
        Deno.addSignalListener('SIGWINCH', sigwinchHandler);

        // Store cleanup function
        this._resizeController.signal.addEventListener('abort', () => {
          try {
            Deno.removeSignalListener('SIGWINCH', sigwinchHandler);
          } catch (error) {
            // Signal handler might not exist, ignore error
          }
        });

        // Perform initial size detection
        await this._detectAndUpdateSize();

        // Set up polling fallback for environments where signal handling isn't available
        this._setupPollingFallback();

      } catch (error) {
        // Signal handling not available, fall back to polling
        console.warn('Signal-based resize detection not available, using polling fallback');
        this._setupPollingFallback();
      }
    } else {
      // Non-Deno environment, use polling
      this._setupPollingFallback();
    }
  }

  /**
   * Stop listening for resize events
   */
  stopListening(): void {
    if (!this._isListening) return;

    this._isListening = false;

    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = undefined;
    }

    if (this._resizeController) {
      this._resizeController.abort();
      this._resizeController = undefined;
    }
  }

  /**
   * Manually trigger a resize to the specified dimensions
   */
  async resize(newSize: TerminalSize): Promise<void> {
    await this._performResize(newSize);
  }

  /**
   * Get current terminal size
   */
  async getCurrentTerminalSize(): Promise<TerminalSize> {
    if (typeof Deno !== 'undefined' && Deno.consoleSize) {
      try {
        const size = Deno.consoleSize();
        return { width: size.columns, height: size.rows };
      } catch (error) {
        // Console size not available, return current size
        return this._currentSize;
      }
    }

    // Fallback size detection for Node.js environments
    if (typeof globalThis !== 'undefined' && (globalThis as any).process?.stdout) {
      const process = (globalThis as any).process;
      return {
        width: process.stdout.columns || 80,
        height: process.stdout.rows || 24,
      };
    }

    // Default fallback
    return { width: 80, height: 24 };
  }

  private _setupPollingFallback(): void {
    const pollInterval = Math.max(this._options.debounceMs * 2, 100);

    const poll = async () => {
      if (!this._isListening) return;

      try {
        await this._detectAndUpdateSize();
        if (this._isListening) {
          this._pollTimer = setTimeout(poll, pollInterval);
        }
      } catch (error) {
        console.warn('Error during resize polling:', error);
        // Continue polling despite errors
        if (this._isListening) {
          this._pollTimer = setTimeout(poll, pollInterval);
        }
      }
    };

    this._pollTimer = setTimeout(poll, pollInterval);
  }

  private async _detectAndUpdateSize(): Promise<void> {
    const newSize = await this.getCurrentTerminalSize();

    if (newSize.width !== this._currentSize.width ||
        newSize.height !== this._currentSize.height) {
      await this._performResize(newSize);
    }
  }

  private async _handleResize(): Promise<void> {
    // Use debounced resize detection
    this._debouncedDetectAndUpdateSize();
  }

  private async _performResize(newSize: TerminalSize): Promise<void> {
    const previousSize = { ...this._currentSize };

    const resizeEvent: ResizeEvent = {
      type: 'resize',
      previousSize,
      newSize,
      timestamp: Date.now(),
    };

    try {
      // Call before resize handler
      await this._options.onBeforeResize(resizeEvent);

      // Update current size
      this._currentSize = { ...newSize };

      // Resize buffer if attached
      if (this._buffer) {
        this._buffer.resize(newSize.width, newSize.height);
      }

      // Dispatch resize event to document if attached
      if (this._document) {
        this._document.dispatchEvent(resizeEvent);
      }

      // Call custom resize handler
      await this._options.onResize(resizeEvent);

      // Auto-render if enabled and renderer is attached
      if (this._options.autoRender && this._renderer && this._buffer && this._document) {
        try {
          const viewport = { x: 0, y: 0, width: newSize.width, height: newSize.height };
          this._renderer.render(this._document.root, this._buffer, viewport);
        } catch (renderError) {
          console.error('Error during auto-render after resize:', renderError);
        }
      }

      // Call after resize handler
      await this._options.onAfterResize(resizeEvent);

    } catch (error) {
      console.error('Error during resize handling:', error);
    }
  }

  /**
   * Create a resize handler with common configurations
   */
  static create(
    initialSize?: TerminalSize,
    options: ResizeHandlerOptions = {}
  ): ResizeHandler {
    const defaultSize = initialSize || { width: 80, height: 24 };
    return new ResizeHandler(defaultSize, options);
  }

  /**
   * Create a resize handler that automatically detects initial terminal size
   */
  static async createWithDetection(
    options: ResizeHandlerOptions = {}
  ): Promise<ResizeHandler> {
    const handler = new ResizeHandler({ width: 80, height: 24 }, options);
    const actualSize = await handler.getCurrentTerminalSize();
    handler._currentSize = actualSize;
    return handler;
  }
}

/**
 * Global resize handler instance for convenience
 */
export let globalResizeHandler: ResizeHandler | null = null;

/**
 * Initialize global resize handler
 */
export async function initializeGlobalResizeHandler(
  options: ResizeHandlerOptions = {}
): Promise<ResizeHandler> {
  globalResizeHandler = await ResizeHandler.createWithDetection(options);
  return globalResizeHandler;
}

/**
 * Get the global resize handler (create if it doesn't exist)
 */
export async function getGlobalResizeHandler(): Promise<ResizeHandler> {
  if (!globalResizeHandler) {
    globalResizeHandler = await ResizeHandler.createWithDetection();
  }
  return globalResizeHandler;
}

/**
 * Utility function to set up auto-resize for a complete UI system
 */
export async function setupAutoResize(
  document: Document,
  buffer: DualBuffer,
  renderer: RenderingEngine,
  options: ResizeHandlerOptions = {}
): Promise<ResizeHandler> {
  const resizeHandler = await ResizeHandler.createWithDetection({
    autoRender: true,
    preserveContent: true,
    ...options,
  });

  resizeHandler.attachDocument(document);
  resizeHandler.attachBuffer(buffer);
  resizeHandler.attachRenderer(renderer);

  await resizeHandler.startListening();

  return resizeHandler;
}