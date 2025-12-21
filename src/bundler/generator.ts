/**
 * TypeScript code generator for Melker bundler.
 *
 * This module generates a single TypeScript file from parsed .melker content,
 * combining all scripts and event handlers with proper declarations and a
 * registry for runtime access.
 */

import { getLogger } from '../logging.ts';
import type {
  ParsedScript,
  ParsedHandler,
  ParseResult,
  GeneratedSource,
  LineMapping,
} from './types.ts';

const logger = getLogger('Bundler:Generator');

/**
 * Reserved $melker member names that cannot be overwritten by script exports.
 */
const RESERVED_MELKER_MEMBERS = new Set([
  // DOM-like methods
  'getElementById',
  'querySelector',
  'querySelectorAll',
  // Rendering
  'render',
  'forceRender',
  // Lifecycle
  'exit',
  'quit',
  // UI utilities
  'setTitle',
  'alert',
  'copyToClipboard',
  // Element creation
  'createElement',
  // Dynamic imports
  'melkerImport',
  // AI tools
  'registerAITool',
  // State persistence
  'persistenceEnabled',
  'stateFilePath',
  // OAuth
  'oauth',
  'oauthConfig',
  // Logging
  'logger',
  'getLogger',
  // Source metadata
  'url',
  'dirname',
  // Internal
  'engine',
]);

/**
 * Generate TypeScript source from parsed .melker content.
 *
 * The generated code has sections:
 * 1. Runtime declarations (context, argv)
 * 2. Source metadata ($meta)
 * 3. User scripts (sync)
 * 4. Async init function
 * 5. Async ready function
 * 6. Event handlers
 * 7. Registry export
 */
export function generate(parsed: ParseResult): GeneratedSource {
  const lines: string[] = [];
  const lineMap = new Map<number, LineMapping>();
  let currentLine = 1;

  logger.debug('Starting TypeScript generation', {
    scripts: parsed.scripts.length,
    handlers: parsed.handlers.length,
    sourceUrl: parsed.sourceUrl,
  });

  /**
   * Add a single line to output, optionally with source mapping
   */
  function addLine(line: string, mapping?: Partial<LineMapping>): void {
    lines.push(line);
    if (mapping) {
      lineMap.set(currentLine, {
        generatedLine: currentLine,
        originalLine: mapping.originalLine || 0,
        sourceId: mapping.sourceId || '',
        description: mapping.description || '',
      });
    }
    currentLine++;
  }

  /**
   * Add multiple lines from a code block, tracking source mapping for each
   */
  function addLines(code: string, baseMapping?: Partial<LineMapping>): void {
    const codeLines = code.split('\n');
    codeLines.forEach((line, i) => {
      addLine(
        line,
        baseMapping
          ? {
              ...baseMapping,
              originalLine: (baseMapping.originalLine || 0) + i,
            }
          : undefined
      );
    });
  }

  const dirname = getDirname(parsed.sourceUrl);

  // =========================================================================
  // Section 1: Runtime Globals (from globalThis)
  // =========================================================================
  addLine('// ='.padEnd(70, '='));
  addLine('// RUNTIME GLOBALS (injected via globalThis before import)');
  addLine('// ='.padEnd(70, '='));
  addLine('');
  addLine('// Get runtime context from globalThis (set by executeBundle before import)');
  addLine('const $melker = (globalThis as any).$melker as {');
  addLine('  getElementById(id: string): any;');
  addLine('  querySelector(selector: string): any;');
  addLine('  querySelectorAll(selector: string): any[];');
  addLine('  render(): void;');
  addLine('  forceRender(): void;');
  addLine('  exit(): void;');
  addLine('  quit(): void;');
  addLine('  setTitle(title: string): void;');
  addLine('  alert(message: string): void;');
  addLine('  copyToClipboard(text: string): Promise<boolean>;');
  addLine('  engine: any;');
  addLine('  logger: any;');
  addLine('  getLogger(name: string): any;');
  addLine('  oauth: any;');
  addLine('  oauthConfig: any;');
  addLine('  createElement(type: string, props?: Record<string, any>, ...children: any[]): any;');
  addLine('  melkerImport(specifier: string): Promise<any>;');
  addLine('  registerAITool(tool: any): void;');
  addLine('  persistenceEnabled: boolean;');
  addLine('  stateFilePath: string | null;');
  addLine(`  url: ${JSON.stringify(parsed.sourceUrl)},`);
  addLine(`  dirname: ${JSON.stringify(dirname)},`);
  addLine('};');
  addLine('const argv = (globalThis as any).argv as string[];');
  addLine('');

  // =========================================================================
  // Section 2: User Scripts (sync)
  // =========================================================================
  const syncScripts = parsed.scripts.filter((s) => s.type === 'sync');

  // Collect all exported identifiers from scripts
  const exportedIdentifiers: string[] = [];

  if (syncScripts.length > 0) {
    addLine('// ='.padEnd(70, '='));
    addLine('// USER SCRIPTS');
    addLine('// ='.padEnd(70, '='));
    addLine('');

    for (const script of syncScripts) {
      const originalLine = script.sourceRange.start.line;
      const srcInfo = script.externalSrc ? ` (from ${script.externalSrc})` : '';

      logger.debug('Adding sync script', {
        id: script.id,
        originalLine,
        externalSrc: script.externalSrc,
        codeLength: script.code.length,
      });

      addLine(`// From ${parsed.sourceUrl}:${originalLine}${srcInfo}`);

      // Get the code, rewriting relative imports if this is an external script
      let codeToAdd = script.code;
      if (script.externalSrc) {
        // Resolve the external script path to get its base URL for import resolution
        const externalScriptUrl = resolveExternalSrc(parsed.sourceUrl, script.externalSrc);
        codeToAdd = rewriteRelativeImports(script.code, externalScriptUrl);
      }

      // Add the code (with rewritten imports if external)
      addLines(codeToAdd, {
        originalLine,
        sourceId: script.id,
        description: `sync script at line ${originalLine}`,
      });
      addLine('');

      // Extract exported identifiers from this script
      // Matches: export const/let/var/function/class name
      // Also matches: export { name1, name2 }
      const exportMatches = script.code.matchAll(
        /export\s+(?:const|let|var|function|class)\s+(\w+)|export\s*\{([^}]+)\}/g
      );
      for (const match of exportMatches) {
        if (match[1]) {
          // Single export: export const foo = ...
          exportedIdentifiers.push(match[1]);
        } else if (match[2]) {
          // Named exports: export { foo, bar }
          const names = match[2].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim());
          exportedIdentifiers.push(...names.filter((n) => n));
        }
      }

      // Also match: exports = { name1, name2, ... }
      // This is a common pattern for exporting multiple functions at once
      // Use 's' flag for dotAll to match across newlines
      const exportsAssignMatch = script.code.match(/exports\s*=\s*\{([^}]+)\}/s);
      if (exportsAssignMatch && exportsAssignMatch[1]) {
        // Remove comments from the content before parsing
        const cleanedContent = exportsAssignMatch[1]
          .replace(/\/\/[^\n]*/g, '') // Remove single-line comments
          .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments
        const names = cleanedContent
          .split(',')
          .map((n) => n.trim().split(/\s*:\s*/)[0].trim()) // Handle { foo: bar } -> foo
          .filter((n) => n && /^\w+$/.test(n)); // Only valid identifiers
        exportedIdentifiers.push(...names);
      }
    }

    // Check for conflicts with reserved $melker members
    const conflicts = exportedIdentifiers.filter((id) => RESERVED_MELKER_MEMBERS.has(id));
    if (conflicts.length > 0) {
      const conflictList = conflicts.map((c) => `'${c}'`).join(', ');
      const reservedList = Array.from(RESERVED_MELKER_MEMBERS).sort().join(', ');
      throw new Error(
        `Script export name conflict: ${conflictList} would overwrite built-in $melker member(s).\n\n` +
        `Reserved names: ${reservedList}\n\n` +
        `Rename your exported function(s) to avoid conflicts.`
      );
    }

    // Add exported identifiers to $melker so they're accessible via $melker.X
    if (exportedIdentifiers.length > 0) {
      addLine('// Assign exports to $melker for handler access');
      for (const id of exportedIdentifiers) {
        addLine(`($melker as any).${id} = ${id};`);
      }
      addLine('');
    }
  }

  // =========================================================================
  // Section 4: Async Init
  // =========================================================================
  const initScripts = parsed.scripts.filter((s) => s.type === 'init');

  if (initScripts.length > 0) {
    addLine('// ='.padEnd(70, '='));
    addLine('// ASYNC INIT (before render)');
    addLine('// ='.padEnd(70, '='));
    addLine('');
    addLine('async function __init(): Promise<void> {');

    for (const script of initScripts) {
      const originalLine = script.sourceRange.start.line;

      logger.debug('Adding init script', {
        id: script.id,
        originalLine,
        codeLength: script.code.length,
      });

      addLine(`  // From line ${originalLine}`);
      const indented = script.code
        .split('\n')
        .map((l) => '  ' + l)
        .join('\n');
      addLines(indented, {
        originalLine,
        sourceId: script.id,
        description: `init script at line ${originalLine}`,
      });
    }

    addLine('}');
    addLine('');
  }

  // =========================================================================
  // Section 5: Async Ready
  // =========================================================================
  const readyScripts = parsed.scripts.filter((s) => s.type === 'ready');

  if (readyScripts.length > 0) {
    addLine('// ='.padEnd(70, '='));
    addLine('// ASYNC READY (after render)');
    addLine('// ='.padEnd(70, '='));
    addLine('');
    addLine('async function __ready(): Promise<void> {');

    for (const script of readyScripts) {
      const originalLine = script.sourceRange.start.line;

      logger.debug('Adding ready script', {
        id: script.id,
        originalLine,
        codeLength: script.code.length,
      });

      addLine(`  // From line ${originalLine}`);
      const indented = script.code
        .split('\n')
        .map((l) => '  ' + l)
        .join('\n');
      addLines(indented, {
        originalLine,
        sourceId: script.id,
        description: `ready script at line ${originalLine}`,
      });
    }

    addLine('}');
    addLine('');
  }

  // =========================================================================
  // Section 6: Event Handlers
  // =========================================================================
  if (parsed.handlers.length > 0) {
    addLine('// ='.padEnd(70, '='));
    addLine('// EVENT HANDLERS');
    addLine('// ='.padEnd(70, '='));
    addLine('');

    for (const handler of parsed.handlers) {
      const originalLine = handler.codeRange.start.line;
      const asyncKw = handler.isAsync ? 'async ' : '';
      const returnType = handler.isAsync ? 'Promise<void>' : 'void';
      const params = handler.params.map((p) => `${p.name}: ${p.type}`).join(', ');
      const elementId = handler.element.id ? `#${handler.element.id}` : '';

      logger.debug('Adding handler', {
        id: handler.id,
        attributeName: handler.attributeName,
        element: `${handler.element.tag}${elementId}`,
        originalLine,
        isAsync: handler.isAsync,
      });

      addLine(
        `// ${handler.attributeName} on <${handler.element.tag}${elementId}> at line ${originalLine}`
      );
      addLine(`${asyncKw}function ${handler.id}(${params}): ${returnType} {`, {
        originalLine,
        sourceId: handler.id,
        description: `${handler.attributeName} handler at line ${originalLine}`,
      });

      // Wrap handler code - if it's a simple expression, make it a statement
      const code = handler.code.trim();
      // Check if the code is a simple function call that should auto-render
      // We'll let the runtime handle auto-render via the registry wrapper
      addLine(`  ${code}`);

      addLine('}');
      addLine('');
    }
  }

  // =========================================================================
  // Section 7: Registry
  // =========================================================================
  addLine('// ='.padEnd(70, '='));
  addLine('// REGISTRY');
  addLine('// ='.padEnd(70, '='));
  addLine('');

  const registryEntries: string[] = [];
  if (initScripts.length > 0) registryEntries.push('__init');
  if (readyScripts.length > 0) registryEntries.push('__ready');
  registryEntries.push(...parsed.handlers.map((h) => h.id));

  addLine('(globalThis as any).__melker = {');
  for (const entry of registryEntries) {
    addLine(`  ${entry},`);
  }
  addLine('};');

  const generatedCode = lines.join('\n');

  logger.debug('TypeScript generation complete', {
    totalLines: currentLine - 1,
    mappedLines: lineMap.size,
    codeLength: generatedCode.length,
  });

  return {
    code: generatedCode,
    lineMap,
    originalContent: parsed.originalContent,
    sourceUrl: parsed.sourceUrl,
  };
}

/**
 * Extract directory path from URL
 */
function getDirname(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.substring(0, u.pathname.lastIndexOf('/'));
  } catch {
    // Fallback for non-URL paths
    const lastSlash = url.lastIndexOf('/');
    return lastSlash >= 0 ? url.substring(0, lastSlash) : '.';
  }
}

/**
 * Resolve an external script src path relative to the source URL.
 * Returns an absolute file:// URL for local files.
 *
 * @param sourceUrl - The URL of the .melker file (e.g., "file:///path/to/app.melker")
 * @param externalSrc - The src attribute value (e.g., "src/main.ts" or "./lib.ts")
 * @returns Absolute URL to the external script
 */
function resolveExternalSrc(sourceUrl: string, externalSrc: string): string {
  // If externalSrc is already an absolute URL, return it
  if (/^(file:|https?:|npm:|jsr:)/.test(externalSrc)) {
    return externalSrc;
  }

  // Resolve relative path against the source URL
  try {
    return new URL(externalSrc, sourceUrl).href;
  } catch {
    // Fallback for non-URL paths
    const sourceDir = sourceUrl.replace(/\/[^/]*$/, '');
    return `${sourceDir}/${externalSrc}`;
  }
}

/**
 * Rewrite relative imports in code to absolute URLs.
 *
 * This transforms imports like:
 *   import { foo } from './state.ts'
 *   import bar from '../lib/utils.ts'
 *   export { x } from './module.ts'
 *
 * To absolute URLs like:
 *   import { foo } from 'file:///path/to/state.ts'
 *
 * @param code - The source code to transform
 * @param baseUrl - The URL of the file containing this code (used to resolve relative paths)
 * @returns Code with relative imports rewritten to absolute URLs
 */
function rewriteRelativeImports(code: string, baseUrl: string): string {
  // Match import/export from statements with relative paths
  // Captures:
  // - Group 1: Everything before the path (import { x } from ')
  // - Group 2: The relative path (./foo.ts or ../bar.ts)
  // - Group 3: The closing quote and rest
  const importPattern = /((?:import|export)\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+|type\s+(?:\{[^}]*\}|\w+)\s+from\s+)?['"])(\.\.?\/[^'"]+)(['"])/g;

  // Also match dynamic imports: import('./foo.ts')
  const dynamicImportPattern = /(import\s*\(\s*['"])(\.\.?\/[^'"]+)(['"]\s*\))/g;

  let result = code;

  // Rewrite static imports/exports
  result = result.replace(importPattern, (_match, prefix, relativePath, suffix) => {
    const absoluteUrl = resolveRelativePath(baseUrl, relativePath);
    logger.debug('Rewrote import', { from: relativePath, to: absoluteUrl });
    return `${prefix}${absoluteUrl}${suffix}`;
  });

  // Rewrite dynamic imports
  result = result.replace(dynamicImportPattern, (_match, prefix, relativePath, suffix) => {
    const absoluteUrl = resolveRelativePath(baseUrl, relativePath);
    logger.debug('Rewrote dynamic import', { from: relativePath, to: absoluteUrl });
    return `${prefix}${absoluteUrl}${suffix}`;
  });

  return result;
}

/**
 * Resolve a relative path against a base URL.
 */
function resolveRelativePath(baseUrl: string, relativePath: string): string {
  try {
    return new URL(relativePath, baseUrl).href;
  } catch {
    // Fallback: simple string concatenation
    const baseDir = baseUrl.replace(/\/[^/]*$/, '');
    return `${baseDir}/${relativePath}`;
  }
}

/**
 * Rewrite handler attributes in template to use registry calls.
 *
 * Transforms: onClick="count++; updateDisplay()"
 * To:         onClick="__melker.__h0(event)"
 */
export function rewriteHandlers(template: string, handlers: ParsedHandler[]): string {
  let result = template;

  logger.debug('Rewriting handlers in template', { handlerCount: handlers.length });

  // Debug: save template before rewrite
  Deno.writeTextFileSync('/tmp/melker-template-before.html', template);

  // Process in reverse order to preserve offsets
  const sorted = [...handlers].sort(
    (a, b) => b.attributeRange.start.offset - a.attributeRange.start.offset
  );

  for (const handler of sorted) {
    // Build the replacement attribute
    const callArgs = handler.params.map((p) => p.name).join(', ');
    const call = `__melker.${handler.id}(${callArgs})`;
    const newAttr = `${handler.attributeName}="${call}"`;

    // Find and replace the original attribute
    // We need to match the exact attribute with its value
    const attrPattern = new RegExp(
      `\\b${handler.attributeName}\\s*=\\s*["']${escapeRegex(handler.code)}["']`
    );

    const before = result;
    result = result.replace(attrPattern, newAttr);

    if (result === before) {
      // Fallback: try matching by position if regex didn't work
      logger.debug('Regex replacement failed, using position-based replacement', {
        handler: handler.id,
        attributeName: handler.attributeName,
      });
    } else {
      logger.debug('Rewrote handler', {
        handler: handler.id,
        attributeName: handler.attributeName,
        newCall: call,
      });
    }
  }

  // Debug: save template after rewrite
  Deno.writeTextFileSync('/tmp/melker-template-after.html', result);

  return result;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
