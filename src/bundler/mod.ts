/**
 * Melker Runtime Bundler
 *
 * This module provides runtime bundling for .melker files using Deno.bundle().
 * It enables full npm/jsr import support, proper error translation, and caching.
 *
 * Usage:
 *   deno run --unstable-bundle --allow-all melker.ts app.melker
 *
 * Features:
 * - Full npm:, jsr:, https:// import support via Deno.bundle()
 * - TypeScript transpilation for scripts and event handlers
 * - Sourcemap-based error translation to original .melker lines
 * - Handler registry pattern (__melker.__h0, etc.)
 * - Lifecycle hooks: async="init" (before render), async="ready" (after render)
 * - Content-hash based caching for fast subsequent runs
 *
 * @module
 */

import { MelkerConfig } from '../config/mod.ts';
import { ensureError } from '../utils/error.ts';

// Re-export types
export type {
  SourcePosition,
  SourceRange,
  ScriptType,
  ParsedScript,
  HandlerParam,
  ParsedHandler,
  ParseResult,
  LineMapping,
  GeneratedSource,
  SourceMapData,
  BundleResult,
  AssembledMelker,
  MelkerRegistry,
  ExecuteBundleResult,
  OAuthAction,
  OAuthEvent,
  CacheEntry,
  TranslatedFrame,
  TranslatedError,
  ErrorContext,
  BundleOptions,
} from './types.ts';

// Re-export generator functions
export { generate, rewriteHandlers } from './generator.ts';

// Re-export bundle functions
export { bundle, hasNpmImports, requiresBundling } from './bundle.ts';

// Re-export error handling
export {
  displayFatalError,
  parseBundleError,
  getHintForError,
  ErrorTranslator,
  formatError,
  isBundleAvailable,
  getBundleUnavailableHint,
  restoreTerminal,
} from './errors.ts';

// Re-export cache functions
export {
  checkCache,
  saveToCache,
  restoreFromCache,
  clearCache,
  getCacheStats,
} from './cache.ts';

import { getLogger } from '../logging.ts';
import type {
  ParseResult,
  AssembledMelker,
  BundleOptions,
  MelkerRegistry,
  ExecuteBundleResult,
} from './types.ts';
import { generate, rewriteHandlers } from './generator.ts';
import { bundle, requiresBundling } from './bundle.ts';
import {
  displayFatalError,
  isBundleAvailable,
  getBundleUnavailableHint,
  ErrorTranslator,
  formatError,
  restoreTerminal,
} from './errors.ts';
import { checkCache, saveToCache, restoreFromCache } from './cache.ts';

const logger = getLogger('Bundler');

/**
 * Process a parsed .melker file through the bundler pipeline.
 *
 * This is the main entry point for the bundler. It:
 * 1. Checks cache for existing bundle
 * 2. Generates TypeScript from parsed content
 * 3. Bundles with Deno.bundle()
 * 4. Rewrites handlers in template
 * 5. Saves to cache
 *
 * @param parsed - The parsed .melker file content
 * @param options - Bundle options (minify, useCache, debug)
 * @returns Assembled .melker ready for execution
 */
export async function processMelkerBundle(
  parsed: ParseResult,
  options: BundleOptions = {}
): Promise<AssembledMelker> {
  const startTime = performance.now();

  logger.info('Processing .melker file', {
    sourceUrl: parsed.sourceUrl,
    scripts: parsed.scripts.length,
    handlers: parsed.handlers.length,
  });

  // Check if we actually need bundling
  const needsBundling = parsed.scripts.some((s) => requiresBundling(s.code));

  if (needsBundling && !isBundleAvailable()) {
    logger.warn('npm/jsr imports detected but Deno.bundle() not available');
    displayFatalError(
      'initialization',
      new Error('npm: or jsr: imports require --unstable-bundle flag'),
      {
        filepath: parsed.sourceUrl,
        hint: getBundleUnavailableHint(),
      }
    );
  }

  // Check cache (only if explicitly enabled)
  if (options.useCache) {
    const cached = await checkCache(parsed.sourceUrl, parsed.originalContent);
    if (cached) {
      logger.info('Using cached bundle');
      return restoreFromCache(cached, parsed.originalContent, parsed.sourceUrl);
    }
  }

  // Phase 4: Generate TypeScript
  logger.debug('Phase 4: Generating TypeScript');
  const generated = generate(parsed);

  if (options.debug) {
    console.log('\nGENERATED TYPESCRIPT');
    console.log('-'.repeat(40));
    console.log(`  Lines: ${generated.code.split('\n').length}`);
    console.log(`  Handlers: ${parsed.handlers.length}`);
    console.log(`  Scripts: ${parsed.scripts.length}`);
    const preview = generated.code.substring(0, 300).replace(/\n/g, '\\n');
    console.log(`  Preview: ${preview}...`);
  }

  // Phase 5: Bundle
  logger.debug('Phase 5: Bundling');
  const bundled = await bundle(generated, options);

  // Phase 6: Assemble - rewrite handlers in template
  logger.debug('Phase 6: Assembling');
  const template = rewriteHandlers(parsed.template, parsed.handlers);

  const assembled: AssembledMelker = {
    template,
    bundledCode: bundled.code,
    lineMap: generated.lineMap,
    bundleSourceMap: bundled.sourceMap,
    originalContent: parsed.originalContent,
    sourceUrl: parsed.sourceUrl,
    scriptMeta: generated.scriptMeta,
    bundleTempDir: bundled.tempDir,
    metadata: {
      generatedLines: generated.code.split('\n').length,
      generatedPreview: generated.code.substring(0, 200).replace(/\n/g, '\\n'),
      scriptsCount: parsed.scripts.length,
      handlersCount: parsed.handlers.length,
      generatedFile: bundled.generatedFile,
    },
  };

  // Save to cache (only if explicitly enabled)
  if (options.useCache) {
    await saveToCache(parsed.sourceUrl, parsed.originalContent, assembled);
  }

  const elapsed = performance.now() - startTime;
  logger.info('Bundle processing complete', {
    durationMs: Math.round(elapsed),
    bundledBytes: bundled.code.length,
  });

  return assembled;
}

/**
 * Execute an assembled .melker bundle.
 *
 * This function:
 * 1. Creates the runtime context
 * 2. Executes the bundled code (registers __melker on globalThis)
 * 3. Calls __init if present (before render)
 * 4. Returns the registry for the caller to integrate with the engine
 *
 * The caller is responsible for:
 * - Rendering the UI
 * - Calling __ready after render
 * - Handling event dispatch
 *
 * @param assembled - The assembled bundle
 * @param context - The Melker runtime context
 * @returns The registry and bundle file path
 */
export async function executeBundle(
  assembled: AssembledMelker,
  context: Record<string, unknown>,
  argv?: string[]
): Promise<ExecuteBundleResult> {
  logger.debug('Executing bundled code', {
    sourceUrl: assembled.sourceUrl,
    codeLength: assembled.bundledCode.length,
  });

  // Create error translator for runtime errors
  const errorTranslator = new ErrorTranslator(
    assembled.bundleSourceMap,
    assembled.lineMap,
    assembled.originalContent,
    assembled.sourceUrl,
    assembled.scriptMeta
  );

  // Use the bundle temp dir for the executable bundle.js
  // If no bundleTempDir (e.g., from cache), create one
  const tempDir = assembled.bundleTempDir ?? await Deno.makeTempDir({ prefix: 'melker-bundle-' });
  const bundleFile = `${tempDir}/bundle.js`;

  // Single temp directory for cleanup
  const tempDirs: string[] = [tempDir];

  try {
    // The bundled code is an ES module, so we need to execute it via import()
    // We inject the context and argv as globals before importing

    // Set up globals that the bundled code expects
    // Use casts because context is generic Record<string, unknown> but will have the right shape at runtime
    (globalThis as any).$melker = context;
    (globalThis as any).$app = context.exports; // Alias for $melker.exports
    (globalThis as any).argv = argv ?? Deno.args.slice(1);

    // Write bundled code to temp file (for debugging with retainBundle)
    const retainBundle = MelkerConfig.get().bundlerRetainBundle;
    if (retainBundle) {
      await Deno.writeTextFile(bundleFile, assembled.bundledCode);
      logger.info(`Bundled code written to: ${bundleFile} (retainBundle=true, will be retained)`);
    }

    // Import the bundled module via data URL — works from any origin (file://, http://, https://)
    const bytes = new TextEncoder().encode(assembled.bundledCode);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const encoded = btoa(binary);
    await import(`data:application/javascript;base64,${encoded}`);

    // Get the registry
    const registry = (globalThis as any).__melker as MelkerRegistry;

    if (!registry) {
      throw new Error('Bundle did not register __melker on globalThis');
    }

    logger.debug('Bundle executed, registry available', {
      hasInit: !!registry.__init,
      hasReady: !!registry.__ready,
      handlerCount: Object.keys(registry).filter((k) => k.startsWith('__h')).length,
    });

    // Call __init if present (before render)
    if (registry.__init) {
      logger.debug('Calling __init');
      await registry.__init();
      logger.debug('__init completed');
    }

    return { registry, bundleFile, tempDirs };
  } catch (error) {
    // CRITICAL: Always restore terminal and show error - never fail silently
    restoreTerminal();

    // Ensure we have an Error object
    const err = ensureError(error);

    // Log to file for debugging
    logger.error('Bundle execution failed', err, {
      sourceUrl: assembled.sourceUrl,
    });

    // Translate error to original source if possible
    const translated = errorTranslator.translate(err);
    const hasUsefulFrames = translated.frames.some((f) => f.context !== 'unknown');

    // Always print the formatted error
    console.error(formatError(translated));

    // Only show raw stack when translation produced no useful frames
    if (!hasUsefulFrames && err.stack) {
      // Sanitize data: URLs from stack trace (replace base64 blob with <bundle>)
      const sanitized = err.stack.replace(
        /data:application\/javascript;base64,[A-Za-z0-9+/=.]+/g,
        '<bundle>'
      );
      console.error('\nStack trace:');
      console.error(sanitized);
    }

    Deno.exit(1);
  }
}

/**
 * Call the __ready lifecycle hook if present.
 *
 * This should be called after the UI has been rendered.
 *
 * @param registry - The __melker registry
 */
export async function callReady(registry: MelkerRegistry, errorTranslator?: ErrorTranslator): Promise<void> {
  logger.debug('callReady called', {
    hasReady: !!registry.__ready,
    registryKeys: Object.keys(registry),
  });
  if (registry.__ready) {
    logger.debug('Calling __ready');
    try {
      await registry.__ready();
      logger.debug('__ready completed');
    } catch (error) {
      // CRITICAL: Restore terminal and show error - never fail silently
      restoreTerminal();

      const err = ensureError(error);
      logger.error('__ready failed', err);

      if (errorTranslator) {
        const translated = errorTranslator.translate(err);
        const hasUsefulFrames = translated.frames.some((f) => f.context !== 'unknown');
        console.error(formatError(translated));

        if (!hasUsefulFrames && err.stack) {
          const sanitized = err.stack.replace(
            /data:application\/javascript;base64,[A-Za-z0-9+/=.]+/g,
            '<bundle>'
          );
          console.error('\nStack trace:');
          console.error(sanitized);
        }
      } else {
        console.error(`\n\x1b[31m__ready hook failed:\x1b[0m`, err.message);
        if (err.stack) {
          const sanitized = err.stack.replace(
            /data:application\/javascript;base64,[A-Za-z0-9+/=.]+/g,
            '<bundle>'
          );
          console.error('\nStack trace:');
          console.error(sanitized);
        }
      }

      Deno.exit(1);
    }
  }
}

/**
 * Create a wrapped handler function that auto-renders after completion.
 *
 * @param handler - The handler function from the registry
 * @param context - The runtime context (must have render() method)
 * @param handlerName - Name of the handler for logging
 * @returns Wrapped handler function
 */
export function wrapHandler(
  handler: (event?: unknown) => void | Promise<void>,
  context: { render?: () => void },
  handlerName: string
): (event?: unknown) => void | Promise<void> {
  return async (event?: unknown) => {
    logger.debug('Handler invoked', { handlerName });

    try {
      const result = handler(event);

      // Handle both sync and async handlers
      if (result instanceof Promise) {
        await result;
      }

      // Auto-render after handler completes
      if (context.render) {
        context.render();
      }
    } catch (error) {
      logger.error('Handler error', ensureError(error), {
        handlerName,
      });
      throw error;
    }
  };
}
