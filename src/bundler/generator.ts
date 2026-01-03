/**
 * TypeScript code generator for Melker bundler.
 *
 * This module generates a single TypeScript entry point from parsed .melker content,
 * with all scripts (inline and external) imported as ES modules.
 *
 * Each inline script is written to a separate temp file and imported, which:
 * - Enables ES imports in inline scripts
 * - Eliminates regex-based export detection
 * - Provides consistent behavior between inline and external scripts
 */

import { getLogger } from '../logging.ts';
import type {
  ParsedScript,
  ParsedHandler,
  ParseResult,
  GeneratedSource,
  LineMapping,
  ScriptModule,
} from './types.ts';

const logger = getLogger('Bundler:Generator');

/**
 * Shared $melker interface definition - single source of truth.
 * Used in both inline script modules and main generated code.
 */
const MELKER_INTERFACE_MEMBERS = `  getElementById(id: string): any;
  querySelector(selector: string): any;
  querySelectorAll(selector: string): any[];
  render(): void;
  forceRender(): void;
  exit(): void;
  quit(): void;
  setTitle(title: string): void;
  alert(message: string): void;
  confirm(message: string): Promise<boolean>;
  prompt(message: string, defaultValue?: string): Promise<string | null>;
  copyToClipboard(text: string): Promise<boolean>;
  openBrowser(url: string): Promise<boolean>;
  engine: any;
  logger: any;
  getLogger(name: string): any;
  oauth: any;
  oauthConfig: any;
  createElement(type: string, props?: Record<string, any>, ...children: any[]): any;
  melkerImport(specifier: string): Promise<any>;
  registerAITool(tool: any): void;
  persistenceEnabled: boolean;
  stateFilePath: string | null;
  url: string;
  dirname: string;
  exports: Record<string, any>;`;

/**
 * Header added to all inline script modules for $melker access.
 */
const SCRIPT_MODULE_HEADER = `// Runtime globals (injected via globalThis before import)
const $melker = (globalThis as any).$melker as {
${MELKER_INTERFACE_MEMBERS}
};
const argv = (globalThis as any).argv as string[];

// Global alert/confirm/prompt aliases - use $melker versions to show TUI dialogs
const alert = (message: string) => $melker.alert(message);
const confirm = (message: string) => $melker.confirm(message);
const prompt = (message: string, defaultValue?: string) => $melker.prompt(message, defaultValue);

// $app is a short alias for $melker.exports (set on globalThis before import)
const $app = (globalThis as any).$app as Record<string, any>;

`;

/**
 * Generate TypeScript source from parsed .melker content.
 *
 * The generated code has sections:
 * 1. Runtime declarations (context, argv, alert)
 * 2. Script imports (all scripts as modules)
 * 3. Export merging (Object.assign to $melker.exports)
 * 4. Async init function (if any init scripts)
 * 5. Async ready function (if any ready scripts)
 * 6. Event handlers
 * 7. Registry export
 */
export function generate(parsed: ParseResult): GeneratedSource {
  const lines: string[] = [];
  const lineMap = new Map<number, LineMapping>();
  const scriptModules: ScriptModule[] = [];
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
  // Use shared interface definition
  for (const line of MELKER_INTERFACE_MEMBERS.split('\n')) {
    addLine(line);
  }
  addLine('};');
  addLine('const argv = (globalThis as any).argv as string[];');
  addLine('');
  addLine('// Global alert/confirm/prompt aliases - use $melker versions to show TUI dialogs');
  addLine('const alert = (message: string) => $melker.alert(message);');
  addLine('const confirm = (message: string) => $melker.confirm(message);');
  addLine('const prompt = (message: string, defaultValue?: string) => $melker.prompt(message, defaultValue);');
  addLine('');
  addLine('// $app is a short alias for $melker.exports (set on globalThis before import)');
  addLine('const $app = (globalThis as any).$app as Record<string, any>;');
  addLine('');

  // =========================================================================
  // Section 2: Script Imports
  // =========================================================================
  const syncScripts = parsed.scripts.filter((s) => s.type === 'sync');

  // Create script modules for inline scripts
  const inlineScripts = syncScripts.filter((s) => !s.externalSrc);
  const externalScripts = syncScripts.filter((s) => s.externalSrc);

  // Generate inline script modules
  for (const [i, script] of inlineScripts.entries()) {
    const filename = `_inline_${i}.ts`;
    const originalLine = script.sourceRange.start.line;

    // Create module content with header and script code
    const content = SCRIPT_MODULE_HEADER + script.code;

    scriptModules.push({
      filename,
      content,
      originalLine,
      sourceId: script.id,
    });

    logger.debug('Created inline script module', {
      id: script.id,
      filename,
      originalLine,
      codeLength: script.code.length,
    });
  }

  // Generate imports section if there are any scripts
  if (syncScripts.length > 0) {
    addLine('// ='.padEnd(70, '='));
    addLine('// SCRIPT IMPORTS (all scripts as ES modules)');
    addLine('// ='.padEnd(70, '='));
    addLine('');

    let scriptIndex = 0;

    // Import inline scripts (from temp files)
    for (const [i, script] of inlineScripts.entries()) {
      const originalLine = script.sourceRange.start.line;
      const filename = `_inline_${i}.ts`;

      addLine(`// Inline script from line ${originalLine}`, {
        originalLine,
        sourceId: script.id,
        description: `inline script import at line ${originalLine}`,
      });
      addLine(`import * as _script_${scriptIndex} from './${filename}';`);
      scriptIndex++;
    }

    // Import external scripts
    for (const script of externalScripts) {
      const originalLine = script.sourceRange.start.line;
      const externalUrl = resolveExternalSrc(parsed.sourceUrl, script.externalSrc!);

      logger.debug('Adding external script import', {
        id: script.id,
        originalLine,
        externalSrc: script.externalSrc,
        resolvedUrl: externalUrl,
      });

      addLine(`// External script from line ${originalLine}: ${script.externalSrc}`, {
        originalLine,
        sourceId: script.id,
        description: `external script import at line ${originalLine}`,
      });
      addLine(`import * as _script_${scriptIndex} from '${externalUrl}';`);
      scriptIndex++;
    }

    addLine('');

    // Merge all script exports to $melker.exports with duplicate detection
    addLine('// Merge all script exports to $melker.exports');
    if (syncScripts.length > 1) {
      addLine('// Note: Scripts are merged in document order. Later scripts can access earlier exports via $app.');
      addLine(`$melker.logger?.debug?.('Merging exports from ${syncScripts.length} scripts in document order');`);
    }
    addLine('// Helper to detect and warn about duplicate exports');
    addLine('function __mergeExports(target: Record<string, any>, source: Record<string, any>, scriptName: string): void {');
    addLine('  for (const key of Object.keys(source)) {');
    addLine('    if (key in target) {');
    addLine('      $melker.logger?.warn?.(`Export "${key}" from ${scriptName} overwrites existing export`);');
    addLine('    }');
    addLine('    target[key] = source[key];');
    addLine('  }');
    addLine('}');
    addLine('');

    // Generate merge calls with script identification
    for (const [i, script] of syncScripts.entries()) {
      const scriptName = script.externalSrc
        ? `"${script.externalSrc}"`
        : `"inline script ${i + 1}"`;
      addLine(`__mergeExports($melker.exports, _script_${i}, ${scriptName});`);
    }
    addLine('');
  }

  // =========================================================================
  // Section 3: Async Init
  // =========================================================================
  const initScripts = parsed.scripts.filter((s) => s.type === 'init');

  if (initScripts.length > 0) {
    addLine('// ='.padEnd(70, '='));
    addLine('// ASYNC INIT (before render)');
    addLine('// ='.padEnd(70, '='));
    addLine('');

    // Create modules for init scripts
    for (const [i, script] of initScripts.entries()) {
      const filename = `_init_${i}.ts`;
      const originalLine = script.sourceRange.start.line;

      // Init scripts are async, wrap in exported function
      const content = SCRIPT_MODULE_HEADER + `
export async function __initFn(): Promise<void> {
${script.code.split('\n').map(l => '  ' + l).join('\n')}
}
`;

      scriptModules.push({
        filename,
        content,
        originalLine,
        sourceId: script.id,
      });

      addLine(`// Init script from line ${originalLine}`, {
        originalLine,
        sourceId: script.id,
        description: `init script at line ${originalLine}`,
      });
      addLine(`import { __initFn as __initFn_${i} } from './${filename}';`);
    }
    addLine('');

    // Generate combined __init function
    addLine('async function __init(): Promise<void> {');
    for (let i = 0; i < initScripts.length; i++) {
      addLine(`  await __initFn_${i}();`);
    }
    addLine('}');
    addLine('');
  }

  // =========================================================================
  // Section 4: Async Ready
  // =========================================================================
  const readyScripts = parsed.scripts.filter((s) => s.type === 'ready');

  if (readyScripts.length > 0) {
    addLine('// ='.padEnd(70, '='));
    addLine('// ASYNC READY (after render)');
    addLine('// ='.padEnd(70, '='));
    addLine('');

    // Create modules for ready scripts
    for (const [i, script] of readyScripts.entries()) {
      const filename = `_ready_${i}.ts`;
      const originalLine = script.sourceRange.start.line;

      // Ready scripts are async, wrap in exported function
      const content = SCRIPT_MODULE_HEADER + `
export async function __readyFn(): Promise<void> {
${script.code.split('\n').map(l => '  ' + l).join('\n')}
}
`;

      scriptModules.push({
        filename,
        content,
        originalLine,
        sourceId: script.id,
      });

      addLine(`// Ready script from line ${originalLine}`, {
        originalLine,
        sourceId: script.id,
        description: `ready script at line ${originalLine}`,
      });
      addLine(`import { __readyFn as __readyFn_${i} } from './${filename}';`);
    }
    addLine('');

    // Generate combined __ready function
    addLine('async function __ready(): Promise<void> {');
    for (let i = 0; i < readyScripts.length; i++) {
      addLine(`  await __readyFn_${i}();`);
    }
    addLine('}');
    addLine('');
  }

  // =========================================================================
  // Section 5: Event Handlers
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
      addLine(`  ${code}`);

      addLine('}');
      addLine('');
    }
  }

  // =========================================================================
  // Section 6: Registry
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
    scriptModules: scriptModules.length,
  });

  return {
    code: generatedCode,
    scriptModules,
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
 * Rewrite handler attributes in template to use registry calls.
 *
 * Uses position-based string slicing instead of regex for reliability.
 * Handles any content including special chars, quotes, and multiline code.
 *
 * Transforms: onClick="count++; updateDisplay()"
 * To:         onClick="__melker.__h0(event)"
 */
export function rewriteHandlers(template: string, handlers: ParsedHandler[]): string {
  if (handlers.length === 0) {
    return template;
  }

  // Filter out OAuth handlers - they're not in the template (they're in <oauth> tag)
  const templateHandlers = handlers.filter((h) => !h.id.startsWith('__oauth_'));

  if (templateHandlers.length === 0) {
    return template;
  }

  logger.debug('Rewriting handlers in template', { handlerCount: templateHandlers.length });

  let result = template;

  // Process in reverse offset order so earlier positions don't shift
  const sorted = [...templateHandlers].sort(
    (a, b) => b.attributeRange.start.offset - a.attributeRange.start.offset
  );

  for (const handler of sorted) {
    const start = handler.attributeRange.start.offset;
    const end = handler.attributeRange.end.offset;

    // Build the replacement attribute
    const callArgs = handler.params.map((p) => p.name).join(', ');
    const newAttr = `${handler.attributeName}="__melker.${handler.id}(${callArgs})"`;

    // Validate: check that the slice starts with the expected attribute name
    const oldAttr = result.slice(start, end);
    if (!oldAttr.startsWith(handler.attributeName)) {
      logger.warn('Handler offset mismatch', {
        handler: handler.id,
        expected: handler.attributeName,
        found: oldAttr.slice(0, 20),
        start,
        end,
      });
      continue;
    }

    // Direct splice - no regex needed
    result = result.slice(0, start) + newAttr + result.slice(end);

    logger.debug('Rewrote handler', {
      handler: handler.id,
      attributeName: handler.attributeName,
      oldLength: end - start,
      newLength: newAttr.length,
    });
  }

  return result;
}
