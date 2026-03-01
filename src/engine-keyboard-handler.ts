// Keyboard event handling for MelkerEngine
// Extracted from engine.ts to reduce file size

import { Document } from './document.ts';
import { InputElement } from './components/input.ts';
import { TextareaElement } from './components/textarea.ts';
import { Element, isClickable, ClickEvent, isKeyboardElement, hasKeyPressHandler } from './types.ts';
import { createKeyPressEvent } from './events.ts';
import { getGlobalPerformanceDialog } from './performance-dialog.ts';
import { restoreTerminal } from './terminal-lifecycle.ts';
import { getTooltipManager } from './tooltip/mod.ts';
import { getLogger } from './logging.ts';
import { exit } from './runtime/mod.ts';
import { getPaletteShortcutMap, eventToShortcut, normalizeShortcut, parseCommandKeys } from './command-palette-components.ts';
import { hasElement, isOpenModalDialog } from './utils/tree-traversal.ts';
import { type DualBuffer, DiffCollector, type BufferDiff } from './buffer.ts';

const logger = getLogger('KeyboardHandler');
import type { RenderingEngine } from './rendering.ts';
import type { FocusNavigationHandler } from './focus-navigation-handler.ts';
import type { ScrollHandler } from './scroll-handler.ts';
import type { TextSelectionHandler } from './text-selection-handler.ts';
import type { DevToolsManager } from './dev-tools.ts';
import type { AlertDialogManager } from './alert-dialog.ts';
import type { ConfirmDialogManager } from './confirm-dialog.ts';
import type { PromptDialogManager } from './prompt-dialog.ts';
import type { AccessibilityDialogManager } from './ai/accessibility-dialog.ts';
import type { TerminalInputProcessor } from './input.ts';

/**
 * Raw keyboard event from the input system
 */
export interface RawKeyEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

/**
 * Context providing access to engine dependencies for keyboard handling
 */
export interface KeyboardHandlerContext {
  // Core components
  document: Document;
  buffer?: DualBuffer;
  renderer?: RenderingEngine;
  inputProcessor?: TerminalInputProcessor;

  // Handlers
  focusNavigationHandler: FocusNavigationHandler;
  scrollHandler: ScrollHandler;
  textSelectionHandler: TextSelectionHandler;

  // Dialog managers (optional - may not be initialized)
  devToolsManager?: DevToolsManager;
  alertDialogManager?: AlertDialogManager;
  confirmDialogManager?: ConfirmDialogManager;
  promptDialogManager?: PromptDialogManager;
  getAccessibilityDialogManager: () => AccessibilityDialogManager | undefined;

  // Options
  autoRender: boolean;
  onExit?: () => void | Promise<void>;
  onBeforeExit?: () => Promise<boolean>;

  // Engine methods (callbacks)
  render: () => void;
  stop: () => Promise<void>;
  toggleCommandPalette: () => void;
  findOpenCommandPalette: () => Element | null;
  ensureAccessibilityDialogManager: () => void;
  hasOverlayDialogFor: (element: Element) => boolean;
  debouncedInputRender: () => void;
  renderFastPath: (diffs: BufferDiff[]) => void;
}

/**
 * Handle keyboard events for the engine
 * Returns true if the event was handled and no further processing is needed
 */
export function handleKeyboardEvent(
  event: RawKeyEvent,
  ctx: KeyboardHandlerContext
): boolean {
  // Mark input start time for latency tracking
  getGlobalPerformanceDialog().markInputStart();

  const focusedElement = ctx.document.focusedElement;

  // Log all key events for debugging
  logger.debug('Key event received', {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
  });

  // Hide tooltip on any keyboard event
  const tooltipManager = getTooltipManager();
  if (tooltipManager.isVisible()) {
    tooltipManager.hideTooltip();
  }

  // Handle Ctrl+C for graceful exit
  if (event.ctrlKey && event.key?.toLowerCase() === 'c') {
    handleCtrlC(ctx);
    return true;
  }

  // Handle Tab key for focus navigation
  if (event.key === 'Tab') {
    ctx.focusNavigationHandler.handleTabNavigation(event.shiftKey ?? false);
    return true;
  }

  // Handle F12 key for View Source (global)
  if (event.key === 'F12') {
    ctx.devToolsManager?.toggle();
    return true;
  }

  // Handle F6, F10, F11, Shift+F12, or Ctrl+Shift+P for Performance dialog
  if (event.key === 'F6' || event.key === 'F10' || event.key === 'F11' ||
      (event.shiftKey && event.key === 'F12') ||
      (event.ctrlKey && event.shiftKey && (event.key === 'p' || event.key === 'P'))) {
    getGlobalPerformanceDialog().toggle();
    ctx.render();
    return true;
  }

  // Handle Ctrl+K for Command Palette
  if (event.ctrlKey && (event.key === 'k' || event.key === 'K')) {
    ctx.toggleCommandPalette();
    return true;
  }

  // Handle Escape to close various overlays
  if (event.key === 'Escape') {
    if (handleEscapeKey(ctx)) {
      return true;
    }
  }

  // Handle palette shortcuts (registered via palette-shortcut prop or <command global>)
  const shortcutMap = getPaletteShortcutMap();
  if (shortcutMap.size > 0) {
    const shortcutKey = eventToShortcut(event);
    const shortcutAction = shortcutMap.get(shortcutKey);
    if (shortcutAction && !shouldSuppressGlobalShortcut(focusedElement, event, ctx)) {
      shortcutAction();
      if (ctx.autoRender) ctx.render();
      return true;
    }
  }

  // Arrow keys with no focus: focus the first element (same as Tab)
  // Placed after global shortcuts so global arrow-key commands aren't preempted
  if (!focusedElement && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    ctx.focusNavigationHandler.handleTabNavigation(false);
    return true;
  }

  // Handle open command palettes - they capture all keyboard input when open
  const openCommandPalette = ctx.findOpenCommandPalette() as any;
  if (openCommandPalette) {
    if (handleCommandPaletteInput(event, openCommandPalette, ctx)) {
      return true;
    }
  }

  // Handle F7 specially for voice input
  if (['f7', 'F7'].includes(event.key)) {
    logger.info('F7 pressed - voice input mode');
    ctx.ensureAccessibilityDialogManager();
    const accessibilityManager = ctx.getAccessibilityDialogManager()!;
    // If dialog is open, toggle listening. If closed, open and start listening.
    if (accessibilityManager.isOpen()) {
      accessibilityManager.toggleListen();
    } else {
      accessibilityManager.showAndListen();
    }
    return true;
  }

  // Handle other function keys for AI Accessibility dialog
  if (['f8', 'F8', 'f9', 'F9'].includes(event.key)) {
    logger.info(event.key + ' pressed - opening accessibility dialog');
    ctx.ensureAccessibilityDialogManager();
    ctx.getAccessibilityDialogManager()!.toggle();
    return true;
  }

  // Handle Ctrl+/ or Alt+/ or Ctrl+? or Alt+? for AI Accessibility dialog
  if ((event.ctrlKey || event.altKey) && (['/', '?', 'h', 'H'].includes(event.key))) {
    logger.info('Accessibility shortcut pressed', { key: event.key, ctrlKey: event.ctrlKey, altKey: event.altKey });
    ctx.ensureAccessibilityDialogManager();
    ctx.getAccessibilityDialogManager()!.toggle();
    return true;
  }

  // Handle Alt+N || Alt+C for copying selection to clipboard
  if (event.altKey && (event.key === 'n' || event.key === 'c')) {
    ctx.textSelectionHandler.copySelectionToClipboard();
    return true;
  }

  // Handle focused element keyboard input (components get arrow keys before scroll)
  if (focusedElement) {
    if (handleFocusedElementInput(event, focusedElement, ctx)) {
      return true;
    }
  }

  // Handle arrow keys for scrolling in scrollable containers
  // Shift+Arrow skips scroll and goes straight to geometric focus navigation
  if (!event.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && focusedElement) {
    const scrollableParent = ctx.scrollHandler.findScrollableParent(focusedElement);
    if (scrollableParent && ctx.scrollHandler.handleArrowKeyScroll(event.key, scrollableParent)) {
      return true; // Arrow key was handled by scrolling
    }
  }

  // Geometric focus navigation: move focus to nearest element in arrow direction
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    const dirMap: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    };
    if (ctx.focusNavigationHandler.handleDirectionalNavigation(dirMap[event.key])) {
      return true;
    }
  }

  return false;
}

// State for Ctrl+C double-press: second press within 3s force-exits
let _ctrlCPending = false;
let _ctrlCTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Handle Ctrl+C for graceful exit.
 * If beforeExit handlers are registered:
 *   First press → call handlers; if any returns false, cancel exit.
 *   Second press within 3s → force exit, bypass hooks.
 * If no handlers: exit immediately (original behavior).
 */
function handleCtrlC(ctx: KeyboardHandlerContext): void {
  // If beforeExit hook exists and this is the first press, consult the hook
  if (ctx.onBeforeExit && !_ctrlCPending) {
    _ctrlCPending = true;
    _ctrlCTimer = setTimeout(() => { _ctrlCPending = false; }, 3000);

    ctx.onBeforeExit().then((shouldExit) => {
      if (shouldExit) {
        if (_ctrlCTimer) clearTimeout(_ctrlCTimer);
        _ctrlCPending = false;
        doExit(ctx);
      } else {
        // Hook cancelled exit — reset state so next Ctrl+C goes through the hook again
        if (_ctrlCTimer) clearTimeout(_ctrlCTimer);
        _ctrlCTimer = null;
        _ctrlCPending = false;
      }
    }).catch(() => {
      // Error in hook — exit to be safe
      if (_ctrlCTimer) clearTimeout(_ctrlCTimer);
      _ctrlCPending = false;
      doExit(ctx);
    });
    return;
  }

  // Second press (force-exit) or no beforeExit hook — exit immediately
  if (_ctrlCTimer) clearTimeout(_ctrlCTimer);
  _ctrlCPending = false;
  doExit(ctx);
}

/**
 * Actually perform the exit: restore terminal, stop input, cleanup, and exit.
 */
function doExit(ctx: KeyboardHandlerContext): void {
  // CRITICAL: Restore terminal FIRST, synchronously, before anything else
  // This ensures the terminal is restored even if something goes wrong later
  restoreTerminal();

  // Stop the input loop
  if (ctx.inputProcessor) {
    ctx.inputProcessor.stopListeningSync();
  }

  if (ctx.onExit) {
    // Use custom exit handler
    Promise.resolve(ctx.onExit())
      .finally(() => exit(0));
  } else {
    // Default behavior - do graceful cleanup then exit
    ctx.stop()
      .finally(() => exit(0));
  }
}

/**
 * Handle Escape key to close various overlays
 * Returns true if an overlay was closed
 */
function handleEscapeKey(ctx: KeyboardHandlerContext): boolean {
  // Handle Escape to close View Source overlay
  if (ctx.devToolsManager?.isOpen()) {
    ctx.devToolsManager.close();
    return true;
  }

  // Handle Escape to close Alert dialog
  if (ctx.alertDialogManager?.isOpen()) {
    ctx.alertDialogManager.close();
    return true;
  }

  // Handle Escape to close Confirm dialog (cancels)
  if (ctx.confirmDialogManager?.isOpen()) {
    ctx.confirmDialogManager.close(false);
    return true;
  }

  // Handle Escape to close Prompt dialog (cancels)
  if (ctx.promptDialogManager?.isOpen()) {
    ctx.promptDialogManager.close(null);
    return true;
  }

  // Handle Escape to close Accessibility dialog
  const accessibilityManager = ctx.getAccessibilityDialogManager();
  if (accessibilityManager?.isOpen()) {
    accessibilityManager.close();
    return true;
  }

  return false;
}

/**
 * Handle keyboard input when a command palette is open
 * Returns true if the event was handled
 */
function handleCommandPaletteInput(
  event: RawKeyEvent,
  palette: any,
  ctx: KeyboardHandlerContext
): boolean {
  // Escape closes the palette
  if (event.key === 'Escape') {
    palette.close();
    ctx.render();
    return true;
  }

  // Route all keyboard events to the open command palette
  if (typeof palette.onKeyPress === 'function') {
    const keyPressEvent = createKeyPressEvent(event.key, {
      code: event.code,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      target: palette.id,
    });

    const handled = palette.onKeyPress(keyPressEvent);
    if (handled && ctx.autoRender) {
      ctx.render();
    }
    return true;
  }

  return false;
}

/**
 * Build the ancestor path from root to target element.
 * Returns the path array [root, ..., target] or null if target not found.
 */
function findAncestorPath(root: Element, targetId: string): Element[] | null {
  if (root.id === targetId) return [root];
  if (!root.children) return null;
  for (const child of root.children) {
    const path = findAncestorPath(child, targetId);
    if (path) { path.unshift(root); return path; }
  }
  return null;
}

/**
 * Find a <command> element matching the key event, scoped to ancestors
 * of the focused element. Walks from deepest to shallowest (innermost wins).
 */
function findMatchingCommand(root: Element, focusedId: string, event: RawKeyEvent): Element | null {
  const path = findAncestorPath(root, focusedId);
  if (!path) return null;

  const eventShortcut = eventToShortcut(event);

  // Walk from deepest ancestor to shallowest (innermost command wins)
  for (let i = path.length - 1; i >= 0; i--) {
    const el = path[i];
    if (!el.children) continue;
    for (const child of el.children) {
      if (child.type === 'command' && !child.props.disabled && typeof child.props.key === 'string') {
        for (const k of parseCommandKeys(child.props.key)) {
          if (normalizeShortcut(k) === eventShortcut) return child;
        }
      }
    }
  }
  return null;
}

/**
 * Check if a global shortcut should be suppressed because an overlay is open
 * or the focused element would consume the key.
 */
function shouldSuppressGlobalShortcut(
  focusedElement: Element | undefined,
  event: RawKeyEvent,
  ctx: KeyboardHandlerContext,
): boolean {
  // Suppress when any overlay is open (command palette, system/document dialogs, dev tools, AI)
  if (ctx.findOpenCommandPalette()) return true;
  if (ctx.alertDialogManager?.isOpen()) return true;
  if (ctx.confirmDialogManager?.isOpen()) return true;
  if (ctx.promptDialogManager?.isOpen()) return true;
  if (ctx.getAccessibilityDialogManager()?.isOpen()) return true;
  if (ctx.devToolsManager?.isOpen()) return true;
  if (ctx.document?.root && hasElement(ctx.document.root, isOpenModalDialog)) return true;

  if (!focusedElement) return false;
  // Modifier combos pass through to global shortcuts (no focused-element suppression)
  if (event.ctrlKey || event.altKey || event.metaKey) return false;

  const type = focusedElement.type;
  // Input/textarea consume all unmodified keys
  if (type === 'input' || type === 'textarea') return true;
  // Slider and split-pane-divider always consume keys when focused
  if (type === 'slider' || type === 'split-pane-divider') return true;
  // KeyboardElements (data-table, combobox, file-browser, data-tree) consume all keys
  if (isKeyboardElement(focusedElement) && focusedElement.handlesOwnKeyboard()) return true;

  return false;
}

/**
 * Handle keyboard input for the focused element
 * Returns true if the event was handled
 */
function handleFocusedElementInput(
  event: RawKeyEvent,
  focusedElement: Element,
  ctx: KeyboardHandlerContext
): boolean {
  // Route to split-pane-divider element for arrow key handling
  if (focusedElement.type === 'split-pane-divider') {
    const divider = focusedElement as any;
    if (divider.handleKeyInput) {
      const handled = divider.handleKeyInput(event.key, event.ctrlKey, event.altKey);
      if (handled && ctx.autoRender) {
        ctx.render();
      }
      return true;
    }
  }

  // Route to slider element for arrow key handling
  if (focusedElement.type === 'slider') {
    const slider = focusedElement as any;
    if (slider.handleKeyInput) {
      const handled = slider.handleKeyInput(event.key, event.ctrlKey, event.altKey);
      if (handled && ctx.autoRender) {
        ctx.render();
      }
      return true;
    }
  }

  // Route to text input if it's a text input or textarea element
  if (focusedElement.type === 'input' || focusedElement.type === 'textarea') {
    return handleTextInputKeyboard(event, focusedElement as InputElement | TextareaElement, ctx);
  }

  // Route to components that handle their own keyboard events (filterable lists, etc.)
  if (isKeyboardElement(focusedElement) && focusedElement.handlesOwnKeyboard()) {
    const keyPressEvent = createKeyPressEvent(event.key, {
      code: event.code,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      target: focusedElement.id,
    });

    const handled = focusedElement.onKeyPress(keyPressEvent);

    // Auto-render if the event was handled
    if (handled && ctx.autoRender) {
      ctx.render();
    }
    return true;
  }

  // Handle Enter key on focused buttons
  if (focusedElement.type === 'button' && event.key === 'Enter') {
    // Trigger click event on the focused button
    ctx.document.triggerElementEvent(focusedElement, {
      type: 'click',
      target: focusedElement,
      timestamp: Date.now(),
    });

    // Re-render to show any state changes from the click handler
    if (ctx.autoRender) {
      ctx.render();
    }
    return true;
  }

  // Handle Enter/Space key on Clickable elements (checkbox, radio, etc.)
  if (isClickable(focusedElement) && (event.key === 'Enter' || event.key === ' ')) {
    const clickEvent: ClickEvent = {
      type: 'click',
      target: focusedElement,
      position: { x: 0, y: 0 },
      timestamp: Date.now(),
    };

    const handled = focusedElement.handleClick(clickEvent, ctx.document);

    if (handled) {
      ctx.render();
    }
    return true;
  }

  // Check for <command> elements on ancestors of focused element
  const matchedCommand = findMatchingCommand(ctx.document.root, focusedElement.id, event);
  if (matchedCommand && typeof matchedCommand.props.onExecute === 'function') {
    matchedCommand.props.onExecute();
    if (ctx.autoRender) ctx.render();
    return true;
  }

  // Generic keyboard event handling for components with onKeyPress method
  if (hasKeyPressHandler(focusedElement)) {
    const keyPressEvent = createKeyPressEvent(event.key, {
      code: event.code,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      target: focusedElement.id,
    });

    const handled = focusedElement.onKeyPress(keyPressEvent);

    // Auto-render if the event was handled
    if (handled && ctx.autoRender) {
      ctx.render();
    }
    return true;
  }

  return false;
}

/**
 * Handle keyboard input for text input/textarea elements
 * Returns true (always handles text input events)
 */
function handleTextInputKeyboard(
  event: RawKeyEvent,
  textInput: InputElement | TextareaElement,
  ctx: KeyboardHandlerContext
): boolean {
  if (!textInput.handleKeyInput) {
    return false;
  }

  logger.debug('Key input routed to text input', {
    elementId: textInput.id,
    key: event.key,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
  });

  const handled = textInput.handleKeyInput(
    event.key,
    event.ctrlKey ?? false,
    event.altKey ?? false,
    event.shiftKey ?? false
  );

  // Auto-render if the input changed
  if (handled && ctx.autoRender) {
    // Check if any system dialogs are open (these are always overlays)
    const hasSystemDialog = ctx.alertDialogManager?.isOpen() ||
                           ctx.confirmDialogManager?.isOpen() ||
                           ctx.promptDialogManager?.isOpen() ||
                           ctx.getAccessibilityDialogManager()?.isOpen();

    // Check if there's a document dialog that's an overlay (not an ancestor of this input)
    const hasOverlayDialog = ctx.hasOverlayDialogFor(textInput as Element);

    // Try fast render first (immediate visual feedback)
    // Skip if there's an overlay dialog - it would be overwritten
    if (!hasSystemDialog && !hasOverlayDialog && textInput.canFastRender() && ctx.renderer) {
      const bounds = ctx.renderer.findElementBounds(textInput.id);
      if (bounds) {
        // Collect diffs directly — no buffer copy needed
        const collector = new DiffCollector();
        if (textInput.fastRender(collector, bounds, true)) {
          const diffs = collector.getDiffs();
          if (diffs.length > 0) {
            ctx.renderFastPath(diffs);
          }
        }
      }
    }

    // Always schedule debounced full render for layout correctness
    // (handles text wrapping, size changes, etc.)
    ctx.debouncedInputRender();
  }

  return true;
}
