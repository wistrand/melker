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
import { DualBuffer } from './buffer.ts';
import { RenderingEngine, ScrollbarBounds } from './rendering.ts';
import { TerminalRenderer } from './renderer.ts';
import { ResizeHandler } from './resize.ts';
import { Element, TextSelection, Bounds, isClickable, isInteractive, isTextSelectable, ClickEvent } from './types.ts';
import { clampToBounds } from './geometry.ts';
import {
  EventManager,
  type MelkerEvent,
  createKeyPressEvent,
  createMouseEvent,
} from './events.ts';
import {
  FocusManager,
} from './focus.ts';
import {
  ViewSourceManager,
} from './view-source.ts';
import {
  AlertDialogManager,
} from './alert-dialog.ts';
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
  getGlobalErrorOverlay,
} from './error-boundary.ts';
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
  PersistedState,
  PersistenceMapping,
  DEFAULT_PERSISTENCE_MAPPINGS,
  readState,
  hashState,
  saveToFile,
  loadFromFile,
  debounce,
} from './state-persistence.ts';
import {
  setPersistenceContext,
} from './element.ts';

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
}

export class MelkerEngine {
  private _document!: Document;
  private _buffer!: DualBuffer;
  private _renderer!: RenderingEngine;
  private _terminalRenderer!: TerminalRenderer;
  private _ansiOutput!: AnsiOutputGenerator;
  private _hitTester!: HitTester;
  private _scrollHandler!: ScrollHandler;
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
  private _renderCount = 0;
  private _textSelection: TextSelection = {
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    isActive: false,
    mode: 'component',
  };
  private _isSelecting = false;
  private _selectionRenderTimer: number | null = null;
  private _lastSelectionRenderTime = 0; // For throttle pattern
  private _lastClickTime = 0;
  private _lastClickPos = { x: -1, y: -1 };
  private _clickCount = 0;
  private _hoveredElementId: string | null = null;
  private _customResizeHandlers: Array<(event: { previousSize: { width: number; height: number }, newSize: { width: number; height: number }, timestamp: number }) => void> = [];
  private _mountHandlers: Array<() => void> = [];
  private _inputRenderTimer: number | null = null;
  private _inputRenderDelay = 50; // Debounce for rapid input (paste)

  // View Source feature
  private _viewSourceManager?: ViewSourceManager;

  // Alert dialog feature
  private _alertDialogManager?: AlertDialogManager;

  // State persistence
  private _persistenceEnabled = false;
  private _persistenceAppId: string | null = null;
  private _persistenceMappings: PersistenceMapping[] = DEFAULT_PERSISTENCE_MAPPINGS;
  private _lastPersistedHash: string = '';
  private _debouncedSaveState: (() => void) | null = null;
  private _loadedPersistedState: PersistedState | null = null;

  // Selection performance timing stats (aggregated during drag, logged on mouseup)
  private _selectionTimingStats = {
    moveCount: 0,
    hitTestTotal: 0,
    hitTestMax: 0,
    selectionUpdateTotal: 0,
    renderRequestCount: 0,
    renderTotal: 0,
    renderMax: 0,
    startTime: 0,
  };

  constructor(rootElement: Element, options: MelkerEngineOptions = {}) {
    // Check environment variables for terminal setup overrides
    const envAlternateScreen = typeof Deno !== 'undefined'
      ? Deno.env.get('MELKER_NO_ALTERNATE_SCREEN')
      : undefined;

    const envDisableSync = typeof Deno !== 'undefined'
      ? Deno.env.get('MELKER_NO_SYNC')
      : undefined;

    // Determine default base URL (current working directory)
    const cwd = typeof Deno !== 'undefined' ? Deno.cwd() : '';
    const defaultBaseUrl = typeof Deno !== 'undefined'
      ? `file://${cwd}/`  // Add trailing slash for proper URL resolution
      : 'file://';


    // Set defaults
    this._options = {
      alternateScreen: envAlternateScreen !== undefined ? false : true,
      hideCursor: true,
      autoResize: true,
      debounceMs: 100,
      autoRender: true,
      synchronizedOutput: envDisableSync !== undefined ? false : true,  // Enable by default unless disabled
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
      logger: this._logger,
    });
    this._scrollHandler = new ScrollHandler({
      document: this._document,
      renderer: this._renderer,
      autoRender: this._options.autoRender,
      onRender: () => this.render(),
      calculateScrollDimensions: (id) => this.calculateScrollDimensions(id),
    });

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
        console.error('Error in custom resize handler:', error);
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
    // Skip terminal setup in headless mode - let virtual terminal handle it
    if (isRunningHeadless()) {
      return;
    }

    if (typeof Deno !== 'undefined') {
      const codes: string[] = [];

      if (this._options.alternateScreen) {
        codes.push(ANSI.alternateScreen);
      }

      if (this._options.hideCursor) {
        codes.push(ANSI.hideCursor);
      }

      if (codes.length > 0) {
        Deno.stdout.writeSync(new TextEncoder().encode(codes.join('')));
      }
    }
  }

  private _cleanupTerminal(): void {
    if (typeof Deno !== 'undefined') {
      // In headless mode, do minimal terminal cleanup if connected to a real terminal
      if (isRunningHeadless()) {
        try {
          // Check if stdout is a TTY (connected to a real terminal)
          if (Deno.stdout.isTerminal()) {
            // Basic cleanup: restore cursor and normal screen if needed
            const codes: string[] = [];
            if (this._options.alternateScreen) {
              codes.push(ANSI.normalScreen);
            }
            if (this._options.hideCursor) {
              codes.push(ANSI.showCursor);
            }
            if (codes.length > 0) {
              Deno.stdout.writeSync(new TextEncoder().encode(codes.join('')));
            }
          }
        } catch {
          // If isatty() fails, we're probably not in a real terminal, so skip cleanup
        }
        return;
      }

      // Full cleanup for non-headless mode
      const codes: string[] = [];

      if (this._options.alternateScreen) {
        codes.push(ANSI.normalScreen);
      }

      if (this._options.hideCursor) {
        codes.push(ANSI.showCursor);
      }

      if (codes.length > 0) {
        Deno.stdout.writeSync(new TextEncoder().encode(codes.join('')));
      }
    }
  }

  private _setupEventHandlers(): void {
    if (!this._eventManager || !this._document) return;

    // Single keyboard listener that routes to focused elements
    this._eventManager.addGlobalEventListener('keydown', (event: any) => {
      const focusedElement = this._document!.focusedElement;

      // Handle Ctrl+C for graceful exit
      if (event.ctrlKey && event.key === 'c') {
        this.stop().then(() => {
          if (typeof Deno !== 'undefined') {
            Deno.exit(0);
          }
        }).catch(console.error);
        return;
      }

      // Handle Tab key for focus navigation
      if (event.key === 'Tab') {
        this._handleTabNavigation(event.shiftKey);
        return;
      }

      // Handle F10 key for menu bar activation (global)
      if (event.key === 'F10') {
        this._handleMenuBarActivation();
        return;
      }

      // Handle F12 key for View Source (global)
      if (event.key === 'F12') {
        this._viewSourceManager?.toggle();
        return;
      }

      // Handle Escape to close View Source overlay
      if (event.key === 'Escape' && this._viewSourceManager?.isOpen()) {
        this._viewSourceManager.close();
        return;
      }

      // Handle Escape to close Alert dialog
      if (event.key === 'Escape' && this._alertDialogManager?.isOpen()) {
        this._alertDialogManager.close();
        return;
      }

      // Handle Ctrl+M as alternative menu bar activation
      if (event.ctrlKey && event.key === 'm') {
        this._handleMenuBarActivation();
        return;
      }

      // Handle Alt+N || Alt+C for copying selection to clipboard
      if (event.altKey && (event.key === 'n' || event.key === 'c')) {
        this._copySelectionToClipboard();
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
        // Route to text input if it's a text input or textarea element
        if (focusedElement.type === 'input' || focusedElement.type === 'textarea') {
          const textInput = focusedElement as any; // Cast to InputElement or TextareaElement
          if (textInput.handleKeyInput) {
            this._logger?.debug('Key input routed to text input', {
              elementId: focusedElement.id,
              key: event.key,
              ctrlKey: event.ctrlKey,
              altKey: event.altKey,
            });

            const handled = textInput.handleKeyInput(event.key, event.ctrlKey, event.altKey, event.shiftKey);

            // Auto-render if the input changed (debounced for rapid input like paste)
            if (handled && this._options.autoRender) {
              this._debouncedInputRender();
            }
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
        // Handle Enter key on focused menu items
        else if (focusedElement.type === 'menu-item' && event.key === 'Enter') {
          // Trigger click event on the focused menu item
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
        // Handle keyboard navigation for menu components
        else if (focusedElement.type === 'menu-bar' || focusedElement.type === 'menu' || focusedElement.type === 'menu-item') {
          const menuComponent = focusedElement as any;
          if (menuComponent.handleKeyInput) {
            const handled = menuComponent.handleKeyInput(event.key, event.ctrlKey, event.altKey);
            // Auto-render if the menu handled the key
            if (handled && this._options.autoRender) {
              this.render();
            }
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
      this._scrollHandler.handleScrollEvent(event);
    });

    // Text selection handling
    this._eventManager.addGlobalEventListener('mousedown', (event: any) => {
      this._handleMouseDown(event);
    });

    this._eventManager.addGlobalEventListener('mousemove', (event: any) => {
      this._handleMouseMove(event);
    });

    this._eventManager.addGlobalEventListener('mouseup', (event: any) => {
      this._handleMouseUp(event);
    });
  }

  /**
   * Handle mouse down events for text selection and element interaction
   */
  private _handleMouseDown(event: any): void {
    // Reset selection timing stats for new potential drag
    this._selectionTimingStats = {
      moveCount: 0,
      hitTestTotal: 0,
      hitTestMax: 0,
      selectionUpdateTotal: 0,
      renderRequestCount: 0,
      renderTotal: 0,
      renderMax: 0,
      startTime: performance.now(),
    };
    // Reset detailed render stats
    this._renderDetailedStats = {
      renderNodeTotal: 0,
      highlightTotal: 0,
      overlaysTotal: 0,
      modalsTotal: 0,
      terminalOutputTotal: 0,
      bufferClearTotal: 0,
    };
    // Reset throttle timer for fresh drag
    this._lastSelectionRenderTime = 0;

    // Check for scrollbar click before other interactions
    const scrollbarHit = this._scrollHandler.detectScrollbarClick(event.x, event.y);
    if (scrollbarHit && event.button === 0) {
      this._scrollHandler.handleScrollbarClick(scrollbarHit, event.x, event.y);
      return; // Don't process text selection when clicking scrollbar
    }

    // Perform hit testing to find the element at the clicked coordinates
    const targetElement = this._hitTester.hitTest(event.x, event.y);
    const isAltPressed = event.altKey;

    // Dispatch mousedown event to document with target information
    this._document.dispatchEvent({
      type: 'mousedown',
      x: event.x,
      y: event.y,
      button: event.button || 0,
      target: targetElement?.id,
      timestamp: Date.now(),
    });

    if (event.button === 0) { // Left mouse button
      // Track multi-click (double/triple click)
      const now = Date.now();
      const samePosition = Math.abs(event.x - this._lastClickPos.x) <= 1 &&
                          Math.abs(event.y - this._lastClickPos.y) <= 1;
      const quickClick = now - this._lastClickTime < 400;

      if (samePosition && quickClick) {
        this._clickCount = (this._clickCount % 3) + 1;
      } else {
        this._clickCount = 1;
      }
      this._lastClickTime = now;
      this._lastClickPos = { x: event.x, y: event.y };

      // Handle element interactions (focus, button clicks) - but not during Alt+click
      if (targetElement && !isAltPressed) {
        this._handleElementClick(targetElement, event);
      }

      // Alt+click: Global rectangular selection (includes chrome/borders)
      if (isAltPressed) {
        this._clickCount = 1; // Reset click count for alt+click
        this._isSelecting = true;
        this._textSelection = {
          start: { x: event.x, y: event.y },
          end: { x: event.x, y: event.y },
          isActive: false,
          mode: 'global',
        };
      }
      // Normal click on text-selectable component: Component-constrained selection
      else if (targetElement && this._hitTester.isTextSelectableElement(targetElement)) {
        const bounds = this._getSelectionBounds(targetElement);
        if (bounds) {
          const clampedPos = clampToBounds({ x: event.x, y: event.y }, bounds);

          if (this._clickCount === 2) {
            // Double-click: select word
            const wordBounds = this._getWordBoundsAt(clampedPos.x, clampedPos.y, bounds);
            this._isSelecting = false;
            this._textSelection = {
              start: { x: wordBounds.startX, y: clampedPos.y },
              end: { x: wordBounds.endX, y: clampedPos.y },
              isActive: true,
              componentId: targetElement.id,
              componentBounds: bounds,
              mode: 'component',
            };
            // Extract text immediately for double-click
            this._textSelection.selectedText = this._extractSelectedText();
            if (this._options.autoRender) {
              this.render();
            }
          } else if (this._clickCount === 3) {
            // Triple-click: select line
            this._isSelecting = false;
            this._textSelection = {
              start: { x: bounds.x, y: clampedPos.y },
              end: { x: bounds.x + bounds.width - 1, y: clampedPos.y },
              isActive: true,
              componentId: targetElement.id,
              componentBounds: bounds,
              mode: 'component',
            };
            // Extract text immediately for triple-click
            this._textSelection.selectedText = this._extractSelectedText();
            if (this._options.autoRender) {
              this.render();
            }
          } else {
            // Single click: start drag selection
            this._isSelecting = true;
            this._textSelection = {
              start: clampedPos,
              end: clampedPos,
              isActive: false,
              componentId: targetElement.id,
              componentBounds: bounds,
              mode: 'component',
            };
          }
        }
      }
      // Normal click on non-text-selectable, non-interactive element: Clear selection
      else if (!targetElement || !this._hitTester.isInteractiveElement(targetElement)) {
        this._clearSelection();
      }
    }
  }

  /**
   * Get word boundaries at a specific position in the buffer
   */
  private _getWordBoundsAt(x: number, y: number, bounds: Bounds): { startX: number; endX: number } {
    const buffer = this._buffer;
    if (!buffer) return { startX: x, endX: x };

    // Use previousBuffer as it contains the last rendered frame
    // (currentBuffer is cleared after swap)
    const termBuffer = buffer.previousBuffer;

    // Check if character at position is a word character
    const isWordChar = (cx: number): boolean => {
      const cell = termBuffer.getCell(cx, y);
      if (!cell || !cell.char || cell.char === ' ') return false;
      return /[\w\u00C0-\u024F]/.test(cell.char); // Letters, numbers, underscore, accented chars
    };

    // If clicked on non-word char, just select that char
    if (!isWordChar(x)) {
      return { startX: x, endX: x };
    }

    // Find word start
    let startX = x;
    while (startX > bounds.x && isWordChar(startX - 1)) {
      startX--;
    }

    // Find word end
    let endX = x;
    while (endX < bounds.x + bounds.width - 1 && isWordChar(endX + 1)) {
      endX++;
    }

    return { startX, endX };
  }

  /**
   * Handle element clicks (focus, button activation, etc.)
   */
  private _handleElementClick(element: Element, event: any): void {
    this._logger?.debug(`_handleElementClick: element.type=${element.type}, id=${element.id}, at (${event.x}, ${event.y})`);

    // Set focus on clickable elements
    if (this._hitTester.isInteractiveElement(element) && element.id) {
      // Always ensure element is registered before focusing
      try {
        this.registerFocusableElement(element.id);
      } catch (error) {
        // Element might already be registered, that's fine
      }

      // Now focus the element (should always work since we just registered it)
      try {
        this.focusElement(element.id);

        // Auto-render to show focus changes (cursor, highlighting, etc.)
        if (this._options.autoRender) {
          this.render();
        }
      } catch (focusError) {
        // Focus failed even after registration - this shouldn't happen
      }
    }

    // Handle clicks on Clickable elements (button, checkbox, radio, etc.)
    if (isClickable(element)) {
      const clickEvent: ClickEvent = {
        type: 'click',
        target: element,
        position: { x: event.x, y: event.y },
        timestamp: Date.now(),
      };

      const handled = element.handleClick(clickEvent, this._document);

      if (handled && this._options.autoRender) {
        this.render();
      }
    }

    // Handle menu-bar clicks
    if (element.type === 'menu-bar') {
      // Convert global coordinates to menu-bar relative coordinates
      const bounds = this._renderer.getContainerBounds(element.id || '');
      if (bounds && (element as any).handleClick) {
        const relativeX = event.x - bounds.x;
        const relativeY = event.y - bounds.y;
        (element as any).handleClick(relativeX, relativeY);

        // Auto-render to show menu changes
        if (this._options.autoRender) {
          this.render();
        }
      }
    }

    // Handle markdown element clicks (for link detection)
    if (element.type === 'markdown') {
      this._logger?.debug(`Engine: Markdown element clicked at (${event.x}, ${event.y}), hasHandleClick: ${!!(element as any).handleClick}`);
      if ((element as any).handleClick) {
        // Pass absolute coordinates - markdown tracks its own render bounds
        const handled = (element as any).handleClick(event.x, event.y);
        this._logger?.debug(`Engine: Markdown handleClick returned: ${handled}`);
        if (handled && this._options.autoRender) {
          this.render();
        }
      }
    }

    // Handle textarea clicks (position cursor)
    if (element.type === 'textarea') {
      const bounds = this._renderer.getContainerBounds(element.id || '');
      if (bounds && (element as any).handleClick) {
        const relativeX = event.x - bounds.x;
        const relativeY = event.y - bounds.y;
        const handled = (element as any).handleClick(relativeX, relativeY);
        if (handled && this._options.autoRender) {
          this.render();
        }
      }
    }

    // Handle menu-item clicks
    if (element.type === 'menu-item') {
      let handled = false;

      if ((element as any).handleClick) {
        // Use class method if available
        (element as any).handleClick();
        handled = true;
      } else if (typeof element.props.onClick === 'function') {
        // Call onClick handler directly for template-created menu items
        const clickEvent = createMouseEvent(
          'click',
          event.x,
          event.y,
          event.button || 0,
          1,
          element.id
        );
        element.props.onClick(clickEvent);
        handled = true;
      }

      if (handled) {
        // Close the parent menu after clicking a menu item
        this._closeOpenMenus();

        // Auto-render to show any changes
        if (this._options.autoRender) {
          this.render();
        }
      }
    }
  }

  /**
   * Close all open menus
   */
  private _closeOpenMenus(): void {
    const menuBars = this._document.getElementsByType('menu-bar');
    for (const menuBar of menuBars) {
      const getOpenMenu = (menuBar as any).getOpenMenu;
      if (getOpenMenu && typeof getOpenMenu === 'function') {
        const openMenu = getOpenMenu.call(menuBar);
        if (openMenu && openMenu.props.visible) {
          // Call deactivate if available
          if ((menuBar as any)._deactivate) {
            (menuBar as any)._deactivate();
          } else {
            // Manually close menu
            openMenu.props.visible = false;
            if ((menuBar as any)._openMenu) {
              (menuBar as any)._openMenu = null;
            }
            if ((menuBar as any)._isActivated !== undefined) {
              (menuBar as any)._isActivated = false;
            }
          }
        }
      }
    }
  }

  /**
   * Handle mouse move events for text selection
   */
  private _handleMouseMove(event: any): void {
    // Handle scrollbar drag first
    if (this._scrollHandler.isScrollbarDragActive()) {
      this._scrollHandler.handleScrollbarDrag(event.x, event.y);
      return;
    }

    // Track timing during selection drag
    const isTracking = this._isSelecting;
    if (isTracking) {
      this._selectionTimingStats.moveCount++;
    }

    // Perform hit testing to find the element under the mouse
    const hitTestStart = performance.now();
    const hoveredElement = this._hitTester.hitTest(event.x, event.y);
    const hitTestTime = performance.now() - hitTestStart;
    if (isTracking) {
      this._selectionTimingStats.hitTestTotal += hitTestTime;
      this._selectionTimingStats.hitTestMax = Math.max(this._selectionTimingStats.hitTestMax, hitTestTime);
    }

    const hoveredElementId = hoveredElement?.id || null;

    // Check if the hovered element has changed
    if (hoveredElementId !== this._hoveredElementId) {
      // Fire mouseout event for the previously hovered element
      if (this._hoveredElementId) {
        this._eventManager.dispatchEvent({
          type: 'mouseout',
          x: event.x,
          y: event.y,
          button: event.button || 0,
          buttons: 0,
          target: this._hoveredElementId,
          timestamp: Date.now(),
        });
      }

      // Fire mouseover event for the newly hovered element
      if (hoveredElementId) {
        this._eventManager.dispatchEvent({
          type: 'mouseover',
          x: event.x,
          y: event.y,
          button: event.button || 0,
          buttons: 0,
          target: hoveredElementId,
          timestamp: Date.now(),
        });
      }

      this._hoveredElementId = hoveredElementId;

      // Re-render to update hover states
      if (this._options.autoRender) {
        this.render();
      }
    }

    // Dispatch mousemove event to document
    this._document.dispatchEvent({
      type: 'mousemove',
      x: event.x,
      y: event.y,
      button: event.button || 0,
      timestamp: Date.now(),
    });

    if (this._isSelecting) {
      const selectionUpdateStart = performance.now();
      if (this._textSelection.mode === 'global') {
        // Global mode: no clamping
        this._textSelection.end = { x: event.x, y: event.y };
      } else if (this._textSelection.componentBounds) {
        // Component mode: clamp to bounds
        this._textSelection.end = clampToBounds(
          { x: event.x, y: event.y },
          this._textSelection.componentBounds
        );
      }
      this._textSelection.isActive = true;
      this._selectionTimingStats.selectionUpdateTotal += performance.now() - selectionUpdateStart;

      // Throttled selection-only render (skips layout calculation)
      // Guarantees render every 16ms during continuous movement, unlike debounce
      if (this._options.autoRender) {
        this._selectionTimingStats.renderRequestCount++;
        const now = performance.now();
        const timeSinceLastRender = now - this._lastSelectionRenderTime;

        if (timeSinceLastRender >= 16) {
          // Enough time has passed, render immediately
          if (this._selectionRenderTimer !== null) {
            clearTimeout(this._selectionRenderTimer);
            this._selectionRenderTimer = null;
          }
          this._lastSelectionRenderTime = now;
          this._renderSelectionOnly();
        } else if (this._selectionRenderTimer === null) {
          // Schedule trailing-edge render for when throttle window expires
          const delay = 16 - timeSinceLastRender;
          this._selectionRenderTimer = setTimeout(() => {
            this._selectionRenderTimer = null;
            this._lastSelectionRenderTime = performance.now();
            this._renderSelectionOnly();
          }, delay) as unknown as number;
        }
        // If timer already scheduled, let it fire (don't cancel like debounce)
      }
    }
  }

  // Accumulated detailed render timing for logging
  private _renderDetailedStats = {
    renderNodeTotal: 0,
    highlightTotal: 0,
    overlaysTotal: 0,
    modalsTotal: 0,
    terminalOutputTotal: 0,
    bufferClearTotal: 0,
  };

  /**
   * Optimized render for selection updates only - skips layout calculation
   */
  private _renderSelectionOnly(): void {
    if (!this._buffer) return;

    const renderStart = performance.now();

    // Clear the buffer for rendering
    const clearStart = performance.now();
    this._buffer.currentBuffer.clear();
    this._renderDetailedStats.bufferClearTotal += performance.now() - clearStart;

    // Try selection-only render (uses cached layout)
    const success = this._renderer.renderSelectionOnly(
      this._buffer,
      this._textSelection,
      this._document.focusedElement?.id,
      this._hoveredElementId || undefined,
      () => this.render()
    );

    if (!success) {
      // Fallback to full render if no cached layout
      this.render();
      return;
    }

    // Accumulate detailed timing from renderer
    const rt = this._renderer.selectionRenderTiming;
    this._renderDetailedStats.renderNodeTotal += rt.renderNodeTime;
    this._renderDetailedStats.highlightTotal += rt.highlightTime;
    this._renderDetailedStats.overlaysTotal += rt.overlaysTime;
    this._renderDetailedStats.modalsTotal += rt.modalsTime;

    // Apply to terminal
    const terminalStart = performance.now();
    this._renderOptimized();
    this._renderDetailedStats.terminalOutputTotal += performance.now() - terminalStart;

    // Track render timing
    const renderTime = performance.now() - renderStart;
    this._selectionTimingStats.renderTotal += renderTime;
    this._selectionTimingStats.renderMax = Math.max(this._selectionTimingStats.renderMax, renderTime);
  }

  /**
   * Handle mouse up events for text selection and element interaction
   */
  private _handleMouseUp(event: any): void {
    // End scrollbar drag if active
    if (this._scrollHandler.isScrollbarDragActive()) {
      this._scrollHandler.endScrollbarDrag();
      return; // Don't process other mouse up events
    }

    // Perform hit testing to find the element at the release coordinates
    const targetElement = this._hitTester.hitTest(event.x, event.y);

    // Dispatch mouseup event to document with target information
    this._document.dispatchEvent({
      type: 'mouseup',
      x: event.x,
      y: event.y,
      button: event.button || 0,
      target: targetElement?.id,
      timestamp: Date.now(),
    });

    if (event.button === 0 && this._isSelecting) { // Left mouse button
      this._isSelecting = false;

      // Cancel any pending debounced render
      if (this._selectionRenderTimer !== null) {
        clearTimeout(this._selectionRenderTimer);
        this._selectionRenderTimer = null;
      }

      // If we have a valid selection, keep it active and extract final text
      if (this._textSelection.isActive) {
        this._textSelection.selectedText = this._extractSelectedText();
      } else {
        // No selection made, clear it
        this._clearSelection();
      }

      // Log selection timing stats if there was actual selection drag
      const stats = this._selectionTimingStats;
      const detailed = this._renderDetailedStats;
      if (stats.moveCount > 0) {
        const totalTime = performance.now() - stats.startTime;
        const renderCount = stats.renderTotal > 0 ? Math.round(stats.renderTotal / stats.renderMax) : 0;
        this._logger?.info('Selection drag timing stats:', {
          totalDragTime: `${totalTime.toFixed(1)}ms`,
          mouseMoveEvents: stats.moveCount,
          hitTest: {
            total: `${stats.hitTestTotal.toFixed(2)}ms`,
            avg: `${(stats.hitTestTotal / stats.moveCount).toFixed(2)}ms`,
            max: `${stats.hitTestMax.toFixed(2)}ms`,
          },
          selectionUpdate: {
            total: `${stats.selectionUpdateTotal.toFixed(2)}ms`,
            avg: `${(stats.selectionUpdateTotal / stats.moveCount).toFixed(2)}ms`,
          },
          render: {
            requestCount: stats.renderRequestCount,
            actualRenders: renderCount,
            totalTime: `${stats.renderTotal.toFixed(2)}ms`,
            maxSingle: `${stats.renderMax.toFixed(2)}ms`,
          },
          renderBreakdown: {
            bufferClear: `${detailed.bufferClearTotal.toFixed(2)}ms`,
            renderNode: `${detailed.renderNodeTotal.toFixed(2)}ms`,
            highlight: `${detailed.highlightTotal.toFixed(2)}ms`,
            overlays: `${detailed.overlaysTotal.toFixed(2)}ms`,
            modals: `${detailed.modalsTotal.toFixed(2)}ms`,
            terminalOutput: `${detailed.terminalOutputTotal.toFixed(2)}ms`,
          },
        });
      }

      // Re-render immediately to finalize selection state
      if (this._options.autoRender) {
        this.render();
      }
    }
  }

  /**
   * Clear the current text selection
   */
  private _clearSelection(): void {
    this._textSelection = {
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      isActive: false,
      mode: 'component',
    };
    this._isSelecting = false;
  }

  /**
   * Get selection bounds for an element, accounting for scrollable parent containers
   */
  private _getSelectionBounds(element: Element): Bounds | undefined {
    const elementBounds = this._renderer.getContainerBounds(element.id || '');
    if (!elementBounds) return undefined;

    // Find scrollable parent and constrain bounds
    const scrollableParent = this._scrollHandler.findScrollableParent(element);
    if (scrollableParent) {
      const parentBounds = this._renderer.getContainerBounds(scrollableParent.id || '');
      if (parentBounds) {
        // Constrain element bounds to scrollable parent bounds
        const constrainedRight = Math.min(
          elementBounds.x + elementBounds.width,
          parentBounds.x + parentBounds.width
        );
        return {
          x: elementBounds.x,
          y: elementBounds.y,
          width: Math.max(1, constrainedRight - elementBounds.x),
          height: elementBounds.height,
        };
      }
    }

    return elementBounds;
  }

  /**
   * Copy the current selection to system clipboard
   * Supports Linux (X11/Wayland), macOS, and WSL2
   */
  private _copySelectionToClipboard(): void {
    if (!this._textSelection.isActive || !this._textSelection.selectedText) {
      return;
    }

    const text = this._textSelection.selectedText;
    if (typeof Deno === 'undefined') return;

    // Platform-specific clipboard commands
    const commands = [
      // macOS
      { cmd: 'pbcopy', args: [] },
      // Linux X11
      { cmd: 'xclip', args: ['-selection', 'clipboard'] },
      { cmd: 'xsel', args: ['--clipboard', '--input'] },
      // Linux Wayland
      { cmd: 'wl-copy', args: [] },
      // WSL2 (Windows clipboard)
      { cmd: 'clip.exe', args: [] },
    ];

    // Try each command asynchronously
    this._tryClipboardCommands(commands, text);
  }

  private async _tryClipboardCommands(
    commands: Array<{ cmd: string; args: string[] }>,
    text: string
  ): Promise<void> {
    for (const { cmd, args } of commands) {
      try {
        const process = new Deno.Command(cmd, {
          args,
          stdin: 'piped',
          stdout: 'null',
          stderr: 'null',
        });
        const child = process.spawn();
        const writer = child.stdin.getWriter();
        await writer.write(new TextEncoder().encode(text));
        await writer.close();
        const status = await child.status;
        if (status.success) {
          return; // Success
        }
      } catch {
        // Command not found or failed, try next
      }
    }
    this._logger?.warn('No clipboard command available (tried pbcopy, xclip, xsel, wl-copy, clip.exe)');
  }

  /**
   * Extract text from the selected area
   */
  private _extractSelectedText(): string {
    if (!this._buffer || !this._textSelection.isActive) {
      return '';
    }
    // Extract text from the displayed buffer (previousBuffer contains last rendered frame)
    return this._renderer.extractSelectionText(this._textSelection, this._buffer);
  }

  /**
   * Get current text selection (for external access)
   */
  getTextSelection(): TextSelection {
    return { ...this._textSelection };
  }

  /**
   * Get the ID of the currently hovered element
   */
  getHoveredElementId(): string | null {
    return this._hoveredElementId;
  }

  /**
   * Automatically detect and register focusable elements
   */
  private _autoRegisterFocusableElements(skipAutoRender = false): void {
    if (!this._document) return;

    const focusableElements = this._findFocusableElements(this._document.root);

    // Debug logging for focus registration
    this._logger?.debug('Auto-registering focusable elements', {
      totalElements: focusableElements.length,
      elementTypes: focusableElements.map(el => ({ type: el.type, id: el.id || 'no-id' })),
    });

    // Register all elements first
    for (const element of focusableElements) {
      if (element.id) {
        try {
          this.registerFocusableElement(element.id);
          this._logger?.debug(`Successfully registered focusable element: ${element.id}`);
        } catch (error) {
          this._logger?.warn(`Failed to register focusable element: ${element.id} - ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Only auto-focus if NO element is focused and we have focusable elements
    if (!this._document.focusedElement && focusableElements.length > 0) {
      const firstFocusable = focusableElements[0];
      if (firstFocusable?.id) {
        try {
          this.focusElement(firstFocusable.id);
          // Auto-render to show initial focus state (unless skipped)
          if (this._options.autoRender && !skipAutoRender) {
            this.render();
          }
        } catch (error) {
          // Focus failed, ignore
        }
      }
    }
  }

  /**
   * Find all focusable elements in the element tree
   */
  private _findFocusableElements(element: Element): Element[] {
    const focusableElements: Element[] = [];

    // Debug logging for element inspection
    if (element.type === 'button') {
      this._logger?.debug('Found button element during focus detection', {
        type: element.type,
        id: element.id || 'no-id',
        hasCanReceiveFocus: !!(element as any).canReceiveFocus,
        isInteractive: this._hitTester.isInteractiveElement(element),
        disabled: element.props.disabled,
      });
    }

    // Check if element can receive focus using the Focusable interface
    if ((element as any).canReceiveFocus && typeof (element as any).canReceiveFocus === 'function') {
      try {
        if ((element as any).canReceiveFocus()) {
          focusableElements.push(element);
        }
      } catch (error) {
        // Fallback: element might not properly implement canReceiveFocus
        console.error(`Error checking focus capability for element ${element.type}:`, error);
      }
    } else if (this._hitTester.isInteractiveElement(element) && element.id) {
      // Fallback for interactive elements without canReceiveFocus method
      // Only include if element has an ID and is not disabled
      if (!element.props.disabled) {
        this._logger?.debug('Adding interactive element to focusable list', {
          type: element.type,
          id: element.id,
        });
        focusableElements.push(element);
      }
    }

    if (element.children) {
      for (const child of element.children) {
        focusableElements.push(...this._findFocusableElements(child));
      }
    }

    return focusableElements;
  }

  /**
   * Handle Alt key for menu bar activation
   */
  private _handleMenuBarActivation(): void {
    if (!this._document) return;

    // Find the first menu bar in the document
    const menuBar = this._findMenuBarElement(this._document.root);
    if (!menuBar) return;

    // Toggle menu bar activation
    if (menuBar.handleKeyInput && menuBar.handleKeyInput('F10')) {
      // Focus the menu bar when activated
      this._document.focus(menuBar.id);

      // Auto-render to show activation state
      if (this._options.autoRender) {
        this.render();
      }
    }
  }

  /**
   * Register an element and all its children with the document
   */
  private _registerElementTree(element: Element): void {
    this._document.addElement(element);
    if (element.children) {
      for (const child of element.children) {
        this._registerElementTree(child);
      }
    }
  }

  /**
   * Find menu bar element in the document tree
   */
  private _findMenuBarElement(element: any): any {
    if (element.type === 'menu-bar') {
      return element;
    }

    if (element.children) {
      for (const child of element.children) {
        // Handle double-nested arrays (container children issue)
        if (Array.isArray(child)) {
          for (const arrayItem of child) {
            const found = this._findMenuBarElement(arrayItem);
            if (found) return found;
          }
        } else {
          const found = this._findMenuBarElement(child);
          if (found) return found;
        }
      }
    }

    return null;
  }

  /**
   * Handle Tab key navigation between focusable elements
   */
  private _handleTabNavigation(reverse: boolean = false): void {
    if (!this._focusManager) return;

    // Use the focus manager's proper tab navigation
    const success = reverse ? this._focusManager.focusPrevious() : this._focusManager.focusNext();

    if (success) {
      // Auto-render to show focus change
      if (this._options.autoRender) {
        this.render();
      }
    } else {
      // If focus manager navigation failed, try to focus first element as fallback
      this._focusManager.focusFirst();

      if (this._options.autoRender) {
        this.render();
      }
    }
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

    // Log engine startup
    this._logger?.info('MelkerEngine starting', {
      terminalSize: this._currentSize,
      options: this._options,
      rootElementType: this._rootElement.type,
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

    // Initial render - use force render for first display to ensure clean state
    if (this._options.autoRender) {
      this.forceRender();
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

    this._isInitialized = true;

    // Log successful initialization
    this._logger?.info('MelkerEngine started successfully', {
      renderCount: this._renderCount,
      focusableElements: this._findFocusableElements(this._document.root).length,
    });
  }

  /**
   * Debounced render for rapid input events (e.g., paste operations)
   * Batches multiple rapid input changes into a single render
   */
  private _debouncedInputRender(): void {
    if (this._inputRenderTimer !== null) {
      clearTimeout(this._inputRenderTimer);
    }
    this._inputRenderTimer = setTimeout(() => {
      this._inputRenderTimer = null;
      this.render();
    }, this._inputRenderDelay) as unknown as number;
  }

  /**
   * Manually trigger a render
   */
  render(): void {
    const renderStartTime = performance.now();
    this._renderCount++;

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
    this._renderer.render(this._document.root, this._buffer, viewport, this._document.focusedElement?.id, this._textSelection, this._hoveredElementId || undefined, () => this.render());
    if (this._renderCount <= 3) {
      this._logger?.info(`Rendered to buffer in ${(performance.now() - renderToBufferStartTime).toFixed(2)}ms`);
    }

    // Automatically detect and register focusable elements
    this._autoRegisterFocusableElements();

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

    // Use optimized differential rendering instead of full clear+redraw
    const applyStartTime = performance.now();
    this._renderOptimized();
    if (this._renderCount <= 3) {
      this._logger?.info(`Applied to terminal in ${(performance.now() - applyStartTime).toFixed(2)}ms`);
    }

    const totalRenderTime = performance.now() - renderStartTime;
    if (this._renderCount <= 3 || totalRenderTime > 50) {
      this._logger?.info(`Total render time: ${totalRenderTime.toFixed(2)}ms for render #${this._renderCount}`);
    }

    if (totalRenderTime > 50) {
      this._logger?.warn(`Slow render detected: ${totalRenderTime.toFixed(2)}ms for render #${this._renderCount}`);
    }

    // Trigger debounced state persistence (if enabled)
    if (this._debouncedSaveState) {
      this._debouncedSaveState();
    }
  }

  /**
   * Force a complete redraw of the terminal
   */
  forceRender(): void {
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

    this._renderer.render(this._document.root, this._buffer, viewport, this._document.focusedElement?.id, this._textSelection, this._hoveredElementId || undefined, () => this.render());

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

    // Automatically detect and register focusable elements
    // Pass false to skip the auto-render since we'll do a full screen redraw
    this._autoRegisterFocusableElements(true);

    // Force complete redraw
    this._renderFullScreen();
  }

  /**
   * Set the terminal window title
   */
  setTitle(title: string): void {
    this._terminalRenderer.setTitle(title);
  }

  /**
   * Set source content for View Source feature (F12)
   */
  setSource(content: string, filePath: string, type: 'md' | 'melker'): void {
    if (!this._viewSourceManager) {
      this._viewSourceManager = new ViewSourceManager({
        document: this._document,
        focusManager: this._focusManager,
        registerElementTree: (element) => this._registerElementTree(element),
        render: () => this.render(),
        forceRender: () => this.forceRender(),
        autoRender: this._options.autoRender,
      });
    }
    this._viewSourceManager.setSource(content, filePath, type);
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
        registerElementTree: (element) => this._registerElementTree(element),
        render: () => this.render(),
        forceRender: () => this.forceRender(),
        autoRender: this._options.autoRender,
      });
    }
    this._alertDialogManager.show(message);
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
      this._cleanupTerminal();
      return;
    }

    // Set flag early to prevent double cleanup
    this._isInitialized = false;

    // Save state immediately before cleanup (don't wait for debounce)
    if (this._persistenceEnabled) {
      try {
        await this._saveStateIfChanged();
      } catch (error) {
        this._logger?.warn('Failed to save state on exit', { error });
      }
    }

    // Clear any pending input render timer
    if (this._inputRenderTimer !== null) {
      clearTimeout(this._inputRenderTimer);
      this._inputRenderTimer = null;
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
      this._cleanupTerminal();
    } catch (error) {
      console.error('Critical error during terminal cleanup:', error);
      // Still try basic cleanup
      if (typeof Deno !== 'undefined') {
        try {
          Deno.stdout.writeSync(new TextEncoder().encode('\x1b[?1049l\x1b[?25h'));
        } catch {
          // Last resort - at least try to show cursor
          try {
            Deno.stdout.writeSync(new TextEncoder().encode('\x1b[?25h'));
          } catch {}
        }
      }
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
    if (typeof globalThis !== 'undefined' && (globalThis as any)._melkerInstances) {
      (globalThis as any)._melkerInstances.delete(this);
    }
  }

  /**
   * Update the UI by providing a new root element
   */
  updateUI(newRootElement: Element): void {
    this._rootElement = newRootElement;
    this._document.root = newRootElement;

    // Update focus manager document reference after UI update
    if (this._focusManager) {
      this._focusManager.setDocument(this._document);
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
    if (this._persistenceEnabled) {
      this._logger?.warn('Persistence already enabled');
      return;
    }

    this._persistenceAppId = appId;
    this._persistenceMappings = mappings || this._options.persistenceMappings || DEFAULT_PERSISTENCE_MAPPINGS;

    // Load persisted state from file
    try {
      this._loadedPersistedState = await loadFromFile(appId);
      if (this._loadedPersistedState) {
        this._lastPersistedHash = hashState(this._loadedPersistedState);
        this._logger?.info('Loaded persisted state', { appId, hash: this._lastPersistedHash });
      }
    } catch (error) {
      this._logger?.warn('Failed to load persisted state', { appId, error });
    }

    // Set up persistence context for createElement
    setPersistenceContext({
      state: this._loadedPersistedState,
      document: this._document,
      mappings: this._persistenceMappings,
    });

    // Create debounced save function
    this._debouncedSaveState = debounce(
      () => this._saveStateIfChanged(),
      this._options.persistenceDebounceMs
    );

    this._persistenceEnabled = true;
    this._logger?.info('State persistence enabled', { appId });
  }

  /**
   * Save state immediately (bypasses debounce).
   * Useful when you need to ensure state is saved before exit.
   */
  async saveState(): Promise<void> {
    if (!this._persistenceEnabled || !this._persistenceAppId) {
      return;
    }
    await this._saveStateIfChanged();
  }

  /**
   * Internal method to save state if changed
   */
  private async _saveStateIfChanged(): Promise<void> {
    if (!this._persistenceEnabled || !this._persistenceAppId) {
      return;
    }

    try {
      const currentState = readState(this._document, this._persistenceMappings);
      const currentHash = hashState(currentState);

      if (currentHash !== this._lastPersistedHash) {
        await saveToFile(this._persistenceAppId, currentState);
        this._lastPersistedHash = currentHash;
        this._logger?.debug('State persisted', { appId: this._persistenceAppId, hash: currentHash });
      }
    } catch (error) {
      this._logger?.warn('Failed to save state', { error });
    }
  }

  /**
   * Calculate actual scroll dimensions for a scrollable container
   */
  calculateScrollDimensions(containerId: string): { width: number; height: number } | null {
    const container = this._document.getElementById(containerId);
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
      // Add a small buffer (2 lines) to ensure content stays visible
      // This helps when content height calculation is slightly off
      const buffer = 2;
      const maxScroll = Math.max(0, contentDimensions.height - containerHeight - buffer);
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
   */
  onMount(handler: () => void): void {
    this._mountHandlers.push(handler);
  }

  /**
   * Trigger all registered mount handlers
   */
  _triggerMountHandlers(): void {
    for (const handler of this._mountHandlers) {
      try {
        handler();
      } catch (error) {
        console.error('Error in mount handler:', error);
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
      if (event.type === 'mousemove') {
        // Use the existing mousemove handler which includes hover tracking
        this._handleMouseMove({
          x: event.position.x,
          y: event.position.y,
          button: event.button || 0
        });
      } else {
        // Perform hit testing to find the element at the clicked coordinates
        const target = this._hitTester.hitTest(event.position.x, event.position.y);

        this._eventManager.dispatchEvent({
          type: event.type,
          x: event.position.x,
          y: event.position.y,
          button: event.button || 0, // 0 = left button
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
    this._autoRegisterFocusableElements();
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
    const cleanup = async () => {
      try {
        await this.stop();
      } catch (error) {
        // Ensure terminal cleanup even if stop() fails
        this._cleanupTerminal();
        console.error('Error during cleanup:', error);
      }
      if (typeof Deno !== 'undefined') {
        Deno.exit(0);
      }
    };

    const syncCleanup = () => {
      try {
        // Synchronous terminal cleanup for immediate exit scenarios
        this._cleanupTerminal();
      } catch (error) {
        console.error('Error during sync cleanup:', error);
      }
    };

    if (typeof Deno !== 'undefined') {
      // Handle standard signals
      Deno.addSignalListener('SIGINT', cleanup);
      Deno.addSignalListener('SIGTERM', cleanup);

      // Handle additional termination signals
      try {
        Deno.addSignalListener('SIGHUP', cleanup);
        Deno.addSignalListener('SIGQUIT', cleanup);
      } catch {
        // Some signals might not be available on all platforms
      }

      // Handle uncaught exceptions and unhandled rejections
      globalThis.addEventListener('error', (event) => {
        console.error('Uncaught error:', event.error);
        syncCleanup();
        Deno.exit(1);
      });

      globalThis.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', event.reason);
        syncCleanup();
        Deno.exit(1);
      });

      // Handle beforeunload/exit events if available
      try {
        globalThis.addEventListener('beforeunload', syncCleanup);
      } catch {
        // beforeunload might not be available in Deno
      }
    }
  }

  /**
   * Set up emergency cleanup that runs even if the normal cleanup fails
   */
  private _setupEmergencyCleanup(): void {
    // Track this instance globally for emergency cleanup
    if (typeof globalThis !== 'undefined') {
      if (!(globalThis as any)._melkerInstances) {
        (globalThis as any)._melkerInstances = new Set();

        // Set up one-time global cleanup handlers
        if (typeof Deno !== 'undefined') {
          // Emergency cleanup on process exit
          const emergencyCleanup = () => {
            for (const instance of (globalThis as any)._melkerInstances) {
              try {
                if (instance._cleanupTerminal) {
                  instance._cleanupTerminal();
                }
              } catch {
                // Silent fail for emergency cleanup
              }
            }
          };

          // Register emergency cleanup for various exit scenarios
          try {
            // Use Deno's exit handler if available
            Deno.addSignalListener('SIGKILL', emergencyCleanup);
          } catch {}

          // Set up atexit-like behavior using globalThis
          (globalThis as any)._melkerEmergencyCleanup = emergencyCleanup;
        }
      }

      (globalThis as any)._melkerInstances.add(this);
    }
  }

  // Theme management
  getThemeManager(): ThemeManager {
    return this._themeManager;
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