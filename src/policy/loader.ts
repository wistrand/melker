// Policy loader - loads policy from embedded tag or external file

import { dirname, resolve } from '../deps.ts';
import type { MelkerPolicy, PolicyLoadResult } from './types.ts';
import { Env } from '../env.ts';
import { extractHostFromUrl } from './url-utils.ts';

/**
 * Extract policy from markdown JSON block with "@melker": "policy"
 */
function extractPolicyFromMarkdown(content: string): MelkerPolicy | null {
  // Find JSON code blocks
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)```/g;
  let match;

  while ((match = jsonBlockRegex.exec(content)) !== null) {
    const jsonContent = match[1].trim();
    try {
      const parsed = JSON.parse(jsonContent);
      // Check if this is a policy block
      if (parsed && typeof parsed === 'object' && parsed['@melker'] === 'policy') {
        // Remove the @melker marker and return the policy
        const { '@melker': _, ...policy } = parsed;
        return policy as MelkerPolicy;
      }
    } catch {
      // Not valid JSON or not a policy block, continue
    }
  }

  return null;
}

// WellKnown config fields that contain URLs
interface WellKnownConfig {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
}

/**
 * Load policy for a .melker app
 *
 * Supports:
 * 1. Embedded <policy>{...json...}</policy> tag
 * 2. External file via <policy src="path/to/policy.json"></policy>
 * 3. Markdown JSON block with "@melker": "policy" (for .md files)
 *
 * @param appPath Path to the .melker file
 * @returns Policy load result with policy (or null) and source
 */
export async function loadPolicy(appPath: string): Promise<PolicyLoadResult> {
  try {
    const content = await Deno.readTextFile(appPath);
    const appDir = dirname(appPath);
    const hasOAuth = hasOAuthTag(content);

    // Check for markdown policy format first (for .md files)
    if (appPath.endsWith('.md')) {
      const mdPolicy = extractPolicyFromMarkdown(content);
      if (mdPolicy) {
        // Add OAuth permissions if needed
        if (hasOAuth) {
          addOAuthPermissions(mdPolicy);
          await addWellknownHostsForOAuth(mdPolicy, content);
        }
        return { policy: mdPolicy, source: 'embedded' };
      }
      // No policy found in markdown
      return { policy: null, source: 'none' };
    }

    const policyTag = extractPolicyTag(content);

    if (!policyTag) {
      return { policy: null, source: 'none' };
    }

    // Check for src attribute - load from external file
    if (policyTag.src) {
      const policyPath = policyTag.src.startsWith('/')
        ? policyTag.src
        : resolve(appDir, policyTag.src);

      try {
        let json = await Deno.readTextFile(policyPath);
        // Substitute env vars before parsing
        json = substituteEnvVars(json);
        try {
          const policy = JSON.parse(json) as MelkerPolicy;
          // Add OAuth permissions if needed
          if (hasOAuth) {
            addOAuthPermissions(policy);
            await addWellknownHostsForOAuth(policy, content);
          }
          return { policy, source: 'file', path: policyPath };
        } catch (parseError) {
          const errorMsg = parseError instanceof SyntaxError ? parseError.message : String(parseError);
          throw new Error(`Invalid JSON in policy file ${policyPath}: ${errorMsg}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Invalid JSON')) {
          throw error;
        }
        throw new Error(`Failed to load policy file: ${policyPath}`);
      }
    }

    // Inline JSON content
    if (policyTag.content) {
      try {
        // Substitute env vars before parsing
        const resolvedContent = substituteEnvVars(policyTag.content);
        const policy = JSON.parse(resolvedContent) as MelkerPolicy;
        // Add OAuth permissions if needed
        if (hasOAuth) {
          addOAuthPermissions(policy);
          await addWellknownHostsForOAuth(policy, content);
        }
        return { policy, source: 'embedded' };
      } catch (parseError) {
        const errorMsg = parseError instanceof SyntaxError ? parseError.message : String(parseError);
        throw new Error(`Invalid JSON in embedded <policy> tag: ${errorMsg}\n\nPolicy content:\n${policyTag.content}`);
      }
    }

    return { policy: null, source: 'none' };
  } catch (error) {
    if (error instanceof Error && (
      error.message.startsWith('Invalid JSON') ||
      error.message.startsWith('Failed to load policy')
    )) {
      throw error;
    }
    // File read error
    return { policy: null, source: 'none' };
  }
}

/**
 * Check if content has an <oauth> tag
 */
function hasOAuthTag(content: string): boolean {
  return /<oauth[\s>]/i.test(content);
}

/**
 * Add OAuth-required permissions: localhost for callback server, browser for authorization
 */
function addOAuthPermissions(policy: MelkerPolicy): void {
  if (!policy.permissions) {
    policy.permissions = {};
  }

  // Add localhost to net permissions for callback server
  if (!policy.permissions.net) {
    policy.permissions.net = [];
  }
  if (!policy.permissions.net.includes('*') && !policy.permissions.net.includes('localhost')) {
    policy.permissions.net.push('localhost');
  }

  // Enable browser permission for opening authorization URL
  policy.permissions.browser = true;
}

/**
 * Extract wellknown URL from oauth tag attributes
 */
function extractOAuthWellknownUrl(content: string): string | null {
  // Match <oauth ...> and extract wellknown attribute
  const match = content.match(/<oauth\s+([^>]*)>/i);
  if (!match) return null;

  const attributes = match[1];
  const wellknownMatch = attributes.match(/wellknown\s*=\s*["']([^"']+)["']/i);
  return wellknownMatch ? wellknownMatch[1] : null;
}

/**
 * Substitute environment variables in a string
 * Supports: ${VAR} and ${VAR:-default}
 */
function substituteEnvVars(value: string): string {
  return value.replace(/\$\ENV{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_match, varName, defaultValue) => {
    const envValue = Env.get(varName);
    if (envValue !== undefined) {
      return envValue;
    }
    return defaultValue !== undefined ? defaultValue : '';
  });
}


/**
 * Fetch wellknown config and extract all hosts from URL fields
 */
async function fetchWellknownHosts(wellknownUrl: string): Promise<string[]> {
  const hosts: string[] = [];

  // Add the wellknown URL's host itself
  const wellknownHost = extractHostFromUrl(wellknownUrl);
  if (wellknownHost) {
    hosts.push(wellknownHost);
  }

  try {
    const response = await fetch(wellknownUrl);
    if (!response.ok) {
      return hosts; // Return just the wellknown host if fetch fails
    }

    const config = await response.json() as WellKnownConfig;

    // Extract hosts from all URL fields
    const urlFields: (keyof WellKnownConfig)[] = [
      'issuer',
      'authorization_endpoint',
      'token_endpoint',
      'userinfo_endpoint',
      'jwks_uri',
    ];

    for (const field of urlFields) {
      const value = config[field];
      if (value) {
        const host = extractHostFromUrl(value);
        if (host && !hosts.includes(host)) {
          hosts.push(host);
        }
      }
    }
  } catch {
    // Network error - return just the wellknown host
  }

  return hosts;
}

/**
 * Add wellknown endpoint hosts to net permissions
 */
async function addWellknownHostsForOAuth(policy: MelkerPolicy, content: string): Promise<void> {
  const wellknownUrl = extractOAuthWellknownUrl(content);
  if (!wellknownUrl) return;

  // Substitute environment variables
  const resolvedUrl = substituteEnvVars(wellknownUrl);
  if (!resolvedUrl) return;

  // Fetch and extract hosts
  const hosts = await fetchWellknownHosts(resolvedUrl);

  if (!policy.permissions) {
    policy.permissions = {};
  }
  if (!policy.permissions.net) {
    policy.permissions.net = [];
  }

  // Add hosts if not using wildcard
  if (policy.permissions.net.includes('*')) return;

  for (const host of hosts) {
    if (!policy.permissions.net.includes(host)) {
      policy.permissions.net.push(host);
    }
  }
}

export function addSourceURLNet(policy: MelkerPolicy, sourceUrl: string) {
  const host = extractHostFromUrl(sourceUrl);
  if (!host) return; // Invalid URL

  if (!policy.permissions) {
    policy.permissions = {};
  }
  if (!policy.permissions.net) {
    policy.permissions.net = [];
  }

  // Add hosts if not using wildcard
  if (policy.permissions.net.includes('*')) return;

  if (!policy.permissions.net.includes(host)) {
    policy.permissions.net.push(host);
  }
}

/**
 * Load policy from content string (for remote files)
 *
 * Unlike loadPolicy(), this works with content already in memory.
 * Does not support external policy files (src attribute) since
 * relative paths can't be resolved for remote URLs.
 *
 * @param content The .melker file content
 * @param sourceUrl Optional URL for error messages
 * @returns Policy load result with policy (or null) and source
 */
export async function loadPolicyFromContent(
  content: string,
  sourceUrl?: string
): Promise<PolicyLoadResult> {
  const hasOAuth = hasOAuthTag(content);

  // Check for markdown policy format (for .md files)
  const isMarkdown = sourceUrl?.endsWith('.md') || false;
  if (isMarkdown) {
    const mdPolicy = extractPolicyFromMarkdown(content);
    if (mdPolicy) {
      // Add OAuth permissions if needed
      if (hasOAuth) {
        addOAuthPermissions(mdPolicy);
        await addWellknownHostsForOAuth(mdPolicy, content);
      }
      return { policy: mdPolicy, source: 'embedded' };
    }
    // No policy found in markdown
    return { policy: null, source: 'none' };
  }

  const policyTag = extractPolicyTag(content);

  if (!policyTag) {
    return { policy: null, source: 'none' };
  }

  // External policy files not supported for remote content
  if (policyTag.src) {
    throw new Error(
      `External policy files (src="${policyTag.src}") are not supported for remote .melker files. ` +
      `Use inline <policy>{...}</policy> instead.`
    );
  }

  // Inline JSON content
  if (policyTag.content) {
    try {
      // Substitute env vars before parsing
      const resolvedContent = substituteEnvVars(policyTag.content);
      const policy = JSON.parse(resolvedContent) as MelkerPolicy;
      // Add OAuth permissions if needed
      if (hasOAuth) {
        addOAuthPermissions(policy);

        await addWellknownHostsForOAuth(policy, content);
      }
      return { policy, source: 'embedded' };
    } catch (parseError) {
      const errorMsg = parseError instanceof SyntaxError ? parseError.message : String(parseError);
      const location = sourceUrl ? ` in ${sourceUrl}` : '';
      throw new Error(`Invalid JSON in embedded <policy> tag${location}: ${errorMsg}\n\nPolicy content:\n${policyTag.content}`);
    }
  }

  return { policy: null, source: 'none' };
}

/**
 * Check if content has a <policy> tag or markdown policy block (without parsing it)
 */
export function hasPolicyTag(content: string): boolean {
  // Check for XML-style <policy> tag
  if (/<policy[\s>]/i.test(content)) {
    return true;
  }
  // Check for markdown JSON policy block
  if (/"@melker"\s*:\s*"policy"/.test(content)) {
    return true;
  }
  return false;
}

interface PolicyTagResult {
  src?: string;
  content?: string;
}

/**
 * Extract policy tag info (src attribute or inline content)
 */
function extractPolicyTag(content: string): PolicyTagResult | null {
  // Match <policy ...>...</policy>
  const match = content.match(/<policy([^>]*)>([\s\S]*?)<\/policy>/i);
  if (!match) return null;

  const attributes = match[1];
  const innerContent = match[2].trim();

  // Check for src attribute
  const srcMatch = attributes.match(/src\s*=\s*["']([^"']+)["']/i);
  if (srcMatch) {
    return { src: srcMatch[1] };
  }

  // Return inline content if present
  if (innerContent) {
    return { content: innerContent };
  }

  return null;
}

/**
 * Validate policy schema (basic validation)
 */
export function validatePolicy(policy: MelkerPolicy): string[] {
  const errors: string[] = [];

  if (policy.permissions) {
    const p = policy.permissions;

    // Check that all permission values are arrays of strings
    const arrayFields: (keyof typeof p)[] = ['read', 'write', 'net', 'run', 'env', 'ffi'];

    for (const field of arrayFields) {
      const value = p[field];
      if (value !== undefined) {
        if (!Array.isArray(value)) {
          errors.push(
            `permissions.${field} must be a string array, got ${typeof value} (${JSON.stringify(value)}). ` +
            `Use "${field}": ["*"] for unrestricted access, or "${field}": ["value1", "value2"] for specific values.`
          );
        } else if (!value.every(v => typeof v === 'string')) {
          errors.push(`permissions.${field} must contain only strings`);
        }
      }
    }
  }

  return errors;
}

/**
 * Format policy for display
 * @param policy The policy to format
 * @param sourceUrl Optional source URL for expanding "samesite" in net permissions
 */
export function formatPolicy(policy: MelkerPolicy, sourceUrl?: string): string {
  const lines: string[] = [];

  // Header
  const title = policy.name || 'App Policy';
  lines.push(title);
  if (policy.description) {
    lines.push(`  ${policy.description}`);
  }
  if (policy.comment) {
    lines.push('');
    const comments = Array.isArray(policy.comment)
      ? policy.comment
      : policy.comment.split('\n');
    for (const line of comments) {
      lines.push(`  ${line}`);
    }
  }
  lines.push('');

  // Permissions
  const p = policy.permissions || {};

  if (p.all) {
    lines.push('All Permissions:');
    lines.push('  enabled (--allow-all)');
    lines.push('');
    return lines.join('\n');
  }

  if (p.read?.length) {
    lines.push('Filesystem (read):');
    for (const path of p.read) {
      // Expand "cwd" to show actual path
      if (path === 'cwd') {
        try {
          lines.push(`  cwd (${Deno.cwd()})`);
        } catch {
          lines.push('  cwd');
        }
      } else {
        lines.push(`  ${path}`);
      }
    }
    lines.push('');
  }

  if (p.write?.length) {
    lines.push('Filesystem (write):');
    for (const path of p.write) {
      // Expand "cwd" to show actual path
      if (path === 'cwd') {
        try {
          lines.push(`  cwd (${Deno.cwd()})`);
        } catch {
          lines.push('  cwd');
        }
      } else {
        lines.push(`  ${path}`);
      }
    }
    lines.push('');
  }

  if (p.net?.length) {
    lines.push('Network:');
    const sourceHost = sourceUrl ? extractHostFromUrl(sourceUrl) : null;
    for (const host of p.net) {
      if (host === 'samesite' && sourceHost) {
        lines.push(`  samesite (${sourceHost})`);
      } else {
        lines.push(`  ${host}`);
      }
    }
    lines.push('');
  }

  if (p.run?.length) {
    lines.push('Subprocess:');
    for (const cmd of p.run) {
      lines.push(`  ${cmd}`);
    }
    lines.push('');
  }

  if (p.env?.length) {
    lines.push('Environment:');
    for (const varName of p.env) {
      lines.push(`  ${varName}`);
    }
    lines.push('');
  }

  if (p.ai) {
    lines.push('AI Assistant:');
    lines.push('  enabled (adds: swift, ffmpeg, ffprobe, pactl, ffplay + openrouter.ai)');
    lines.push('');
  }

  if (p.clipboard) {
    lines.push('Clipboard:');
    lines.push('  enabled (adds: pbcopy, xclip, xsel, wl-copy, clip.exe)');
    lines.push('');
  }

  if (p.keyring) {
    lines.push('Keyring:');
    lines.push('  enabled (adds: security, secret-tool, powershell)');
    lines.push('');
  }

  if (p.browser) {
    lines.push('Browser:');
    lines.push('  enabled (adds: open, xdg-open, cmd)');
    lines.push('');
  }

  if (p.shader) {
    lines.push('Shader:');
    lines.push('  enabled (allows per-pixel shader callbacks on canvas/img)');
    lines.push('');
  }

  // No permissions declared
  if (!p.read?.length && !p.write?.length && !p.net?.length && !p.run?.length && !p.env?.length && !p.ai && !p.clipboard && !p.keyring && !p.browser && !p.shader) {
    lines.push('(no permissions declared)');
  }

  return lines.join('\n');
}
