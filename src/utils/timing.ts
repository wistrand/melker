// Timing utilities for debounce and throttle operations

/**
 * Creates a debounced function that delays invoking fn until after
 * delay milliseconds have elapsed since the last call.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: number | undefined;

  return (...args: Parameters<T>) => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = undefined;
    }, delay);
  };
}

/**
 * Debounced action with flush and cancel capabilities.
 * Useful when you need to ensure pending work completes before cleanup.
 */
export interface DebouncedAction {
  /** Trigger a debounced call */
  call: () => void;
  /** Execute immediately if there's a pending call */
  flush: () => void;
  /** Cancel any pending call without executing */
  cancel: () => void;
  /** Check if there's a pending call */
  isPending: () => boolean;
}

/**
 * Creates a debounced action with flush capability.
 * Unlike simple debounce, this allows:
 * - Flushing pending calls immediately (e.g., before cleanup)
 * - Canceling pending calls
 * - Checking if a call is pending
 */
export function createDebouncedAction(
  fn: () => void,
  delay: number
): DebouncedAction {
  let timeoutId: number | null = null;
  let pending = false;

  const execute = () => {
    pending = false;
    fn();
  };

  return {
    call: () => {
      pending = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        timeoutId = null;
        execute();
      }, delay) as unknown as number;
    },

    flush: () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (pending) {
        execute();
      }
    },

    cancel: () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      pending = false;
    },

    isPending: () => pending,
  };
}

/**
 * Creates a throttled function that executes at most once per interval.
 * Unlike debounce, throttle guarantees execution at regular intervals
 * during continuous calls.
 *
 * @param fn Function to throttle
 * @param interval Minimum time between executions in milliseconds
 * @param options.leading Execute on the leading edge (default: true)
 * @param options.trailing Execute on the trailing edge (default: true)
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  interval: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): (...args: Parameters<T>) => void {
  const { leading = true, trailing = true } = options;
  let lastExecuteTime = 0;
  let timeoutId: number | null = null;
  let lastArgs: Parameters<T> | null = null;

  const execute = (args: Parameters<T>) => {
    lastExecuteTime = performance.now();
    fn(...args);
  };

  return (...args: Parameters<T>) => {
    const now = performance.now();
    const elapsed = now - lastExecuteTime;

    // Store args for potential trailing call
    lastArgs = args;

    if (elapsed >= interval) {
      // Enough time has passed, execute immediately if leading is enabled
      if (leading) {
        // Cancel any pending trailing call
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        execute(args);
        lastArgs = null;
      }
    }

    // Schedule trailing call if enabled and not already scheduled
    if (trailing && timeoutId === null) {
      const remaining = interval - elapsed;
      const delay = remaining > 0 ? remaining : interval;

      timeoutId = setTimeout(() => {
        timeoutId = null;
        if (lastArgs !== null) {
          execute(lastArgs);
          lastArgs = null;
        }
      }, delay) as unknown as number;
    }
  };
}

/**
 * Throttled action with cancel capability.
 * Similar to DebouncedAction but for throttle pattern.
 */
export interface ThrottledAction {
  /** Trigger a throttled call */
  call: () => void;
  /** Cancel any pending trailing call */
  cancel: () => void;
  /** Reset the throttle timer (next call will execute immediately if leading) */
  reset: () => void;
}

/**
 * Creates a throttled action with cancel and reset capabilities.
 */
export function createThrottledAction(
  fn: () => void,
  interval: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): ThrottledAction {
  const { leading = true, trailing = true } = options;
  let lastExecuteTime = 0;
  let timeoutId: number | null = null;
  let pendingTrailing = false;

  const execute = () => {
    lastExecuteTime = performance.now();
    pendingTrailing = false;
    fn();
  };

  return {
    call: () => {
      const now = performance.now();
      const elapsed = now - lastExecuteTime;

      if (elapsed >= interval) {
        if (leading) {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          execute();
          return;
        }
      }

      pendingTrailing = true;

      if (trailing && timeoutId === null) {
        const remaining = interval - elapsed;
        const delay = remaining > 0 ? remaining : interval;

        timeoutId = setTimeout(() => {
          timeoutId = null;
          if (pendingTrailing) {
            execute();
          }
        }, delay) as unknown as number;
      }
    },

    cancel: () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      pendingTrailing = false;
    },

    reset: () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastExecuteTime = 0;
      pendingTrailing = false;
    },
  };
}
