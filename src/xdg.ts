// XDG Base Directory Specification support
// https://specifications.freedesktop.org/basedir/latest/

import { Env } from './env.ts';

const APP_NAME = 'melker';

/**
 * Get the home directory, with Windows fallback
 */
function getHomeDir(): string {
  return Env.get('HOME') || Env.get('USERPROFILE') || '.';
}

/**
 * Get the XDG state directory for user-specific state data.
 * State data should persist between restarts but is not important enough for data home.
 * Examples: logs, recently used files, application state.
 *
 * Default: $HOME/.local/state/melker
 */
export function getStateDir(): string {
  const xdgStateHome = Env.get('XDG_STATE_HOME');
  const baseDir = xdgStateHome || `${getHomeDir()}/.local/state`;
  return `${baseDir}/${APP_NAME}`;
}

/**
 * Get the XDG config directory for user-specific configuration files.
 *
 * Default: $HOME/.config/melker
 */
export function getConfigDir(): string {
  const xdgConfigHome = Env.get('XDG_CONFIG_HOME');
  const baseDir = xdgConfigHome || `${getHomeDir()}/.config`;
  return `${baseDir}/${APP_NAME}`;
}

/**
 * Get the XDG cache directory for user-specific non-essential cached data.
 *
 * Default: $HOME/.cache/melker
 */
export function getCacheDir(): string {
  const xdgCacheHome = Env.get('XDG_CACHE_HOME');
  const baseDir = xdgCacheHome || `${getHomeDir()}/.cache`;
  return `${baseDir}/${APP_NAME}`;
}

/**
 * Get the XDG data directory for user-specific data files.
 *
 * Default: $HOME/.local/share/melker
 */
export function getDataDir(): string {
  const xdgDataHome = Env.get('XDG_DATA_HOME');
  const baseDir = xdgDataHome || `${getHomeDir()}/.local/share`;
  return `${baseDir}/${APP_NAME}`;
}

/**
 * Get the system temp directory.
 * Checks TMPDIR (Unix/macOS), TEMP, TMP (Windows), falls back to /tmp.
 */
export function getTempDir(): string {
  return Env.get('TMPDIR') ||
         Env.get('TEMP') ||
         Env.get('TMP') ||
         '/tmp';
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export async function ensureDir(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
}
