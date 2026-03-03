/**
 * Node.js bundler interface using esbuild.
 * Provides bundle() and isBundleAvailable() matching the runtime-agnostic interface.
 *
 * The melkerResolvePlugin handles:
 * - npm: prefix → strip to bare specifier
 * - jsr: prefix → fetch from jsr.io, cache locally, transpile via esbuild
 */

import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

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
 * On Node, esbuild is always available (installed as dependency).
 */
export function isBundleAvailable(): boolean {
  return true;
}

/**
 * Bundle TypeScript entrypoints into a single JavaScript output.
 */
export async function bundle(options: BundleOptions): Promise<BundleResult> {
  try {
    const result = await esbuild.build({
      entryPoints: options.entrypoints,
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      minify: options.minify ?? false,
      sourcemap: options.sourcemap === 'inline' ? 'inline' : false,
      plugins: [melkerResolvePlugin()],
    });

    return {
      success: result.errors.length === 0,
      outputFiles: result.outputFiles?.map((f) => ({
        path: f.path,
        text() { return f.text; },
      })),
      errors: result.errors.length > 0
        ? result.errors.map((e) => ({ text: e.text }))
        : undefined,
    };
  } catch (err) {
    return {
      success: false,
      errors: [{ text: err instanceof Error ? err.message : String(err) }],
    };
  }
}

// --- JSR cache ---

function getCacheDir(): string {
  return path.join(os.homedir(), '.cache', 'melker', 'jsr');
}

function parseJsrSpecifier(specifier: string): { scope: string; name: string; version: string; subpath: string } | null {
  // jsr:@scope/name@version/subpath or jsr:@scope/name/subpath
  const match = specifier.match(/^jsr:(@[^/]+\/[^@/]+)(?:@([^/]+))?(\/.*)?$/);
  if (!match) return null;
  return {
    scope: match[1].split('/')[0],
    name: match[1].split('/')[1],
    version: match[2] ?? '',
    subpath: match[3] ?? '',
  };
}

async function resolveJsrVersion(scope: string, name: string, versionRange: string): Promise<string> {
  const metaUrl = `https://jsr.io/${scope}/${name}/meta.json`;
  const resp = await fetch(metaUrl);
  if (!resp.ok) throw new Error(`Failed to fetch JSR metadata: ${metaUrl} (${resp.status})`);
  const meta = await resp.json() as { versions: Record<string, { yanked?: boolean }> };

  if (versionRange && meta.versions[versionRange]) {
    return versionRange;
  }

  // Find latest non-yanked version
  const versions = Object.entries(meta.versions)
    .filter(([_, v]) => !v.yanked)
    .map(([k]) => k);
  if (versions.length === 0) throw new Error(`No available versions for ${scope}/${name}`);
  return versions[0];
}

async function fetchJsrSource(scope: string, name: string, version: string, subpath: string): Promise<string> {
  const cacheDir = getCacheDir();
  const cacheFile = path.join(cacheDir, scope, name, version, subpath || 'mod.ts');

  // Check cache
  try {
    return fs.readFileSync(cacheFile, 'utf-8');
  } catch {
    // Not cached
  }

  // Resolve subpath from package meta if needed
  let resolvedPath = subpath;
  if (!resolvedPath) {
    const versionMetaUrl = `https://jsr.io/${scope}/${name}/${version}_meta.json`;
    const resp = await fetch(versionMetaUrl);
    if (!resp.ok) throw new Error(`Failed to fetch JSR version metadata: ${versionMetaUrl}`);
    const versionMeta = await resp.json() as { exports: Record<string, string> };
    resolvedPath = versionMeta.exports['.'] ?? '/mod.ts';
  }

  const sourceUrl = `https://jsr.io/${scope}/${name}/${version}${resolvedPath}`;
  const resp = await fetch(sourceUrl);
  if (!resp.ok) throw new Error(`Failed to fetch JSR source: ${sourceUrl} (${resp.status})`);
  const source = await resp.text();

  // Cache it
  await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
  await fsp.writeFile(cacheFile, source);

  return source;
}

// --- esbuild plugin ---

function melkerResolvePlugin(): esbuild.Plugin {
  return {
    name: 'melker-resolve',
    setup(build) {
      // Handle npm: specifiers — strip the prefix
      build.onResolve({ filter: /^npm:/ }, (args) => {
        const bare = args.path.slice(4); // Remove 'npm:'
        return { path: bare, external: true };
      });

      // Handle jsr: specifiers — fetch and transpile
      build.onResolve({ filter: /^jsr:/ }, (args) => {
        return { path: args.path, namespace: 'jsr' };
      });

      build.onLoad({ filter: /.*/, namespace: 'jsr' }, async (args) => {
        const parsed = parseJsrSpecifier(args.path);
        if (!parsed) {
          return { errors: [{ text: `Invalid JSR specifier: ${args.path}` }] };
        }

        const version = parsed.version
          ? parsed.version
          : await resolveJsrVersion(parsed.scope, `${parsed.scope}/${parsed.name}`.slice(parsed.scope.length + 1), '');

        const source = await fetchJsrSource(parsed.scope, `${parsed.scope}/${parsed.name}`.slice(parsed.scope.length + 1), version, parsed.subpath);

        return {
          contents: source,
          loader: 'ts',
        };
      });
    },
  };
}
