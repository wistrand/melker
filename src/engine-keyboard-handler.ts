// Keyboard event handling for MelkerEngine
// Extracted from engine.ts to reduce file size

import { Document } from './document.ts';
import { InputElement } from './components/input.ts';
import { TextareaElement } from './components/textarea.ts';
import { Element, isClickable, ClickEvent, isKeyboardElement, hasKeyPressHandler } from './types.ts';
import { createKeyPressEvent } from './events.ts';
import { getGlobalPerformanceDialog } from './performance-dialog.ts';
import { restoreTerminal } from './terminal-lifecycle.ts';
import type { ComponentLogger } from './logging.ts';
import type { DualBuffer } from './buffer.ts';
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
  logger?: ComponentLogger;
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

  // Engine methods (callbacks)
  render: () => void;
  stop: () => Promise<void>;
  toggleCommandPalette: () => void;
  findOpenCommandPalette: () => Element | null;
  ensureAccessibilityDialogManager: () => void;
  hasOverlayDialogFor: (element: Element) => boolean;
  debouncedInputRender: () => void;
  renderFastPath: () => void;
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
  ctx.logger?.debug('Key event received', {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
  });

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

  // Handle open command palettes - they capture all keyboard input when open
  const openCommandPalette = ctx.findOpenCommandPalette() as any;
  if (openCommandPalette) {
    if (handleCommandPaletteInput(event, openCommandPalette, ctx)) {
      return true;
    }
  }

  // Handle F7 specially for voice input
  if (['f7', 'F7'].includes(event.key)) {
    ctx.logger?.info('F7 pressed - voice input mode');
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
    ctx.logger?.info(event.key + ' pressed - opening accessibility dialog');
    ctx.ensureAccessibilityDialogManager();
    ctx.getAccessibilityDialogManager()!.toggle();
    return true;
  }

  // Handle Ctrl+/ or Alt+/ or Ctrl+? or Alt+? for AI Accessibility dialog
  if ((event.ctrlKey || event.altKey) && (['/', '?', 'h', 'H'].includes(event.key))) {
    ctx.logger?.info('Accessibility shortcut pressed', { key: event.key, ctrlKey: event.ctrlKey, altKey: event.altKey });
    ctx.ensureAccessibilityDialogManager();
    ctx.getAccessibilityDialogManager()!.toggle();
    return true;
  }

  // Handle Alt+N || Alt+C for copying selection to clipboard
  if (event.altKey && (event.key === 'n' || event.key === 'c')) {
    ctx.textSelectionHandler.copySelectionToClipboard();
    return true;
  }

  // Handle arrow keys for scrolling in scrollable containers
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && focusedElement) {
    const scrollableParent = ctx.scrollHandler.findScrollableParent(focusedElement);
    if (scrollableParent && ctx.scrollHandler.handleArrowKeyScroll(event.key, scrollableParent)) {
      return true; // Arrow key was handled by scrolling
    }
  }

  // Handle focused element keyboard input
  if (focusedElement) {
    if (handleFocusedElementInput(event, focusedElement, ctx)) {
      return true;
    }
  }

  return false;
}

/**
 * Handle Ctrl+C for graceful exit
 */
function handleCtrlC(ctx: KeyboardHandlerContext): void {
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
      .finally(() => Deno.exit(0));
  } else {
    // Default behavior - do graceful cleanup then exit
    ctx.stop()
      .finally(() => Deno.exit(0));
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
 * Handle keyboard input for the focused element
 * Returns true if the event was handled
 */
function handleFocusedElementInput(
  event: RawKeyEvent,
  focusedElement: Element,
  ctx: KeyboardHandlerContext
): boolean {
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

  ctx.logger?.debug('Key input routed to text input', {
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
    if (!hasSystemDialog && !hasOverlayDialog && textInput.canFastRender() && ctx.buffer && ctx.renderer) {
      const bounds = ctx.renderer.findElementBounds(textInput.id);
      if (bounds) {
        // Prepare buffer: copy previous content so fast render only updates input cells
        ctx.buffer.prepareForFastRender();
        if (textInput.fastRender(ctx.buffer, bounds, true)) {
          // Use fast path: outputs diff WITHOUT swapping buffers
          // This preserves buffer state for the debounced full render
          ctx.renderFastPath();
        }
      }
    }

    // Always schedule debounced full render for layout correctness
    // (handles text wrapping, size changes, etc.)
    ctx.debouncedInputRender();
  }

  return true;
}
