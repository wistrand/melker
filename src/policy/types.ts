// Policy types for Melker permission system
// Allows apps to declare required permissions

/**
 * Melker policy schema - declares what permissions an app needs.
 * Maps directly to Deno permission flags.
 */
/**
 * Schema property definition for app-defined config
 */
export interface PolicyConfigProperty {
  /** Value type */
  type?: 'string' | 'boolean' | 'integer' | 'number';
  /** Default value */
  default?: unknown;
  /** Minimum value (for number/integer types, enables slider in DevTools) */
  min?: number;
  /** Maximum value (for number/integer types, enables slider in DevTools) */
  max?: number;
  /** Step size (for number/integer types with slider) */
  step?: number;
  /** Environment variable that can override this value */
  env?: string;
  /** If true, env var presence means false (e.g., NO_FEATURE=1 means feature=false) */
  envInverted?: boolean;
  /** Description for documentation */
  description?: string;
}

export interface MelkerPolicy {
  /** App name (optional, for display) */
  name?: string;

  /** App version (optional, for display) */
  version?: string;

  /** App description (optional, for display) */
  description?: string;

  /**
   * Optional comment shown in approval prompt.
   * Use this to explain what the app does or why it needs certain permissions.
   * Supports multiple lines (use \n or array of strings).
   */
  comment?: string | string[];

  /** Permission declarations */
  permissions?: PolicyPermissions;

  /** App-specific configuration values */
  config?: Record<string, unknown>;

  /**
   * Schema for app-specific config properties.
   * Enables env var overrides for custom config keys.
   * Keys use dot-notation (e.g., "plasma.scale").
   */
  configSchema?: Record<string, PolicyConfigProperty>;
}

/**
 * Permission declarations - each maps to Deno flags
 */
export interface PolicyPermissions {
  /**
   * All permissions (shortcut)
   * Maps to --allow-all
   * When true, no other --allow-XX flags are needed
   */
  all?: boolean;

  /**
   * Filesystem read access
   * Paths relative to .melker file, or absolute
   * Maps to --allow-read=path1,path2
   * Special value "cwd" expands to current working directory
   * Example: ["cwd"] or ["cwd", "./data", "/etc/hosts"]
   */
  read?: string[];

  /**
   * Filesystem write access
   * Paths relative to .melker file, or absolute
   * Maps to --allow-write=path1,path2
   * Special value "cwd" expands to current working directory
   */
  write?: string[];

  /**
   * Network access
   * Hostnames or host:port patterns
   * Maps to --allow-net=host1,host2
   */
  net?: string[];

  /**
   * Subprocess execution
   * Command names (not paths)
   * Maps to --allow-run=cmd1,cmd2
   */
  run?: string[];

  /**
   * Environment variable access
   * Variable names
   * Maps to --allow-env=VAR1,VAR2
   */
  env?: string[];

  /**
   * FFI access (future)
   * Library paths
   * Maps to --allow-ffi=lib1,lib2
   */
  ffi?: string[];

  /**
   * System information access
   * Interface names: hostname, osRelease, osUptime, loadavg, networkInterfaces, systemMemoryInfo, uid, gid
   * Maps to --allow-sys=iface1,iface2
   */
  sys?: string[];

  /**
   * AI assistant access (shortcut)
   * Enables: run=[swift,ffmpeg,ffprobe,pactl,ffplay], net=[openrouter.ai]
   * Set to true or ["*"] for full AI access
   */
  ai?: boolean | string[];

  /**
   * Clipboard access (shortcut)
   * Enables: run=[pbcopy,xclip,xsel,wl-copy,clip.exe]
   * Set to true to enable clipboard operations
   */
  clipboard?: boolean;

  /**
   * System keyring access (shortcut)
   * Enables: run=[security,secret-tool,powershell]
   * Set to true to enable secure credential storage
   */
  keyring?: boolean;

  /**
   * Browser access (shortcut)
   * Enables: run=[open,xdg-open,cmd] (platform-specific)
   * Set to true to allow opening URLs in the system browser
   * Required for OAuth flows that need to open the authorization URL
   */
  browser?: boolean;

  /**
   * Shader access
   * Set to true to allow running per-pixel shaders on canvas/img elements
   * Shaders execute custom code per-pixel at high frame rates
   */
  shader?: boolean;
}

/**
 * Result of loading a policy
 */
export interface PolicyLoadResult {
  /** The parsed policy, or null if no policy found */
  policy: MelkerPolicy | null;

  /** Where the policy was loaded from */
  source: 'embedded' | 'file' | 'none';

  /** Path to the policy file (if source is 'file') */
  path?: string;
}

/**
 * CLI arguments related to policy
 */
export interface PolicyArgs {
  /** Require policy, fail if missing */
  enforcePolicy: boolean;

  /** Ignore policy, run with full permissions */
  trust: boolean;

  /** Show policy and exit */
  showPolicy: boolean;
}

/**
 * Create a default auto policy for apps without an explicit policy.
 * Grants read access to working directory and clipboard access.
 */
export function createAutoPolicy(filepath: string): MelkerPolicy {
  const filename = filepath.split('/').pop() || filepath;
  return {
    name: `${filename} (Auto Policy)`,
    description: 'Default policy - read access to working directory, clipboard access',
    permissions: {
      read: ['cwd'],
      clipboard: true,
    },
  };
}
