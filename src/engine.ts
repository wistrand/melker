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
import { ensureError } from './utils/error.ts';
import { Env } from './env.ts';
import { DualBuffer, EMPTY_CHAR, type BufferDiff } from './buffer.ts';
import { RenderingEngine } from './rendering.ts';
import { TerminalRenderer } from './renderer.ts';
import { ResizeHandler } from './resize.ts';
import { Element, TextSelection, isScrollingEnabled } from './types.ts';
import type { StyleContext } from './stylesheet.ts';
import {
  EventManager,
  type MelkerEvent,
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
  DialogCoordinator,
} from './dialog-coordinator.ts';
import {
  getSystemHandlers,
  findOpenCommandPalette,
  toggleCommandPalette as toggleCommandPaletteHelper,
  injectSystemCommandPalette,
  injectSystemCommands,
  rebuildPaletteShortcuts,
  type SystemPaletteContext,
} from './engine-system-palette.ts';
import {
  hasOverlayDialogFor,
  collectOpenDialogIds,
  updateModalFocusTraps,
  type ModalFocusTrapContext,
} from './engine-dialog-utils.ts';
import {
  TerminalInputProcessor,
} from './input.ts';
import {
  MelkerServer,
  isServerEnabled,
  createServer,
  setGlobalServer,
  type ServerOptions,
} from './server.ts';
import {
  GraphicsOverlayManager,
} from './graphics-overlay-manager.ts';
import {
  TerminalSizeManager,
} from './terminal-size-manager.ts';
import {
  renderBufferOverlays,
} from './engine-buffer-overlays.ts';
import {
  initializeHeadlessMode,
  isHeadlessEnabled,
  isRunningHeadless,
  getHeadlessManager,
  type HeadlessManager,
} from './headless.ts';
import {
  isStdoutEnabled,
  getStdoutManager,
  type StdoutManager,
} from './stdout.ts';
import {
  getThemeManager,
  getThemeColor,
  type ThemeManager,
} from './theme.ts';
import {
  getGlobalPerformanceDialog,
} from './performance-dialog.ts';
import {
  getLogger,
} from './logging.ts';

const logger = getLogger('MelkerEngine');
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
  setupCleanupHandlers,
  registerForEmergencyCleanup,
  unregisterFromEmergencyCleanup,
} from './terminal-lifecycle.ts';
import {
  handleKeyboardEvent,
  type KeyboardHandlerContext,
  type RawKeyEvent,
} from './engine-keyboard-handler.ts';
import {
  handleWheelEvent,
  handleMouseDownEvent,
  handleMouseMoveEvent,
  handleMouseUpEvent,
  type MouseHandlerContext,
} from './engine-mouse-handler.ts';
import type { SixelCapabilities } from './sixel/mod.ts';
import type { KittyCapabilities } from './kitty/mod.ts';
import type { ITermCapabilities } from './iterm2/mod.ts';
import {
  getToastManager,
} from './toast/mod.ts';
import {
  getTooltipManager,
} from './tooltip/mod.ts';
import {
  initUIAnimationManager,
  shutdownUIAnimationManager,
} from './ui-animation-manager.ts';

// Initialize config logger getter (breaks circular dependency between config.ts and logging.ts)
setLoggerGetter(() => getLogger('Config'));

// Reusable TextEncoder/TextDecoder to avoid per-render allocations
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

  // Server options
  enableServer?: boolean;
  serverOptions?: ServerOptions;

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
  private _server?: MelkerServer;
  private _headlessManager?: HeadlessManager;
  private _themeManager!: ThemeManager;
  private _rootElement: Element;
  private _options: Required<MelkerEngineOptions>;
  private _terminalSizeManager!: TerminalSizeManager;
  private _isInitialized = false;
  private _isRendering = false;  // Render lock to prevent re-render during render
  private _pendingRender = false;  // Track if render was requested during _isRendering
  private _renderCount = 0;
  private _mountHandlers: Array<() => void | Promise<void>> = [];
  private _beforeExitHandlers: Array<() => boolean | Promise<boolean>> = [];
  // Debounced action for rapid input rendering (e.g., paste operations)
  private _debouncedInputRenderAction!: DebouncedAction;

  // Dev Tools feature
  private _devToolsManager?: DevToolsManager;

  /** Public accessor for dev tools (used by melker-runner). */
  get devToolsManager(): DevToolsManager | undefined { return this._devToolsManager; }

  // Dialog coordinator (alert, confirm, prompt, accessibility)
  private _dialogCoordinator!: DialogCoordinator;

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

  // Track which dialogs were open in previous frame (for auto force-render on dialog open)
  private _previouslyOpenDialogIds = new Set<string>();

  // Graphics overlay manager for sixel, kitty, and iTerm2
  private _graphicsOverlayManager!: GraphicsOverlayManager;

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
      enableServer: isServerEnabled(),
      serverOptions: {},
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
      // Force server to be enabled in headless mode
      if (this._headlessManager && !this._options.enableServer) {
        this._options.enableServer = true;
      }
    }

    // Initialize theme manager
    this._themeManager = getThemeManager();
    if (this._options.theme) {
      this._themeManager.setTheme(this._options.theme);
    }

    // Initialize toast manager with config
    const toastManager = getToastManager();
    toastManager.setConfig({
      maxVisible: config.toastMaxVisible,
      position: config.toastPosition,
      defaultDuration: config.toastDefaultDuration,
      inactivityTimeout: config.toastInactivityTimeout,
      bell: config.toastBell,
      width: config.toastWidth,
    });
    toastManager.setRequestRender(() => this.render());

    // Initialize tooltip manager
    const tooltipManager = getTooltipManager();
    tooltipManager.setRequestRender(() => this.render());

    // Initialize UI animation manager
    initUIAnimationManager(() => this.render());

    // Apply theme-based color support if not explicitly set
    const currentTheme = this._themeManager.getCurrentTheme();
    if (options?.colorSupport === undefined) {
      this._options.colorSupport = currentTheme.colorSupport;
    }

    this._rootElement = rootElement;

    // Initialize terminal size manager (must be before _initializeComponents)
    this._terminalSizeManager = new TerminalSizeManager({
      initialWidth: this._options.initialWidth,
      initialHeight: this._options.initialHeight,
      headlessManager: this._headlessManager,
    });

    // Make engine globally accessible for components that need URL resolution
    globalThis.melkerEngine = this;

    // Set element size to match terminal size if not specified
    const style = this._rootElement.props.style || {};
    if (!this._rootElement.props.width && !style.width) {
      this._rootElement.props.width = this._terminalSizeManager.size.width;
    }
    if (!this._rootElement.props.height && !style.height) {
      this._rootElement.props.height = this._terminalSizeManager.size.height;
    }

    // Initialize core components
    this._initializeComponents();

    // Initialize debounced input render action
    // 16ms delay (~1 frame): fast render provides immediate feedback, full render for layout correctness
    this._debouncedInputRenderAction = createDebouncedAction(() => {
      this.render();
    }, 16);

    // Set up global emergency cleanup in case something goes wrong
    this._setupEmergencyCleanup();
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
      // Disable raw mode and input in stdout mode - terminal stays in normal mode
      const stdoutMode = isStdoutEnabled();
      this._inputProcessor = new TerminalInputProcessor({
        enableMouse: stdoutMode ? false : this._options.enableMouse,
        enableFocusEvents: stdoutMode ? false : this._options.enableFocusEvents,
        enableRawMode: stdoutMode ? false : true, // Disable raw mode in stdout mode
        mouseReporting: stdoutMode ? 'none' : this._options.mouseReporting,
        mapMetaToAlt: this._options.mapMetaToAlt,
      }, this._eventManager);
    }

    // Initialize buffer and renderers with theme-aware default cell
    const defaultCell = {
      char: EMPTY_CHAR,
      background: getThemeColor('background'),
      foreground: getThemeColor('textPrimary')
    };
    this._buffer = new DualBuffer(this._terminalSizeManager.size.width, this._terminalSizeManager.size.height, defaultCell);
    this._renderer = new RenderingEngine();
    this._renderer.setDocument(this._document);
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
      viewportSize: this._terminalSizeManager.size,
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
        onRender: () => this.render(),
        onRenderDialogOnly: () => this.renderDialogOnly(),
        onRenderOptimized: () => this._renderOptimized(),
        onElementClick: (element, event) => this._elementClickHandler.handleElementClick(element, event),
      }
    );

    // Initialize dialog coordinator
    this._dialogCoordinator = new DialogCoordinator({
      document: this._document,
      focusManager: this._focusManager,
      autoRender: this._options.autoRender,
      registerElementTree: (element) => this._focusNavigationHandler.registerElementTree(element),
      render: () => this.render(),
      forceRender: () => this.forceRender(),
      exitProgram: async () => { await this.stop(); },
      scrollToBottom: (containerId) => this.scrollToBottom(containerId),
      getSelectedText: () => this.getTextSelection().selectedText,
    });

    // Set up resize handler if enabled (skip in stdout mode - fixed size output)
    if (this._options.autoResize && !isStdoutEnabled()) {
      this._resizeHandler = new ResizeHandler(this._terminalSizeManager.size, {
        debounceMs: this._options.debounceMs,
        autoRender: false, // Disable auto-render, we handle it manually via onResize
        onResize: (event) => this._terminalSizeManager.handleResize(
          event.newSize,
          (_previousSize, newSize) => {
            this._hitTester.updateContext({ viewportSize: newSize });
            this._buffer.resize(newSize.width, newSize.height);
            this._rootElement.props.width = newSize.width;
            this._rootElement.props.height = newSize.height;
            // Re-apply stylesheets with media rules/variables for new terminal size
            const stylesheets = this._document.stylesheets;
            if (stylesheets.length > 0) {
              const ctx: StyleContext = {
                terminalWidth: newSize.width,
                terminalHeight: newSize.height,
              };
              for (const stylesheet of stylesheets) {
                if (stylesheet.hasMediaRules) {
                  stylesheet.applyTo(this._rootElement, ctx);
                }
              }
            }
            this._document.dispatchEvent({
              type: 'resize' as const,
              previousSize: _previousSize,
              newSize,
              timestamp: Date.now(),
            });
            if (this._server) {
              this._server.notifyTerminalResize(newSize.width, newSize.height);
            }
          },
          this._options.autoRender,
          () => this.forceRender(),
        ),
      });
    }

    // Initialize server if enabled
    if (this._options.enableServer) {
      this._server = createServer(this._options.serverOptions);
    }

    // Initialize state persistence manager
    this._persistenceManager = new StatePersistenceManager(
      { persistenceDebounceMs: this._options.persistenceDebounceMs },
      {
        document: this._document,
      }
    );

    // Initialize graphics overlay manager
    this._graphicsOverlayManager = new GraphicsOverlayManager({
      document: this._document,
      renderer: this._renderer,
      writeAllSync: (data) => this._writeAllSync(data),
    });
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
    // Keyboard handling delegated to engine-keyboard-handler.ts
    this._eventManager.addGlobalEventListener('keydown', (event: any) => {
      const ctx: KeyboardHandlerContext = {
        // Core components
        document: this._document!,
        buffer: this._buffer,
        renderer: this._renderer,
        inputProcessor: this._inputProcessor,

        // Handlers
        focusNavigationHandler: this._focusNavigationHandler,
        scrollHandler: this._scrollHandler,
        textSelectionHandler: this._textSelectionHandler,

        // Dialog managers
        devToolsManager: this._devToolsManager,
        alertDialogManager: this._dialogCoordinator.alertDialogManager,
        confirmDialogManager: this._dialogCoordinator.confirmDialogManager,
        promptDialogManager: this._dialogCoordinator.promptDialogManager,
        getAccessibilityDialogManager: () => this._dialogCoordinator.accessibilityDialogManager,

        // Options
        autoRender: this._options.autoRender,
        onExit: this._options.onExit,
        onBeforeExit: this._beforeExitHandlers.length > 0
          ? () => this._callBeforeExitHandlers()
          : undefined,

        // Engine methods (bound callbacks)
        render: () => this.render(),
        stop: () => this.stop(),
        toggleCommandPalette: () => this.toggleCommandPalette(),
        findOpenCommandPalette: () => this._findOpenCommandPalette(),
        ensureAccessibilityDialogManager: () => this._dialogCoordinator.ensureAccessibilityDialogManager(),
        hasOverlayDialogFor: (element) => hasOverlayDialogFor(element, this._document?.root),
        debouncedInputRender: () => this._debouncedInputRender(),
        renderFastPath: (diffs) => this._renderFastPath(diffs),
      };

      handleKeyboardEvent(event as RawKeyEvent, ctx);
    });

    // Mouse and wheel event handling - delegated to engine-mouse-handler.ts
    const mouseCtx: MouseHandlerContext = {
      hitTester: this._hitTester,
      scrollHandler: this._scrollHandler,
      textSelectionHandler: this._textSelectionHandler,
      graphicsOverlayManager: this._graphicsOverlayManager,
      autoRender: this._options.autoRender,
      render: () => this.render(),
      getViewportSize: () => this._terminalSizeManager.size,
    };

    this._eventManager.addGlobalEventListener('wheel', (event: any) => {
      handleWheelEvent(event, mouseCtx);
    });

    this._eventManager.addGlobalEventListener('mousedown', (event: any) => {
      handleMouseDownEvent(event, mouseCtx);
    });

    this._eventManager.addGlobalEventListener('mousemove', (event: any) => {
      handleMouseMoveEvent(event, mouseCtx);
    });

    this._eventManager.addGlobalEventListener('mouseup', (event: any) => {
      handleMouseUpEvent(event, mouseCtx);
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
    logger.info('Terminal', {
      size: `${this._terminalSizeManager.size.width}x${this._terminalSizeManager.size.height}`,
      term: Env.get('TERM') || 'unknown',
      colorterm: Env.get('COLORTERM') || 'none',
      stdin: Deno.stdin.isTerminal() ? 'tty' : 'pipe',
      stdout: Deno.stdout.isTerminal() ? 'tty' : 'pipe',
    });

    // Setup terminal FIRST (alternate screen) before sixel detection
    // This ensures any late terminal query responses go to the alternate screen
    // (which gets cleared on render) rather than appearing on the main screen
    this._setupTerminal();

    // Start event system BEFORE sixel detection
    // Detection queries are written to terminal and responses are read by the input loop
    if (this._options.enableEvents && this._inputProcessor) {
      await this._inputProcessor.startListening();
      this._setupEventHandlers();
    }

    // Detect graphics capabilities (sixel, kitty, iTerm2)
    const skipGraphicsQueries = isRunningHeadless() || isStdoutEnabled() || !Deno.stdout.isTerminal();
    await this._graphicsOverlayManager.detectCapabilities(skipGraphicsQueries);

    // Re-query terminal size after setup (alternate screen switch may affect reported size)
    this._terminalSizeManager.refreshSize();

    // Resize buffer to match current terminal size
    this._buffer.resize(this._terminalSizeManager.size.width, this._terminalSizeManager.size.height);

    // Start resize handling BEFORE initial render to ensure size is correct
    if (this._options.autoResize && this._resizeHandler) {
      // Update resize handler's internal size to match current size before starting
      // This prevents the resize handler from thinking size changed when it hasn't
      (this._resizeHandler as any)._currentSize = { ...this._terminalSizeManager.size };

      await this._resizeHandler.startListening();
    }

    // Start server if enabled
    if (this._server) {
      try {
        this._server.attachEngine(this);
        await this._server.start();
        // Set global instance for logging integration
        setGlobalServer(this._server);
        logger.info('Server started', {
          url: this._server.connectionUrl,
        });
        // Print connection URL to stderr in headless mode so users know where to connect
        if (this._headlessManager) {
          Deno.stderr.writeSync(textEncoder.encode(
            `Server: ${this._server.connectionUrl}\n`
          ));
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('Failed to start server', {
          errorMessage,
          error: error instanceof Error ? error.message : String(error),
        });
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
    logger.info('MelkerEngine started successfully', {
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
   * Acquire the render lock. Returns true if rendering should proceed,
   * false if it should be skipped (not initialized or already rendering).
   */
  private _acquireRenderLock(): boolean {
    if (!this._isInitialized) {
      logger.debug('Skipping render - engine not initialized');
      return false;
    }
    if (this._isRendering) {
      this._pendingRender = true;
      logger.debug('Render requested during render - marking pending');
      return false;
    }
    this._isRendering = true;
    this._pendingRender = false;
    return true;
  }

  /**
   * Release the render lock and process any pending render.
   */
  private _releaseRenderLock(): void {
    this._isRendering = false;
    if (this._pendingRender) {
      this._pendingRender = false;
      queueMicrotask(() => this.render());
    }
  }

  /**
   * Manually trigger a render
   */
  render(): void {
    // Debug: always log render entry
    logger.trace('render() called');

    if (!this._acquireRenderLock()) return;

    try {
    const renderStartTime = performance.now();
    getGlobalPerformanceDialog().markRenderStart();

    // Update theme cache once per render (avoids repeated lookups in setCell hot path)
    this._buffer?.updateThemeCache();

    this._renderCount++;
    globalThis.melkerRenderCount = this._renderCount;

    // Always log initial renders for debugging
    if (this._renderCount <= 3) {
      logger.info(`Starting render #${this._renderCount}`, {
        terminalSize: this._terminalSizeManager.size,
        focusedElementId: this._document.focusedElement?.id,
      });
    } else if (this._renderCount % 10 === 1) {
      logger.debug('Render cycle triggered', {
        renderCount: this._renderCount,
        terminalSize: this._terminalSizeManager.size,
        focusedElementId: this._document.focusedElement?.id,
      });
    }

    // Auto-detect newly opened dialogs and mark for force render
    // This ensures dialogs render correctly without requiring apps to call forceRender
    const currentOpenDialogs = collectOpenDialogIds(this._document?.root);
    let dialogJustOpened = false;
    for (const id of currentOpenDialogs) {
      if (!this._previouslyOpenDialogIds.has(id)) {
        dialogJustOpened = true;
        break;
      }
    }
    if (dialogJustOpened) {
      this._buffer.markForceNextRender();
      logger.debug('Dialog opened, marking for full diff');
    }
    // Update tracking for next frame
    this._previouslyOpenDialogIds = currentOpenDialogs;

    // Clear buffer
    const clearStartTime = performance.now();
    this._buffer.clear();
    if (this._renderCount <= 3) {
      logger.debug(`Buffer cleared in ${(performance.now() - clearStartTime).toFixed(2)}ms`);
    }

    // Render UI to buffer
    const viewport = {
      x: 0,
      y: 0,
      width: this._terminalSizeManager.size.width,
      height: this._terminalSizeManager.size.height,
    };

    const renderToBufferStartTime = performance.now();

    const layoutTree = this._renderer.render(this._document.root, this._buffer, viewport, this._document.focusedElement?.id, this._textSelectionHandler.getTextSelection(), this._textSelectionHandler.getHoveredElementId() || undefined, () => this.render());
    const layoutAndRenderTime = performance.now() - renderToBufferStartTime;
    this._lastLayoutTime = layoutAndRenderTime;
    this._layoutNodeCount = this._countLayoutNodes(layoutTree);

    // Record layout time for performance dialog averaging
    getGlobalPerformanceDialog().recordLayoutTime(layoutAndRenderTime);

    if (this._renderCount <= 3) {
      logger.info(`Rendered to buffer in ${layoutAndRenderTime.toFixed(2)}ms`);
    }

    // Automatically detect and register focusable elements
    this._focusNavigationHandler.autoRegisterFocusableElements();

    // Render buffer overlays (stats, errors, tooltips, toasts, performance dialog)
    renderBufferOverlays(this._buffer, {
      lastRenderTime: this._lastRenderTime,
      lastLayoutTime: this._lastLayoutTime,
      layoutNodeCount: this._layoutNodeCount,
      renderCount: this._renderCount,
    });

    // Use optimized differential rendering instead of full clear+redraw
    const applyStartTime = performance.now();
    this._renderOptimized();
    getGlobalPerformanceDialog().markApplyEnd();
    if (this._renderCount <= 3) {
      logger.info(`Applied to terminal in ${(performance.now() - applyStartTime).toFixed(2)}ms`);
    }

    const totalRenderTime = performance.now() - renderStartTime;
    this._lastRenderTime = totalRenderTime;

    // Record render time for performance dialog averaging
    getGlobalPerformanceDialog().recordRenderTime(totalRenderTime);
    getGlobalPerformanceDialog().recordInputLatency(); // Record input-to-render latency if input was pending

    if (this._renderCount <= 3 || totalRenderTime > 50) {
      logger.info(`Total render time: ${totalRenderTime.toFixed(2)}ms for render #${this._renderCount}`);
    }

    if (totalRenderTime > 50) {
      logger.warn(`Slow render detected: ${totalRenderTime.toFixed(2)}ms for render #${this._renderCount}`);
    }

    // Trigger debounced state persistence (if enabled)
    this._persistenceManager.triggerDebouncedSave();

    // Update focus traps for modal dialogs
    updateModalFocusTraps(this._getModalFocusTrapContext());
    } finally {
      this._releaseRenderLock();
    }
  }

  /**
   * Fast render for dialog drag/resize - only updates dialog overlay, preserves background
   */
  renderDialogOnly(): void {
    if (!this._acquireRenderLock()) return;

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
        const output = this._ansiOutput.generateOptimizedOutput(differences as BufferDifference[], this._terminalSizeManager.size.width);
        if (output.length > 0) {
          const finalOutput = this._options.synchronizedOutput
            ? ANSI.beginSync + output + ANSI.endSync
            : output;
          this._writeAllSync(textEncoder.encode(finalOutput));
        }
      }

      const totalTime = performance.now() - renderStartTime;
      if (totalTime > 30) {
        logger.debug(`Dialog-only render: ${totalTime.toFixed(2)}ms`);
      }
    } finally {
      this._releaseRenderLock();
    }
  }

  /**
   * Mark the next render() call to do a full diff instead of dirty-row optimization.
   * This is useful when opening dialogs or making changes that dirty tracking might miss.
   * Unlike forceRender(), this doesn't render immediately - it just marks the next render.
   */
  requestForceRender(): void {
    this._buffer.markForceNextRender();
  }

  /**
   * Force a complete redraw of the terminal
   */
  forceRender(): void {
    if (!this._acquireRenderLock()) return;

    try {
    this._renderCount++;

    // Clear buffer
    this._buffer.clear();

    // Render UI to buffer
    const viewport = {
      x: 0,
      y: 0,
      width: this._terminalSizeManager.size.width,
      height: this._terminalSizeManager.size.height,
    };

    this._renderer.render(this._document.root, this._buffer, viewport, this._document.focusedElement?.id, this._textSelectionHandler.getTextSelection(), this._textSelectionHandler.getHoveredElementId() || undefined, () => this.render());

    // Render buffer overlays (stats, errors, tooltips, toasts, performance dialog)
    renderBufferOverlays(this._buffer, {
      lastRenderTime: this._lastRenderTime,
      lastLayoutTime: this._lastLayoutTime,
      layoutNodeCount: this._layoutNodeCount,
      renderCount: this._renderCount,
    });

    // Automatically detect and register focusable elements
    // Pass true to skip the auto-render since we'll do a full screen redraw
    this._focusNavigationHandler.autoRegisterFocusableElements(true);

    // Force complete redraw
    this._renderFullScreen();

    // Update focus traps for modal dialogs
    updateModalFocusTraps(this._getModalFocusTrapContext());
    } finally {
      this._releaseRenderLock();
    }
  }

  /**
   * Set the terminal window title
   */
  setTitle(title: string): void {
    // Skip setting title in stdout mode - no terminal control
    if (isStdoutEnabled()) {
      return;
    }
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
   * @param sourceUrl - Source URL for remote apps (for "samesite" net permission)
   * @param systemInfo - System info for debug tab
   * @param helpContent - Help text content (markdown)
   */
  setSource(content: string, filePath: string, type: 'md' | 'melker' | 'mmd', convertedContent?: string, policy?: MelkerPolicy, appDir?: string, sourceUrl?: string, systemInfo?: SystemInfo, helpContent?: string): void {
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
          this._dialogCoordinator.ensureAccessibilityDialogManager();
          this._dialogCoordinator.accessibilityDialogManager!.show();
        },
        exit: () => {
          this.stop().then(() => {
            if (typeof Deno !== 'undefined') {
              Deno.exit(0);
            }
          }).catch((err) => logger.error('Error during exit', err instanceof Error ? err : new Error(String(err))));
        },
        getServerUrl: () => this._server?.connectionUrl,
      });
    }
    this._devToolsManager.setSource(content, filePath, type, convertedContent, policy, appDir, sourceUrl, systemInfo, helpContent);
  }

  /**
   * Show an alert dialog with the given message
   * This is the melker equivalent of window.alert()
   */
  showAlert(message: string): void {
    this._dialogCoordinator.showAlert(message);
  }

  /**
   * Show a confirm dialog with the given message
   * This is the melker equivalent of window.confirm()
   * Returns a Promise that resolves to true (OK) or false (Cancel)
   */
  showConfirm(message: string): Promise<boolean> {
    return this._dialogCoordinator.showConfirm(message);
  }

  /**
   * Show a prompt dialog with the given message
   * This is the melker equivalent of window.prompt()
   * Returns a Promise that resolves to the input value or null if cancelled
   */
  showPrompt(message: string, defaultValue?: string): Promise<string | null> {
    return this._dialogCoordinator.showPrompt(message, defaultValue);
  }

  /**
   * Write all bytes to stdout, handling partial writes.
   * Logs a warning if partial writes occur (indicates system contention).
   */
  private _writeAllSync(data: Uint8Array): void {
    // Skip terminal writes in stdout mode - buffer will be output at end
    if (isStdoutEnabled()) {
      return;
    }

    // In headless mode, route output to virtual terminal instead of real stdout
    if (this._headlessManager) {
      this._headlessManager.terminal.writeOutput(textDecoder.decode(data));
      return;
    }

    let written = 0;
    while (written < data.length) {
      const n = Deno.stdout.writeSync(data.subarray(written));
      if (n === 0) {
        // Should not happen with sync write, but guard against infinite loop
        logger.error('writeSync returned 0 bytes', undefined, { total: data.length, written });
        break;
      }
      written += n;
      if (written < data.length) {
        // Partial write occurred - handled by loop, log for diagnostics
        logger.debug('Partial stdout write', {
          written,
          total: data.length,
          remaining: data.length - written,
        });
      }
    }
  }

  /**
   * Optimized rendering that only updates changed parts of the terminal
   */
  private _renderOptimized(): void {
    if (typeof Deno !== 'undefined') {
      // Konsole workaround: force full redraw when scrolling with sixel visible
      const needsForceRedraw = this._graphicsOverlayManager.handleKonsoleWorkaround();

      const differences = needsForceRedraw
        ? this._buffer.forceRedraw()
        : this._buffer.swapAndGetDiff();

      // Only render buffer if there are actual changes
      if (differences.length === 0) {
        // Still render graphics overlays (content may have changed even if buffer hasn't)
        this._graphicsOverlayManager.renderOverlays();
        // Notify server clients
        this._server?.notifyRenderComplete();
        return;
      }

      const output = this._ansiOutput.generateOptimizedOutput(differences as BufferDifference[], this._terminalSizeManager.size.width);
      if (output.length > 0) {
        // Guard against writes after terminal cleanup (race condition with stop())
        if (!this._isInitialized) {
          return;
        }

        // If overlays are visible, clear graphics BEFORE outputting buffer
        // This ensures the dropdown/dialog is visible immediately without graphics interference
        if (this._renderer?.hasVisibleOverlays()) {
          this._graphicsOverlayManager.clearAllGraphics();
        }

        // Begin synchronized output to reduce flicker
        const finalOutput = this._options.synchronizedOutput
          ? ANSI.beginSync + output + ANSI.endSync
          : output;

        this._writeAllSync(textEncoder.encode(finalOutput));
      }

      // Render graphics overlays after buffer output
      this._graphicsOverlayManager.renderOverlays();

      // Notify server clients of render completion
      this._server?.notifyRenderComplete();
    }
  }

  /**
   * Fast render path for immediate visual feedback (e.g., typing in inputs)
   * Accepts pre-computed diffs directly — no buffer copy or diff scan needed.
   */
  private _renderFastPath(differences: BufferDiff[]): void {
    if (typeof Deno !== 'undefined') {
      const output = this._ansiOutput.generateOptimizedOutput(differences as BufferDifference[], this._terminalSizeManager.size.width);
      if (output.length > 0) {
        if (!this._isInitialized) {
          return;
        }

        const finalOutput = this._options.synchronizedOutput
          ? ANSI.beginSync + output + ANSI.endSync
          : output;

        this._writeAllSync(textEncoder.encode(finalOutput));
      }
    }
  }

  /**
   * Full screen rendering for initial draw or when forced
   */
  private _renderFullScreen(): void {
    if (typeof Deno !== 'undefined') {
      // If overlays are visible, clear graphics BEFORE full screen redraw
      if (this._renderer?.hasVisibleOverlays()) {
        this._graphicsOverlayManager.clearAllGraphics();
      }

      // Begin synchronized output for full screen redraw
      let clearAndDrawOutput = ANSI.clearScreen + ANSI.cursorHome;

      // Get all buffer content
      const differences = this._buffer.forceRedraw();
      const output = this._ansiOutput.generateOptimizedOutput(differences as BufferDifference[], this._terminalSizeManager.size.width);

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

      this._writeAllSync(textEncoder.encode(finalOutput));

      // Render graphics overlays after buffer output
      this._graphicsOverlayManager.renderOverlays();

      // Notify server clients of render completion
      this._server?.notifyRenderComplete();
    }
  }

  /**
   * Stop the engine and cleanup
   */
  async stop(): Promise<void> {
    logger.info('MelkerEngine stopping', {
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

    // Stop UI animation manager
    shutdownUIAnimationManager();

    // Stop all video elements (kills ffmpeg/ffplay processes)
    try {
      const videoElements = this._document.getElementsByType('video');
      for (const el of videoElements) {
        if ('stopVideo' in el && typeof el.stopVideo === 'function') {
          await el.stopVideo();
        }
      }
    } catch (error) {
      logger.warn('Error stopping video elements', { error: String(error) });
    }

    // Stop event system with error handling
    if (this._inputProcessor) {
      try {
        await this._inputProcessor.stopListening();
      } catch (error) {
        logger.warn('Error stopping input processor', { error: String(error) });
      }
    }

    // Stop resize handling with error handling
    if (this._resizeHandler) {
      try {
        this._resizeHandler.stopListening();
      } catch (error) {
        logger.warn('Error stopping resize handler', { error: String(error) });
      }
    }

    // Stop server with error handling
    if (this._server) {
      try {
        // Clear global instance before stopping
        setGlobalServer(undefined);
        await this._server.stop();
      } catch (error) {
        logger.warn('Error stopping server', { error: String(error) });
      }
    }

    // Stop headless mode with error handling
    if (this._headlessManager) {
      try {
        this._headlessManager.stop();
      } catch (error) {
        logger.warn('Error stopping headless mode', { error: String(error) });
      }
    }

    // Always cleanup terminal - this is the most critical part
    try {
      this.cleanupTerminal();
    } catch (error) {
      logger.error('Critical error during terminal cleanup', error instanceof Error ? error : new Error(String(error)));
      // Still try basic cleanup using emergency function
      emergencyCleanupTerminal();
    }

    // Log final message and close logger
    try {
      logger.info('MelkerEngine stopped successfully', {
        renderCount: this._renderCount,
      });

      // Use a timeout for logger close to prevent hanging
      const closeTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Logger close timeout')), 500)
      );

      await Promise.race([
        logger.close(),
        closeTimeout
      ]);
    } catch {
      // Even if logger close fails, we should continue cleanup
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
      this._rootElement.props.width = this._terminalSizeManager.size.width;
    }
    if (!this._rootElement.props.height && !style.height) {
      this._rootElement.props.height = this._terminalSizeManager.size.height;
    }

    // Inject system commands into all command palettes (opt-out with system={false})
    const ctx = this._getSystemPaletteContext();
    injectSystemCommands(ctx);

    // Inject default system command palette if no custom one exists
    injectSystemCommandPalette(ctx);

    // Build palette shortcut map so keyboard shortcuts work immediately
    // (palette injection happens lazily when Ctrl+K opens the palette)
    rebuildPaletteShortcuts(ctx);

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
    return { ...this._terminalSizeManager.size };
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

    // Absolute file path (Unix) - convert to file:// URL
    // Don't let these be resolved against http:// base URLs
    if (url.startsWith('/')) {
      return `file://${url}`;
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
    if (!container || !isScrollingEnabled(container)) {
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
   * Get sixel graphics capabilities (or undefined if not detected)
   */
  get sixelCapabilities(): SixelCapabilities | undefined {
    return this._graphicsOverlayManager.sixelCapabilities;
  }

  /**
   * Check if sixel graphics are available
   */
  get isSixelAvailable(): boolean {
    return this._graphicsOverlayManager.sixelCapabilities?.supported ?? false;
  }

  /**
   * Get kitty graphics capabilities (or undefined if not detected)
   */
  get kittyCapabilities(): KittyCapabilities | undefined {
    return this._graphicsOverlayManager.kittyCapabilities;
  }

  /**
   * Check if kitty graphics are available
   */
  get isKittyAvailable(): boolean {
    return this._graphicsOverlayManager.kittyCapabilities?.supported ?? false;
  }

  /**
   * Get iTerm2 graphics capabilities (or undefined if not detected)
   */
  get itermCapabilities(): ITermCapabilities | undefined {
    return this._graphicsOverlayManager.itermCapabilities;
  }

  /**
   * Check if iTerm2 graphics are available
   */
  get isITermAvailable(): boolean {
    return this._graphicsOverlayManager.itermCapabilities?.supported ?? false;
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
    return { ...this._terminalSizeManager.size };
  }

  /**
   * Register a custom resize handler
   */
  onResize(handler: (event: { previousSize: { width: number; height: number }, newSize: { width: number; height: number }, timestamp: number }) => void): void {
    this._terminalSizeManager.addResizeHandler(handler);
  }

  /**
   * Register a handler to be called when the engine is fully mounted and ready
   * Handlers can be sync or async - async errors will be caught and reported
   */
  onMount(handler: () => void | Promise<void>): void {
    this._mountHandlers.push(handler);
  }

  /**
   * Register a handler called on Ctrl+C before exiting.
   * If any handler returns false, the exit is cancelled.
   * A second Ctrl+C within 3 seconds force-exits regardless.
   * Returns an unsubscribe function.
   */
  onBeforeExit(handler: () => boolean | Promise<boolean>): () => void {
    this._beforeExitHandlers.push(handler);
    return () => {
      const idx = this._beforeExitHandlers.indexOf(handler);
      if (idx >= 0) this._beforeExitHandlers.splice(idx, 1);
    };
  }

  /**
   * Call all registered before-exit handlers.
   * Returns true if exit should proceed, false if any handler cancelled it.
   */
  async _callBeforeExitHandlers(): Promise<boolean> {
    if (this._beforeExitHandlers.length === 0) return true;
    for (const handler of this._beforeExitHandlers) {
      const result = await handler();
      if (result === false) return false;
    }
    return true;
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
            const err = ensureError(error);
            logger.error('Error in async mount handler', err);
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
        const err = ensureError(error);
        logger.error('Error in mount handler', err);
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
   * Get server instance (if enabled)
   */
  get server(): MelkerServer | undefined {
    return this._server;
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
   * Dispatch a named custom event (for debugging/testing/remote control)
   * @param name - The name of the custom event
   * @param detail - Optional data payload for the event
   */
  dispatchNamedEvent(name: string, detail?: unknown): void {
    if (this._eventManager) {
      this._eventManager.dispatchEvent({
        type: 'custom',
        name,
        detail,
        timestamp: Date.now(),
      });
    }

    // Also dispatch to document-level listeners
    if (this._document) {
      this._document.dispatchEvent({
        type: 'custom',
        name,
        detail,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get the computed bounds of an element by ID
   * @param elementId - The ID of the element
   * @returns The bounds {x, y, width, height} or null if not found
   */
  getElementBounds(elementId: string): { x: number; y: number; width: number; height: number } | null {
    if (!this._renderer) return null;
    return this._renderer.findElementBounds(elementId);
  }

  /**
   * Get the element at specific screen coordinates (hit testing)
   * @param x - X coordinate
   * @param y - Y coordinate
   * @returns Element info with id, type, bounds, and props, or null if no element found
   */
  getElementAt(x: number, y: number): { id: string; type: string; bounds: { x: number; y: number; width: number; height: number } | null; props: Record<string, unknown> } | null {
    if (!this._hitTester) return null;

    const element = this._hitTester.hitTest(x, y);
    if (!element || !element.id) return null;

    const bounds = this.getElementBounds(element.id);

    return {
      id: element.id,
      type: element.type,
      bounds,
      props: element.props || {}
    };
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

  private _cleanupHandlersResult?: { removeSigint: () => void };

  private _setupCleanupHandlers(): void {
    this._cleanupHandlersResult = setupCleanupHandlers(
      () => this.stop(),
      () => this.cleanupTerminal(),
      () => this._callBeforeExitHandlers(),
    );
  }

  /**
   * Remove the engine's own SIGINT handler.
   * Used by melker-runner which installs its own SIGINT handler with beforeExit support.
   */
  removeSigintHandler(): void {
    this._cleanupHandlersResult?.removeSigint();
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
   * Get context for system palette operations
   */
  private _getSystemPaletteContext(): SystemPaletteContext {
    return {
      document: this._document,
      systemCommandPalette: this._systemCommandPalette,
      devToolsManager: this._devToolsManager,
      getAccessibilityDialogManager: () => this._dialogCoordinator.accessibilityDialogManager,
      stop: () => this.stop(),
      render: () => this.render(),
      ensureAccessibilityDialogManager: () => this._dialogCoordinator.ensureAccessibilityDialogManager(),
      setSystemCommandPalette: (palette) => { this._systemCommandPalette = palette; },
    };
  }

  /**
   * Get context for modal focus trap operations
   */
  private _getModalFocusTrapContext(): ModalFocusTrapContext {
    return {
      root: this._document?.root,
      trappedModalDialogIds: this._trappedModalDialogIds,
      focusManager: this._focusManager,
    };
  }

  /**
   * Find an open command palette in the element tree
   */
  private _findOpenCommandPalette(): Element | null {
    return findOpenCommandPalette(this._getSystemPaletteContext());
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
   * Get the system command palette (creates one if needed)
   */
  getSystemCommandPalette(): Element | undefined {
    return this._systemCommandPalette;
  }

  /**
   * Toggle the command palette (opens system palette if no custom one exists)
   */
  toggleCommandPalette(): void {
    toggleCommandPaletteHelper(this._getSystemPaletteContext());
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
  const { getThemeManager, initThemes } = await import('./theme.ts');
  await initThemes();
  const themeManager = getThemeManager();
  const currentTheme = themeManager.getCurrentTheme();

  // Apply theme-based defaults if no options provided
  const finalOptions: MelkerEngineOptions = {
    colorSupport: currentTheme.colorSupport,
    theme: themeManager.getCurrentThemeName(),
    ...options // User options override theme defaults
  };

  const engine = new MelkerEngine(rootElement, finalOptions);
  await engine.start();
  return engine;
}