// XDG Base Directory Specification support
// https://specifications.freedesktop.org/basedir/latest/

const APP_NAME = 'melker';

/**
 * Get the home directory, with Windows fallback
 */
function getHomeDir(): string {
  return Deno.env.get('HOME') || Deno.env.get('USERPROFILE') || '.';
}

/**
 * Get the XDG state directory for user-specific state data.
 * State data should persist between restarts but is not important enough for data home.
 * Examples: logs, recently used files, application state.
 *
 * Default: $HOME/.local/state/melker
 */
export function getStateDir(): string {
  const xdgStateHome = Deno.env.get('XDG_STATE_HOME');
  const baseDir = xdgStateHome || `${getHomeDir()}/.local/state`;
  return `${baseDir}/${APP_NAME}`;
}

/**
 * Get the XDG config directory for user-specific configuration files.
 *
 * Default: $HOME/.config/melker
 */
export function getConfigDir(): string {
  const xdgConfigHome = Deno.env.get('XDG_CONFIG_HOME');
  const baseDir = xdgConfigHome || `${getHomeDir()}/.config`;
  return `${baseDir}/${APP_NAME}`;
}

/**
 * Get the XDG cache directory for user-specific non-essential cached data.
 *
 * Default: $HOME/.cache/melker
 */
export function getCacheDir(): string {
  const xdgCacheHome = Deno.env.get('XDG_CACHE_HOME');
  const baseDir = xdgCacheHome || `${getHomeDir()}/.cache`;
  return `${baseDir}/${APP_NAME}`;
}

/**
 * Get the XDG data directory for user-specific data files.
 *
 * Default: $HOME/.local/share/melker
 */
export function getDataDir(): string {
  const xdgDataHome = Deno.env.get('XDG_DATA_HOME');
  const baseDir = xdgDataHome || `${getHomeDir()}/.local/share`;
  return `${baseDir}/${APP_NAME}`;
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
