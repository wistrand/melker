// Node.js subprocess entry point for sandboxed Melker execution.
// Spawned by node-main.ts with --permission flags.
// Registers the custom loader then imports and runs the runner.

import { register } from 'node:module';
register('./runtime/node/loader.mjs', import.meta.url);

const { main } = await import('./melker-runner.ts');
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
