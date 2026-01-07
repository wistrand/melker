// Shader utilities for canvas component
// Extracted from canvas.ts to reduce file size

// Resolution info passed to shader callback
export interface ShaderResolution {
  width: number;      // Pixel buffer width
  height: number;     // Pixel buffer height
  pixelAspect: number; // Pixel width/height ratio (~0.5 for sextant chars, meaning taller than wide)
  // To draw aspect-correct shapes, divide y by pixelAspect (or multiply by 1/pixelAspect)
  // Example for a circle: dist = sqrt((u-cx)^2 + ((v-cy)/pixelAspect)^2)
}

// Source pixel accessor for image shaders
export interface ShaderSource {
  // Get pixel at (x, y) from source image - returns [r, g, b, a] or null if out of bounds/no image
  getPixel(x: number, y: number): [number, number, number, number] | null;
  // Check if source image is loaded
  hasImage: boolean;
  // Source image dimensions (0 if no image)
  width: number;
  height: number;
  // Mouse position in pixel coordinates (-1, -1 if mouse not over canvas)
  mouse: { x: number; y: number };
  // Mouse position in normalized coordinates (0-1 range, -1 if not over canvas)
  mouseUV: { u: number; v: number };
}

// Built-in shader utility functions (demoscene essentials)
export interface ShaderUtils {
  /** 2D Simplex noise - returns value in range [-1, 1] */
  noise2d(x: number, y: number): number;
  /** Fractal Brownian Motion - layered noise, returns value roughly in range [-1, 1] */
  fbm(x: number, y: number, octaves?: number): number;
  /** Inigo Quilez palette: a + b * cos(2π * (c * t + d)) - returns [r, g, b] in range [0, 255] */
  palette(t: number, a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]): [number, number, number];
  /** Hermite interpolation: 0 when x <= edge0, 1 when x >= edge1, smooth curve between */
  smoothstep(edge0: number, edge1: number, x: number): number;
  /** Linear interpolation: a + (b - a) * t */
  mix(a: number, b: number, t: number): number;
  /** Fractional part: x - floor(x) */
  fract(x: number): number;
}

// ============================================
// Shader Utility Function Implementations
// ============================================

// Simplex 2D noise implementation
// Based on Stefan Gustavson's implementation, optimized for TypeScript
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

// Permutation table (256 values, doubled to avoid modulo)
const perm = new Uint8Array(512);
const gradP = new Array<{ x: number; y: number }>(512);

// Gradient vectors for 2D
const grad2 = [
  { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 },
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
];

// Initialize permutation table with a fixed seed for reproducibility
(function initNoise() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher-Yates shuffle with fixed seed
  let seed = 12345;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    gradP[i] = grad2[perm[i] % 8];
  }
})();

function noise2d(x: number, y: number): number {
  // Skew input space to determine which simplex cell we're in
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);

  // Unskew back to (x, y) space
  const t = (i + j) * G2;
  const X0 = i - t;
  const Y0 = j - t;
  const x0 = x - X0;
  const y0 = y - Y0;

  // Determine which simplex we're in
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;

  // Offsets for corners
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  // Hash coordinates of corners
  const ii = i & 255;
  const jj = j & 255;

  // Calculate contributions from corners
  let n0 = 0, n1 = 0, n2 = 0;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) {
    const g0 = gradP[ii + perm[jj]];
    t0 *= t0;
    n0 = t0 * t0 * (g0.x * x0 + g0.y * y0);
  }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) {
    const g1 = gradP[ii + i1 + perm[jj + j1]];
    t1 *= t1;
    n1 = t1 * t1 * (g1.x * x1 + g1.y * y1);
  }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) {
    const g2 = gradP[ii + 1 + perm[jj + 1]];
    t2 *= t2;
    n2 = t2 * t2 * (g2.x * x2 + g2.y * y2);
  }

  // Scale to [-1, 1]
  return 70 * (n0 + n1 + n2);
}

function fbm(x: number, y: number, octaves: number = 4): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * noise2d(x * frequency, y * frequency);
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / maxValue; // Normalize to roughly [-1, 1]
}

function palette(
  t: number,
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number]
): [number, number, number] {
  // Inigo Quilez palette: a + b * cos(2π * (c * t + d))
  const TAU = Math.PI * 2;
  return [
    Math.max(0, Math.min(255, 255 * (a[0] + b[0] * Math.cos(TAU * (c[0] * t + d[0]))))),
    Math.max(0, Math.min(255, 255 * (a[1] + b[1] * Math.cos(TAU * (c[1] * t + d[1]))))),
    Math.max(0, Math.min(255, 255 * (a[2] + b[2] * Math.cos(TAU * (c[2] * t + d[2]))))),
  ];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  // Clamp x to [0, 1] range relative to edges
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  // Hermite interpolation: 3t² - 2t³
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function fract(x: number): number {
  return x - Math.floor(x);
}

// Singleton utils object to avoid creating per-frame
export const shaderUtils: ShaderUtils = {
  noise2d,
  fbm,
  palette,
  smoothstep,
  mix,
  fract,
};

// Shader callback type - TypeScript, not GLSL
// Called for each pixel, returns RGB [0-255, 0-255, 0-255] or RGBA [0-255, 0-255, 0-255, 0-255]
// The optional `source` parameter provides access to loaded image pixels (for img element)
// The optional `utils` parameter provides built-in shader functions (noise2d, fbm, palette)
export type ShaderCallback = (
  x: number,
  y: number,
  time: number,
  resolution: ShaderResolution,
  source?: ShaderSource,
  utils?: ShaderUtils
) => [number, number, number] | [number, number, number, number];
