import { config as dotenvConfig } from 'npm:dotenv@^16.3.0';

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

// CLI functionality for running .melker template files
export async function runMelkerFile(filepath: string, options: { printTree?: boolean, printJson?: boolean, debug?: boolean } = {}, templateArgs: string[] = []): Promise<void> {
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

    // Read the .melker file content (from file or URL)
    let templateContent = await loadContent(filepath);

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

        try {
          const scriptResult = await executeScripts(parseResult.scripts, basePath, true, debugContext);
          if (scriptResult.failures.length > 0) {
            debugFailures.push(...scriptResult.failures);
          }
        } catch (error) {
          debugFailures.push(`Script execution: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Debug: Process string handlers to show transpilation
        console.log('\nEVENT HANDLER PROCESSING');
        console.log('-'.repeat(40));
        try {
          await processStringHandlers(ui, debugContext, debugLogger, filepath, true);
        } catch (error) {
          debugFailures.push(`Event handler processing: ${error instanceof Error ? error.message : String(error)}`);
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
      engine: engine,
      logger: logger,
      logging: logger,  // Alias for logger
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
      }
    };

    // Step 4: Execute scripts with context so they can access engine
    const scriptResult = await executeScripts(parseResult.scripts, basePath, options.debug, context);

    // Check for script execution errors
    if (scriptResult.failures.length > 0) {
      // Restore terminal before showing errors
      await engine.stop();
      console.error('\nScript execution failed:');
      for (const failure of scriptResult.failures) {
        console.error('  ' + failure);
      }
      Deno.exit(1);
    }

    // Add script functions to context
    Object.assign(context, scriptResult.context);

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

    // Step 4: Get the UI element from parsing result
    const ui = parseResult.element;

    // Step 3.5: Process string event handlers and convert them to functions
    await processStringHandlers(ui, context, logger, filepath, options.debug);

    // Step 4: Set the parsed UI to the engine using the proper updateUI method
    engine.updateUI(ui);

    // Force a complete re-render with the new UI
    // Use forceRender() instead of render() to ensure full redraw
    (engine as any).forceRender();

    // Trigger mount handlers after UI is loaded and rendered
    (engine as any)._triggerMountHandlers();

    // Set up graceful shutdown with protection against double Ctrl+C
    let cleanupInProgress = false;
    const cleanup = async () => {
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

      // 2. Write "Stopping..." directly to screen (fully restore terminal first)
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

      Deno.exit(0);
    };

    // Handle Ctrl+C gracefully
    Deno.addSignalListener('SIGINT', cleanup);
    Deno.addSignalListener('SIGTERM', cleanup);

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

export function printUsage(): void {
  console.log('📱 Melker CLI - Run Melker template files');
  console.log('');
  console.log('Usage:');
  console.log('  deno run --allow-read --allow-env melker.ts <file.melker> [options]');
  console.log('');
  console.log('Arguments:');
  console.log('  <file.melker>  Path to a .melker template file');
  console.log('');
  console.log('Options:');
  console.log('  --print-tree   Display the element tree structure and exit');
  console.log('  --print-json   Display the JSON serialization and exit');
  console.log('  --debug        Show system info, debug script transpilation');
  console.log('  --lint         Enable lint mode to check for unsupported props/styles');
  console.log('  --schema       Output component schema documentation as markdown and exit');
  console.log('  --lsp          Start Language Server Protocol server for editor integration');
  console.log('  --help, -h     Show this help message');
  console.log('');
  console.log('Example .melker file content:');
  console.log('  <container style={{');
  console.log('    width: 40,');
  console.log('    height: 10,');
  console.log('    border: "thin",');
  console.log('    borderColor: getThemeColor("primary")');
  console.log('  }}>');
  console.log('    <text style={{ color: getThemeColor("success") }}>');
  console.log('      Hello from Melker!');
  console.log('    </text>');
  console.log('  </container>');
  console.log('');
  console.log('Style attributes support both formats:');
  console.log('  CSS-style:   style="width: 40; border: thin; color: blue;"');
  console.log('  Object-style: style={{ width: 40, border: "thin", color: "blue" }}');
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
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
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
    lint: args.includes('--lint')
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

  if (!filepath.endsWith('.melker')) {
    console.error('❌ Error: File must have .melker extension');
    console.error('Use --help for usage information');
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
    await runMelkerFile(filepath, options, templateArgs);
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

/**
 * Execute scripts and return the context they provide
 */
interface ExecuteScriptsResult {
  context: Record<string, any>;
  failures: string[];
}

async function executeScripts(scripts: Array<{ type: string; content: string; src?: string }>, basePath?: string, debug?: boolean, context?: any): Promise<ExecuteScriptsResult> {
  const scriptContext: Record<string, any> = {};
  const failures: string[] = [];

  for (const script of scripts) {
    let scriptContent = '';
    try {
      if (script.src?.endsWith(".js") || script.src?.endsWith(".ts") || script.type === 'typescript' || script.type === 'javascript' || script.type === 'text/javascript' || script.type === 'text/typescript' || script.type === 'module') {
        scriptContent = script.content;

        // If src attribute is provided, load the external file/URL
        if (script.src) {
          try {
            // Resolve path relative to the .melker file's directory
            const scriptUrl = basePath ? new URL(script.src, basePath).href : script.src;

            // Load from file or URL
            scriptContent = await loadContent(
              scriptUrl.startsWith('file://') ? scriptUrl.replace('file://', '') : scriptUrl
            );
          } catch (error) {
            console.error(`Error loading script file ${script.src}: ${error}`);
            continue;
          }
        }

        // Skip if no content (neither inline nor from file)
        if (!scriptContent.trim()) {
          continue;
        }

        if (debug) {
          console.log(`\n${script.src ? `External script: "${script.src}"` : 'Inline script'} (${script.type})`);
          console.log(`   Length: ${scriptContent.length} characters`);
          if (scriptContent.length > 0) {
            const preview = scriptContent.substring(0, 120).replace(/\n/g, '\\n').trim();
            console.log(`   Preview: ${preview}${scriptContent.length > 120 ? '...' : ''}`);
          }
        }

        // Transpile TypeScript to JavaScript if needed
        if (script.type === 'typescript' || script.type === 'text/typescript' || script.src?.endsWith(".ts")) {
          try {
            // Import bundle and transpile functions dynamically
            const { bundle, transpile } = await import('jsr:@deno/emit@^0.44.0');

            // Create a proper TypeScript file structure for transpilation
            const url = script.src ?
              new URL(script.src, basePath || 'file://./').href :
              'file:///inline.ts';

            if (debug) {
              console.log(`   Transpile URL: ${url}`);
            }

            // Check if script has imports - if so, use bundle instead of transpile
            const hasImports = scriptContent.includes('import ') && (scriptContent.includes(' from ') || scriptContent.includes('import('));

            // Custom loader for both bundle and transpile
            const customLoad = async (specifier: string) => {
              if (specifier === url) {
                return {
                  kind: 'module' as const,
                  specifier: url,
                  content: scriptContent
                };
              }
              // Handle file:// imports
              if (specifier.startsWith('file://')) {
                try {
                  const filePath = specifier.replace('file://', '');
                  const content = await Deno.readTextFile(filePath);
                  return {
                    kind: 'module' as const,
                    specifier,
                    content
                  };
                } catch (e: any) {
                  throw new Error(`Failed to load ${specifier}: ${e.message}`);
                }
              }
              // Handle http:// and https:// imports (fetch from URL)
              if (specifier.startsWith('https://') || specifier.startsWith('http://')) {
                try {
                  const content = await loadContent(specifier);
                  return {
                    kind: 'module' as const,
                    specifier,
                    content
                  };
                } catch (e: any) {
                  throw new Error(`Failed to fetch ${specifier}: ${e.message}`);
                }
              }
              throw new Error(`Unknown specifier: ${specifier}`);
            };

            if (hasImports) {
              // Use bundle to inline all imports
              if (debug) {
                console.log(`   Using bundle (script has imports)`);
              }
              const result = await bundle(url, {
                load: customLoad,
                compilerOptions: {
                  inlineSourceMap: false,
                  inlineSources: false
                }
              });
              scriptContent = result.code;
            } else {
              // Use transpile for simple scripts without imports
              const result = await transpile(url, { load: customLoad });
              scriptContent = result.get(url.toString()) || '';
            }

            if (debug) {
              if(scriptContent) {
                console.log(`   TypeScript transpiled successfully`);
                // Only show preview if it's a substantial script
                if (scriptContent.length > 200) {
                  const preview = scriptContent.substring(0, 100).replace(/\n/g, '\\n').trim();
                  console.log(`   Preview: ${preview}...`);
                }
              } else {
                console.log(`   ERROR: No transpiled content received`);
              }
            }

            // Transform ES module exports to CommonJS-style for Function constructor
            if (scriptContent && scriptContent.includes('export ')) {
              // Find exports BEFORE transforming (need the original export keywords)
              const exportMatches = [...scriptContent.matchAll(/export (?:const|function|let|var) ([a-zA-Z_][a-zA-Z0-9_]*)/g)];

              // Convert ES module exports to CommonJS exports
              scriptContent = scriptContent
                .replace(/export const ([a-zA-Z_][a-zA-Z0-9_]*)/g, 'const $1')
                .replace(/export function ([a-zA-Z_][a-zA-Z0-9_]*)/g, 'function $1')
                .replace(/export let ([a-zA-Z_][a-zA-Z0-9_]*)/g, 'let $1')
                .replace(/export var ([a-zA-Z_][a-zA-Z0-9_]*)/g, 'var $1');

              // Add export collection at the end
              if (exportMatches.length > 0) {
                const exportNames = exportMatches.map(match => match[1]);
                scriptContent += '\n\n// Export collection\nexports = { ' + exportNames.map(name => `${name}`).join(', ') + ' };';
              }

              if (debug) {
                console.log(`   ES Module transformed to CommonJS`);
              }
            }
          } catch (error) {
            const errorMsg = `Error transpiling TypeScript (${script.src || 'inline'}): ${error}`;
            console.error(errorMsg);
            failures.push(errorMsg);
            continue;
          }
        }

        // Create a function that executes the script content and returns any exports
        // Handle both TypeScript transpiled code and regular JavaScript
        const scriptFunction = new Function('context', `
          // Initialize CommonJS-style exports
          let exports = {};
          let module = { exports: exports };

          // Capture the global context before execution to detect new variables
          const beforeVars = new Set(Object.keys(this));

          // Execute the script content
          ${scriptContent}

          // First, try standard export patterns
          if (typeof module !== 'undefined' && module.exports && Object.keys(module.exports).length > 0) {
            return module.exports;
          }
          if (typeof exports !== 'undefined' && Object.keys(exports).length > 0) {
            return exports;
          }

          // For TypeScript transpiled code, extract newly defined variables
          const afterVars = Object.keys(this);
          const exportedFunctions = {};

          for (const varName of afterVars) {
            if (!beforeVars.has(varName) && typeof this[varName] === 'function') {
              exportedFunctions[varName] = this[varName];
            }
          }

          return exportedFunctions;
        `);

        const result = scriptFunction(context);

        if (debug) {
          console.log(`   Script executed successfully`);
          const functionNames = Object.keys(result || {}).filter(key => typeof result[key] === 'function');
          const otherExports = Object.keys(result || {}).filter(key => typeof result[key] !== 'function');

          if (functionNames.length > 0) {
            console.log(`   Exported functions: ${functionNames.join(', ')}`);
          }
          if (otherExports.length > 0) {
            console.log(`   Other exports: ${otherExports.join(', ')}`);
          }
          if (!result || Object.keys(result).length === 0) {
            console.log(`   No exports found (internal functions only)`);
          }
        }

        // Merge any returned values into the context
        if (result && typeof result === 'object') {
          Object.assign(scriptContext, result);
        }
      }
    } catch (error) {
      const errorMsg = `Error executing script (${script.type}): ${error}`;
      if (!debug) {
        // In non-debug mode, still log errors but they'll be collected
        console.error(errorMsg);
      }
      failures.push(errorMsg);
    }
  }

  return { context: scriptContext, failures };
}

/**
 * Transpile TypeScript code to JavaScript for string handlers
 */
async function transpileStringHandler(code: string, elementType: string, handlerName: string, elementId?: string, debug?: boolean): Promise<string> {
  // Generate a meaningful URL for debugging
  const elementIdentifier = elementId ? `#${elementId}` : '';
  const url = `file:///${elementType}${elementIdentifier}.${handlerName}.ts`;

  if (debug) {
    console.log(`   Event Handler: ${elementType}${elementIdentifier}.${handlerName}`);
    console.log(`   Handler length: ${code.length} characters`);
    const preview = code.substring(0, 100).replace(/\n/g, '\\n').trim();
    console.log(`   Code preview: ${preview}${code.length > 100 ? '...' : ''}`);
  }

  try {
    const { transpile } = await import('jsr:@deno/emit@^0.44.0');
    const result = await transpile(url, {
      load(specifier: string) {
        if (specifier === url) {
          return Promise.resolve({
            kind: 'module',
            specifier: url,
            content: code
          });
        }
        return Promise.reject(new Error(`Unknown specifier: ${specifier}`));
      }
    });

    let transpiledCode = result.get(url) || code;

    if (debug) {
      // Only show details if there's a meaningful change (>5% difference or substantial modification)
      const sizeDiff = Math.abs(transpiledCode.length - code.length);
      const isSignificantChange = sizeDiff > Math.max(5, code.length * 0.05) || transpiledCode.trim() !== code.trim();

      if (isSignificantChange) {
        console.log(`   Transpiled (${code.length} -> ${transpiledCode.length} chars)`);
        if (transpiledCode.length > 50) {
          const preview = transpiledCode.substring(0, 80).replace(/\n/g, '\\n').trim();
          console.log(`   Result: ${preview}${transpiledCode.length > 80 ? '...' : ''}`);
        }
      }
    }

    // Transform ES module exports to regular JavaScript for Function constructor
    // Remove any export statements since string handlers shouldn't export anything
    transpiledCode = transpiledCode
      .replace(/export\s+/g, '')
      .replace(/import\s+.*?;/g, '');

    if (debug) {
      // Only show final code if it's different from the original
      if (transpiledCode.trim() !== code.trim()) {
        console.log(`   Final:  ${transpiledCode.trim().replaceAll(/\n/g, '\\n').substring(0, 110)}...`);
      }
    }

    return transpiledCode;
  } catch (error) {
    console.error(`Error transpiling TypeScript in event handler: ${error}`);
    return code;
  }
}

/**
 * Process string event handlers in the UI tree and convert them to functions
 */
async function processStringHandlers(element: any, context: any, logger: any, filepath: string, debug?: boolean): Promise<void> {
  // Process current element's props
  if (element.props) {
    for (const [propName, propValue] of Object.entries(element.props)) {
      if (propName.startsWith('on') &&
          typeof propValue === 'object' &&
          propValue &&
          (propValue as any).__isStringHandler) {

        const handlerCode = (propValue as any).__handlerCode;
        const elementType = element.type || 'unknown';
        const elementId = element.props?.id;

        if (debug) {
          console.log(`\nProcessing ${propName} handler${elementId ? ` on #${elementId}` : ''}`);
        }

        // Always transpile string handlers as TypeScript
        const transpiledCode = await transpileStringHandler(handlerCode, elementType, propName, elementId, debug);

        // If the transpiled code is just a function name, make it call that function with event
        let finalCode = transpiledCode.trim();
        // Check if it's a simple identifier (function name) without parentheses
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(finalCode)) {
          finalCode = `return ${finalCode}(event)`;
        }

        // Create a function that executes the transpiled code with access to context
        element.props[propName] = function(event: any) {
          // Extract script function names and values from context for direct access (outside try block)
          const scriptFunctions = Object.keys(context).filter(key => typeof context[key] === 'function');
          const scriptFunctionValues = scriptFunctions.map(name => context[name]);

          try {
            // Create a function with script functions as direct parameters
            const handlerFunction = new Function(
              'event',
              'context',
              ...scriptFunctions,
              finalCode
            );
            return handlerFunction(event, context, ...scriptFunctionValues);
          } catch (error) {
            const errorMessage = `Error in string event handler (${propName}): ${error}`;

            // Log comprehensive error information with stack trace and context
            logger?.error(
              'Script execution error in .melker template',
              error instanceof Error ? error : new Error(String(error)),
              {
                filepath: filepath,
                elementType: element.type,
                elementId: element.props?.id || 'unknown',
                propertyName: propName,
                handlerCode: handlerCode?.substring(0, 200) + (handlerCode?.length > 200 ? '...' : ''),
                transpiledCode: transpiledCode?.substring(0, 200) + (transpiledCode?.length > 200 ? '...' : ''),
                scriptFunctions: scriptFunctions.join(', '),
                eventType: event?.type || 'unknown',
              },
              'TemplateProcessor'
            );

            // Also log to console for immediate feedback during development
            console.error(errorMessage);
            if (error instanceof Error && error.stack) {
              console.error('Stack trace:', error.stack);
            }
          }
        };

      }
    }
  }

  // Recursively process children
  if (element.children && Array.isArray(element.children)) {
    for (const child of element.children) {
      await processStringHandlers(child, context, logger, filepath, debug);
    }
  }

  // Also process items in props.items (used by menu components)
  if (element.props?.items && Array.isArray(element.props.items)) {
    for (const item of element.props.items) {
      await processStringHandlers(item, context, logger, filepath, debug);
    }
  }
}