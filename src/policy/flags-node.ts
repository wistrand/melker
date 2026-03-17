// Convert policy to Node.js permission flags
//
// Mirrors flags.ts but targets Node's --permission flag system.
// Key differences from Deno:
//   - Net is binary (--allow-net, no per-host filtering)
//   - Child process is binary (--allow-child-process, no per-command filtering)
//   - No --allow-env, --allow-sys, --deny-* equivalents
//   - FS paths use --allow-fs-read / --allow-fs-write

import { resolve } from '../deps.ts';
import type { MelkerPolicy, PolicyPermissions } from './types.ts';
import { getTempDir } from '../xdg.ts';
import { Env } from '../env.ts';
import { MelkerConfigCore as MelkerConfig } from '../config/config-core.ts';
import { expandShortcutsInPlace } from './shortcut-utils.ts';
import { cwd } from '../runtime/mod.ts';
import { expandPolicyPath } from './flags.ts';

/**
 * Ensure a path ends with /* for Node's --permission model.
 * Node requires trailing /* for recursive directory access;
 * a bare /path/to/dir only grants access to the directory entry itself.
 */
function dirGlob(path: string): string {
  if (path.endsWith('/*') || path === '*') return path;
  return path.endsWith('/') ? `${path}*` : `${path}/*`;
}

/**
 * Convert a MelkerPolicy to Node.js permission flags.
 *
 * @param policy - The app policy
 * @param appDir - Directory containing the app file
 * @param melkerDir - Root directory of the melker installation (for src/ and node_modules/)
 * @param urlHash - Hash of the app URL/filepath (for app-specific cache)
 * @param isRemote - Whether this is a remote app
 */
export function policyToNodeFlags(
  policy: MelkerPolicy,
  appDir: string,
  melkerDir: string,
  urlHash?: string,
  isRemote?: boolean,
): string[] {
  const orig = policy.permissions || {};

  // Deep clone to avoid mutating the original
  const p: PolicyPermissions = {
    ...orig,
    read: orig.read ? [...orig.read] : undefined,
    write: orig.write ? [...orig.write] : undefined,
    net: orig.net ? [...orig.net] : undefined,
    run: orig.run ? [...orig.run] : undefined,
    ffi: orig.ffi ? [...orig.ffi] : undefined,
  };

  // Handle "all" permission — skip --permission entirely
  if (p.all === true) {
    return [];
  }

  // Expand shortcut permissions (ai, clipboard, keyring, browser) into run/net arrays
  expandShortcutsInPlace(p, true);

  const flags: string[] = [];

  // Always enable the permission model
  flags.push('--permission');

  // ── Filesystem read ─────────────────────────────────────────────────────
  // Node requires separate --allow-fs-read flags per path (no comma separation)
  if (p.read?.includes('*')) {
    flags.push('--allow-fs-read=*');
  } else {
    const readPaths = buildNodeReadPaths(p.read, appDir, melkerDir, urlHash, isRemote);
    for (const rp of readPaths) {
      flags.push(`--allow-fs-read=${rp}`);
    }
  }

  // ── Filesystem write ────────────────────────────────────────────────────
  if (p.write?.includes('*')) {
    flags.push('--allow-fs-write=*');
  } else {
    const writePaths = buildNodeWritePaths(p.write, appDir, urlHash);
    for (const wp of writePaths) {
      flags.push(`--allow-fs-write=${wp}`);
    }
  }

  // ── Network (binary — all or nothing) ───────────────────────────────────
  // Implicit: localhost when server or headless mode is enabled
  const config = MelkerConfig.get();
  if (config.serverPort !== undefined || config.serverEnabled || config.headlessEnabled) {
    if (!p.net) p.net = [];
    if (!p.net.includes('*') && !p.net.includes('localhost')) {
      p.net.push('localhost');
    }
  }
  if (p.net && p.net.length > 0) {
    flags.push('--allow-net');
  }

  // ── Child process (always — esbuild spawns its binary) ───────────────────
  flags.push('--allow-child-process');

  // ── Worker threads (always — esbuild needs them) ────────────────────────
  flags.push('--allow-worker');

  // ── Native addons (maps to ffi) ─────────────────────────────────────────
  if (p.ffi && p.ffi.length > 0) {
    flags.push('--allow-addons');
  }

  return flags;
}

/**
 * Build read paths for Node.js --allow-fs-read.
 * Includes Node-specific implicit paths (melker source, node_modules, Node binary dir).
 */
function buildNodeReadPaths(
  policyPaths: string[] | undefined,
  appDir: string,
  melkerDir: string,
  urlHash?: string,
  isRemote?: boolean,
): string[] {
  const paths: string[] = [];

  // Melker installation directory (src/, loader, runner)
  paths.push(dirGlob(melkerDir));

  // When npm-installed, melkerDir is node_modules/@melker/melker —
  // include the parent node_modules so sibling deps (html5parser etc.) are readable
  if (melkerDir.includes('node_modules')) {
    const nmIdx = melkerDir.lastIndexOf('node_modules');
    paths.push(dirGlob(melkerDir.substring(0, nmIdx + 'node_modules'.length)));
  }

  // Temp dir for bundler temp files
  paths.push(dirGlob(getTempDir()));

  // App directory
  paths.push(dirGlob(appDir));

  // Current working directory (local apps only)
  if (!isRemote) {
    try {
      paths.push(dirGlob(cwd()));
    } catch {
      // Ignore if cwd is not accessible
    }
  }

  // Node.js binary directory (for the runtime itself)
  const nodeExecPath = Env.get('_');
  if (nodeExecPath) {
    const nodeDir = nodeExecPath.substring(0, nodeExecPath.lastIndexOf('/'));
    if (nodeDir) paths.push(dirGlob(nodeDir));
  }

  // XDG state dir for persistence
  const xdgState = Env.get('XDG_STATE_HOME') || `${Env.get('HOME')}/.local/state`;
  paths.push(dirGlob(`${xdgState}/melker`));

  // App-specific cache dir
  if (urlHash) {
    const xdgCache = Env.get('XDG_CACHE_HOME') || `${Env.get('HOME')}/.cache`;
    paths.push(dirGlob(`${xdgCache}/melker/app-cache/${urlHash}`));
  }

  // Policy-declared read paths (expand variables, tilde, cwd, relative paths)
  if (policyPaths) {
    for (const p of policyPaths) {
      const resolved = expandPolicyPath(p, appDir);
      if (resolved) paths.push(dirGlob(resolved));
    }
  }

  return [...new Set(paths)];
}

/**
 * Build write paths for Node.js --allow-fs-write.
 */
function buildNodeWritePaths(
  policyPaths: string[] | undefined,
  appDir: string,
  urlHash?: string,
): string[] {
  const paths: string[] = [];

  // Temp dir for bundler temp files
  paths.push(dirGlob(getTempDir()));

  // XDG state dir for persistence
  const xdgState = Env.get('XDG_STATE_HOME') || `${Env.get('HOME')}/.local/state`;
  paths.push(dirGlob(`${xdgState}/melker`));

  // Log file directory
  const logFile = MelkerConfig.get().logFile;
  if (logFile) {
    const logDir = logFile.substring(0, logFile.lastIndexOf('/')) || '.';
    paths.push(dirGlob(logDir));
  } else {
    const home = Env.get('HOME');
    if (home) {
      paths.push(dirGlob(`${home}/.cache/melker/logs`));
    }
  }

  // App-specific cache dir
  if (urlHash) {
    const xdgCache = Env.get('XDG_CACHE_HOME') || `${Env.get('HOME')}/.cache`;
    paths.push(dirGlob(`${xdgCache}/melker/app-cache/${urlHash}`));
  }

  // Policy-declared write paths (expand variables, tilde, cwd, relative paths)
  if (policyPaths) {
    for (const p of policyPaths) {
      const resolved = expandPolicyPath(p, appDir);
      if (resolved) paths.push(dirGlob(resolved));
    }
  }

  return [...new Set(paths)];
}

/**
 * Format Node permission flags for display
 */
export function formatNodeFlags(flags: string[]): string {
  if (flags.length === 0) {
    return '  (no restrictions — full permissions)';
  }
  return flags.map(f => `  ${f}`).join('\n');
}
