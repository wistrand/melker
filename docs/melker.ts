// Melker CLI - Remote Launcher
//
// This file is served at https://melker.sh/melker.ts and imports the latest
// code from the main branch on GitHub. Run Melker apps without cloning:
//
//   deno run --allow-all https://melker.sh/melker.ts app.melker
//
// To bypass Deno's module cache and fetch the latest version:
//
//   deno run --allow-all --reload --no-lock https://melker.sh/melker.ts app.melker
//
// Deno flags after melker.ts are forwarded to the app subprocess:
//   --reload, --no-lock, --no-check, --quiet/-q, --cached-only

if (import.meta.main) {
  const mod = await import('https://raw.githubusercontent.com/wistrand/melker/refs/heads/main/melker-launcher.ts');
  await mod.main();
} else {
  console.error('This launcher can only be used as main entry point, not as a library import.');
}
