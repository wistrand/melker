/**
 * Runtime-agnostic environment variable access.
 * Wraps Deno.env.get/set/delete/toObject.
 */

export function envGet(name: string): string | undefined {
  return Deno.env.get(name);
}

export function envSet(name: string, value: string): void {
  Deno.env.set(name, value);
}

export function envDelete(name: string): void {
  Deno.env.delete(name);
}

export function envToObject(): Record<string, string> {
  return Deno.env.toObject();
}
