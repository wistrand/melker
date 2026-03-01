// Shared infrastructure for graphics protocol detection modules.
// Provides caching, state management, and lifecycle methods used by
// sixel, kitty, and iterm2 detection.

import { detectMultiplexer, detectRemoteSession } from '../utils/terminal-detection.ts';
import { stdout } from '../runtime/mod.ts';

/**
 * Base interface for all graphics capabilities types.
 * Each protocol extends this with protocol-specific fields.
 */
export interface BaseCapabilities {
  supported: boolean;
  inMultiplexer: boolean;
  isRemote: boolean;
  detectionMethod: string;
}

/**
 * State for async query/response detection (sixel, kitty).
 * Not used by iterm2 which is environment-based only.
 */
export interface DetectionState<T> {
  phase: string;
  capabilities: T;
  responseBuffer: string;
  startTime: number;
  timeoutMs: number;
  resolve: ((caps: T) => void) | null;
}

interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
}

/**
 * Shared detection module providing cache, state, and lifecycle management.
 * Each protocol creates an instance and delegates boilerplate to it.
 */
export class DetectionModule<T extends BaseCapabilities> {
  private _cache: T | null = null;
  private _state: DetectionState<T> | null = null;

  constructor(
    private _name: string,
    private _defaultCaps: T,
    private _logger: Logger,
  ) {}

  // --- Cache Management ---

  getCached(): T | null {
    return this._cache;
  }

  setCached(caps: T): void {
    this._cache = caps;
  }

  clearCache(): void {
    this._cache = null;
    this._state = null;
  }

  isAvailable(): boolean {
    return this._cache?.supported ?? false;
  }

  // --- State Management ---

  getState(): DetectionState<T> | null {
    return this._state;
  }

  isInProgress(): boolean {
    return this._state !== null && this._state.phase !== 'complete';
  }

  getTimeout(): number {
    if (!this._state) return 0;
    const elapsed = Date.now() - this._state.startTime;
    return Math.max(0, this._state.timeoutMs - elapsed);
  }

  checkTimeout(onTimeout: () => void): void {
    if (!this._state || this._state.phase === 'complete') return;
    if (Date.now() - this._state.startTime > this._state.timeoutMs) {
      onTimeout();
    }
  }

  // --- Async Detection Lifecycle ---

  /**
   * If cached or in-progress, returns a resolved/chained promise.
   * Otherwise returns null — caller should proceed with fresh detection.
   */
  tryResolveEarly(): Promise<T> | null {
    if (this._cache) {
      return Promise.resolve(this._cache);
    }
    if (this._state?.resolve) {
      return new Promise(resolve => {
        const oldResolve = this._state!.resolve;
        this._state!.resolve = (caps) => {
          oldResolve?.(caps);
          resolve(caps);
        };
      });
    }
    return null;
  }

  /**
   * Create initial capabilities with multiplexer/remote detection.
   */
  createCapabilities(): T {
    const caps = { ...this._defaultCaps };
    caps.inMultiplexer = detectMultiplexer();
    caps.isRemote = detectRemoteSession();
    return caps;
  }

  /**
   * Initialize async state machine.
   */
  initState(phase: string, caps: T, timeoutMs: number, resolve: (caps: T) => void): void {
    this._state = {
      phase,
      capabilities: caps,
      responseBuffer: '',
      startTime: Date.now(),
      timeoutMs,
      resolve,
    };
  }

  /**
   * Complete detection: cache result, resolve promise, clear state.
   * Optional callback runs before caching (e.g. sixel max-dimension calc).
   */
  complete(onBeforeCache?: (caps: T) => void): void {
    if (!this._state) return;
    const caps = this._state.capabilities;
    onBeforeCache?.(caps);
    this._cache = caps;
    this._state.resolve?.(caps);
    this._state = null;
  }

  /**
   * Cache capabilities and return resolved promise (for early exits).
   */
  earlyReturn(caps: T): Promise<T> {
    this._cache = caps;
    return Promise.resolve(caps);
  }

  // --- Input Feed Guards ---

  /**
   * Check common guards before processing detection input.
   * Returns 'pass' if input should not be consumed (wrong state, Ctrl+C),
   * 'timeout' if detection timed out, or 'feed' to proceed with processing.
   */
  feedGuards(data: Uint8Array, onTimeout: () => void): 'pass' | 'timeout' | 'feed' {
    if (!this._state || this._state.phase === 'complete') return 'pass';
    // Always let Ctrl+C through
    if (data.length === 1 && data[0] === 0x03) {
      this._logger.debug(`Ctrl+C during ${this._name} detection - passing through`);
      return 'pass';
    }
    if (Date.now() - this._state.startTime > this._state.timeoutMs) {
      onTimeout();
      return 'timeout';
    }
    return 'feed';
  }

  // --- Convenience Wrappers ---

  /**
   * Shared forceRedetect / cache-check pattern for detectCapabilities().
   */
  detectCapabilities(forceRedetect: boolean, startFn: () => Promise<T>): Promise<T> {
    if (this._cache && !forceRedetect) {
      return Promise.resolve(this._cache);
    }
    if (forceRedetect) {
      this.clearCache();
    }
    return startFn();
  }
}

/**
 * Write a terminal query (synchronous stdout write).
 * Shared by sixel and kitty detection.
 */
export function writeDetectionQuery(query: string): void {
  const encoder = new TextEncoder();
  stdout.writeSync(encoder.encode(query));
}
