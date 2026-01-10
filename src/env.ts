import { getLogger } from './logging.ts';

/**
 * Safe environment variable access with readability caching.
 * Caches which vars are readable (have permission), not the values themselves.
 * This allows dynamic updates to env vars while avoiding permission errors.
 *
 * Use Env.get() instead of Deno.env.get() throughout codebase.
 */
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
      this.readable.set(name, true);
      return value;
    } catch {
      this.readable.set(name, false);
      // Warn once per denied env var
      if (!this.warnedDenied.has(name)) {
        this.warnedDenied.add(name);
        const logger = getLogger('Env');
        logger.warn(`Access denied for env var: ${name} (add to policy permissions or configSchema)`);
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
