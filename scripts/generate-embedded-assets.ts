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

import { decodePng, encodePng } from '../src/deps.ts';

const ROOT = new URL('..', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Asset registry — loaded from scripts/assets.json
// ---------------------------------------------------------------------------

interface AssetDef {
  id: string;
  path: string;
  /** 'png-grayscale' decodes PNG to raw grayscale bytes before encoding */
  transform?: 'png-grayscale';
}

const ASSETS: AssetDef[] = JSON.parse(
  await Deno.readTextFile(new URL('./assets.json', import.meta.url)),
).assets;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pngToGrayscale(pngData: Uint8Array): Uint8Array {
  const decoded = decodePng(pngData);
  const size = decoded.width * decoded.height;
  const channels = decoded.channels || (decoded.data.length / size);
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (channels === 1) data[i] = decoded.data[i];
    else if (channels === 2) data[i] = decoded.data[i * 2];
    else {
      const idx = i * (channels >= 4 ? 4 : 3);
      data[i] = Math.round(
        0.299 * decoded.data[idx] + 0.587 * decoded.data[idx + 1] + 0.114 * decoded.data[idx + 2],
      );
    }
  }
  return data;
}

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

const entries: string[] = [];
let totalRaw = 0;
let totalEncoded = 0;

for (const asset of ASSETS) {
  let raw = await Deno.readFile(`${ROOT}${asset.path}`);
  if (asset.transform === 'png-grayscale') {
    raw = pngToGrayscale(raw);
  }
  const b64 = bytesToBase64Png(raw);
  const encodedBytes = Math.ceil(b64.length * 3 / 4);
  totalRaw += raw.length;
  totalEncoded += encodedBytes;
  entries.push(`  '${asset.id}':\n    ${formatBase64(b64)},`);
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
${entries.join('\n')}
};
`;

await Deno.writeTextFile(`${ROOT}src/assets-data.ts`, output);
console.log(`Done. ${ASSETS.length} assets, ${totalRaw} → ${totalEncoded} bytes.`);
