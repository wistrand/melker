// Shared Oklab perceptual color space conversions.
// Centralises sRGB↔linear LUTs and sRGB→Oklab so callers don't duplicate them.

/** Pre-computed sRGB (0-255) → linear (0-1) LUT. */
export const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const s = i / 255;
  SRGB_TO_LINEAR[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Pre-computed linear (0-1) → sRGB (0-255) LUT with 4096 entries. */
export const LINEAR_TO_SRGB = new Uint8Array(4096);
for (let i = 0; i < 4096; i++) {
  const lin = i / 4095;
  const s = lin <= 0.0031308 ? 12.92 * lin : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
  LINEAR_TO_SRGB[i] = Math.round(s * 255);
}

/** Convert a linear-light value (0-1) back to sRGB (0-255) via LUT. */
export function linearToSrgb(lin: number): number {
  return LINEAR_TO_SRGB[Math.round(Math.min(1, Math.max(0, lin)) * 4095)];
}

/** Convert sRGB (0-255 each) to Oklab [L, a, b]. */
export function srgbToOklab(r: number, g: number, b: number): [number, number, number] {
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
