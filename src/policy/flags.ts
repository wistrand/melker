// Convert policy to Deno permission flags

import { resolve } from 'https://deno.land/std@0.224.0/path/mod.ts';
import type { MelkerPolicy } from './types.ts';
import { getTempDir } from '../xdg.ts';
import { Env } from '../env.ts';
import { MelkerConfig } from '../config/mod.ts';

/**
 * Convert a policy to Deno command-line permission flags
 *
 * @param policy The parsed policy
 * @param appDir Directory containing the .melker file (for resolving relative paths)
 * @returns Array of Deno permission flags
 */
// AI permission shortcut - these are the commands and hosts needed for AI features
const AI_RUN_COMMANDS_ALL = ['swift', 'ffmpeg', 'ffprobe', 'pactl', 'ffplay'];
const AI_NET_HOSTS = ['openrouter.ai'];

// Clipboard permission shortcut - platform-specific clipboard commands
const CLIPBOARD_COMMANDS_ALL = ['pbcopy', 'xclip', 'xsel', 'wl-copy', 'clip.exe'];

// Keyring permission shortcut - platform-specific credential storage commands
const KEYRING_COMMANDS_ALL = ['security', 'secret-tool', 'powershell'];

// Cache for command existence checks
const commandExistsCache = new Map<string, boolean>();

/**
 * Extract host from a URL or return the string as-is if it's already a host
 */
function extractHost(value: string): string {
  // If it looks like a URL, extract the host
  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      const url = new URL(value);
      return url.host; // Returns host with port if present
    } catch {
      // Invalid URL, return as-is
      return value;
    }
  }
  // Already a host/domain
  return value;
}

/**
 * Extract host from source URL for "samesite" permission
 * Returns null if URL is invalid or not provided
 */
function extractSourceHost(sourceUrl: string | undefined): string | null {
  if (!sourceUrl) return null;
  if (!sourceUrl.startsWith('http://') && !sourceUrl.startsWith('https://')) {
    return null; // Only HTTP/HTTPS URLs have a meaningful "samesite"
  }
  try {
    const url = new URL(sourceUrl);
    return url.host;
  } catch {
    return null;
  }
}

/**
 * Check if a command exists in PATH
 */
function commandExists(cmd: string): boolean {
  if (commandExistsCache.has(cmd)) {
    return commandExistsCache.get(cmd)!;
  }

  // Check common binary locations
  const paths = (Env.get('PATH') || '').split(':');
  for (const dir of paths) {
    try {
      const stat = Deno.statSync(`${dir}/${cmd}`);
      if (stat.isFile) {
        commandExistsCache.set(cmd, true);
        return true;
      }
    } catch {
      // Not found in this directory
    }
  }

  commandExistsCache.set(cmd, false);
  return false;
}

/**
 * Get AI run commands that actually exist on this system
 */
function getAvailableAICommands(): string[] {
  return AI_RUN_COMMANDS_ALL.filter(cmd => commandExists(cmd));
}

/**
 * Get clipboard commands that actually exist on this system
 */
function getAvailableClipboardCommands(): string[] {
  return CLIPBOARD_COMMANDS_ALL.filter(cmd => commandExists(cmd));
}

/**
 * Get keyring commands that actually exist on this system
 */
function getAvailableKeyringCommands(): string[] {
  return KEYRING_COMMANDS_ALL.filter(cmd => commandExists(cmd));
}

/**
 * Get the browser command for this platform
 * Matches src/oauth/browser.ts openBrowser()
 */
function getBrowserCommand(): string {
  const os = Deno.build.os;
  if (os === 'darwin') {
    return 'open';
  } else if (os === 'windows') {
    return 'cmd';
  } else {
    return 'xdg-open';
  }
}

export function policyToDenoFlags(policy: MelkerPolicy, appDir: string, urlHash?: string, sourceUrl?: string): string[] {
  const flags: string[] = [];
  const p = policy.permissions || {};

  // Handle "all" permission - no other flags needed
  if (p.all === true) {
    return ['--allow-all'];
  }

  // Expand "ai" shortcut permission
  if (p.ai === true || (Array.isArray(p.ai) && p.ai.includes('*'))) {
    // Add AI run commands that exist on this system (merge with existing)
    if (!p.run) p.run = [];
    for (const cmd of getAvailableAICommands()) {
      if (!p.run.includes(cmd) && !p.run.includes('*')) {
        p.run.push(cmd);
      }
    }
    // Add AI net hosts (merge with existing)
    if (!p.net) p.net = [];
    for (const host of AI_NET_HOSTS) {
      if (!p.net.includes(host) && !p.net.includes('*')) {
        p.net.push(host);
      }
    }
  }

  // Expand "clipboard" shortcut permission
  if (p.clipboard === true) {
    // Add clipboard commands that exist on this system (merge with existing)
    if (!p.run) p.run = [];
    for (const cmd of getAvailableClipboardCommands()) {
      if (!p.run.includes(cmd) && !p.run.includes('*')) {
        p.run.push(cmd);
      }
    }
  }

  // Expand "keyring" shortcut permission
  if (p.keyring === true) {
    // Add keyring commands that exist on this system (merge with existing)
    if (!p.run) p.run = [];
    for (const cmd of getAvailableKeyringCommands()) {
      if (!p.run.includes(cmd) && !p.run.includes('*')) {
        p.run.push(cmd);
      }
    }
  }

  // Expand "browser" shortcut permission
  if (p.browser === true) {
    // Add platform-specific browser command (merge with existing)
    if (!p.run) p.run = [];
    const browserCmd = getBrowserCommand();
    if (!p.run.includes(browserCmd) && !p.run.includes('*')) {
      p.run.push(browserCmd);
    }
  }

  // Filesystem read permissions ("*" means all)
  if (p.read?.includes('*')) {
    flags.push('--allow-read');
  } else {
    const readPaths = buildReadPaths(p.read, appDir, urlHash);
    if (readPaths.length > 0) {
      flags.push(`--allow-read=${readPaths.join(',')}`);
    }
  }

  // Filesystem write permissions ("*" means all)
  if (p.write?.includes('*')) {
    flags.push('--allow-write');
  } else {
    const writePaths = buildWritePaths(p.write, appDir, urlHash);
    if (writePaths.length > 0) {
      flags.push(`--allow-write=${writePaths.join(',')}`);
    }
  }

  // Network permissions ("*" means all)
  // Implicit: localhost when debug server is enabled
  const debugPort = MelkerConfig.get().debugPort;
  if (debugPort !== undefined) {
    if (!p.net) p.net = [];
    if (!p.net.includes('*') && !p.net.includes('localhost')) {
      p.net.push('localhost');
    }
  }

  if (p.net && p.net.length > 0) {
    if (p.net.includes('*')) {
      flags.push('--allow-net');
    } else {
      // Extract hosts from URLs (Deno only accepts hosts/domains, not full URLs)
      // Handle special "samesite" value - expands to the host of the source URL
      const sourceHost = extractSourceHost(sourceUrl);
      const hosts = p.net
        .map(entry => {
          if (entry === 'samesite') {
            return sourceHost; // null if no valid source URL
          }
          return extractHost(entry);
        })
        .filter((h): h is string => h !== null); // Remove nulls (unresolved samesite)
      if (hosts.length > 0) {
        flags.push(`--allow-net=${[...new Set(hosts)].join(',')}`);
      }
    }
  }

  // Subprocess permissions ("*" means all)
  if (p.run && p.run.length > 0) {
    if (p.run.includes('*')) {
      flags.push('--allow-run');
    } else {
      flags.push(`--allow-run=${p.run.join(',')}`);
    }
  }

  // Environment permissions ("*" means all)
  // Include env vars from configSchema automatically
  if (p.env?.includes('*')) {
    flags.push('--allow-env');
  } else {
    const envVars = buildEnvVars(p.env, policy.configSchema);
    if (envVars.length > 0) {
      flags.push(`--allow-env=${envVars.join(',')}`);
    }
  }

  // FFI permissions ("*" means all)
  if (p.ffi && p.ffi.length > 0) {
    if (p.ffi.includes('*')) {
      flags.push('--allow-ffi');
    } else {
      flags.push(`--allow-ffi=${p.ffi.join(',')}`);
    }
  }

  // System info permissions ("*" means all)
  // Valid interfaces: hostname, osRelease, osUptime, loadavg, networkInterfaces, systemMemoryInfo, uid, gid
  if (p.sys && p.sys.length > 0) {
    if (p.sys.includes('*')) {
      flags.push('--allow-sys');
    } else {
      flags.push(`--allow-sys=${p.sys.join(',')}`);
    }
  }

  return flags;
}

/**
 * Build read paths with implicit paths added
 */
function buildReadPaths(policyPaths: string[] | undefined, appDir: string, urlHash?: string): string[] {
  const paths: string[] = [];

  // Implicit: temp dir for bundler temp files
  paths.push(getTempDir());

  // Implicit: app directory (for loading .melker file itself)
  paths.push(appDir);

  // Implicit: current working directory
  try {
    paths.push(Deno.cwd());
  } catch {
    // Ignore if cwd is not accessible
  }

  // Implicit: XDG state dir for persistence
  const xdgState = Env.get('XDG_STATE_HOME') || `${Env.get('HOME')}/.local/state`;
  paths.push(`${xdgState}/melker`);

  // Implicit: app-specific cache dir (only if urlHash provided)
  if (urlHash) {
    const xdgCache = Env.get('XDG_CACHE_HOME') || `${Env.get('HOME')}/.cache`;
    paths.push(`${xdgCache}/melker/app-cache/${urlHash}`);
  }

  // Policy paths (resolve relative to app dir)
  if (policyPaths) {
    for (const p of policyPaths) {
      if (p.startsWith('/')) {
        paths.push(p);
      } else {
        paths.push(resolve(appDir, p));
      }
    }
  }

  return [...new Set(paths)]; // Deduplicate
}

/**
 * Build write paths with implicit paths added
 */
function buildWritePaths(policyPaths: string[] | undefined, appDir: string, urlHash?: string): string[] {
  const paths: string[] = [];

  // Implicit: temp dir for bundler temp files
  paths.push(getTempDir());

  // Implicit: XDG state dir for persistence
  const xdgState = Env.get('XDG_STATE_HOME') || `${Env.get('HOME')}/.local/state`;
  paths.push(`${xdgState}/melker`);

  // Implicit: log file directory
  const logFile = MelkerConfig.get().logFile;
  if (logFile) {
    // Add the directory containing the log file
    const logDir = logFile.substring(0, logFile.lastIndexOf('/')) || '.';
    paths.push(logDir);
  } else {
    // Default log location: $HOME/.cache/melker/logs/
    const home = Env.get('HOME');
    if (home) {
      paths.push(`${home}/.cache/melker/logs`);
    }
  }

  // Implicit: app-specific cache dir (only if urlHash provided)
  if (urlHash) {
    const xdgCache = Env.get('XDG_CACHE_HOME') || `${Env.get('HOME')}/.cache`;
    paths.push(`${xdgCache}/melker/app-cache/${urlHash}`);
  }

  // Policy paths (resolve relative to app dir)
  if (policyPaths) {
    for (const p of policyPaths) {
      if (p.startsWith('/')) {
        paths.push(p);
      } else {
        paths.push(resolve(appDir, p));
      }
    }
  }

  return [...new Set(paths)]; // Deduplicate
}

// Vars that must ALWAYS be whitelisted (even if not currently set).
// These are essential for basic operation.
const ALWAYS_ALLOWED_ENV = [
  // Basic terminal/system vars
  'HOME', 'USERPROFILE', 'TERM', 'COLORTERM', 'COLORFGBG', 'NO_COLOR', 'PREFIX',
  'TMPDIR', 'TEMP', 'TMP', 'PATH',
  // Terminal identification (for sixel detection)
  'TERM_PROGRAM', 'VTE_VERSION', 'WT_SESSION',
  // Multiplexer detection (tmux/screen - sixel disabled in multiplexers)
  'TMUX', 'STY',
  // SSH session detection (for sixel bandwidth considerations)
  'SSH_CLIENT', 'SSH_CONNECTION', 'SSH_TTY',
  // Set by launcher after permission flags are built
  'MELKER_RUNNER',
  'MELKER_REMOTE_URL',
  // Set at runtime by headless mode
  'MELKER_RUNNING_HEADLESS',
];

/**
 * Get implicit env vars dynamically from current environment,
 * plus vars that should always be allowed.
 * XDG_* and MELKER_* vars are only included when actually present.
 */
function getImplicitEnvVars(): string[] {
  // Start with vars that are always allowed
  const vars = [...ALWAYS_ALLOWED_ENV];

  // Add XDG_* and MELKER_* vars that are actually present in the environment
  for (const name of Env.keys()) {
    if (name.startsWith('XDG_') || name.startsWith('MELKER_')) {
      vars.push(name);
    }
  }

  // Add other specific vars if present
  for (const name of ['OPENROUTER_API_KEY', 'DOTENV_KEY']) {
    if (Env.get(name) !== undefined) {
      vars.push(name);
    }
  }

  return [...new Set(vars)]; // Deduplicate
}

/**
 * Build environment variable list with implicit vars added
 */
function buildEnvVars(
  policyVars: string[] | undefined,
  configSchema?: Record<string, { env?: string }>,
): string[] {
  // Get implicit vars that exist in current environment
  const vars = getImplicitEnvVars();

  // Merge with policy-declared vars
  if (policyVars) {
    vars.push(...policyVars);
  }

  // Auto-add env vars from configSchema (for custom config env overrides)
  if (configSchema) {
    for (const prop of Object.values(configSchema)) {
      if (prop.env) {
        vars.push(prop.env);
      }
    }
  }

  return [...new Set(vars)].sort(); // Deduplicate and sort for stable hash
}

/**
 * Format flags for display
 */
export function formatDenoFlags(flags: string[]): string {
  if (flags.length === 0) {
    return '  (no permissions)';
  }

  return flags.map(f => `  ${f}`).join('\n');
}
