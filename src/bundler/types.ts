/**
 * Type definitions for the Melker runtime bundler.
 *
 * This module defines interfaces for source position tracking, parsed scripts
 * and handlers, generated code, and bundle results.
 */

// =============================================================================
// Source Position Tracking
// =============================================================================

/** A position in source code */
export interface SourcePosition {
  /** 1-indexed line number */
  line: number;
  /** 0-indexed column number */
  column: number;
  /** Byte offset from start of file */
  offset: number;
}

/** A range in source code from start to end */
export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

// =============================================================================
// Parsed Elements
// =============================================================================

/** Type of script block based on async attribute */
export type ScriptType = 'sync' | 'init' | 'ready';

/** A parsed <script type="typescript"> block */
export interface ParsedScript {
  /** Unique identifier (e.g., "script_0", "script_1") */
  id: string;
  /** Block type: sync (default), init (before render), ready (after render) */
  type: ScriptType;
  /** TypeScript source code */
  code: string;
  /** External source path if src attribute present */
  externalSrc?: string;
  /** Whether code contains await keyword (auto-detected) */
  isAsync: boolean;
  /** Position in original .melker file */
  sourceRange: SourceRange;
}

/** Parameter for an event handler */
export interface HandlerParam {
  name: string;
  type: string;
}

/** A parsed event handler attribute (e.g., onClick="...") */
export interface ParsedHandler {
  /** Generated function name: __h0, __h1, etc. */
  id: string;
  /** Original attribute name: onClick, onKeyPress, etc. */
  attributeName: string;
  /** TypeScript code from attribute value */
  code: string;
  /** Whether code contains await keyword */
  isAsync: boolean;
  /** Parameters passed to handler */
  params: HandlerParam[];
  /** Position of entire attribute in source */
  attributeRange: SourceRange;
  /** Position of just the code value (inside quotes) */
  codeRange: SourceRange;
  /** Info about containing element for error messages */
  element: {
    tag: string;
    id?: string;
    line: number;
  };
}

// =============================================================================
// Parse Result
// =============================================================================

/** Result of parsing a .melker file */
export interface ParseResult {
  /** Absolute URL of source file */
  sourceUrl: string;
  /** Original file content (before ${} resolution) */
  originalContent: string;
  /** Content after ${} resolution */
  resolvedContent: string;
  /** Extracted script blocks in document order */
  scripts: ParsedScript[];
  /** Extracted event handlers in document order */
  handlers: ParsedHandler[];
  /** Template content (everything except script blocks) */
  template: string;
}

// =============================================================================
// Generated Source
// =============================================================================

/** Mapping from a generated line to its original source */
export interface LineMapping {
  /** Line number in generated TypeScript (1-indexed) */
  generatedLine: number;
  /** Corresponding line in original .melker (1-indexed) */
  originalLine: number;
  /** Source identifier (script block id or handler id) */
  sourceId: string;
  /** Description for debugging */
  description: string;
}

/** A script module file to be written before bundling */
export interface ScriptModule {
  /** Relative filename within temp dir (e.g., "_inline_0.ts") */
  filename: string;
  /** TypeScript content for this module */
  content: string;
  /** Original line in .melker file for error mapping */
  originalLine: number;
  /** Source identifier for error messages */
  sourceId: string;
}

/** Result of TypeScript code generation */
export interface GeneratedSource {
  /** Generated TypeScript code (main entry point) */
  code: string;
  /** Script module files to write alongside main entry */
  scriptModules: ScriptModule[];
  /** Mapping from generated lines to original .melker lines */
  lineMap: Map<number, LineMapping>;
  /** Original .melker content for error display */
  originalContent: string;
  /** Source URL for error messages */
  sourceUrl: string;
}

// =============================================================================
// Bundle Result
// =============================================================================

/** Standard V3 sourcemap format */
export interface SourceMapData {
  version: number;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
  file?: string;
  sourceRoot?: string;
}

/** Result of bundling with Deno.bundle() */
export interface BundleResult {
  /** Bundled JavaScript code */
  code: string;
  /** Sourcemap from Deno.bundle() */
  sourceMap: SourceMapData | null;
  /** Any warnings from bundler */
  warnings: string[];
}

// =============================================================================
// Assembled Output
// =============================================================================

/** Final assembled .melker ready for execution */
export interface AssembledMelker {
  /** Template with rewritten handlers (onClick="__melker.__h0(event)") */
  template: string;
  /** Bundled JavaScript code */
  bundledCode: string;
  /** Line mapping for error translation */
  lineMap: Map<number, LineMapping>;
  /** Sourcemap from bundler */
  bundleSourceMap: SourceMapData | null;
  /** Original source content */
  originalContent: string;
  /** Source file path/URL */
  sourceUrl: string;
}

// =============================================================================
// Runtime Registry
// =============================================================================

/** The __melker registry exposed on globalThis */
export interface MelkerRegistry {
  /** Async init function (called before render) */
  __init?: () => Promise<void>;
  /** Async ready function (called after render) */
  __ready?: () => Promise<void>;
  /** Event handlers (__h0, __h1, etc.) */
  [key: `__h${number}`]: (event?: unknown) => void | Promise<void>;
}

// =============================================================================
// Cache
// =============================================================================

/** Cached bundle entry */
export interface CacheEntry {
  /** Hash of original content */
  contentHash: string;
  /** Bundled JavaScript */
  bundledCode: string;
  /** Line mapping for errors (serialized) */
  lineMap: Array<[number, LineMapping]>;
  /** Processed template */
  template: string;
  /** Deno version used for bundling */
  denoVersion: string;
  /** Timestamp of cache creation */
  timestamp: number;
}

// =============================================================================
// Error Translation
// =============================================================================

/** A translated stack frame pointing to original source */
export interface TranslatedFrame {
  functionName: string;
  file: string;
  line: number;
  column: number;
  sourceLine: string | null;
  context: 'script' | 'handler' | 'init' | 'ready' | 'unknown';
}

/** A fully translated error with stack frames */
export interface TranslatedError {
  name: string;
  message: string;
  frames: TranslatedFrame[];
}

/** Context for fatal error display */
export interface ErrorContext {
  filepath: string;
  sourceLocation?: { line: number; column: number };
  sourceLine?: string;
  hint?: string;
}

// =============================================================================
// Bundle Options
// =============================================================================

/** Options for the bundle process */
export interface BundleOptions {
  /** Minify output (default: false) */
  minify?: boolean;
  /** Use bundle cache (default: false - cache disabled by default) */
  useCache?: boolean;
  /** Enable debug output (default: false) */
  debug?: boolean;
}
