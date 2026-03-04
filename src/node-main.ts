// Node.js CLI for Melker
// Thin wrapper — delegates shared CLI logic to cli-shared.ts.
// Keeps only Node-specific: printUsage, runApp, handler implementations.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cwd,
  args as getArgs,
  exit,
  platform,
  arch,
  runtimeVersion,
  melkerVersion,
  stat as fsStat,
  isNotFoundError,
} from './runtime/mod.ts';

import { type MelkerPolicy, getUrlHash } from './policy/mod.ts';
import {
  getPermissionOverrides,
  applyPermissionOverrides,
  hasOverrides,
} from './policy/permission-overrides.ts';
import { policyToNodeFlags } from './policy/flags-node.ts';

import { generateFlagHelp } from './config/cli.ts';
import { MelkerConfig } from './config/config.ts';

import { runCli, type CliRuntime } from './cli-shared.ts';

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`Melker CLI (Node.js) - Run Melker template files

Requires: Node.js >= 25.0.0

Usage:
  melker-node <file> [options]

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
  --server                 Start WebSocket dev server
  --headless               Run without terminal (auto-enables --server)
  --show-policy            Display app policy and exit
  --print-config           Print current config with sources and exit
  --trust                  Run with full permissions, ignoring policy
  --clear-approvals        Clear all cached remote app approvals
  --revoke-approval <path> Revoke cached approval for path or URL
  --show-approval <path>   Show cached approval for path or URL
  --help, -h               Show this help message

${generateFlagHelp()}

Policy system (permission sandboxing):
  Apps can declare permissions via embedded <policy> tag or .policy.json file.
  Use --show-policy to see what permissions an app requires.
  Use --trust to bypass policy enforcement (runs with full permissions).

Subcommands:
  examples                 Show example commands
  info                     Show installation info

Use 'npm update' to upgrade.

Examples:
  melker-node examples/melker/counter.melker
  melker-node --show-policy app.melker
  melker-node --trust app.melker`);
}

/** Melker installation directory (parent of src/) */
const MELKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Reset terminal state after subprocess failure.
 * Uses raw ANSI codes to avoid importing framework modules.
 */
function resetTerminalState(): void {
  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  } catch {
    // Ignore - might already be in cooked mode
  }
  try {
    // Reset: normal screen, show cursor, disable mouse, reset attributes
    const reset = '\x1b[?1049l\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[0m';
    process.stdout.write(reset);
  } catch {
    // Ignore write errors
  }
}

/**
 * Run a .melker app in a subprocess with Node.js --permission flags.
 * Mirrors the Deno launcher's runWithPolicy() pattern.
 */
async function runApp(
  filepath: string,
  policy: MelkerPolicy,
  originalArgs: string[],
  remoteContent?: string,
): Promise<void> {
  const isRemote = remoteContent !== undefined;
  const isTrust = originalArgs.includes('--trust');
  let appDir: string;
  let appPath: string;
  let tempDir: string | undefined;

  if (isRemote) {
    // Remote: write content to temp file to avoid TOCTOU issues
    tempDir = await mkdtemp(join(tmpdir(), 'melker-remote-'));
    const ext = filepath.endsWith('.md') ? '.md' : filepath.endsWith('.mmd') ? '.mmd' : '.melker';
    appPath = join(tempDir, `app${ext}`);
    await writeFile(appPath, remoteContent!);
    appDir = tempDir;
  } else {
    appPath = filepath.startsWith('/') ? filepath : resolve(cwd(), filepath);
    appDir = dirname(appPath);
  }

  try {
    const urlHash = await getUrlHash(isRemote ? filepath : appPath);

    // Apply CLI permission overrides
    const overrides = getPermissionOverrides(MelkerConfig.get());
    const { permissions: effectivePermissions } = applyPermissionOverrides(policy.permissions, overrides);
    const effectivePolicy = { ...policy, permissions: effectivePermissions };

    // Build Node permission flags (empty array = no restrictions for --trust/all)
    const nodeFlags = isTrust ? [] : policyToNodeFlags(effectivePolicy, appDir, MELKER_DIR, urlHash, isRemote);

    // Filter out policy-related flags; replace remote URL with temp file path
    const filteredArgs: string[] = [];
    for (const arg of originalArgs) {
      if (arg === '--show-policy' || arg === '--trust') continue;
      if (isRemote && arg === filepath) {
        filteredArgs.push(appPath);
      } else {
        filteredArgs.push(arg);
      }
    }

    // Build subprocess command
    const runnerEntry = resolve(MELKER_DIR, 'src/node-runner-entry.mjs');
    const cmdArgs = [
      ...nodeFlags,
      '--no-warnings',
      '--experimental-transform-types',
      runnerEntry,
      ...filteredArgs,
    ];

    // Build environment
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      MELKER_RUNNER: '1',
    };
    if (isRemote) env.MELKER_REMOTE_URL = filepath;
    if (hasOverrides(overrides)) {
      env.MELKER_PERMISSION_OVERRIDES = JSON.stringify(overrides);
    }

    const child = spawn(process.execPath, cmdArgs, {
      stdio: 'inherit',
      env,
    });

    // Ignore SIGINT in parent (terminal Ctrl+C goes to process group — child handles it).
    // Forward SIGTERM to child (explicit kill from parent only targets this process).
    const ignoreSigint = () => {};
    const forwardSigterm = () => { child.kill('SIGTERM'); };
    process.on('SIGINT', ignoreSigint);
    process.on('SIGTERM', forwardSigterm);

    await new Promise<void>((resolvePromise) => {
      child.on('close', (code) => {
        process.removeListener('SIGINT', ignoreSigint);
        process.removeListener('SIGTERM', forwardSigterm);

        if (code !== 0) {
          resetTerminalState();
        }
        process.exit(code ?? 1);
      });

      child.on('error', (err) => {
        process.removeListener('SIGINT', ignoreSigint);
        process.removeListener('SIGTERM', forwardSigterm);
        console.error(`Failed to start subprocess: ${err.message}`);
        resolvePromise();
        process.exit(1);
      });
    });
  } finally {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true });
      } catch { /* ignore cleanup errors */ }
    }
  }
}

/**
 * Main CLI entry point for Node.js
 */
export async function main(): Promise<void> {
  const rt: CliRuntime = {
    version: () => melkerVersion(),
    args: () => getArgs(),
    cwd: () => cwd(),
    exit,
    resolvePath: (...segments: string[]) => resolve(...segments),
    dirnamePath: (path: string) => dirname(path),

    stat: (path: string) => fsStat(path),
    isNotFoundError: (error: unknown) => isNotFoundError(error),

    config: {
      reset: () => MelkerConfig.reset(),
      init: (options?) => MelkerConfig.init(options),
      get: () => MelkerConfig.get(),
      printConfig: () => MelkerConfig.printConfig(),
    },

    generateDenoFlags: (policy, appDir, urlHash, _sourceUrl, _activeDenies, _explicitDenies, isRemote) =>
      policyToNodeFlags(policy, appDir, MELKER_DIR, urlHash, isRemote),

    runApp,

    printUsage,
    handleSchema: async () => {
      const { main: runnerMain } = await import('./melker-runner.ts');
      await runnerMain();
      exit(0);
    },
    handleLsp: async () => {
      const { startLspServer } = await import('./lsp.ts');
      await startLspServer();
      exit(0);
    },
    handleExamples: () => {
      console.log('Showcase examples \u2014 run with melker or node:\n');
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
        console.log(`  melker-node https://melker.sh/examples/showcase/${name}.melker\n`);
      }
      console.log('More examples: https://github.com/wistrand/melker/tree/main/examples');
      exit(0);
    },
    handleInfo: async () => {
      console.log(`Melker ${melkerVersion()}`);
      console.log(`Node   ${runtimeVersion()}`);
      console.log('');
      const selfDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
      try {
        const { execSync } = await import('node:child_process');
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: selfDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        const commit = execSync('git rev-parse --short HEAD', { cwd: selfDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        console.log('Install:  git checkout');
        console.log(`Path:     ${selfDir}`);
        if (branch) console.log(`Branch:   ${branch}`);
        if (commit) console.log(`Commit:   ${commit}`);
      } catch {
        console.log('Install:  npm');
        console.log(`Path:     ${selfDir}`);
      }
      console.log(`Platform: ${platform()} ${arch()}`);
      exit(0);
    },
    handleUpgrade: async () => {
      console.error('To upgrade Melker on Node.js, use: npm update @melker/melker');
      exit(0);
    },

    denoFlagsLabel: 'Node permission flags:',
    showPolicyFlagsLabel: 'Node permission flags:',
    sandboxCaveat: 'Note: Node.js sandbox is coarser than Deno -- net and run are\n'
      + 'all-or-nothing, env/sys filtering unavailable, no deny flags.',

    handleVersion: () => {
      console.log(`Melker ${melkerVersion()}`);
      exit(0);
    },
  };

  await runCli(rt);
}
