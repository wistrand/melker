// Shared CLI logic for both Deno and Node entry points.
// Does NOT import runtime/mod.ts or framework code. Safe for the Deno
// launcher's security boundary and for Node's in-process model.

import { isUrl, loadContent } from './utils/content-loader.ts';
import { getTempDir } from './xdg.ts';

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
} from './policy/mod.ts';
import {
  getPermissionOverrides,
  applyPermissionOverrides,
  hasOverrides,
} from './policy/permission-overrides.ts';

import { parseCliFlags } from './config/cli.ts';

// ── CliRuntime Interface ──────────────────────────────────────────────────────

export interface CliRuntime {
  // Process
  version(): string;
  args(): string[];
  cwd(): string;
  exit(code?: number): never;
  resolvePath(...segments: string[]): string;
  dirnamePath(path: string): string;

  // File system
  stat(path: string): Promise<{ isFile: boolean }>;
  isNotFoundError(error: unknown): boolean;

  // Config (dependency-injected — avoids importing either config module)
  config: {
    reset(): void;
    init(options?: {
      policyConfig?: Record<string, unknown>;
      policyConfigSchema?: any;
      cliFlags?: Record<string, unknown>;
    }): void;
    get(): any;
    printConfig(): void;
  };

  // Deno flags — Deno: calls policyToDenoFlags(); Node: returns []
  generateDenoFlags(
    policy: MelkerPolicy, appDir: string, urlHash: string,
    sourceUrl?: string, activeDenies?: unknown, explicitDenies?: unknown,
    isRemote?: boolean,
  ): string[];

  // App execution — Deno: spawns subprocess; Node: calls runner in-process
  runApp(
    filepath: string, policy: MelkerPolicy, args: string[],
    remoteContent?: string,
  ): Promise<void>;

  // Runtime-specific handlers
  printUsage(): void;
  handleSchema(): Promise<void>;
  handleLsp(): Promise<void>;
  handleExamples(): void;
  handleInfo(): Promise<void>;
  handleUpgrade(): Promise<void>;

  // Display labels
  denoFlagsLabel: string;            // "Deno flags:" vs "Deno flags (informational):"
  showPolicyFlagsLabel: string;      // "Deno permission flags:" vs "...not enforced on Node"

  // Optional hooks
  checkRuntimeVersion?(): void;      // Deno checks >= 2.5
  handleVersion?(): void;            // Node prints version; Deno uses `info`
  postProcessShowPolicyFlags?(flags: string[]): void;  // Deno: addThemeFileReadPermission
}

// ── Shared Helpers ────────────────────────────────────────────────────────────

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
  return /%%\s*melker/i.test(content);
}

/**
 * Print sextant character test pattern
 */
function printSextantTest(): void {
  console.log(`
=== Sextant Character Test ===

Plain (no ANSI):     \u{1FB00}\u{1FB01}\u{1FB02}\u{1FB03}\u{1FB04}\u{1FB05}\u{1FB06}\u{1FB07}\u{1FB08}\u{1FB09}\u{1FB0A}\u{1FB0B}\u{1FB0C}\u{1FB0D}\u{1FB0E}\u{1FB0F}

With FG color:       \x1b[38;2;255;255;0m\u{1FB00}\u{1FB01}\u{1FB02}\u{1FB03}\u{1FB04}\u{1FB05}\u{1FB06}\u{1FB07}\u{1FB08}\u{1FB09}\u{1FB0A}\u{1FB0B}\u{1FB0C}\u{1FB0D}\u{1FB0E}\u{1FB0F}\x1b[0m

With BG color:       \x1b[48;2;0;0;128m\u{1FB00}\u{1FB01}\u{1FB02}\u{1FB03}\u{1FB04}\u{1FB05}\u{1FB06}\u{1FB07}\u{1FB08}\u{1FB09}\u{1FB0A}\u{1FB0B}\u{1FB0C}\u{1FB0D}\u{1FB0E}\u{1FB0F}\x1b[0m

With FG+BG:          \x1b[38;2;255;255;0m\x1b[48;2;0;0;128m\u{1FB00}\u{1FB01}\u{1FB02}\u{1FB03}\u{1FB04}\u{1FB05}\u{1FB06}\u{1FB07}\u{1FB08}\u{1FB09}\u{1FB0A}\u{1FB0B}\u{1FB0C}\u{1FB0D}\u{1FB0E}\u{1FB0F}\x1b[0m

Reset before each:   \x1b[0m\x1b[38;2;255;0;0m\u{1FB00}\x1b[0m\x1b[38;2;0;255;0m\u{1FB01}\x1b[0m\x1b[38;2;0;0;255m\u{1FB02}\x1b[0m\x1b[38;2;255;255;0m\u{1FB03}\x1b[0m\x1b[38;2;255;0;255m\u{1FB04}\x1b[0m\x1b[38;2;0;255;255m\u{1FB05}\x1b[0m

If all rows show the same sequence of sextant characters (U+1FB00-U+1FB0F),
your terminal supports sextant mode. If any row appears scrambled, use:
  MELKER_GFX_MODE=iterm2  (if your terminal supports iTerm2 protocol)
  MELKER_GFX_MODE=block   (universal fallback)
`);
}

// ── Shared Sub-Handlers ───────────────────────────────────────────────────────

async function handlePrintConfig(rt: CliRuntime, args: string[]): Promise<never> {
  const { flags: cliFlags, remaining } = parseCliFlags(args);
  const fileIndex = remaining.findIndex(arg => !arg.startsWith('--'));
  const filepath = fileIndex >= 0 ? remaining[fileIndex] : undefined;

  let policyConfig: Record<string, unknown> = {};
  let policyConfigSchema: any;
  if (filepath && (filepath.endsWith('.melker') || filepath.endsWith('.md') || filepath.endsWith('.mmd'))) {
    try {
      const absolutePath = filepath.startsWith('/') || isUrl(filepath)
        ? filepath
        : rt.resolvePath(rt.cwd(), filepath);
      const policyResult = isUrl(filepath)
        ? await loadPolicyFromContent(await loadContent(filepath), filepath)
        : await loadPolicy(absolutePath);
      if (policyResult.policy?.config || policyResult.policy?.configSchema) {
        policyConfig = policyResult.policy.config ?? {};
        policyConfigSchema = policyResult.policy.configSchema;
        console.log(`Policy config from: ${policyResult.source}${policyResult.path ? ` (${policyResult.path})` : ''}\n`);
      }
    } catch {
      // Ignore errors - just print config without policy
    }
  }

  rt.config.reset();
  rt.config.init({ policyConfig, policyConfigSchema, cliFlags });
  rt.config.printConfig();
  rt.exit(0);
}

async function handleRevokeApproval(rt: CliRuntime, args: string[]): Promise<never> {
  const revokeIndex = args.indexOf('--revoke-approval');
  const target = args[revokeIndex + 1];
  if (!target || target.startsWith('--')) {
    console.error('Error: --revoke-approval requires a path or URL argument');
    rt.exit(1);
  }
  const lookupPath = isUrl(target) ? target : rt.resolvePath(rt.cwd(), target);
  const revoked = await revokeApproval(lookupPath);
  if (revoked) {
    console.log(`Revoked approval for: ${target}`);
  } else {
    console.log(`No approval found for: ${target}`);
  }
  rt.exit(0);
}

async function handleShowApproval(rt: CliRuntime, args: string[]): Promise<never> {
  const showApprovalIndex = args.indexOf('--show-approval');
  const target = args[showApprovalIndex + 1];
  if (!target || target.startsWith('--')) {
    console.error('Error: --show-approval requires a path or URL argument');
    rt.exit(1);
  }
  const targetIsUrl = isUrl(target);
  const lookupPath = targetIsUrl ? target : rt.resolvePath(rt.cwd(), target);
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
    console.log(`\n${rt.denoFlagsLabel}`);
    console.log(formatDenoFlags(record.denoFlags));
  } else {
    console.log(`\nNo approval found for: ${target}\n`);

    if (!targetIsUrl) {
      try {
        const fileStat = await rt.stat(lookupPath);
        if (fileStat.isFile) {
          console.log('Local app has not been approved yet.');
          console.log('Run the app to trigger the approval prompt.\n');
          try {
            const result = await loadPolicy(lookupPath);
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
        if (rt.isNotFoundError(e)) {
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
  rt.exit(0);
}

async function handleShowPolicy(
  rt: CliRuntime,
  filepath: string,
  absoluteFilepath: string,
): Promise<never> {
  let policy: MelkerPolicy;
  let sourceLabel: string;
  let sourceUrl: string | undefined;
  const remote = isUrl(filepath);

  if (remote) {
    const content = await loadContent(filepath);
    if (!hasPolicyTag(content)) {
      console.log('\nNo policy found in remote file.');
      console.log('Remote .melker files must contain a <policy> tag.');
      rt.exit(0);
    }
    const r = await loadPolicyFromContent(content, filepath);
    policy = r.policy ?? createAutoPolicy(filepath);
    sourceLabel = r.source;
    sourceUrl = filepath;
  } else if (filepath.endsWith('.mmd') && !hasMelkerDirectives(await loadContent(filepath))) {
    policy = createEmptyMermaidPolicy(filepath);
    sourceLabel = 'auto (plain mermaid file)';
  } else {
    const r = await loadPolicy(absoluteFilepath);
    policy = r.policy ?? createAutoPolicy(absoluteFilepath);
    sourceLabel = r.policy ? `${r.source}${r.path ? ` (${r.path})` : ''}` : 'auto';
  }

  // Apply CLI overrides and print
  const overrides = getPermissionOverrides(rt.config.get());
  const hasCliOverrides = hasOverrides(overrides);
  const { permissions: effectivePermissions, activeDenies } = applyPermissionOverrides(policy.permissions, overrides);
  const effectivePolicy = { ...policy, permissions: effectivePermissions };

  console.log(`\nPolicy source: ${sourceLabel}${hasCliOverrides ? ' + CLI overrides' : ''}\n`);
  console.log(formatPolicy(effectivePolicy, sourceUrl));
  if (hasCliOverrides) {
    console.log('\nCLI overrides:');
    for (const line of formatOverrides(overrides)) {
      console.log(line);
    }
  }
  console.log(`\n${rt.showPolicyFlagsLabel}`);
  const appDir = remote ? getTempDir() : rt.dirnamePath(absoluteFilepath);
  const urlHash = await getUrlHash(remote ? filepath : absoluteFilepath);
  const flags = rt.generateDenoFlags(effectivePolicy, appDir, urlHash, sourceUrl, activeDenies, overrides.deny, remote);
  rt.postProcessShowPolicyFlags?.(flags);
  console.log(formatDenoFlags(flags));
  rt.exit(0);
}

async function handleRemoteFile(
  rt: CliRuntime,
  filepath: string,
  args: string[],
): Promise<void> {
  const content = await loadContent(filepath);

  // Mandatory policy for remote files
  if (!hasPolicyTag(content)) {
    console.error('\x1b[31mError: Remote .melker files must contain a <policy> tag.\x1b[0m');
    console.error('\nRemote files require explicit permission declarations for security.');
    console.error('Use --trust to bypass this check (dangerous).');
    rt.exit(1);
  }

  // Load and validate policy
  const policyResult = await loadPolicyFromContent(content, filepath);
  if (!policyResult.policy) {
    console.error('\x1b[31mError: Failed to parse policy from remote file.\x1b[0m');
    rt.exit(1);
  }

  const policy = policyResult.policy;
  const errors = validatePolicy(policy);
  if (errors.length > 0) {
    console.error('Policy validation errors:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    rt.exit(1);
  }

  // Generate Deno flags and check approval
  const urlHash = await getUrlHash(filepath);
  const denoFlags = rt.generateDenoFlags(policy, getTempDir(), urlHash, filepath, undefined, undefined, true);
  const isApproved = await checkApproval(filepath, content, policy, denoFlags);

  if (!isApproved) {
    const promptOverrides = getPermissionOverrides(rt.config.get());
    const approved = await showApprovalPrompt(filepath, policy, hasOverrides(promptOverrides) ? promptOverrides : undefined);
    if (!approved) {
      console.log('\nPermission denied. Exiting.');
      rt.exit(0);
    }
    await saveApproval(filepath, content, policy, denoFlags);
    const approvalFile = await getApprovalFilePath(filepath);
    console.log(`Approval saved: ${approvalFile}\n`);
  }

  await rt.runApp(filepath, policy, args, content);
}

async function handleLocalFile(
  rt: CliRuntime,
  filepath: string,
  absoluteFilepath: string,
  args: string[],
): Promise<void> {
  const policyResult = await loadPolicy(absoluteFilepath);
  const policy = policyResult.policy ?? createAutoPolicy(absoluteFilepath);
  const urlHash = await getUrlHash(absoluteFilepath);
  const denoFlags = rt.generateDenoFlags(policy, rt.dirnamePath(absoluteFilepath), urlHash);

  // Validate policy if present
  if (policyResult.policy) {
    const errors = validatePolicy(policyResult.policy);
    if (errors.length > 0) {
      console.error('Policy validation errors:');
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
      rt.exit(1);
    }
  }

  // Local file approval check (compares policy hash - code changes ok, policy changes re-approve)
  const isApproved = await checkLocalApproval(absoluteFilepath, policy);

  if (!isApproved) {
    const promptOverrides = getPermissionOverrides(rt.config.get());
    const approved = await showApprovalPrompt(absoluteFilepath, policy, hasOverrides(promptOverrides) ? promptOverrides : undefined);
    if (!approved) {
      console.log('\nPermission denied. Exiting.');
      rt.exit(0);
    }
    await saveLocalApproval(absoluteFilepath, policy, denoFlags);
    const approvalFile = await getApprovalFilePath(absoluteFilepath);
    console.log(`Approval saved: ${approvalFile}\n`);
  }

  await rt.runApp(absoluteFilepath, policy, args);
}

// ── Main CLI Flow ─────────────────────────────────────────────────────────────

export async function runCli(rt: CliRuntime): Promise<void> {
  const args = rt.args();

  rt.checkRuntimeVersion?.();

  if (args.length === 0) {
    rt.printUsage();
    rt.exit(0);
  }

  if (args.includes('--help') || args.includes('-h')) {
    rt.printUsage();
    rt.exit(0);
  }

  if (rt.handleVersion && args.includes('--version')) {
    rt.handleVersion();
  }

  // Handle --test-sextant option (prints sextant test pattern and exits)
  if (args.includes('--test-sextant')) {
    printSextantTest();
    rt.exit(0);
  }

  // Handle --schema option (delegates to runtime-specific handler)
  if (args.includes('--schema')) {
    await rt.handleSchema();
  }

  // Handle --lsp option
  if (args.includes('--lsp')) {
    await rt.handleLsp();
  }

  // Handle --print-config
  if (args.includes('--print-config')) {
    await handlePrintConfig(rt, args);
  }

  // Handle --clear-approvals
  if (args.includes('--clear-approvals')) {
    const count = await clearAllApprovals();
    console.log(`Cleared ${count} cached approval${count !== 1 ? 's' : ''}.`);
    rt.exit(0);
  }

  // Handle 'examples' subcommand
  if (args.includes('examples')) {
    rt.handleExamples();
  }

  // Handle 'info' subcommand
  if (args.includes('info')) {
    await rt.handleInfo();
  }

  // Handle 'upgrade' subcommand
  if (args.includes('upgrade')) {
    await rt.handleUpgrade();
  }

  // Handle --revoke-approval <path>
  if (args.indexOf('--revoke-approval') >= 0) {
    await handleRevokeApproval(rt, args);
  }

  // Handle --show-approval <path>
  if (args.indexOf('--show-approval') >= 0) {
    await handleShowApproval(rt, args);
  }

  // Parse schema-driven CLI flags to get remaining args (file path, etc.)
  const { flags: cliFlags, remaining: remainingArgs } = parseCliFlags(args);

  // Initialize config with CLI flags (for permission overrides)
  rt.config.reset();
  rt.config.init({ cliFlags });

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
    rt.exit(1);
  }

  // Validate file extension
  if (!filepath.endsWith('.melker') && !filepath.endsWith('.md') && !filepath.endsWith('.mmd')) {
    console.error('Error: File must have .melker, .md, or .mmd extension');
    rt.exit(1);
  }

  // Check watch mode with URLs
  if (options.watch && isUrl(filepath)) {
    console.error('Error: --watch is not supported for URLs');
    rt.exit(1);
  }

  const absoluteFilepath = filepath.startsWith('/') || isUrl(filepath)
    ? filepath
    : rt.resolvePath(rt.cwd(), filepath);

  try {
    // Check if file exists (skip for URLs)
    if (!isUrl(filepath)) {
      await rt.stat(filepath);
    }

    // Handle --show-policy flag
    if (options.showPolicy) {
      await handleShowPolicy(rt, filepath, absoluteFilepath);
    }

    // Remote file security checks (unless --trust)
    if (isUrl(filepath) && !options.trust) {
      await handleRemoteFile(rt, filepath, args);
      return;
    }

    // Plain .mmd files without %%melker directives - run with empty policy, no approval needed
    if (!isUrl(filepath) && filepath.endsWith('.mmd')) {
      const content = await loadContent(filepath);
      if (!hasMelkerDirectives(content)) {
        await rt.runApp(absoluteFilepath, createEmptyMermaidPolicy(filepath), args);
        return;
      }
    }

    // Local file approval and policy enforcement (unless --trust)
    if (!isUrl(filepath) && !options.trust) {
      await handleLocalFile(rt, filepath, absoluteFilepath, args);
      return;
    }

    // --trust mode: run with full permissions
    await rt.runApp(absoluteFilepath, createAutoPolicy(absoluteFilepath), args);

  } catch (error) {
    if (rt.isNotFoundError(error)) {
      console.error(`Error: File not found: ${filepath}`);
    } else {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    rt.exit(1);
  }
}
