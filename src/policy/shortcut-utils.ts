// Shared shortcut expansion utilities for the policy subsystem
// Used by both flags.ts (Deno flag generation) and permission-overrides.ts (CLI override merging)

import type { PolicyPermissions } from './types.ts';

// AI permission shortcut hosts
export const AI_NET_HOSTS = ['openrouter.ai'];

// All possible AI run commands (platform-wide)
export const AI_RUN_COMMANDS_ALL = ['swift', 'ffmpeg', 'ffprobe', 'pactl', 'ffplay'];

// All possible clipboard commands (platform-wide)
export const CLIPBOARD_COMMANDS_ALL = ['pbcopy', 'xclip', 'xsel', 'wl-copy', 'clip.exe'];

// All possible keyring commands (platform-wide)
export const KEYRING_COMMANDS_ALL = ['security', 'secret-tool', 'powershell'];

import { Env } from '../env.ts';

// Cache for command existence checks
const commandExistsCache = new Map<string, boolean>();

/**
 * Check if a command exists in PATH
 */
function commandExists(cmd: string): boolean {
  if (commandExistsCache.has(cmd)) {
    return commandExistsCache.get(cmd)!;
  }

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

/**
 * Helper: push unique values into an array, optionally skipping if wildcard present.
 */
function pushUnique(arr: string[], values: string[], skipWildcard: boolean): void {
  for (const v of values) {
    if (!arr.includes(v) && !(skipWildcard && arr.includes('*'))) {
      arr.push(v);
    }
  }
}

/**
 * Expand shortcut permissions (ai, clipboard, keyring, browser) into run/net arrays.
 * Mutates the permissions object in place.
 *
 * @param p - The permissions object to expand shortcuts on (mutated in place)
 * @param skipWildcard - When true, skip adding specific commands if run/net already has '*'.
 *   Used by policyToDenoFlags where adding specifics to a wildcard is pointless.
 *   When false (used by permission-overrides), always add commands since wildcards
 *   may be filtered by later deny processing.
 */
export function expandShortcutsInPlace(
  p: PolicyPermissions,
  skipWildcard: boolean,
): void {
  // Expand "ai" shortcut
  if (p.ai === true || (Array.isArray(p.ai) && p.ai.includes('*'))) {
    if (!p.run) p.run = [];
    pushUnique(p.run, getAvailableAICommands(), skipWildcard);
    if (!p.net) p.net = [];
    pushUnique(p.net, AI_NET_HOSTS, skipWildcard);
  }

  // Expand "clipboard" shortcut
  if (p.clipboard === true) {
    if (!p.run) p.run = [];
    pushUnique(p.run, getAvailableClipboardCommands(), skipWildcard);
  }

  // Expand "keyring" shortcut
  if (p.keyring === true) {
    if (!p.run) p.run = [];
    pushUnique(p.run, getAvailableKeyringCommands(), skipWildcard);
  }

  // Expand "browser" shortcut
  if (p.browser === true) {
    if (!p.run) p.run = [];
    pushUnique(p.run, [getBrowserCommand()], skipWildcard);
  }
}
