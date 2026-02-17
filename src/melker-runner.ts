// Melker Runner
// Sandboxed app execution - handles template parsing, bundling, and engine creation.
// This is spawned by melker-launcher.ts with restricted Deno permissions.

import { resolve } from './deps.ts';
import { debounce } from './utils/timing.ts';
import { isUrl, loadContent } from './utils/content-loader.ts';
import { ensureError } from './utils/error.ts';
import { restoreTerminal } from './terminal-lifecycle.ts';
import { Env } from './env.ts';
import { parseCliFlags, MelkerConfig } from './config/mod.ts';
import { getLogger, reconfigureGlobalLogger } from './logging.ts';
import { isStdoutEnabled, isStdoutAutoEnabled, getStdoutConfig, bufferToStdout, trimStdoutOutput } from './stdout.ts';

// Import library to register components before template parsing
import '../mod.ts';

// Bundler imports
import {
  processMelkerBundle,
  executeBundle,
  callReady,
  ErrorTranslator,
  type MelkerRegistry,
} from './bundler/mod.ts';
import { parseMelkerForBundler } from './template.ts';
import { getGlobalErrorOverlay } from './error-overlay.ts';

// Policy imports (for View Source feature only)
import {
  loadPolicy,
  loadPolicyFromContent,
  formatPolicy,
  getApprovalFilePath,
  createAutoPolicy,
  type MelkerPolicy,
} from './policy/mod.ts';
import {
  applyPermissionOverrides,
  type PermissionOverrides,
} from './policy/permission-overrides.ts';

// Dev tools types
import type { SystemInfo } from './dev-tools.ts';

// Browser utility
import { openBrowser } from './oauth/browser.ts';

// Global types
import type { MelkerContext } from './globals.d.ts';

// Toast system
import { getToastManager, type ToastOptions } from './toast/mod.ts';

/**
 * Wire up bundler registry handlers to UI elements.
 */
async function wireBundlerHandlers(
  element: any,
  registry: MelkerRegistry,
  context: any,
  logger: any,
  handlerCodeMap?: Map<string, string>,
  errorTranslator?: ErrorTranslator
): Promise<void> {
  // These callbacks don't need auto-render after each call:
  // - onPaint/onShader: rendering is handled by the component's own loop
  // - onMouseMove/onMouseOut/onMouseOver: typically just update state, component handles display
  // - onInput: fast input rendering is handled separately
  const noAutoRenderCallbacks = ['onPaint', 'onShader', 'onMouseMove', 'onMouseOut', 'onMouseOver', 'onInput', 'onTooltip'];

  if (element.props) {
    for (const [propName, propValue] of Object.entries(element.props)) {
      if (
        propName.startsWith('on') &&
        typeof propValue === 'object' &&
        propValue &&
        (propValue as any).__isStringHandler
      ) {
        const handlerCode = (propValue as any).__handlerCode;
        // Match both old format (__h0) and new format (__tag_id_event_0)
        const registryMatch = handlerCode.match(/__melker\.((?:__h\d+)|(?:__[a-zA-Z_][a-zA-Z0-9_]*))\(([^)]*)\)/);

        let handlerId: string | undefined;
        let handlerFn: ((event?: unknown) => void | Promise<void>) | undefined;

        if (registryMatch && registryMatch[1]) {
          const id = registryMatch[1];
          handlerId = id;
          handlerFn = (registry as any)[id];
        } else if (handlerCodeMap) {
          const id = handlerCodeMap.get(handlerCode);
          if (id) {
            handlerId = id;
            handlerFn = (registry as any)[id];
          }
        }

        if (handlerId && handlerFn) {
          const shouldAutoRender = !noAutoRenderCallbacks.includes(propName);
          const capturedHandlerId = handlerId;
          const capturedHandlerFn = handlerFn;

          // Special handling for onShader/onFilter - they return a function reference, not event handler code
          // Call the registry function once to get the actual shader/filter function
          if (propName === 'onShader' || propName === 'onFilter') {
            try {
              const shaderFn = capturedHandlerFn();
              if (typeof shaderFn === 'function') {
                element.props[propName] = shaderFn;
              } else {
                logger?.error?.(`onShader must return a function, got ${typeof shaderFn}`);
              }
            } catch (error) {
              const err = ensureError(error);
              logger?.error?.(`Error getting shader function:`, err);
              getGlobalErrorOverlay().showError(err.message);
            }
          } else {
            element.props[propName] = async (event: any) => {
              try {
                let result: unknown = capturedHandlerFn(event);
                if (result instanceof Promise) {
                  result = await result;
                }
                // Auto-render unless skipRender() was called or result is false (legacy)
                if (shouldAutoRender && context?.render && result !== false && !context._shouldSkipRender()) {
                  context.render();
                }
                return result;
              } catch (error) {
                const err = ensureError(error);
                let location: string | undefined;

                if (errorTranslator) {
                  const handlerMapping = errorTranslator.findBySourceId(capturedHandlerId);
                  if (handlerMapping) {
                    location = `${errorTranslator.getSourceFile()}:${handlerMapping.originalLine}`;
                    logger?.error?.(
                      `Error in handler ${capturedHandlerId} at ${location}:`,
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

                getGlobalErrorOverlay().showError(err.message, location);
                if (context?.render) {
                  context.render();
                }
                return undefined;
              }
            };
          }
        } else {
          // Handler not in registry - check if it's inline code (from dynamic content like graph components)
          // Inline handlers don't contain __melker. references
          const isInlineHandler = !handlerCode.includes('__melker.');

          if (isInlineHandler) {
            // Create a function that evaluates the inline handler code
            // Provide access to $melker, $app, event, and common globals
            const shouldAutoRender = !noAutoRenderCallbacks.includes(propName);

            element.props[propName] = async (event: any) => {
              try {
                // Build evaluation context with globals
                const evalContext = {
                  $melker: context,
                  $app: (registry as any).$app || {},
                  event,
                  alert: (msg: string) => context?.showAlert?.(msg) || globalThis.alert?.(msg),
                  console: globalThis.console,
                };

                // Create function with context variables in scope
                const handlerFn = new Function(
                  '$melker', '$app', 'event', 'alert', 'console',
                  `return (async () => { ${handlerCode} })();`
                );

                const result = await handlerFn(
                  evalContext.$melker,
                  evalContext.$app,
                  evalContext.event,
                  evalContext.alert,
                  evalContext.console
                );

                // Auto-render unless skipRender() was called
                if (shouldAutoRender && context?.render && !context._shouldSkipRender()) {
                  context.render();
                }
                return result;
              } catch (error) {
                const err = ensureError(error);
                logger?.error?.(`Error in inline handler for ${propName}: ${err.message}`);
                getGlobalErrorOverlay().showError(`Handler error: ${err.message}`);
                if (context?.render) {
                  context.render();
                }
                return undefined;
              }
            };

            logger?.debug?.(`Wired inline handler for ${propName}: ${handlerCode.slice(0, 30)}...`);
          } else {
            const errorMsg = `Handler not found in registry for ${propName}. Code: ${handlerCode.slice(0, 50)}...`;
            logger?.error?.(errorMsg);
            getGlobalErrorOverlay().showError(errorMsg);
          }
        }
      }
    }
  }

  if (element.children && Array.isArray(element.children)) {
    for (const child of element.children) {
      await wireBundlerHandlers(child, registry, context, logger, handlerCodeMap, errorTranslator);
    }
  }
}

function getBaseUrl(pathOrUrl: string): string {
  if (isUrl(pathOrUrl)) {
    const url = new URL(pathOrUrl);
    const pathParts = url.pathname.split('/');
    pathParts.pop();
    url.pathname = pathParts.join('/') + '/';
    return url.href;
  }
  const absolutePath = pathOrUrl.startsWith('/') ? pathOrUrl : `${Deno.cwd()}/${pathOrUrl}`;
  return `file://${absolutePath.split('/').slice(0, -1).join('/')}/`;
}

export interface RunMelkerResult {
  engine: any;
  cleanup: () => Promise<void>;
}

function substituteEnvVars(content: string, args: string[]): string {
  const logger = getLogger('Runner');

  // argv substitution with all operators: :- (default), :+ (alternate), :? (required)
  content = content.replace(
    /\$\{argv\[(\d+)\](?:(:[-+?])([^}]*))?\}/g,
    (_match, indexStr, operator, value) => {
      const index = parseInt(indexStr, 10);
      const argValue = index < args.length ? args[index] : undefined;
      const isSet = argValue !== undefined && argValue !== '';

      switch (operator) {
        case ':-':
          return isSet ? argValue : (value ?? '');
        case ':+':
          return isSet ? value : '';
        case ':?':
          if (!isSet) {
            const msg = `argv[${index}]: ${value || 'argument is required'}`;
            logger.error(msg);
            console.error(msg);
            Deno.exit(1);
          }
          return argValue;
        default:
          return argValue ?? '';
      }
    }
  );

  // ENV substitution with all operators: :- (default), :+ (alternate), :? (required)
  content = content.replace(
    /\$ENV\{([A-Za-z_][A-Za-z0-9_]*)(?:(:[-+?])([^}]*))?\}/g,
    (_match, varName, operator, value) => {
      const envValue = Env.get(varName);
      const isSet = envValue !== undefined && envValue !== '';

      switch (operator) {
        case ':-':
          return isSet ? envValue : (value ?? '');
        case ':+':
          return isSet ? value : '';
        case ':?':
          if (!isSet) {
            const msg = `${varName}: ${value || 'environment variable is required'}`;
            logger.error(msg);
            console.error(msg);
            Deno.exit(1);
          }
          return envValue;
        default:
          return envValue ?? '';
      }
    }
  );

  return content;
}

/**
 * Run a .melker file
 */
export async function runMelkerFile(
  filepath: string,
  options: { printTree?: boolean; printJson?: boolean; debug?: boolean; noLoad?: boolean; useCache?: boolean; watch?: boolean } = {},
  templateArgs: string[] = [],
  viewSource?: { content: string; path: string; type: 'md' | 'melker' | 'mmd'; convertedContent?: string },
  preloadedContent?: string
): Promise<RunMelkerResult | void> {
  try {
    const filename = filepath.split('/').pop()?.replace(/\.melker$/, '') || 'unknown';

    // Import mod.ts to ensure component registrations
    await import('../mod.ts');

    const { melker: melkerTemplate, parseMelkerFile } = await import('./template.ts');
    const { getThemeColor: themeColor, initThemes } = await import('./theme.ts');
    await initThemes();
    const { getTerminalSize: terminalSize } = await import('../mod.ts');
    const { createElement: createEl } = await import('./element.ts');
    const { createApp: createMelkerApp } = await import('./engine.ts');
    const { getLogger, getGlobalLoggerOptions } = await import('./logging.ts');
    const { getCurrentTheme, getThemeManager } = await import('./theme.ts');
    const oauth = await import('./oauth.ts');
    const { hashFilePath } = await import('./state-persistence.ts');
    const { registerAITool, clearCustomTools } = await import('./ai/mod.ts');
    const { dirname } = await import('https://deno.land/std@0.224.0/path/mod.ts');

    let templateContent = preloadedContent ?? await loadContent(filepath);
    const originalContent = templateContent;

    templateContent = substituteEnvVars(templateContent, templateArgs);

    // Handle debug/print options
    if (options.printTree || options.printJson || options.debug) {
      const parseResult = parseMelkerFile(templateContent);
      const ui = parseResult.element;

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
        console.log('MELKER VERBOSE MODE');
        console.log('='.repeat(80));

        const loggerOpts = getGlobalLoggerOptions();
        const theme = getCurrentTheme();
        console.log('\nSYSTEM INFO');
        console.log('-'.repeat(40));
        console.log(`  File:       ${filepath}`);
        console.log(`  Theme:      ${getThemeManager().getCurrentThemeName()} (${theme.colorSupport})`);
        console.log(`  Log file:   ${loggerOpts.logFile}`);
        console.log(`  Log level:  ${loggerOpts.level}`);
        console.log(`  Deno:       ${Deno.version.deno}`);
        console.log(`  Platform:   ${Deno.build.os} ${Deno.build.arch}`);

        try { Deno.env.set('MELKER_RETAIN_BUNDLE', 'true'); } catch { /* env permission may not include this var */ }

        const sourceUrl = isUrl(filepath)
          ? filepath
          : `file://${filepath.startsWith('/') ? filepath : Deno.cwd() + '/' + filepath}`;

        try {
          const bundlerParseResult = await parseMelkerForBundler(templateContent, sourceUrl);
          console.log('\nSCRIPT PROCESSING');
          console.log('-'.repeat(40));
          console.log(`  Scripts: ${bundlerParseResult.scripts.length}`);
          console.log(`  Handlers: ${bundlerParseResult.handlers.length}`);

          const assembled = await processMelkerBundle(bundlerParseResult, { debug: true, useCache: false });

          console.log('\nBUNDLE OUTPUT');
          console.log('-'.repeat(40));
          console.log(`  Template lines: ${assembled.template.split('\n').length}`);
          console.log(`  Bundled code size: ${assembled.bundledCode.length} bytes`);

          const debugLogger = (() => { try { return getLogger(`${filename}:debug`); } catch { return null; } })();
          const debugContext = {
            engine: { onResize: () => {}, onMount: () => {}, render: () => {}, forceRender: () => {} },
            getElementById: () => null,
            exit: () => {},
            logger: debugLogger,
            getLogger: getLogger,
            config: MelkerConfig.get(),
            exports: {} as Record<string, any>,
          };

          const { registry, bundleFile } = await executeBundle(assembled, debugContext);
          console.log('\nREGISTRY');
          console.log('-'.repeat(40));
          console.log(`  __init: ${registry.__init ? 'present' : 'none'}`);
          console.log(`  __ready: ${registry.__ready ? 'present' : 'none'}`);
          const handlerKeys = Object.keys(registry).filter(k => k.startsWith('__h'));
          console.log(`  Handlers: ${handlerKeys.join(', ') || 'none'}`);

          console.log('\nVERBOSE FILES (retained)');
          console.log('-'.repeat(40));
          console.log(`  Bundled JS:    ${bundleFile}`);
        } catch (error) {
          console.log(`\nBundler error: ${error instanceof Error ? error.message : String(error)}`);
        }

        console.log('\n' + '='.repeat(80));
      }

      Deno.exit(0);
    }

    // Normal app execution
    const { loadFromFile, DEFAULT_PERSISTENCE_MAPPINGS, isPersistenceEnabled, getStateFilePath } = await import('./state-persistence.ts');
    const { setPersistenceContext } = await import('./element.ts');
    const { getAppCacheDir, ensureDir } = await import('./xdg.ts');
    const { getUrlHash } = await import('./policy/mod.ts');
    const appId = await hashFilePath(filepath);
    const persistEnabled = isPersistenceEnabled();
    const loadedState = await loadFromFile(appId, options.noLoad);

    setPersistenceContext({
      state: loadedState,
      document: null,
      mappings: DEFAULT_PERSISTENCE_MAPPINGS,
    });

    const parseResult = parseMelkerFile(templateContent);

    const placeholderUI = createEl('container', { style: { width: 1, height: 1 } });
    // Calculate baseUrl from filepath for relative resource resolution

    const baseUrl = getBaseUrl(Env.get("MELKER_REMOTE_URL") || filepath);

    const engine = await createMelkerApp(placeholderUI, { baseUrl });

    if (persistEnabled) {
      await engine.enablePersistence(appId);
    }

    // Load policy for View Source feature and config
    let appPolicy: MelkerPolicy;
    if (preloadedContent) {
      // Use policy from generated content (e.g., for .mmd files)
      const policyResult = await loadPolicyFromContent(preloadedContent, filepath);
      appPolicy = policyResult.policy ?? createAutoPolicy(filepath);
    } else if (!isUrl(filepath)) {
      const absolutePath = filepath.startsWith('/') ? filepath : resolve(Deno.cwd(), filepath);
      const policyResult = await loadPolicy(absolutePath);
      appPolicy = policyResult.policy ?? createAutoPolicy(absolutePath);
    } else {
      appPolicy = createAutoPolicy(filepath);
    }

    // Apply CLI permission overrides passed from launcher
    const overridesJson = Env.get('MELKER_PERMISSION_OVERRIDES');
    if (overridesJson) {
      try {
        const overrides = JSON.parse(overridesJson) as PermissionOverrides;
        const { permissions } = applyPermissionOverrides(appPolicy.permissions, overrides);
        appPolicy = { ...appPolicy, permissions };
      } catch {
        // Ignore invalid JSON - shouldn't happen as launcher serializes it
      }
    }

    // Set terminal title (use policy name as fallback if no <title> tag)
    // Skip in stdout mode - no terminal control
    let originalTitle: string | undefined;
    const appTitle = parseResult.title || appPolicy.name;
    if (appTitle && !isStdoutEnabled()) {
      originalTitle = '';
      const encoder = new TextEncoder();
      await Deno.stdout.write(encoder.encode(`\x1b]0;${appTitle}\x07`));
    }

    // Apply policy config (only overrides defaults, not env/cli)
    if (appPolicy.config || appPolicy.configSchema) {
      MelkerConfig.applyPolicyConfig(appPolicy.config ?? {}, appPolicy.configSchema);
    }

    // Compute app-specific cache directory (uses same hash as approval file)
    // For remote apps, use the original URL from env (launcher passes temp file path)
    // Must use resolve() to match the exact path computation in the launcher
    const remoteUrlForHash = Env.get('MELKER_REMOTE_URL');
    const absolutePathForHash = remoteUrlForHash
      ? remoteUrlForHash
      : isUrl(filepath)
        ? filepath
        : resolve(Deno.cwd(), filepath);
    const urlHash = await getUrlHash(absolutePathForHash);
    const appCacheDir = getAppCacheDir(urlHash);
    const logger = (() => { try { return getLogger(filename); } catch { return null; } })();
    // Ensure cache dir exists (in case manually deleted between runs)
    // Fail-safe: don't crash startup if cache dir can't be created
    try {
      await ensureDir(appCacheDir);
    } catch (error) {
      logger?.warn(`Failed to create cache dir: ${error}`);
    }

    if (parseResult.stylesheet) {
      const size = terminalSize();
      parseResult.stylesheet.applyTo(parseResult.element, {
        terminalWidth: size.width,
        terminalHeight: size.height,
      });
    }

    // baseUrl already calculated above when creating engine
    const sourceUrl = isUrl(filepath)
      ? filepath
      : `file://${filepath.startsWith('/') ? filepath : Deno.cwd() + '/' + filepath}`;
    const sourceDirname = (() => {
      try {
        const u = new URL(sourceUrl);
        return u.pathname.substring(0, u.pathname.lastIndexOf('/'));
      } catch {
        const lastSlash = sourceUrl.lastIndexOf('/');
        return lastSlash >= 0 ? sourceUrl.substring(0, lastSlash) : '.';
      }
    })();

    const oauthConfig = parseResult.oauthConfig ? {
      wellknown: parseResult.oauthConfig.wellknown,
      clientId: parseResult.oauthConfig.clientId,
      redirectUri: parseResult.oauthConfig.redirectUri,
      scopes: parseResult.oauthConfig.scopes,
      audience: parseResult.oauthConfig.audience,
      autoLogin: parseResult.oauthConfig.autoLogin,
      debugServer: parseResult.oauthConfig.debugServer,
    } : undefined;

    let exitHandler: () => Promise<void> = () => engine.stop().then(() => { Deno.exit(0); });

    // Flag to skip auto-render after event handler
    let _skipNextRender = false;

    const context : MelkerContext = {
      url: sourceUrl,
      dirname: sourceDirname,
      exports: {} as Record<string, any>,
      getElementById: (id: string) => engine?.document?.getElementById(id) ?? null,
      querySelector: (selector: string) => engine?.document?.querySelector(selector) ?? null,
      querySelectorAll: (selector: string) => engine?.document?.querySelectorAll(selector) ?? [],
      render: () => engine.render(),
      skipRender: () => { _skipNextRender = true; },
      _shouldSkipRender: () => {
        const skip = _skipNextRender;
        _skipNextRender = false;  // Reset after checking
        return skip;
      },
      focus: (id: string) => engine.focusElement(id),
      exit: () => exitHandler(),
      quit: () => exitHandler(),
      setTitle: (title: string) => engine.setTitle(title),
      alert: (message: string) => engine.showAlert(String(message)),
      confirm: (message: string) => engine.showConfirm(String(message)),
      prompt: (message: string, defaultValue?: string) => engine.showPrompt(String(message), defaultValue),
      copyToClipboard: async (text: string) => {
        const commands = [
          { cmd: 'pbcopy', args: [] },
          { cmd: 'xclip', args: ['-selection', 'clipboard'] },
          { cmd: 'xsel', args: ['--clipboard', '--input'] },
          { cmd: 'wl-copy', args: [] },
          { cmd: 'clip.exe', args: [] },
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
            // Command not found - try next
          }
        }
        return false;
      },
      openBrowser: async (url: string) => {
        // Check if browser permission is enabled
        if (!appPolicy.permissions?.browser) {
          logger?.error('openBrowser() requires "browser": true in policy permissions');
          return false;
        }
        try {
          logger?.info('openBrowser ' + url);
          await openBrowser(url);
          return true;
        } catch (error) {
          logger?.error(`Failed to open browser: ${error}`);
          return false;
        }
      },
      engine: engine,
      logger: logger,
      logging: logger,
      persistenceEnabled: persistEnabled,
      stateFilePath: persistEnabled ? getStateFilePath(appId) : null,
      oauth: oauth,
      oauthConfig: oauthConfig,
      createElement: (type: string, props: Record<string, any> = {}, ...children: any[]) => {
        const element = createEl(type, props, ...children);
        // Apply stylesheets to dynamically created elements with current terminal size
        const doc = engine?.document;
        if (doc && doc.stylesheets.length > 0) {
          const size = engine.terminalSize;
          doc.applyStylesToElement(element, {
            terminalWidth: size.width,
            terminalHeight: size.height,
          });
        }
        return element;
      },
      melkerImport: async (specifier: string) => {
        const resolvedUrl = new URL(specifier, baseUrl).href;
        return await import(resolvedUrl);
      },
      registerAITool: registerAITool,
      getLogger: getLogger,
      config: MelkerConfig.get(),
      cacheDir: appCacheDir,
      // Toast notifications
      toast: {
        show: (message: string, options?: ToastOptions) => {
          const toastManager = getToastManager();
          toastManager.setRequestRender(() => engine.render());
          return toastManager.show(message, options);
        },
        dismiss: (id: string) => {
          getToastManager().dismiss(id);
        },
        dismissAll: () => {
          getToastManager().dismissAll();
        },
        setPosition: (position: 'top' | 'bottom') => {
          getToastManager().setConfig({ position });
          engine.render();
        },
      },

      // Dev Tools
      devtools: {
        show: () => engine.devToolsManager?.show(),
        hide: () => engine.devToolsManager?.hide(),
        toggle: () => engine.devToolsManager?.toggle(),
        isOpen: () => engine.devToolsManager?.isOpen() ?? false,
      },
    };

    const ui = parseResult.element;

    const bundlerParseResult = await parseMelkerForBundler(templateContent, sourceUrl);

    const handlerCodeMap = new Map<string, string>();
    for (const handler of bundlerParseResult.handlers) {
      handlerCodeMap.set(handler.code, handler.id);
    }

    const assembled = await processMelkerBundle(bundlerParseResult, {
      debug: options.debug,
      useCache: options.useCache,
    });

    const { registry: melkerRegistry, bundleFile, tempDirs } = await executeBundle(assembled, context, templateArgs);

    // Build system info for View Source
    const loggerOpts = getGlobalLoggerOptions();
    const currentTheme = getCurrentTheme();
    const handlerKeys = Object.keys(melkerRegistry).filter(k => k.startsWith('__h'));
    const remoteUrl = Env.get('MELKER_REMOTE_URL');
    const isRunnerMode = Env.get('MELKER_RUNNER') === '1';
    const approvalKey = remoteUrl || (isRunnerMode ? filepath : undefined);
    const approvalFile = approvalKey ? await getApprovalFilePath(approvalKey) : undefined;

    const systemInfo: SystemInfo = {
      file: remoteUrl || filepath,
      theme: `${getThemeManager().getCurrentThemeName()} (${currentTheme.colorSupport})`,
      logFile: loggerOpts.logFile,
      logLevel: loggerOpts.level,
      denoVersion: Deno.version.deno,
      platform: `${Deno.build.os} ${Deno.build.arch}`,
      approvalFile,
      scriptsCount: assembled.metadata?.scriptsCount ?? 0,
      handlersCount: assembled.metadata?.handlersCount ?? 0,
      generatedLines: assembled.metadata?.generatedLines ?? 0,
      generatedPreview: assembled.metadata?.generatedPreview ?? '',
      generatedFile: assembled.metadata?.generatedFile ?? '',
      templateLines: assembled.template.split('\n').length,
      bundledCodeSize: assembled.bundledCode.length,
      hasSourceMap: assembled.bundleSourceMap !== null,
      bundleFile: bundleFile,
      hasInit: !!melkerRegistry.__init,
      hasReady: !!melkerRegistry.__ready,
      registeredHandlers: handlerKeys,
    };

    // Load help content
    let helpContent: string | undefined = parseResult.helpContent;
    if (!helpContent && parseResult.helpSrc) {
      try {
        const helpUrl = new URL(parseResult.helpSrc, sourceUrl);
        if (helpUrl.protocol === 'file:') {
          helpContent = await Deno.readTextFile(helpUrl.pathname);
        } else {
          const response = await fetch(helpUrl.href);
          if (response.ok) {
            helpContent = await response.text();
          }
        }
      } catch {
        // Ignore help loading errors
      }
    }

    if (viewSource) {
      engine.setSource(viewSource.content, viewSource.path, viewSource.type, viewSource.convertedContent, appPolicy, sourceDirname, remoteUrl, systemInfo, helpContent);
    } else {
      engine.setSource(originalContent, filepath, 'melker', undefined, appPolicy, sourceDirname, remoteUrl, systemInfo, helpContent);
    }

    // Initialize OAuth if configured
    if (oauthConfig?.wellknown) {
      const createOAuthCallback = (handlerId: string, action: string) => {
        const handler = melkerRegistry[handlerId as keyof typeof melkerRegistry] as
          | ((event: { type: 'oauth'; action: string; error?: Error }) => void | Promise<void>)
          | undefined;
        if (!handler) return undefined;
        return () => {
          try {
            const event = { type: 'oauth' as const, action };
            const result = handler(event);
            if (result instanceof Promise) {
              result.catch(() => {});
            }
          } catch {
            // Ignore OAuth callback errors
          }
        };
      };

      const createOAuthErrorCallback = (handlerId: string, action: string) => {
        const handler = melkerRegistry[handlerId as keyof typeof melkerRegistry] as
          | ((event: { type: 'oauth'; action: string; error?: Error }) => void | Promise<void>)
          | undefined;
        if (!handler) return undefined;
        return (error: Error) => {
          try {
            const event = { type: 'oauth' as const, action, error };
            const result = handler(event);
            if (result instanceof Promise) {
              result.catch(() => {});
            }
          } catch {
            // Ignore OAuth error callback errors
          }
        };
      };

      const initOptions = {
        ...oauthConfig,
        onLogin: createOAuthCallback('__oauth_login', 'login'),
        onLogout: createOAuthCallback('__oauth_logout', 'logout'),
        onFail: createOAuthErrorCallback('__oauth_fail', 'fail'),
      };

      oauth.init(initOptions).catch(() => {});
    }

    // Wire up handlers
    const errorTranslator = new ErrorTranslator(
      assembled.bundleSourceMap,
      assembled.lineMap,
      assembled.originalContent,
      assembled.sourceUrl
    );
    await wireBundlerHandlers(ui, melkerRegistry, context, logger, handlerCodeMap, errorTranslator);

    engine.updateUI(ui);
    // Register stylesheet on document so resize handler can re-apply media rules
    if (parseResult.stylesheet) {
      engine.document.addStylesheet(parseResult.stylesheet);
    }
    (engine as any).forceRender();
    (engine as any)._triggerMountHandlers();
    await callReady(melkerRegistry);

    // Handle stdout mode - output buffer after timeout and exit
    // Auto-enabled when stdout is not a TTY (piped or redirected)
    if (isStdoutEnabled()) {
      const stdoutConfig = getStdoutConfig();
      const stdoutLogger = getLogger('stdout');

      // Log whether auto-enabled or explicitly requested
      if (isStdoutAutoEnabled()) {
        stdoutLogger.info(`Stdout mode auto-enabled (not a TTY), waiting ${stdoutConfig.timeout}ms`);
      } else {
        stdoutLogger.info(`Stdout mode: waiting ${stdoutConfig.timeout}ms`);
      }

      // Wait for the configured timeout
      await new Promise(resolve => setTimeout(resolve, stdoutConfig.timeout));

      // Get the buffer from the engine and output it
      const buffer = (engine as any)._buffer;
      if (buffer) {
        let output = bufferToStdout(buffer, {
          colorSupport: stdoutConfig.colorSupport,
          stripAnsi: stdoutConfig.stripAnsi,
        });
        // Apply trimming if configured
        output = trimStdoutOutput(output, stdoutConfig.trim);
        const encoder = new TextEncoder();
        await Deno.stdout.write(encoder.encode(output + '\n'));
      }

      // Exit cleanly
      Deno.exit(0);
    }

    // Set up graceful shutdown
    // deno-lint-ignore no-explicit-any
    let _sigintHandler: any = null;
    // deno-lint-ignore no-explicit-any
    let _sigTermHandler: any = null;
    let cleanupInProgress = false;
    const cleanup = async (exitAfter: boolean = true) => {
      if (cleanupInProgress) return;
      cleanupInProgress = true;

      const encoder = new TextEncoder();

      if (engine) {
        (engine as any)._isInitialized = false;
      }

      const retainBundle = Env.get('MELKER_RETAIN_BUNDLE') === 'true' || Env.get('MELKER_RETAIN_BUNDLE') === '1';
      if (!retainBundle && tempDirs && tempDirs.length > 0) {
        for (const dir of tempDirs) {
          try {
            Deno.removeSync(dir, { recursive: true });
          } catch {
            // Ignore cleanup errors
          }
        }
      }

      if (exitAfter) {
        restoreTerminal();
      }

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
          // Ignore video cleanup errors
        }
      }

      if (originalTitle !== undefined) {
        try {
          await Deno.stdout.write(encoder.encode('\x1b]0;\x07'));
        } catch {
          // Ignore
        }
      }

      if (engine) {
        try {
          await engine.stop();
        } catch {
          // Ignore
        }
      }

      try {
        if (_sigintHandler) Deno.removeSignalListener('SIGINT', _sigintHandler);
        if (_sigTermHandler) Deno.removeSignalListener('SIGTERM', _sigTermHandler);
      } catch {
        // Ignore
      }

      if (exitAfter) {
        Deno.exit(0);
      }
    };

    exitHandler = () => cleanup(true);
    engine.setOnExit(() => cleanup(true));

    // Remove the engine's own SIGINT handler — the runner handles SIGINT itself
    // with the same beforeExit logic, plus runner-specific cleanup (temp dirs, video, etc.)
    engine.removeSigintHandler();

    // SIGINT: first press calls engine's beforeExit handlers (e.g. confirm dialog).
    // If any handler returns false, exit is cancelled.
    // Second press within 3s force-exits, bypassing hooks.
    let pendingExit = false;
    let pendingExitTimer: ReturnType<typeof setTimeout> | null = null;

    const sigintHandler = async () => {
      if (pendingExit || !engine) {
        // Second press or no engine — force exit
        if (pendingExitTimer) clearTimeout(pendingExitTimer);
        await cleanup(true);
        return;
      }

      // Check if engine has any beforeExit handlers
      const handlers = (engine as any)._beforeExitHandlers;
      if (!handlers || handlers.length === 0) {
        await cleanup(true);
        return;
      }

      pendingExit = true;
      pendingExitTimer = setTimeout(() => { pendingExit = false; }, 3000);

      try {
        const shouldExit = await (engine as any)._callBeforeExitHandlers();
        if (shouldExit) {
          if (pendingExitTimer) clearTimeout(pendingExitTimer);
          await cleanup(true);
        } else {
          // Hook cancelled exit — reset so next signal goes through the hook again
          if (pendingExitTimer) clearTimeout(pendingExitTimer);
          pendingExitTimer = null;
          pendingExit = false;
        }
      } catch {
        if (pendingExitTimer) clearTimeout(pendingExitTimer);
        await cleanup(true);
      }
    };

    _sigintHandler = sigintHandler;
    _sigTermHandler = () => cleanup(true);
    Deno.addSignalListener('SIGINT', _sigintHandler);
    Deno.addSignalListener('SIGTERM', _sigTermHandler);

    return { engine, cleanup: () => cleanup(false) };

  } catch (error) {
    restoreTerminal();
    try {
      const encoder = new TextEncoder();
      await Deno.stdout.write(encoder.encode('\x1b]0;\x07\n'));
    } catch {
      // Ignore
    }

    console.error(`Error running Melker file: ${error instanceof Error ? error.message : String(error)}`);

    if (error instanceof Error && error.stack) {
      const stackFrames = error.stack
        .split('\n')
        .filter(line => line.trim().startsWith('at '))
        .join('\n');
      if (stackFrames) {
        console.error('\nStack trace:');
        console.error(stackFrames);
      }
    }

    Deno.exit(1);
  }
}

/**
 * Watch a file for changes and automatically reload
 */
export async function watchAndRun(
  filepath: string,
  options: { printTree?: boolean; printJson?: boolean; debug?: boolean; noLoad?: boolean; useCache?: boolean; watch?: boolean },
  templateArgs: string[],
  viewSource?: { content: string; path: string; type: 'md' | 'melker' | 'mmd'; convertedContent?: string },
  preloadedContent?: string
): Promise<void> {
  const { getLogger } = await import('./logging.ts');
  const logger = getLogger('FileWatcher');

  const watchPath = filepath;
  let currentResult: RunMelkerResult | void = undefined;

  const startApp = async (isReload: boolean = false) => {
    if (currentResult) {
      logger.info(`Stopping previous instance for reload: ${filepath}`);
      try {
        await currentResult.cleanup();
      } catch {
        // Ignore cleanup errors
      }
      currentResult = undefined;
    }

    if (isReload) {
      logger.info(`Reloading application: ${filepath}`);
      const { clearCustomTools } = await import('./ai/mod.ts');
      clearCustomTools();
    } else {
      logger.info(`Starting application with file watch: ${filepath}`);
    }

    try {
      if (filepath.endsWith('.md')) {
        const { getRegisteredComponents } = await import('./lint.ts');
        const { markdownToMelker } = await import('./ascii/mod.ts');

        const mdContent = await loadContent(filepath);
        const elementTypes = new Set(getRegisteredComponents());
        const melkerContent = markdownToMelker(mdContent, filepath, { elementTypes });

        currentResult = await runMelkerFile(
          filepath,
          { ...options, watch: false },
          templateArgs,
          { content: mdContent, path: filepath, type: 'md', convertedContent: melkerContent },
          melkerContent
        );
      } else {
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
    }
  };

  await startApp(false);

  logger.info(`Watching for file changes: ${watchPath}`);

  const debouncedReload = debounce(async () => {
    logger.info(`File change detected: ${watchPath}`);
    await startApp(true);
  }, 150);

  try {
    const watcher = Deno.watchFs(watchPath);

    for await (const event of watcher) {
      if (event.kind === 'modify') {
        debouncedReload();
      }
    }
  } catch (error) {
    logger.error('File watcher error: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Generate schema markdown
 */
async function generateSchemaMarkdown(): Promise<string> {
  await import('../mod.ts');

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

  const formatType = (type: string | string[]): string => {
    return Array.isArray(type) ? type.join(' | ') : type;
  };

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

  lines.push('## Base Properties');
  lines.push('');
  lines.push('These properties are available on all components.');
  lines.push('');
  generatePropTable(BASE_PROPS_SCHEMA, 'Props');

  lines.push('## Base Styles');
  lines.push('');
  lines.push('These styles can be used in the `style` attribute of any component.');
  lines.push('');
  generatePropTable(BASE_STYLES_SCHEMA, 'Styles');

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
        const p = prop as { type?: string | string[]; required?: boolean; description?: string; enum?: string[] };
        const type = formatType(p.type ?? 'unknown');
        const required = p.required ? 'Yes' : '';
        const desc = p.description || '';
        const enumVals = p.enum ? ` (${p.enum.join(', ')})` : '';
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

function printUsage(): void {
  console.log('Melker Runner - Execute .melker files (internal use)');
  console.log('');
  console.log('This is typically invoked by melker-launcher.ts with restricted permissions.');
  console.log('');
  console.log('Usage:');
  console.log('  deno run [flags] melker-runner.ts <file> [options]');
  console.log('');
  console.log('Supported file types:');
  console.log('  .melker        Melker UI template');
  console.log('  .md            Markdown document');
  console.log('  .mmd           Mermaid diagram (rendered as graph)');
  console.log('');
  console.log('Options:');
  console.log('  --print-tree   Display the element tree structure and exit');
  console.log('  --print-json   Display the JSON serialization and exit');
  console.log('  --verbose      Show system info, verbose script transpilation');
  console.log('  --lint         Enable lint mode');
  console.log('  --schema       Output component schema documentation');
  console.log('  --convert      Convert markdown to .melker format');
  console.log('  --no-load      Skip loading persisted state');
  console.log('  --cache        Use bundle cache');
  console.log('  --watch        Watch file for changes');
  console.log('  --help, -h     Show this help message');
}

/**
 * Main entry point for runner
 */
async function main(): Promise<void> {
  const args = Deno.args;

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    Deno.exit(0);
  }

  // Handle --schema
  if (args.includes('--schema')) {
    const markdown = await generateSchemaMarkdown();
    console.log(markdown);
    Deno.exit(0);
  }

  // Parse schema-driven CLI flags (--theme, --log-level, --lint, etc.)
  // remaining contains non-flag args and unknown flags (--print-tree, etc.)
  const { flags: cliFlags, remaining: remainingArgs } = parseCliFlags(args);

  // Apply CLI flags to config (may already be auto-initialized via mod.ts import)
  MelkerConfig.applyCliFlags(cliFlags);
  reconfigureGlobalLogger();

  // Get config values
  const config = MelkerConfig.get();

  // Parse options from remaining args (non-schema flags)
  const options = {
    printTree: remainingArgs.includes('--print-tree'),
    printJson: remainingArgs.includes('--print-json'),
    debug: remainingArgs.includes('--verbose'),
    lint: config.lint,  // Use config (supports --lint flag and MELKER_LINT env)
    noLoad: remainingArgs.includes('--no-load'),
    useCache: remainingArgs.includes('--cache'),
    watch: remainingArgs.includes('--watch'),
  };

  // Warn about unrecognized flags
  const knownRunnerFlags = new Set([
    '--print-tree', '--print-json', '--verbose', '--no-load',
    '--cache', '--watch', '--convert',
    '--help', '-h', '--schema',
    // Launcher-only flags that may still appear in forwarded args
    '--show-policy', '--trust',
  ]);
  const unknownFlags = remainingArgs.filter(arg => arg.startsWith('--') && !knownRunnerFlags.has(arg));
  if (unknownFlags.length > 0) {
    const logger = getLogger('cli');
    for (const flag of unknownFlags) {
      logger.warn(`Unrecognized option: ${flag}`);
    }
  }

  // Enable lint mode if requested (already set via config, but explicit call registers it)
  if (options.lint) {
    const { enableLint } = await import('./lint.ts');
    enableLint(true);
  }

  // Find file argument from remaining args (after schema flags consumed)
  const filepathIndex = remainingArgs.findIndex(arg => !arg.startsWith('--'));
  const filepath = filepathIndex >= 0 ? remainingArgs[filepathIndex] : undefined;

  if (!filepath) {
    console.error('Error: No .melker, .md, or .mmd file specified');
    Deno.exit(1);
  }

  // Log the file path/URL at startup
  {
    const { getLogger } = await import('./logging.ts');
    const logger = getLogger('Runner');
    const remoteUrl = Env.get('MELKER_REMOTE_URL');
    const displayPath = remoteUrl || (filepath.startsWith('/') ? filepath : resolve(Deno.cwd(), filepath));
    logger.info(`Starting | file="${displayPath}"`);
  }

  // Handle --convert
  if (remainingArgs.includes('--convert')) {
    if (!filepath.endsWith('.md')) {
      console.error('Error: --convert requires a .md file');
      Deno.exit(1);
    }

    try {
      await import('./components/mod.ts');
      const { getRegisteredComponents } = await import('./lint.ts');
      const { markdownToMelker } = await import('./ascii/mod.ts');

      const mdContent = await Deno.readTextFile(filepath);
      const elementTypes = new Set(getRegisteredComponents());
      const melkerContent = markdownToMelker(mdContent, filepath, { elementTypes });

      console.log(melkerContent);
      Deno.exit(0);
    } catch (error) {
      console.error(`Error converting markdown: ${error instanceof Error ? error.message : String(error)}`);
      Deno.exit(1);
    }
  }

  // Handle .md files
  if (filepath.endsWith('.md')) {
    try {
      await import('./components/mod.ts');
      const { getRegisteredComponents } = await import('./lint.ts');
      const { markdownToMelker } = await import('./ascii/mod.ts');

      const mdContent = await loadContent(filepath);
      const elementTypes = new Set(getRegisteredComponents());
      const melkerContent = markdownToMelker(mdContent, filepath, { elementTypes });

      const absoluteFilepath = filepath.startsWith('/') ? filepath : `${Deno.cwd()}/${filepath}`;
      const mdTemplateArgs = [absoluteFilepath, ...remainingArgs.slice(filepathIndex + 1).filter(arg => !arg.startsWith('--'))];

      if (options.watch) {
        await watchAndRun(absoluteFilepath, options, mdTemplateArgs, {
          content: mdContent,
          path: absoluteFilepath,
          type: 'md',
          convertedContent: melkerContent,
        }, melkerContent);
      } else {
        await runMelkerFile(absoluteFilepath, options, mdTemplateArgs, {
          content: mdContent,
          path: absoluteFilepath,
          type: 'md',
          convertedContent: melkerContent,
        }, melkerContent);
      }

      return;
    } catch (error) {
      console.error(`Error running markdown: ${error instanceof Error ? error.message : String(error)}`);
      Deno.exit(1);
    }
  }

  // Handle .mmd (mermaid) files - wrap in <graph> component
  if (filepath.endsWith('.mmd')) {
    try {
      const mmdContent = await loadContent(filepath);
      // Wrap mermaid content in a melker template with graph component
      const melkerContent = `<melker>
<policy>{"name": "${filepath}"}</policy>
<graph type="mermaid">
${mmdContent}
</graph>
</melker>`;

      const absoluteFilepath = filepath.startsWith('/') ? filepath : `${Deno.cwd()}/${filepath}`;
      const mmdTemplateArgs = [absoluteFilepath, ...remainingArgs.slice(filepathIndex + 1).filter(arg => !arg.startsWith('--'))];

      if (options.watch) {
        await watchAndRun(absoluteFilepath, options, mmdTemplateArgs, {
          content: mmdContent,
          path: absoluteFilepath,
          type: 'mmd',
          convertedContent: melkerContent,
        }, melkerContent);
      } else {
        await runMelkerFile(absoluteFilepath, options, mmdTemplateArgs, {
          content: mmdContent,
          path: absoluteFilepath,
          type: 'mmd',
          convertedContent: melkerContent,
        }, melkerContent);
      }

      return;
    } catch (error) {
      console.error(`Error running mermaid file: ${error instanceof Error ? error.message : String(error)}`);
      Deno.exit(1);
    }
  }

  // Validate extension
  if (!filepath.endsWith('.melker')) {
    console.error('Error: File must have .melker, .md, or .mmd extension');
    Deno.exit(1);
  }

  const absoluteFilepath = filepath.startsWith('/') ? filepath : `${Deno.cwd()}/${filepath}`;
  const templateArgs = [absoluteFilepath, ...remainingArgs.slice(filepathIndex + 1).filter(arg => !arg.startsWith('--'))];

  try {
    if (!isUrl(filepath)) {
      await Deno.stat(filepath);
    }

    if (options.watch) {
      await watchAndRun(absoluteFilepath, options, templateArgs);
    } else {
      await runMelkerFile(filepath, options, templateArgs);
    }
  } catch (error) {
    restoreTerminal();
    if (error instanceof Deno.errors.NotFound) {
      console.error(`Error: File not found: ${filepath}`);
    } else {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    Deno.exit(1);
  }
}

// Run if this is the entry point
if (import.meta.main) {
  main().catch((error) => {
    restoreTerminal();
    console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  });
}
