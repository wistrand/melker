// Terminal lifecycle management - setup, cleanup, and signal handling
// Extracted from engine.ts for better separation of concerns

import { ANSI } from './ansi-output.ts';
import { setGlobalEmergencyCleanup } from './global-accessors.ts';
import { isRunningHeadless } from './headless.ts';
import { getLogger, type ComponentLogger } from './logging.ts';
import { MelkerConfig } from './config/mod.ts';
import { isStdoutEnabled } from './stdout.ts';
import {
  stdin,
  stdout,
  exit,
  addSignalListener,
  removeSignalListener,
} from './runtime/mod.ts';

// Lazy logger initialization to avoid triggering MelkerConfig.get() before CLI flags are applied
let _logger: ComponentLogger | undefined;
function getTerminalLogger(): ComponentLogger {
  if (!_logger) {
    _logger = getLogger('terminal-lifecycle');
  }
  return _logger;
}

/**
 * Full terminal restore - disables raw mode, mouse reporting, alternate screen.
 * This is a standalone function that doesn't depend on engine state.
 * Use this for graceful exit, error handling, or emergency cleanup.
 */
export function restoreTerminal(): void {
  // First disable raw mode
  try {
    stdin.setRaw(false);
  } catch {
    // Ignore errors
  }

  // Then disable mouse reporting, exit alternate screen, show cursor
  try {
    const resetSequence =
      ANSI.mouseBasicOff + ANSI.mouseButtonOff + ANSI.mouseAnyOff + ANSI.mouseSgrOff +
      ANSI.normalScreen + ANSI.showCursor + ANSI.reset;
    stdout.writeSync(new TextEncoder().encode(resetSequence));
  } catch {
    // Ignore errors
  }
}

export interface TerminalLifecycleOptions {
  alternateScreen: boolean;
  hideCursor: boolean;
}

/**
 * Set up terminal for TUI mode (alternate screen, hide cursor)
 */
export function setupTerminal(options: TerminalLifecycleOptions): void {
  // Skip terminal setup in headless mode - let virtual terminal handle it
  if (isRunningHeadless()) {
    return;
  }

  // Skip terminal setup in stdout mode - keep terminal in normal mode
  if (isStdoutEnabled()) {
    return;
  }

  // Check config for alternate screen setting
  const noAltScreen = !MelkerConfig.get().terminalAlternateScreen;

  const codes: string[] = [];

  // Use alternate screen unless explicitly disabled
  if (options.alternateScreen && !noAltScreen) {
    codes.push(ANSI.alternateScreen);
  } else if (options.alternateScreen && noAltScreen) {
    // Clear screen instead when not using alternate screen
    codes.push(ANSI.clearScreen + ANSI.cursorHome);
  }

  if (options.hideCursor) {
    codes.push(ANSI.hideCursor);
  }

  if (codes.length > 0) {
    stdout.writeSync(new TextEncoder().encode(codes.join('')));
  }
}

/**
 * Clean up terminal (restore normal screen, show cursor)
 */
export function cleanupTerminal(options: TerminalLifecycleOptions): void {
  // In headless mode, do minimal terminal cleanup if connected to a real terminal
  if (isRunningHeadless()) {
    try {
      // Check if stdout is a TTY (connected to a real terminal)
      if (stdout.isTerminal()) {
        // Basic cleanup: restore cursor and normal screen if needed
        const codes: string[] = [];
        if (options.alternateScreen) {
          codes.push(ANSI.normalScreen);
        }
        if (options.hideCursor) {
          codes.push(ANSI.showCursor);
        }
        if (codes.length > 0) {
          stdout.writeSync(new TextEncoder().encode(codes.join('')));
        }
      }
    } catch {
      // If isTerminal() fails, we're probably not in a real terminal, so skip cleanup
    }
    return;
  }

  // Full cleanup for non-headless mode
  const codes: string[] = [];

  if (options.alternateScreen) {
    codes.push(ANSI.normalScreen);
  }

  if (options.hideCursor) {
    codes.push(ANSI.showCursor);
  }

  if (codes.length > 0) {
    stdout.writeSync(new TextEncoder().encode(codes.join('')));
  }
}

/**
 * Emergency cleanup - comprehensive terminal restore for crash scenarios.
 * Disables raw mode, mouse reporting, alternate screen, and shows cursor.
 */
export function emergencyCleanupTerminal(): void {
  restoreTerminal();
}

/**
 * Set up signal handlers for graceful shutdown.
 *
 * @param onAsyncCleanup - Async cleanup (engine.stop())
 * @param onSyncCleanup - Sync cleanup (terminal restore)
 * @param onBeforeExit - Optional hook called on first Ctrl+C. Returns true to exit, false to cancel.
 *   Second Ctrl+C within 3s force-exits regardless.
 * @returns Object with removeSigint() to unregister the SIGINT handler
 *   (used by melker-runner which installs its own handler with the same logic).
 */
export function setupCleanupHandlers(
  onAsyncCleanup: () => Promise<void>,
  onSyncCleanup: () => void,
  onBeforeExit?: () => Promise<boolean>,
): { removeSigint: () => void } {
  const cleanup = async () => {
    try {
      await onAsyncCleanup();
    } catch (error) {
      // Ensure terminal cleanup even if stop() fails
      onSyncCleanup();
      console.error('Error during cleanup:', error);
    }
    exit(0);
  };

  const syncCleanup = () => {
    try {
      onSyncCleanup();
    } catch (error) {
      console.error('Error during sync cleanup:', error);
    }
  };

  // SIGINT handler with before-exit hook support
  // First Ctrl+C calls onBeforeExit; if it returns false, exit is cancelled.
  // Second Ctrl+C within 3s force-exits, bypassing all hooks.
  let pendingExit = false;
  let pendingExitTimer: ReturnType<typeof setTimeout> | null = null;

  const sigintHandler = async () => {
    if (pendingExit || !onBeforeExit) {
      // Second press (or no hook) — force exit
      if (pendingExitTimer) clearTimeout(pendingExitTimer);
      await cleanup();
      return;
    }

    pendingExit = true;
    pendingExitTimer = setTimeout(() => { pendingExit = false; }, 3000);

    try {
      const shouldExit = await onBeforeExit();
      if (shouldExit) {
        if (pendingExitTimer) clearTimeout(pendingExitTimer);
        await cleanup();
      } else {
        // Hook cancelled exit — reset so next signal goes through the hook again
        if (pendingExitTimer) clearTimeout(pendingExitTimer);
        pendingExitTimer = null;
        pendingExit = false;
      }
    } catch {
      // Error in hook — exit to be safe
      if (pendingExitTimer) clearTimeout(pendingExitTimer);
      await cleanup();
    }
  };

  addSignalListener('SIGINT', sigintHandler);
  addSignalListener('SIGTERM', cleanup);

  // Handle additional termination signals
  try {
    addSignalListener('SIGHUP', cleanup);
    addSignalListener('SIGQUIT', cleanup);
  } catch {
    // Some signals might not be available on all platforms
  }

  // Handle uncaught exceptions and unhandled rejections
  // CRITICAL: Always restore terminal FIRST so error is visible
  globalThis.addEventListener('error', (event) => {
    // Log to file FIRST (before terminal cleanup might interfere)
    const err = event.error instanceof Error ? event.error : new Error(String(event.error));
    getTerminalLogger().fatal('Uncaught error', err);

    // Full terminal restore (raw mode, mouse, alternate screen)
    restoreTerminal();
    syncCleanup();  // Also call engine cleanup

    console.error('\n\x1b[31mUncaught error:\x1b[0m', event.error);
    if (event.error instanceof Error && event.error.stack) {
      console.error('\nStack trace:');
      console.error(event.error.stack);
    }
    exit(1);
  });

  globalThis.addEventListener('unhandledrejection', (event) => {
    // Log to file FIRST (before terminal cleanup might interfere)
    const reason = event.reason;
    const err = reason instanceof Error ? reason : new Error(String(reason));
    getTerminalLogger().fatal('Unhandled promise rejection', err);

    // Full terminal restore (raw mode, mouse, alternate screen)
    restoreTerminal();
    syncCleanup();  // Also call engine cleanup

    console.error('\n\x1b[31mUnhandled promise rejection:\x1b[0m', reason);
    if (reason instanceof Error && reason.stack) {
      console.error('\nStack trace:');
      console.error(reason.stack);
    }
    exit(1);
  });

  // Handle beforeunload/exit events if available
  try {
    globalThis.addEventListener('beforeunload', syncCleanup);
  } catch {
    // beforeunload might not be available in Deno
  }

  return {
    removeSigint: () => {
      try { removeSignalListener('SIGINT', sigintHandler); } catch { /* ignore */ }
    },
  };
}

// Type for instances that can be tracked for emergency cleanup
export interface CleanupableInstance {
  _cleanupTerminal?: () => void;
}

// Global tracking for emergency cleanup
let _instances: Set<CleanupableInstance> | null = null;
let _emergencyCleanupRegistered = false;

/**
 * Register an instance for emergency cleanup on unexpected exit
 */
export function registerForEmergencyCleanup(instance: CleanupableInstance): void {
  if (!_instances) {
    _instances = new Set();
  }

  _instances.add(instance);

  // Set up one-time global emergency cleanup handlers
  if (!_emergencyCleanupRegistered) {
    _emergencyCleanupRegistered = true;

    const emergencyCleanup = () => {
      if (_instances) {
        for (const inst of _instances) {
          try {
            if (inst._cleanupTerminal) {
              inst._cleanupTerminal();
            }
          } catch {
            // Silent fail for emergency cleanup
          }
        }
      }
    };

    // Register emergency cleanup for various exit scenarios
    try {
      addSignalListener('SIGKILL', emergencyCleanup);
    } catch {
      // SIGKILL might not be available
    }

    // Store for potential external access
    setGlobalEmergencyCleanup(emergencyCleanup);
  }
}

/**
 * Unregister an instance from emergency cleanup tracking
 */
export function unregisterFromEmergencyCleanup(instance: CleanupableInstance): void {
  if (_instances) {
    _instances.delete(instance);
  }
}
