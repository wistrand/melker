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
const path = 'deno.json';
const text = await Deno.readTextFile(path);
const old = JSON.parse(text).version;
const updated = text.replace(/"version":\s*"[^"]*"/, `"version": "${semver}"`);
await Deno.writeTextFile(path, updated);

console.log(`${old} → ${semver} (from ${tag})`);
