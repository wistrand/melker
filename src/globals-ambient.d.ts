// Ambient global type declarations for Melker
// This file provides type safety for globalThis.* variables used throughout the codebase.
// Kept separate from globals.d.ts to avoid JSR's "modifying global types" restriction.
// Not imported as a module — referenced via deno.json compilerOptions or triple-slash.

import type { MelkerEngine } from './engine.ts';
import type { MelkerContext, MelkerRegistry, MelkerLogger } from './globals.d.ts';

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
