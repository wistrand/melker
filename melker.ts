#!/usr/bin/env -S deno run --allow-all
/**
 * # Melker CLI
 *
 * This is the CLI entry point. For the library API, see
 * {@link [mod.ts](./lib/index.html)}.
 *
 * ```bash
 * deno install -g -A jsr:@wistrand/melker
 * melker app.melker
 * ```
 *
 * @module
 */

if (import.meta.main) {
  const selfUrl = new URL(import.meta.url);
  let launcherUrl: string;

  if (selfUrl.protocol === 'file:') {
    // Local file: resolve symlinks, with fallback for JSR cache
    try {
      const realPath = await Deno.realPath(selfUrl.pathname);
      const realDir = realPath.replace(/\/[^/]+$/, '');
      launcherUrl = `file://${realDir}/melker-launcher.ts`;
    } catch {
      launcherUrl = new URL('./melker-launcher.ts', selfUrl).href;
    }
  } else {
    // Remote URL: use URL directly
    launcherUrl = new URL('./melker-launcher.ts', selfUrl).href;
  }

  const mod = await import(launcherUrl);
  await mod.main();
}
