import { config as dotenvConfig } from 'npm:dotenv@^16.3.0';
import { debounce } from './utils/timing.ts';

// Bundler imports for Deno.bundle() integration
import {
  processMelkerBundle,
  executeBundle,
  callReady,
  ErrorTranslator,
  type MelkerRegistry,
  type AssembledMelker,
} from './bundler/mod.ts';
import { parseMelkerForBundler } from './template.ts';

/**
 * Wire up bundler registry handlers to UI elements.
 *
 * When using the bundler, handlers are compiled into a registry (__melker.__h0, etc.)
 * This function walks the element tree and replaces string handler references
 * with actual function calls to the registry.
 *
 * @param handlerCodeMap - Map from original handler code to handler ID (e.g., "incrementCounter()" → "__h0")
 * @param errorTranslator - Optional ErrorTranslator for mapping bundled errors to original .melker lines
 */
async function wireBundlerHandlers(
  element: any,
  registry: MelkerRegistry,
  context: any,
  logger: any,
  handlerCodeMap?: Map<string, string>,
  errorTranslator?: ErrorTranslator
): Promise<void> {
  // Render callbacks that shouldn't auto-render
  const noAutoRenderCallbacks = ['onPaint'];

  // Process current element's props
  if (element.props) {
    for (const [propName, propValue] of Object.entries(element.props)) {
      // Check for string handlers that reference the registry
      if (
        propName.startsWith('on') &&
        typeof propValue === 'object' &&
        propValue &&
        (propValue as any).__isStringHandler
      ) {
        const handlerCode = (propValue as any).__handlerCode;

        // Check if this handler references the registry (e.g., "__melker.__h0(event)")
        const registryMatch = handlerCode.match(/__melker\.(__h\d+)\(([^)]*)\)/);

        let handlerId: string | undefined;
        let handlerFn: ((event?: unknown) => void | Promise<void>) | undefined;

        if (registryMatch && registryMatch[1]) {
          // Handler already references registry
          const id = registryMatch[1];
          handlerId = id;
          handlerFn = (registry as any)[id];
        } else if (handlerCodeMap) {
          // Look up handler ID from original code
          const id = handlerCodeMap.get(handlerCode);
          if (id) {
            handlerId = id;
            handlerFn = (registry as any)[id];
          }
        }

        if (handlerId && handlerFn) {
          // Create a wrapper that auto-renders after the handler
          const shouldAutoRender = !noAutoRenderCallbacks.includes(propName);
          const capturedHandlerId = handlerId;
          const capturedHandlerFn = handlerFn;

          element.props[propName] = async (event: any) => {
            try {
              const result = capturedHandlerFn(event);
              if (result instanceof Promise) {
                await result;
              }
              if (shouldAutoRender && context?.render) {
                context.render();
              }
            } catch (error) {
              const err = error instanceof Error ? error : new Error(String(error));
              // Look up handler's original location using ErrorTranslator
              if (errorTranslator) {
                const handlerMapping = errorTranslator.findBySourceId(capturedHandlerId);
                if (handlerMapping) {
                  logger?.error?.(
                    `Error in handler ${capturedHandlerId} at ${errorTranslator.getSourceFile()}:${handlerMapping.originalLine}:`,
                    err,
                    {
                      originalLine: handlerMapping.originalLine,
                      sourceId: handlerMapping.sourceId,
                      description: handlerMapping.description,
                    }
                  );
                } else {
                  logger?.error?.(`Error in handler ${capturedHandlerId}:`, err);
                }
              } else {
                logger?.error?.(`Error in handler ${capturedHandlerId}:`, err);
              }
            }
          };
        } else {
          // Handler not found in registry - process as normal string handler
          // This handles cases where the template wasn't rewritten
          const shouldAutoRender = !noAutoRenderCallbacks.includes(propName);

          element.props[propName] = async (event: any) => {
            try {
              // Execute the handler code with access to registry and context
              const fn = new Function(
                'event',
                'context',
                '__melker',
                handlerCode
              );
              const result = fn(event, context, registry);
              if (result instanceof Promise) {
                await result;
              }
              if (shouldAutoRender && context?.render) {
                context.render();
              }
            } catch (error) {
              logger?.error?.(
                `Error in handler:`,
                error instanceof Error ? error : new Error(String(error))
              );
            }
          };
        }
      }
    }
  }

  // Recursively process children
  if (element.children && Array.isArray(element.children)) {
    for (const child of element.children) {
      await wireBundlerHandlers(child, registry, context, logger, handlerCodeMap, errorTranslator);
    }
  }

  // Also process items in props.items (used by menu components)
  if (element.props?.items && Array.isArray(element.props.items)) {
    for (const item of element.props.items) {
      await wireBundlerHandlers(item, registry, context, logger, handlerCodeMap, errorTranslator);
    }
  }
}

/**
 * Check if a path is a URL (http:// or https://)
 */
function isUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
}

/**
 * Check required permissions and exit with helpful message if not granted.
 * This prevents Deno's interactive permission prompts from blocking the terminal UI.
 */
function checkRequiredPermissions(filepath: string): void {
  const missingPermissions: string[] = [];

  // Check --allow-env (required for MELKER_THEME, MELKER_LOG_FILE, etc.)
  try {
    const envStatus = Deno.permissions.querySync({ name: 'env' });
    if (envStatus.state !== 'granted') {
      missingPermissions.push('env');
    }
  } catch {
    missingPermissions.push('env');
  }

  // Check --allow-read (required for reading .melker files)
  try {
    const readStatus = Deno.permissions.querySync({ name: 'read' });
    if (readStatus.state !== 'granted') {
      missingPermissions.push('read');
    }
  } catch {
    missingPermissions.push('read');
  }

  // Check --allow-net if loading from URL
  if (isUrl(filepath)) {
    try {
      const netStatus = Deno.permissions.querySync({ name: 'net' });
      if (netStatus.state !== 'granted') {
        missingPermissions.push('net');
      }
    } catch {
      missingPermissions.push('net');
    }
  }

  if (missingPermissions.length > 0) {
    const permFlags = missingPermissions.map(p => `--allow-${p}`).join(' ');

    console.error('\n\x1b[31mError: Missing required permissions.\x1b[0m');
    console.error(`  Missing: ${missingPermissions.join(', ')}`);
    console.error('\n\x1b[33mOptions:\x1b[0m');
    console.error('');
    console.error('  \x1b[1m1. Grant required permissions\x1b[0m:');
    console.error(`     deno run ${permFlags} --allow-write melker.ts ${filepath}`);
    console.error('');
    console.error('  \x1b[1m2. Grant all permissions\x1b[0m (recommended for development):');
    console.error(`     deno run --allow-all melker.ts ${filepath}`);
    console.error('');
    console.error('  \x1b[1m3. Minimal permissions\x1b[0m (no logging):');
    console.error(`     MELKER_LOG_FILE= deno run --allow-read --allow-env melker.ts ${filepath}`);
    console.error('');

    if (missingPermissions.includes('env')) {
      console.error('\x1b[36mNote:\x1b[0m --allow-env is needed for:');
      console.error('  - MELKER_THEME (UI theming)');
      console.error('  - MELKER_LOG_FILE, MELKER_LOG_LEVEL (logging configuration)');
      console.error('  - MELKER_HEADLESS, MELKER_DEBUG_PORT (debug/test modes)');
      console.error('');
    }

    if (missingPermissions.includes('net')) {
      console.error('\x1b[36mNote:\x1b[0m --allow-net is needed for loading .melker files from URLs.');
      console.error('');
    }

    Deno.exit(1);
  }
}

/**
 * Load content from a file path or URL
 */
async function loadContent(pathOrUrl: string): Promise<string> {
  if (isUrl(pathOrUrl)) {
    const response = await fetch(pathOrUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${pathOrUrl}: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  }
  return await Deno.readTextFile(pathOrUrl);
}

/**
 * Load environment variables from .env files using npm:dotenv.
 *
 * Files are loaded in priority order (later files override earlier):
 *   1. cwd/.env, cwd/.env.local       - Project-level config
 *   2. <melker-dir>/.env, .env.local  - App-specific config (if different from cwd)
 */
function loadDotenvFiles(melkerFilePath: string): void {
  const cwd = Deno.cwd();

  // Get directory of the .melker file
  const melkerDir = melkerFilePath.startsWith('/')
    ? melkerFilePath.split('/').slice(0, -1).join('/')
    : `${cwd}/${melkerFilePath.split('/').slice(0, -1).join('/')}`;

  // Directories to load from, in order (later overrides earlier)
  const dirs = [cwd];
  if (melkerDir !== cwd) {
    dirs.push(melkerDir);
  }

  // Files to try in each directory
  const envFiles = ['.env', '.env.local'];

  for (const dir of dirs) {
    for (const envFile of envFiles) {
      const envPath = `${dir}/${envFile}`;
      try {
        dotenvConfig({ path: envPath, override: false });
      } catch {
        // File doesn't exist or can't be read - that's fine
      }
    }
  }
}

/**
 * Compute base URL for resolving relative paths
 * Works for both file paths and URLs
 */
function getBaseUrl(pathOrUrl: string): string {
  if (isUrl(pathOrUrl)) {
    // For URLs, get the directory part
    const url = new URL(pathOrUrl);
    const pathParts = url.pathname.split('/');
    pathParts.pop(); // Remove filename
    url.pathname = pathParts.join('/') + '/';
    return url.href;
  }
  // For file paths, convert to file:// URL
  const absolutePath = pathOrUrl.startsWith('/') ? pathOrUrl : `${Deno.cwd()}/${pathOrUrl}`;
  return `file://${absolutePath.split('/').slice(0, -1).join('/')}/`;
}

// Return type for runMelkerFile when not exiting immediately
export interface RunMelkerResult {
  engine: any;
  cleanup: () => Promise<void>;
}

// CLI functionality for running .melker template files
export async function runMelkerFile(
  filepath: string,
  options: { printTree?: boolean, printJson?: boolean, debug?: boolean, noLoad?: boolean, useCache?: boolean, watch?: boolean } = {},
  templateArgs: string[] = [],
  viewSource?: { content: string; path: string; type: 'md' | 'melker'; convertedContent?: string },
  preloadedContent?: string
): Promise<RunMelkerResult | void> {
  try {
    // Extract filename without extension for logger name
    const filename = filepath.split('/').pop()?.replace(/\.melker$/, '') || 'unknown';
    // Import melker.ts FIRST to ensure component registrations happen before parsing
    await import('../melker.ts');
    // Import remaining dependencies dynamically to ensure they're available
    const { melker: melkerTemplate, parseMelkerFile } = await import('./template.ts');
    const { getThemeColor: themeColor } = await import('./theme.ts');
    const { getTerminalSize: terminalSize } = await import('../melker.ts');
    const { createElement: createEl } = await import('./element.ts');
    const { createApp: createMelkerApp } = await import('./engine.ts');
    const { getLogger, getGlobalLoggerOptions } = await import('./logging.ts');
    const { getCurrentTheme } = await import('./theme.ts');
    const oauth = await import('./oauth.ts');
    const { hashFilePath } = await import('./state-persistence.ts');
    const { registerAITool, clearCustomTools } = await import('./ai/mod.ts');

    // Use preloaded content if provided, otherwise read from file/URL
    let templateContent = preloadedContent ?? await loadContent(filepath);
    const originalContent = templateContent; // Preserve for View Source feature

    // Load .env files from the .melker file's directory (skip for URLs)
    if (!isUrl(filepath)) {
      loadDotenvFiles(filepath);
    }

    // Substitute environment variables and argv using bash-style syntax: ${VAR:-default}, ${argv[0]:-default}
    templateContent = substituteEnvVars(templateContent, templateArgs);

    // Debug: Show first 100 chars of template content
    // console.log(`📄 Template content: ${templateContent.substring(0, 100)}...`);

    // Handle print options and debug (use basic context without engine)
    if (options.printTree || options.printJson || options.debug) {
      // Parse the melker file to extract UI and scripts
      const parseResult = parseMelkerFile(templateContent);
      const ui = parseResult.element;

      // Import Document class for tree display
      const { Document } = await import('./document.ts');
      const { elementToJson } = await import('./serialization.ts');

      if (options.printJson) {
        const json = elementToJson(ui);
        console.log(json);
      }

      if (options.printTree) {
        const doc = new Document(ui);
        console.log(doc.asTree());
      }

      if (options.debug) {
        console.log('\n' + '='.repeat(80));
        console.log('MELKER DEBUG MODE');
        console.log('='.repeat(80));

        // System info
        console.log('\nSYSTEM INFO');
        console.log('-'.repeat(40));
        const loggerOpts = getGlobalLoggerOptions();
        const theme = getCurrentTheme();
        console.log(`  File:       ${filepath}`);
        console.log(`  Theme:      ${theme.type}-${theme.mode} (${theme.colorSupport})`);
        console.log(`  Log file:   ${loggerOpts.logFile}`);
        console.log(`  Log level:  ${loggerOpts.level}`);
        console.log(`  Deno:       ${Deno.version.deno}`);
        console.log(`  Platform:   ${Deno.build.os} ${Deno.build.arch}`);

        // Track debug failures
        const debugFailures: string[] = [];

        // Debug: Process scripts and show transpilation results
        console.log('\nSCRIPT PROCESSING');
        console.log('-'.repeat(40));
        const basePath = getBaseUrl(filepath);
        // Create a dummy context for debug mode (engine won't be available)
        const debugLogger = (() => { try { return getLogger(`${filename}:debug`); } catch { return null; } })();
        const debugContext = {
          engine: {
            onResize: () => { console.log('   Debug: onResize() called'); },
            onMount: () => { console.log('   Debug: onMount() called'); },
            render: () => { console.log('   Debug: render() called'); },
            forceRender: () => { console.log('   Debug: forceRender() called'); }
          },
          getElementById: () => null,
          exit: () => { console.log('   Debug: exit() called'); },
          logger: debugLogger,
        };

        // Auto-retain bundle files in debug mode
        Deno.env.set('MELKER_RETAIN_BUNDLE', 'true');

        // Parse for bundler (extracts scripts and handlers with positions)
        const sourceUrl = isUrl(filepath)
          ? filepath
          : `file://${filepath.startsWith('/') ? filepath : Deno.cwd() + '/' + filepath}`;

        try {
          const bundlerParseResult = await parseMelkerForBundler(templateContent, sourceUrl);
          console.log(`  Scripts: ${bundlerParseResult.scripts.length}`);
          console.log(`  Handlers: ${bundlerParseResult.handlers.length}`);

          // Process through bundler pipeline with debug flag
          const assembled = await processMelkerBundle(bundlerParseResult, {
            debug: true,
            useCache: false,
          });

          console.log('\nBUNDLE OUTPUT');
          console.log('-'.repeat(40));
          console.log(`  Template lines: ${assembled.template.split('\n').length}`);
          console.log(`  Bundled code size: ${assembled.bundledCode.length} bytes`);
          console.log(`  Source map: ${assembled.bundleSourceMap ? 'present' : 'none'}`);

          // Execute the bundled code with debug context
          try {
            const registry = await executeBundle(assembled, debugContext);
            console.log('\nREGISTRY');
            console.log('-'.repeat(40));
            console.log(`  __init: ${registry.__init ? 'present' : 'none'}`);
            console.log(`  __ready: ${registry.__ready ? 'present' : 'none'}`);
            const handlerKeys = Object.keys(registry).filter(k => k.startsWith('__h'));
            console.log(`  Handlers: ${handlerKeys.join(', ') || 'none'}`);
          } catch (error) {
            debugFailures.push(`Bundle execution: ${error instanceof Error ? error.message : String(error)}`);
          }

          // Print debug file locations
          console.log('\nDEBUG FILES (retained)');
          console.log('-'.repeat(40));
          console.log(`  Generated TS:  /tmp/melker-generated.ts`);
          console.log(`  Bundled JS:    /tmp/melker-bundled.js`);
        } catch (error) {
          debugFailures.push(`Bundler: ${error instanceof Error ? error.message : String(error)}`);
        }

        console.log('\n' + '='.repeat(80));
        console.log('DEBUG PROCESSING COMPLETE');
        if (debugFailures.length > 0) {
          console.log('\nFAILURES:');
          debugFailures.forEach((failure, index) => {
            console.log(`${index + 1}. ${failure}`);
          });
        } else {
          console.log('\nAll processing completed successfully.');
        }
        console.log('='.repeat(80));
      }

      // Exit after printing
      Deno.exit(0);
    }

    // Clean approach: Create engine first, then parse UI with engine as context

    // Step 0: Load persisted state BEFORE parsing (so createElement can use it)
    // Only if MELKER_PERSIST=true and --no-load is not set
    const { loadFromFile, DEFAULT_PERSISTENCE_MAPPINGS, isPersistenceEnabled, getStateFilePath } = await import('./state-persistence.ts');
    const { setPersistenceContext } = await import('./element.ts');
    const appId = await hashFilePath(filepath);
    const persistEnabled = isPersistenceEnabled();
    const loadedState = await loadFromFile(appId, options.noLoad);

    // Set up persistence context for createElement to use during parsing
    setPersistenceContext({
      state: loadedState,
      document: null,  // No document yet
      mappings: DEFAULT_PERSISTENCE_MAPPINGS,
    });

    // Step 1: Parse the melker file to extract UI and scripts
    const parseResult = parseMelkerFile(templateContent);

    // Set console title if specified, and save original for restoration
    let originalTitle: string | undefined;
    if (parseResult.title) {
      // Save original title (query via xterm escape sequence - not reliably supported, so we just note we changed it)
      originalTitle = ''; // We can't reliably get the original, but we'll restore to empty
      // Set new title using xterm escape sequence: ESC ] 0 ; title BEL
      const encoder = new TextEncoder();
      await Deno.stdout.write(encoder.encode(`\x1b]0;${parseResult.title}\x07`));
    }

    // Step 2: Create engine with minimal placeholder UI
    const placeholderUI = createEl('container', { style: { width: 1, height: 1 } });
    const engine = await createMelkerApp(placeholderUI);

    // Step 2.1: Enable state persistence only if MELKER_PERSIST=true
    if (persistEnabled) {
      await engine.enablePersistence(appId);
    }

    // Set source content for View Source feature (F12)
    if (viewSource) {
      engine.setSource(viewSource.content, viewSource.path, viewSource.type, viewSource.convertedContent);
    } else {
      engine.setSource(originalContent, filepath, 'melker');
    }

    // Step 2.5: Apply stylesheet to element tree if present
    // This merges stylesheet styles into element props.style at creation time
    if (parseResult.stylesheet) {
      parseResult.stylesheet.applyTo(parseResult.element);
    }

    // Get base path for resolving relative script src paths and imports
    const basePath = getBaseUrl(filepath);

    // Step 3: Create context with real engine first
    // Get logger for error reporting
    const logger = (() => { try { return getLogger(filename); } catch { return null; } })();

    // Prepare oauth config from parsed file (if present)
    const oauthConfig = parseResult.oauthConfig ? {
      wellknown: parseResult.oauthConfig.wellknown,
      clientId: parseResult.oauthConfig.clientId,
      redirectUri: parseResult.oauthConfig.redirectUri,
      scopes: parseResult.oauthConfig.scopes,
      audience: parseResult.oauthConfig.audience,
      autoLogin: parseResult.oauthConfig.autoLogin,
      debugServer: parseResult.oauthConfig.debugServer,
      // Callback expressions (to be wired up by the script)
      onLoginExpr: parseResult.oauthConfig.onLogin,
      onLogoutExpr: parseResult.oauthConfig.onLogout,
      onFailExpr: parseResult.oauthConfig.onFail,
    } : undefined;

    const context = {
      getElementById: (id: string) => engine?.document?.getElementById(id),
      render: () => engine.render(),
      exit: () => engine.stop().then(() => Deno.exit(0)),
      quit: () => engine.stop().then(() => Deno.exit(0)),
      setTitle: (title: string) => engine.setTitle(title),
      alert: (message: string) => engine.showAlert(String(message)),
      copyToClipboard: async (text: string) => {
        // Platform-specific clipboard commands
        const commands = [
          { cmd: 'pbcopy', args: [] },  // macOS
          { cmd: 'xclip', args: ['-selection', 'clipboard'] },  // Linux X11
          { cmd: 'xsel', args: ['--clipboard', '--input'] },  // Linux X11
          { cmd: 'wl-copy', args: [] },  // Linux Wayland
          { cmd: 'clip.exe', args: [] },  // WSL2
        ];
        for (const { cmd, args } of commands) {
          try {
            const process = new Deno.Command(cmd, {
              args,
              stdin: 'piped',
              stdout: 'null',
              stderr: 'null',
            });
            const child = process.spawn();
            const writer = child.stdin.getWriter();
            await writer.write(new TextEncoder().encode(text));
            await writer.close();
            const status = await child.status;
            if (status.success) return true;
          } catch {
            // Command not found, try next
          }
        }
        return false;
      },
      engine: engine,
      logger: logger,
      logging: logger,  // Alias for logger
      persistenceEnabled: persistEnabled,  // Whether MELKER_PERSIST=true
      stateFilePath: persistEnabled ? getStateFilePath(appId) : null,  // Path to the state file (null if persistence disabled)
      oauth: oauth,
      oauthConfig: oauthConfig,
      createElement: (type: string, props: Record<string, any> = {}, ...children: any[]) => {
        return createEl(type, props, ...children);
      },
      // Helper for importing modules relative to the .melker file's location
      melkerImport: async (specifier: string) => {
        // Resolve the specifier relative to the .melker file's directory
        const resolvedUrl = new URL(specifier, basePath).href;
        return await import(resolvedUrl);
      },
      // Register custom AI tools for the assistant
      registerAITool: registerAITool,
    };

    // Use the single element tree from the initial parse
    const ui = parseResult.element;

    // Parse for bundler (extracts scripts and handlers with positions)
    const sourceUrl = isUrl(filepath)
      ? filepath
      : `file://${filepath.startsWith('/') ? filepath : Deno.cwd() + '/' + filepath}`;
    const bundlerParseResult = await parseMelkerForBundler(templateContent, sourceUrl);

    // Build handler code map: original code -> handler ID (e.g., "incrementCounter()" -> "__h0")
    const handlerCodeMap = new Map<string, string>();
    for (const handler of bundlerParseResult.handlers) {
      handlerCodeMap.set(handler.code, handler.id);
    }

    // Process through bundler pipeline
    const assembled = await processMelkerBundle(bundlerParseResult, {
      debug: options.debug,
      useCache: options.useCache,
    });

    // Execute the bundled code
    const melkerRegistry = await executeBundle(assembled, context);

    // Auto-initialize OAuth if <oauth> element is present
    // This happens after scripts run so callbacks can be registered first
    if (oauthConfig?.wellknown) {
      // Create callback functions from string expressions
      const createCallback = (expr: string | undefined) => {
        if (!expr) return undefined;
        return () => {
          try {
            const fn = new Function('context', expr);
            fn(context);
          } catch (e: unknown) {
            logger?.error?.('OAuth callback error:', e instanceof Error ? e : new Error(String(e)));
          }
        };
      };

      const createErrorCallback = (expr: string | undefined) => {
        if (!expr) return undefined;
        return (error: Error) => {
          try {
            const fn = new Function('context', 'error', expr);
            fn(context, error);
          } catch (e: unknown) {
            logger?.error?.('OAuth error callback error:', e instanceof Error ? e : new Error(String(e)));
          }
        };
      };

      const initOptions = {
        ...oauthConfig,
        onLogin: createCallback(oauthConfig.onLoginExpr),
        onLogout: createCallback(oauthConfig.onLogoutExpr),
        onFail: createErrorCallback(oauthConfig.onFailExpr),
      };

      // Don't await - let it run in background so UI renders immediately
      oauth.init(initOptions).catch(() => {
        // Errors handled by onFail callback
      });
    }

    // Wire up bundler registry handlers to elements
    // Pass handlerCodeMap so we can look up handler IDs from original code
    // Create ErrorTranslator for mapping runtime errors back to original .melker lines
    const errorTranslator = new ErrorTranslator(
      assembled.bundleSourceMap,
      assembled.lineMap,
      assembled.originalContent,
      assembled.sourceUrl
    );
    await wireBundlerHandlers(ui, melkerRegistry, context, logger, handlerCodeMap, errorTranslator);

    // Step 4: Set the parsed UI to the engine using the proper updateUI method
    engine.updateUI(ui);

    // Force a complete re-render with the new UI
    // Use forceRender() instead of render() to ensure full redraw
    (engine as any).forceRender();

    // Trigger mount handlers after UI is loaded and rendered
    (engine as any)._triggerMountHandlers();

    // Call __ready lifecycle hook (after render)
    await callReady(melkerRegistry);

    // Set up graceful shutdown with protection against double Ctrl+C
    let cleanupInProgress = false;
    const cleanup = async (exitAfter: boolean = true) => {
      // Prevent second Ctrl+C from causing unclean exit
      if (cleanupInProgress) {
        return;  // Ignore - cleanup already in progress
      }
      cleanupInProgress = true;

      const encoder = new TextEncoder();

      // 1. Immediately block video rendering by setting flag
      if (engine) {
        (engine as any)._isInitialized = false;
      }

      // 2. Write "Stopping..." directly to screen (fully restore terminal first) - only if exiting
      if (exitAfter) {
        try {
          // Disable raw mode first so output works normally
          Deno.stdin.setRaw(false);
        } catch {
          // Ignore - may not be in raw mode
        }
        try {
          const restore = [
            '\x1b[?1049l',  // Exit alternate screen
            '\x1b[?25h',    // Show cursor
            '\x1b[0m',      // Reset attributes
            '\r\n',         // New line
            'Stopping...',
            '\r\n',
          ].join('');
          Deno.stdout.writeSync(encoder.encode(restore));
        } catch {
          // Ignore write errors
        }
      }

      // 3. Stop video/audio subprocesses
      if (engine) {
        try {
          const doc = (engine as any)._document;
          if (doc) {
            const videoElements = doc.getElementsByType('video');
            for (const el of videoElements) {
              if ('stopVideo' in el && typeof el.stopVideo === 'function') {
                await el.stopVideo();
              }
            }
          }
        } catch {
          // Ignore errors during video cleanup
        }
      }

      // 4. Restore terminal title if we changed it
      if (originalTitle !== undefined) {
        try {
          await Deno.stdout.write(encoder.encode('\x1b]0;\x07'));
        } catch {
          // Ignore
        }
      }

      // 5. Full engine stop (remaining cleanup)
      if (engine) {
        try {
          await engine.stop();
        } catch {
          // Ignore errors
        }
      }

      // 6. Remove signal listeners
      try {
        Deno.removeSignalListener('SIGINT', signalCleanup);
        Deno.removeSignalListener('SIGTERM', signalCleanup);
      } catch {
        // Ignore - listeners may not exist
      }

      if (exitAfter) {
        Deno.exit(0);
      }
    };

    // Wrapper for signal handlers that always exits
    const signalCleanup = () => cleanup(true);

    // Handle Ctrl+C gracefully
    Deno.addSignalListener('SIGINT', signalCleanup);
    Deno.addSignalListener('SIGTERM', signalCleanup);

    // Return engine and cleanup function for watch mode
    return {
      engine,
      cleanup: () => cleanup(false),
    };

  } catch (error) {
    // First, try to clean up the terminal state completely
    try {
      // Force complete terminal restoration
      const encoder = new TextEncoder();
      const restoreSequence = [
        '\x1b]0;\x07',  // Reset terminal title
        '\x1b[?1000l',  // Disable mouse tracking
        '\x1b[?1002l',  // Disable button event tracking
        '\x1b[?1003l',  // Disable any motion tracking
        '\x1b[?1006l',  // Disable SGR mouse mode
        '\x1b[?1049l',  // Exit alternate screen buffer
        '\x1b[?25h',    // Show cursor
        '\x1b[0m'       // Reset all attributes
      ].join('');
      await Deno.stdout.write(encoder.encode(restoreSequence));
      await Deno.stdout.write(encoder.encode('\n')); // Add newline for clean output
    } catch {
      // Ignore cleanup errors
    }

    // Now print the full error with stack trace
    console.error(`❌ Error running Melker file: ${error instanceof Error ? error.message : String(error)}`);

    if (error instanceof Error && error.stack) {
      console.error('\nFull stack trace:');
      console.error(error.stack);
    }

    Deno.exit(1);
  }
}

/**
 * Watch a file for changes and automatically reload the application
 */
export async function watchAndRun(
  filepath: string,
  options: { printTree?: boolean; printJson?: boolean; debug?: boolean; noLoad?: boolean; useCache?: boolean; watch?: boolean },
  templateArgs: string[],
  viewSource?: { content: string; path: string; type: 'md' | 'melker'; convertedContent?: string },
  preloadedContent?: string
): Promise<void> {
  const { getLogger } = await import('./logging.ts');
  const logger = getLogger('FileWatcher');

  // For markdown files, we need to watch the original .md file
  const watchPath = filepath;

  let currentResult: RunMelkerResult | void = undefined;

  // Function to start/restart the application
  const startApp = async (isReload: boolean = false) => {
    // Clean up previous instance if exists
    if (currentResult) {
      logger.info(`Stopping previous instance for reload: ${filepath}`);
      try {
        await currentResult.cleanup();
      } catch (error) {
        logger.warn(`Error during cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
      currentResult = undefined;
    }

    if (isReload) {
      logger.info(`Reloading application: ${filepath}`);
      // Clear custom AI tools from previous instance
      const { clearCustomTools } = await import('./ai/mod.ts');
      clearCustomTools();
    } else {
      logger.info(`Starting application with file watch: ${filepath}`);
    }

    try {
      // For .md files, we need to re-convert on each reload
      if (filepath.endsWith('.md')) {
        const { getRegisteredComponents } = await import('./lint.ts');
        const { markdownToMelker } = await import('./ascii/mod.ts');

        const mdContent = await loadContent(filepath);
        const elementTypes = new Set(getRegisteredComponents());
        const melkerContent = markdownToMelker(mdContent, filepath, { elementTypes });

        currentResult = await runMelkerFile(
          filepath,
          { ...options, watch: false }, // Don't pass watch to avoid recursion
          templateArgs,
          { content: mdContent, path: filepath, type: 'md', convertedContent: melkerContent },
          melkerContent
        );
      } else {
        // For .melker files, reload content fresh
        const content = preloadedContent && !isReload ? preloadedContent : await loadContent(filepath);
        currentResult = await runMelkerFile(
          filepath,
          { ...options, watch: false },
          templateArgs,
          viewSource,
          content
        );
      }

      if (isReload) {
        logger.info('Reload successful');
      }
    } catch (error) {
      logger.error('Error starting application: ' + (error instanceof Error ? error.message : String(error)));
      // Keep watching - user can fix the file and save again
    }
  };

  // Start the application initially
  await startApp(false);

  // Set up file watcher
  logger.info(`Watching for file changes: ${watchPath}`);

  // Create debounced reload function (150ms delay for editors that do multiple writes)
  const debouncedReload = debounce(async () => {
    logger.info(`File change detected: ${watchPath}`);
    await startApp(true);
  }, 150);

  try {
    const watcher = Deno.watchFs(watchPath);

    for await (const event of watcher) {
      // Only react to modify events
      if (event.kind === 'modify') {
        // Debounce rapid changes (e.g., from editors that do multiple writes)
        debouncedReload();
      }
    }
  } catch (error) {
    logger.error('File watcher error: ' + (error instanceof Error ? error.message : String(error)));
    // If watcher fails, just keep the app running without watch
  }
}

export function printUsage(): void {
  console.log('Melker CLI - Run Melker template files');
  console.log('');
  console.log('Requires: Deno >= 2.1.0 (Node.js and Bun are not supported)');
  console.log('');
  console.log('Usage:');
  console.log('  deno run --allow-read --allow-env melker.ts <file.melker> [options]');
  console.log('  deno run --allow-read --allow-env melker.ts <file.md> [options]');
  console.log('');
  console.log('Arguments:');
  console.log('  <file.melker>  Path to a .melker template file');
  console.log('  <file.md>      Path to a markdown file with melker-block code blocks');
  console.log('');
  console.log('Options:');
  console.log('  --print-tree   Display the element tree structure and exit');
  console.log('  --print-json   Display the JSON serialization and exit');
  console.log('  --debug        Show system info, debug script transpilation');
  console.log('  --lint         Enable lint mode to check for unsupported props/styles');
  console.log('  --schema       Output component schema documentation as markdown and exit');
  console.log('  --lsp          Start Language Server Protocol server for editor integration');
  console.log('  --convert      Convert markdown to .melker format (prints to stdout)');
  console.log('  --no-load      Skip loading persisted state (requires MELKER_PERSIST=true)');
  console.log('  --cache        Use bundle cache (default: disabled)');
  console.log('  --watch        Watch file for changes and auto-reload (local files only)');
  console.log('  --help, -h     Show this help message');
  console.log('');
  console.log('Example .melker file content:');
  console.log('  <container style="width: 40; height: 10; border: thin; padding: 1;">');
  console.log('    <text style="color: green; font-weight: bold;">');
  console.log('      Hello from Melker!');
  console.log('    </text>');
  console.log('  </container>');
  console.log('');
  console.log('Advanced .melker files with script context:');
  console.log('  <melker>');
  console.log('    <script type="typescript">');
  console.log('      const myFunction = (name) => `Hello, ${name}!`;');
  console.log('      exports = { myFunction };');
  console.log('    </script>');
  console.log('');
  console.log('    <!-- Or load external script file -->');
  console.log('    <script type="typescript" src="utils.ts"></script>');
  console.log('');
  console.log('    <container>');
  console.log('      <button onClick="context.myFunction(\'World\')" />');
  console.log('    </container>');
  console.log('  </melker>');
  console.log('');
  console.log('Available functions in .melker files:');
  console.log('  - getThemeColor()  Get theme colors');
  console.log('  - getTerminalSize() Get terminal dimensions');
  console.log('  - createElement()  Create elements programmatically');
  console.log('');
  console.log('Interactive functions (in event handlers):');
  console.log('  - context.getElementById(id)  Find elements by ID');
  console.log('  - context.render()  Manually trigger re-render');
  console.log('  - context.setTitle(title)  Set terminal window title');
  console.log('  - context.exit()   Exit the application gracefully');
  console.log('  - context.engine   Access to the full engine instance');
  console.log('');
  console.log('Environment variables:');
  console.log('  MELKER_THEME     Theme selection (bw-std, fullcolor-dark, etc.)');
  console.log('  MELKER_PERSIST   Enable state persistence (true/1 to enable, default: false)');
  console.log('                   State is saved to $XDG_STATE_HOME/melker/ (~/.local/state/melker/)');
  console.log('  XDG_STATE_HOME   Override state directory (default: ~/.local/state)');
  console.log('  XDG_CONFIG_HOME  Override config directory (default: ~/.config)');
  console.log('  XDG_CACHE_HOME   Override cache directory (default: ~/.cache)');
  console.log('');
  console.log('Example files:');
  console.log('  examples/melker/hello.melker           - Simple greeting example');
  console.log('  examples/melker/example.melker         - CSS and object style demo');
  console.log('  examples/melker/simple-interactive.melker - Basic interactivity');
  console.log('  examples/melker/input-demo.melker      - Input with Enter key handling');
  console.log('  examples/melker/counter.melker         - Interactive counter app');
  console.log('  examples/melker/interactive.melker     - Advanced interactive example');
  console.log('  examples/melker/script-demo.melker     - Script context and TypeScript functions');
  console.log('  examples/melker/typescript-test.melker - TypeScript transpilation test');
  console.log('  examples/melker/typescript-handlers.melker - TypeScript string event handlers');
  console.log('  examples/melker/external-script-demo.melker - External TypeScript module example');
}

// Generate markdown documentation from component schemas
async function generateSchemaMarkdown(): Promise<string> {
  // Import melker.ts to ensure all components are registered
  await import('../melker.ts');

  const {
    getRegisteredComponents,
    getComponentSchema,
    BASE_PROPS_SCHEMA,
    BASE_STYLES_SCHEMA,
  } = await import('./lint.ts');

  const lines: string[] = [];

  lines.push('# Melker Component Schema Reference');
  lines.push('');
  lines.push('Auto-generated documentation for all Melker UI components.');
  lines.push('');

  // Helper to format prop type
  const formatType = (type: string | string[]): string => {
    if (Array.isArray(type)) {
      return type.join(' | ');
    }
    return type;
  };

  // Helper to generate prop table
  const generatePropTable = (props: Record<string, any>, title: string): void => {
    const propNames = Object.keys(props).sort();
    if (propNames.length === 0) return;

    lines.push(`### ${title}`);
    lines.push('');
    lines.push('| Property | Type | Required | Description |');
    lines.push('|----------|------|----------|-------------|');

    for (const name of propNames) {
      const prop = props[name];
      const type = formatType(prop.type);
      const required = prop.required ? 'Yes' : '';
      const desc = prop.description || '';
      const enumVals = prop.enum ? ` (${prop.enum.join(', ')})` : '';
      lines.push(`| \`${name}\` | ${type}${enumVals} | ${required} | ${desc} |`);
    }
    lines.push('');
  };

  // Base props section
  lines.push('## Base Properties');
  lines.push('');
  lines.push('These properties are available on all components.');
  lines.push('');
  generatePropTable(BASE_PROPS_SCHEMA, 'Props');

  // Base styles section
  lines.push('## Base Styles');
  lines.push('');
  lines.push('These styles can be used in the `style` attribute of any component.');
  lines.push('');
  generatePropTable(BASE_STYLES_SCHEMA, 'Styles');

  // Component sections
  lines.push('## Components');
  lines.push('');

  const components = getRegisteredComponents().sort();

  for (const name of components) {
    const schema = getComponentSchema(name);
    if (!schema) continue;

    lines.push(`### \`<${name}>\``);
    lines.push('');
    if (schema.description) {
      lines.push(schema.description);
      lines.push('');
    }

    if (Object.keys(schema.props).length > 0) {
      lines.push('| Property | Type | Required | Description |');
      lines.push('|----------|------|----------|-------------|');

      for (const [propName, prop] of Object.entries(schema.props).sort((a, b) => a[0].localeCompare(b[0]))) {
        const type = formatType(prop.type);
        const required = prop.required ? 'Yes' : '';
        const desc = prop.description || '';
        const enumVals = prop.enum ? ` (${prop.enum.join(', ')})` : '';
        lines.push(`| \`${propName}\` | ${type}${enumVals} | ${required} | ${desc} |`);
      }
      lines.push('');
    }

    if (schema.styles && Object.keys(schema.styles).length > 0) {
      lines.push('**Component-specific styles:**');
      lines.push('');
      lines.push('| Style | Type | Description |');
      lines.push('|-------|------|-------------|');

      for (const [styleName, style] of Object.entries(schema.styles).sort((a, b) => a[0].localeCompare(b[0]))) {
        const type = formatType(style.type);
        const desc = style.description || '';
        lines.push(`| \`${styleName}\` | ${type} | ${desc} |`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// Main CLI entry point
export async function main(): Promise<void> {
  const args = Deno.args;

  if (args.length === 0) {
    printUsage();
    Deno.exit(0);
  }

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    Deno.exit(0);
  }

  // Handle --schema option (doesn't require a file)
  if (args.includes('--schema')) {
    const markdown = await generateSchemaMarkdown();
    console.log(markdown);
    Deno.exit(0);
  }

  // Handle --lsp option (doesn't require a file)
  if (args.includes('--lsp')) {
    const { startLspServer } = await import('./lsp.ts');
    await startLspServer();
    // Never returns - server runs until connection closes
  }

  // Parse options
  const options = {
    printTree: args.includes('--print-tree'),
    printJson: args.includes('--print-json'),
    debug: args.includes('--debug'),
    lint: args.includes('--lint'),
    noLoad: args.includes('--no-load'),
    useCache: args.includes('--cache'),
    watch: args.includes('--watch'),
  };

  // Enable lint mode if requested
  if (options.lint) {
    const { enableLint } = await import('./lint.ts');
    enableLint(true);
  }

  // Find the file argument (first non-option argument)
  const filepathIndex = args.findIndex(arg => !arg.startsWith('--'));
  const filepath = filepathIndex >= 0 ? args[filepathIndex] : undefined;

  if (!filepath) {
    console.error('❌ Error: No .melker file specified');
    console.error('Use --help for usage information');
    Deno.exit(1);
  }

  // Handle --convert option for markdown files
  if (args.includes('--convert')) {
    const mdIndex = args.findIndex(arg => arg.endsWith('.md'));
    if (mdIndex < 0) {
      console.error('Error: --convert requires a .md file');
      Deno.exit(1);
    }
    const mdFile = args[mdIndex];

    try {
      // Import components to register their schemas
      await import('./components/mod.ts');
      const { getRegisteredComponents } = await import('./lint.ts');
      const { markdownToMelker } = await import('./ascii/mod.ts');

      const mdContent = await Deno.readTextFile(mdFile);
      const elementTypes = new Set(getRegisteredComponents());
      const melkerContent = markdownToMelker(mdContent, mdFile, { elementTypes });

      console.log(melkerContent);
      Deno.exit(0);
    } catch (error) {
      console.error(`Error converting markdown: ${error instanceof Error ? error.message : String(error)}`);
      Deno.exit(1);
    }
  }

  // Support .md files directly (convert and run)
  if (filepath.endsWith('.md')) {
    // Check if watch mode is requested but file is a URL
    if (options.watch && isUrl(filepath)) {
      console.error('❌ Error: --watch is not supported for URLs');
      Deno.exit(1);
    }

    try {
      // Import components to register their schemas
      await import('./components/mod.ts');
      const { getRegisteredComponents } = await import('./lint.ts');
      const { markdownToMelker } = await import('./ascii/mod.ts');

      const mdContent = await loadContent(filepath);
      const elementTypes = new Set(getRegisteredComponents());
      const melkerContent = markdownToMelker(mdContent, filepath, { elementTypes });

      // Build templateArgs
      const absoluteFilepath = filepath.startsWith('/') ? filepath : `${Deno.cwd()}/${filepath}`;
      const mdTemplateArgs = [absoluteFilepath, ...args.slice(filepathIndex + 1).filter(arg => !arg.startsWith('--'))];

      // Use watchAndRun if --watch is specified
      if (options.watch) {
        await watchAndRun(absoluteFilepath, options, mdTemplateArgs, {
          content: mdContent,
          path: absoluteFilepath,
          type: 'md',
          convertedContent: melkerContent,
        }, melkerContent);
      } else {
        // Run directly with converted content, passing original .md content for View Source feature
        await runMelkerFile(absoluteFilepath, options, mdTemplateArgs, {
          content: mdContent,
          path: absoluteFilepath,
          type: 'md',
          convertedContent: melkerContent,
        }, melkerContent);
      }

      return;
    } catch (error) {
      console.error(`❌ Error running markdown: ${error instanceof Error ? error.message : String(error)}`);
      Deno.exit(1);
    }
  }

  if (!filepath.endsWith('.melker')) {
    console.error('❌ Error: File must have .melker or .md extension');
    console.error('Use --help for usage information');
    Deno.exit(1);
  }

  // Check if watch mode is requested but file is a URL
  if (options.watch && isUrl(filepath)) {
    console.error('❌ Error: --watch is not supported for URLs');
    Deno.exit(1);
  }

  // Extract template arguments: argv[0] is the .melker file path, followed by args after it
  const absoluteFilepath = filepath.startsWith('/') ? filepath : `${Deno.cwd()}/${filepath}`;
  const templateArgs = [absoluteFilepath, ...args.slice(filepathIndex + 1).filter(arg => !arg.startsWith('--'))];

  // Check required permissions before proceeding (prevents Deno permission prompts)
  checkRequiredPermissions(filepath);

  try {
    // Check if file exists (skip for URLs)
    if (!isUrl(filepath)) {
      await Deno.stat(filepath);
    }

    // Use watchAndRun if --watch is specified
    if (options.watch) {
      await watchAndRun(absoluteFilepath, options, templateArgs);
    } else {
      await runMelkerFile(filepath, options, templateArgs);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.error(`❌ Error: File not found: ${filepath}`);
    } else {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    Deno.exit(1);
  }
}

/**
 * Substitute environment variables and command-line arguments in template content.
 * Supports bash-style syntax:
 *   ${VAR}           - replaced with env var value, or empty string if not set
 *   ${VAR:-default}  - replaced with env var value, or default if not set
 *   ${argv[0]}       - full path to the .melker file itself
 *   ${argv[1]}       - first user-provided arg after the .melker file
 *   ${argv[n]:-default} - nth arg, or default if not provided
 */
function substituteEnvVars(content: string, args: string[]): string {
  // First, handle argv[n] substitutions
  content = content.replace(/\$\{argv\[(\d+)\](?::-([^}]*))?\}/g, (_match, indexStr, defaultValue) => {
    const index = parseInt(indexStr, 10);
    if (index < args.length) {
      return args[index];
    }
    return defaultValue !== undefined ? defaultValue : '';
  });

  // Then handle environment variables: ${VAR} or ${VAR:-default}
  content = content.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_match, varName, defaultValue) => {
    const envValue = Deno.env.get(varName);
    if (envValue !== undefined) {
      return envValue;
    }
    return defaultValue !== undefined ? defaultValue : '';
  });

  return content;
}

