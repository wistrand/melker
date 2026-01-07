#!/usr/bin/env -S deno run --allow-all
// Melker CLI entry point
// Symlink-safe for local files, URL-aware for remote

if (import.meta.main) {
  const selfUrl = new URL(import.meta.url);
  let launcherUrl: string;

  if (selfUrl.protocol === 'file:') {
    // Local file: resolve symlinks
    const realPath = await Deno.realPath(selfUrl.pathname);
    const realDir = realPath.replace(/\/[^/]+$/, '');
    launcherUrl = `file://${realDir}/melker-launcher.ts`;
  } else {
    // Remote URL: use URL directly
    launcherUrl = new URL('./melker-launcher.ts', selfUrl).href;
  }

  const mod = await import(launcherUrl);
  await mod.main();
}
