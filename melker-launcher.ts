// Minimal Melker Launcher
// Security-auditable entry point that handles policy enforcement and subprocess spawning.
// Runtime deps: ~18 local files / 160 KB (policy, config, CLI, approval).
// Does NOT import framework code (rendering, components, server, engine).
// Note: deps.ts is in the launcher path (via policy/loader.ts, policy/flags.ts) for path
// utilities only, but it also re-exports npm packages (image decoders, markdown parser, etc.).
// This is intentional: loading deps.ts in the launcher (which runs with -A) pre-caches all
// npm dependencies so the restricted subprocess can resolve them from the Deno module cache
// without needing network access to npm registries.

import { dirname, join, resolve } from 'jsr:@std/path@1.1.4';

// Version from deno.json (used by upgrade subcommand)
import denoConfig from './deno.json' with { type: 'json' };

// Policy imports for permission enforcement (used by runWithPolicy)
import {
  policyToDenoFlags,
  getUrlHash,
  type MelkerPolicy,
} from './src/policy/mod.ts';
import {
  getPermissionOverrides,
  applyPermissionOverrides,
  hasOverrides,
} from './src/policy/permission-overrides.ts';

// CLI parsing from schema (for printUsage)
import { generateFlagHelp } from './src/config/cli.ts';
import { MelkerConfigCore as MelkerConfig } from './src/config/config-core.ts';

// Shared CLI logic
import { runCli, type CliRuntime } from './src/cli-shared.ts';

/**
 * Reset terminal state after subprocess failure.
 * Uses raw ANSI codes to avoid importing framework modules.
 */
function resetTerminalState(): void {
  try {
    Deno.stdin.setRaw(false);
  } catch {
    // Ignore - might already be in cooked mode
  }
  try {
    const encoder = new TextEncoder();
    // Reset: normal screen, show cursor, disable mouse, reset attributes
    const reset = '\x1b[?1049l\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[0m';
    Deno.stdout.writeSync(encoder.encode(reset));
  } catch {
    // Ignore write errors
  }
}

/**
 * Deno flags that should be forwarded to the subprocess
 */
const FORWARDED_DENO_FLAGS = [
  '--reload',       // Reload remote modules
  '--no-lock',      // Disable lockfile
  '--no-check',     // Skip type checking (faster startup)
  '--quiet', '-q',  // Suppress diagnostic output
  '--cached-only',  // Require remote deps already cached (offline mode)
  '--inspect',      // Enable V8 inspector
  '--inspect-wait', // Enable V8 inspector, wait for connection
  '--inspect-brk',  // Enable V8 inspector, break at start
];

/**
 * Extract Deno flags from args that should be forwarded to subprocess
 */
function extractForwardedDenoFlags(args: string[]): string[] {
  return args.filter(arg => FORWARDED_DENO_FLAGS.includes(arg));
}

/**
 * Detect if `--reload` was passed as a Deno runtime flag (before the script URL).
 * Deno flags aren't in Deno.args, so we check the module cache file mtime instead:
 * if it was written within the last few seconds, `--reload` caused a fresh fetch.
 * Only meaningful for remote URLs — local files aren't cached.
 */
let _wasReloaded: boolean | undefined;
async function wasLauncherReloaded(): Promise<boolean> {
  if (_wasReloaded !== undefined) return _wasReloaded;
  _wasReloaded = false;

  const url = new URL(import.meta.url);
  if (url.protocol === 'file:') return false;

  try {
    const denoDir = Deno.env.get('DENO_DIR')
      || (Deno.build.os === 'darwin'
        ? `${Deno.env.get('HOME')}/Library/Caches/deno`
        : Deno.build.os === 'windows'
          ? `${Deno.env.get('LOCALAPPDATA')}/deno`
          : `${Deno.env.get('XDG_CACHE_HOME') || Deno.env.get('HOME') + '/.cache'}/deno`);

    let hostDir = url.hostname;
    const defaultPort = url.protocol === 'https:' ? '443' : '80';
    if (url.port && url.port !== defaultPort) {
      hostDir += `_PORT${url.port}`;
    }

    const hashBuf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(url.pathname),
    );
    const hex = [...new Uint8Array(hashBuf)]
      .map(b => b.toString(16).padStart(2, '0')).join('');

    const scheme = url.protocol.slice(0, -1);
    const cachePath = `${denoDir}/remote/${scheme}/${hostDir}/${hex}`;
    const stat = Deno.statSync(cachePath);
    const ageMs = Date.now() - (stat.mtime?.getTime() || 0);
    _wasReloaded = ageMs < 5000;
  } catch {
    // Cache file not found or unreadable — can't detect
  }

  return _wasReloaded;
}

/**
 * If a custom theme file is configured (--theme-file or --theme ending in .css),
 * add its absolute path to the --allow-read flag list so the subprocess can read it.
 */
function addThemeFileReadPermission(denoFlags: string[]): void {
  const config = MelkerConfig.get();
  const customThemePath = config.themeFile || (config.theme?.endsWith('.css') ? config.theme : undefined);
  if (customThemePath) {
    const absThemePath = customThemePath.startsWith('/')
      ? customThemePath
      : resolve(Deno.cwd(), customThemePath);
    const readIdx = denoFlags.findIndex((f: string) => f.startsWith('--allow-read='));
    if (readIdx >= 0) {
      denoFlags[readIdx] += ',' + absThemePath;
    } else if (!denoFlags.includes('--allow-read')) {
      denoFlags.push(`--allow-read=${absThemePath}`);
    }
  }
}

/**
 * Check Deno version meets minimum requirement
 */
function checkDenoVersion(): void {
  const version = Deno.version.deno;
  const [major, minor] = version.split('.').map(Number);

  // Require Deno 2.5+ for Deno.bundle() API
  if (major < 2 || (major === 2 && minor < 5)) {
    console.error(`Error: Melker requires Deno 2.5 or higher (found ${version})`);
    console.error('Please upgrade Deno: https://docs.deno.com/runtime/getting_started/installation/');
    Deno.exit(1);
  }
}

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`Melker CLI - Run Melker template files

Requires: Deno >= 2.5.0 (Node.js and Bun are not supported)

Usage:
  deno run --allow-all melker.ts <file> [options]

Supported file types:
  <file.melker>  Melker UI template
  <file.md>      Markdown document
  <file.mmd>     Mermaid diagram (rendered as graph)

Options:
  --print-tree             Display element tree structure and exit
  --print-json             Display JSON serialization and exit
  --verbose                Show system info, verbose script transpilation
  --test-sextant           Print sextant character test pattern and exit
  --schema                 Output component schema markdown and exit
  --lsp                    Start Language Server Protocol server
  --convert                Convert markdown to .melker format (stdout)
  --no-load                Skip loading persisted state
  --cache                  Use bundle cache (default: disabled)
  --watch                  Watch file for changes and auto-reload
  --show-policy            Display app policy and exit
  --print-config           Print current config with sources and exit
  --trust                  Run with full permissions, ignoring policy
  --clear-approvals        Clear all cached remote app approvals
  --revoke-approval <path> Revoke cached approval for path or URL
  --show-approval <path>   Show cached approval for path or URL
  --help, -h               Show this help message

Deno flags (forwarded to subprocess):
  --reload                 Reload remote modules
  --no-lock                Disable lockfile
  --no-check               Skip type checking (faster startup)
  --quiet, -q              Suppress diagnostic output
  --cached-only            Require remote deps already cached

${generateFlagHelp()}

Policy system (permission sandboxing):
  Apps can declare permissions via embedded <policy> tag or .policy.json file.
  Use --show-policy to see what permissions an app requires.
  Use --trust to bypass policy enforcement (runs with full permissions).

Subcommands:
  examples                 Show example commands
  info                     Show installation info
  upgrade                  Upgrade (git pull or JSR reinstall)

Examples:
  melker.ts examples/melker/counter.melker
  melker.ts --show-policy app.melker
  melker.ts --trust app.melker`);
}

/**
 * Spawn a Deno subprocess with --allow-all for internal entry points (schema, LSP).
 */
async function runEntryPoint(relativePath: string, extraDenoFlags: string[] = [], extraArgs: string[] = []): Promise<never> {
  const entryUrl = new URL(relativePath, import.meta.url);
  const entry = entryUrl.protocol === 'file:' ? entryUrl.pathname : entryUrl.href;
  const status = await new Deno.Command(Deno.execPath(), {
    args: ['run', '--allow-all', '--unstable-bundle', ...extraDenoFlags, entry, ...extraArgs],
    stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
  }).spawn().status;
  if (status.code !== 0) resetTerminalState();
  Deno.exit(status.code);
}

/**
 * Detect installation type: git checkout, JSR install, or remote URL.
 */
async function detectInstallType(): Promise<
  { type: 'git'; dir: string; branch: string; commit: string }
  | { type: 'jsr'; dir: string }
  | { type: 'remote'; url: string }
> {
  const selfUrl = new URL(import.meta.url);
  if (selfUrl.protocol !== 'file:') {
    return { type: 'remote', url: selfUrl.origin };
  }
  const dir = dirname(selfUrl.pathname);
  try {
    await Deno.stat(resolve(dir, '.git'));
    const branch = new TextDecoder().decode(
      new Deno.Command('git', { args: ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], stdout: 'piped', stderr: 'null' }).outputSync().stdout
    ).trim();
    const commit = new TextDecoder().decode(
      new Deno.Command('git', { args: ['-C', dir, 'rev-parse', '--short', 'HEAD'], stdout: 'piped', stderr: 'null' }).outputSync().stdout
    ).trim();
    return { type: 'git', dir, branch, commit };
  } catch {
    return { type: 'jsr', dir };
  }
}

/**
 * Find the installed JSR shim for melker in the Deno bin directory.
 * Returns the shim name and directory, or null if not found.
 */
async function findInstalledShim(): Promise<{ name: string; dir: string } | null> {
  const home = Deno.env.get('HOME') || Deno.env.get('USERPROFILE') || '';
  const binDir = join(
    Deno.env.get('DENO_INSTALL_ROOT') || join(home, '.deno'), 'bin'
  );
  try {
    for await (const entry of Deno.readDir(binDir)) {
      if (entry.isFile) {
        const content = await Deno.readTextFile(join(binDir, entry.name));
        if (content.includes('@wistrand/melker')) {
          return { name: entry.name, dir: binDir };
        }
      }
    }
  } catch { /* binDir not found */ }
  return null;
}

/**
 * Run a .melker app in a subprocess with restricted Deno permissions.
 * For remote apps, pass remoteContent to write to a temp file and run from there.
 */
async function runWithPolicy(
  filepath: string,
  policy: MelkerPolicy,
  originalArgs: string[],
  remoteContent?: string,
): Promise<void> {
  const isRemote = remoteContent !== undefined;
  let appDir: string;
  let appPath: string;
  let tempDir: string | undefined;

  if (isRemote) {
    // Remote: write content to temp file to avoid TOCTOU issues
    tempDir = await Deno.makeTempDir({ prefix: 'melker-remote-' });
    const ext = filepath.endsWith('.md') ? '.md' : filepath.endsWith('.mmd') ? '.mmd' : '.melker';
    appPath = `${tempDir}/app${ext}`;
    await Deno.writeTextFile(appPath, remoteContent);
    appDir = tempDir;
  } else {
    // Local: resolve to absolute path
    appPath = filepath.startsWith('/') ? filepath : resolve(Deno.cwd(), filepath);
    appDir = dirname(appPath);
  }

  try {
    const urlHash = await getUrlHash(isRemote ? filepath : appPath);

    // Apply CLI permission overrides (--allow-* / --deny-*)
    const overrides = getPermissionOverrides(MelkerConfig.get());
    const { permissions: effectivePermissions, activeDenies } = applyPermissionOverrides(policy.permissions, overrides);
    const effectivePolicy = { ...policy, permissions: effectivePermissions };

    // Convert policy to Deno permission flags
    const denoFlags = policyToDenoFlags(
      effectivePolicy, appDir, urlHash,
      isRemote ? filepath : undefined,
      activeDenies, overrides.deny, isRemote,
    );

    // Extract forwarded Deno flags (--reload, --no-lock, etc.)
    const forwardedFlags = extractForwardedDenoFlags(originalArgs);

    // Auto-forward --reload when the launcher itself was reloaded (Deno flag before script URL)
    if (!forwardedFlags.includes('--reload') && await wasLauncherReloaded()) {
      forwardedFlags.push('--reload');
    }

    addThemeFileReadPermission(denoFlags);
    denoFlags.push('--unstable-bundle');
    denoFlags.push('--no-prompt');

    // Build the subprocess command
    const runnerUrl = new URL('./src/melker-runner.ts', import.meta.url);
    const runnerEntry = runnerUrl.protocol === 'file:' ? runnerUrl.pathname : runnerUrl.href;

    // Filter out policy-related flags and forwarded Deno flags
    // For remote: replace the URL arg with the temp file path
    const filteredArgs: string[] = [];
    for (const arg of originalArgs) {
      if (arg.startsWith('--show-policy') || arg.startsWith('--trust')) continue;
      if (FORWARDED_DENO_FLAGS.includes(arg)) continue;
      if (isRemote && arg === filepath) {
        filteredArgs.push(appPath);
      } else {
        filteredArgs.push(arg);
      }
    }

    const cmd = [
      Deno.execPath(),
      'run',
      ...forwardedFlags,
      ...denoFlags,
      runnerEntry,
      ...filteredArgs,
    ];

    const env: Record<string, string> = {
      ...Deno.env.toObject(),
      MELKER_RUNNER: '1',
    };
    if (isRemote) env.MELKER_REMOTE_URL = filepath;
    if (hasOverrides(overrides)) {
      env.MELKER_PERMISSION_OVERRIDES = JSON.stringify(overrides);
    }

    const process = new Deno.Command(cmd[0], {
      args: cmd.slice(1),
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      env,
    });

    const child = process.spawn();

    // Ignore signals in parent - let the child handle them and exit gracefully
    const ignoreSignal = () => {};
    Deno.addSignalListener('SIGINT', ignoreSignal);
    Deno.addSignalListener('SIGTERM', ignoreSignal);

    const status = await child.status;

    Deno.removeSignalListener('SIGINT', ignoreSignal);
    Deno.removeSignalListener('SIGTERM', ignoreSignal);

    if (status.code !== 0) {
      resetTerminalState();
    }
    Deno.exit(status.code);
  } finally {
    if (tempDir) {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch { /* ignore cleanup errors */ }
    }
  }
}

/**
 * Main CLI entry point
 */
export async function main(): Promise<void> {
  const rt: CliRuntime = {
    version: () => denoConfig.version,
    args: () => [...Deno.args],
    cwd: () => Deno.cwd(),
    exit: Deno.exit,
    resolvePath: (...segments: string[]) => resolve(...segments),
    dirnamePath: (path: string) => dirname(path),

    stat: (path: string) => Deno.stat(path),
    isNotFoundError: (error: unknown) => error instanceof Deno.errors.NotFound,

    config: {
      reset: () => MelkerConfig.reset(),
      init: (options?) => MelkerConfig.init(options),
      get: () => MelkerConfig.get(),
      printConfig: () => MelkerConfig.printConfig(),
    },

    generateDenoFlags: (policy, appDir, urlHash, sourceUrl, activeDenies, explicitDenies, isRemote) =>
      policyToDenoFlags(policy, appDir, urlHash, sourceUrl, activeDenies, explicitDenies, isRemote),

    runApp: runWithPolicy,

    printUsage,
    handleSchema: () => runEntryPoint('./src/melker-runner.ts', [], ['--schema']),
    handleLsp: () => runEntryPoint('./src/lsp.ts', ['--no-lock']),
    handleExamples: () => {
      console.log('Showcase examples \u2014 run with melker or deno:\n');
      const examples = [
        ['demo',                 'Feature overview with tabs, tables, and canvas'],
        ['htop',                 'System monitor'],
        ['earthquake-dashboard', 'Live earthquake data dashboard'],
        ['markdown-viewer',      'Markdown file viewer'],
        ['mermaid',              'Mermaid diagram renderer'],
        ['map',                  'Interactive world map'],
        ['mandelbrot',           'Mandelbrot fractal explorer'],
        ['breakout',             'Breakout game'],
      ];
      for (const [name, desc] of examples) {
        console.log(`  # ${desc}`);
        console.log(`  melker https://melker.sh/examples/showcase/${name}.melker\n`);
      }
      console.log('More examples: https://github.com/wistrand/melker/tree/main/examples');
      Deno.exit(0);
    },
    handleInfo: async () => {
      const install = await detectInstallType();
      console.log(`Melker ${denoConfig.version}`);
      console.log(`Deno   ${Deno.version.deno}`);
      console.log('');
      if (install.type === 'git') {
        console.log('Install:  git checkout');
        console.log(`Path:     ${install.dir}`);
        if (install.branch) console.log(`Branch:   ${install.branch}`);
        if (install.commit) console.log(`Commit:   ${install.commit}`);
      } else if (install.type === 'remote') {
        console.log(`Install:  ${install.url}`);
        console.log(`URL:      ${import.meta.url}`);
      } else {
        console.log('Install:  jsr:@wistrand/melker');
        console.log(`Path:     ${install.dir}`);
        const shim = await findInstalledShim();
        if (shim) console.log(`Shim:     ${join(shim.dir, shim.name)}`);
      }
      console.log(`Platform: ${Deno.build.os} ${Deno.build.arch}`);
      Deno.exit(0);
    },
    handleUpgrade: async () => {
      const install = await detectInstallType();

      if (install.type === 'git') {
        if (!Deno.args.includes('--yes')) {
          const ok = confirm(`Run git pull in ${install.dir}?`);
          if (!ok) Deno.exit(0);
        }
        const p = new Deno.Command('git', {
          args: ['-C', install.dir, 'pull'],
          stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
        }).spawn();
        Deno.exit((await p.status).code);
      }

      // JSR or remote install: fetch latest version and reinstall
      try {
        const jsrUrl = Deno.env.get('JSR_URL') || 'https://jsr.io';
        const resp = await fetch(`${jsrUrl}/@wistrand/melker/meta.json`);
        if (!resp.ok) {
          console.error(`Failed to fetch version info from ${jsrUrl}`);
          Deno.exit(1);
        }
        const meta = await resp.json();
        const latest = meta.latest;
        const current = denoConfig.version;

        if (latest === current) {
          console.log(`Already on latest version: ${current}`);
          Deno.exit(0);
        }

        const shim = await findInstalledShim();
        const shimName = shim?.name || 'melker';

        console.log(`Upgrading ${shimName} ${current} \u2192 ${latest}...`);
        const p = new Deno.Command('deno', {
          args: ['install', '-g', '-f', '-A', '--name', shimName, `jsr:@wistrand/melker@${latest}`],
          stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
        }).spawn();
        Deno.exit((await p.status).code);
      } catch (error) {
        console.error(`Upgrade failed: ${error instanceof Error ? error.message : String(error)}`);
        Deno.exit(1);
      }
    },

    denoFlagsLabel: 'Deno flags:',
    showPolicyFlagsLabel: 'Deno permission flags:',

    checkRuntimeVersion: checkDenoVersion,
    postProcessShowPolicyFlags: addThemeFileReadPermission,
  };

  await runCli(rt);
}

// Run if this is the entry point
if (import.meta.main) {
  main();
}
