// CLI argument parser driven by schema.json

import schema from './schema.json' with { type: 'json' };

interface ConfigProperty {
  type: string;
  default?: unknown;
  env?: string;
  envInverted?: boolean;
  flag?: string;
  flagInverted?: boolean;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  description?: string;
}

interface ConfigSchema {
  properties: Record<string, ConfigProperty>;
}

interface ParsedCliFlags {
  flags: Record<string, unknown>;
  remaining: string[];
}

/**
 * Parse CLI arguments based on schema flag definitions
 * @param args Command line arguments (typically Deno.args)
 * @returns Object with parsed flags and remaining arguments
 */
export function parseCliFlags(args: string[]): ParsedCliFlags {
  const s = schema as ConfigSchema;
  const flags: Record<string, unknown> = {};
  const remaining: string[] = [];

  // Build a map of flag -> { path, prop } for quick lookup
  const flagMap = new Map<string, { path: string; prop: ConfigProperty }>();
  for (const [path, prop] of Object.entries(s.properties)) {
    if (prop.flag) {
      flagMap.set(prop.flag, { path, prop });
    }
  }

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    // Check for --flag=value syntax
    const eqIndex = arg.indexOf('=');
    let flagName: string;
    let flagValue: string | undefined;

    if (eqIndex > 0 && arg.startsWith('--')) {
      flagName = arg.substring(0, eqIndex);
      flagValue = arg.substring(eqIndex + 1);
    } else {
      flagName = arg;
      flagValue = undefined;
    }

    const entry = flagMap.get(flagName);
    if (entry) {
      const { path, prop } = entry;

      if (prop.type === 'boolean') {
        // Boolean flags: presence means true (or false if inverted)
        const value = prop.flagInverted ? false : true;
        flags[path] = value;
      } else {
        // Non-boolean flags need a value
        if (flagValue === undefined) {
          // Check next arg for value
          if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
            flagValue = args[i + 1];
            i++;
          } else {
            const enumHint = prop.enum ? ` [${prop.enum.join('|')}]` : '';
            console.error(`Error: ${flagName} requires a value${enumHint}`);
            Deno.exit(1);
          }
        }

        // Parse value based on type
        flags[path] = parseValue(flagValue, prop);
      }
    } else if (arg.startsWith('--')) {
      // Unknown flag - pass through to remaining (launcher-specific flags)
      remaining.push(arg);
    } else {
      // Non-flag argument
      remaining.push(arg);
    }

    i++;
  }

  return { flags, remaining };
}

/**
 * Parse a string value to the appropriate type based on schema
 */
function parseValue(value: string, prop: ConfigProperty): unknown {
  switch (prop.type) {
    case 'boolean':
      return value === 'true' || value === '1';
    case 'integer':
      const intVal = parseInt(value, 10);
      if (isNaN(intVal)) {
        console.error(`Error: Invalid integer value: ${value}`);
        Deno.exit(1);
      }
      return intVal;
    case 'number':
      const numVal = parseFloat(value);
      if (isNaN(numVal)) {
        console.error(`Error: Invalid number value: ${value}`);
        Deno.exit(1);
      }
      return numVal;
    default:
      return value;
  }
}

/**
 * Generate help text for config options from schema
 */
export function generateConfigHelp(): string {
  const s = schema as ConfigSchema;
  const lines: string[] = [];

  lines.push('Configuration Options:');
  lines.push('');

  // Group by category (first part of path)
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
    // Put 'general' first
    if (a === 'general') return -1;
    if (b === 'general') return 1;
    return a.localeCompare(b);
  });

  for (const category of sortedCategories) {
    const entries = categories.get(category)!;
    const categoryTitle = category.charAt(0).toUpperCase() + category.slice(1);
    lines.push(`  ${categoryTitle}:`);

    for (const { path, prop } of entries) {
      const parts: string[] = [];

      // Flag (if any)
      if (prop.flag) {
        if (prop.type === 'boolean') {
          parts.push(prop.flag);
        } else {
          parts.push(`${prop.flag} <value>`);
        }
      }

      // Env var (if any)
      if (prop.env) {
        parts.push(prop.env);
      }

      // Build the option line
      const optionStr = parts.join(' | ');
      const desc = prop.description || path;

      // Type info
      let typeInfo = '';
      if (prop.enum) {
        typeInfo = ` [${prop.enum.join('|')}]`;
      } else if (prop.type !== 'boolean') {
        typeInfo = ` (${prop.type})`;
      }

      // Default value
      let defaultStr = '';
      if (prop.default !== undefined) {
        defaultStr = ` (default: ${prop.default})`;
      }

      // Inverted note
      let invertedNote = '';
      if (prop.envInverted) {
        invertedNote = ' [inverted]';
      }

      if (optionStr) {
        lines.push(`    ${optionStr}`);
        lines.push(`      ${desc}${typeInfo}${defaultStr}${invertedNote}`);
      } else {
        // Config-file only option
        lines.push(`    [config: ${path}]`);
        lines.push(`      ${desc}${typeInfo}${defaultStr}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate compact help for CLI flags only (for --help)
 */
export function generateFlagHelp(): string {
  const s = schema as ConfigSchema;
  const lines: string[] = [];

  lines.push('  Config flags (from schema):');

  // Collect all flags
  const flagEntries: Array<{ flag: string; prop: ConfigProperty }> = [];
  for (const [, prop] of Object.entries(s.properties)) {
    if (prop.flag) {
      flagEntries.push({ flag: prop.flag, prop });
    }
  }

  // Sort by flag name
  flagEntries.sort((a, b) => a.flag.localeCompare(b.flag));

  for (const { flag, prop } of flagEntries) {
    let flagStr = flag;
    if (prop.type !== 'boolean') {
      flagStr += ' <value>';
    }

    const desc = prop.description || '';
    let envNote = '';
    if (prop.env) {
      envNote = ` (env: ${prop.env})`;
    }

    // Pad for alignment
    const padded = flagStr.padEnd(22);
    lines.push(`  ${padded} ${desc}${envNote}`);
  }

  return lines.join('\n');
}

/**
 * Generate environment variable reference
 */
export function generateEnvVarHelp(): string {
  const s = schema as ConfigSchema;
  const lines: string[] = [];

  lines.push('Environment Variables:');
  lines.push('');

  // Collect all env vars
  const envEntries: Array<{ env: string; prop: ConfigProperty; path: string }> = [];
  for (const [path, prop] of Object.entries(s.properties)) {
    if (prop.env) {
      envEntries.push({ env: prop.env, prop, path });
    }
  }

  // Sort by env var name
  envEntries.sort((a, b) => a.env.localeCompare(b.env));

  for (const { env, prop } of envEntries) {
    const desc = prop.description || '';
    let typeInfo = '';
    if (prop.enum) {
      typeInfo = ` [${prop.enum.join('|')}]`;
    } else if (prop.type === 'boolean') {
      typeInfo = ' [true|false|1|0]';
    } else if (prop.type !== 'string') {
      typeInfo = ` (${prop.type})`;
    }

    let defaultStr = '';
    if (prop.default !== undefined) {
      defaultStr = ` (default: ${prop.default})`;
    }

    let invertedNote = '';
    if (prop.envInverted) {
      invertedNote = ' [set to disable]';
    }

    lines.push(`  ${env}`);
    lines.push(`    ${desc}${typeInfo}${defaultStr}${invertedNote}`);
  }

  return lines.join('\n');
}
