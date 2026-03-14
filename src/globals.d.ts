// Global type declarations for Melker
// This file provides type safety for global variables used throughout the codebase

import type { MelkerEngine } from './engine.ts';
import type { Element } from './types.ts';
import type { MelkerConfig } from './config/config.ts';
import type { I18n } from './i18n/i18n-engine.ts';

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
  querySelector(selector: string): Element | null;
  querySelectorAll(selector: string): Element[];
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

  // Toast notifications
  toast: {
    show(message: string, options?: {
      type?: 'info' | 'success' | 'warning' | 'error';
      duration?: number;
      closable?: boolean;
      bell?: boolean;
      action?: { label: string; onClick: () => void };
    }): string;
    dismiss(id: string): void;
    dismissAll(): void;
    setPosition(position: 'top' | 'bottom'): void;
  };

  // Dev Tools
  devtools: {
    show(): void;
    hide(): void;
    toggle(): void;
    isOpen(): boolean;
  };

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

  // State bindings
  /** Register a state object for declarative bindings. One call per app. */
  createState<T extends Record<string, unknown>>(initial: T): T;

  // OAuth (when configured)
  oauth: unknown;
  oauthConfig: unknown;

  // Dynamic imports
  melkerImport(specifier: string): Promise<unknown>;

  // AI tools
  registerAITool(tool: unknown): void;

  // AI utilities
  ai: {
    /**
     * Create a streaming extractor for OpenAI-compatible SSE responses.
     * Progressively extracts JSON string fields during streaming.
     *
     * @param body - ReadableStream from fetch response (response.body)
     * @param options - Field callbacks, completion handler, error handler
     * @returns Object with `result` promise (resolves to full text) and `abort()` method
     *
     * @example
     * const res = await fetch(url, { ... });
     * const stream = $melker.ai.createStreamingExtractor(res.body, {
     *   onField: {
     *     narrative: (partial, complete) => {
     *       textEl.props.text = partial;
     *       $melker.render();
     *     },
     *   },
     *   onComplete: (json) => applyResponse(json),
     *   onError: (err) => showError(err.message),
     * });
     * const fullText = await stream.result;
     */
    createStreamingExtractor(
      body: ReadableStream<Uint8Array>,
      options?: {
        onField?: Record<string, (partial: string, complete: boolean) => void>;
        onContent?: (content: string) => void;
        onComplete?: (json: unknown) => void;
        onError?: (error: Error) => void;
      }
    ): {
      result: Promise<string>;
      abort(): void;
    };

    /**
     * Extract an image from an OpenAI-compatible API response.
     * Normalizes all known response formats (OpenRouter, Gemini, DALL-E, etc.)
     * into a `data:` URL string.
     *
     * @param json - Parsed JSON response from the API
     * @param options - Optional abort signal for secondary fetches (remote URL formats)
     * @returns data: URL string
     *
     * @example
     * const res = await fetch(url, { method: 'POST', ... });
     * const json = await res.json();
     * const dataUrl = await $melker.ai.extractImageFromResponse(json, { signal });
     */
    extractImageFromResponse(
      json: unknown,
      options?: { signal?: AbortSignal }
    ): Promise<string>;
  };

  // Config
  config: MelkerConfig;
  cacheDir: string;

  // Cache API
  cache: import('./core-types.ts').EngineCacheAPI;

  // I18n (when <messages> elements or i18n config present)
  i18n?: I18n;

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

export {};
