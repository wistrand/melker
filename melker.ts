#!/usr/bin/env -S deno run --allow-all
// Melker CLI entry point
// Symlink-safe: resolves real path before importing

if (import.meta.main) {
  const selfPath = new URL(import.meta.url).pathname;
  const realPath = await Deno.realPath(selfPath);
  const realDir = realPath.replace(/\/[^/]+$/, '');
  const launcherUrl = `file://${realDir}/melker-launcher.ts`;

  const mod = await import(launcherUrl);
  await mod.main();
}
