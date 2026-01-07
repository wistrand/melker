/**
 * Deno.bundle() wrapper for Melker bundler.
 *
 * This module handles:
 * - Writing generated TypeScript to a temp file
 * - Calling Deno.bundle() with appropriate options
 * - Extracting and parsing the sourcemap
 * - Cleaning up temp files
 */

import { getLogger } from '../logging.ts';
import { getTempDir } from '../xdg.ts';
import type {
  BundleOptions,
  BundleResult,
  GeneratedSource,
  SourceMapData,
} from './types.ts';
import {
  displayFatalError,
  parseBundleError,
  isBundleAvailable,
  getBundleUnavailableHint,
} from './errors.ts';

const logger = getLogger('Bundler:Bundle');

/**
 * Bundle generated TypeScript using Deno.bundle().
 *
 * This function:
 * 1. Writes the generated TypeScript to a temp file
 * 2. Calls Deno.bundle() with sourcemap enabled
 * 3. Extracts the bundled code and sourcemap
 * 4. Cleans up the temp directory
 *
 * On error, displays a fatal error with hints and exits.
 */
export async function bundle(
  generated: GeneratedSource,
  options: BundleOptions = {}
): Promise<BundleResult> {
  const startTime = performance.now();

  logger.debug('Starting Deno.bundle()', {
    sourceUrl: generated.sourceUrl,
    minify: options.minify,
    generatedLines: generated.code.split('\n').length,
  });

  // Check if Deno.bundle is available
  if (!isBundleAvailable()) {
    // displayFatalError calls Deno.exit(1) and returns never
    displayFatalError(
      'bundle',
      new Error('Deno.bundle() not available'),
      {
        filepath: generated.sourceUrl,
        hint: getBundleUnavailableHint(),
      }
    );
    // This is unreachable, but satisfies TypeScript
    throw new Error('unreachable');
  }

  const tempDir = await Deno.makeTempDir({ prefix: 'melker-bundle-' });
  const sourceFile = `${tempDir}/generated.ts`;

  logger.debug('Created temp directory', { tempDir, sourceFile });

  try {
    // Write script module files first (inline scripts as separate modules)
    for (const module of generated.scriptModules) {
      const modulePath = `${tempDir}/${module.filename}`;
      await Deno.writeTextFile(modulePath, module.content);
      logger.debug('Wrote script module', {
        path: modulePath,
        filename: module.filename,
        originalLine: module.originalLine,
        bytes: module.content.length,
      });
    }

    // Write generated TypeScript entry point
    await Deno.writeTextFile(sourceFile, generated.code);
    // Also save a debug copy for inspection
    await Deno.writeTextFile(`${getTempDir()}/melker-generated.ts`, generated.code);
    logger.debug('Wrote generated TypeScript to temp file', {
      path: sourceFile,
      bytes: generated.code.length,
      scriptModules: generated.scriptModules.length,
    });

    // Call Deno.bundle()
    logger.info('Bundling with Deno.bundle()', {
      entrypoint: sourceFile,
      minify: options.minify ?? false,
    });

    const result = await (Deno as any).bundle({
      entrypoints: [sourceFile],
      output: 'bundle',
      platform: 'deno',
      minify: options.minify ?? false,
      sourcemap: 'inline',
      write: false,
    });

    // Check for bundle errors first
    if (!result.success && result.errors?.length > 0) {
      // Format all errors for display
      const errorMessages = result.errors
        .map((e: { text: string }) => e.text.replace(/\x1b\[[0-9;]*m/g, '')) // strip ANSI codes
        .join('\n\n');

      displayFatalError(
        'bundle',
        new Error(`Bundle failed with ${result.errors.length} error(s):\n\n${errorMessages}`),
        {
          filepath: generated.sourceUrl,
          hint: 'Check that all imported modules exist and paths are correct.',
        }
      );
      throw new Error('unreachable');
    }

    // Find the output file - could be .js or <stdout>
    const jsFile = result.outputFiles?.find((f: any) =>
      f.path.endsWith('.js') || f.path === '<stdout>'
    );

    if (!jsFile) {
      displayFatalError(
        'bundle',
        new Error('Bundler produced no output'),
        {
          filepath: generated.sourceUrl,
          hint: 'This may indicate an internal bundler error. Check the generated TypeScript for issues.',
        }
      );
      throw new Error('unreachable');
    }

    // Get the bundled code
    const bundledCode = jsFile.text();

    // Extract inline sourcemap if present
    const { code, sourceMap } = extractInlineSourcemap(bundledCode);

    // Debug: save bundled JS for inspection
    const debugBundlePath = `${getTempDir()}/melker-bundled.js`;
    await Deno.writeTextFile(debugBundlePath, code);
    logger.debug(`Saved bundled JS to ${debugBundlePath}`);

    const elapsed = performance.now() - startTime;
    logger.debug('Bundle completed successfully', {
      outputBytes: code.length,
      hasSourcemap: !!sourceMap,
      durationMs: Math.round(elapsed),
    });

    logger.info('Bundle ready', {
      inputLines: generated.code.split('\n').length,
      outputBytes: code.length,
      durationMs: Math.round(elapsed),
    });

    return {
      code,
      sourceMap,
      warnings: [],
      generatedFile: sourceFile,
      tempDir,
    };
  } catch (error) {
    // Clean up temp directory on error
    try {
      await Deno.remove(tempDir, { recursive: true });
      logger.debug('Cleaned up temp directory after error', { tempDir });
    } catch {
      // Ignore cleanup errors
    }

    // Parse the error for better display
    const parsed = parseBundleError(error, generated);

    logger.error('Bundle failed', error instanceof Error ? error : new Error(String(error)), {
      sourceUrl: generated.sourceUrl,
      parsedLocation: parsed.location,
    });

    displayFatalError(
      'bundle',
      error instanceof Error ? error : new Error(String(error)),
      {
        filepath: generated.sourceUrl,
        sourceLocation: parsed.location,
        sourceLine: parsed.sourceLine,
        hint: parsed.hint,
      }
    );
    throw new Error('unreachable');
  }
}

/**
 * Extract inline sourcemap from bundled code.
 *
 * Looks for the standard sourceMappingURL comment with base64-encoded data
 * and extracts/decodes it.
 */
function extractInlineSourcemap(code: string): {
  code: string;
  sourceMap: SourceMapData | null;
} {
  const regex =
    /\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)\s*$/;
  const match = code.match(regex);

  if (match) {
    try {
      const base64 = match[1];
      const json = atob(base64);
      const sourceMap = JSON.parse(json) as SourceMapData;
      const cleanCode = code.replace(regex, '').trimEnd();

      logger.debug('Extracted inline sourcemap', {
        sources: sourceMap.sources?.length ?? 0,
        mappingsLength: sourceMap.mappings?.length ?? 0,
      });

      return { code: cleanCode, sourceMap };
    } catch (e) {
      logger.warn('Failed to parse inline sourcemap', {
        error: e instanceof Error ? e.message : String(e),
      });
      return { code, sourceMap: null };
    }
  }

  logger.debug('No inline sourcemap found in bundled code');
  return { code, sourceMap: null };
}

/**
 * Check if the generated code contains npm: imports.
 *
 * This is used to determine if we need Deno.bundle() or can fall back
 * to the simpler jsr:@deno/emit transpiler.
 */
export function hasNpmImports(code: string): boolean {
  return /\bfrom\s+["']npm:/.test(code) || /\bimport\s*\(\s*["']npm:/.test(code);
}

/**
 * Check if the generated code contains any imports that require bundling.
 *
 * Returns true if the code has imports that can't be handled by simple
 * transpilation (npm:, jsr:, http:, https:, or relative imports).
 */
export function requiresBundling(code: string): boolean {
  // Check for various import patterns
  const importPatterns = [
    /\bfrom\s+["'](npm:|jsr:|https?:\/\/)/,  // from "npm:", "jsr:", "http(s)://"
    /\bimport\s*\(\s*["'](npm:|jsr:|https?:\/\/)/, // dynamic import
    /\bfrom\s+["']\.\.?\//,  // relative imports
    /\bimport\s*\(\s*["']\.\.?\//,  // dynamic relative imports
  ];

  return importPatterns.some((pattern) => pattern.test(code));
}
