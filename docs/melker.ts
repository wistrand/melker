// Melker CLI entry point with fixed url to github main

if (import.meta.main) {
  const mod = await import('https://raw.githubusercontent.com/wistrand/melker/refs/heads/main/melker-launcher.ts');
  await mod.main();
} else {
  console.error("This launcher can only be used as main, not as lib");
}
