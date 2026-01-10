// Terminal lifecycle management - setup, cleanup, and signal handling
// Extracted from engine.ts for better separation of concerns

import { ANSI } from './ansi-output.ts';
import { isRunningHeadless } from './headless.ts';
import { getLogger } from './logging.ts';
import { MelkerConfig } from './config/mod.ts';

const logger = getLogger('terminal-lifecycle');

/**
 * Full terminal restore - disables raw mode, mouse reporting, alternate screen.
 * This is a standalone function that doesn't depend on engine state.
 * Use this for graceful exit, error handling, or emergency cleanup.
 */
export function restoreTerminal(): void {
  // First disable raw mode
  try {
    Deno.stdin.setRaw(false);
  } catch {
    // Ignore errors
  }

  // Then disable mouse reporting, exit alternate screen, show cursor
  try {
    // \x1b[?1000l - Disable basic mouse reporting
    // \x1b[?1002l - Disable button event tracking
    // \x1b[?1003l - Disable any-event tracking (all mouse movements)
    // \x1b[?1006l - Disable SGR extended mouse mode
    // \x1b[?1049l - Exit alternate screen
    // \x1b[?25h   - Show cursor
    // \x1b[0m     - Reset all text styles
    const resetSequence = '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1049l\x1b[?25h\x1b[0m';
    Deno.stdout.writeSync(new TextEncoder().encode(resetSequence));
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

  // Check config for alternate screen setting
  const noAltScreen = !MelkerConfig.get().terminalAlternateScreen;

  if (typeof Deno !== 'undefined') {
    const codes: string[] = [];

    // Use alternate screen unless explicitly disabled
    if (options.alternateScreen && !noAltScreen) {
      codes.push(ANSI.alternateScreen);
    } else if (options.alternateScreen && noAltScreen) {
      // Clear screen instead when not using alternate screen
      codes.push('\x1b[2J\x1b[H'); // Clear screen and move to home
    }

    if (options.hideCursor) {
      codes.push(ANSI.hideCursor);
    }

    if (codes.length > 0) {
      Deno.stdout.writeSync(new TextEncoder().encode(codes.join('')));
    }
  }
}

/**
 * Clean up terminal (restore normal screen, show cursor)
 */
export function cleanupTerminal(options: TerminalLifecycleOptions): void {
  if (typeof Deno !== 'undefined') {
    // In headless mode, do minimal terminal cleanup if connected to a real terminal
    if (isRunningHeadless()) {
      try {
        // Check if stdout is a TTY (connected to a real terminal)
        if (Deno.stdout.isTerminal()) {
          // Basic cleanup: restore cursor and normal screen if needed
          const codes: string[] = [];
          if (options.alternateScreen) {
            codes.push(ANSI.normalScreen);
          }
          if (options.hideCursor) {
            codes.push(ANSI.showCursor);
          }
          if (codes.length > 0) {
            Deno.stdout.writeSync(new TextEncoder().encode(codes.join('')));
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
      Deno.stdout.writeSync(new TextEncoder().encode(codes.join('')));
    }
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
 * Set up signal handlers for graceful shutdown
 */
export function setupCleanupHandlers(
  onAsyncCleanup: () => Promise<void>,
  onSyncCleanup: () => void
): void {
  if (typeof Deno === 'undefined') return;

  const cleanup = async () => {
    try {
      await onAsyncCleanup();
    } catch (error) {
      // Ensure terminal cleanup even if stop() fails
      onSyncCleanup();
      console.error('Error during cleanup:', error);
    }
    Deno.exit(0);
  };

  const syncCleanup = () => {
    try {
      onSyncCleanup();
    } catch (error) {
      console.error('Error during sync cleanup:', error);
    }
  };

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
  // CRITICAL: Always restore terminal FIRST so error is visible
  globalThis.addEventListener('error', (event) => {
    // Log to file FIRST (before terminal cleanup might interfere)
    const err = event.error instanceof Error ? event.error : new Error(String(event.error));
    logger.fatal('Uncaught error', err);

    // Full terminal restore (raw mode, mouse, alternate screen)
    restoreTerminal();
    syncCleanup();  // Also call engine cleanup

    console.error('\n\x1b[31mUncaught error:\x1b[0m', event.error);
    if (event.error instanceof Error && event.error.stack) {
      console.error('\nStack trace:');
      console.error(event.error.stack);
    }
    Deno.exit(1);
  });

  globalThis.addEventListener('unhandledrejection', (event) => {
    // Log to file FIRST (before terminal cleanup might interfere)
    const reason = event.reason;
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.fatal('Unhandled promise rejection', err);

    // Full terminal restore (raw mode, mouse, alternate screen)
    restoreTerminal();
    syncCleanup();  // Also call engine cleanup

    console.error('\n\x1b[31mUnhandled promise rejection:\x1b[0m', reason);
    if (reason instanceof Error && reason.stack) {
      console.error('\nStack trace:');
      console.error(reason.stack);
    }
    Deno.exit(1);
  });

  // Handle beforeunload/exit events if available
  try {
    globalThis.addEventListener('beforeunload', syncCleanup);
  } catch {
    // beforeunload might not be available in Deno
  }
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
  if (typeof globalThis === 'undefined' || typeof Deno === 'undefined') return;

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
      Deno.addSignalListener('SIGKILL', emergencyCleanup);
    } catch {
      // SIGKILL might not be available
    }

    // Store for potential external access
    (globalThis as any)._melkerEmergencyCleanup = emergencyCleanup;
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
