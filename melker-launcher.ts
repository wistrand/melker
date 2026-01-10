// Minimal Melker Launcher
// Security-auditable entry point that handles policy enforcement and subprocess spawning.
// Does NOT import framework code - only policy module and std library.

import { dirname, resolve } from 'https://deno.land/std@0.208.0/path/mod.ts';

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
  type MelkerPolicy,
} from './src/policy/mod.ts';

// CLI parsing from schema
import { generateFlagHelp, parseCliFlags } from './src/config/cli.ts';
import { MelkerConfig } from './src/config/config.ts';

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
 * Check if a path is a URL (http:// or https://)
 */
function isUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
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
 * Create the default all-permissions policy used when no embedded policy is found
 */
function createAutoPolicy(): MelkerPolicy {
  return {
    name: 'Auto Policy',
    description: 'Default policy with all permissions (no embedded policy found)',
    permissions: {
      all: true,
    },
  };
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
  console.log('  deno run --allow-all melker.ts <file.melker> [options]');
  console.log('  deno run --allow-all melker.ts <file.md> [options]');
  console.log('');
  console.log('Arguments:');
  console.log('  <file.melker>  Path to a .melker template file');
  console.log('  <file.md>      Path to a markdown file with melker-block code blocks');
  console.log('');
  console.log('Options:');
  console.log('  --print-tree             Display element tree structure and exit');
  console.log('  --print-json             Display JSON serialization and exit');
  console.log('  --debug                  Show system info, debug script transpilation');
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
  // Add schema-driven config flags
  console.log(generateFlagHelp());
  console.log('');
  console.log('Policy system (permission sandboxing):');
  console.log('  Apps can declare permissions via embedded <policy> tag or .policy.json file.');
  console.log('  Use --show-policy to see what permissions an app requires.');
  console.log('  Use --trust to bypass policy enforcement (runs with full permissions).');
  console.log('');
  console.log('Examples:');
  console.log('  deno run --allow-all melker.ts examples/melker/counter.melker');
  console.log('  deno run --allow-all melker.ts --show-policy app.melker');
  console.log('  deno run --allow-all melker.ts --trust app.melker');
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

  // Convert policy to Deno permission flags
  const denoFlags = policyToDenoFlags(policy, appDir);

  // Required: --unstable-bundle for Deno.bundle() API
  denoFlags.push('--unstable-bundle');

  // Disable interactive permission prompts - fail fast instead of hanging
  denoFlags.push('--no-prompt');

  // Build the subprocess command - run melker-runner.ts
  const runnerUrl = new URL('./melker-runner.ts', import.meta.url);
  // Use href for remote URLs, pathname for local files
  const runnerEntry = runnerUrl.protocol === 'file:' ? runnerUrl.pathname : runnerUrl.href;

  // Filter out policy-related flags that shouldn't be passed to subprocess
  const filteredArgs = originalArgs.filter(arg =>
    !arg.startsWith('--show-policy') &&
    !arg.startsWith('--trust')
  );

  const cmd = [
    Deno.execPath(),
    'run',
    ...denoFlags,
    runnerEntry,
    ...filteredArgs,
  ];

  // Spawn subprocess with restricted permissions
  const process = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...Deno.env.toObject(),
      MELKER_RUNNER: '1', // Signal that policy has been checked
    },
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
  const tempDir = await Deno.makeTempDir({ prefix: 'melker-remote-' });
  const tempFile = `${tempDir}/app.melker`;
  await Deno.writeTextFile(tempFile, content);

  try {
    // Convert policy to Deno permission flags
    const denoFlags = policyToDenoFlags(policy, Deno.cwd());

    // Required: --unstable-bundle for Deno.bundle() API
    denoFlags.push('--unstable-bundle');

    // Disable interactive permission prompts
    denoFlags.push('--no-prompt');

    // Build the subprocess command
    const runnerUrl = new URL('./melker-runner.ts', import.meta.url);
    const runnerEntry = runnerUrl.protocol === 'file:' ? runnerUrl.pathname : runnerUrl.href;

    // Filter out policy-related flags and replace URL with temp file
    const filteredArgs: string[] = [];
    for (const arg of originalArgs) {
      if (arg.startsWith('--show-policy') || arg.startsWith('--trust')) {
        continue;
      }
      // Replace the URL with temp file path
      if (arg === url || arg.startsWith('http://') || arg.startsWith('https://')) {
        filteredArgs.push(tempFile);
      } else {
        filteredArgs.push(arg);
      }
    }

    const cmd = [
      Deno.execPath(),
      'run',
      ...denoFlags,
      runnerEntry,
      ...filteredArgs,
    ];

    // Spawn subprocess with restricted permissions
    const process = new Deno.Command(cmd[0], {
      args: cmd.slice(1),
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...Deno.env.toObject(),
        MELKER_RUNNER: '1',
        MELKER_REMOTE_URL: url, // Pass original URL for reference
      },
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

  // Handle --schema option (delegates to runner)
  if (args.includes('--schema')) {
    const runnerUrl = new URL('./melker-runner.ts', import.meta.url);
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

  // Handle --lsp option (delegates to runner)
  if (args.includes('--lsp')) {
    const runnerUrl = new URL('./melker-runner.ts', import.meta.url);
    const runnerEntry = runnerUrl.protocol === 'file:' ? runnerUrl.pathname : runnerUrl.href;
    const process = new Deno.Command(Deno.execPath(), {
      args: ['run', '--allow-all', '--unstable-bundle', runnerEntry, '--lsp'],
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
    if (filepath && (filepath.endsWith('.melker') || filepath.endsWith('.md'))) {
      try {
        const absolutePath = filepath.startsWith('/') || isUrl(filepath)
          ? filepath
          : resolve(Deno.cwd(), filepath);
        const policyResult = isUrl(filepath)
          ? await loadPolicyFromContent(await loadContent(filepath), filepath)
          : await loadPolicy(absolutePath);
        if (policyResult.policy?.config) {
          policyConfig = policyResult.policy.config;
          console.log(`Policy config from: ${policyResult.source}${policyResult.path ? ` (${policyResult.path})` : ''}\n`);
        }
      } catch {
        // Ignore errors - just print config without policy
      }
    }

    // Reset and re-init with policy config
    MelkerConfig.reset();
    MelkerConfig.init({ policyConfig, cliFlags });
    MelkerConfig.printConfig();
    Deno.exit(0);
  }

  // Handle --clear-approvals
  if (args.includes('--clear-approvals')) {
    const count = await clearAllApprovals();
    console.log(`Cleared ${count} cached approval${count !== 1 ? 's' : ''}.`);
    Deno.exit(0);
  }

  // Handle --revoke-approval <path>
  const revokeIndex = args.indexOf('--revoke-approval');
  if (revokeIndex >= 0) {
    const target = args[revokeIndex + 1];
    if (!target || target.startsWith('--')) {
      console.error('Error: --revoke-approval requires a path or URL argument');
      Deno.exit(1);
    }
    const revoked = await revokeApproval(target);
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
    const record = await getApproval(target);
    if (record) {
      const approvalFile = await getApprovalFilePath(target);
      console.log(`\nApproval record for: ${target}\n`);
      console.log(`File: ${approvalFile}`);
      console.log(`Approved: ${record.approvedAt}`);
      console.log(`Hash: ${record.hash.substring(0, 16)}...`);
      console.log('\nPolicy:');
      console.log(formatPolicy(record.policy));
      console.log('\nDeno flags:');
      console.log(formatDenoFlags(record.denoFlags));
    } else {
      console.log(`No approval found for: ${target}`);
    }
    Deno.exit(0);
  }

  // Parse schema-driven CLI flags to get remaining args (file path, etc.)
  const { remaining: remainingArgs } = parseCliFlags(args);

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
    console.error('Error: No .melker or .md file specified');
    console.error('Use --help for usage information');
    Deno.exit(1);
  }

  // Validate file extension
  if (!filepath.endsWith('.melker') && !filepath.endsWith('.md')) {
    console.error('Error: File must have .melker or .md extension');
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
      if (isUrl(filepath)) {
        const content = await loadContent(filepath);
        if (!hasPolicyTag(content)) {
          console.log('\nNo policy found in remote file.');
          console.log('Remote .melker files must contain a <policy> tag.');
          Deno.exit(0);
        }
        const policyResult = await loadPolicyFromContent(content, filepath);
        const policy = policyResult.policy ?? createAutoPolicy();
        console.log(`\nPolicy source: ${policyResult.source}\n`);
        console.log(formatPolicy(policy));
        console.log('\nDeno permission flags:');
        const flags = policyToDenoFlags(policy, Deno.cwd());
        console.log(formatDenoFlags(flags));
      } else {
        const policyResult = await loadPolicy(absoluteFilepath);
        const policy = policyResult.policy ?? createAutoPolicy();
        const source = policyResult.policy ? policyResult.source : 'auto';
        console.log(`\nPolicy source: ${source}${policyResult.path ? ` (${policyResult.path})` : ''}\n`);
        console.log(formatPolicy(policy));
        console.log('\nDeno permission flags:');
        const flags = policyToDenoFlags(policy, dirname(absoluteFilepath));
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
      const denoFlags = policyToDenoFlags(policy, Deno.cwd());
      const isApproved = await checkApproval(filepath, content, policy, denoFlags);

      if (!isApproved) {
        const approved = showApprovalPrompt(filepath, policy);
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

    // Local file approval and policy enforcement (unless --trust)
    if (!isUrl(filepath) && !options.trust) {
      const policyResult = await loadPolicy(absoluteFilepath);
      const policy = policyResult.policy ?? createAutoPolicy();
      const denoFlags = policyToDenoFlags(policy, dirname(absoluteFilepath));

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

      // Local file approval check
      const isApproved = await checkLocalApproval(absoluteFilepath);

      if (!isApproved) {
        const approved = showApprovalPrompt(absoluteFilepath, policy);
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
    await runWithPolicy(absoluteFilepath, createAutoPolicy(), args);

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
