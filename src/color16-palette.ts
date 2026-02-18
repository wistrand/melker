// Color16+ expanded palette for 16-color terminals.
// Pre-computes all (fg_ansi, bg_ansi, shade_char) triples and their visual RGB,
// giving ~1,280 distinguishable entries instead of 16. A 3D lookup table maps
// any RGB input to the best terminal output in O(1).

import type { PackedRGBA } from './types.ts';
import { packRGBA } from './components/color-utils.ts';

// --- Oklab conversion (inlined from isoline.ts to avoid cross-module dependency) ---

// Pre-computed sRGB→linear LUT (eliminates Math.pow from hot path)
const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const s = i / 255;
  SRGB_TO_LINEAR[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

// Pre-computed linear→sRGB LUT (for palette building: mix in linear, convert back)
const LINEAR_TO_SRGB = new Uint8Array(4096);
for (let i = 0; i < 4096; i++) {
  const lin = i / 4095;
  const s = lin <= 0.0031308 ? 12.92 * lin : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
  LINEAR_TO_SRGB[i] = Math.round(s * 255);
}

function linearToSrgb(lin: number): number {
  return LINEAR_TO_SRGB[Math.round(Math.min(1, Math.max(0, lin)) * 4095)];
}

function srgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = SRGB_TO_LINEAR[r];
  const lg = SRGB_TO_LINEAR[g];
  const lb = SRGB_TO_LINEAR[b];

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

// --- VGA palette: canonical RGB for each of the 16 SGR codes ---

interface AnsiColor {
  sgr: number;   // SGR code (30-37, 90-97)
  r: number;
  g: number;
  b: number;
  packed: PackedRGBA;
}

const ANSI_16: AnsiColor[] = [
  { sgr: 30, r: 0,   g: 0,   b: 0,   packed: 0 },
  { sgr: 31, r: 170, g: 0,   b: 0,   packed: 0 },
  { sgr: 32, r: 0,   g: 170, b: 0,   packed: 0 },
  { sgr: 33, r: 170, g: 85,  b: 0,   packed: 0 },
  { sgr: 34, r: 0,   g: 0,   b: 170, packed: 0 },
  { sgr: 35, r: 170, g: 0,   b: 170, packed: 0 },
  { sgr: 36, r: 0,   g: 170, b: 170, packed: 0 },
  { sgr: 37, r: 170, g: 170, b: 170, packed: 0 },
  { sgr: 90, r: 85,  g: 85,  b: 85,  packed: 0 },
  { sgr: 91, r: 255, g: 85,  b: 85,  packed: 0 },
  { sgr: 92, r: 85,  g: 255, b: 85,  packed: 0 },
  { sgr: 93, r: 255, g: 255, b: 85,  packed: 0 },
  { sgr: 94, r: 85,  g: 85,  b: 255, packed: 0 },
  { sgr: 95, r: 255, g: 85,  b: 255, packed: 0 },
  { sgr: 96, r: 85,  g: 255, b: 255, packed: 0 },
  { sgr: 97, r: 255, g: 255, b: 255, packed: 0 },
];

// Pre-compute packed RGBA for each ANSI color
for (const c of ANSI_16) {
  c.packed = packRGBA(c.r, c.g, c.b, 255);
}

// --- Palette construction ---

export interface PaletteEntry {
  fgPacked: PackedRGBA;
  bgPacked: PackedRGBA;
  char: string;
}

const SHADE_DENSITIES = [0.00, 0.25, 0.50, 0.75, 1.00];
const SHADE_CHARS     = [' ',  '░',  '▒',  '▓',  '█'];

interface InternalEntry extends PaletteEntry {
  okL: number;
  okA: number;
  okB: number;
  shadePenalty: number;
}

function buildPalette(): InternalEntry[] {
  const entries: InternalEntry[] = [];

  for (let fi = 0; fi < 16; fi++) {
    const fg = ANSI_16[fi];
    for (let bi = 0; bi < 16; bi++) {
      const bg = ANSI_16[bi];
      for (let di = 0; di < 5; di++) {
        const d = SHADE_DENSITIES[di];

        // Visual RGB: mix in linear light space (terminal shade chars
        // interleave fg/bg pixels — eye integrates photons linearly)
        const linR = d * SRGB_TO_LINEAR[fg.r] + (1 - d) * SRGB_TO_LINEAR[bg.r];
        const linG = d * SRGB_TO_LINEAR[fg.g] + (1 - d) * SRGB_TO_LINEAR[bg.g];
        const linB = d * SRGB_TO_LINEAR[fg.b] + (1 - d) * SRGB_TO_LINEAR[bg.b];
        const vr = linearToSrgb(linR);
        const vg = linearToSrgb(linG);
        const vb = linearToSrgb(linB);

        const [okL, okA, okB] = srgbToOklab(vr, vg, vb);

        const ch = SHADE_CHARS[di];
        entries.push({
          fgPacked: fg.packed,
          bgPacked: bg.packed,
          char: ch,
          okL,
          okA,
          okB,
          shadePenalty: (ch === ' ' || ch === '█') ? 0 : 1e-10,
        });
      }
    }
  }

  return entries;
}

// --- 3D lookup table for O(1) nearest-neighbor ---

// 5 bits per channel → 32 levels → 32³ = 32,768 entries
const LUT_BITS = 5;
const LUT_SIZE = 1 << LUT_BITS;       // 32
const LUT_SHIFT = 8 - LUT_BITS;       // 3
const LUT_HALF = 1 << (LUT_SHIFT - 1); // 4 — offset to bucket center

function buildLUT(): PaletteEntry[] {
  const palette = buildPalette();
  const lut = new Array<PaletteEntry>(LUT_SIZE * LUT_SIZE * LUT_SIZE);

  for (let ri = 0; ri < LUT_SIZE; ri++) {
    // Sample at bucket center for best accuracy
    const r = Math.min(255, (ri << LUT_SHIFT) + LUT_HALF);
    for (let gi = 0; gi < LUT_SIZE; gi++) {
      const g = Math.min(255, (gi << LUT_SHIFT) + LUT_HALF);
      for (let bi = 0; bi < LUT_SIZE; bi++) {
        const b = Math.min(255, (bi << LUT_SHIFT) + LUT_HALF);

        const [L, a, bOk] = srgbToOklab(r, g, b);

        let bestDist = Infinity;
        let bestEntry = palette[0];

        for (let i = 0; i < palette.length; i++) {
          const e = palette[i];
          const dL = L - e.okL;
          const da = a - e.okA;
          const db = bOk - e.okB;
          const dist = dL * dL + da * da + db * db + e.shadePenalty;
          if (dist < bestDist) {
            bestDist = dist;
            bestEntry = e;
          }
        }

        lut[ri * LUT_SIZE * LUT_SIZE + gi * LUT_SIZE + bi] = bestEntry;
      }
    }
  }

  return lut;
}

const LUT = buildLUT();

/**
 * Find the nearest color16+ palette entry for an RGB color.
 * O(1) lookup via pre-computed 3D table (32×32×32 = 32K entries).
 */
export function nearestColor16Plus(r: number, g: number, b: number): PaletteEntry {
  return LUT[(r >> LUT_SHIFT) * LUT_SIZE * LUT_SIZE + (g >> LUT_SHIFT) * LUT_SIZE + (b >> LUT_SHIFT)];
}

// --- Solid color LUT: nearest of the 16 ANSI colors (no shading) ---

function buildSolidLUT(): number[] {
  const ansiOklab: [number, number, number][] = [];
  for (let i = 0; i < 16; i++) {
    ansiOklab.push(srgbToOklab(ANSI_16[i].r, ANSI_16[i].g, ANSI_16[i].b));
  }

  const lut = new Array<number>(LUT_SIZE * LUT_SIZE * LUT_SIZE);

  for (let ri = 0; ri < LUT_SIZE; ri++) {
    const r = Math.min(255, (ri << LUT_SHIFT) + LUT_HALF);
    for (let gi = 0; gi < LUT_SIZE; gi++) {
      const g = Math.min(255, (gi << LUT_SHIFT) + LUT_HALF);
      for (let bi = 0; bi < LUT_SIZE; bi++) {
        const b = Math.min(255, (bi << LUT_SHIFT) + LUT_HALF);

        const [L, a, bOk] = srgbToOklab(r, g, b);

        let bestDist = Infinity;
        let bestPacked = ANSI_16[0].packed;

        for (let i = 0; i < 16; i++) {
          const dL = L - ansiOklab[i][0];
          const da = a - ansiOklab[i][1];
          const db = bOk - ansiOklab[i][2];
          const dist = dL * dL + da * da + db * db;
          if (dist < bestDist) {
            bestDist = dist;
            bestPacked = ANSI_16[i].packed;
          }
        }

        lut[ri * LUT_SIZE * LUT_SIZE + gi * LUT_SIZE + bi] = bestPacked;
      }
    }
  }

  return lut;
}

const SOLID_LUT = buildSolidLUT();

/**
 * Find the nearest solid ANSI color (no shading) for an RGB color.
 * O(1) lookup. Used for spatial half-block cells on 16-color terminals.
 */
export function nearestSolid16(r: number, g: number, b: number): number {
  return SOLID_LUT[(r >> LUT_SHIFT) * LUT_SIZE * LUT_SIZE + (g >> LUT_SHIFT) * LUT_SIZE + (b >> LUT_SHIFT)];
}

// --- Shade interpolation for halfblock B strategy ---

const SHADE_TO_IDX: Record<string, number> = { ' ': 0, '░': 1, '▒': 2, '▓': 3, '█': 4 };

/**
 * Blend two shade characters by averaging their density indices.
 * Used when upper and lower pixels share the same fg+bg pair but differ in shade.
 */
export function blendShadeChars(a: string, b: string): string {
  return SHADE_CHARS[Math.round(((SHADE_TO_IDX[a] ?? 0) + (SHADE_TO_IDX[b] ?? 0)) / 2)];
}
