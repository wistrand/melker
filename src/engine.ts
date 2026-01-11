// High-level Melker Engine for automatic terminal UI management
// Handles rendering, buffer management, resize handling, and terminal setup

// Type augmentation for globalThis
declare global {
  interface GlobalThis {
    _melkerInstances?: Set<MelkerEngine>;
    _melkerEmergencyCleanup?: () => void;
  }
}

import { Document } from './document.ts';
import { MelkerConfig, setLoggerGetter } from './config/mod.ts';
import { Env } from './env.ts';
import { DualBuffer } from './buffer.ts';
import { RenderingEngine } from './rendering.ts';
import { InputElement } from './components/input.ts';
import { TextareaElement } from './components/textarea.ts';
import { TerminalRenderer } from './renderer.ts';
import { ResizeHandler } from './resize.ts';
import { Element, TextSelection, isClickable, ClickEvent, isWheelable } from './types.ts';
import {
  EventManager,
  type MelkerEvent,
  createKeyPressEvent,
} from './events.ts';
import {
  FocusManager,
} from './focus.ts';
import {
  DevToolsManager,
  type SystemInfo,
} from './dev-tools.ts';
import type { MelkerPolicy } from './policy/types.ts';
import {
  AlertDialogManager,
} from './alert-dialog.ts';
import {
  ConfirmDialogManager,
} from './confirm-dialog.ts';
import {
  PromptDialogManager,
} from './prompt-dialog.ts';
import {
  AccessibilityDialogManager,
} from './ai/accessibility-dialog.ts';
import {
  createDefaultCommandPalette,
  createSystemGroup,
  SystemHandlers,
} from './system-command-palette.ts';
import {
  TerminalInputProcessor,
} from './input.ts';
import {
  MelkerDebugServer,
  isDebugEnabled,
  createDebugServer,
  setGlobalDebugServer,
  type DebugServerOptions,
} from './debug-server.ts';
import {
  initializeHeadlessMode,
  isHeadlessEnabled,
  isRunningHeadless,
  getHeadlessManager,
  type HeadlessManager,
} from './headless.ts';
import {
  getThemeManager,
  getThemeColor,
  type ThemeManager,
} from './theme.ts';
import {
  getGlobalStatsOverlay,
  isStatsOverlayEnabled,
  type StatsOverlay,
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
  getLogger,
  type ComponentLogger,
} from './logging.ts';
import {
  ANSI,
  AnsiOutputGenerator,
  type BufferDifference,
} from './ansi-output.ts';
import {
  HitTester,
} from './hit-test.ts';
import {
  ScrollHandler,
} from './scroll-handler.ts';
import {
  TextSelectionHandler,
} from './text-selection-handler.ts';
import {
  StatePersistenceManager,
} from './state-persistence-manager.ts';
import {
  ElementClickHandler,
} from './element-click-handler.ts';
import {
  FocusNavigationHandler,
} from './focus-navigation-handler.ts';
import {
  PersistenceMapping,
  DEFAULT_PERSISTENCE_MAPPINGS,
} from './state-persistence.ts';
import {
  createDebouncedAction,
  type DebouncedAction,
} from './utils/timing.ts';
import {
  setupTerminal,
  cleanupTerminal,
  emergencyCleanupTerminal,
  restoreTerminal,
  setupCleanupHandlers,
  registerForEmergencyCleanup,
  unregisterFromEmergencyCleanup,
} from './terminal-lifecycle.ts';

// Initialize config logger getter (breaks circular dependency between config.ts and logging.ts)
setLoggerGetter(() => getLogger('Config'));

export interface MelkerEngineOptions {
  // Terminal setup
  alternateScreen?: boolean;
  hideCursor?: boolean;

  // Resize handling
  autoResize?: boolean;
  debounceMs?: number;

  // Rendering options
  autoRender?: boolean;
  colorSupport?: 'none' | '16' | '256' | 'truecolor';
  theme?: string;
  synchronizedOutput?: boolean;  // Enable synchronized output to reduce flicker

  // Initial size (if not auto-detected)
  initialWidth?: number;
  initialHeight?: number;

  // Event system options
  enableEvents?: boolean;
  enableMouse?: boolean;
  enableFocusEvents?: boolean;
  mouseReporting?: 'none' | 'basic' | 'drag' | 'all';
  /**
   * Map Meta key to Alt key for keyboard events.
   * On macOS, some terminals send the Option key as Meta instead of Alt.
   * Enable this to treat Meta as Alt for keyboard shortcuts.
   * Default: true (enabled by default for macOS compatibility)
   */
  mapMetaToAlt?: boolean;

  // Debug server options
  enableDebugServer?: boolean;
  debugServerOptions?: DebugServerOptions;

  // Headless mode options
  enableHeadlessMode?: boolean;

  // Base URL for relative resource loading (defaults to current working directory)
  baseUrl?: string;

  // State persistence options
  persistState?: boolean;
  appId?: string;  // Unique identifier for the app (for state file naming)
  persistenceMappings?: PersistenceMapping[];  // Custom mappings (defaults to DEFAULT_PERSISTENCE_MAPPINGS)
  persistenceDebounceMs?: number;  // Debounce delay for auto-save (default 500ms)

  // Exit handler callback (called on Ctrl+C instead of default exit)
  onExit?: () => void | Promise<void>;
}

export class MelkerEngine {
  private _document!: Document;
  private _buffer!: DualBuffer;
  private _renderer!: RenderingEngine;
  private _terminalRenderer!: TerminalRenderer;
  private _ansiOutput!: AnsiOutputGenerator;
  private _hitTester!: HitTester;
  private _scrollHandler!: ScrollHandler;
  private _textSelectionHandler!: TextSelectionHandler;
  private _elementClickHandler!: ElementClickHandler;
  private _focusNavigationHandler!: FocusNavigationHandler;
  private _resizeHandler!: ResizeHandler;
  private _eventManager!: EventManager;
  private _focusManager!: FocusManager;
  private _inputProcessor!: TerminalInputProcessor;
  private _debugServer?: MelkerDebugServer;
  private _headlessManager?: HeadlessManager;
  private _themeManager!: ThemeManager;
  private _logger?: ComponentLogger;
  private _rootElement: Element;
  private _options: Required<MelkerEngineOptions>;
  private _currentSize: { width: number; height: number };
  private _isInitialized = false;
  private _isRendering = false;  // Render lock to prevent re-render during render
  private _renderCount = 0;
  private _customResizeHandlers: Array<(event: { previousSize: { width: number; height: number }, newSize: { width: number; height: number }, timestamp: number }) => void> = [];
  private _mountHandlers: Array<() => void | Promise<void>> = [];
  // Debounced action for rapid input rendering (e.g., paste operations)
  private _debouncedInputRenderAction!: DebouncedAction;

  // Dev Tools feature
  private _devToolsManager?: DevToolsManager;

  // Alert dialog feature
  private _alertDialogManager?: AlertDialogManager;

  // Confirm dialog feature
  private _confirmDialogManager?: ConfirmDialogManager;

  // Prompt dialog feature
  private _promptDialogManager?: PromptDialogManager;

  // AI Accessibility dialog feature
  private _accessibilityDialogManager?: AccessibilityDialogManager;

  // System command palette (injected if no command palette exists)
  private _systemCommandPalette?: Element;

  // State persistence
  private _persistenceManager!: StatePersistenceManager;

  // App policy (for permission checks)
  private _policy?: MelkerPolicy;

  // Performance tracking
  private _lastLayoutTime = 0;
  private _lastRenderTime = 0;
  private _layoutNodeCount = 0;

  // Track modal dialogs with focus traps
  private _trappedModalDialogIds = new Set<string>();

  constructor(rootElement: Element, options: MelkerEngineOptions = {}) {
    // Get terminal settings from config
    const config = MelkerConfig.get();

    // Determine default base URL (current working directory)
    const cwd = typeof Deno !== 'undefined' ? Deno.cwd() : '';
    const defaultBaseUrl = typeof Deno !== 'undefined'
      ? `file://${cwd}/`  // Add trailing slash for proper URL resolution
      : 'file://';


    // Set defaults
    this._options = {
      alternateScreen: config.terminalAlternateScreen,
      hideCursor: true,
      autoResize: true,
      debounceMs: 100,
      autoRender: true,
      synchronizedOutput: config.terminalSyncRendering,
      colorSupport: 'none',
      theme: 'color-std',
      initialWidth: 80,
      initialHeight: 24,
      enableEvents: true,
      enableMouse: true,
      enableFocusEvents: true,
      mouseReporting: 'all',
      mapMetaToAlt: true, // Enabled by default for macOS Option key compatibility
      enableDebugServer: isDebugEnabled(),
      debugServerOptions: {},
      enableHeadlessMode: isHeadlessEnabled(),
      baseUrl: defaultBaseUrl,
      persistState: false,
      appId: undefined as unknown as string,
      persistenceMappings: DEFAULT_PERSISTENCE_MAPPINGS,
      persistenceDebounceMs: 500,
      onExit: () => {},
      ...options,
    };

    // Initialize headless mode if enabled (must be done before other initialization)
    if (this._options.enableHeadlessMode) {
      this._headlessManager = initializeHeadlessMode() || undefined;
      // Force debug server to be enabled in headless mode
      if (this._headlessManager && !this._options.enableDebugServer) {
        this._options.enableDebugServer = true;
      }
    }

    // Initialize theme manager
    this._themeManager = getThemeManager();
    if (this._options.theme) {
      this._themeManager.setTheme(this._options.theme);
    }

    // Apply theme-based color support if not explicitly set
    const currentTheme = this._themeManager.getCurrentTheme();
    if (options?.colorSupport === undefined) {
      this._options.colorSupport = currentTheme.colorSupport;
    }

    this._rootElement = rootElement;
    this._currentSize = this._getTerminalSize();

    // Make engine globally accessible for components that need URL resolution
    (globalThis as any).melkerEngine = this;

    // Set element size to match terminal size if not specified
    const style = this._rootElement.props.style || {};
    if (!this._rootElement.props.width && !style.width) {
      this._rootElement.props.width = this._currentSize.width;
    }
    if (!this._rootElement.props.height && !style.height) {
      this._rootElement.props.height = this._currentSize.height;
    }

    // Initialize core components
    this._initializeComponents();

    // Initialize debounced input render action
    // 16ms delay (~1 frame): fast render provides immediate feedback, full render for layout correctness
    this._debouncedInputRenderAction = createDebouncedAction(() => {
      this.render();
    }, 16);

    // Initialize logger (async initialization will happen in start())
    this._initializeLogger();

    // Set up global emergency cleanup in case something goes wrong
    this._setupEmergencyCleanup();
  }

  private _initializeLogger(): void {
    // Logger initialization is now fully synchronous
    try {
      this._logger = getLogger('MelkerEngine');
    } catch (error) {
      // Fallback: continue without logging if logger fails
      console.error('Failed to initialize logger:', error);
      this._logger = undefined;
    }
  }


  private _getTerminalSize(): { width: number; height: number } {
    // If in headless mode, use virtual terminal size
    if (this._headlessManager) {
      return this._headlessManager.terminal;
    }

    try {
      if (typeof Deno !== 'undefined' && Deno.consoleSize) {
        const size = Deno.consoleSize();
        return { width: size.columns, height: size.rows };
      }
    } catch (error) {
      // Fallback to options
    }
    return {
      width: this._options.initialWidth,
      height: this._options.initialHeight,
    };
  }

  private _initializeComponents(): void {
    // Create document with the root element
    this._document = new Document(this._rootElement, {
      enableEventHandling: this._options.enableEvents,
    });

    // Initialize event system first if enabled
    if (this._options.enableEvents) {
      this._eventManager = new EventManager();
      this._focusManager = new FocusManager(this._eventManager, this._document);

      // Provide bounds provider to focus manager for accurate layout info
      this._focusManager.setBoundsProvider((elementId: string) => {
        return this._renderer.getContainerBounds(elementId);
      });
      this._inputProcessor = new TerminalInputProcessor({
        enableMouse: this._options.enableMouse,
        enableFocusEvents: this._options.enableFocusEvents,
        enableRawMode: true, // Enable raw mode to capture input properly
        mouseReporting: this._options.mouseReporting,
        mapMetaToAlt: this._options.mapMetaToAlt,
      }, this._eventManager);
    }

    // Initialize buffer and renderers with theme-aware default cell
    const defaultCell = {
      char: ' ',
      background: getThemeColor('background'),
      foreground: getThemeColor('textPrimary')
    };
    this._buffer = new DualBuffer(this._currentSize.width, this._currentSize.height, defaultCell);
    this._renderer = new RenderingEngine();
    this._terminalRenderer = new TerminalRenderer({
      colorSupport: this._options.colorSupport,
      alternateScreen: this._options.alternateScreen,
    });
    this._ansiOutput = new AnsiOutputGenerator({
      colorSupport: this._options.colorSupport,
    });
    this._hitTester = new HitTester({
      document: this._document,
      renderer: this._renderer,
      viewportSize: this._currentSize,
    });
    this._scrollHandler = new ScrollHandler({
      document: this._document,
      renderer: this._renderer,
      autoRender: this._options.autoRender,
      onRender: () => this.render(),
      onRenderDialogOnly: () => this.renderDialogOnly(),
      calculateScrollDimensions: (containerOrId) => this.calculateScrollDimensions(containerOrId),
    });

    // Initialize element click handler
    this._elementClickHandler = new ElementClickHandler({
      document: this._document,
      renderer: this._renderer,
      hitTester: this._hitTester,
      logger: this._logger,
      autoRender: this._options.autoRender,
      onRender: () => this.render(),
      onRegisterFocusable: (id) => this.registerFocusableElement(id),
      onFocusElement: (id) => this.focusElement(id),
    });

    // Initialize focus navigation handler
    this._focusNavigationHandler = new FocusNavigationHandler({
      document: this._document,
      focusManager: this._focusManager,
      hitTester: this._hitTester,
      autoRender: this._options.autoRender,
      onRender: () => this.render(),
      onRegisterFocusable: (id) => this.registerFocusableElement(id),
      onFocusElement: (id) => this.focusElement(id),
    });

    // Initialize text selection handler
    this._textSelectionHandler = new TextSelectionHandler(
      { autoRender: this._options.autoRender },
      {
        getBuffer: () => this._buffer,
        hitTester: this._hitTester,
        scrollHandler: this._scrollHandler,
        document: this._document,
        renderer: this._renderer,
        eventManager: this._eventManager,
        logger: this._logger,
        onRender: () => this.render(),
        onRenderDialogOnly: () => this.renderDialogOnly(),
        onRenderOptimized: () => this._renderOptimized(),
        onElementClick: (element, event) => this._elementClickHandler.handleElementClick(element, event),
      }
    );

    // Set up resize handler if enabled
    if (this._options.autoResize) {
      this._resizeHandler = new ResizeHandler(this._currentSize, {
        debounceMs: this._options.debounceMs,
        autoRender: false, // Disable auto-render, we handle it manually via onResize
        onResize: (event) => this._handleResize(event.newSize),
      });
    }

    // Initialize debug server if enabled
    if (this._options.enableDebugServer) {
      this._debugServer = createDebugServer(this._options.debugServerOptions);
    }

    // Initialize state persistence manager
    this._persistenceManager = new StatePersistenceManager(
      { persistenceDebounceMs: this._options.persistenceDebounceMs },
      {
        document: this._document,
      }
    );
  }

  private _handleResize(newSize: { width: number; height: number }): void {
    const previousSize = { ...this._currentSize };
    this._currentSize = newSize;

    // Update hit tester viewport size
    this._hitTester.updateContext({ viewportSize: newSize });

    // Resize buffer
    this._buffer.resize(newSize.width, newSize.height);

    // Update root element dimensions
    this._rootElement.props.width = newSize.width;
    this._rootElement.props.height = newSize.height;

    // Dispatch resize event to document
    const resizeEvent = {
      type: 'resize' as const,
      previousSize,
      newSize,
      timestamp: Date.now(),
    };
    this._document.dispatchEvent(resizeEvent);

    // Call custom resize handlers
    for (const handler of this._customResizeHandlers) {
      try {
        handler(resizeEvent);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this._logger?.error('Error in resize handler', err);
        // Show error visually - never fail silently
        getGlobalScriptErrorOverlay().showError(err.message, 'resize handler');
      }
    }

    // Notify debug server of resize if enabled
    if (this._debugServer) {
      this._debugServer.notifyTerminalResize(newSize.width, newSize.height);
    }

    // Auto-render if enabled - use force render after resize to ensure clean display
    if (this._options.autoRender) {
      this.forceRender();
    }
  }

  private _setupTerminal(): void {
    setupTerminal({
      alternateScreen: this._options.alternateScreen,
      hideCursor: this._options.hideCursor,
    });
  }

  cleanupTerminal(): void {
    cleanupTerminal({
      alternateScreen: this._options.alternateScreen,
      hideCursor: this._options.hideCursor,
    });
  }

  private _setupEventHandlers(): void {
    if (!this._eventManager || !this._document) return;

    // Single keyboard listener that routes to focused elements
    this._eventManager.addGlobalEventListener('keydown', (event: any) => {
      // Mark input start time for latency tracking
      getGlobalPerformanceDialog().markInputStart();

      const focusedElement = this._document!.focusedElement;

      // Log all key events for debugging
      this._logger?.debug('Key event received', {
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
      });

      // Handle Ctrl+C for graceful exit
      if (event.ctrlKey && event.key?.toLowerCase() === 'c') {
        // CRITICAL: Restore terminal FIRST, synchronously, before anything else
        // This ensures the terminal is restored even if something goes wrong later
        restoreTerminal();

        // Stop the input loop
        if (this._inputProcessor) {
          this._inputProcessor.stopListeningSync();
        }

        if (this._options.onExit) {
          // Use custom exit handler
          Promise.resolve(this._options.onExit())
            .finally(() => Deno.exit(0));
        } else {
          // Default behavior - do graceful cleanup then exit
          this.stop()
            .finally(() => Deno.exit(0));
        }
        return;
      }

      // Handle Tab key for focus navigation
      if (event.key === 'Tab') {
        this._focusNavigationHandler.handleTabNavigation(event.shiftKey);
        return;
      }

      // Handle F12 key for View Source (global)
      if (event.key === 'F12') {
        this._devToolsManager?.toggle();
        return;
      }

      // Handle F6, F10, F11, Shift+F12, or Ctrl+Shift+P for Performance dialog
      if (event.key === 'F6' || event.key === 'F10' || event.key === 'F11' ||
          (event.shiftKey && event.key === 'F12') ||
          (event.ctrlKey && event.shiftKey && (event.key === 'p' || event.key === 'P'))) {
        getGlobalPerformanceDialog().toggle();
        this.render();
        return;
      }

      // Handle Ctrl+K for Command Palette
      if (event.ctrlKey && (event.key === 'k' || event.key === 'K')) {
        this.toggleCommandPalette();
        return;
      }

      // Handle Escape to close View Source overlay
      if (event.key === 'Escape' && this._devToolsManager?.isOpen()) {
        this._devToolsManager.close();
        return;
      }

      // Handle Escape to close Alert dialog
      if (event.key === 'Escape' && this._alertDialogManager?.isOpen()) {
        this._alertDialogManager.close();
        return;
      }

      // Handle Escape to close Confirm dialog (cancels)
      if (event.key === 'Escape' && this._confirmDialogManager?.isOpen()) {
        this._confirmDialogManager.close(false);
        return;
      }

      // Handle Escape to close Prompt dialog (cancels)
      if (event.key === 'Escape' && this._promptDialogManager?.isOpen()) {
        this._promptDialogManager.close(null);
        return;
      }

      // Handle Escape to close Accessibility dialog
      if (event.key === 'Escape' && this._accessibilityDialogManager?.isOpen()) {
        this._accessibilityDialogManager.close();
        return;
      }

      // Handle open command palettes - they capture all keyboard input when open
      const openCommandPalette = this._findOpenCommandPalette() as any;
      if (openCommandPalette) {
        // Escape closes the palette
        if (event.key === 'Escape') {
          openCommandPalette.close();
          this.render();
          return;
        }

        // Route all keyboard events to the open command palette
        if (typeof openCommandPalette.onKeyPress === 'function') {
          const keyPressEvent = createKeyPressEvent(event.key, {
            code: event.code,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
            target: openCommandPalette.id,
          });

          const handled = openCommandPalette.onKeyPress(keyPressEvent);
          if (handled && this._options.autoRender) {
            this.render();
          }
          return;
        }
      }

      // Handle F7 specially for voice input
      if (['f7', 'F7'].includes(event.key)) {
        this._logger?.info('F7 pressed - voice input mode');
        this._ensureAccessibilityDialogManager();
        // If dialog is open, toggle listening. If closed, open and start listening.
        if (this._accessibilityDialogManager!.isOpen()) {
          this._accessibilityDialogManager!.toggleListen();
        } else {
          this._accessibilityDialogManager!.showAndListen();
        }
        return;
      }

      // Handle other function keys for AI Accessibility dialog
      if (['f8', 'F8', 'f9', 'F9'].includes(event.key)) {
        this._logger?.info(event.key + ' pressed - opening accessibility dialog');
        this._ensureAccessibilityDialogManager();
        this._accessibilityDialogManager!.toggle();
        return;
      }

      // Handle Ctrl+/ or Alt+/ or Ctrl+? or Alt+? for AI Accessibility dialog
      if ((event.ctrlKey || event.altKey) && (['/', '?', 'h', 'H'].includes(event.key))) {
        this._logger?.info('Accessibility shortcut pressed', { key: event.key, ctrlKey: event.ctrlKey, altKey: event.altKey });
        this._ensureAccessibilityDialogManager();
        this._accessibilityDialogManager!.toggle();
        return;
      }


      // Handle Alt+N || Alt+C for copying selection to clipboard
      if (event.altKey && (event.key === 'n' || event.key === 'c')) {
        this._textSelectionHandler.copySelectionToClipboard();
        return;
      }

      // Handle arrow keys for scrolling in scrollable containers
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && focusedElement) {
        const scrollableParent = this._scrollHandler.findScrollableParent(focusedElement);
        if (scrollableParent && this._scrollHandler.handleArrowKeyScroll(event.key, scrollableParent)) {
          return; // Arrow key was handled by scrolling
        }
      }

      if (focusedElement) {
        // Route to slider element for arrow key handling
        if (focusedElement.type === 'slider') {
          const slider = focusedElement as any;
          if (slider.handleKeyInput) {
            const handled = slider.handleKeyInput(event.key, event.ctrlKey, event.altKey);
            if (handled && this._options.autoRender) {
              this.render();
            }
          }
        }
        // Route to text input if it's a text input or textarea element
        else if (focusedElement.type === 'input' || focusedElement.type === 'textarea') {
          const textInput = focusedElement as InputElement | TextareaElement;
          if (textInput.handleKeyInput) {
            this._logger?.debug('Key input routed to text input', {
              elementId: focusedElement.id,
              key: event.key,
              ctrlKey: event.ctrlKey,
              altKey: event.altKey,
            });

            const handled = textInput.handleKeyInput(event.key, event.ctrlKey, event.altKey, event.shiftKey);

            // Auto-render if the input changed
            if (handled && this._options.autoRender) {
              // Check if any system dialogs are open (these are always overlays)
              const hasSystemDialog = this._alertDialogManager?.isOpen() ||
                                     this._confirmDialogManager?.isOpen() ||
                                     this._promptDialogManager?.isOpen() ||
                                     this._accessibilityDialogManager?.isOpen();

              // Check if there's a document dialog that's an overlay (not an ancestor of this input)
              const hasOverlayDialog = this._hasOverlayDialogFor(focusedElement);

              // Try fast render first (immediate visual feedback)
              // Skip if there's an overlay dialog - it would be overwritten
              if (!hasSystemDialog && !hasOverlayDialog && textInput.canFastRender() && this._buffer) {
                const bounds = this._renderer.findElementBounds(focusedElement.id);
                if (bounds) {
                  // Prepare buffer: copy previous content so fast render only updates input cells
                  this._buffer.prepareForFastRender();
                  if (textInput.fastRender(this._buffer, bounds, true)) {
                    // Use fast path: outputs diff WITHOUT swapping buffers
                    // This preserves buffer state for the debounced full render
                    this._renderFastPath();
                  }
                }
              }

              // Always schedule debounced full render for layout correctness
              // (handles text wrapping, size changes, etc.)
              this._debouncedInputRender();
            }
          }
        }
        // Route to components that handle their own keyboard events (filterable lists, etc.)
        else if (typeof (focusedElement as any).handlesOwnKeyboard === 'function' && (focusedElement as any).handlesOwnKeyboard() && typeof (focusedElement as any).onKeyPress === 'function') {
          const keyPressEvent = createKeyPressEvent(event.key, {
            code: event.code,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
            target: focusedElement.id,
          });

          const handled = (focusedElement as any).onKeyPress(keyPressEvent);

          // Auto-render if the event was handled
          if (handled && this._options.autoRender) {
            this.render();
          }
        }
        // Handle Enter key on focused buttons
        else if (focusedElement.type === 'button' && event.key === 'Enter') {
          // Trigger click event on the focused button
          this._document!.triggerElementEvent(focusedElement, {
            type: 'click',
            target: focusedElement,
            timestamp: Date.now(),
          });

          // Re-render to show any state changes from the click handler
          if (this._options.autoRender) {
            this.render();
          }
        }
        // Handle Enter/Space key on Clickable elements (checkbox, radio, etc.)
        else if (isClickable(focusedElement) &&
                 (event.key === 'Enter' || event.key === ' ')) {
          const clickEvent: ClickEvent = {
            type: 'click',
            target: focusedElement,
            position: { x: 0, y: 0 },
            timestamp: Date.now(),
          };

          const handled = focusedElement.handleClick(clickEvent, this._document!);

          if (handled) {
            this.render();
          }
        }
        // Generic keyboard event handling for components with onKeyPress method
        else if (focusedElement && typeof (focusedElement as any).onKeyPress === 'function') {
          const keyPressEvent = createKeyPressEvent(event.key, {
            code: event.code,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
            target: focusedElement.id,
          });

          const handled = (focusedElement as any).onKeyPress(keyPressEvent);

          // Auto-render if the event was handled
          if (handled && this._options.autoRender) {
            this.render();
          }
        }
      }
    });

    // Automatic scroll handling for scrollable containers
    this._eventManager.addGlobalEventListener('wheel', (event: any) => {
      // Check for Wheelable elements first (e.g., table with scrollable tbody)
      const target = this._hitTester.hitTest(event.x, event.y);
      this._logger?.debug(`Engine wheel: target=${target?.type}/${target?.id}, isWheelable=${target ? isWheelable(target) : false}`);
      if (target && isWheelable(target)) {
        const canHandle = target.canHandleWheel(event.x, event.y);
        this._logger?.debug(`Engine wheel: canHandleWheel=${canHandle}`);
        if (canHandle) {
          const handled = target.handleWheel(event.deltaX || 0, event.deltaY || 0);
          this._logger?.debug(`Engine wheel: handleWheel returned ${handled}`);
          if (handled) {
            if (this._options.autoRender) {
              this.render();
            }
            return; // Event was handled by the Wheelable element
          }
        }
      }
      // Fall through to default scroll handler
      this._logger?.debug(`Engine wheel: falling through to scroll-handler`);
      this._scrollHandler.handleScrollEvent(event);
    });

    // Text selection handling - delegated to TextSelectionHandler
    this._eventManager.addGlobalEventListener('mousedown', (event: any) => {
      // Check if performance dialog should handle this
      const perfDialog = getGlobalPerformanceDialog();
      if (perfDialog.isVisible()) {
        // Check close button first
        if (perfDialog.isOnCloseButton(event.x, event.y)) {
          perfDialog.hide();
          this.render();
          return;
        }
        // Then check title bar for dragging
        if (perfDialog.isOnTitleBar(event.x, event.y)) {
          perfDialog.startDrag(event.x, event.y);
          return;
        }
      }
      this._textSelectionHandler.handleMouseDown(event);
    });

    this._eventManager.addGlobalEventListener('mousemove', (event: any) => {
      // Check if performance dialog is being dragged
      const perfDialog = getGlobalPerformanceDialog();
      if (perfDialog.isDragging()) {
        perfDialog.updateDrag(event.x, event.y, this._currentSize.width, this._currentSize.height);
        this.render();
        return;
      }
      this._textSelectionHandler.handleMouseMove(event);
    });

    this._eventManager.addGlobalEventListener('mouseup', (event: any) => {
      // End performance dialog drag if active
      const perfDialog = getGlobalPerformanceDialog();
      if (perfDialog.isDragging()) {
        perfDialog.endDrag();
        return;
      }
      this._textSelectionHandler.handleMouseUp(event);
    });
  }

  /**
   * Get current text selection (for external access)
   */
  getTextSelection(): TextSelection {
    return this._textSelectionHandler.getTextSelection();
  }

  /**
   * Get the ID of the currently hovered element
   */
  getHoveredElementId(): string | null {
    return this._textSelectionHandler.getHoveredElementId();
  }

  // Public API

  /**
   * Initialize the engine and start the terminal application
   */
  async start(): Promise<void> {
    if (this._isInitialized) {
      throw new Error('MelkerEngine is already initialized');
    }

    // Logger is already initialized synchronously in constructor

    // Log terminal info at startup
    this._logger?.info('Terminal', {
      size: `${this._currentSize.width}x${this._currentSize.height}`,
      term: Env.get('TERM') || 'unknown',
      colorterm: Env.get('COLORTERM') || 'none',
      stdin: Deno.stdin.isTerminal() ? 'tty' : 'pipe',
      stdout: Deno.stdout.isTerminal() ? 'tty' : 'pipe',
    });

    // Start event system if enabled (raw mode must be enabled BEFORE terminal setup)
    if (this._options.enableEvents && this._inputProcessor) {
      await this._inputProcessor.startListening();
      this._setupEventHandlers();
    }

    // Setup terminal (after raw mode is established)
    this._setupTerminal();

    // Re-query terminal size after setup (alternate screen switch may affect reported size)
    this._currentSize = this._getTerminalSize();

    // Resize buffer to match current terminal size
    this._buffer.resize(this._currentSize.width, this._currentSize.height);

    // Start resize handling BEFORE initial render to ensure size is correct
    if (this._options.autoResize && this._resizeHandler) {
      // Update resize handler's internal size to match current size before starting
      // This prevents the resize handler from thinking size changed when it hasn't
      (this._resizeHandler as any)._currentSize = { ...this._currentSize };

      await this._resizeHandler.startListening();
    }

    // Start debug server if enabled
    if (this._debugServer) {
      try {
        this._debugServer.attachEngine(this);
        await this._debugServer.start();
        // Set global instance for logging integration
        setGlobalDebugServer(this._debugServer);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this._logger?.warn('Failed to start debug server', {
          errorMessage,
          error: error instanceof Error ? error.message : String(error),
        });
        console.warn('[Melker] Failed to start debug server:', errorMessage);
      }
    }

    // Setup cleanup handlers
    this._setupCleanupHandlers();

    // Mark as initialized BEFORE initial render (forceRender checks this flag)
    this._isInitialized = true;

    // Initial render - use force render for first display to ensure clean state
    if (this._options.autoRender) {
      this.forceRender();
    }

    // Log successful initialization
    this._logger?.info('MelkerEngine started successfully', {
      renderCount: this._renderCount,
      focusableElements: this._focusNavigationHandler.findFocusableElements(this._document.root).length,
    });
  }

  /**
   * Debounced render for rapid input events (e.g., paste operations)
   * Batches multiple rapid input changes into a single render
   */
  private _debouncedInputRender(): void {
    getGlobalPerformanceDialog().markRenderRequested();
    this._debouncedInputRenderAction.call();
  }

  /**
   * Manually trigger a render
   */
  render(): void {
    // Debug: always log render entry
    this._logger?.trace('render() called');

    // Skip render if engine is stopped/stopping - prevents writes after terminal cleanup
    if (!this._isInitialized) {
      this._logger?.debug('Skipping render - engine not initialized');
      return;
    }

    // Render lock: prevent re-render during render (e.g., onPaint callback)
    if (this._isRendering) {
      this._logger?.debug('Skipping render - already rendering (render lock active)');
      return;
    }
    this._isRendering = true;

    try {
    const renderStartTime = performance.now();
    getGlobalPerformanceDialog().markRenderStart();
    this._renderCount++;
    (globalThis as any).melkerRenderCount = this._renderCount;

    // Always log initial renders for debugging
    if (this._renderCount <= 3) {
      this._logger?.info(`Starting render #${this._renderCount}`, {
        terminalSize: this._currentSize,
        focusedElementId: this._document.focusedElement?.id,
      });
    } else if (this._renderCount % 10 === 1) {
      this._logger?.debug('Render cycle triggered', {
        renderCount: this._renderCount,
        terminalSize: this._currentSize,
        focusedElementId: this._document.focusedElement?.id,
      });
    }

    // Clear buffer
    const clearStartTime = performance.now();
    this._buffer.clear();
    if (this._renderCount <= 3) {
      this._logger?.debug(`Buffer cleared in ${(performance.now() - clearStartTime).toFixed(2)}ms`);
    }

    // Render UI to buffer
    const viewport = {
      x: 0,
      y: 0,
      width: this._currentSize.width,
      height: this._currentSize.height,
    };
    const renderToBufferStartTime = performance.now();

    // Debug: log root element info
    if (this._renderCount <= 5) {
      const rootType = this._document.root?.type;
      const rootChildCount = this._document.root?.children?.length || 0;
      const dateEl = this._document.getElementById('date');
      const dateElClass = dateEl ? dateEl.constructor?.name : 'N/A';
      const hasRender = dateEl && typeof (dateEl as any).render === 'function';
      const hasIntrinsicSize = dateEl && typeof (dateEl as any).intrinsicSize === 'function';

      // Check if dateEl is actually in the root tree
      let foundInTree = false;
      const checkTree = (el: any) => {
        if (!el) return;
        if (el === dateEl) foundInTree = true;
        if (el.children) el.children.forEach(checkTree);
      };
      checkTree(this._document.root);

      this._logger?.debug(`[RENDER-DEBUG] root.type=${rootType}, children=${rootChildCount}, dateEl=${dateEl ? 'found' : 'null'}, class=${dateElClass}, hasRender=${hasRender}, hasIntrinsicSize=${hasIntrinsicSize}, inTree=${foundInTree}, dateEl.props.text=${dateEl?.props?.text || 'N/A'}`);
    }

    const layoutTree = this._renderer.render(this._document.root, this._buffer, viewport, this._document.focusedElement?.id, this._textSelectionHandler.getTextSelection(), this._textSelectionHandler.getHoveredElementId() || undefined, () => this.render());
    const layoutAndRenderTime = performance.now() - renderToBufferStartTime;
    this._lastLayoutTime = layoutAndRenderTime;
    this._layoutNodeCount = this._countLayoutNodes(layoutTree);

    // Record layout time for performance dialog averaging
    getGlobalPerformanceDialog().recordLayoutTime(layoutAndRenderTime);

    if (this._renderCount <= 3) {
      this._logger?.info(`Rendered to buffer in ${layoutAndRenderTime.toFixed(2)}ms`);
    }

    // Automatically detect and register focusable elements
    this._focusNavigationHandler.autoRegisterFocusableElements();

    // Update stats first (without swapping buffers)
    if (this._buffer) {
      this._buffer.updateStatsOnly();
    }

    // Render stats overlay if enabled (now with current stats)
    if (isStatsOverlayEnabled() && this._buffer) {
      try {
        const statsOverlay = getGlobalStatsOverlay();
        const stats = this._buffer.stats;
        if (stats) {
          statsOverlay.render(this._buffer, stats);
        }
      } catch (error) {
        // Silently ignore stats overlay errors to prevent breaking the main app
        console.warn('Stats overlay warning:', error);
      }
    }

    // Render error overlay if there are errors
    if (this._buffer) {
      try {
        getGlobalErrorOverlay().render(this._buffer);
      } catch {
        // Silently ignore error overlay errors
      }
    }

    // Render script error overlay if there are script errors
    if (this._buffer) {
      try {
        getGlobalScriptErrorOverlay().render(this._buffer);
      } catch {
        // Silently ignore script error overlay errors
      }
    }

    // Render performance dialog if visible
    const perfDialog = getGlobalPerformanceDialog();
    if (perfDialog.isVisible() && this._buffer) {
      try {
        const errorHandler = getGlobalErrorHandler();
        const breakdown = perfDialog.getLatencyBreakdown();
        const perfStats: PerformanceStats = {
          fps: perfDialog.getFps(),
          renderTime: this._lastRenderTime,
          renderTimeAvg: perfDialog.getAverageRenderTime(),
          renderCount: this._renderCount,
          layoutTime: this._lastLayoutTime,
          layoutTimeAvg: perfDialog.getAverageLayoutTime(),
          layoutNodeCount: this._layoutNodeCount,
          totalCells: this._buffer.stats?.totalCells || 0,
          changedCells: this._buffer.stats?.changedCells || 0,
          bufferUtilization: this._buffer.stats?.bufferUtilization || 0,
          memoryUsage: this._buffer.stats?.memoryUsage || 0,
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
        };
        perfDialog.render(this._buffer, perfStats);
      } catch {
        // Silently ignore performance dialog errors
      }
    }

    // Use optimized differential rendering instead of full clear+redraw
    const applyStartTime = performance.now();
    this._renderOptimized();
    getGlobalPerformanceDialog().markApplyEnd();
    if (this._renderCount <= 3) {
      this._logger?.info(`Applied to terminal in ${(performance.now() - applyStartTime).toFixed(2)}ms`);
    }

    const totalRenderTime = performance.now() - renderStartTime;
    this._lastRenderTime = totalRenderTime;

    // Record render time for performance dialog averaging
    getGlobalPerformanceDialog().recordRenderTime(totalRenderTime);
    getGlobalPerformanceDialog().recordInputLatency(); // Record input-to-render latency if input was pending

    if (this._renderCount <= 3 || totalRenderTime > 50) {
      this._logger?.info(`Total render time: ${totalRenderTime.toFixed(2)}ms for render #${this._renderCount}`);
    }

    if (totalRenderTime > 50) {
      this._logger?.warn(`Slow render detected: ${totalRenderTime.toFixed(2)}ms for render #${this._renderCount}`);
    }

    // Trigger debounced state persistence (if enabled)
    this._persistenceManager.triggerDebouncedSave();

    // Update focus traps for modal dialogs
    this._updateModalFocusTraps();
    } finally {
      this._isRendering = false;
      this._logger?.trace('render() finished, _isRendering = false');
    }
  }

  /**
   * Fast render for dialog drag/resize - only updates dialog overlay, preserves background
   */
  renderDialogOnly(): void {
    if (!this._isInitialized) {
      return;
    }

    if (this._isRendering) {
      return;
    }
    this._isRendering = true;

    try {
      const renderStartTime = performance.now();
      this._renderCount++;

      // Use dialog-only render (copies background from previous buffer, renders only modals)
      const success = this._renderer.renderDialogOnly(
        this._buffer,
        this._document.focusedElement?.id,
        this._textSelectionHandler.getHoveredElementId() || undefined,
        () => this.render()
      );

      if (!success) {
        // Fall back to full render if no cached layout
        this._isRendering = false;
        this.render();
        return;
      }

      // Output to terminal
      const differences = this._buffer.swapAndGetDiff();
      if (differences.length > 0 && typeof Deno !== 'undefined') {
        const output = this._ansiOutput.generateOptimizedOutput(differences as BufferDifference[], this._currentSize.width);
        if (output.length > 0) {
          const finalOutput = this._options.synchronizedOutput
            ? ANSI.beginSync + output + ANSI.endSync
            : output;
          Deno.stdout.writeSync(new TextEncoder().encode(finalOutput));
        }
      }

      const totalTime = performance.now() - renderStartTime;
      if (totalTime > 30) {
        this._logger?.debug(`Dialog-only render: ${totalTime.toFixed(2)}ms`);
      }
    } finally {
      this._isRendering = false;
    }
  }

  /**
   * Force a complete redraw of the terminal
   */
  forceRender(): void {
    // Skip render if engine is stopped/stopping - prevents writes after terminal cleanup
    if (!this._isInitialized) {
      this._logger?.debug('Skipping forceRender - engine not initialized');
      return;
    }

    // Render lock: prevent re-render during render
    if (this._isRendering) {
      this._logger?.debug('Skipping forceRender - already rendering (render lock active)');
      return;
    }
    this._isRendering = true;

    try {
    this._renderCount++;

    // Clear buffer
    this._buffer.clear();

    // Render UI to buffer
    const viewport = {
      x: 0,
      y: 0,
      width: this._currentSize.width,
      height: this._currentSize.height,
    };

    // Debug logging for column flexbox issues
    const root = this._document.root;
    if (root?.props?.style?.flexDirection === 'column' ||
        (root?.props?.style?.display === 'flex' && !root?.props?.style?.flexDirection)) {
      this._logger?.debug(`[FLEX-DEBUG] forceRender with column flex root`);
      this._logger?.debug(`[FLEX-DEBUG] Root children count: ${root.children?.length}`);
      this._logger?.debug(`[FLEX-DEBUG] Viewport: ${JSON.stringify(viewport)}`);
    }

    this._renderer.render(this._document.root, this._buffer, viewport, this._document.focusedElement?.id, this._textSelectionHandler.getTextSelection(), this._textSelectionHandler.getHoveredElementId() || undefined, () => this.render());

    // Debug: Check buffer content after render
    if (root?.props?.style?.flexDirection === 'column' ||
        (root?.props?.style?.display === 'flex' && !root?.props?.style?.flexDirection)) {
      this._logger?.debug(`[FLEX-DEBUG] After render completed`);
    }

    // Update stats first (without swapping buffers)
    if (this._buffer) {
      this._buffer.updateStatsOnly();
    }

    // Render stats overlay if enabled (now with current stats)
    if (isStatsOverlayEnabled() && this._buffer) {
      try {
        const statsOverlay = getGlobalStatsOverlay();
        const stats = this._buffer.stats;
        if (stats) {
          statsOverlay.render(this._buffer, stats);
        }
      } catch (error) {
        // Silently ignore stats overlay errors to prevent breaking the main app
        console.warn('Stats overlay warning:', error);
      }
    }

    // Render error overlay if there are errors
    if (this._buffer) {
      try {
        getGlobalErrorOverlay().render(this._buffer);
      } catch {
        // Silently ignore error overlay errors
      }
    }

    // Render script error overlay if there are script errors
    if (this._buffer) {
      try {
        getGlobalScriptErrorOverlay().render(this._buffer);
      } catch {
        // Silently ignore script error overlay errors
      }
    }

    // Render performance dialog if visible
    const perfDialog = getGlobalPerformanceDialog();
    if (perfDialog.isVisible() && this._buffer) {
      try {
        const errorHandler = getGlobalErrorHandler();
        const breakdown = perfDialog.getLatencyBreakdown();
        const perfStats: PerformanceStats = {
          fps: perfDialog.getFps(),
          renderTime: this._lastRenderTime,
          renderTimeAvg: perfDialog.getAverageRenderTime(),
          renderCount: this._renderCount,
          layoutTime: this._lastLayoutTime,
          layoutTimeAvg: perfDialog.getAverageLayoutTime(),
          layoutNodeCount: this._layoutNodeCount,
          totalCells: this._buffer.stats?.totalCells || 0,
          changedCells: this._buffer.stats?.changedCells || 0,
          bufferUtilization: this._buffer.stats?.bufferUtilization || 0,
          memoryUsage: this._buffer.stats?.memoryUsage || 0,
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
        };
        perfDialog.render(this._buffer, perfStats);
      } catch {
        // Silently ignore performance dialog errors
      }
    }

    // Automatically detect and register focusable elements
    // Pass true to skip the auto-render since we'll do a full screen redraw
    this._focusNavigationHandler.autoRegisterFocusableElements(true);

    // Force complete redraw
    this._renderFullScreen();

    // Update focus traps for modal dialogs
    this._updateModalFocusTraps();
    } finally {
      this._isRendering = false;
    }
  }

  /**
   * Set the terminal window title
   */
  setTitle(title: string): void {
    this._terminalRenderer.setTitle(title);
  }

  /**
   * Set the exit handler callback (called on Ctrl+C instead of default exit)
   */
  setOnExit(handler: () => void | Promise<void>): void {
    this._options.onExit = handler;
  }

  /**
   * Set source content for View Source feature (F12)
   * @param content - Original source content
   * @param filePath - Path to the source file
   * @param type - Type of source file ('md' or 'melker')
   * @param convertedContent - For .md files: the converted .melker content
   * @param policy - App policy if present
   * @param appDir - App directory for resolving policy paths
   * @param systemInfo - System info for debug tab
   * @param helpContent - Help text content (markdown)
   */
  setSource(content: string, filePath: string, type: 'md' | 'melker', convertedContent?: string, policy?: MelkerPolicy, appDir?: string, systemInfo?: SystemInfo, helpContent?: string): void {
    // Store policy for permission checks
    this._policy = policy;

    if (!this._devToolsManager) {
      this._devToolsManager = new DevToolsManager({
        document: this._document,
        focusManager: this._focusManager,
        registerElementTree: (element) => this._focusNavigationHandler.registerElementTree(element),
        render: () => this.render(),
        forceRender: () => this.forceRender(),
        autoRender: this._options.autoRender,
        openAIAssistant: () => {
          this._ensureAccessibilityDialogManager();
          this._accessibilityDialogManager!.show();
        },
        exit: () => {
          this.stop().then(() => {
            if (typeof Deno !== 'undefined') {
              Deno.exit(0);
            }
          }).catch(console.error);
        },
      });
    }
    this._devToolsManager.setSource(content, filePath, type, convertedContent, policy, appDir, systemInfo, helpContent);
  }

  /**
   * Show an alert dialog with the given message
   * This is the melker equivalent of window.alert()
   */
  showAlert(message: string): void {
    if (!this._alertDialogManager) {
      this._alertDialogManager = new AlertDialogManager({
        document: this._document,
        focusManager: this._focusManager,
        registerElementTree: (element) => this._focusNavigationHandler.registerElementTree(element),
        render: () => this.render(),
        forceRender: () => this.forceRender(),
        autoRender: this._options.autoRender,
      });
    }
    this._alertDialogManager.show(message);
  }

  /**
   * Show a confirm dialog with the given message
   * This is the melker equivalent of window.confirm()
   * Returns a Promise that resolves to true (OK) or false (Cancel)
   */
  showConfirm(message: string): Promise<boolean> {
    if (!this._confirmDialogManager) {
      this._confirmDialogManager = new ConfirmDialogManager({
        document: this._document,
        focusManager: this._focusManager,
        registerElementTree: (element) => this._focusNavigationHandler.registerElementTree(element),
        render: () => this.render(),
        forceRender: () => this.forceRender(),
        autoRender: this._options.autoRender,
      });
    }
    return this._confirmDialogManager.show(message);
  }

  /**
   * Show a prompt dialog with the given message
   * This is the melker equivalent of window.prompt()
   * Returns a Promise that resolves to the input value or null if cancelled
   */
  showPrompt(message: string, defaultValue?: string): Promise<string | null> {
    if (!this._promptDialogManager) {
      this._promptDialogManager = new PromptDialogManager({
        document: this._document,
        focusManager: this._focusManager,
        registerElementTree: (element) => this._focusNavigationHandler.registerElementTree(element),
        render: () => this.render(),
        forceRender: () => this.forceRender(),
        autoRender: this._options.autoRender,
      });
    }
    return this._promptDialogManager.show(message, defaultValue);
  }

  /**
   * Ensure the accessibility dialog manager is initialized
   */
  private _ensureAccessibilityDialogManager(): void {
    if (!this._accessibilityDialogManager) {
      this._accessibilityDialogManager = new AccessibilityDialogManager({
        document: this._document,
        focusManager: this._focusManager,
        registerElementTree: (element) => this._focusNavigationHandler.registerElementTree(element),
        render: () => this.render(),
        forceRender: () => this.forceRender(),
        autoRender: this._options.autoRender,
        exitProgram: async () => { await this.stop(); },
        scrollToBottom: (containerId) => this.scrollToBottom(containerId),
        getSelectedText: () => this.getTextSelection().selectedText,
      });
    }
  }

  /**
   * Optimized rendering that only updates changed parts of the terminal
   */
  private _renderOptimized(): void {
    if (typeof Deno !== 'undefined') {
      const differences = this._buffer.swapAndGetDiff();

      // Only render if there are actual changes
      if (differences.length === 0) {
        // Still notify debug clients even when no changes to render
        this._debugServer?.notifyRenderComplete();
        return;
      }

      const output = this._ansiOutput.generateOptimizedOutput(differences as BufferDifference[], this._currentSize.width);
      if (output.length > 0) {
        // Guard against writes after terminal cleanup (race condition with stop())
        if (!this._isInitialized) {
          return;
        }

        // Begin synchronized output to reduce flicker
        const finalOutput = this._options.synchronizedOutput
          ? ANSI.beginSync + output + ANSI.endSync
          : output;

        Deno.stdout.writeSync(new TextEncoder().encode(finalOutput));
      }

      // Notify debug clients of render completion
      this._debugServer?.notifyRenderComplete();
    }
  }

  /**
   * Fast render path for immediate visual feedback (e.g., typing in inputs)
   * Does NOT swap buffers, allowing the debounced full render to work correctly
   */
  private _renderFastPath(): void {
    if (typeof Deno !== 'undefined') {
      // Get diff without swapping - leaves buffer state intact for full render
      const differences = this._buffer.getDiffOnly();

      if (differences.length === 0) {
        return;
      }

      const output = this._ansiOutput.generateOptimizedOutput(differences as BufferDifference[], this._currentSize.width);
      if (output.length > 0) {
        if (!this._isInitialized) {
          return;
        }

        const finalOutput = this._options.synchronizedOutput
          ? ANSI.beginSync + output + ANSI.endSync
          : output;

        Deno.stdout.writeSync(new TextEncoder().encode(finalOutput));
      }
    }
  }

  /**
   * Full screen rendering for initial draw or when forced
   */
  private _renderFullScreen(): void {
    if (typeof Deno !== 'undefined') {
      // Begin synchronized output for full screen redraw
      let clearAndDrawOutput = ANSI.clearScreen + ANSI.cursorHome;

      // Get all buffer content
      const differences = this._buffer.forceRedraw();
      const output = this._ansiOutput.generateOptimizedOutput(differences as BufferDifference[], this._currentSize.width);

      if (output.length > 0) {
        clearAndDrawOutput += output;
      }

      // Guard against writes after terminal cleanup (race condition with stop())
      if (!this._isInitialized) {
        return;
      }

      // Apply synchronized output wrapper if enabled
      const finalOutput = this._options.synchronizedOutput
        ? ANSI.beginSync + clearAndDrawOutput + ANSI.endSync
        : clearAndDrawOutput;

      Deno.stdout.writeSync(new TextEncoder().encode(finalOutput));

      // Notify debug clients of render completion
      this._debugServer?.notifyRenderComplete();
    }
  }

  /**
   * Stop the engine and cleanup
   */
  async stop(): Promise<void> {
    this._logger?.info('MelkerEngine stopping', {
      renderCount: this._renderCount,
      isInitialized: this._isInitialized,
    });

    if (!this._isInitialized) {
      // Always try to cleanup terminal even if not officially initialized
      this.cleanupTerminal();
      return;
    }

    // Set flag early to prevent double cleanup
    this._isInitialized = false;

    // Save state immediately before cleanup (don't wait for debounce)
    await this._persistenceManager.saveBeforeExit();

    // Cancel any pending debounced input render
    this._debouncedInputRenderAction.cancel();

    // Clean up text selection handler (clear timers and state)
    if (this._textSelectionHandler) {
      this._textSelectionHandler.cleanup();
    }

    // Stop all video elements (kills ffmpeg/ffplay processes)
    try {
      const videoElements = this._document.getElementsByType('video');
      for (const el of videoElements) {
        if ('stopVideo' in el && typeof el.stopVideo === 'function') {
          await el.stopVideo();
        }
      }
    } catch (error) {
      console.warn('Error stopping video elements:', error);
    }

    // Stop event system with error handling
    if (this._inputProcessor) {
      try {
        await this._inputProcessor.stopListening();
      } catch (error) {
        console.warn('Error stopping input processor:', error);
      }
    }

    // Stop resize handling with error handling
    if (this._resizeHandler) {
      try {
        this._resizeHandler.stopListening();
      } catch (error) {
        console.warn('Error stopping resize handler:', error);
      }
    }

    // Stop debug server with error handling
    if (this._debugServer) {
      try {
        // Clear global instance before stopping
        setGlobalDebugServer(undefined);
        await this._debugServer.stop();
      } catch (error) {
        console.warn('Error stopping debug server:', error);
      }
    }

    // Stop headless mode with error handling
    if (this._headlessManager) {
      try {
        this._headlessManager.stop();
      } catch (error) {
        console.warn('Error stopping headless mode:', error);
      }
    }

    // Always cleanup terminal - this is the most critical part
    try {
      this.cleanupTerminal();
    } catch (error) {
      console.error('Critical error during terminal cleanup:', error);
      // Still try basic cleanup using emergency function
      emergencyCleanupTerminal();
    }

    // Log final message and close logger
    if (this._logger) {
      try {
        this._logger.info('MelkerEngine stopped successfully', {
          renderCount: this._renderCount,
        });

        // Use a timeout for logger close to prevent hanging
        const closeTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Logger close timeout')), 500)
        );

        await Promise.race([
          this._logger.close(),
          closeTimeout
        ]);
      } catch (error) {
        // Even if logger close fails, we should continue cleanup
        console.warn('Warning: Logger close timeout - continuing with shutdown:', error);
      }
    }

    // Remove from global tracking since cleanup is complete
    unregisterFromEmergencyCleanup(this as any);
  }

  /**
   * Update the UI by providing a new root element
   */
  updateUI(newRootElement: Element): void {
    this._rootElement = newRootElement;
    this._document.root = newRootElement;

    // Set root element dimensions from terminal size (same as constructor)
    const style = this._rootElement.props.style || {};
    if (!this._rootElement.props.width && !style.width) {
      this._rootElement.props.width = this._currentSize.width;
    }
    if (!this._rootElement.props.height && !style.height) {
      this._rootElement.props.height = this._currentSize.height;
    }

    // Inject system commands into all command palettes (opt-out with system={false})
    this._injectSystemCommands();

    // Inject default system command palette if no custom one exists
    this._injectSystemCommandPalette();

    // Update focus manager document reference after UI update
    if (this._focusManager) {
      this._focusManager.setDocument(this._document);
    }

    // Update renderer document reference (for tbody bounds lookup)
    if (this._renderer) {
      this._renderer.setDocument(this._document);
    }

    if (this._options.autoRender) {
      this.render();
    }
  }

  /**
   * Get current terminal size
   */
  get terminalSize(): { width: number; height: number } {
    return { ...this._currentSize };
  }

  /**
   * Enable state persistence for this app.
   * Must be called before the first render for proper state restoration.
   * @param appId Unique identifier for the app (used for state file naming)
   * @param mappings Optional custom persistence mappings
   */
  async enablePersistence(appId: string, mappings?: PersistenceMapping[]): Promise<void> {
    return this._persistenceManager.enablePersistence(appId, mappings);
  }

  /**
   * Save state immediately (bypasses debounce).
   * Useful when you need to ensure state is saved before exit.
   */
  async saveState(): Promise<void> {
    return this._persistenceManager.saveState();
  }

  /**
   * Calculate actual scroll dimensions for a scrollable container
   * Accepts either an Element directly or a container ID string
   */
  calculateScrollDimensions(containerOrId: Element | string): { width: number; height: number } | null {
    const container = typeof containerOrId === 'string'
      ? this._document.getElementById(containerOrId)
      : containerOrId;
    if (!container) {
      return null;
    }

    return this._renderer.calculateScrollDimensions(container);
  }

  /**
   * Resolve a relative URL against the engine's base URL
   */
  resolveUrl(url: string): string {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://')) {
      return url; // Already absolute
    }

    const baseUrl = this._options.baseUrl || 'file://';
    try {
      return new URL(url, baseUrl).href;
    } catch {
      // Fallback if URL construction fails
      return `${baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'}${url}`;
    }
  }

  /**
   * Check if a permission is granted by the app's policy
   * @param permission - The permission to check (e.g., 'shader', 'clipboard')
   * @returns true if permission is granted, false otherwise
   */
  hasPermission(permission: 'shader' | 'clipboard' | 'keyring' | 'browser' | 'ai' | 'all'): boolean {
    // If no policy is set, deny permission
    if (!this._policy) {
      return false;
    }

    const perms = this._policy.permissions;
    if (!perms) {
      return false;
    }

    // 'all' permission grants everything
    if (perms.all) {
      return true;
    }

    // Check the specific permission
    switch (permission) {
      case 'shader':
        return perms.shader === true;
      case 'clipboard':
        return perms.clipboard === true;
      case 'keyring':
        return perms.keyring === true;
      case 'browser':
        return perms.browser === true;
      case 'ai':
        return perms.ai === true || (Array.isArray(perms.ai) && perms.ai.length > 0);
      case 'all':
        // Already handled above - if we reach here, perms.all is falsy
        return false;
      default:
        return false;
    }
  }

  /**
   * Auto-scroll a container to the bottom (useful when adding new content)
   */
  scrollToBottom(containerId: string): void {
    const container = this._document.getElementById(containerId);
    if (!container || !container.props.scrollable) {
      return;
    }

    const contentDimensions = this.calculateScrollDimensions(containerId);
    // Get actual rendered container height from rendering engine
    const containerHeight = this._renderer.getContainerBounds(containerId)?.height || 0;

    if (contentDimensions && containerHeight > 0) {
      // Calculate max scroll to show bottom of content
      // Buffer accounts for potential content height calculation inaccuracies
      const buffer = 2;
      const maxScroll = Math.max(0, contentDimensions.height - containerHeight + buffer);
      container.props.scrollY = maxScroll;

      // Auto-render if enabled
      if (this._options.autoRender) {
        this.render();
      }
    }
  }

  /**
   * Get current document
   */
  get document(): Document {
    return this._document;
  }

  /**
   * Get render statistics
   */
  get stats(): {
    renderCount: number;
    terminalSize: { width: number; height: number };
    bufferStats: { totalCells: number; nonEmptyCells: number; bufferUtilization: number };
  } {
    return {
      renderCount: this._renderCount,
      terminalSize: this.terminalSize,
      bufferStats: this._buffer.getStats(),
    };
  }

  /**
   * Get detailed rendering performance statistics
   */
  getRenderingStats(): {
    renderCount: number;
    lastRenderChanges?: number;
    averageChangesPerRender?: number;
    terminalSize: { width: number; height: number };
    bufferUtilization: number;
    optimizationSavings?: string;
  } {
    const bufferStats = this._buffer.getStats();
    return {
      renderCount: this._renderCount,
      terminalSize: this.terminalSize,
      bufferUtilization: bufferStats.bufferUtilization,
      optimizationSavings: this._renderCount > 1
        ? `Using differential rendering instead of ${this._renderCount} full redraws`
        : 'Initial render completed',
    };
  }

  /**
   * Get event manager (null if events disabled)
   */
  get eventManager(): EventManager | null {
    return this._eventManager || null;
  }

  /**
   * Get focus manager (null if events disabled)
   */
  get focusManager(): FocusManager | null {
    return this._focusManager || null;
  }

  /**
   * Get input processor (null if events disabled)
   */
  get inputProcessor(): TerminalInputProcessor | null {
    return this._inputProcessor || null;
  }

  /**
   * Get the current buffer for debugging
   */
  getBuffer(): DualBuffer {
    return this._buffer;
  }

  /**
   * Get current terminal size
   */
  getTerminalSize(): { width: number; height: number } {
    return { ...this._currentSize };
  }

  /**
   * Register a custom resize handler
   */
  onResize(handler: (event: { previousSize: { width: number; height: number }, newSize: { width: number; height: number }, timestamp: number }) => void): void {
    this._customResizeHandlers.push(handler);
  }

  /**
   * Register a handler to be called when the engine is fully mounted and ready
   * Handlers can be sync or async - async errors will be caught and reported
   */
  onMount(handler: () => void | Promise<void>): void {
    this._mountHandlers.push(handler);
  }

  /**
   * Trigger all registered mount handlers
   */
  _triggerMountHandlers(): void {
    for (const handler of this._mountHandlers) {
      try {
        const result = handler() as unknown;
        // Handle async handlers - catch any rejected promises
        if (result && typeof (result as { catch?: unknown }).catch === 'function') {
          (result as Promise<void>).catch((error) => {
            const err = error instanceof Error ? error : new Error(String(error));
            this._logger?.error('Error in async mount handler', err);
            // CRITICAL: Restore terminal and show error - never fail silently
            this.cleanupTerminal();
            console.error('\n\x1b[31mError in mount handler:\x1b[0m', err.message);
            if (err.stack) {
              console.error('\nStack trace:');
              console.error(err.stack);
            }
            Deno.exit(1);
          });
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this._logger?.error('Error in mount handler', err);
        // CRITICAL: Restore terminal and show error - never fail silently
        this.cleanupTerminal();
        console.error('\n\x1b[31mError in mount handler:\x1b[0m', err.message);
        if (err.stack) {
          console.error('\nStack trace:');
          console.error(err.stack);
        }
        Deno.exit(1);
      }
    }
  }

  /**
   * Check if engine is currently running
   */
  get isRunning(): boolean {
    return this._isInitialized;
  }

  /**
   * Get headless manager (null if not in headless mode)
   */
  get headlessManager(): HeadlessManager | null {
    return this._headlessManager || null;
  }

  /**
   * Check if running in headless mode
   */
  get isHeadless(): boolean {
    return isRunningHeadless();
  }

  /**
   * Inject a key press event (for debugging/testing)
   */
  handleKeyPress(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): void {
    if (this._eventManager) {
      this._eventManager.dispatchEvent({
        type: 'keypress',
        key: event.key,
        code: event.key,
        ctrlKey: event.ctrlKey || false,
        altKey: false,
        metaKey: event.metaKey || false,
        shiftKey: event.shiftKey || false,
        target: undefined,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Trigger a click event on an element by ID (for debugging/testing)
   */
  clickElementById(elementId: string): void {
    if (this._document) {
      const element = this._document.getElementById(elementId);
      if (element) {
        this._document.triggerElementEvent(element, {
          type: 'click',
          target: element,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Inject a mouse event (for debugging/testing)
   */
  handleMouseEvent(event: { type: 'click' | 'mousedown' | 'mouseup' | 'mousemove' | 'mouseover' | 'mouseout'; position: { x: number; y: number }; button?: number }): void {
    if (this._eventManager) {
      const mouseEvent = {
        x: event.position.x,
        y: event.position.y,
        button: event.button || 0
      };

      if (event.type === 'mousemove') {
        // Use the text selection handler which includes hover tracking
        this._textSelectionHandler.handleMouseMove(mouseEvent);
      } else if (event.type === 'click' || event.type === 'mousedown') {
        // Route click/mousedown through the text selection handler
        // which performs hit testing and calls onElementClick
        this._textSelectionHandler.handleMouseDown(mouseEvent);
      } else if (event.type === 'mouseup') {
        // Route mouseup through the text selection handler
        this._textSelectionHandler.handleMouseUp(mouseEvent);
      } else {
        // For other events, just dispatch to event manager
        const target = this._hitTester.hitTest(event.position.x, event.position.y);

        this._eventManager.dispatchEvent({
          type: event.type,
          x: event.position.x,
          y: event.position.y,
          button: event.button || 0,
          buttons: 1,
          target: target?.id,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Register a focusable element with the focus manager
   * @param elementId - The ID of the element to register as focusable
   * @throws {Error} If the element with the given ID does not exist in the document
   */
  registerFocusableElement(elementId: string): void {
    if (this._focusManager) {
      this._focusManager.registerFocusableElement(elementId);
    }
  }

  /**
   * Remove a focusable element from the focus manager
   */
  unregisterFocusableElement(elementId: string): void {
    if (this._focusManager) {
      this._focusManager.unregisterFocusableElement(elementId);
    }
  }

  /**
   * Force refresh of all focusable elements
   */
  forceRefreshFocusableElements(): void {
    this._focusNavigationHandler.autoRegisterFocusableElements();
  }

  /**
   * Focus an element by ID
   */
  focusElement(elementId: string): boolean {
    return this._focusManager ? this._focusManager.focus(elementId) : false;
  }

  /**
   * Get currently focused element ID
   */
  getFocusedElement(): string | null {
    return this._focusManager ? this._focusManager.getFocusedElement() : null;
  }

  private _setupCleanupHandlers(): void {
    setupCleanupHandlers(
      () => this.stop(),
      () => this.cleanupTerminal()
    );
  }

  /**
   * Set up emergency cleanup that runs even if the normal cleanup fails
   */
  private _setupEmergencyCleanup(): void {
    // Cast to any to satisfy interface - _cleanupTerminal is private but callable
    registerForEmergencyCleanup(this as any);
  }

  // Theme management
  getThemeManager(): ThemeManager {
    return this._themeManager;
  }

  /**
   * Find an open command palette in the element tree
   */
  private _findOpenCommandPalette(): Element | null {
    if (!this._document) return null;

    const findInTree = (element: Element): Element | null => {
      if (element.type === 'command-palette' && element.props.open === true) {
        return element;
      }
      if (element.children) {
        for (const child of element.children) {
          const found = findInTree(child);
          if (found) return found;
        }
      }
      return null;
    };

    return findInTree(this._rootElement);
  }

  /**
   * Count layout nodes in a layout tree
   */
  private _countLayoutNodes(node: any): number {
    if (!node) return 0;
    let count = 1;
    if (node.children) {
      for (const child of node.children) {
        count += this._countLayoutNodes(child);
      }
    }
    return count;
  }

  /**
   * Check if there are any open dialogs in the document tree
   */
  private _hasOpenDialogInDocument(): boolean {
    if (!this._document?.root) return false;
    return this._findOpenDialog(this._document.root);
  }

  private _findOpenDialog(element: Element): boolean {
    if (element.type === 'dialog' && element.props?.open === true) {
      return true;
    }
    if (element.children) {
      for (const child of element.children) {
        if (this._findOpenDialog(child)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if there's an open dialog that's NOT an ancestor of the given element
   * (i.e., a dialog overlay that would be drawn on top of the element)
   */
  private _hasOverlayDialogFor(element: Element): boolean {
    if (!this._document?.root) return false;

    // Find all open dialogs and check if element is inside any of them
    const openDialogs: Element[] = [];
    this._collectOpenDialogs(this._document.root, openDialogs);

    if (openDialogs.length === 0) return false;

    // Check if element is a descendant of any open dialog
    for (const dialog of openDialogs) {
      if (this._isDescendantOf(element, dialog)) {
        // Element is inside this dialog - this dialog is not an overlay for it
        // But there might be OTHER open dialogs that are overlays
        continue;
      }
      // This dialog doesn't contain the element - it's an overlay
      return true;
    }
    return false;
  }

  private _collectOpenDialogs(element: Element, result: Element[]): void {
    if (element.type === 'dialog' && element.props?.open === true) {
      result.push(element);
    }
    if (element.children) {
      for (const child of element.children) {
        this._collectOpenDialogs(child, result);
      }
    }
  }

  /**
   * Check if element is a descendant of container (by traversing container's children)
   */
  private _isDescendantOf(element: Element, container: Element): boolean {
    if (container === element) return true;
    if (container.children) {
      for (const child of container.children) {
        if (this._isDescendantOf(element, child)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Update focus traps for modal dialogs
   * Called after each render to ensure focus is trapped when modals open/close
   */
  private _updateModalFocusTraps(): void {
    if (!this._document?.root) return;

    // Collect all open modal dialogs
    const openModalDialogs: Element[] = [];
    this._collectOpenModalDialogs(this._document.root, openModalDialogs);

    const currentOpenIds = new Set(openModalDialogs.map(d => d.id).filter(Boolean) as string[]);

    // Release traps for dialogs that closed
    for (const dialogId of this._trappedModalDialogIds) {
      if (!currentOpenIds.has(dialogId)) {
        this._logger?.debug(`Releasing focus trap for closed modal: ${dialogId}`);
        this._focusManager.releaseFocusTrap(dialogId, true);
        this._trappedModalDialogIds.delete(dialogId);
      }
    }

    // Set up traps for newly opened dialogs
    for (const dialog of openModalDialogs) {
      if (dialog.id && !this._trappedModalDialogIds.has(dialog.id)) {
        this._logger?.debug(`Setting up focus trap for modal: ${dialog.id}`);

        // Find the first focusable element inside the dialog
        // Check canReceiveFocus() directly since elements may not be registered yet
        let initialFocus: string | undefined;
        const findFirstFocusable = (element: Element): string | undefined => {
          // Check if this element can receive focus
          if (element.id) {
            const canFocus = (element as any).canReceiveFocus;
            if (typeof canFocus === 'function' && canFocus.call(element)) {
              return element.id;
            }
          }
          // Check children
          if (element.children) {
            for (const child of element.children) {
              const found = findFirstFocusable(child);
              if (found) return found;
            }
          }
          return undefined;
        };

        initialFocus = findFirstFocusable(dialog);

        this._focusManager.trapFocus({
          containerId: dialog.id,
          initialFocus,
          restoreFocus: true,
        });
        this._trappedModalDialogIds.add(dialog.id);
      }
    }
  }

  /**
   * Collect all open modal dialogs from the element tree
   */
  private _collectOpenModalDialogs(element: Element, result: Element[]): void {
    if (element.type === 'dialog' && element.props?.open === true && element.props?.modal === true) {
      result.push(element);
    }
    if (element.children) {
      for (const child of element.children) {
        this._collectOpenModalDialogs(child, result);
      }
    }
  }

  /**
   * Get system command handlers
   */
  private _getSystemHandlers(): SystemHandlers {
    return {
      exit: () => this.stop(),
      aiDialog: () => {
        this._ensureAccessibilityDialogManager();
        this._accessibilityDialogManager!.toggle();
        this.render();
      },
      devTools: () => {
        this._devToolsManager?.toggle();
        this.render();
      },
      performance: () => {
        getGlobalPerformanceDialog().toggle();
        this.render();
      },
    };
  }

  /**
   * Get the system command palette (creates one if needed)
   */
  getSystemCommandPalette(): Element | undefined {
    return this._systemCommandPalette;
  }

  /**
   * Toggle the command palette (opens system palette if no custom one exists)
   */
  toggleCommandPalette(): void {
    // First check for custom command palette
    const customPalette = this._findOpenCommandPalette() || this._findCommandPalette();
    if (customPalette) {
      (customPalette as any).toggle?.();
      this.render();
      return;
    }

    // Fall back to system command palette
    if (this._systemCommandPalette) {
      (this._systemCommandPalette as any).toggle?.();
      this.render();
    }
  }

  /**
   * Find any command palette in the document (open or closed)
   */
  private _findCommandPalette(): Element | null {
    if (!this._document?.root) return null;
    return this._findElementByType(this._document.root, 'command-palette');
  }

  /**
   * Find element by type in tree
   */
  private _findElementByType(element: Element, type: string): Element | null {
    if (element.type === type) return element;
    if (element.children) {
      for (const child of element.children) {
        const found = this._findElementByType(child, type);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Inject system command palette if no command palette exists in document
   */
  private _injectSystemCommandPalette(): void {
    // Check if document already has a command palette
    if (this._findCommandPalette()) {
      this._systemCommandPalette = undefined;
      return;
    }

    // Create system command palette with direct handlers
    this._systemCommandPalette = createDefaultCommandPalette(this._getSystemHandlers());

    // Add to root element's children (document will register when traversing tree)
    if (this._document?.root) {
      if (!this._document.root.children) {
        this._document.root.children = [];
      }
      this._document.root.children.push(this._systemCommandPalette);
    }
  }

  /**
   * Inject system commands into all command palettes
   * System commands are added by default, opt-out with system={false}
   */
  private _injectSystemCommands(): void {
    if (!this._document?.root) return;
    this._injectSystemCommandsInElement(this._document.root);
  }

  private _injectSystemCommandsInElement(element: Element): void {
    if (element.type === 'command-palette') {
      // Opt-out: skip if system={false}
      if (element.props?.system === false) {
        // Recurse into children
        if (element.children) {
          for (const child of element.children) {
            this._injectSystemCommandsInElement(child);
          }
        }
        return;
      }

      if (!element.children) {
        element.children = [];
      }

      // Check if system group already exists (from <group system="true" /> marker)
      let hasSystemGroup = false;
      for (let i = 0; i < element.children.length; i++) {
        const child = element.children[i];
        if (child.type === 'group' && child.props?.system === true) {
          // Replace marker with actual system group
          element.children[i] = createSystemGroup(this._getSystemHandlers());
          hasSystemGroup = true;
        }
      }

      // If no system group marker, append system group at the end
      if (!hasSystemGroup) {
        element.children.push(createSystemGroup(this._getSystemHandlers()));
      }

      // Refresh the cached options from updated children
      if (typeof (element as any).refreshChildOptions === 'function') {
        (element as any).refreshChildOptions();
      }
    }

    // Recurse into children
    if (element.children) {
      for (const child of element.children) {
        this._injectSystemCommandsInElement(child);
      }
    }
  }
}

/**
 * Utility function to create and start a Melker application
 */
export async function createApp(
  rootElement: Element,
  options?: MelkerEngineOptions
): Promise<MelkerEngine> {
  // Import theme manager to apply automatic theme defaults
  const { getThemeManager } = await import('./theme.ts');
  const themeManager = getThemeManager();
  const currentTheme = themeManager.getCurrentTheme();

  // Apply theme-based defaults if no options provided
  const finalOptions: MelkerEngineOptions = {
    colorSupport: currentTheme.colorSupport,
    theme: `${currentTheme.type}-${currentTheme.mode}`,
    ...options // User options override theme defaults
  };

  const engine = new MelkerEngine(rootElement, finalOptions);
  await engine.start();
  return engine;
}