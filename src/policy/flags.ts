// Convert policy to Deno permission flags

import { resolve } from 'https://deno.land/std@0.208.0/path/mod.ts';
import type { MelkerPolicy } from './types.ts';

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
 * Check if a command exists in PATH
 */
function commandExists(cmd: string): boolean {
  if (commandExistsCache.has(cmd)) {
    return commandExistsCache.get(cmd)!;
  }

  // Check common binary locations
  const paths = (Deno.env.get('PATH') || '').split(':');
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

export function policyToDenoFlags(policy: MelkerPolicy, appDir: string): string[] {
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
    const readPaths = buildReadPaths(p.read, appDir);
    if (readPaths.length > 0) {
      flags.push(`--allow-read=${readPaths.join(',')}`);
    }
  }

  // Filesystem write permissions ("*" means all)
  if (p.write?.includes('*')) {
    flags.push('--allow-write');
  } else {
    const writePaths = buildWritePaths(p.write, appDir);
    if (writePaths.length > 0) {
      flags.push(`--allow-write=${writePaths.join(',')}`);
    }
  }

  // Network permissions ("*" means all)
  // Implicit: localhost when debug server is enabled
  const debugPort = Deno.env.get('MELKER_DEBUG_PORT');
  if (debugPort) {
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
      const hosts = p.net.map(extractHost);
      flags.push(`--allow-net=${[...new Set(hosts)].join(',')}`);
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
  if (p.env?.includes('*')) {
    flags.push('--allow-env');
  } else {
    const envVars = buildEnvVars(p.env);
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

  return flags;
}

/**
 * Build read paths with implicit paths added
 */
function buildReadPaths(policyPaths: string[] | undefined, appDir: string): string[] {
  const paths: string[] = [];

  // Implicit: /tmp for bundler temp files
  paths.push('/tmp');

  // Implicit: app directory (for loading .melker file itself)
  paths.push(appDir);

  // Implicit: current working directory (for .env files loaded by dotenv)
  try {
    paths.push(Deno.cwd());
  } catch {
    // Ignore if cwd is not accessible
  }

  // Implicit: XDG state dir for persistence
  const xdgState = Deno.env.get('XDG_STATE_HOME') || `${Deno.env.get('HOME')}/.local/state`;
  paths.push(`${xdgState}/melker`);

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
function buildWritePaths(policyPaths: string[] | undefined, appDir: string): string[] {
  const paths: string[] = [];

  // Implicit: /tmp for bundler temp files
  paths.push('/tmp');

  // Implicit: XDG state dir for persistence
  const xdgState = Deno.env.get('XDG_STATE_HOME') || `${Deno.env.get('HOME')}/.local/state`;
  paths.push(`${xdgState}/melker`);

  // Implicit: log file directory
  const logFile = Deno.env.get('MELKER_LOG_FILE');
  if (logFile) {
    // Add the directory containing the log file
    const logDir = logFile.substring(0, logFile.lastIndexOf('/')) || '.';
    paths.push(logDir);
  } else {
    // Default log location: $HOME/.cache/melker/logs/
    const home = Deno.env.get('HOME');
    if (home) {
      paths.push(`${home}/.cache/melker/logs`);
    }
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
 * Build environment variable list with implicit vars added
 */
function buildEnvVars(policyVars: string[] | undefined): string[] {
  const vars: string[] = [];

  // Implicit: terminal detection
  vars.push('TERM', 'COLORTERM', 'COLORFGBG', 'NO_COLOR');

  // Implicit: XDG directories
  vars.push('HOME', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME');

  // Implicit: All MELKER_* env vars found in source code
  vars.push(
    // Core / Engine
    'MELKER_THEME',
    'MELKER_LOG_FILE',
    'MELKER_LOG_LEVEL',
    'MELKER_RUNNER',
    'MELKER_LINT',
    'MELKER_PERSIST',
    'MELKER_RETAIN_BUNDLE',
    'MELKER_NO_ALTERNATE_SCREEN',
    'MELKER_NO_SYNC',
    'MELKER_SHOW_STATS',
    // Debug
    'MELKER_DEBUG_PORT',
    'MELKER_DEBUG_HOST',
    'MELKER_DEBUG_ENABLED',
    'MELKER_ALLOW_REMOTE_INPUT',
    'MELKER_HEADLESS',
    // AI
    'MELKER_AI_MODEL',
    'MELKER_AI_ENDPOINT',
    'MELKER_AI_SITE_URL',
    'MELKER_AI_SITE_NAME',
    'MELKER_AI_HEADERS',
    'MELKER_AUDIO_MODEL',
    'MELKER_AUDIO_GAIN',
    'MELKER_AUDIO_DEBUG',
    'MELKER_FFMPEG',
    // OAuth
    'MELKER_OAUTH_WELLKNOWN_URL',
    'MELKER_OAUTH_CLIENT_ID',
    'MELKER_OAUTH_PORT',
    'MELKER_OAUTH_PATH',
    'MELKER_OAUTH_REDIRECT_URI',
    'MELKER_OAUTH_SCOPES',
    'MELKER_OAUTH_AUDIENCE',
    // Components
    'MELKER_MARKDOWN_DEBUG',
    'MELKER_AUTO_DITHER',
    "MELKER_OAUTH_WELLKNOWN",
    "MELKER_OAUTH_CLIENT_NAME",
    "MELKER_HEADLESS_MODE",
    "MELKER_RUNNING_HEADLESS",
    "MELKER_AUDIO",
    "PATH",
    "OAUTH_CLIENT_NAME",
    "MELKER_REMOTE_URL"
  );

  // Implicit: OpenRouter API key for AI features
  vars.push('OPENROUTER_API_KEY');

  // Implicit: dotenv library
  vars.push('DOTENV_KEY');

  // Policy vars
  if (policyVars) {
    vars.push(...policyVars);
  }

  return [...new Set(vars)]; // Deduplicate
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
