// Global type declarations for Melker
// This file provides type safety for global variables used throughout the codebase

import type { MelkerEngine } from './engine.ts';
import type { Element } from './types.ts';
import type { MelkerConfig } from './config/config.ts';

/**
 * Handler function registry for .melker file event handlers
 */
export interface MelkerRegistry {
  [id: string]: ((...args: unknown[]) => unknown) | undefined;
}

/**
 * Logger interface for $melker.logger
 */
export interface MelkerLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Context object exposed to .melker app scripts as $melker
 */
export interface MelkerContext {
  // Source info
  url: string;
  dirname: string;

  // App exports
  exports: Record<string, unknown>;

  // DOM-like APIs
  getElementById(id: string): Element | null;
  focus(id: string): void;
  createElement(type: string, props?: Record<string, unknown>, ...children: unknown[]): Element;

  // Render control
  render(): void;
  skipRender(): void;
  /** @internal */
  _shouldSkipRender(): boolean;

  // App lifecycle
  exit(): Promise<void>;
  quit(): Promise<void>;
  setTitle(title: string): void;

  // Dialogs
  alert(message: string): void;
  confirm(message: string): Promise<boolean>;
  prompt(message: string, defaultValue?: string): Promise<string | null>;

  // System integration
  copyToClipboard(text: string): Promise<boolean>;
  openBrowser(url: string): Promise<boolean>;

  // Engine access
  engine: MelkerEngine;

  // Logging
  logger: MelkerLogger | null;
  logging: MelkerLogger | null;
  getLogger(name: string): MelkerLogger;

  // State persistence
  persistenceEnabled: boolean;
  stateFilePath: string | null;

  // OAuth (when configured)
  oauth: unknown;
  oauthConfig: unknown;

  // Dynamic imports
  melkerImport(specifier: string): Promise<unknown>;

  // AI tools
  registerAITool(tool: unknown): void;

  // Config
  config: MelkerConfig;
  cacheDir: string;

  // Allow additional properties
  [key: string]: unknown;
}

/**
 * String handler with embedded code (for .melker file handlers)
 */
export interface StringHandler {
  __isStringHandler: true;
  __handlerCode: string;
}

declare global {
  /**
   * The global Melker engine instance (set during engine initialization)
   */
  var melkerEngine: MelkerEngine | undefined;

  /**
   * Render request function for components to trigger re-renders
   */
  var __melkerRequestRender: (() => void) | undefined;

  /**
   * Current render count for debugging
   */
  var melkerRenderCount: number | undefined;

  /**
   * Context object for .melker app scripts
   */
  var $melker: MelkerContext | undefined;

  /**
   * Alias for $melker.exports - app-defined exports
   */
  var $app: Record<string, unknown> | undefined;

  /**
   * Command-line arguments passed to the .melker app
   */
  var argv: string[] | undefined;

  /**
   * Handler registry for .melker file event handlers
   */
  var __melker: MelkerRegistry | undefined;

  /**
   * Emergency cleanup function for terminal restoration
   */
  var _melkerEmergencyCleanup: (() => void) | undefined;

  /**
   * Global logger instance (when available)
   */
  var logger: MelkerLogger | undefined;

}

export {};
