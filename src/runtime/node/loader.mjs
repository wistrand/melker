/**
 * Node.js custom loader hooks for Melker.
 *
 * Registered via module.register() in melker-node.mjs / src/node-runner-entry.mjs.
 * Handles three things:
 *
 * 1. Strips Deno's `npm:` prefix from import specifiers so Node resolves
 *    them as bare specifiers from node_modules/.
 *    e.g. 'npm:html5parser@2.0.2' → 'html5parser'
 *         'npm:@jsquash/webp@1.5.0' → '@jsquash/webp'
 *
 * 2. Redirects src/runtime/mod.ts → src/runtime/node/mod.ts so all shared
 *    code gets the Node.js runtime implementations instead of Deno's.
 *
 * 3. Strips TypeScript types from .ts files (including inside node_modules)
 *    using Node 25's module.stripTypeScriptTypes().
 */

import { stripTypeScriptTypes } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Strip the npm: prefix and optional version suffix from a Deno-style npm specifier,
 * preserving any subpath after the version.
 *   npm:html5parser@2.0.2                      → html5parser
 *   npm:@jsquash/webp@1.5.0                    → @jsquash/webp
 *   npm:vscode-languageserver@9.0.1/node.js     → vscode-languageserver/node.js
 */
function stripNpmSpecifier(specifier) {
  let bare = specifier.slice(4); // Remove 'npm:'
  if (bare.startsWith('@')) {
    // Scoped: @scope/name@version/subpath
    const slashIdx = bare.indexOf('/');
    if (slashIdx > 0) {
      const atIdx = bare.indexOf('@', slashIdx + 1);
      if (atIdx > 0) {
        const subpathIdx = bare.indexOf('/', atIdx);
        bare = bare.substring(0, atIdx) + (subpathIdx > 0 ? bare.substring(subpathIdx) : '');
      }
    }
  } else {
    // Unscoped: name@version/subpath
    const atIdx = bare.indexOf('@');
    if (atIdx > 0) {
      const subpathIdx = bare.indexOf('/', atIdx);
      bare = bare.substring(0, atIdx) + (subpathIdx > 0 ? bare.substring(subpathIdx) : '');
    }
  }
  return bare;
}

export async function resolve(specifier, context, nextResolve) {
  // 1. Strip npm: prefix → bare specifier for node_modules resolution
  if (specifier.startsWith('npm:')) {
    return nextResolve(stripNpmSpecifier(specifier), context);
  }

  // 2. Rewrite specifier before resolution so the original file need not exist.
  //    This is needed for npm installs where src/runtime/deno/ is excluded.
  if (specifier.endsWith('/runtime/deno/server.ts') || specifier === './runtime/deno/server.ts' || specifier === '../runtime/deno/server.ts') {
    return nextResolve(specifier.replace('/runtime/deno/server.ts', '/runtime/node/server.ts'), context);
  }

  // 3. Resolve normally, then redirect runtime/mod.ts → runtime/node/mod.ts
  const result = await nextResolve(specifier, context);

  if (result.url.endsWith('/src/runtime/mod.ts')) {
    return {
      ...result,
      url: result.url.replace('/src/runtime/mod.ts', '/src/runtime/node/mod.ts'),
    };
  }

  return result;
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const source = await readFile(fileURLToPath(url), 'utf-8');
    return {
      format: 'module',
      source: stripTypeScriptTypes(source, { mode: 'transform' }),
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
