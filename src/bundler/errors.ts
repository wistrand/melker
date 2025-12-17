/**
 * Error handling and display for Melker bundler.
 *
 * This module provides:
 * - Fatal error display with source location and hints
 * - Error parsing to extract location info from bundler errors
 * - Error translation from bundled code back to original .melker
 */

import { getLogger } from '../logging.ts';
import type {
  ErrorContext,
  GeneratedSource,
  LineMapping,
  SourceMapData,
  TranslatedError,
  TranslatedFrame,
} from './types.ts';

const logger = getLogger('Bundler:Errors');

/**
 * Restore terminal to normal state (exit alternate screen, show cursor).
 * Safe to call even if terminal wasn't in TUI mode.
 */
function restoreTerminal(): void {
  try {
    // Exit alternate screen and show cursor
    const resetSequence = '\x1b[?1049l\x1b[?25h\x1b[0m';
    Deno.stdout.writeSync(new TextEncoder().encode(resetSequence));
  } catch {
    // Ignore errors (e.g., if stdout isn't a TTY)
  }
}

/**
 * Display a fatal error and exit the process.
 *
 * This function:
 * 1. Restores terminal to normal state (exit alternate screen, show cursor)
 * 2. Logs the full error to file via logger
 * 3. Prints a formatted error to console with location and hints
 * 4. Exits with code 1
 */
export function displayFatalError(
  phase: string,
  error: Error,
  context: ErrorContext
): never {
  // 1. Restore terminal first so error is visible
  restoreTerminal();

  // 2. Log full error to file
  logger.error(`Fatal error in ${phase}`, error, {
    filepath: context.filepath,
    sourceLocation: context.sourceLocation,
  });

  // 3. Print to console
  const lines: string[] = [];

  lines.push('');
  lines.push(`\x1b[31m\x1b[1mBundle Error: ${error.message}\x1b[0m`);
  lines.push('');

  if (context.sourceLocation && context.sourceLine) {
    const { line, column } = context.sourceLocation;
    lines.push(`  \x1b[36m${context.filepath}:${line}:${column}\x1b[0m`);
    lines.push('');
    lines.push(`    ${line.toString().padStart(4)} | ${context.sourceLine}`);
    if (column > 0) {
      lines.push(`         | ${' '.repeat(column)}\x1b[31m^\x1b[0m`);
    }
    lines.push('');
  } else {
    lines.push(`  \x1b[36m${context.filepath}\x1b[0m`);
    lines.push('');
  }

  if (context.hint) {
    lines.push(`\x1b[33mHint:\x1b[0m ${context.hint}`);
    lines.push('');
  }

  console.error(lines.join('\n'));

  // 4. Exit
  Deno.exit(1);
}

/**
 * Parsed information from a bundle error
 */
export interface ParsedBundleError {
  location?: { line: number; column: number };
  sourceLine?: string;
  hint?: string;
}

/**
 * Parse a bundler error to extract location and hints.
 *
 * Attempts to map the error back to the original .melker source using
 * the lineMap from code generation.
 */
export function parseBundleError(
  error: unknown,
  generated: GeneratedSource
): ParsedBundleError {
  const message = error instanceof Error ? error.message : String(error);

  logger.debug('Parsing bundle error', { message: message.substring(0, 200) });

  // Try to extract line:column from error message
  // Deno errors often include "at file:///path:line:column" or just ":line:column"
  const locationMatch = message.match(/:(\d+):(\d+)/);

  if (locationMatch) {
    const generatedLine = parseInt(locationMatch[1], 10);
    const column = parseInt(locationMatch[2], 10);

    logger.debug('Found location in error', { generatedLine, column });

    // Map back to original .melker line using lineMap
    const mapping = generated.lineMap.get(generatedLine);

    if (mapping) {
      const lines = generated.originalContent?.split('\n') || [];
      const sourceLine = lines[mapping.originalLine - 1];

      logger.debug('Mapped to original source', {
        originalLine: mapping.originalLine,
        sourceId: mapping.sourceId,
      });

      return {
        location: { line: mapping.originalLine, column },
        sourceLine,
        hint: getHintForError(message),
      };
    }
  }

  return { hint: getHintForError(message) };
}

/**
 * Get a helpful hint based on the error message.
 */
export function getHintForError(message: string): string | undefined {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('npm:') && lowerMessage.includes('not found')) {
    return 'Ensure --unstable-bundle flag is provided for npm: imports';
  }

  if (lowerMessage.includes('unexpected token')) {
    return 'Check for syntax errors: missing brackets, semicolons, or quotes';
  }

  if (
    lowerMessage.includes('cannot find module') ||
    lowerMessage.includes('module not found')
  ) {
    return 'Verify the import path is correct relative to the .melker file';
  }

  if (lowerMessage.includes('is not defined')) {
    const match = message.match(/(\w+) is not defined/i);
    if (match) {
      return `"${match[1]}" may be used before declaration, misspelled, or not exported`;
    }
    return 'Variable or function may be used before declaration, or misspelled';
  }

  if (lowerMessage.includes('cannot use import statement')) {
    return 'Import statements must be at the top level of a script block';
  }

  if (lowerMessage.includes('export')) {
    return 'Export statements are not supported in .melker scripts - variables are automatically available';
  }

  if (lowerMessage.includes('permission denied') || lowerMessage.includes('--allow')) {
    return 'Additional Deno permissions may be required (--allow-net, --allow-read, etc.)';
  }

  return undefined;
}

/**
 * Error translator for runtime errors.
 *
 * Translates errors from bundled code back to original .melker source
 * using both the bundle sourcemap and the generation lineMap.
 */
export class ErrorTranslator {
  constructor(
    private bundleSourceMap: SourceMapData | null,
    private lineMap: Map<number, LineMapping>,
    private originalSource: string,
    private sourceFile: string
  ) {}

  /**
   * Translate an error to point to original .melker source
   */
  translate(error: Error): TranslatedError {
    const frames = this.parseStack(error.stack || '');

    logger.debug('Translating error', {
      name: error.name,
      message: error.message,
      frameCount: frames.length,
    });

    return {
      name: error.name,
      message: error.message,
      frames: frames.map((f) => this.translateFrame(f)),
    };
  }

  /**
   * Translate a single stack frame
   */
  private translateFrame(frame: StackFrame): TranslatedFrame {
    // First, try to use bundle sourcemap to get generated TS position
    // Then use lineMap to get original .melker position

    // For now, we'll use a simplified approach that just uses lineMap
    // A full implementation would decode the VLQ sourcemap

    const mapping = this.findMapping(frame.line);

    if (!mapping) {
      return this.unknownFrame(frame);
    }

    const sourceLine = this.getSourceLine(mapping.originalLine);
    const context = this.getContext(frame.functionName);

    return {
      functionName: this.translateFunctionName(frame.functionName),
      file: this.sourceFile,
      line: mapping.originalLine,
      column: frame.column,
      sourceLine,
      context,
    };
  }

  /**
   * Find the best matching line mapping
   */
  private findMapping(generatedLine: number): LineMapping | undefined {
    // Direct lookup
    let mapping = this.lineMap.get(generatedLine);
    if (mapping) return mapping;

    // Try nearby lines (bundler may shift things slightly)
    for (let delta = 1; delta <= 5; delta++) {
      mapping = this.lineMap.get(generatedLine - delta);
      if (mapping) return mapping;
      mapping = this.lineMap.get(generatedLine + delta);
      if (mapping) return mapping;
    }

    return undefined;
  }

  /**
   * Find line mapping by source ID (e.g., "__h0", "script_0").
   * Returns the first matching mapping for that source.
   */
  findBySourceId(sourceId: string): LineMapping | undefined {
    for (const mapping of this.lineMap.values()) {
      if (mapping.sourceId === sourceId) {
        return mapping;
      }
    }
    return undefined;
  }

  /**
   * Get the source file path/URL
   */
  getSourceFile(): string {
    return this.sourceFile;
  }

  /**
   * Translate internal function names to user-friendly names
   */
  private translateFunctionName(name: string): string {
    if (name.match(/^__h\d+$/)) {
      return 'event handler';
    }
    if (name === '__init') return 'async init';
    if (name === '__ready') return 'async ready';
    return name;
  }

  /**
   * Determine the context type from function name
   */
  private getContext(name: string): TranslatedFrame['context'] {
    if (name.match(/^__h\d+$/)) return 'handler';
    if (name === '__init') return 'init';
    if (name === '__ready') return 'ready';
    return 'script';
  }

  /**
   * Get a source line from original content
   */
  private getSourceLine(line: number): string | null {
    const lines = this.originalSource.split('\n');
    return lines[line - 1] || null;
  }

  /**
   * Parse V8 stack trace format
   */
  private parseStack(stack: string): StackFrame[] {
    const frames: StackFrame[] = [];
    const lines = stack.split('\n');

    for (const line of lines) {
      // Match patterns like:
      // "    at functionName (file:///path:line:column)"
      // "    at file:///path:line:column"
      const match = line.match(
        /at\s+(?:([^\s(]+)\s+\()?(?:file:\/\/)?([^:]+):(\d+):(\d+)\)?/
      );

      if (match) {
        frames.push({
          functionName: match[1] || '<anonymous>',
          file: match[2],
          line: parseInt(match[3], 10),
          column: parseInt(match[4], 10),
        });
      }
    }

    return frames;
  }

  /**
   * Create an unknown frame (couldn't translate)
   */
  private unknownFrame(frame: StackFrame): TranslatedFrame {
    return {
      functionName: frame.functionName,
      file: frame.file,
      line: frame.line,
      column: frame.column,
      sourceLine: null,
      context: 'unknown',
    };
  }
}

/**
 * Internal stack frame representation
 */
interface StackFrame {
  functionName: string;
  file: string;
  line: number;
  column: number;
}

/**
 * Format a translated error for console display.
 */
export function formatError(error: TranslatedError): string {
  const lines: string[] = [];

  lines.push(`\x1b[31m${error.name}: ${error.message}\x1b[0m`);
  lines.push('');

  for (const frame of error.frames) {
    if (frame.context === 'unknown') continue;

    const location = `${frame.file}:${frame.line}`;
    lines.push(`  at \x1b[33m${frame.functionName}\x1b[0m (${location})`);

    if (frame.sourceLine) {
      const lineNum = String(frame.line).padStart(4);
      lines.push('    |');
      lines.push(`    | \x1b[90m${lineNum}\x1b[0m | ${frame.sourceLine}`);
      lines.push('    |');
    }
  }

  return lines.join('\n');
}

/**
 * Check if Deno.bundle() is available.
 */
export function isBundleAvailable(): boolean {
  return typeof (Deno as any).bundle === 'function';
}

/**
 * Get a message explaining how to enable Deno.bundle()
 */
export function getBundleUnavailableHint(): string {
  return 'Run with: deno run --unstable-bundle --allow-all melker.ts <file.melker>';
}
