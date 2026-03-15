// Built-in shader effects for canvas/img components
// Each export is a factory that returns a ShaderCallback, with optional config.

import type { ShaderCallback } from './canvas-shader.ts';
import { shaderUtils } from './canvas-shader.ts';

const { simplex3d, smoothstep } = shaderUtils;

// --- Fisheye ---

export interface FisheyeOptions {
  /** Radius as fraction of min(width, height). Default: 0.72 */
  radius?: number;
  /** Fade-to-black starts at this fraction of radius. Default: 0.75 */
  fadeStart?: number;
  /** Distortion exponent (lower = more magnification). Default: 0.18 */
  exponent?: number;
  /** Zoom divisor (higher = more zoom). Default: 2.3 */
  zoom?: number;
}

export function fisheye(opts: FisheyeOptions = {}): ShaderCallback {
  const radiusFrac = opts.radius ?? 0.72;
  const fadeStart = opts.fadeStart ?? 0.75;
  const exponent = opts.exponent ?? 0.18;
  const zoom = opts.zoom ?? 2.3;

  return (x, y, _time, resolution, source) => {
    const mx = source?.mouse?.x ?? -1;
    const my = source?.mouse?.y ?? -1;
    if (mx < 0 || my < 0) return source?.getPixel(x, y) ?? [0, 0, 0];

    const radius = Math.min(resolution.width, resolution.height) * radiusFrac;
    const dx = x - mx;
    const dyRaw = y - my;
    const aspect = resolution.pixelAspect || 0.5;
    const dy = dyRaw / aspect;
    const dist2 = dx * dx + dy * dy;
    const r2 = radius * radius;

    if (dist2 > r2) return source?.getPixel(x, y) ?? [0, 0, 0];
    if (dist2 < 1) {
      if (source!.originalWidth > 0) return source!.getOriginalPixel(mx / resolution.width, my / resolution.height) ?? [0, 0, 0];
      return source?.getPixel(mx, my) ?? [0, 0, 0];
    }

    const dist = Math.sqrt(dist2);
    const norm = dist / radius;
    const scale = Math.pow(norm, exponent) / zoom;
    const sx = mx + dx * scale;
    const sy = my + dyRaw * scale;

    let pixel;
    if (source!.originalWidth > 0) {
      const u = sx / resolution.width;
      const v = sy / resolution.height;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) return [0, 0, 0] as [number, number, number];
      pixel = source!.getOriginalPixel(u, v);
    } else {
      const isx = Math.round(sx);
      const isy = Math.round(sy);
      if (isx < 0 || isx >= resolution.width || isy < 0 || isy >= resolution.height) return [0, 0, 0] as [number, number, number];
      pixel = source!.getPixel(isx, isy);
    }
    if (!pixel) return [0, 0, 0] as [number, number, number];

    if (norm > fadeStart) {
      const fade = 1 - (norm - fadeStart) / (1 - fadeStart);
      return [pixel[0] * fade, pixel[1] * fade, pixel[2] * fade];
    }
    return pixel;
  };
}

// --- Lightning ---

export interface LightningOptions {
  /** Bolt duration in seconds. Default: 0.5 */
  boltDuration?: number;
  /** Sky flash intensity. Default: 0.3 */
  flashIntensity?: number;
}

export function lightning(opts: LightningOptions = {}): ShaderCallback {
  const boltDuration = opts.boltDuration ?? 0.5;
  const flashIntensity = opts.flashIntensity ?? 0.3;

  return (x, y, time, resolution, source) => {
    const pixel = source?.getPixel(x, y);
    if (!pixel) return [0, 0, 0];
    const w = resolution.width;
    const h = resolution.height;
    const nx = x / w;
    const ny = y / h;

    const period = 3.5 + simplex3d(0, 0, Math.floor(time * 0.3)) * 1.5;
    const cycle = time % period;
    const strike = cycle < boltDuration;

    if (!strike) {
      const storm = 0.92 + simplex3d(nx * 2, ny * 2, time * 0.1) * 0.05;
      return [Math.round(pixel[0] * storm * 0.95), Math.round(pixel[1] * storm * 0.95), Math.round(pixel[2] * storm)];
    }

    const boltSeed = Math.floor(time / period);
    const boltX = 0.3 + simplex3d(boltSeed * 7.3, 0, 0) * 0.4;
    const wiggle = simplex3d(boltSeed * 3.1, ny * 8, boltSeed) * 0.12;
    const forkWiggle = simplex3d(boltSeed * 5.7, ny * 6, boltSeed + 50) * 0.08;
    const boltDist = Math.abs(nx - boltX - wiggle);
    const forkStart = 0.3 + simplex3d(boltSeed * 2, 0, 0) * 0.2;
    const forkX = boltX + (ny - forkStart) * 0.3 + forkWiggle;
    const forkDist = ny > forkStart ? Math.abs(nx - forkX) : 1;

    const boltWidth = 0.015;
    const glowWidth = 0.08;
    const mainBolt = boltDist < boltWidth ? 1.0 : boltDist < glowWidth ? Math.pow(1 - (boltDist - boltWidth) / (glowWidth - boltWidth), 2) * 0.6 : 0;
    const fork = forkDist < boltWidth * 0.7 ? 0.8 : forkDist < glowWidth * 0.6 ? Math.pow(1 - (forkDist - boltWidth * 0.7) / (glowWidth * 0.6 - boltWidth * 0.7), 2) * 0.4 : 0;
    const bolt = Math.min(1, mainBolt + fork);

    const flashFade = 1 - cycle / boltDuration;
    const skyFlash = flashFade * flashFade * flashIntensity * (1 - ny * 0.5);

    const intensity = Math.min(1, bolt + skyFlash);
    return [
      Math.min(255, Math.round(pixel[0] + intensity * (240 - pixel[0]))),
      Math.min(255, Math.round(pixel[1] + intensity * (235 - pixel[1]))),
      Math.min(255, Math.round(pixel[2] + intensity * (255 - pixel[2])))
    ];
  };
}

// --- Rain ---

export interface RainOptions {
  /** Dimming factor for overcast feel. Default: 0.82 */
  dim?: number;
  /** Scroll speed. Default: 40 */
  speed?: number;
}

export function rain(opts: RainOptions = {}): ShaderCallback {
  const dim = opts.dim ?? 0.82;
  const speed = opts.speed ?? 40;

  return (x, y, time, _resolution, source) => {
    const pixel = source?.getPixel(x, y);
    if (!pixel) return [0, 0, 0];
    const scroll = y - time * speed;
    const streak = simplex3d(x * 0.4, scroll * 0.15, time * 0.5);
    const drop = streak > 0.65 ? (streak - 0.65) * 2.8 : 0;
    return [
      Math.min(255, Math.round(pixel[0] * dim + drop * 60)),
      Math.min(255, Math.round(pixel[1] * dim + drop * 80)),
      Math.min(255, Math.round(pixel[2] * dim + drop * 120))
    ];
  };
}

// --- Bloom ---

export interface BloomOptions {
  /** Luma threshold for glow. Default: 0.25 */
  threshold?: number;
  /** Glow strength multiplier. Default: 1.3 */
  strength?: number;
}

export function bloom(opts: BloomOptions = {}): ShaderCallback {
  const threshold = opts.threshold ?? 0.25;
  const strength = opts.strength ?? 1.3;

  return (x, y, time, _resolution, source) => {
    const pixel = source?.getPixel(x, y);
    if (!pixel) return [0, 0, 0];
    const luma = (pixel[0] * 0.299 + pixel[1] * 0.587 + pixel[2] * 0.114) / 255;
    const pulse = 0.6 + 0.4 * Math.sin(time * 0.8);
    const spread = simplex3d(x * 0.06, y * 0.08, time * 0.3) * 0.15;
    const glow = luma > threshold ? (luma - threshold) * strength * pulse + spread : spread * pulse;
    return [
      Math.min(255, Math.round(pixel[0] + glow * (255 - pixel[0]))),
      Math.min(255, Math.round(pixel[1] + glow * (235 - pixel[1]))),
      Math.min(255, Math.round(pixel[2] + glow * (180 - pixel[2])))
    ];
  };
}

// --- Sunrays ---

export interface SunraysOptions {
  /** Ray intensity (0-1). Default: 0.6 */
  intensity?: number;
  /** Ray sweep speed. Default: 0.15 */
  speed?: number;
}

export function sunrays(opts: SunraysOptions = {}): ShaderCallback {
  const intensityMax = opts.intensity ?? 0.6;
  const speed = opts.speed ?? 0.15;

  return (x, y, time, resolution, source) => {
    const pixel = source?.getPixel(x, y);
    if (!pixel) return [0, 0, 0];
    const nx = x / resolution.width;
    const ny = y / resolution.height;
    // Radial angle from upper-right source
    const angle = Math.atan2(ny + 0.1, nx - 1.1);
    // Many thin ray bands rotating slowly
    const ray = Math.pow(Math.max(0, Math.sin(angle * 12 + time * speed)), 4);
    // Brighter toward upper-right
    const falloff = Math.max(0, 1.2 - nx * 0.4 - ny * 0.6);
    const i = ray * falloff * intensityMax;
    // Pure additive warm light — visible even on dark images
    return [
      Math.min(255, Math.round(pixel[0] + i * 180)),
      Math.min(255, Math.round(pixel[1] + i * 140)),
      Math.min(255, Math.round(pixel[2] + i * 50))
    ];
  };
}

// --- Glitch ---

export interface GlitchOptions {
  /** Glitch burst frequency (higher = less frequent). Default: 7 */
  period?: number;
  /** Max pixel displacement. Default: 20 */
  displacement?: number;
}

export function glitch(opts: GlitchOptions = {}): ShaderCallback {
  const period = opts.period ?? 7;
  const displacement = opts.displacement ?? 20;

  return (x, y, time, resolution, source) => {
    const pixel = source?.getPixel(x, y);
    if (!pixel) return [0, 0, 0];
    const burst = Math.floor(time * 2) % period;
    if (burst > 1) return pixel;
    const band = simplex3d(0, y * 0.08, Math.floor(time * 6));
    const shift = band > 0.4 ? Math.floor((band - 0.4) * displacement) : 0;
    const pr = source!.getPixel(Math.min(resolution.width - 1, x + shift), y);
    const pb = source!.getPixel(Math.max(0, x - shift), y);
    const scan = y % 3 === 0 ? 0.7 : 1.0;
    return [
      Math.min(255, Math.round((pr?.[0] || pixel[0]) * scan)),
      Math.round(pixel[1] * scan),
      Math.min(255, Math.round((pb?.[2] || pixel[2]) * scan))
    ];
  };
}

// --- Fog ---

export interface FogOptions {
  /** Max fog density. Default: 0.75 */
  density?: number;
}

export function fog(opts: FogOptions = {}): ShaderCallback {
  const maxDensity = opts.density ?? 0.75;

  return (x, y, time, resolution, source) => {
    const pixel = source?.getPixel(x, y);
    if (!pixel) return [0, 0, 0];
    const nx = x / resolution.width;
    const ny = y / resolution.height;
    const n1 = simplex3d(nx * 2.5 + time * 0.12, ny * 1.5, time * 0.06);
    const n2 = simplex3d(nx * 5 - time * 0.09, ny * 3, time * 0.04);
    const n3 = simplex3d(nx * 1.2 + 10, ny * 0.8 + 10, time * 0.02);
    const density = (n1 * 0.4 + n2 * 0.3 + n3 * 0.3 + 0.5) * 0.7;
    const heightFade = 0.3 + ny * 0.7;
    const f = Math.min(maxDensity, density * heightFade);
    return [
      Math.round(pixel[0] + f * (210 - pixel[0])),
      Math.round(pixel[1] + f * (215 - pixel[1])),
      Math.round(pixel[2] + f * (220 - pixel[2]))
    ];
  };
}

// --- Fire ---

export interface FireOptions {
  /** Max fire intensity. Default: 0.45 */
  intensity?: number;
  /** Flicker speed. Default: 3 */
  flickerSpeed?: number;
}

export function fire(opts: FireOptions = {}): ShaderCallback {
  const intensityMax = opts.intensity ?? 0.45;
  const flickerSpeed = opts.flickerSpeed ?? 3;

  return (x, y, time, resolution, source) => {
    const pixel = source?.getPixel(x, y);
    if (!pixel) return [0, 0, 0];
    const ny = y / resolution.height;
    const heat = Math.pow(ny, 1.5);
    const flicker = simplex3d(x * 0.1, y * 0.05, time * flickerSpeed) * 0.5 + 0.5;
    const intensity = heat * flicker * intensityMax;
    return [
      Math.min(255, Math.round(pixel[0] + intensity * (255 - pixel[0]))),
      Math.min(255, Math.round(pixel[1] + intensity * (120 - Math.min(120, pixel[1])))),
      Math.round(pixel[2] * (1 - intensity * 0.6))
    ];
  };
}

// --- Underwater ---

export interface UnderwaterOptions {
  /** Depth darkening factor. Default: 0.3 */
  depthFade?: number;
}

export function underwater(opts: UnderwaterOptions = {}): ShaderCallback {
  const depthFade = opts.depthFade ?? 0.3;

  return (x, y, time, resolution, source) => {
    const pixel = source?.getPixel(x, y);
    if (!pixel) return [0, 0, 0];
    const c1 = simplex3d(x * 0.08 + time * 0.3, y * 0.06, time * 0.2);
    const c2 = simplex3d(x * 0.05 - time * 0.2, y * 0.09, time * 0.15 + 5);
    const caustic = Math.max(0, c1 + c2 - 0.5) * 0.5;
    const ny = y / resolution.height;
    const depth = 1 - ny * depthFade;
    return [
      Math.round(pixel[0] * 0.6 * depth + caustic * 40),
      Math.min(255, Math.round(pixel[1] * 0.8 * depth + caustic * 80)),
      Math.min(255, Math.round(pixel[2] * depth + caustic * 100))
    ];
  };
}

// --- Snow ---

export interface SnowOptions {
  /** Number of snowflake layers. Default: 3 */
  layers?: number;
  /** Base fall speed. Default: 8 */
  speed?: number;
}

export function snow(opts: SnowOptions = {}): ShaderCallback {
  const layers = opts.layers ?? 3;
  const baseSpeed = opts.speed ?? 8;

  return (x, y, time, _resolution, source) => {
    const pixel = source?.getPixel(x, y);
    if (!pixel) return [0, 0, 0];
    const cold = 0.9;
    let r = pixel[0] * cold * 0.92;
    let g = pixel[1] * cold * 0.96;
    let b = Math.min(255, pixel[2] * cold * 1.05 + 8);
    for (let layer = 0; layer < layers; layer++) {
      const speed = baseSpeed + layer * 6;
      const drift = 3 + layer * 2;
      const density = 0.82 - layer * 0.05;
      const sx = x + simplex3d(y * 0.05, time * 0.3, layer * 10) * drift;
      const sy = y - time * speed;
      const n = simplex3d(sx * (0.15 + layer * 0.05), sy * (0.15 + layer * 0.05), layer * 7);
      if (n > density) {
        const flake = (n - density) / (1 - density);
        r = Math.min(255, r + flake * 200);
        g = Math.min(255, g + flake * 200);
        b = Math.min(255, b + flake * 210);
      }
    }
    return [Math.round(r), Math.round(g), Math.round(b)];
  };
}

// --- Darkness ---

export interface DarknessOptions {
  /** Visible radius fraction from center. Default: 0.25 */
  radius?: number;
  /** Fade-out width. Default: 0.3 */
  fadeWidth?: number;
}

export function darkness(opts: DarknessOptions = {}): ShaderCallback {
  const baseRadius = opts.radius ?? 0.25;
  const fadeWidth = opts.fadeWidth ?? 0.3;

  return (x, y, time, resolution, source) => {
    const pixel = source?.getPixel(x, y);
    if (!pixel) return [0, 0, 0];
    const nx = x / resolution.width;
    const ny = y / resolution.height;
    const cx = 0.5 + simplex3d(time * 0.1, 0, 0) * 0.1;
    const cy = 0.5 + simplex3d(0, time * 0.1, 0) * 0.1;
    const dx = nx - cx;
    const dy = ny - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const edge = baseRadius + simplex3d(nx * 3, ny * 3, time * 0.2) * 0.08;
    const vis = dist < edge ? 1 : dist < edge + fadeWidth ? Math.pow(1 - (dist - edge) / fadeWidth, 2) : 0;
    const pulse = 0.85 + Math.sin(time * 1.2) * 0.15;
    const fade = vis * pulse;
    return [
      Math.round(pixel[0] * fade * 0.85),
      Math.round(pixel[1] * fade * 0.8),
      Math.round(pixel[2] * fade * 0.9)
    ];
  };
}

// --- Sandstorm ---

export interface SandstormOptions {
  /** Wind speed. Default: 50 */
  windSpeed?: number;
  /** Haze intensity. Default: 0.4 */
  haze?: number;
}

export function sandstorm(opts: SandstormOptions = {}): ShaderCallback {
  const windSpeed = opts.windSpeed ?? 50;
  const hazeMax = opts.haze ?? 0.4;

  return (x, y, time, resolution, source) => {
    const pixel = source?.getPixel(x, y);
    if (!pixel) return [0, 0, 0];
    const streak = simplex3d((x - time * windSpeed) * 0.06, y * 0.2, time * 0.3);
    const streak2 = simplex3d((x - time * windSpeed * 0.7) * 0.1, y * 0.15, time * 0.2 + 5);
    const sand = Math.max(0, streak * 0.5 + streak2 * 0.3 + 0.1);
    const haze = 0.3 + sand * hazeMax;
    return [
      Math.min(255, Math.round(pixel[0] * (1 - haze) + haze * 210)),
      Math.min(255, Math.round(pixel[1] * (1 - haze) + haze * 170)),
      Math.min(255, Math.round(pixel[2] * (1 - haze) + haze * 100))
    ];
  };
}

// --- Magic ---

export interface MagicOptions {
  /** Distortion strength. Default: 8 */
  distortion?: number;
  /** Drift speed (upward). Default: 0.8 */
  driftSpeed?: number;
}

export function magic(opts: MagicOptions = {}): ShaderCallback {
  const distortion = opts.distortion ?? 8;
  const driftSpeed = opts.driftSpeed ?? 0.8;

  return (x, y, time, _resolution, source) => {
    if (!source) return [0, 0, 0];

    // Drifting simplex field determines splash regions
    const drift = y + time * driftSpeed;
    const n = simplex3d(x * 0.035, drift * 0.06, time * 0.15);

    // Distort sample coordinates in splash regions
    let sx = x, sy = y;
    if (n > 0.15) {
      const strength = (n - 0.15) * distortion;
      const angle = simplex3d(x * 0.02, y * 0.02, time * 0.25) * 6.28;
      sx = x + Math.cos(angle) * strength;
      sy = y + Math.sin(angle) * strength;
    }

    const pixel = source.getPixel(Math.round(sx), Math.round(sy));
    if (!pixel) return [0, 0, 0];
    let r = pixel[0], g = pixel[1], b = pixel[2];

    // Color splashes — tint distorted areas with warm shifting hues
    if (n > 0.25) {
      const intensity = (n - 0.25) * 1.4;
      const hue = simplex3d(x * 0.02, drift * 0.015, time * 0.2) * 6.28;
      r = Math.min(255, r + intensity * (120 + 80 * Math.sin(hue)));
      g = Math.min(255, g + intensity * (60 + 50 * Math.sin(hue + 1.8)));
      b = Math.min(255, b + intensity * (30 + 25 * Math.sin(hue + 3.6)));
    }

    // Second slower layer — larger cooler splashes
    const n2 = simplex3d(x * 0.02 + 40, (y + time * driftSpeed * 0.4) * 0.04, time * 0.1);
    if (n2 > 0.3) {
      const intensity = (n2 - 0.3) * 1.2;
      const hue = simplex3d(x * 0.015, y * 0.015, time * 0.12 + 10) * 6.28;
      r = Math.min(255, r + intensity * (80 + 60 * Math.sin(hue)));
      g = Math.min(255, g + intensity * (40 + 70 * Math.sin(hue + 2.2)));
      b = Math.min(255, b + intensity * (20 + 30 * Math.sin(hue + 4.0)));
    }

    return [Math.round(r), Math.round(g), Math.round(b)];
  };
}

// --- Heat ---

export interface HeatOptions {
  /** Max horizontal shimmer in pixels. Default: 3 */
  shimmer?: number;
  /** Warm tint intensity. Default: 0.15 */
  warmth?: number;
}

export function heat(opts: HeatOptions = {}): ShaderCallback {
  const shimmerMax = opts.shimmer ?? 3;
  const warmth = opts.warmth ?? 0.15;

  return (x, y, time, resolution, source) => {
    const w = resolution.width;
    const h = resolution.height;
    const ny = y / h;
    const heatIntensity = Math.pow(ny, 0.8);
    const shimmerX = simplex3d(x * 0.04, (y - time * 12) * 0.08, time * 0.5) * shimmerMax * heatIntensity;
    const shimmerY = simplex3d(x * 0.06, (y - time * 15) * 0.06, time * 0.4 + 10) * (shimmerMax * 0.5) * heatIntensity;
    const sx = Math.round(Math.max(0, Math.min(w - 1, x + shimmerX)));
    const sy = Math.round(Math.max(0, Math.min(h - 1, y + shimmerY)));
    const pixel = source?.getPixel(sx, sy);
    if (!pixel) return [0, 0, 0];
    const warm = heatIntensity * warmth;
    return [
      Math.min(255, Math.round(pixel[0] + warm * (240 - pixel[0]))),
      Math.min(255, Math.round(pixel[1] + warm * (180 - pixel[1]))),
      Math.round(pixel[2] * (1 - warm * 0.3))
    ];
  };
}

// --- Lookup by name ---

/** All built-in shader effect factories, keyed by name */
export const shaderEffects: Record<string, (opts?: Record<string, unknown>) => ShaderCallback> = {
  fisheye,
  lightning,
  rain,
  bloom,
  sunrays,
  glitch,
  fog,
  fire,
  underwater,
  snow,
  darkness,
  sandstorm,
  magic,
  heat,
};
