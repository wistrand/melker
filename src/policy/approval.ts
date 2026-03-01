// Approval cache for remote .melker files
// Stores user approvals based on content + policy + deno flags hash

import { getCacheDir, ensureDir, getAppCacheDir } from '../xdg.ts';
import { sha256Hex } from '../utils/crypto.ts';
import { cwd, readTextFile, writeTextFile, readDir, remove, isNotFoundError, stdin } from '../runtime/mod.ts';
import type { MelkerPolicy } from './types.ts';
import { extractHostFromUrl } from './url-utils.ts';
import { isUrl } from '../utils/content-loader.ts';
import {
  getAvailableClipboardCommands,
  getAvailableKeyringCommands,
  getAvailableAICommands,
  getBrowserCommand,
  AI_NET_HOSTS,
} from './flags.ts';
import type { PermissionOverrides } from './permission-overrides.ts';

/**
 * Approval record stored in cache
 */
export interface ApprovalRecord {
  /** The URL of the approved app */
  url: string;
  /** Combined hash of content + policy + deno flags */
  hash: string;
  /** ISO timestamp when approved */
  approvedAt: string;
  /** The resolved policy at time of approval */
  policy: MelkerPolicy;
  /** The Deno permission flags at time of approval */
  denoFlags: string[];
}

/**
 * Get the approvals directory path
 */
function getApprovalsDir(): string {
  return `${getCacheDir()}/approvals`;
}

/**
 * Get the URL hash used for approval files and cache directories.
 * Returns first 12 characters of SHA-256 hash for shorter, unique identifiers.
 */
export async function getUrlHash(url: string): Promise<string> {
  const fullHash = await sha256Hex(url);
  return fullHash.slice(0, 12);
}

/**
 * Create the app-specific cache directory for a URL/filepath.
 * Called during approval to ensure the cache dir exists before the app runs.
 */
async function createAppCacheDir(url: string): Promise<void> {
  const urlHash = await getUrlHash(url);
  const cacheDir = getAppCacheDir(urlHash);
  await ensureDir(cacheDir);
}

/**
 * Recursively sort object keys for consistent JSON serialization
 */
function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Calculate approval hash from content, resolved policy, and Deno flags
 *
 * This hash changes if:
 * - The app content changes
 * - The policy changes (including env var values)
 * - The Melker runtime changes how it interprets policies (different flags)
 */
export async function calculateApprovalHash(
  content: string,
  resolvedPolicy: MelkerPolicy,
  denoFlags: string[]
): Promise<string> {
  // Sort policy keys recursively for consistent serialization
  const sortedPolicy = sortObjectKeys(resolvedPolicy);
  const policyJson = JSON.stringify(sortedPolicy);
  // Sort flags for consistent ordering
  const flagsStr = denoFlags.slice().sort().join(' ');

  const combined = [
    content,
    '---POLICY---',
    policyJson,
    '---DENO-FLAGS---',
    flagsStr
  ].join('\n');

  return  await sha256Hex(combined);
}

/**
 * Check if a remote app has been approved with the current hash
 */
export async function checkApproval(
  url: string,
  content: string,
  policy: MelkerPolicy,
  denoFlags: string[]
): Promise<boolean> {
  try {

    const filePath = await getApprovalFilePath(url);
    const json = await readTextFile(filePath);
    const record: ApprovalRecord = JSON.parse(json);

    // Calculate current hash
    const currentHash = await calculateApprovalHash(content, policy, denoFlags);

    // Check if hash matches
    return record.hash === currentHash;
  } catch (e) {
    // File doesn't exist or is invalid - not approved
    return false;
  }
}

/**
 * Save approval for a remote app
 */
export async function saveApproval(
  url: string,
  content: string,
  policy: MelkerPolicy,
  denoFlags: string[]
): Promise<void> {
  const hash = await calculateApprovalHash(content, policy, denoFlags);

  const record: ApprovalRecord = {
    url,
    hash,
    approvedAt: new Date().toISOString(),
    policy,
    denoFlags,
  };

  // Ensure approvals directory exists
  await ensureDir(getApprovalsDir());

  // Create app-specific cache directory
  await createAppCacheDir(url);

  const filePath = await getApprovalFilePath(url);
  await writeTextFile(filePath, JSON.stringify(record, null, 2));
}

/**
 * Format policy permissions for display in approval prompt
 */
function formatPolicyPermissions(policy: MelkerPolicy, sourceUrl?: string): string[] {
  const lines: string[] = [];
  const p = policy.permissions || {};

  if (p.all) {
    lines.push('  \x1b[31mALL PERMISSIONS\x1b[0m (--allow-all)');
    return lines;
  }

  if (p.read?.length) {
    // Expand "cwd" to show actual path
    const readDisplay = p.read.map(entry => {
      if (entry === 'cwd') {
        try {
          return `cwd (${cwd()})`;
        } catch {
          return 'cwd';
        }
      }
      return entry;
    });
    lines.push(`  read: ${readDisplay.join(', ')}`);
  }
  if (p.write?.length) {
    // Expand "cwd" to show actual path
    const writeDisplay = p.write.map(entry => {
      if (entry === 'cwd') {
        try {
          return `cwd (${cwd()})`;
        } catch {
          return 'cwd';
        }
      }
      return entry;
    });
    lines.push(`  write: ${writeDisplay.join(', ')}`);
  }
  // Collect commands/hosts derived from shortcuts (to filter from run:/net: lines)
  const shortcutRunCommands = new Set<string>();
  const shortcutNetHosts = new Set<string>();

  // Get available commands for each shortcut
  const clipboardCmds = p.clipboard ? getAvailableClipboardCommands() : [];
  const keyringCmds = p.keyring ? getAvailableKeyringCommands() : [];
  const aiCmds = p.ai ? getAvailableAICommands() : [];
  const browserCmd = p.browser ? getBrowserCommand() : null;

  clipboardCmds.forEach(cmd => shortcutRunCommands.add(cmd));
  keyringCmds.forEach(cmd => shortcutRunCommands.add(cmd));
  aiCmds.forEach(cmd => shortcutRunCommands.add(cmd));
  if (browserCmd) shortcutRunCommands.add(browserCmd);
  if (p.ai) AI_NET_HOSTS.forEach(host => shortcutNetHosts.add(host));

  if (p.net?.length) {
    // Expand "samesite" to show actual host, filter shortcut-derived hosts
    const sourceHost = sourceUrl ? extractHostFromUrl(sourceUrl) : null;
    const netDisplay = p.net
      .filter(entry => !shortcutNetHosts.has(entry))
      .map(entry => {
        if (entry === 'samesite' && sourceHost) {
          return `samesite (${sourceHost})`;
        }
        return entry;
      });
    if (netDisplay.length > 0) {
      lines.push(`  net: ${netDisplay.join(', ')}`);
    }
  }

  // Filter run commands that come from shortcuts
  if (p.run?.length) {
    const nonShortcutRun = p.run.filter(cmd => !shortcutRunCommands.has(cmd));
    if (nonShortcutRun.length > 0) {
      lines.push(`  run: ${nonShortcutRun.join(', ')}`);
    }
  }
  if (p.env?.length) {
    lines.push(`  env: ${p.env.join(', ')}`);
  }
  if (p.ffi?.length) {
    lines.push(`  ffi: ${p.ffi.join(', ')}`);
  }
  if (p.sys?.length) {
    lines.push(`  sys: ${p.sys.join(', ')}`);
  }
  // Show shortcuts with actual commands in parentheses
  if (p.ai) {
    const details = [...aiCmds, ...AI_NET_HOSTS].join(', ');
    lines.push(`  ai: enabled${details ? ` (${details})` : ''}`);
  }
  if (p.clipboard) {
    const details = clipboardCmds.join(', ');
    lines.push(`  clipboard: enabled${details ? ` (${details})` : ''}`);
  }
  if (p.keyring) {
    const details = keyringCmds.join(', ');
    lines.push(`  keyring: enabled${details ? ` (${details})` : ''}`);
  }
  if (p.browser) {
    lines.push(`  browser: enabled${browserCmd ? ` (${browserCmd})` : ''}`);
  }
  if (p.shader) {
    lines.push('  shader: enabled');
  }

  return lines;
}

/**
 * Format CLI permission overrides for display
 */
export function formatOverrides(overrides: PermissionOverrides): string[] {
  const lines: string[] = [];
  const { allow, deny } = overrides;

  // Format deny overrides
  if (deny.all) {
    lines.push('  --deny-all (all permissions will be removed)');
  }
  if (deny.read?.length) {
    lines.push(`  --deny-read=${deny.read.join(',')}`);
  }
  if (deny.write?.length) {
    lines.push(`  --deny-write=${deny.write.join(',')}`);
  }
  if (deny.net?.length) {
    lines.push(`  --deny-net=${deny.net.join(',')}`);
  }
  if (deny.run?.length) {
    lines.push(`  --deny-run=${deny.run.join(',')}`);
  }
  if (deny.env?.length) {
    lines.push(`  --deny-env=${deny.env.join(',')}`);
  }
  if (deny.ai) {
    lines.push('  --deny-ai');
  }
  if (deny.clipboard) {
    lines.push('  --deny-clipboard');
  }
  if (deny.keyring) {
    lines.push('  --deny-keyring');
  }
  if (deny.browser) {
    lines.push('  --deny-browser');
  }
  if (deny.shader) {
    lines.push('  --deny-shader');
  }

  // Format allow overrides
  if (allow.all) {
    lines.push('  --allow-all (all permissions will be granted)');
  }
  if (allow.read?.length) {
    lines.push(`  --allow-read=${allow.read.join(',')}`);
  }
  if (allow.write?.length) {
    lines.push(`  --allow-write=${allow.write.join(',')}`);
  }
  if (allow.net?.length) {
    lines.push(`  --allow-net=${allow.net.join(',')}`);
  }
  if (allow.run?.length) {
    lines.push(`  --allow-run=${allow.run.join(',')}`);
  }
  if (allow.env?.length) {
    lines.push(`  --allow-env=${allow.env.join(',')}`);
  }
  if (allow.ai) {
    lines.push('  --allow-ai');
  }
  if (allow.clipboard) {
    lines.push('  --allow-clipboard');
  }
  if (allow.keyring) {
    lines.push('  --allow-keyring');
  }
  if (allow.browser) {
    lines.push('  --allow-browser');
  }
  if (allow.shader) {
    lines.push('  --allow-shader');
  }

  return lines;
}

/**
 * Show approval prompt to user using Deno.confirm()
 * Returns true if user approves, false if denied
 */
export function showApprovalPrompt(
  url: string,
  policy: MelkerPolicy,
  overrides?: PermissionOverrides
): boolean {
  // Check if stdin is a TTY - if not, we can't prompt
  if (!stdin.isTerminal()) {
    console.error('\x1b[31mError: Cannot prompt for approval - stdin is not a terminal.\x1b[0m');
    console.error('Use --trust to run remote apps in non-interactive mode.');
    return false;
  }

  if (isUrl(url)) {
    console.log('\n\x1b[1mRemote App Permission Request\x1b[0m\n');
  } else {
    console.log('\n\x1b[1mLocal App Permission Request\x1b[0m\n');
  }
  console.log(`URL: ${url}`);

  if (policy.name) {
    console.log(`App: ${policy.name}${policy.version ? ' v' + policy.version : ''}`);
  }
  if (policy.description) {
    console.log(`Description: ${policy.description}`);
  }

  // Show comment if present (supports string or array of strings)
  if (policy.comment) {
    console.log('\n\x1b[36mComment:\x1b[0m');
    const comments = Array.isArray(policy.comment)
      ? policy.comment
      : policy.comment.split('\n');
    for (const line of comments) {
      console.log(`  ${line}`);
    }
  }

  const permLines = formatPolicyPermissions(policy, url);
  console.log('\nRequested permissions:');
  if (permLines.length === 0) {
    console.log('  (no permissions requested)');
  } else {
    for (const line of permLines) {
      console.log(line);
    }
  }

  // Show CLI overrides if present
  if (overrides) {
    const overrideLines = formatOverrides(overrides);
    if (overrideLines.length > 0) {
      console.log('\nCLI overrides (will modify permissions at runtime):');
      for (const line of overrideLines) {
        console.log(line);
      }
    }
  }
  console.log('');

  if (permLines.length === 0) {
    return confirm('Allow this app to run?');
  }
  return confirm('Allow this app to run with these permissions?');
}

/**
 * Get the approval file path for a URL (public for printing location)
 * Uses first 12 characters of SHA-256 hash for shorter filenames
 */
export async function getApprovalFilePath(url: string): Promise<string> {
  const urlHash = await sha256Hex(url);
  return `${getApprovalsDir()}/${urlHash.slice(0, 12)}.json`;
}

/**
 * Clear all cached approvals
 */
export async function clearAllApprovals(): Promise<number> {
  const approvalsDir = getApprovalsDir();
  let count = 0;

  try {
    for await (const entry of readDir(approvalsDir)) {
      if (entry.isFile && entry.name.endsWith('.json')) {
        await remove(`${approvalsDir}/${entry.name}`);
        count++;
      }
    }
  } catch (error) {
    if (!(isNotFoundError(error))) {
      throw error;
    }
  }

  return count;
}

/**
 * Revoke approval for a specific URL
 */
export async function revokeApproval(url: string): Promise<boolean> {
  try {
    const filePath = await getApprovalFilePath(url);
    await remove(filePath);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * Get approval record for a URL (for --show-approval)
 */
export async function getApproval(url: string): Promise<ApprovalRecord | null> {
  try {
    const filePath = await getApprovalFilePath(url);
    const json = await readTextFile(filePath);
    return JSON.parse(json) as ApprovalRecord;
  } catch {
    return null;
  }
}

/**
 * Calculate a hash of the policy for local approval comparison.
 * Only hashes the policy, not the file content - so code changes don't
 * trigger re-approval, but policy changes do.
 */
async function hashPolicy(policy: MelkerPolicy): Promise<string> {
  // Sort all keys recursively for consistent serialization
  const sortedPolicy = sortObjectKeys(policy);
  const policyJson = JSON.stringify(sortedPolicy);
  return await sha256Hex(policyJson);
}

/**
 * Check if a local file has been approved with the current policy.
 * Local approvals persist across file edits (code changes) but
 * policy changes trigger re-approval.
 */
export async function checkLocalApproval(
  filepath: string,
  currentPolicy: MelkerPolicy
): Promise<boolean> {
  try {
    const filePath = await getApprovalFilePath(filepath);
    const json = await readTextFile(filePath);
    const record: ApprovalRecord = JSON.parse(json);

    // Calculate current policy hash
    const currentHash = await hashPolicy(currentPolicy);

    // Compare with stored hash (supports old 'local' marker for backwards compat)
    if (record.hash === 'local') {
      // Old approval without policy hash - re-approve to get new format
      return false;
    }

    return record.hash === currentHash;
  } catch {
    return false;
  }
}

/**
 * Save approval for a local file with policy hash.
 * Hash is based on policy only (not file content) so code changes
 * don't require re-approval, but policy changes do.
 */
export async function saveLocalApproval(
  filepath: string,
  policy: MelkerPolicy,
  denoFlags: string[]
): Promise<void> {
  const policyHash = await hashPolicy(policy);

  const record: ApprovalRecord = {
    url: filepath,  // Using 'url' field for path
    hash: policyHash,  // Hash of policy for change detection
    approvedAt: new Date().toISOString(),
    policy,
    denoFlags,
  };

  await ensureDir(getApprovalsDir());

  // Create app-specific cache directory
  await createAppCacheDir(filepath);

  const filePath = await getApprovalFilePath(filepath);
  await writeTextFile(filePath, JSON.stringify(record, null, 2));
}
