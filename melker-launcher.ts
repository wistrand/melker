// Minimal Melker Launcher
// Security-auditable entry point that handles policy enforcement and subprocess spawning.
// Does NOT import framework code - only policy module and std library.

import { dirname, join, resolve } from 'jsr:@std/path@1.1.4';

// Shared utilities
import { isUrl, loadContent } from './src/utils/content-loader.ts';
import { getTempDir } from './src/xdg.ts';

// Version from deno.json (used by upgrade subcommand)
import denoConfig from './deno.json' with { type: 'json' };

// Policy imports for permission enforcement
import {
  loadPolicy,
  loadPolicyFromContent,
  hasPolicyTag,
  validatePolicy,
  formatPolicy,
  policyToDenoFlags,
  formatDenoFlags,
  checkApproval,
  saveApproval,
  showApprovalPrompt,
  getApprovalFilePath,
  clearAllApprovals,
  revokeApproval,
  getApproval,
  checkLocalApproval,
  saveLocalApproval,
  getUrlHash,
  createAutoPolicy,
  formatOverrides,
  type MelkerPolicy,
} from './src/policy/mod.ts';
import {
  getPermissionOverrides,
  applyPermissionOverrides,
  hasOverrides,
} from './src/policy/permission-overrides.ts';

// CLI parsing from schema
import { generateFlagHelp, parseCliFlags } from './src/config/cli.ts';
import { MelkerConfig, type PolicyConfigProperty } from './src/config/config.ts';

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
 * Create an empty policy for plain mermaid files (no permissions needed)
 */
function createEmptyMermaidPolicy(filepath: string): MelkerPolicy {
  return {
    name: filepath,
    description: 'Auto-generated policy for plain mermaid file (no permissions)',
    permissions: {},
  };
}

/**
 * Check if a mermaid file has %%melker directives (custom policy/config)
 */
function hasMelkerDirectives(content: string): boolean {
  // Look for %%melker comments which indicate custom configuration
  return /%%\s*melker/i.test(content);
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
    const readIdx = denoFlags.findIndex(f => f.startsWith('--allow-read='));
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
  console.log('Melker CLI - Run Melker template files');
  console.log('');
  console.log('Requires: Deno >= 2.5.0 (Node.js and Bun are not supported)');
  console.log('');
  console.log('Usage:');
  console.log('  deno run --allow-all melker.ts <file> [options]');
  console.log('');
  console.log('Supported file types:');
  console.log('  <file.melker>  Melker UI template');
  console.log('  <file.md>      Markdown document');
  console.log('  <file.mmd>     Mermaid diagram (rendered as graph)');
  console.log('');
  console.log('Options:');
  console.log('  --print-tree             Display element tree structure and exit');
  console.log('  --print-json             Display JSON serialization and exit');
  console.log('  --verbose                Show system info, verbose script transpilation');
  console.log('  --test-sextant           Print sextant character test pattern and exit');
  console.log('  --schema                 Output component schema markdown and exit');
  console.log('  --lsp                    Start Language Server Protocol server');
  console.log('  --convert                Convert markdown to .melker format (stdout)');
  console.log('  --no-load                Skip loading persisted state');
  console.log('  --cache                  Use bundle cache (default: disabled)');
  console.log('  --watch                  Watch file for changes and auto-reload');
  console.log('  --show-policy            Display app policy and exit');
  console.log('  --print-config           Print current config with sources and exit');
  console.log('  --trust                  Run with full permissions, ignoring policy');
  console.log('  --clear-approvals        Clear all cached remote app approvals');
  console.log('  --revoke-approval <path> Revoke cached approval for path or URL');
  console.log('  --show-approval <path>   Show cached approval for path or URL');
  console.log('  --help, -h               Show this help message');
  console.log('');
  console.log('Deno flags (forwarded to subprocess):');
  console.log('  --reload                 Reload remote modules');
  console.log('  --no-lock                Disable lockfile');
  console.log('  --no-check               Skip type checking (faster startup)');
  console.log('  --quiet, -q              Suppress diagnostic output');
  console.log('  --cached-only            Require remote deps already cached');
  console.log('');
  // Add schema-driven config flags
  console.log(generateFlagHelp());
  console.log('');
  console.log('Policy system (permission sandboxing):');
  console.log('  Apps can declare permissions via embedded <policy> tag or .policy.json file.');
  console.log('  Use --show-policy to see what permissions an app requires.');
  console.log('  Use --trust to bypass policy enforcement (runs with full permissions).');
  console.log('');
  console.log('Subcommands:');
  console.log('  info                     Show installation info');
  console.log('  upgrade                  Upgrade (git pull or JSR reinstall)');
  console.log('');
  console.log('Examples:');
  console.log('  melker.ts examples/melker/counter.melker');
  console.log('  melker.ts --show-policy app.melker');
  console.log('  melker.ts --trust app.melker');
}

/**
 * Run a .melker app in a subprocess with restricted Deno permissions.
 */
async function runWithPolicy(
  filepath: string,
  policy: MelkerPolicy,
  originalArgs: string[]
): Promise<void> {

  // Get directory containing the .melker file for resolving relative paths
  const absolutePath = filepath.startsWith('/')
    ? filepath
    : resolve(Deno.cwd(), filepath);
  const appDir = dirname(absolutePath);

  // Compute URL hash for app-specific cache directory
  const urlHash = await getUrlHash(absolutePath);

  // Apply CLI permission overrides (--allow-* / --deny-*)
  const overrides = getPermissionOverrides(MelkerConfig.get());
  const { permissions: effectivePermissions, activeDenies } = applyPermissionOverrides(policy.permissions, overrides);
  const effectivePolicy = { ...policy, permissions: effectivePermissions };

  // Convert policy to Deno permission flags
  const denoFlags = policyToDenoFlags(effectivePolicy, appDir, urlHash, undefined, activeDenies, overrides.deny);

  // Extract forwarded Deno flags (--reload, --no-lock, etc.)
  const forwardedFlags = extractForwardedDenoFlags(originalArgs);

  // Auto-forward --reload when the launcher itself was reloaded (Deno flag before script URL)
  if (!forwardedFlags.includes('--reload') && await wasLauncherReloaded()) {
    forwardedFlags.push('--reload');
  }

  addThemeFileReadPermission(denoFlags);

  // Required: --unstable-bundle for Deno.bundle() API
  denoFlags.push('--unstable-bundle');

  // Disable interactive permission prompts - fail fast instead of hanging
  denoFlags.push('--no-prompt');

  // Build the subprocess command - run melker-runner.ts
  const runnerUrl = new URL('./src/melker-runner.ts', import.meta.url);
  // Use href for remote URLs, pathname for local files
  const runnerEntry = runnerUrl.protocol === 'file:' ? runnerUrl.pathname : runnerUrl.href;

  // Filter out policy-related flags and forwarded Deno flags that shouldn't be passed to subprocess
  const filteredArgs = originalArgs.filter(arg =>
    !arg.startsWith('--show-policy') &&
    !arg.startsWith('--trust') &&
    !FORWARDED_DENO_FLAGS.includes(arg)
  );

  const cmd = [
    Deno.execPath(),
    'run',
    ...forwardedFlags,
    ...denoFlags,
    runnerEntry,
    ...filteredArgs,
  ];

  // Spawn subprocess with restricted permissions
  // Pass permission overrides to runner if any were specified
  const envOverrides: Record<string, string> = {
    ...Deno.env.toObject(),
    MELKER_RUNNER: '1', // Signal that policy has been checked
  };
  if (hasOverrides(overrides)) {
    envOverrides.MELKER_PERMISSION_OVERRIDES = JSON.stringify(overrides);
  }

  const process = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: envOverrides,
  });

  const child = process.spawn();

  // Ignore signals in parent - let the child handle them and exit gracefully
  const ignoreSignal = () => {};
  Deno.addSignalListener('SIGINT', ignoreSignal);
  Deno.addSignalListener('SIGTERM', ignoreSignal);

  const status = await child.status;

  // Clean up signal listeners
  Deno.removeSignalListener('SIGINT', ignoreSignal);
  Deno.removeSignalListener('SIGTERM', ignoreSignal);

  // If subprocess failed, try to restore terminal state
  if (status.code !== 0) {
    resetTerminalState();
  }

  // Exit with the subprocess exit code
  Deno.exit(status.code);
}

/**
 * Run a remote .melker app in a subprocess with restricted Deno permissions.
 */
async function runRemoteWithPolicy(
  url: string,
  content: string,
  policy: MelkerPolicy,
  originalArgs: string[]
): Promise<void> {
  // Write approved content to temp file to avoid TOCTOU issues
  // Preserve original extension so runner knows whether to parse as markdown
  const tempDir = await Deno.makeTempDir({ prefix: 'melker-remote-' });
  const ext = url.endsWith('.md') ? '.md' : url.endsWith('.mmd') ? '.mmd' : '.melker';
  const tempFile = `${tempDir}/app${ext}`;
  await Deno.writeTextFile(tempFile, content);

  try {
    // Compute URL hash for app-specific cache directory (use original URL, not temp file)
    const urlHash = await getUrlHash(url);

    // Apply CLI permission overrides (--allow-* / --deny-*)
    const overrides = getPermissionOverrides(MelkerConfig.get());
    const { permissions: effectivePermissions, activeDenies } = applyPermissionOverrides(policy.permissions, overrides);
    const effectivePolicy = { ...policy, permissions: effectivePermissions };

    // Convert policy to Deno permission flags
    // Pass the source URL for "samesite" net permission resolution
    // Use tempDir as appDir — remote apps should not get implicit cwd read access
    const denoFlags = policyToDenoFlags(effectivePolicy, tempDir, urlHash, url, activeDenies, overrides.deny, true);

    // Extract forwarded Deno flags (--reload, --no-lock, etc.)
    const forwardedFlags = extractForwardedDenoFlags(originalArgs);

    // Auto-forward --reload when the launcher itself was reloaded (Deno flag before script URL)
    if (!forwardedFlags.includes('--reload') && await wasLauncherReloaded()) {
      forwardedFlags.push('--reload');
    }

    addThemeFileReadPermission(denoFlags);

    // Required: --unstable-bundle for Deno.bundle() API
    denoFlags.push('--unstable-bundle');

    // Disable interactive permission prompts
    denoFlags.push('--no-prompt');

    // Build the subprocess command
    const runnerUrl = new URL('./src/melker-runner.ts', import.meta.url);
    const runnerEntry = runnerUrl.protocol === 'file:' ? runnerUrl.pathname : runnerUrl.href;

    // Filter out policy-related flags, forwarded Deno flags, and replace app URL with temp file
    const filteredArgs: string[] = [];
    for (const arg of originalArgs) {
      if (arg.startsWith('--show-policy') || arg.startsWith('--trust')) {
        continue;
      }
      if (FORWARDED_DENO_FLAGS.includes(arg)) {
        continue;
      }
      // Only replace the app URL with temp file path, preserve other URL arguments
      if (arg === url) {
        filteredArgs.push(tempFile);
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
        MELKER_REMOTE_URL: url, // Pass original URL for reference
      };
    if (hasOverrides(overrides)) {
      env.MELKER_PERMISSION_OVERRIDES = JSON.stringify(overrides);
    }

    // Spawn subprocess with restricted permissions
    const process = new Deno.Command(cmd[0], {
      args: cmd.slice(1),
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      env: env
    });

    const child = process.spawn();

    // Ignore signals in parent
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
    // Clean up temp directory
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Main CLI entry point
 */
export async function main(): Promise<void> {
  const args = Deno.args;

  // Check Deno version first
  checkDenoVersion();

  if (args.length === 0) {
    printUsage();
    Deno.exit(0);
  }

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    Deno.exit(0);
  }

  // Handle --test-sextant option (prints sextant test pattern and exits)
  if (args.includes('--test-sextant')) {
    console.log(`
=== Sextant Character Test ===

Plain (no ANSI):     🬀🬁🬂🬃🬄🬅🬆🬇🬈🬉🬊🬋🬌🬍🬎🬏

With FG color:       \x1b[38;2;255;255;0m🬀🬁🬂🬃🬄🬅🬆🬇🬈🬉🬊🬋🬌🬍🬎🬏\x1b[0m

With BG color:       \x1b[48;2;0;0;128m🬀🬁🬂🬃🬄🬅🬆🬇🬈🬉🬊🬋🬌🬍🬎🬏\x1b[0m

With FG+BG:          \x1b[38;2;255;255;0m\x1b[48;2;0;0;128m🬀🬁🬂🬃🬄🬅🬆🬇🬈🬉🬊🬋🬌🬍🬎🬏\x1b[0m

Reset before each:   \x1b[0m\x1b[38;2;255;0;0m🬀\x1b[0m\x1b[38;2;0;255;0m🬁\x1b[0m\x1b[38;2;0;0;255m🬂\x1b[0m\x1b[38;2;255;255;0m🬃\x1b[0m\x1b[38;2;255;0;255m🬄\x1b[0m\x1b[38;2;0;255;255m🬅\x1b[0m

If all rows show the same sequence of sextant characters (U+1FB00-U+1FB0F),
your terminal supports sextant mode. If any row appears scrambled, use:
  MELKER_GFX_MODE=iterm2  (if your terminal supports iTerm2 protocol)
  MELKER_GFX_MODE=block   (universal fallback)
`);
    Deno.exit(0);
  }

  // Handle --schema option (delegates to runner)
  if (args.includes('--schema')) {
    const runnerUrl = new URL('./src/melker-runner.ts', import.meta.url);
    const runnerEntry = runnerUrl.protocol === 'file:' ? runnerUrl.pathname : runnerUrl.href;
    const process = new Deno.Command(Deno.execPath(), {
      args: ['run', '--allow-all', '--unstable-bundle', runnerEntry, '--schema'],
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const status = await process.spawn().status;
    if (status.code !== 0) resetTerminalState();
    Deno.exit(status.code);
  }

  // Handle --lsp option (runs LSP entry point directly, not via runner)
  if (args.includes('--lsp')) {
    const lspUrl = new URL('./src/lsp.ts', import.meta.url);
    const lspEntry = lspUrl.protocol === 'file:' ? lspUrl.pathname : lspUrl.href;
    const process = new Deno.Command(Deno.execPath(), {
      args: ['run', '--allow-all', '--unstable-bundle', '--no-lock', lspEntry],
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const status = await process.spawn().status;
    if (status.code !== 0) resetTerminalState();
    Deno.exit(status.code);
  }

  // Handle --print-config
  if (args.includes('--print-config')) {
    // Parse CLI flags and find file path
    const { flags: cliFlags, remaining } = parseCliFlags(args);
    const fileIndex = remaining.findIndex(arg => !arg.startsWith('--'));
    const filepath = fileIndex >= 0 ? remaining[fileIndex] : undefined;

    // Load policy config if a file is provided
    let policyConfig: Record<string, unknown> = {};
    let policyConfigSchema: Record<string, PolicyConfigProperty> | undefined;
    if (filepath && (filepath.endsWith('.melker') || filepath.endsWith('.md') || filepath.endsWith('.mmd'))) {
      try {
        const absolutePath = filepath.startsWith('/') || isUrl(filepath)
          ? filepath
          : resolve(Deno.cwd(), filepath);
        const policyResult = isUrl(filepath)
          ? await loadPolicyFromContent(await loadContent(filepath), filepath)
          : await loadPolicy(absolutePath);
        if (policyResult.policy?.config || policyResult.policy?.configSchema) {
          policyConfig = policyResult.policy.config ?? {};
          policyConfigSchema = policyResult.policy.configSchema as Record<string, PolicyConfigProperty> | undefined;
          console.log(`Policy config from: ${policyResult.source}${policyResult.path ? ` (${policyResult.path})` : ''}\n`);
        }
      } catch {
        // Ignore errors - just print config without policy
      }
    }

    // Reset and re-init with policy config
    MelkerConfig.reset();
    MelkerConfig.init({ policyConfig, policyConfigSchema, cliFlags });
    MelkerConfig.printConfig();
    Deno.exit(0);
  }

  // Handle --clear-approvals
  if (args.includes('--clear-approvals')) {
    const count = await clearAllApprovals();
    console.log(`Cleared ${count} cached approval${count !== 1 ? 's' : ''}.`);
    Deno.exit(0);
  }

  // Handle 'info' subcommand
  if (args.includes('info')) {
    const selfUrl = new URL(import.meta.url);
    const isFileUrl = selfUrl.protocol === 'file:';
    const selfDir = isFileUrl ? dirname(selfUrl.pathname) : null;

    // Detect git checkout (only possible for file: URLs)
    let isGitCheckout = false;
    let gitBranch = '';
    let gitCommit = '';
    if (selfDir) {
      try {
        await Deno.stat(resolve(selfDir, '.git'));
        isGitCheckout = true;
        const branch = new Deno.Command('git', {
          args: ['-C', selfDir, 'rev-parse', '--abbrev-ref', 'HEAD'],
          stdout: 'piped', stderr: 'null',
        }).outputSync();
        gitBranch = new TextDecoder().decode(branch.stdout).trim();
        const commit = new Deno.Command('git', {
          args: ['-C', selfDir, 'rev-parse', '--short', 'HEAD'],
          stdout: 'piped', stderr: 'null',
        }).outputSync();
        gitCommit = new TextDecoder().decode(commit.stdout).trim();
      } catch { /* not a git checkout */ }
    }

    console.log(`Melker ${denoConfig.version}`);
    console.log(`Deno   ${Deno.version.deno}`);
    console.log('');
    if (isGitCheckout) {
      console.log('Install:  git checkout');
      console.log(`Path:     ${selfDir}`);
      if (gitBranch) console.log(`Branch:   ${gitBranch}`);
      if (gitCommit) console.log(`Commit:   ${gitCommit}`);
    } else if (!isFileUrl) {
      console.log(`Install:  ${selfUrl.origin}`);
      console.log(`URL:      ${import.meta.url}`);
    } else {
      console.log('Install:  jsr:@wistrand/melker');
      console.log(`Path:     ${selfDir}`);
      // Try to find the shim
      const home = Deno.env.get('HOME') || Deno.env.get('USERPROFILE') || '';
      const binDir = join(
        Deno.env.get('DENO_INSTALL_ROOT') || join(home, '.deno'), 'bin'
      );
      try {
        for await (const entry of Deno.readDir(binDir)) {
          if (entry.isFile) {
            const content = await Deno.readTextFile(join(binDir, entry.name));
            if (content.includes('@wistrand/melker')) {
              console.log(`Shim:     ${join(binDir, entry.name)}`);
              break;
            }
          }
        }
      } catch { /* binDir not found */ }
    }
    console.log(`Platform: ${Deno.build.os} ${Deno.build.arch}`);
    Deno.exit(0);
  }

  // Handle 'upgrade' subcommand
  if (args.includes('upgrade')) {
    // Detect if running from git checkout or JSR install
    const selfDir = dirname(new URL(import.meta.url).pathname);
    let isGitCheckout = false;
    try {
      await Deno.stat(resolve(selfDir, '.git'));
      isGitCheckout = true;
    } catch { /* not a git checkout */ }

    if (isGitCheckout) {
      // Git checkout: pull latest changes
      if (!args.includes('--yes')) {
        const ok = confirm(`Run git pull in ${selfDir}?`);
        if (!ok) {
          Deno.exit(0);
        }
      }
      const p = new Deno.Command('git', {
        args: ['-C', selfDir, 'pull'],
        stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
      }).spawn();
      Deno.exit((await p.status).code);
    }

    // JSR install: fetch latest version and reinstall
    try {
      const resp = await fetch('https://jsr.io/@wistrand/melker/meta.json');
      if (!resp.ok) {
        console.error('Failed to fetch version info from jsr.io');
        Deno.exit(1);
      }
      const meta = await resp.json();
      const latest = meta.latest;
      const current = denoConfig.version;

      if (latest === current) {
        console.log(`Already on latest version: ${current}`);
        Deno.exit(0);
      }

      // Detect the shim name used at install time (might not be 'melker')
      const home = Deno.env.get('HOME') || Deno.env.get('USERPROFILE') || '';
      const binDir = join(
        Deno.env.get('DENO_INSTALL_ROOT') || join(home, '.deno'), 'bin'
      );
      let shimName = 'melker';
      try {
        for await (const entry of Deno.readDir(binDir)) {
          if (entry.isFile) {
            const content = await Deno.readTextFile(join(binDir, entry.name));
            if (content.includes('@wistrand/melker')) {
              shimName = entry.name;
              break;
            }
          }
        }
      } catch { /* binDir not found — use default */ }

      console.log(`Upgrading ${shimName} ${current} → ${latest}...`);
      const p = new Deno.Command('deno', {
        args: ['install', '-g', '-f', '-A', '--name', shimName, `jsr:@wistrand/melker@${latest}`],
        stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
      }).spawn();
      Deno.exit((await p.status).code);
    } catch (error) {
      console.error(`Upgrade failed: ${error instanceof Error ? error.message : String(error)}`);
      Deno.exit(1);
    }
  }

  // Handle --revoke-approval <path>
  const revokeIndex = args.indexOf('--revoke-approval');
  if (revokeIndex >= 0) {
    const target = args[revokeIndex + 1];
    if (!target || target.startsWith('--')) {
      console.error('Error: --revoke-approval requires a path or URL argument');
      Deno.exit(1);
    }
    // Resolve to absolute path for local files (approvals are stored by absolute path)
    const isUrl = target.startsWith('http://') || target.startsWith('https://');
    const lookupPath = isUrl ? target : resolve(Deno.cwd(), target);
    const revoked = await revokeApproval(lookupPath);
    if (revoked) {
      console.log(`Revoked approval for: ${target}`);
    } else {
      console.log(`No approval found for: ${target}`);
    }
    Deno.exit(0);
  }

  // Handle --show-approval <path>
  const showApprovalIndex = args.indexOf('--show-approval');
  if (showApprovalIndex >= 0) {
    const target = args[showApprovalIndex + 1];
    if (!target || target.startsWith('--')) {
      console.error('Error: --show-approval requires a path or URL argument');
      Deno.exit(1);
    }
    // Resolve to absolute path for local files (approvals are stored by absolute path)
    const isUrl = target.startsWith('http://') || target.startsWith('https://');
    const lookupPath = isUrl ? target : resolve(Deno.cwd(), target);
    const record = await getApproval(lookupPath);
    if (record) {
      const approvalFile = await getApprovalFilePath(lookupPath);
      console.log(`\nApproval record for: ${target}`);
      console.log(`  (resolved: ${lookupPath})\n`);
      console.log(`Approval file: ${approvalFile}`);
      console.log(`Approved: ${record.approvedAt}`);
      console.log(`Hash: ${record.hash.substring(0, 16)}...`);
      console.log('\nPolicy:');
      console.log(formatPolicy(record.policy, isUrl ? lookupPath : undefined));
      console.log('\nDeno flags:');
      console.log(formatDenoFlags(record.denoFlags));
    } else {
      // No approval - check if file exists and show its policy
      console.log(`\nNo approval found for: ${target}\n`);

      // Check if it's a local file that exists
      const isUrl = target.startsWith('http://') || target.startsWith('https://');
      if (!isUrl) {
        try {
          const stat = await Deno.stat(target);
          if (stat.isFile) {
            console.log('Local app has not been approved yet.');
            console.log('Run the app to trigger the approval prompt.\n');

            // Try to load and show the policy
            try {
              const result = await loadPolicy(target);
              if (result.policy) {
                console.log('App policy:');
                console.log(formatPolicy(result.policy));
              } else {
                console.log('No policy declared in file (will use auto-policy with all permissions).');
              }
            } catch {
              // Ignore policy load errors
            }
          }
        } catch (e) {
          if (e instanceof Deno.errors.NotFound) {
            console.log('File not found.');
          } else {
            console.log(`Cannot access file: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } else {
        console.log('Remote app has not been approved yet.');
        console.log('Run the app to trigger the approval prompt.');
      }
    }
    Deno.exit(0);
  }

  // Parse schema-driven CLI flags to get remaining args (file path, etc.)
  const { flags: cliFlags, remaining: remainingArgs } = parseCliFlags(args);

  // Initialize config with CLI flags (for permission overrides)
  MelkerConfig.reset();
  MelkerConfig.init({ cliFlags });

  // Parse options from remaining args
  const options = {
    showPolicy: remainingArgs.includes('--show-policy'),
    trust: remainingArgs.includes('--trust'),
    watch: remainingArgs.includes('--watch'),
  };

  // Find the file argument from remaining args (after schema flags consumed)
  const filepathIndex = remainingArgs.findIndex(arg => !arg.startsWith('--'));
  const filepath = filepathIndex >= 0 ? remainingArgs[filepathIndex] : undefined;

  if (!filepath) {
    console.error('Error: No .melker, .md, or .mmd file specified');
    console.error('Use --help for usage information');
    Deno.exit(1);
  }

  // Validate file extension
  if (!filepath.endsWith('.melker') && !filepath.endsWith('.md') && !filepath.endsWith('.mmd')) {
    console.error('Error: File must have .melker, .md, or .mmd extension');
    Deno.exit(1);
  }

  // Check watch mode with URLs
  if (options.watch && isUrl(filepath)) {
    console.error('Error: --watch is not supported for URLs');
    Deno.exit(1);
  }

  const absoluteFilepath = filepath.startsWith('/') || isUrl(filepath)
    ? filepath
    : resolve(Deno.cwd(), filepath);

  try {
    // Check if file exists (skip for URLs)
    if (!isUrl(filepath)) {
      await Deno.stat(filepath);
    }

    // Handle --show-policy flag
    if (options.showPolicy) {
      // Get CLI permission overrides
      const overrides = getPermissionOverrides(MelkerConfig.get());
      const hasCliOverrides = hasOverrides(overrides);

      if (isUrl(filepath)) {
        const content = await loadContent(filepath);
        if (!hasPolicyTag(content)) {
          console.log('\nNo policy found in remote file.');
          console.log('Remote .melker files must contain a <policy> tag.');
          Deno.exit(0);
        }
        const policyResult = await loadPolicyFromContent(content, filepath);
        const policy = policyResult.policy ?? createAutoPolicy(filepath);

        // Apply CLI overrides
        const { permissions: effectivePermissions, activeDenies } = applyPermissionOverrides(policy.permissions, overrides);
        const effectivePolicy = { ...policy, permissions: effectivePermissions };

        const urlHash = await getUrlHash(filepath);
        console.log(`\nPolicy source: ${policyResult.source}${hasCliOverrides ? ' + CLI overrides' : ''}\n`);
        // Pass source URL for "samesite" resolution (filepath is the URL)
        console.log(formatPolicy(effectivePolicy, filepath));
        if (hasCliOverrides) {
          console.log('\nCLI overrides:');
          for (const line of formatOverrides(overrides)) {
            console.log(line);
          }
        }
        console.log('\nDeno permission flags:');
        const flags = policyToDenoFlags(effectivePolicy, getTempDir(), urlHash, filepath, activeDenies, overrides.deny, true);
        addThemeFileReadPermission(flags);
        console.log(formatDenoFlags(flags));
      } else {
        // For plain .mmd files, use the empty mermaid policy
        if (filepath.endsWith('.mmd')) {
          const content = await loadContent(filepath);
          if (!hasMelkerDirectives(content)) {
            const policy = createEmptyMermaidPolicy(filepath);
            // Apply CLI overrides even to empty policy
            const { permissions: effectivePermissions, activeDenies } = applyPermissionOverrides(policy.permissions, overrides);
            const effectivePolicy = { ...policy, permissions: effectivePermissions };
            const urlHash = await getUrlHash(absoluteFilepath);

            console.log(`\nPolicy source: auto (plain mermaid file)${hasCliOverrides ? ' + CLI overrides' : ''}\n`);
            console.log(formatPolicy(effectivePolicy));
            if (hasCliOverrides) {
              console.log('\nCLI overrides:');
              for (const line of formatOverrides(overrides)) {
                console.log(line);
              }
            }
            console.log('\nDeno permission flags:');
            const flags = policyToDenoFlags(effectivePolicy, dirname(absoluteFilepath), urlHash, undefined, activeDenies, overrides.deny);
            addThemeFileReadPermission(flags);
            console.log(formatDenoFlags(flags));
            Deno.exit(0);
          }
        }
        const policyResult = await loadPolicy(absoluteFilepath);
        const policy = policyResult.policy ?? createAutoPolicy(absoluteFilepath);

        // Apply CLI overrides
        const { permissions: effectivePermissions, activeDenies } = applyPermissionOverrides(policy.permissions, overrides);
        const effectivePolicy = { ...policy, permissions: effectivePermissions };

        const urlHash = await getUrlHash(absoluteFilepath);
        const source = policyResult.policy ? policyResult.source : 'auto';
        console.log(`\nPolicy source: ${source}${policyResult.path ? ` (${policyResult.path})` : ''}${hasCliOverrides ? ' + CLI overrides' : ''}\n`);
        console.log(formatPolicy(effectivePolicy));
        if (hasCliOverrides) {
          console.log('\nCLI overrides:');
          for (const line of formatOverrides(overrides)) {
            console.log(line);
          }
        }
        console.log('\nDeno permission flags:');
        const flags = policyToDenoFlags(effectivePolicy, dirname(absoluteFilepath), urlHash, undefined, activeDenies, overrides.deny);
        addThemeFileReadPermission(flags);
        console.log(formatDenoFlags(flags));
      }
      Deno.exit(0);
    }

    // Remote file security checks (unless --trust)
    if (isUrl(filepath) && !options.trust) {
      const content = await loadContent(filepath);

      // Mandatory policy for remote files
      if (!hasPolicyTag(content)) {
        console.error('\x1b[31mError: Remote .melker files must contain a <policy> tag.\x1b[0m');
        console.error('\nRemote files require explicit permission declarations for security.');
        console.error('Use --trust to bypass this check (dangerous).');
        Deno.exit(1);
      }

      // Load and validate policy
      const policyResult = await loadPolicyFromContent(content, filepath);
      if (!policyResult.policy) {
        console.error('\x1b[31mError: Failed to parse policy from remote file.\x1b[0m');
        Deno.exit(1);
      }

      const policy = policyResult.policy;
      const errors = validatePolicy(policy);
      if (errors.length > 0) {
        console.error('Policy validation errors:');
        for (const err of errors) {
          console.error(`  - ${err}`);
        }
        Deno.exit(1);
      }

      // Generate Deno flags and check approval
      // Pass source URL for "samesite" resolution
      const urlHash = await getUrlHash(filepath);
      const denoFlags = policyToDenoFlags(policy, getTempDir(), urlHash, filepath, undefined, undefined, true);
      const isApproved = await checkApproval(filepath, content, policy, denoFlags);

      if (!isApproved) {
        const promptOverrides = getPermissionOverrides(MelkerConfig.get());
        const approved = showApprovalPrompt(filepath, policy, hasOverrides(promptOverrides) ? promptOverrides : undefined);
        if (!approved) {
          console.log('\nPermission denied. Exiting.');
          Deno.exit(0);
        }
        await saveApproval(filepath, content, policy, denoFlags);
        const approvalFile = await getApprovalFilePath(filepath);
        console.log(`Approval saved: ${approvalFile}\n`);
      }

      await runRemoteWithPolicy(filepath, content, policy, args);
      return;
    }

    // Plain .mmd files without %%melker directives - run with empty policy, no approval needed
    if (!isUrl(filepath) && filepath.endsWith('.mmd')) {
      const content = await loadContent(filepath);
      if (!hasMelkerDirectives(content)) {
        // Plain mermaid file - no approval needed, use empty policy
        await runWithPolicy(absoluteFilepath, createEmptyMermaidPolicy(filepath), args);
        return;
      }
    }

    // Local file approval and policy enforcement (unless --trust)
    if (!isUrl(filepath) && !options.trust) {
      const policyResult = await loadPolicy(absoluteFilepath);
      const policy = policyResult.policy ?? createAutoPolicy(absoluteFilepath);
      const urlHash = await getUrlHash(absoluteFilepath);
      const denoFlags = policyToDenoFlags(policy, dirname(absoluteFilepath), urlHash);

      // Validate policy if present
      if (policyResult.policy) {
        const errors = validatePolicy(policyResult.policy);
        if (errors.length > 0) {
          console.error('Policy validation errors:');
          for (const err of errors) {
            console.error(`  - ${err}`);
          }
          Deno.exit(1);
        }
      }

      // Local file approval check (compares policy hash - code changes ok, policy changes re-approve)
      const isApproved = await checkLocalApproval(absoluteFilepath, policy);

      if (!isApproved) {
        const promptOverrides = getPermissionOverrides(MelkerConfig.get());
        const approved = showApprovalPrompt(absoluteFilepath, policy, hasOverrides(promptOverrides) ? promptOverrides : undefined);
        if (!approved) {
          console.log('\nPermission denied. Exiting.');
          Deno.exit(0);
        }
        await saveLocalApproval(absoluteFilepath, policy, denoFlags);
        const approvalFile = await getApprovalFilePath(absoluteFilepath);
        console.log(`Approval saved: ${approvalFile}\n`);
      }

      await runWithPolicy(absoluteFilepath, policy, args);
      return;
    }

    // --trust mode: run with full permissions
    await runWithPolicy(absoluteFilepath, createAutoPolicy(absoluteFilepath), args);

  } catch (error) {
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
  main();
}
