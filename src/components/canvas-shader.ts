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
  /** 2D Simplex noise (alias for noise2d) - returns value in range [-1, 1] */
  simplex2d(x: number, y: number): number;
  /** 3D Simplex noise - returns value in range [-1, 1] */
  simplex3d(x: number, y: number, z: number): number;
  /** 2D Classic Perlin noise (1985) - returns value in range [-1, 1] */
  perlin2d(x: number, y: number): number;
  /** 3D Classic Perlin noise (1985) - returns value in range [-1, 1] */
  perlin3d(x: number, y: number, z: number): number;
  /** Fractal Brownian Motion - layered noise, returns value roughly in range [-1, 1] */
  fbm(x: number, y: number, octaves?: number): number;
  /** 3D Fractal Brownian Motion - layered 3D noise, returns value roughly in range [-1, 1] */
  fbm3d(x: number, y: number, z: number, octaves?: number): number;
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
const gradP2 = new Array<{ x: number; y: number }>(512);
const gradP3 = new Array<{ x: number; y: number; z: number }>(512);

// Gradient vectors for 2D
const grad2 = [
  { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 },
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
];

// Gradient vectors for 3D (12 edges of a cube)
const grad3 = [
  { x: 1, y: 1, z: 0 }, { x: -1, y: 1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: -1, y: -1, z: 0 },
  { x: 1, y: 0, z: 1 }, { x: -1, y: 0, z: 1 }, { x: 1, y: 0, z: -1 }, { x: -1, y: 0, z: -1 },
  { x: 0, y: 1, z: 1 }, { x: 0, y: -1, z: 1 }, { x: 0, y: 1, z: -1 }, { x: 0, y: -1, z: -1 },
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
    gradP2[i] = grad2[perm[i] % 8];
    gradP3[i] = grad3[perm[i] % 12];
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
    const g0 = gradP2[ii + perm[jj]];
    t0 *= t0;
    n0 = t0 * t0 * (g0.x * x0 + g0.y * y0);
  }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) {
    const g1 = gradP2[ii + i1 + perm[jj + j1]];
    t1 *= t1;
    n1 = t1 * t1 * (g1.x * x1 + g1.y * y1);
  }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) {
    const g2 = gradP2[ii + 1 + perm[jj + 1]];
    t2 *= t2;
    n2 = t2 * t2 * (g2.x * x2 + g2.y * y2);
  }

  // Scale to [-1, 1]
  return 70 * (n0 + n1 + n2);
}

// 3D Simplex noise constants
const F3 = 1 / 3;
const G3 = 1 / 6;

function simplex3d(x: number, y: number, z: number): number {
  // Skew input space to determine which simplex cell we're in
  const s = (x + y + z) * F3;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const k = Math.floor(z + s);

  // Unskew back to (x, y, z) space
  const t = (i + j + k) * G3;
  const X0 = i - t;
  const Y0 = j - t;
  const Z0 = k - t;
  const x0 = x - X0;
  const y0 = y - Y0;
  const z0 = z - Z0;

  // Determine which simplex we're in (6 possible simplices)
  let i1: number, j1: number, k1: number;
  let i2: number, j2: number, k2: number;

  if (x0 >= y0) {
    if (y0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    } else if (x0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
    } else {
      i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
    }
  } else {
    if (y0 < z0) {
      i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
    } else if (x0 < z0) {
      i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
    } else {
      i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    }
  }

  // Offsets for corners
  const x1 = x0 - i1 + G3;
  const y1 = y0 - j1 + G3;
  const z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3;
  const y2 = y0 - j2 + 2 * G3;
  const z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3;
  const y3 = y0 - 1 + 3 * G3;
  const z3 = z0 - 1 + 3 * G3;

  // Hash coordinates of corners
  const ii = i & 255;
  const jj = j & 255;
  const kk = k & 255;

  // Calculate contributions from corners
  let n0 = 0, n1 = 0, n2 = 0, n3 = 0;

  let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (t0 >= 0) {
    const g0 = gradP3[ii + perm[jj + perm[kk]]];
    t0 *= t0;
    n0 = t0 * t0 * (g0.x * x0 + g0.y * y0 + g0.z * z0);
  }

  let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (t1 >= 0) {
    const g1 = gradP3[ii + i1 + perm[jj + j1 + perm[kk + k1]]];
    t1 *= t1;
    n1 = t1 * t1 * (g1.x * x1 + g1.y * y1 + g1.z * z1);
  }

  let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (t2 >= 0) {
    const g2 = gradP3[ii + i2 + perm[jj + j2 + perm[kk + k2]]];
    t2 *= t2;
    n2 = t2 * t2 * (g2.x * x2 + g2.y * y2 + g2.z * z2);
  }

  let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (t3 >= 0) {
    const g3 = gradP3[ii + 1 + perm[jj + 1 + perm[kk + 1]]];
    t3 *= t3;
    n3 = t3 * t3 * (g3.x * x3 + g3.y * y3 + g3.z * z3);
  }

  // Scale to [-1, 1]
  return 32 * (n0 + n1 + n2 + n3);
}

// ============================================
// Classic Perlin Noise (1985)
// Grid-based gradient noise with quintic fade
// ============================================

// Quintic fade function: 6t^5 - 15t^4 + 10t^3 (improved from original cubic)
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Linear interpolation
function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function perlin2d(x: number, y: number): number {
  // Find unit grid cell containing point
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;

  // Get relative position within cell
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);

  // Compute fade curves
  const u = fade(xf);
  const v = fade(yf);

  // Hash coordinates of the 4 cube corners
  const aa = perm[xi + perm[yi]];
  const ab = perm[xi + perm[yi + 1]];
  const ba = perm[xi + 1 + perm[yi]];
  const bb = perm[xi + 1 + perm[yi + 1]];

  // Get gradients and compute dot products
  const g00 = gradP2[aa];
  const g10 = gradP2[ba];
  const g01 = gradP2[ab];
  const g11 = gradP2[bb];

  const n00 = g00.x * xf + g00.y * yf;
  const n10 = g10.x * (xf - 1) + g10.y * yf;
  const n01 = g01.x * xf + g01.y * (yf - 1);
  const n11 = g11.x * (xf - 1) + g11.y * (yf - 1);

  // Bilinear interpolation
  const nx0 = lerp(n00, n10, u);
  const nx1 = lerp(n01, n11, u);
  return lerp(nx0, nx1, v);
}

function perlin3d(x: number, y: number, z: number): number {
  // Find unit grid cell containing point
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const zi = Math.floor(z) & 255;

  // Get relative position within cell
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const zf = z - Math.floor(z);

  // Compute fade curves
  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);

  // Hash coordinates of the 8 cube corners
  const aaa = perm[xi + perm[yi + perm[zi]]];
  const aba = perm[xi + perm[yi + 1 + perm[zi]]];
  const aab = perm[xi + perm[yi + perm[zi + 1]]];
  const abb = perm[xi + perm[yi + 1 + perm[zi + 1]]];
  const baa = perm[xi + 1 + perm[yi + perm[zi]]];
  const bba = perm[xi + 1 + perm[yi + 1 + perm[zi]]];
  const bab = perm[xi + 1 + perm[yi + perm[zi + 1]]];
  const bbb = perm[xi + 1 + perm[yi + 1 + perm[zi + 1]]];

  // Get gradients and compute dot products
  const g000 = gradP3[aaa]; const n000 = g000.x * xf + g000.y * yf + g000.z * zf;
  const g100 = gradP3[baa]; const n100 = g100.x * (xf - 1) + g100.y * yf + g100.z * zf;
  const g010 = gradP3[aba]; const n010 = g010.x * xf + g010.y * (yf - 1) + g010.z * zf;
  const g110 = gradP3[bba]; const n110 = g110.x * (xf - 1) + g110.y * (yf - 1) + g110.z * zf;
  const g001 = gradP3[aab]; const n001 = g001.x * xf + g001.y * yf + g001.z * (zf - 1);
  const g101 = gradP3[bab]; const n101 = g101.x * (xf - 1) + g101.y * yf + g101.z * (zf - 1);
  const g011 = gradP3[abb]; const n011 = g011.x * xf + g011.y * (yf - 1) + g011.z * (zf - 1);
  const g111 = gradP3[bbb]; const n111 = g111.x * (xf - 1) + g111.y * (yf - 1) + g111.z * (zf - 1);

  // Trilinear interpolation
  const nx00 = lerp(n000, n100, u);
  const nx01 = lerp(n001, n101, u);
  const nx10 = lerp(n010, n110, u);
  const nx11 = lerp(n011, n111, u);
  const nxy0 = lerp(nx00, nx10, v);
  const nxy1 = lerp(nx01, nx11, v);
  return lerp(nxy0, nxy1, w);
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

function fbm3d(x: number, y: number, z: number, octaves: number = 4): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * simplex3d(x * frequency, y * frequency, z * frequency);
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
  simplex2d: noise2d, // Alias for clarity
  simplex3d,
  perlin2d,
  perlin3d,
  fbm,
  fbm3d,
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
