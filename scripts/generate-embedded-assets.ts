#!/usr/bin/env -S deno run --allow-read --allow-write
//
// Regenerate src/assets-data.ts from source files.
// Each asset is encoded as a grayscale PNG (using PNG's internal deflate
// compression), then base64-encoded. At runtime, the synchronous decodePng()
// from fast-png recovers the original bytes — no async needed.
//
// Usage:
//   deno task build:assets
//

import { encodePng } from '../src/deps.ts';

const ROOT = new URL('..', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Asset registry — loaded from scripts/assets.json
// ---------------------------------------------------------------------------

interface AssetDef {
  id: string;
  path: string;
}

const ASSETS: AssetDef[] = JSON.parse(
  await Deno.readTextFile(new URL('./assets.json', import.meta.url)),
).assets;

/** Encode raw bytes as a 1-pixel-tall grayscale PNG, then base64-encode. */
function bytesToBase64Png(data: Uint8Array): string {
  const png = encodePng({
    width: data.length,
    height: 1,
    data,
    channels: 1,
    depth: 8,
  });
  return btoa(String.fromCharCode(...png));
}

/** Compute relative path from src/ (where assets-data.ts lives) to an asset source. */
function toRelativePath(assetPath: string): string {
  // assetPath is relative to project root, e.g. "src/themes/bw-std.css" or "media/blue-noise-64.png"
  if (assetPath.startsWith('src/')) {
    return './' + assetPath.slice(4);
  }
  return '../' + assetPath;
}

/** Split a base64 string into 100-char quoted chunks for readable TS output. */
function formatBase64(b64: string): string {
  const chunkSize = 100;
  const parts: string[] = [];
  for (let i = 0; i < b64.length; i += chunkSize) {
    parts.push(JSON.stringify(b64.slice(i, i + chunkSize)));
  }
  return parts.join(' +\n    ');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('Generating src/assets-data.ts...');

const dataEntries: string[] = [];
const pathEntries: string[] = [];
let totalRaw = 0;
let totalEncoded = 0;

for (const asset of ASSETS) {
  const raw = await Deno.readFile(`${ROOT}${asset.path}`);
  const b64 = bytesToBase64Png(raw);
  const encodedBytes = Math.ceil(b64.length * 3 / 4);
  totalRaw += raw.length;
  totalEncoded += encodedBytes;
  dataEntries.push(`  '${asset.id}':\n    ${formatBase64(b64)},`);
  pathEntries.push(`  '${asset.id}': '${toRelativePath(asset.path)}',`);
  console.log(`  ${asset.id} (${raw.length} → ${encodedBytes} bytes)`);
}

const output = `// Embedded asset data — bytes encoded as grayscale PNG, then base64.
// Decoded at runtime with decodePng() (synchronous).
// Source files and IDs defined in scripts/assets.json.
// Runtime API is in src/assets.ts.
// Regenerate: deno task build:assets
//
// DO NOT EDIT — this file is generated.

// deno-fmt-ignore
export const ASSET_DATA: Record<string, string> = {
${dataEntries.join('\n')}
};

/** Source file paths relative to this file (src/). Used for dynamic loading in development. */
// deno-fmt-ignore
export const ASSET_PATHS: Record<string, string> = {
${pathEntries.join('\n')}
};
`;

await Deno.writeTextFile(`${ROOT}src/assets-data.ts`, output);
console.log(`Done. ${ASSETS.length} assets, ${totalRaw} → ${totalEncoded} bytes.`);
