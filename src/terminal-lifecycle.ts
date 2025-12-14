// Terminal lifecycle management - setup, cleanup, and signal handling
// Extracted from engine.ts for better separation of concerns

import { ANSI } from './ansi-output.ts';
import { isRunningHeadless } from './headless.ts';

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

  if (typeof Deno !== 'undefined') {
    const codes: string[] = [];

    if (options.alternateScreen) {
      codes.push(ANSI.alternateScreen);
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
 * Emergency cleanup - minimal terminal restore for crash scenarios
 */
export function emergencyCleanupTerminal(): void {
  if (typeof Deno !== 'undefined') {
    try {
      Deno.stdout.writeSync(new TextEncoder().encode('\x1b[?1049l\x1b[?25h'));
    } catch {
      // Last resort - at least try to show cursor
      try {
        Deno.stdout.writeSync(new TextEncoder().encode('\x1b[?25h'));
      } catch {
        // Nothing more we can do
      }
    }
  }
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
