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
    await runEntryPoint('./src/melker-runner.ts', [], ['--schema']);
  }

  // Handle --lsp option (runs LSP entry point directly, not via runner)
  if (args.includes('--lsp')) {
    await runEntryPoint('./src/lsp.ts', ['--no-lock']);
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
  }

  // Handle 'upgrade' subcommand
  if (args.includes('upgrade')) {
    const install = await detectInstallType();

    if (install.type === 'git') {
      if (!args.includes('--yes')) {
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

      const shim = await findInstalledShim();
      const shimName = shim?.name || 'melker';

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
    const lookupPath = isUrl(target) ? target : resolve(Deno.cwd(), target);
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
    const targetIsUrl = isUrl(target);
    const lookupPath = targetIsUrl ? target : resolve(Deno.cwd(), target);
    const record = await getApproval(lookupPath);
    if (record) {
      const approvalFile = await getApprovalFilePath(lookupPath);
      console.log(`\nApproval record for: ${target}`);
      console.log(`  (resolved: ${lookupPath})\n`);
      console.log(`Approval file: ${approvalFile}`);
      console.log(`Approved: ${record.approvedAt}`);
      console.log(`Hash: ${record.hash.substring(0, 16)}...`);
      console.log('\nPolicy:');
      console.log(formatPolicy(record.policy, targetIsUrl ? lookupPath : undefined));
      console.log('\nDeno flags:');
      console.log(formatDenoFlags(record.denoFlags));
    } else {
      // No approval - check if file exists and show its policy
      console.log(`\nNo approval found for: ${target}\n`);

      if (!targetIsUrl) {
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
      // Load policy based on source type
      let policy: MelkerPolicy;
      let sourceLabel: string;
      let appDir: string;
      let sourceUrl: string | undefined;
      const remote = isUrl(filepath);

      if (remote) {
        const content = await loadContent(filepath);
        if (!hasPolicyTag(content)) {
          console.log('\nNo policy found in remote file.');
          console.log('Remote .melker files must contain a <policy> tag.');
          Deno.exit(0);
        }
        const r = await loadPolicyFromContent(content, filepath);
        policy = r.policy ?? createAutoPolicy(filepath);
        sourceLabel = r.source;
        appDir = getTempDir();
        sourceUrl = filepath;
      } else if (filepath.endsWith('.mmd') && !hasMelkerDirectives(await loadContent(filepath))) {
        policy = createEmptyMermaidPolicy(filepath);
        sourceLabel = 'auto (plain mermaid file)';
        appDir = dirname(absoluteFilepath);
      } else {
        const r = await loadPolicy(absoluteFilepath);
        policy = r.policy ?? createAutoPolicy(absoluteFilepath);
        sourceLabel = r.policy ? `${r.source}${r.path ? ` (${r.path})` : ''}` : 'auto';
        appDir = dirname(absoluteFilepath);
      }

      // Apply CLI overrides and print
      const overrides = getPermissionOverrides(MelkerConfig.get());
      const hasCliOverrides = hasOverrides(overrides);
      const { permissions: effectivePermissions, activeDenies } = applyPermissionOverrides(policy.permissions, overrides);
      const effectivePolicy = { ...policy, permissions: effectivePermissions };
      const urlHash = await getUrlHash(remote ? filepath : absoluteFilepath);

      console.log(`\nPolicy source: ${sourceLabel}${hasCliOverrides ? ' + CLI overrides' : ''}\n`);
      console.log(formatPolicy(effectivePolicy, sourceUrl));
      if (hasCliOverrides) {
        console.log('\nCLI overrides:');
        for (const line of formatOverrides(overrides)) {
          console.log(line);
        }
      }
      console.log('\nDeno permission flags:');
      const flags = policyToDenoFlags(effectivePolicy, appDir, urlHash, sourceUrl, activeDenies, overrides.deny, remote);
      addThemeFileReadPermission(flags);
      console.log(formatDenoFlags(flags));
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

      await runWithPolicy(filepath, policy, args, content);
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
