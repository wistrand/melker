// UI Animation Manager - centralized timer for UI animations
//
// Provides a single animation tick that multiple components can subscribe to,
// reducing timer overhead and batching render calls.
//
// Uses adaptive tick interval: max(MIN_TICK, min(all intervals) / 2)
// This reduces CPU usage when only slow animations are running.

import { getLogger } from './logging.ts';

const logger = getLogger('ui-animation');

/** Animation callback function */
export type AnimationCallback = (elapsed: number) => void;

/** Registered animation entry */
interface AnimationEntry {
  id: string;
  callback: AnimationCallback;
  interval: number;  // Original requested interval
  lastTick: number;
  paused: boolean;
}

/**
 * Centralized UI Animation Manager.
 *
 * Runs a single timer that dispatches to registered animations at their
 * requested intervals. Batches render calls for efficiency.
 *
 * The tick interval adapts based on registered animations:
 * tick = max(MIN_TICK, min(all intervals) / 2)
 *
 * Usage:
 * ```typescript
 * const manager = getUIAnimationManager();
 * manager.setRequestRender(() => engine.render());
 *
 * // Register an animation (returns cleanup function)
 * const unregister = manager.register('my-spinner', (elapsed) => {
 *   updateSpinnerFrame();
 * }, 100); // 100ms interval
 *
 * // Later: cleanup
 * unregister();
 * ```
 */
export class UIAnimationManager {
  /** Minimum tick interval in ms (floor for adaptive tick) */
  static readonly MIN_TICK = 12;

  private _animations: Map<string, AnimationEntry> = new Map();
  private _timer: number | null = null;
  private _currentTick: number = UIAnimationManager.MIN_TICK;
  private _requestRender: (() => void) | null = null;
  private _startTime: number = 0;
  private _renderRequested: boolean = false;

  /**
   * Set the render request function.
   * Called once per tick if any animation requested a render.
   */
  setRequestRender(fn: () => void): void {
    this._requestRender = fn;
  }

  /**
   * Register an animation callback.
   *
   * @param id Unique identifier for this animation
   * @param callback Function called on each tick (receives elapsed ms since registration)
   * @param interval Desired interval in ms
   * @returns Unregister function
   */
  register(id: string, callback: AnimationCallback, interval: number = 100): () => void {
    // Ensure minimum interval
    const effectiveInterval = Math.max(UIAnimationManager.MIN_TICK, interval);

    const entry: AnimationEntry = {
      id,
      callback,
      interval: effectiveInterval,
      lastTick: performance.now(),
      paused: false,
    };

    this._animations.set(id, entry);
    logger.debug('Animation registered', { id, interval: effectiveInterval });

    this._updateTickInterval();
    this._startIfNeeded();

    // Return unregister function
    return () => this.unregister(id);
  }

  /**
   * Unregister an animation.
   */
  unregister(id: string): void {
    if (this._animations.delete(id)) {
      logger.debug('Animation unregistered', { id });
      if (this._animations.size === 0) {
        this._stopTimer();
      } else {
        this._updateTickInterval();
      }
    }
  }

  /**
   * Pause an animation (keeps registration, stops callbacks).
   */
  pause(id: string): void {
    const entry = this._animations.get(id);
    if (entry) {
      entry.paused = true;
    }
  }

  /**
   * Resume a paused animation.
   */
  resume(id: string): void {
    const entry = this._animations.get(id);
    if (entry) {
      entry.paused = false;
      entry.lastTick = performance.now();
    }
  }

  /**
   * Check if an animation is registered.
   */
  has(id: string): boolean {
    return this._animations.has(id);
  }

  /**
   * Check if an animation is active (registered and not paused).
   */
  isActive(id: string): boolean {
    const entry = this._animations.get(id);
    return entry !== undefined && !entry.paused;
  }

  /**
   * Get count of registered animations.
   */
  get count(): number {
    return this._animations.size;
  }

  /**
   * Get count of active (non-paused) animations.
   */
  get activeCount(): number {
    let count = 0;
    for (const entry of this._animations.values()) {
      if (!entry.paused) count++;
    }
    return count;
  }

  /**
   * Get current tick interval (for debugging/monitoring).
   */
  get currentTick(): number {
    return this._currentTick;
  }

  /**
   * Request a render on next tick.
   * Called by animation callbacks when they've updated state.
   */
  requestRender(): void {
    this._renderRequested = true;
  }

  /**
   * Stop all animations and cleanup.
   */
  shutdown(): void {
    this._stopTimer();
    this._animations.clear();
    this._requestRender = null;
    logger.debug('Animation manager shutdown');
  }

  /**
   * Calculate optimal tick interval based on registered animations.
   * Formula: max(MIN_TICK, min(all intervals) / 2)
   */
  private _calculateOptimalTick(): number {
    if (this._animations.size === 0) {
      return UIAnimationManager.MIN_TICK;
    }

    let minInterval = Infinity;
    for (const entry of this._animations.values()) {
      if (!entry.paused && entry.interval < minInterval) {
        minInterval = entry.interval;
      }
    }

    if (minInterval === Infinity) {
      // All paused, use minimum
      return UIAnimationManager.MIN_TICK;
    }

    // Tick at half the minimum interval for good resolution
    const optimalTick = Math.floor(minInterval / 2);
    return Math.max(UIAnimationManager.MIN_TICK, optimalTick);
  }

  /**
   * Update tick interval and restart timer if needed.
   */
  private _updateTickInterval(): void {
    const newTick = this._calculateOptimalTick();
    if (newTick !== this._currentTick) {
      const oldTick = this._currentTick;
      this._currentTick = newTick;
      logger.debug('Tick interval changed', { from: oldTick, to: newTick });

      // Restart timer with new interval if running
      if (this._timer !== null) {
        clearInterval(this._timer);
        this._timer = setInterval(() => this._tick(), this._currentTick);
      }
    }
  }

  /**
   * Start the timer if not already running.
   */
  private _startIfNeeded(): void {
    if (this._timer !== null) return;
    if (this._animations.size === 0) return;

    this._startTime = performance.now();
    this._timer = setInterval(() => this._tick(), this._currentTick);
    logger.debug('Animation timer started', { tick: this._currentTick });
  }

  /**
   * Stop the timer.
   */
  private _stopTimer(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
      logger.debug('Animation timer stopped');
    }
  }

  /**
   * Main tick handler - dispatches to registered animations.
   *
   * Uses drift correction: lastTick += interval keeps animations on schedule.
   * If more than one interval behind, resets to avoid rapid-fire catch-up.
   */
  private _tick(): void {
    const now = performance.now();
    this._renderRequested = false;

    for (const entry of this._animations.values()) {
      if (entry.paused) continue;

      const elapsed = now - entry.lastTick;
      if (elapsed >= entry.interval) {
        try {
          entry.callback(now - this._startTime);

          // Drift correction: advance by interval to maintain schedule
          entry.lastTick += entry.interval;

          // But if we're more than one interval behind, reset to avoid catch-up spam
          if (now - entry.lastTick > entry.interval) {
            entry.lastTick = now;
          }
        } catch (err) {
          logger.error(`Animation callback error [${entry.id}]: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Batch render call
    if (this._renderRequested && this._requestRender) {
      this._requestRender();
    }
  }
}

// Global singleton instance
let globalManager: UIAnimationManager | null = null;

/**
 * Get the global UI animation manager instance.
 */
export function getUIAnimationManager(): UIAnimationManager {
  if (!globalManager) {
    globalManager = new UIAnimationManager();
  }
  return globalManager;
}

/**
 * Initialize the animation manager with a render function.
 * Call this during engine setup.
 */
export function initUIAnimationManager(requestRender: () => void): UIAnimationManager {
  const manager = getUIAnimationManager();
  manager.setRequestRender(requestRender);
  return manager;
}

/**
 * Shutdown the global animation manager.
 * Call this during engine cleanup.
 */
export function shutdownUIAnimationManager(): void {
  if (globalManager) {
    globalManager.shutdown();
    globalManager = null;
  }
}
