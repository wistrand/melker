/**
 * Runtime-agnostic bundler interface.
 * Wraps Deno.bundle() (unstable API).
 */

export interface BundleOptions {
  entrypoints: string[];
  minify?: boolean;
  sourcemap?: 'inline';
}

export interface BundleOutputFile {
  path: string;
  text(): string;
}

export interface BundleResult {
  success: boolean;
  outputFiles?: BundleOutputFile[];
  errors?: { text: string }[];
}

/**
 * Check if the runtime bundler is available.
 */
export function isBundleAvailable(): boolean {
  return typeof (Deno as any).bundle === 'function';
}

/**
 * Bundle TypeScript entrypoints into a single JavaScript output.
 */
export async function bundle(options: BundleOptions): Promise<BundleResult> {
  return await (Deno as any).bundle({
    entrypoints: options.entrypoints,
    output: 'bundle',
    platform: 'deno',
    minify: options.minify ?? false,
    sourcemap: options.sourcemap ?? 'inline',
    write: false,
  });
}
