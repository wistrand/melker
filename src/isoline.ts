// Shared isoline (contour line) utilities using marching squares algorithm
// Used by data-heatmap and canvas isolines gfx mode

export type IsolineMode = 'equal' | 'quantile' | 'nice';
export type IsolineSource = 'luma' | 'red' | 'green' | 'blue' | 'alpha' | 'oklab' | 'oklch-hue';
export type IsolineFill = 'source' | 'color' | 'color-mean';
export type IsolineColor = 'none' | 'auto' | (string & Record<never, never>);

export interface Isoline {
  value: number;
  color?: string;
  label?: string;
}

// Marching squares case to box-drawing character
// Corners: topLeft(8), topRight(4), bottomRight(2), bottomLeft(1)
// The isoline crosses edges where adjacent corners have different threshold states
// Box-drawing: ╭(↓→) ╮(↓←) ╰(↑→) ╯(↑←) ─(←→) │(↑↓)
export const MARCHING_SQUARES_CHARS: Record<number, string | null> = {
  0b0000: null,  // All below - no line
  0b0001: '╮',   // BL above → crosses LEFT and BOTTOM edges
  0b0010: '╭',   // BR above → crosses RIGHT and BOTTOM edges
  0b0011: '─',   // BL,BR above → crosses LEFT and RIGHT edges (horizontal)
  0b0100: '╰',   // TR above → crosses TOP and RIGHT edges
  0b0101: '│',   // TR,BL above → saddle point (ambiguous)
  0b0110: '│',   // TR,BR above → crosses TOP and BOTTOM edges (vertical)
  0b0111: '╯',   // Only TL below → crosses TOP and LEFT edges
  0b1000: '╯',   // Only TL above → crosses TOP and LEFT edges
  0b1001: '│',   // TL,BL above → crosses TOP and BOTTOM edges (vertical)
  0b1010: '│',   // TL,BR above → saddle point (ambiguous)
  0b1011: '╰',   // Only TR below → crosses TOP and RIGHT edges
  0b1100: '─',   // TL,TR above → crosses LEFT and RIGHT edges (horizontal)
  0b1101: '╭',   // Only BR below → crosses RIGHT and BOTTOM edges
  0b1110: '╮',   // Only BL below → crosses LEFT and BOTTOM edges
  0b1111: null,  // All above - no line
};

/**
 * Get the marching squares case for a 2x2 cell quad.
 * Returns the 4-bit case number based on which corners are >= threshold.
 */
export function getMarchingSquaresCase(
  topLeft: number | null | undefined,
  topRight: number | null | undefined,
  bottomLeft: number | null | undefined,
  bottomRight: number | null | undefined,
  threshold: number
): number {
  // Treat null/undefined as below threshold
  const tl = (topLeft !== null && topLeft !== undefined && topLeft >= threshold) ? 1 : 0;
  const tr = (topRight !== null && topRight !== undefined && topRight >= threshold) ? 1 : 0;
  const bl = (bottomLeft !== null && bottomLeft !== undefined && bottomLeft >= threshold) ? 1 : 0;
  const br = (bottomRight !== null && bottomRight !== undefined && bottomRight >= threshold) ? 1 : 0;

  // Pack into 4-bit number: topLeft(8), topRight(4), bottomRight(2), bottomLeft(1)
  return (tl << 3) | (tr << 2) | (br << 1) | bl;
}

/**
 * Get the box-drawing character for a marching squares case.
 */
export function getMarchingSquaresChar(caseNum: number): string | null {
  return MARCHING_SQUARES_CHARS[caseNum] ?? null;
}

/**
 * Get the box-drawing character for an isoline at a cell boundary.
 */
export function getIsolineChar(
  topLeft: number | null | undefined,
  topRight: number | null | undefined,
  bottomLeft: number | null | undefined,
  bottomRight: number | null | undefined,
  threshold: number
): string | null {
  const caseNum = getMarchingSquaresCase(topLeft, topRight, bottomLeft, bottomRight, threshold);
  return getMarchingSquaresChar(caseNum);
}

/**
 * Generate N isoline values using equal intervals between min and max.
 */
export function generateEqualIsolines(min: number, max: number, count: number): number[] {
  if (count <= 0 || max <= min) return [];
  const values: number[] = [];
  const step = (max - min) / (count + 1);
  for (let i = 1; i <= count; i++) {
    values.push(min + step * i);
  }
  return values;
}

/**
 * Generate N isoline values at data percentiles.
 * Computes thresholds as midpoints between unique value clusters,
 * ensuring marching squares always finds edges.
 */
export function generateQuantileIsolines(allValues: number[], count: number): number[] {
  if (count <= 0 || allValues.length === 0) return [];

  // Get sorted unique values
  const unique = [...new Set(allValues)].sort((a, b) => a - b);
  if (unique.length < 2) return [];

  // Compute midpoints between adjacent unique values (N-1 possible boundaries)
  const midpoints: number[] = [];
  for (let i = 0; i < unique.length - 1; i++) {
    midpoints.push((unique[i] + unique[i + 1]) / 2);
  }

  // Can't have more isolines than boundaries
  const actualCount = Math.min(count, midpoints.length);
  if (actualCount === 0) return [];

  // If we want all midpoints or more than available, return all
  if (actualCount >= midpoints.length) {
    return midpoints;
  }

  // Evenly sample from midpoints
  const values: number[] = [];
  for (let i = 1; i <= actualCount; i++) {
    const index = Math.min(Math.floor(i * midpoints.length / (actualCount + 1)), midpoints.length - 1);
    values.push(midpoints[index]);
  }

  return [...new Set(values)];
}

/**
 * Generate N isoline values at "nice" rounded numbers (multiples of 1, 2, 5, 10, etc.).
 */
export function generateNiceIsolines(min: number, max: number, count: number): number[] {
  const range = max - min;
  if (range <= 0 || count <= 0) return [];

  // Calculate a "nice" step size
  const roughStep = range / (count + 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;

  let niceStep: number;
  if (normalized <= 1) niceStep = magnitude;
  else if (normalized <= 2) niceStep = 2 * magnitude;
  else if (normalized <= 5) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  // Generate values starting from a nice number
  const niceMin = Math.ceil(min / niceStep) * niceStep;
  const values: number[] = [];

  for (let v = niceMin; v < max && values.length < count; v += niceStep) {
    if (v > min) {
      values.push(v);
    }
  }

  return values;
}

/**
 * Enforce minimum spacing between adjacent isoline values.
 * Removes isolines that are too close to their predecessor.
 */
function enforceMinimumSpacing(values: number[], min: number, max: number, count: number): number[] {
  if (values.length <= 1) return values;

  // Minimum spacing is the expected spacing for equal distribution
  // This prevents parallel lines from area-averaged gradient zones
  const range = max - min;
  const minSpacing = range / (count + 1);

  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    const prev = result[result.length - 1];
    if (values[i] - prev >= minSpacing) {
      result.push(values[i]);
    }
  }

  return result;
}

/**
 * Generate isolines using the specified algorithm.
 */
export function generateIsolines(
  min: number,
  max: number,
  count: number,
  mode: IsolineMode,
  allValues?: number[]
): Isoline[] {
  let values: number[];

  switch (mode) {
    case 'quantile':
      values = allValues ? generateQuantileIsolines(allValues, count) : generateEqualIsolines(min, max, count);
      break;
    case 'nice':
      values = generateNiceIsolines(min, max, count);
      break;
    case 'equal':
    default:
      values = generateEqualIsolines(min, max, count);
      break;
  }

  // Enforce minimum spacing to prevent close parallel lines
  values = enforceMinimumSpacing(values, min, max, count);

  return values.map(value => ({ value }));
}

/**
 * Convert sRGB component (0-255) to linear RGB (0-1).
 */
function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * Convert sRGB (0-255 each) to Oklab (L, a, b).
 * Oklab is perceptually uniform - similar colors have similar values.
 */
function srgbToOklab(r: number, g: number, b: number): { L: number; a: number; b: number } {
  // sRGB to linear RGB
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  // Linear RGB to LMS (cone response)
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  // LMS to Oklab (cube root and matrix)
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

/**
 * Convert sRGB (0-255 each) to Oklab L (perceptual lightness, 0-1).
 */
function srgbToOklabL(r: number, g: number, b: number): number {
  return srgbToOklab(r, g, b).L;
}

/**
 * Convert sRGB (0-255 each) to Oklch hue (0-360 degrees).
 * Groups colors by their hue (red, orange, yellow, green, cyan, blue, purple, magenta).
 */
function srgbToOklchHue(r: number, g: number, b: number): number {
  const lab = srgbToOklab(r, g, b);
  // atan2 returns radians in [-pi, pi], convert to [0, 360]
  const hue = Math.atan2(lab.b, lab.a) * (180 / Math.PI);
  return hue < 0 ? hue + 360 : hue;
}

/**
 * Extract scalar value from a packed RGBA color based on the specified source channel.
 */
export function getScalarFromColor(color: number, source: IsolineSource): number {
  const r = (color >> 24) & 0xFF;
  const g = (color >> 16) & 0xFF;
  const b = (color >> 8) & 0xFF;
  const a = color & 0xFF;

  switch (source) {
    case 'red':
      return r;
    case 'green':
      return g;
    case 'blue':
      return b;
    case 'alpha':
      return a;
    case 'oklab':
      // Oklab perceptual lightness (0-255 scaled)
      return srgbToOklabL(r, g, b) * 255;
    case 'oklch-hue':
      // Oklch hue angle (0-360, scaled to 0-255 for consistency)
      return srgbToOklchHue(r, g, b) * (255 / 360);
    case 'luma':
    default:
      // Perceptual luminance (ITU-R BT.601)
      return 0.299 * r + 0.587 * g + 0.114 * b;
  }
}
