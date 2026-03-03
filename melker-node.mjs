#!/usr/bin/env -S node --no-warnings
// Node.js Entry Point for Melker (npm install path)
//
// Pure JS — no --experimental-transform-types needed.
// Registers a custom loader that strips TypeScript types from .ts files
// (including inside node_modules) using Node 25's stripTypeScriptTypes().
// The loader also:
//   1. Strips Deno's npm: prefix from import specifiers → bare node_modules
//   2. Redirects src/runtime/mod.ts → src/runtime/node/mod.ts

import { register } from 'node:module';
register('./src/runtime/node/loader.mjs', import.meta.url);

const { main } = await import('./src/node-main.ts');
main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
