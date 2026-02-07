// Convert policy to Deno permission flags

import { resolve } from '../deps.ts';
import type { MelkerPolicy } from './types.ts';
import { getTempDir } from '../xdg.ts';
import { Env } from '../env.ts';
import { MelkerConfig } from '../config/mod.ts';
import { extractHostFromUrl, extractHostOrValue } from './url-utils.ts';
import { getLogger } from '../logging.ts';

/**
 * Convert a policy to Deno command-line permission flags
 *
 * @param policy The parsed policy
 * @param appDir Directory containing the .melker file (for resolving relative paths)
 * @returns Array of Deno permission flags
 */
// AI permission shortcut - these are the commands and hosts needed for AI features
export const AI_RUN_COMMANDS_ALL = ['swift', 'ffmpeg', 'ffprobe', 'pactl', 'ffplay'];
export const AI_NET_HOSTS = ['openrouter.ai'];

// Clipboard permission shortcut - platform-specific clipboard commands
export const CLIPBOARD_COMMANDS_ALL = ['pbcopy', 'xclip', 'xsel', 'wl-copy', 'clip.exe'];

// Keyring permission shortcut - platform-specific credential storage commands
export const KEYRING_COMMANDS_ALL = ['security', 'secret-tool', 'powershell'];

// Cache for command existence checks
const commandExistsCache = new Map<string, boolean>();


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
export function getAvailableAICommands(): string[] {
  return AI_RUN_COMMANDS_ALL.filter(cmd => commandExists(cmd));
}

/**
 * Get clipboard commands that actually exist on this system
 */
export function getAvailableClipboardCommands(): string[] {
  return CLIPBOARD_COMMANDS_ALL.filter(cmd => commandExists(cmd));
}

/**
 * Get keyring commands that actually exist on this system
 */
export function getAvailableKeyringCommands(): string[] {
  return KEYRING_COMMANDS_ALL.filter(cmd => commandExists(cmd));
}

/**
 * Get the browser command for this platform
 * Matches src/oauth/browser.ts openBrowser()
 */
export function getBrowserCommand(): string {
  const os = Deno.build.os;
  if (os === 'darwin') {
    return 'open';
  } else if (os === 'windows') {
    return 'cmd';
  } else {
    return 'xdg-open';
  }
}

import type { PolicyPermissions } from './types.ts';

export function policyToDenoFlags(
  policy: MelkerPolicy,
  appDir: string,
  urlHash?: string,
  sourceUrl?: string,
  activeDenies?: Partial<PolicyPermissions>,
  /** Explicitly denied paths to filter from implicit paths (e.g., from --deny-read, --deny-write) */
  explicitDenies?: Partial<PolicyPermissions>
): string[] {
  const flags: string[] = [];
  // Deep clone permissions to avoid mutating the original policy
  const orig = policy.permissions || {};
  const p: PolicyPermissions = {
    ...orig,
    read: orig.read ? [...orig.read] : undefined,
    write: orig.write ? [...orig.write] : undefined,
    net: orig.net ? [...orig.net] : undefined,
    run: orig.run ? [...orig.run] : undefined,
    env: orig.env ? [...orig.env] : undefined,
    ffi: orig.ffi ? [...orig.ffi] : undefined,
    sys: orig.sys ? [...orig.sys] : undefined,
  };

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
    const readPaths = buildReadPaths(p.read, appDir, urlHash, explicitDenies?.read);
    if (readPaths.length > 0) {
      flags.push(`--allow-read=${readPaths.join(',')}`);
    }
  }

  // Filesystem write permissions ("*" means all)
  if (p.write?.includes('*')) {
    flags.push('--allow-write');
  } else {
    const writePaths = buildWritePaths(p.write, appDir, urlHash, explicitDenies?.write);
    if (writePaths.length > 0) {
      flags.push(`--allow-write=${writePaths.join(',')}`);
    }
  }

  // Network permissions ("*" means all)
  // Implicit: localhost when server or headless mode is enabled
  const config = MelkerConfig.get();
  if (config.serverPort !== undefined || config.serverEnabled || config.headlessEnabled) {
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
      const sourceHost = sourceUrl ? extractHostFromUrl(sourceUrl) : null;
      const hosts = p.net
        .map(entry => {
          if (entry === 'samesite') {
            return sourceHost; // null if no valid source URL
          }
          return extractHostOrValue(entry);
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

  // Add --deny-X flags for active denies (when base permission is wildcard)
  if (activeDenies) {
    if (activeDenies.read?.length) {
      flags.push(`--deny-read=${activeDenies.read.join(',')}`);
    }
    if (activeDenies.write?.length) {
      flags.push(`--deny-write=${activeDenies.write.join(',')}`);
    }
    if (activeDenies.net?.length) {
      flags.push(`--deny-net=${activeDenies.net.join(',')}`);
    }
    if (activeDenies.run?.length) {
      flags.push(`--deny-run=${activeDenies.run.join(',')}`);
    }
    if (activeDenies.env?.length) {
      flags.push(`--deny-env=${activeDenies.env.join(',')}`);
    }
    if (activeDenies.ffi?.length) {
      flags.push(`--deny-ffi=${activeDenies.ffi.join(',')}`);
    }
    if (activeDenies.sys?.length) {
      flags.push(`--deny-sys=${activeDenies.sys.join(',')}`);
    }
  }

  return flags;
}

/**
 * Expand "cwd" in a deny list to the actual cwd path
 */
function expandCwdInDenyList(deniedPaths: string[] | undefined): string[] | undefined {
  if (!deniedPaths?.length) return deniedPaths;
  return deniedPaths.map(p => {
    if (p === 'cwd') {
      try {
        return Deno.cwd();
      } catch {
        return p;
      }
    }
    return p;
  });
}

/**
 * Check if a path should be denied based on deny list
 * A path is denied if it matches or is under a denied path
 */
function isPathDenied(path: string, deniedPaths: string[] | undefined): boolean {
  if (!deniedPaths?.length) return false;
  // Expand "cwd" to actual path for comparison
  const expandedDenies = expandCwdInDenyList(deniedPaths);
  if (!expandedDenies?.length) return false;
  for (const denied of expandedDenies) {
    // Exact match or path is under denied directory
    if (path === denied || path.startsWith(denied + '/') || denied.startsWith(path + '/')) {
      return true;
    }
  }
  return false;
}

/**
 * Log a warning when an implicit path is denied
 */
function warnImplicitPathDenied(path: string, purpose: string, permission: 'read' | 'write'): void {
  // Log to file
  const logger = getLogger('Policy');
  logger.warn(`Implicit ${permission} path denied: ${path} (${purpose}) - this may affect functionality`);
  // Also print to stderr so user sees it immediately
  console.error(`Warning: Denying ${permission} access to ${path} (used for ${purpose}) may affect functionality`);
}

/**
 * Build read paths with implicit paths added
 */
function buildReadPaths(policyPaths: string[] | undefined, appDir: string, urlHash?: string, deniedPaths?: string[]): string[] {
  const paths: string[] = [];

  // Implicit: temp dir for bundler temp files
  const tempDir = getTempDir();
  if (!isPathDenied(tempDir, deniedPaths)) {
    paths.push(tempDir);
  } else {
    warnImplicitPathDenied(tempDir, 'bundler temp files', 'read');
  }

  // Implicit: app directory (for loading .melker file itself)
  if (!isPathDenied(appDir, deniedPaths)) {
    paths.push(appDir);
  } else {
    warnImplicitPathDenied(appDir, 'app directory', 'read');
  }

  // Implicit: current working directory
  try {
    const cwd = Deno.cwd();
    if (!isPathDenied(cwd, deniedPaths)) {
      paths.push(cwd);
    } else {
      warnImplicitPathDenied(cwd, 'current working directory', 'read');
    }
  } catch {
    // Ignore if cwd is not accessible
  }

  // Implicit: XDG state dir for persistence
  const xdgState = Env.get('XDG_STATE_HOME') || `${Env.get('HOME')}/.local/state`;
  const stateDir = `${xdgState}/melker`;
  if (!isPathDenied(stateDir, deniedPaths)) {
    paths.push(stateDir);
  } else {
    warnImplicitPathDenied(stateDir, 'state persistence', 'read');
  }

  // Implicit: app-specific cache dir (only if urlHash provided)
  if (urlHash) {
    const xdgCache = Env.get('XDG_CACHE_HOME') || `${Env.get('HOME')}/.cache`;
    const cacheDir = `${xdgCache}/melker/app-cache/${urlHash}`;
    if (!isPathDenied(cacheDir, deniedPaths)) {
      paths.push(cacheDir);
    } else {
      warnImplicitPathDenied(cacheDir, 'app cache', 'read');
    }
  }

  // Policy paths (resolve relative to app dir)
  if (policyPaths) {
    for (const p of policyPaths) {
      // Special "cwd" value expands to current working directory
      if (p === 'cwd') {
        try {
          const cwd = Deno.cwd();
          if (!isPathDenied(cwd, deniedPaths)) {
            paths.push(cwd);
          }
        } catch {
          // Ignore if cwd is not accessible
        }
        continue;
      }
      const resolved = p.startsWith('/') ? p : resolve(appDir, p);
      if (!isPathDenied(resolved, deniedPaths)) {
        paths.push(resolved);
      }
    }
  }

  return [...new Set(paths)]; // Deduplicate
}

/**
 * Build write paths with implicit paths added
 */
function buildWritePaths(policyPaths: string[] | undefined, appDir: string, urlHash?: string, deniedPaths?: string[]): string[] {
  const paths: string[] = [];

  // Implicit: temp dir for bundler temp files
  const tempDir = getTempDir();
  if (!isPathDenied(tempDir, deniedPaths)) {
    paths.push(tempDir);
  } else {
    warnImplicitPathDenied(tempDir, 'bundler temp files', 'write');
  }

  // Implicit: XDG state dir for persistence
  const xdgState = Env.get('XDG_STATE_HOME') || `${Env.get('HOME')}/.local/state`;
  const stateDir = `${xdgState}/melker`;
  if (!isPathDenied(stateDir, deniedPaths)) {
    paths.push(stateDir);
  } else {
    warnImplicitPathDenied(stateDir, 'state persistence', 'write');
  }

  // Implicit: log file directory
  const logFile = MelkerConfig.get().logFile;
  if (logFile) {
    // Add the directory containing the log file
    const logDir = logFile.substring(0, logFile.lastIndexOf('/')) || '.';
    if (!isPathDenied(logDir, deniedPaths)) {
      paths.push(logDir);
    } else {
      warnImplicitPathDenied(logDir, 'log files', 'write');
    }
  } else {
    // Default log location: $HOME/.cache/melker/logs/
    const home = Env.get('HOME');
    if (home) {
      const defaultLogDir = `${home}/.cache/melker/logs`;
      if (!isPathDenied(defaultLogDir, deniedPaths)) {
        paths.push(defaultLogDir);
      } else {
        warnImplicitPathDenied(defaultLogDir, 'log files', 'write');
      }
    }
  }

  // Implicit: app-specific cache dir (only if urlHash provided)
  if (urlHash) {
    const xdgCache = Env.get('XDG_CACHE_HOME') || `${Env.get('HOME')}/.cache`;
    const cacheDir = `${xdgCache}/melker/app-cache/${urlHash}`;
    if (!isPathDenied(cacheDir, deniedPaths)) {
      paths.push(cacheDir);
    } else {
      warnImplicitPathDenied(cacheDir, 'app cache', 'write');
    }
  }

  // Policy paths (resolve relative to app dir)
  if (policyPaths) {
    for (const p of policyPaths) {
      // Special "cwd" value expands to current working directory
      if (p === 'cwd') {
        try {
          const cwd = Deno.cwd();
          if (!isPathDenied(cwd, deniedPaths)) {
            paths.push(cwd);
          }
        } catch {
          // Ignore if cwd is not accessible
        }
        continue;
      }
      const resolved = p.startsWith('/') ? p : resolve(appDir, p);
      if (!isPathDenied(resolved, deniedPaths)) {
        paths.push(resolved);
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
  // Terminal identification (for sixel/kitty detection)
  'TERM_PROGRAM', 'VTE_VERSION', 'WT_SESSION',
  // Kitty graphics protocol detection
  'KITTY_WINDOW_ID', 'WEZTERM_PANE', 'GHOSTTY_RESOURCES_DIR',
  // iTerm2 graphics protocol detection
  'LC_TERMINAL', 'ITERM_SESSION_ID', 'KONSOLE_VERSION',
  // Multiplexer detection (tmux/screen - sixel disabled in multiplexers)
  'TMUX', 'STY',
  // SSH session detection (for sixel bandwidth considerations)
  'SSH_CLIENT', 'SSH_CONNECTION', 'SSH_TTY',
  // Set by launcher after permission flags are built
  'MELKER_RUNNER',
  'MELKER_REMOTE_URL',
  'MELKER_PERMISSION_OVERRIDES',
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
