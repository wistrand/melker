// Approval cache for remote .melker files
// Stores user approvals based on content + policy + deno flags hash

import { getCacheDir, ensureDir } from '../xdg.ts';
import type { MelkerPolicy } from './types.ts';

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
 * Hash a string using SHA-256
 */
async function hashString(input: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
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
  // Sort policy keys for consistent serialization
  const policyJson = JSON.stringify(resolvedPolicy, Object.keys(resolvedPolicy).sort());
  // Sort flags for consistent ordering
  const flagsStr = denoFlags.slice().sort().join(' ');

  const combined = [
    content,
    '---POLICY---',
    policyJson,
    '---DENO-FLAGS---',
    flagsStr
  ].join('\n');

  return await hashString(combined);
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
    const json = await Deno.readTextFile(filePath);
    const record: ApprovalRecord = JSON.parse(json);

    // Calculate current hash
    const currentHash = await calculateApprovalHash(content, policy, denoFlags);

    // Check if hash matches
    return record.hash === currentHash;
  } catch {
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

  const filePath = await getApprovalFilePath(url);
  await Deno.writeTextFile(filePath, JSON.stringify(record, null, 2));
}

/**
 * Format policy permissions for display in approval prompt
 */
function formatPolicyPermissions(policy: MelkerPolicy): string[] {
  const lines: string[] = [];
  const p = policy.permissions || {};

  if (p.all) {
    lines.push('  \x1b[31mALL PERMISSIONS\x1b[0m (--allow-all)');
    return lines;
  }

  if (p.read?.length) {
    lines.push(`  read: ${p.read.join(', ')}`);
  }
  if (p.write?.length) {
    lines.push(`  write: ${p.write.join(', ')}`);
  }
  if (p.net?.length) {
    lines.push(`  net: ${p.net.join(', ')}`);
  }
  if (p.run?.length) {
    lines.push(`  run: ${p.run.join(', ')}`);
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
  if (p.ai) {
    lines.push('  ai: enabled');
  }
  if (p.clipboard) {
    lines.push('  clipboard: enabled');
  }
  if (p.keyring) {
    lines.push('  keyring: enabled');
  }
  if (p.browser) {
    lines.push('  browser: enabled');
  }
  if (p.shader) {
    lines.push('  shader: enabled');
  }

  return lines;
}

/**
 * Show approval prompt to user using Deno.confirm()
 * Returns true if user approves, false if denied
 */
export function showApprovalPrompt(
  url: string,
  policy: MelkerPolicy
): boolean {
  // Check if stdin is a TTY - if not, we can't prompt
  if (!Deno.stdin.isTerminal()) {
    console.error('\x1b[31mError: Cannot prompt for approval - stdin is not a terminal.\x1b[0m');
    console.error('Use --trust to run remote apps in non-interactive mode.');
    return false;
  }

  if(url.startsWith("file:")) {
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

  const permLines = formatPolicyPermissions(policy);
  console.log('\nRequested permissions:');
  if (permLines.length === 0) {
    console.log('  (no permissions requested)');
  } else {
    for (const line of permLines) {
      console.log(line);
    }
  }
  console.log('');

  return confirm('Allow this app to run with these permissions?');
}

/**
 * Get the approval file path for a URL (public for printing location)
 * Uses first 12 characters of SHA-256 hash for shorter filenames
 */
export async function getApprovalFilePath(url: string): Promise<string> {
  const urlHash = await hashString(url);
  return `${getApprovalsDir()}/${urlHash.slice(0, 12)}.json`;
}

/**
 * Clear all cached approvals
 */
export async function clearAllApprovals(): Promise<number> {
  const approvalsDir = getApprovalsDir();
  let count = 0;

  try {
    for await (const entry of Deno.readDir(approvalsDir)) {
      if (entry.isFile && entry.name.endsWith('.json')) {
        await Deno.remove(`${approvalsDir}/${entry.name}`);
        count++;
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
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
    await Deno.remove(filePath);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
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
    const json = await Deno.readTextFile(filePath);
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
  const policyJson = JSON.stringify(policy, Object.keys(policy).sort());
  return await hashString(policyJson);
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
    const json = await Deno.readTextFile(filePath);
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
  const filePath = await getApprovalFilePath(filepath);
  await Deno.writeTextFile(filePath, JSON.stringify(record, null, 2));
}
