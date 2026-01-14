// Unified configuration system for Melker
// Schema-driven with layered overrides: defaults < file < policy < cli < env

import schema from './schema.json' with { type: 'json' };
import { Env } from '../env.ts';
import { getConfigDir } from '../xdg.ts';

// Lazy logger initialization to avoid circular dependency
// (config.ts is loaded before logging.ts is fully initialized)
// We store getLogger function reference once available
let _loggerGetter: (() => { debug: (msg: string) => void; info: (msg: string) => void; warn: (msg: string) => void }) | null = null;
let _configLogger: { debug: (msg: string) => void; info: (msg: string) => void; warn: (msg: string) => void } | null = null;

export function setLoggerGetter(getter: () => { debug: (msg: string) => void; info: (msg: string) => void; warn: (msg: string) => void }): void {
  _loggerGetter = getter;
}

function getConfigLogger(): { debug: (msg: string) => void; info: (msg: string) => void; warn: (msg: string) => void } {
  if (!_configLogger && _loggerGetter) {
    _configLogger = _loggerGetter();
  }
  // Return no-op logger if not yet initialized
  return _configLogger ?? { debug: () => {}, info: () => {}, warn: () => {} };
}

/**
 * Schema property definition
 */
interface ConfigProperty {
  type: string;
  default?: unknown;
  env?: string;
  envInverted?: boolean;
  envFormat?: string;
  flag?: string;
  flagInverted?: boolean;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  description?: string;
}

/**
 * Config schema structure
 */
interface ConfigSchema {
  properties: Record<string, ConfigProperty>;
}

/**
 * Policy config schema property (for env var overrides)
 */
export interface PolicyConfigProperty {
  type?: 'string' | 'boolean' | 'integer' | 'number';
  default?: unknown;
  env?: string;
  envInverted?: boolean;
  description?: string;
}

/**
 * Initialization options for MelkerConfig
 */
export interface ConfigInitOptions {
  policyConfig?: Record<string, unknown>;
  policyConfigSchema?: Record<string, PolicyConfigProperty>;
  cliFlags?: Record<string, unknown>;
}

/**
 * Unified configuration class for Melker.
 *
 * Priority order (lowest to highest):
 * 1. Schema defaults
 * 2. Policy config (per-app in <policy> tag)
 * 3. File config (~/.config/melker/config.json)
 * 4. Env vars
 * 5. CLI flags (highest - explicit user intent)
 */
export type ConfigSource = 'default' | 'file' | 'policy' | 'cli' | 'env' | 'runtime';

export class MelkerConfig {
  private static instance: MelkerConfig | null = null;
  private static policySchema: Record<string, PolicyConfigProperty> = {};
  private data: Record<string, unknown> = {};
  private sources: Record<string, ConfigSource> = {};

  private constructor(
    fileConfig: Record<string, unknown>,
    policyConfig: Record<string, unknown>,
    policyConfigSchema: Record<string, PolicyConfigProperty>,
    cliFlags: Record<string, unknown>
  ) {
    const s = schema as ConfigSchema;
    const schemaKeys = new Set(Object.keys(s.properties));

    // 1. Process schema-defined properties
    for (const [path, prop] of Object.entries(s.properties)) {
      const { value, source } = this.resolveValue(path, prop, fileConfig, policyConfig, cliFlags);
      this.data[path] = value;
      this.sources[path] = source;
    }

    // 2. Add custom keys from file config (not in schema)
    const flatFileConfig = this.flattenObject(fileConfig);
    for (const [path, value] of Object.entries(flatFileConfig)) {
      if (!schemaKeys.has(path)) {
        this.data[path] = value;
        this.sources[path] = 'file';
      }
    }

    // 3. Add custom keys from policy config (with env var override support)
    const flatPolicyConfig = this.flattenObject(policyConfig);
    for (const [path, value] of Object.entries(flatPolicyConfig)) {
      if (!schemaKeys.has(path) && !(path in this.data)) {
        // Check if policy schema defines an env var for this key
        const propSchema = policyConfigSchema[path];
        if (propSchema?.env) {
          const envVal = Env.get(propSchema.env);
          if (envVal !== undefined) {
            const parsed = this.parseEnvValueForType(envVal, propSchema.type || 'string');
            this.data[path] = propSchema.envInverted ? !parsed : parsed;
            this.sources[path] = 'env';
            continue;
          }
        }
        this.data[path] = value;
        this.sources[path] = 'policy';
      }
    }

    // 4. Process policy schema defaults (for keys not in policy config)
    for (const [path, propSchema] of Object.entries(policyConfigSchema)) {
      if (!(path in this.data)) {
        // Check env var first
        if (propSchema.env) {
          const envVal = Env.get(propSchema.env);
          if (envVal !== undefined) {
            const parsed = this.parseEnvValueForType(envVal, propSchema.type || 'string');
            this.data[path] = propSchema.envInverted ? !parsed : parsed;
            this.sources[path] = 'env';
            continue;
          }
        }
        // Use default if defined
        if (propSchema.default !== undefined) {
          this.data[path] = propSchema.default;
          this.sources[path] = 'default';
        }
      }
    }
  }

  /**
   * Parse env value based on type (for policy config schema)
   */
  private parseEnvValueForType(value: string, type: string): unknown {
    switch (type) {
      case 'boolean':
        return value === 'true' || value === '1';
      case 'integer':
        return parseInt(value, 10);
      case 'number':
        return parseFloat(value);
      default:
        return value;
    }
  }

  /**
   * Flatten a nested object into dot-notation keys.
   * e.g., { a: { b: 1 } } => { 'a.b': 1 }
   */
  private flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(result, this.flattenObject(value as Record<string, unknown>, path));
      } else {
        result[path] = value;
      }
    }
    return result;
  }

  private resolveValue(
    path: string,
    prop: ConfigProperty,
    fileConfig: Record<string, unknown>,
    policyConfig: Record<string, unknown>,
    cliFlags: Record<string, unknown>
  ): { value: unknown; source: ConfigSource } {
    // Priority: cli > env > file > policy > default

    // 1. CLI flag (highest - explicit user intent)
    if (prop.flag) {
      const flagVal = this.getPath(cliFlags, path);
      if (flagVal !== undefined) {
        return { value: prop.flagInverted ? !flagVal : flagVal, source: 'cli' };
      }
    }

    // 2. Env var
    if (prop.env) {
      const envVal = Env.get(prop.env);
      if (envVal !== undefined) {
        const parsed = this.parseEnvValue(envVal, prop);
        return { value: prop.envInverted ? !parsed : parsed, source: 'env' };
      }
    }

    // 3. File config (~/.config/melker/config.json)
    const fileVal = this.getPath(fileConfig, path);
    if (fileVal !== undefined) return { value: fileVal, source: 'file' };

    // 4. Policy config (per-app)
    const policyVal = this.getPath(policyConfig, path);
    if (policyVal !== undefined) return { value: policyVal, source: 'policy' };

    // 5. Default from schema
    return { value: prop.default, source: 'default' };
  }

  private parseEnvValue(value: string, prop: ConfigProperty): unknown {
    switch (prop.type) {
      case 'boolean':
        return value === 'true' || value === '1';
      case 'integer':
        return parseInt(value, 10);
      case 'number':
        return parseFloat(value);
      case 'object':
        if (prop.envFormat === 'name: value; name2: value2') {
          // Parse header format: "Content-Type: application/json; Authorization: Bearer token"
          const result: Record<string, string> = {};
          for (const pair of value.split(';')) {
            const colonIdx = pair.indexOf(':');
            if (colonIdx > 0) {
              const k = pair.substring(0, colonIdx).trim();
              const v = pair.substring(colonIdx + 1).trim();
              if (k && v) result[k] = v;
            }
          }
          return result;
        }
        try {
          return JSON.parse(value);
        } catch {
          return undefined;
        }
      default:
        return value;
    }
  }

  private getPath(obj: Record<string, unknown>, path: string): unknown {
    // First check if the full path exists as a flat key (e.g., CLI flags)
    if (path in obj) {
      return obj[path];
    }

    // Then try nested lookup (e.g., file config, policy config)
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  /**
   * Initialize config (call once at startup)
   */
  static init(options?: ConfigInitOptions): MelkerConfig {
    if (this.instance) {
      throw new Error('MelkerConfig already initialized. Call reset() first if re-initialization is needed.');
    }
    const fileConfig = this.loadConfigFile();
    this.policySchema = options?.policyConfigSchema ?? {};
    this.instance = new MelkerConfig(
      fileConfig,
      options?.policyConfig ?? {},
      this.policySchema,
      options?.cliFlags ?? {}
    );
    return this.instance;
  }

  /**
   * Get initialized config (auto-inits with defaults if not initialized)
   */
  static get(): MelkerConfig {
    if (!this.instance) {
      return this.init();
    }
    return this.instance;
  }

  /**
   * Check if config has been initialized
   */
  static isInitialized(): boolean {
    return this.instance !== null;
  }

  /**
   * Reset singleton (for testing)
   */
  static reset(): void {
    this.instance = null;
    this.policySchema = {};
  }

  /**
   * Apply CLI flags to existing config (for late initialization)
   * Useful when config auto-initializes before CLI flags are parsed.
   */
  static applyCliFlags(cliFlags: Record<string, unknown>): void {
    if (!this.instance) {
      // Not initialized yet, init with CLI flags
      this.init({ cliFlags });
      return;
    }

    // Re-resolve all values with CLI flags
    const s = schema as ConfigSchema;

    for (const [path, prop] of Object.entries(s.properties)) {
      // Only re-resolve if this property has a CLI flag and it was provided
      if (prop.flag && path in cliFlags) {
        const flagVal = cliFlags[path];
        if (flagVal !== undefined) {
          // Note: flagInverted is already handled in parseCliFlags, don't invert again
          this.instance.data[path] = flagVal;
          this.instance.sources[path] = 'cli';
        }
      }
    }
  }

  /**
   * Apply policy config to existing config (for late initialization)
   * Only applies values that aren't already set by higher-priority sources (env, cli).
   */
  static applyPolicyConfig(policyConfig: Record<string, unknown>, policyConfigSchema?: Record<string, PolicyConfigProperty>): void {
    if (!this.instance) {
      // Not initialized yet, init with policy config
      this.init({ policyConfig, policyConfigSchema });
      return;
    }

    // Store schema if provided
    if (policyConfigSchema) {
      this.policySchema = policyConfigSchema;
    }

    const s = schema as ConfigSchema;
    const schemaKeys = new Set(Object.keys(s.properties));

    // Apply schema-defined properties
    for (const [path] of Object.entries(s.properties)) {
      // Only apply if current source is lower priority than policy
      const currentSource = this.instance.sources[path];
      if (currentSource === 'default') {
        // Policy overrides default
        const policyVal = this.instance.getPath(policyConfig, path);
        if (policyVal !== undefined) {
          this.instance.data[path] = policyVal;
          this.instance.sources[path] = 'policy';
        }
      }
    }

    // Apply custom keys from policy (with env var override support)
    const flatPolicyConfig = this.instance.flattenObject(policyConfig);
    for (const [path, value] of Object.entries(flatPolicyConfig)) {
      if (!schemaKeys.has(path) && !(path in this.instance.data)) {
        // Check if policy schema defines an env var for this key
        const propSchema = this.policySchema[path];
        if (propSchema?.env) {
          const envVal = Env.get(propSchema.env);
          if (envVal !== undefined) {
            const parsed = this.instance.parseEnvValueForType(envVal, propSchema.type || 'string');
            this.instance.data[path] = propSchema.envInverted ? !parsed : parsed;
            this.instance.sources[path] = 'env';
            continue;
          }
        }
        this.instance.data[path] = value;
        this.instance.sources[path] = 'policy';
      }
    }

    // Process policy schema defaults (for keys not in policy config)
    for (const [path, propSchema] of Object.entries(this.policySchema)) {
      if (!(path in this.instance.data)) {
        // Check env var first
        if (propSchema.env) {
          const envVal = Env.get(propSchema.env);
          if (envVal !== undefined) {
            const parsed = this.instance.parseEnvValueForType(envVal, propSchema.type || 'string');
            this.instance.data[path] = propSchema.envInverted ? !parsed : parsed;
            this.instance.sources[path] = 'env';
            continue;
          }
        }
        // Use default if defined
        if (propSchema.default !== undefined) {
          this.instance.data[path] = propSchema.default;
          this.instance.sources[path] = 'default';
        }
      }
    }
  }

  private static loadConfigFile(): Record<string, unknown> {
    const configPath = `${getConfigDir()}/config.json`;
    try {
      const content = Deno.readTextFileSync(configPath);
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  /**
   * Get the schema for documentation/validation
   */
  static getSchema(): ConfigSchema {
    return schema as ConfigSchema;
  }

  /**
   * Print current config with sources to stdout
   */
  static printConfig(): void {
    console.log(this.getConfigText());
  }

  /**
   * Get current config formatted as text (for dev tools dialog)
   */
  static getConfigText(): string {
    const instance = this.get();
    const s = schema as ConfigSchema;
    const configPath = `${getConfigDir()}/config.json`;
    const lines: string[] = [];

    lines.push('Melker Configuration');
    lines.push('====================');
    lines.push('');

    lines.push(`Config file: ${configPath}`);
    try {
      Deno.statSync(configPath);
      lines.push('  (exists)');
    } catch {
      lines.push('  (not found)');
    }
    lines.push('');

    lines.push('Priority: default < policy < file < env < cli');
    lines.push('');

    // Group by category
    const categories = new Map<string, Array<{ path: string; prop: ConfigProperty }>>();
    for (const [path, prop] of Object.entries(s.properties)) {
      const category = path.includes('.') ? path.split('.')[0] : 'general';
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      categories.get(category)!.push({ path, prop });
    }

    // Sort categories
    const sortedCategories = [...categories.keys()].sort((a, b) => {
      if (a === 'general') return -1;
      if (b === 'general') return 1;
      return a.localeCompare(b);
    });

    for (const category of sortedCategories) {
      const entries = categories.get(category)!;
      const title = category.charAt(0).toUpperCase() + category.slice(1);
      lines.push(`[${title}]`);

      for (const { path, prop } of entries) {
        const value = instance.data[path];
        const source = instance.sources[path];
        const displayValue = value === undefined ? '(not set)' :
          typeof value === 'object' ? JSON.stringify(value) : String(value);

        // Format source indicator
        let sourceStr = '';
        switch (source) {
          case 'env':
            sourceStr = ` <- ${prop.env}`;
            break;
          case 'cli':
            sourceStr = ` <- ${prop.flag}`;
            break;
          case 'file':
            sourceStr = ' <- config.json';
            break;
          case 'policy':
            sourceStr = ' <- policy';
            break;
          case 'default':
            sourceStr = '';
            break;
        }

        // Show env var / flag info for reference
        const refs: string[] = [];
        if (prop.flag) refs.push(prop.flag);
        if (prop.env) refs.push(prop.env);
        const refStr = refs.length > 0 ? ` (${refs.join(', ')})` : '';

        lines.push(`  ${path} = ${displayValue}${sourceStr}${source === 'default' ? refStr : ''}`);
      }
      lines.push('');
    }

    // Add custom (non-schema) config keys
    const schemaKeys = new Set(Object.keys(s.properties));
    const customKeys = Object.keys(instance.data).filter(k => !schemaKeys.has(k)).sort();

    if (customKeys.length > 0) {
      // Group custom keys by first path segment
      const customCategories = new Map<string, string[]>();
      for (const key of customKeys) {
        const category = key.includes('.') ? key.split('.')[0] : 'custom';
        if (!customCategories.has(category)) {
          customCategories.set(category, []);
        }
        customCategories.get(category)!.push(key);
      }

      for (const [category, keys] of [...customCategories.entries()].sort()) {
        const title = category.charAt(0).toUpperCase() + category.slice(1) + ' (app)';
        lines.push(`[${title}]`);

        for (const path of keys) {
          const value = instance.data[path];
          const source = instance.sources[path];
          const displayValue = value === undefined ? '(not set)' :
            typeof value === 'object' ? JSON.stringify(value) : String(value);

          // Get policy schema for this key (if exists)
          const propSchema = this.policySchema[path];

          // Format source indicator
          let sourceStr = '';
          switch (source) {
            case 'env':
              sourceStr = propSchema?.env ? ` <- ${propSchema.env}` : ' <- env';
              break;
            case 'policy':
              sourceStr = ' <- policy';
              break;
            case 'file':
              sourceStr = ' <- config.json';
              break;
            case 'cli':
              sourceStr = ' <- cli';
              break;
            case 'runtime':
              sourceStr = ' <- runtime';
              break;
            case 'default':
              sourceStr = '';
              break;
          }

          // Show env var info for reference (on default values)
          const refStr = (source === 'default' || source === 'policy') && propSchema?.env
            ? ` (${propSchema.env})`
            : '';

          lines.push(`  ${path} = ${displayValue}${sourceStr}${refStr}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Generic getters for any config property
  // ============================================================================

  /**
   * Get a string config value by key path (e.g., 'theme', 'ai.model')
   */
  getString(key: string, defaultValue: string): string {
    const value = this.data[key];
    if (value === undefined || value === null) return defaultValue;
    return String(value);
  }

  /**
   * Get a boolean config value by key path
   */
  getBoolean(key: string, defaultValue: boolean): boolean {
    const value = this.data[key];
    if (value === undefined || value === null) return defaultValue;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value === 'true' || value === '1';
    return Boolean(value);
  }

  /**
   * Get a number config value by key path
   */
  getNumber(key: string, defaultValue: number): number {
    const value = this.data[key];
    if (value === undefined || value === null) return defaultValue;
    if (typeof value === 'number') return value;
    const parsed = parseFloat(String(value));
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Get any config value by key path (returns undefined if not set)
   */
  getValue(key: string): unknown {
    return this.data[key];
  }

  /**
   * Check if a config key exists
   */
  hasKey(key: string): boolean {
    return key in this.data;
  }

  /**
   * Set a config value at runtime (for DevTools Edit Config)
   * Coerces value to the correct type based on schema to avoid repeated parsing
   */
  setValue(key: string, value: unknown): void {
    const oldValue = this.data[key];

    // Coerce value based on schema type (policy schema or main schema)
    const policyProp = MelkerConfig.policySchema[key];
    const schemaProp = (schema as ConfigSchema).properties[key];
    const propType = policyProp?.type ?? schemaProp?.type;

    let coercedValue = value;
    if (propType && typeof value === 'string') {
      switch (propType) {
        case 'number':
          coercedValue = parseFloat(value);
          if (isNaN(coercedValue as number)) coercedValue = value;
          break;
        case 'integer':
          coercedValue = parseInt(value, 10);
          if (isNaN(coercedValue as number)) coercedValue = value;
          break;
        case 'boolean':
          coercedValue = value === 'true' || value === '1';
          break;
      }
    }

    this.data[key] = coercedValue;
    this.sources[key] = 'runtime';
    getConfigLogger().info(`Config updated: ${key} = ${JSON.stringify(coercedValue)} (was: ${JSON.stringify(oldValue)})`);
  }

  // ============================================================================
  // Typed getters - defaults come from schema.json via resolveValue()
  // ============================================================================

  // Theme
  get theme(): string {
    return this.data['theme'] as string;
  }

  // Logging
  get logLevel(): string {
    return this.data['log.level'] as string;
  }

  get logFile(): string | undefined {
    return this.data['log.file'] as string | undefined;
  }

  // AI
  get aiModel(): string {
    return this.data['ai.model'] as string;
  }

  get aiAudioModel(): string {
    return this.data['ai.audioModel'] as string;
  }

  get aiEndpoint(): string {
    return this.data['ai.endpoint'] as string;
  }

  get aiHeaders(): Record<string, string> | undefined {
    return this.data['ai.headers'] as Record<string, string> | undefined;
  }

  get aiSiteName(): string | undefined {
    return this.data['ai.siteName'] as string | undefined;
  }

  get aiSiteUrl(): string | undefined {
    return this.data['ai.siteUrl'] as string | undefined;
  }

  get aiAudioGain(): number {
    return this.data['ai.audioGain'] as number;
  }

  // Dithering
  get ditherAlgorithm(): string | undefined {
    return this.data['dither.algorithm'] as string | undefined;
  }

  get ditherBits(): number | undefined {
    return this.data['dither.bits'] as number | undefined;
  }

  get blueNoisePath(): string | undefined {
    return this.data['dither.blueNoisePath'] as string | undefined;
  }

  // Terminal
  get terminalAlternateScreen(): boolean {
    return this.data['terminal.alternateScreen'] as boolean;
  }

  get terminalSyncRendering(): boolean {
    return this.data['terminal.syncRendering'] as boolean;
  }

  get terminalForceFFmpeg(): boolean {
    return this.data['terminal.forceFFmpeg'] as boolean;
  }

  // Render
  get gfxMode(): 'sextant' | 'block' | 'pattern' | 'luma' | undefined {
    // Only return gfxMode if explicitly set (env, cli, file, policy) - not schema default
    // This allows per-element gfxMode props to take effect when no global override
    if (this.sources['render.gfxMode'] === 'default') {
      return undefined;
    }
    return this.data['render.gfxMode'] as 'sextant' | 'block' | 'pattern' | 'luma';
  }

  // Headless
  get headlessEnabled(): boolean {
    return this.data['headless.enabled'] as boolean;
  }

  get headlessWidth(): number {
    return this.data['headless.width'] as number;
  }

  get headlessHeight(): number {
    return this.data['headless.height'] as number;
  }

  // Debug
  get debugPort(): number | undefined {
    return this.data['debug.port'] as number | undefined;
  }

  get debugHost(): string {
    return this.data['debug.host'] as string;
  }

  get debugAllowRemoteInput(): boolean {
    return this.data['debug.allowRemoteInput'] as boolean;
  }

  get debugRetainBundle(): boolean {
    return this.data['debug.retainBundle'] as boolean;
  }

  get debugShowStats(): boolean {
    return this.data['debug.showStats'] as boolean;
  }

  get debugMarkdownDebug(): boolean {
    return this.data['debug.markdownDebug'] as boolean;
  }

  get debugAudioDebug(): boolean {
    return this.data['debug.audioDebug'] as boolean;
  }

  // Persistence
  get persist(): boolean {
    return this.data['persist'] as boolean;
  }

  // Lint
  get lint(): boolean {
    return this.data['lint'] as boolean;
  }

  // Script
  get consoleOverride(): boolean {
    return this.data['script.consoleOverride'] as boolean;
  }

  // OAuth
  get oauthClientId(): string {
    return this.data['oauth.clientId'] as string;
  }

  get oauthPort(): number {
    return this.data['oauth.port'] as number;
  }

  get oauthPath(): string {
    return this.data['oauth.path'] as string;
  }

  get oauthRedirectUri(): string | undefined {
    return this.data['oauth.redirectUri'] as string | undefined;
  }

  get oauthScopes(): string {
    return this.data['oauth.scopes'] as string;
  }

  get oauthAudience(): string | undefined {
    return this.data['oauth.audience'] as string | undefined;
  }

  get oauthWellknownUrl(): string | undefined {
    return this.data['oauth.wellknownUrl'] as string | undefined;
  }
}
