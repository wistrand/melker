// Headless mode support for Melker applications
// Allows running Melker apps without a real terminal, using debug server for interaction

import { Env } from './env.ts';
import { MelkerConfig } from './config/mod.ts';

export interface HeadlessOptions {
  width?: number;
  height?: number;
  debugPort?: number;
  debugHost?: string;
  enableBufferCapture?: boolean;
}

export interface VirtualTerminal {
  readonly width: number;
  readonly height: number;
  setSize(width: number, height: number): void;
  writeOutput(data: string): void;
  getOutput(): string[];
  clearOutput(): void;
}

/**
 * Virtual terminal implementation for headless mode
 */
export class HeadlessTerminal implements VirtualTerminal {
  private _width: number;
  private _height: number;
  private _output: string[] = [];
  private _onResize?: (size: { width: number; height: number }) => void;

  constructor(width = 80, height = 24) {
    this._width = width;
    this._height = height;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  setSize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    if (this._onResize) {
      this._onResize({ width, height });
    }
  }

  onResize(callback: (size: { width: number; height: number }) => void): void {
    this._onResize = callback;
  }

  writeOutput(data: string): void {
    // Store terminal output for debugging/inspection
    this._output.push(data);

    // Keep only last 1000 lines to prevent memory growth
    if (this._output.length > 1000) {
      this._output = this._output.slice(-1000);
    }
  }

  getOutput(): string[] {
    return [...this._output];
  }

  clearOutput(): void {
    this._output = [];
  }
}

/**
 * Mock Deno console functions for headless mode
 */
export class HeadlessDenoMock {
  private _terminal: HeadlessTerminal;
  private _originalDeno?: typeof Deno;

  constructor(terminal: HeadlessTerminal) {
    this._terminal = terminal;
  }

  /**
   * Install mock Deno functions for headless mode
   */
  install(): void {
    // Since we can't replace the global Deno object, we'll store overrides
    // and provide a getTerminalSize function that the engine can use
    // The actual mocking happens through the engine integration
  }

  /**
   * Get virtual terminal size for headless mode
   */
  getTerminalSize(): { columns: number; rows: number } {
    return {
      columns: this._terminal.width,
      rows: this._terminal.height,
    };
  }

  /**
   * Restore original Deno functions
   */
  restore(): void {
    // No-op since we don't replace global objects
  }

  /**
   * Simulate terminal resize for testing
   */
  simulateResize(width: number, height: number): void {
    this._terminal.setSize(width, height);
  }
}

/**
 * Check if headless mode should be enabled
 */
export function isHeadlessEnabled(): boolean {
  const config = MelkerConfig.get();

  return !!(
    config.headlessEnabled ||
    (config.debugPort && !Deno?.stdin?.isTerminal?.())
  );
}

/**
 * Get headless configuration from MelkerConfig
 */
export function getHeadlessConfig(): HeadlessOptions {
  const config = MelkerConfig.get();
  return {
    width: config.headlessWidth,
    height: config.headlessHeight,
    debugPort: config.debugPort,
    debugHost: config.debugHost,
    enableBufferCapture: true,
  };
}

/**
 * Setup headless environment
 */
export function setupHeadlessEnvironment(): {
  terminal: HeadlessTerminal;
  mock: HeadlessDenoMock;
  cleanup: () => void;
} {
  const config = getHeadlessConfig();
  const terminal = new HeadlessTerminal(config.width, config.height);
  const mock = new HeadlessDenoMock(terminal);

  // Install mocks
  mock.install();

  // Set environment to indicate headless mode
  if (typeof Deno !== 'undefined' && Deno.env) {
    Deno.env.set('MELKER_RUNNING_HEADLESS', 'true');
  }

  return {
    terminal,
    mock,
    cleanup: () => {
      mock.restore();
      if (typeof Deno !== 'undefined' && Deno.env) {
        Deno.env.delete('MELKER_RUNNING_HEADLESS');
      }
    },
  };
}

/**
 * Check if currently running in headless mode
 */
export function isRunningHeadless(): boolean {
  return Env.get('MELKER_RUNNING_HEADLESS') === 'true';
}

/**
 * Headless mode manager
 */
export class HeadlessManager {
  private _terminal: HeadlessTerminal;
  private _mock: HeadlessDenoMock;
  private _cleanup: () => void;
  private _isActive = false;

  constructor() {
    const setup = setupHeadlessEnvironment();
    this._terminal = setup.terminal;
    this._mock = setup.mock;
    this._cleanup = setup.cleanup;
  }

  /**
   * Start headless mode
   */
  start(): void {
    if (this._isActive) return;

    console.log('[Melker Headless] Starting headless mode');
    console.log(`[Melker Headless] Virtual terminal: ${this._terminal.width}×${this._terminal.height}`);

    this._isActive = true;
  }

  /**
   * Stop headless mode
   */
  stop(): void {
    if (!this._isActive) return;

    // console.log('[Melker Headless] Stopping headless mode');
    this._cleanup();
    this._isActive = false;
  }

  /**
   * Get virtual terminal
   */
  get terminal(): HeadlessTerminal {
    return this._terminal;
  }

  /**
   * Simulate window resize
   */
  resizeTerminal(width: number, height: number): void {
    this._terminal.setSize(width, height);
  }

  /**
   * Get captured terminal output
   */
  getTerminalOutput(): string[] {
    return this._terminal.getOutput();
  }

  /**
   * Clear captured output
   */
  clearTerminalOutput(): void {
    this._terminal.clearOutput();
  }

  /**
   * Check if headless mode is active
   */
  get isActive(): boolean {
    return this._isActive;
  }
}

// Global headless manager instance
let globalHeadlessManager: HeadlessManager | undefined;

/**
 * Get or create global headless manager
 */
export function getHeadlessManager(): HeadlessManager {
  if (!globalHeadlessManager) {
    globalHeadlessManager = new HeadlessManager();
  }
  return globalHeadlessManager;
}

/**
 * Initialize headless mode if enabled
 * Should be called before creating any Melker apps
 */
export function initializeHeadlessMode(): HeadlessManager | null {
  if (!isHeadlessEnabled()) {
    return null;
  }

  const manager = getHeadlessManager();
  manager.start();
  return manager;
}

/**
 * Cleanup headless mode
 */
export function cleanupHeadlessMode(): void {
  if (globalHeadlessManager) {
    globalHeadlessManager.stop();
    globalHeadlessManager = undefined;
  }
}