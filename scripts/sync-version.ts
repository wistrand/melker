#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

// Get latest git tag: v2026.02.5
const p = new Deno.Command('git', {
  args: ['describe', '--tags', '--abbrev=0'],
  stdout: 'piped',
}).outputSync();
const tag = new TextDecoder().decode(p.stdout).trim();

// Convert to semver: v2026.02.5 → 2026.2.5
const semver = tag.replace(/^v/, '').replace(/\.0(\d)/g, '.$1');

// Update deno.json — replace version field in-place to preserve formatting
const denoPath = 'deno.json';
const denoText = await Deno.readTextFile(denoPath);
const old = JSON.parse(denoText).version;
const denoUpdated = denoText.replace(/"version":\s*"[^"]*"/, `"version": "${semver}"`);
await Deno.writeTextFile(denoPath, denoUpdated);

// Update package.json — keep Node package version in sync
const pkgPath = 'package.json';
const pkgText = await Deno.readTextFile(pkgPath);
const pkgUpdated = pkgText.replace(/"version":\s*"[^"]*"/, `"version": "${semver}"`);
await Deno.writeTextFile(pkgPath, pkgUpdated);

console.log(`${old} → ${semver} (from ${tag})`);
