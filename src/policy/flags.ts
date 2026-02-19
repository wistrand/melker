// Convert policy to Deno permission flags

import { resolve } from '../deps.ts';
import type { MelkerPolicy, PolicyPermissions } from './types.ts';
import { getTempDir } from '../xdg.ts';
import { Env } from '../env.ts';
import { MelkerConfig } from '../config/mod.ts';
import { extractHostFromUrl, extractHostOrValue } from './url-utils.ts';
import { getLogger } from '../logging.ts';
import { expandShortcutsInPlace } from './shortcut-utils.ts';

// Re-export shortcut constants and helpers so existing consumers don't break
export {
  AI_RUN_COMMANDS_ALL,
  AI_NET_HOSTS,
  CLIPBOARD_COMMANDS_ALL,
  KEYRING_COMMANDS_ALL,
  getAvailableAICommands,
  getAvailableClipboardCommands,
  getAvailableKeyringCommands,
  getBrowserCommand,
} from './shortcut-utils.ts';

export function policyToDenoFlags(
  policy: MelkerPolicy,
  appDir: string,
  urlHash?: string,
  sourceUrl?: string,
  activeDenies?: Partial<PolicyPermissions>,
  /** Explicitly denied paths to filter from implicit paths (e.g., from --deny-read, --deny-write) */
  explicitDenies?: Partial<PolicyPermissions>,
  /** Remote apps should not get implicit cwd read access */
  isRemote?: boolean,
): string[] {
  const flags: string[] = [];
  // Deep clone permissions to avoid mutating the original policy
  const orig = policy.permissions || {};

  // Validate array permission fields before cloning — catch common mistake
  // of writing e.g. "env": true instead of "env": ["*"]
  const arrayFields = ['read', 'write', 'net', 'run', 'env', 'ffi', 'sys'] as const;
  for (const field of arrayFields) {
    const value = (orig as Record<string, unknown>)[field];
    if (value !== undefined && !Array.isArray(value)) {
      throw new Error(
        `Invalid policy: "permissions.${field}" must be a string array, got ${typeof value} (${JSON.stringify(value)}).\n` +
        `  Use "${field}": ["*"] for unrestricted access, or "${field}": ["value1", "value2"] for specific values.`
      );
    }
  }

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

  // Expand shortcut permissions (ai, clipboard, keyring, browser) into run/net arrays.
  // skipWildcard=true: don't add specific commands when run/net already has '*'
  expandShortcutsInPlace(p, true);

  // Filesystem read permissions ("*" means all)
  if (p.read?.includes('*')) {
    flags.push('--allow-read');
  } else {
    const readPaths = buildReadPaths(p.read, appDir, urlHash, explicitDenies?.read, isRemote);
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
 * Build permission paths from implicit paths and policy paths.
 * Shared logic for both read and write path building.
 */
function buildPermissionPaths(
  policyPaths: string[] | undefined,
  denyPaths: string[] | undefined,
  appDir: string,
  implicitPaths: Array<{ path: string; label: string }>,
  permissionType: 'read' | 'write',
): string[] {
  const paths: string[] = [];

  // Add implicit paths, checking deny list and warning if denied
  for (const { path, label } of implicitPaths) {
    if (!isPathDenied(path, denyPaths)) {
      paths.push(path);
    } else {
      warnImplicitPathDenied(path, label, permissionType);
    }
  }

  // Policy paths (resolve relative to app dir)
  if (policyPaths) {
    for (const p of policyPaths) {
      // Special "cwd" value expands to current working directory
      if (p === 'cwd') {
        try {
          const cwd = Deno.cwd();
          if (!isPathDenied(cwd, denyPaths)) {
            paths.push(cwd);
          }
        } catch {
          // Ignore if cwd is not accessible
        }
        continue;
      }
      const resolved = p.startsWith('/') ? p : resolve(appDir, p);
      if (!isPathDenied(resolved, denyPaths)) {
        paths.push(resolved);
      }
    }
  }

  return [...new Set(paths)]; // Deduplicate
}

/**
 * Collect implicit read paths for the given app context
 */
function getImplicitReadPaths(appDir: string, urlHash?: string, isRemote?: boolean): Array<{ path: string; label: string }> {
  const implicit: Array<{ path: string; label: string }> = [];

  // Temp dir for bundler temp files
  implicit.push({ path: getTempDir(), label: 'bundler temp files' });

  // App directory (for loading .melker file itself)
  implicit.push({ path: appDir, label: 'app directory' });

  // Current working directory (local apps only — remote apps must declare "cwd" explicitly)
  if (!isRemote) {
    try {
      implicit.push({ path: Deno.cwd(), label: 'current working directory' });
    } catch {
      // Ignore if cwd is not accessible
    }
  }

  // XDG state dir for persistence
  const xdgState = Env.get('XDG_STATE_HOME') || `${Env.get('HOME')}/.local/state`;
  implicit.push({ path: `${xdgState}/melker`, label: 'state persistence' });

  // App-specific cache dir (only if urlHash provided)
  if (urlHash) {
    const xdgCache = Env.get('XDG_CACHE_HOME') || `${Env.get('HOME')}/.cache`;
    implicit.push({ path: `${xdgCache}/melker/app-cache/${urlHash}`, label: 'app cache' });
  }

  // Deno cache dir for npm WASM modules (e.g., @jsquash/webp loads .wasm at runtime)
  const denoDir = Env.get('DENO_DIR') || `${Env.get('XDG_CACHE_HOME') || `${Env.get('HOME')}/.cache`}/deno`;
  implicit.push({ path: denoDir, label: 'Deno module cache' });

  // Melker runtime assets — theme CSS, server-ui, bitmap fonts, dither textures
  // Needed because fetch('file://...') requires --allow-read even for bundled assets
  const srcDir = new URL('..', import.meta.url).pathname;
  const mediaDir = new URL('../../media', import.meta.url).pathname;
  implicit.push({ path: srcDir, label: 'melker runtime' });
  implicit.push({ path: mediaDir, label: 'melker media' });

  return implicit;
}

/**
 * Collect implicit write paths for the given app context
 */
function getImplicitWritePaths(urlHash?: string): Array<{ path: string; label: string }> {
  const implicit: Array<{ path: string; label: string }> = [];

  // Temp dir for bundler temp files
  implicit.push({ path: getTempDir(), label: 'bundler temp files' });

  // XDG state dir for persistence
  const xdgState = Env.get('XDG_STATE_HOME') || `${Env.get('HOME')}/.local/state`;
  implicit.push({ path: `${xdgState}/melker`, label: 'state persistence' });

  // Log file directory
  const logFile = MelkerConfig.get().logFile;
  if (logFile) {
    const logDir = logFile.substring(0, logFile.lastIndexOf('/')) || '.';
    implicit.push({ path: logDir, label: 'log files' });
  } else {
    const home = Env.get('HOME');
    if (home) {
      implicit.push({ path: `${home}/.cache/melker/logs`, label: 'log files' });
    }
  }

  // App-specific cache dir (only if urlHash provided)
  if (urlHash) {
    const xdgCache = Env.get('XDG_CACHE_HOME') || `${Env.get('HOME')}/.cache`;
    implicit.push({ path: `${xdgCache}/melker/app-cache/${urlHash}`, label: 'app cache' });
  }

  return implicit;
}

/**
 * Build read paths with implicit paths added
 */
function buildReadPaths(policyPaths: string[] | undefined, appDir: string, urlHash?: string, deniedPaths?: string[], isRemote?: boolean): string[] {
  return buildPermissionPaths(
    policyPaths, deniedPaths, appDir,
    getImplicitReadPaths(appDir, urlHash, isRemote), 'read',
  );
}

/**
 * Build write paths with implicit paths added
 */
function buildWritePaths(policyPaths: string[] | undefined, appDir: string, urlHash?: string, deniedPaths?: string[]): string[] {
  return buildPermissionPaths(
    policyPaths, deniedPaths, appDir,
    getImplicitWritePaths(urlHash), 'write',
  );
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
