/**
 * Error handling and display for Melker bundler.
 *
 * This module provides:
 * - Fatal error display with source location and hints
 * - Error parsing to extract location info from bundler errors
 * - Error translation from bundled code back to original .melker
 */

import { getLogger } from '../logging.ts';
import { restoreTerminal } from '../terminal-lifecycle.ts';
import { exit } from '../runtime/mod.ts';
import type {
  ErrorContext,
  GeneratedSource,
  LineMapping,
  ScriptMeta,
  SourceMapData,
  TranslatedError,
  TranslatedFrame,
} from './types.ts';

// Re-export restoreTerminal for backwards compatibility
export { restoreTerminal } from '../terminal-lifecycle.ts';

const logger = getLogger('Bundler:Errors');

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
  exit(1);
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
  // Lazily computed bundled-line → .melker-line mapping from sourcemap + script metadata
  private _bundleToMelker: Map<number, number> | null = null;

  constructor(
    private bundleSourceMap: SourceMapData | null,
    private lineMap: Map<number, LineMapping>,
    private originalSource: string,
    private sourceFile: string,
    private scriptMeta?: ScriptMeta[]
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
    // Try direct sourcemap mapping (bundled line → .melker line via script metadata)
    const directMapping = this.getBundleToMelkerMap().get(frame.line);
    if (directMapping !== undefined) {
      const sourceLine = this.getSourceLine(directMapping);
      const context = this.getContext(frame.functionName);
      return {
        functionName: this.translateFunctionName(frame.functionName),
        file: this.sourceFile,
        line: directMapping,
        column: frame.column,
        sourceLine,
        context,
      };
    }

    // Fallback: try lineMap lookup (for handler code in the generated entry point)
    const mapping = this.findMapping(frame.line);
    if (mapping) {
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

    return this.unknownFrame(frame);
  }

  /**
   * Build bundled-line → .melker-line map using sourcemap + script metadata.
   *
   * The sourcemap maps bundled JS → temp source files (_inline_0.ts, _init_0.ts, etc.).
   * Script metadata maps those temp files → .melker lines.
   * Combined: bundled line → source file + source line → .melker line.
   */
  private getBundleToMelkerMap(): Map<number, number> {
    if (this._bundleToMelker) return this._bundleToMelker;

    this._bundleToMelker = new Map();
    if (!this.bundleSourceMap?.mappings || !this.scriptMeta?.length) {
      return this._bundleToMelker;
    }

    try {
      const mappings = this.bundleSourceMap.mappings;
      const sources = this.bundleSourceMap.sources || [];

      // Build lookup: source index → script metadata
      const sourceToMeta = new Map<number, ScriptMeta>();
      for (let si = 0; si < sources.length; si++) {
        const sourceName = sources[si];
        // Match by filename (sources may have full paths)
        for (const meta of this.scriptMeta) {
          if (sourceName.endsWith(meta.filename) || sourceName.endsWith('/' + meta.filename)) {
            sourceToMeta.set(si, meta);
            break;
          }
        }
      }

      if (sourceToMeta.size === 0) return this._bundleToMelker;

      // Decode VLQ mappings
      let sourceLineState = 0;
      let sourceColState = 0;
      let sourceIdxState = 0;

      const groups = mappings.split(';');

      for (let bundledLine = 0; bundledLine < groups.length; bundledLine++) {
        const group = groups[bundledLine];
        if (!group) continue;

        let genCol = 0;
        let firstMelkerLine: number | undefined;

        const segments = group.split(',');
        for (const seg of segments) {
          if (!seg) continue;
          const decoded = decodeVlqSegment(seg);
          if (decoded.length < 4) continue;

          genCol += decoded[0];
          sourceIdxState += decoded[1];
          sourceLineState += decoded[2];
          sourceColState += decoded[3];

          if (firstMelkerLine === undefined) {
            const meta = sourceToMeta.get(sourceIdxState);
            if (meta) {
              // Source line in temp file (0-indexed) minus header = line within script code
              // Add script's .melker line offset
              const lineInScript = sourceLineState - meta.headerLines;
              if (lineInScript >= 0) {
                firstMelkerLine = meta.originalLine + lineInScript;
              }
            }
          }
        }

        if (firstMelkerLine !== undefined) {
          this._bundleToMelker.set(bundledLine + 1, firstMelkerLine);
        }
      }
    } catch (e) {
      logger.debug('Failed to decode sourcemap VLQ', { error: String(e) });
    }

    return this._bundleToMelker;
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
    if (name === '__init' || name.match(/^__initFn/)) return 'async init';
    if (name === '__ready' || name.match(/^__readyFn/)) return 'async ready';
    return name;
  }

  /**
   * Determine the context type from function name
   */
  private getContext(name: string): TranslatedFrame['context'] {
    if (name.match(/^__h\d+$/)) return 'handler';
    if (name === '__init' || name.match(/^__initFn/)) return 'init';
    if (name === '__ready' || name.match(/^__readyFn/)) return 'ready';
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
      // Match data: URLs first (from bundled code loaded via data: URL)
      // Pattern: "at functionName (data:application/javascript;base64,...:line:column)"
      const dataMatch = line.match(
        /at\s+(?:([^\s(]+)\s+\()?data:[^:]+;base64,[^:]+:(\d+):(\d+)\)?/
      );
      if (dataMatch) {
        frames.push({
          functionName: dataMatch[1] || '<anonymous>',
          file: '<bundle>',
          line: parseInt(dataMatch[2], 10),
          column: parseInt(dataMatch[3], 10),
        });
        continue;
      }

      // Match file:// URLs and plain paths
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
 * Decode a single VLQ segment from a V3 sourcemap.
 * Returns array of decoded values (typically [genCol, sourceIdx, sourceLine, sourceCol]).
 */
const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeVlqSegment(segment: string): number[] {
  const values: number[] = [];
  let shift = 0;
  let value = 0;

  for (let i = 0; i < segment.length; i++) {
    const charIdx = VLQ_CHARS.indexOf(segment[i]);
    if (charIdx === -1) break;

    const hasContinuation = (charIdx & 32) !== 0;
    value += (charIdx & 31) << shift;
    shift += 5;

    if (!hasContinuation) {
      // Sign is stored in least significant bit
      const isNegative = (value & 1) !== 0;
      const decoded = value >> 1;
      values.push(isNegative ? -decoded : decoded);
      value = 0;
      shift = 0;
    }
  }

  return values;
}

/**
 * Format a translated error for console display.
 */
export function formatError(error: TranslatedError): string {
  const lines: string[] = [];

  lines.push(`\x1b[31m${error.name}: ${error.message}\x1b[0m`);
  lines.push('');

  const usefulFrames = error.frames.filter((f) => f.context !== 'unknown');

  for (const frame of usefulFrames) {
    const location = `${frame.file}:${frame.line}`;
    lines.push(`  at \x1b[33m${frame.functionName}\x1b[0m (\x1b[36m${location}\x1b[0m)`);

    if (frame.sourceLine) {
      const lineNum = String(frame.line).padStart(4);
      lines.push('    |');
      lines.push(`    | \x1b[90m${lineNum}\x1b[0m | ${frame.sourceLine}`);
      lines.push('    |');
    }
  }

  const hint = getHintForError(error.message);
  if (hint) {
    lines.push('');
    lines.push(`\x1b[33mHint:\x1b[0m ${hint}`);
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
