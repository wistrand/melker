// Node.js CLI for Melker
// Thin wrapper — delegates shared CLI logic to cli-shared.ts.
// Keeps only Node-specific: printUsage, runApp, handler implementations.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cwd,
  args as getArgs,
  exit,
  platform,
  arch,
  runtimeVersion,
  melkerVersion,
  envSet,
  stat as fsStat,
  isNotFoundError,
} from './runtime/mod.ts';

import { type MelkerPolicy } from './policy/mod.ts';
import {
  getPermissionOverrides,
  hasOverrides,
} from './policy/permission-overrides.ts';

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

/**
 * Run a .melker app in the current process via the runner's main().
 * Sets env vars the runner expects, then calls main() directly.
 */
async function runApp(
  filepath: string,
  _policy: MelkerPolicy,
  _args: string[],
  remoteContent?: string,
): Promise<void> {
  const isRemote = remoteContent !== undefined;
  envSet('MELKER_RUNNER', '1');
  if (isRemote) {
    envSet('MELKER_REMOTE_URL', filepath);
  }

  // Set permission overrides env var if applicable
  const overrides = getPermissionOverrides(MelkerConfig.get());
  if (hasOverrides(overrides)) {
    envSet('MELKER_PERMISSION_OVERRIDES', JSON.stringify(overrides));
  }

  // Import and call runner main
  const { main } = await import('./melker-runner.ts');
  await main();
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

    generateDenoFlags: () => [],

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
      console.error('To upgrade Melker on Node.js, use: npm update @melker/core');
      exit(0);
    },

    denoFlagsLabel: 'Deno flags (informational):',
    showPolicyFlagsLabel: 'Deno permission flags (informational \u2014 not enforced on Node):',

    handleVersion: () => {
      console.log(`Melker ${melkerVersion()}`);
      exit(0);
    },
  };

  await runCli(rt);
}
