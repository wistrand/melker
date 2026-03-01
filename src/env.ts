/**
 * Safe environment variable access with readability caching.
 * Caches which vars are readable (have permission), not the values themselves.
 * This allows dynamic updates to env vars while avoiding permission errors.
 *
 * Use Env.get() instead of Deno.env.get() throughout codebase.
 */

// Optional logger callback — registered by logging.ts when it loads.
// Decouples env.ts from logging.ts (avoids pulling logging into launcher).
let _envLog: ((level: 'debug' | 'warn', message: string) => void) | null = null;

export function setEnvLogger(fn: typeof _envLog): void {
  _envLog = fn;
}

export class Env {
  private static readable = new Map<string, boolean>();
  private static initialized = false;
  private static warnedDenied = new Set<string>();

  /** Initialize by discovering readable vars */
  private static init(): void {
    if (this.initialized) return;
    try {
      for (const name of Object.keys(Deno.env.toObject())) {
        this.readable.set(name, true);
      }
    } catch {
      // No env permission at all
    }
    this.initialized = true;
  }

  /**
   * Get env var value (safe, fresh value each call).
   * Returns undefined if var is unset or not readable.
   */
  static get(name: string): string | undefined {
    this.init();

    // Known readable - get fresh value
    if (this.readable.get(name) === true) {
      return Deno.env.get(name);
    }

    // Known unreadable
    if (this.readable.has(name)) {
      return undefined;
    }

    // Unknown - try and cache readability
    try {
      const value = Deno.env.get(name);
      // Only mark as readable if var actually exists (has a value)
      // This prevents Env.keys() from returning vars that don't exist
      if (value !== undefined) {
        this.readable.set(name, true);
      }
      return value;
    } catch {
      this.readable.set(name, false);
      // Log once per denied env var
      if (!this.warnedDenied.has(name)) {
        this.warnedDenied.add(name);
        // MELKER_* and XDG_* are expected internal reads - debug level only
        if (name.startsWith('MELKER_') || name.startsWith('XDG_')) {
          _envLog?.('debug', `Env var not permitted: ${name}`);
        } else {
          _envLog?.('warn', `Access denied for env var: ${name} (add to policy permissions or configSchema)`);
        }
      }
      return undefined;
    }
  }

  /**
   * Check if env var exists and is readable.
   */
  static has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  /**
   * Get names of all readable env vars.
   */
  static keys(): string[] {
    this.init();
    return [...this.readable.entries()]
      .filter(([, ok]) => ok)
      .map(([name]) => name);
  }

  /**
   * Get all readable env vars as object (fresh values).
   */
  static toObject(): Record<string, string> {
    this.init();
    const result: Record<string, string> = {};
    for (const [name, ok] of this.readable) {
      if (ok) {
        const value = Deno.env.get(name);
        if (value !== undefined) {
          result[name] = value;
        }
      }
    }
    return result;
  }
}
