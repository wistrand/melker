#!/usr/bin/env -S node --experimental-transform-types --no-warnings
// Node.js Entry Point for Melker
//
// Requires --experimental-transform-types for full TypeScript support
// (parameter properties, enums, etc.). If not active, re-execs with the flag.
//
// Then registers a custom loader and dynamically imports the real CLI.
// The loader handles two things:
//   1. Strips Deno's npm: prefix from import specifiers → bare node_modules
//   2. Redirects src/runtime/mod.ts → src/runtime/node/mod.ts

import { execFileSync } from 'node:child_process';
import { register } from 'node:module';

// Re-exec with --experimental-transform-types if not already active.
// Detection: the flag sets module.stripTypeScriptTypes to false-ish
// when transform mode is on. Simplest check: try a TS-only feature.
const hasTransformTypes = process.execArgv.some(
  a => a.includes('--experimental-transform-types')
);

if (!hasTransformTypes) {
  try {
    const result = execFileSync(
      process.execPath,
      ['--experimental-transform-types', '--no-warnings', ...process.execArgv, ...process.argv.slice(1)],
      { stdio: 'inherit' },
    );
    process.exit(0);
  } catch (e: any) {
    process.exit(e.status ?? 1);
  }
}

register('./src/runtime/node/loader.mjs', import.meta.url);

const { main } = await import('./src/node-main.ts');
main().catch((error: Error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
