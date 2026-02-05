// Color utility functions for RGBA color manipulation

import type { PackedRGBA, ColorInput } from '../types.ts';

// Color constants
export const TRANSPARENT: PackedRGBA = 0x00000000; // Fully transparent (alpha = 0)
export const DEFAULT_FG: PackedRGBA = 0xFFFFFFFF;  // White, fully opaque

/**
 * Named terminal colors as packed RGBA values
 * Use these instead of string literals for colors in components
 */
export const COLORS: Record<string, PackedRGBA> = {
  // Standard ANSI colors
  black: 0x000000FF,
  red: 0xFF0000FF,
  green: 0x00FF00FF,
  yellow: 0xFFFF00FF,
  blue: 0x0000FFFF,
  magenta: 0xFF00FFFF,
  cyan: 0x00FFFFFF,
  white: 0xFFFFFFFF,
  gray: 0x808080FF,
  grey: 0x808080FF,  // Alias
  // Bright ANSI colors
  brightBlack: 0x808080FF,
  brightRed: 0xFF5555FF,
  brightGreen: 0x55FF55FF,
  brightYellow: 0xFFFF55FF,
  brightBlue: 0x5555FFFF,
  brightMagenta: 0xFF55FFFF,
  brightCyan: 0x55FFFFFF,
  brightWhite: 0xFFFFFFFF,
  // Common web colors
  orange: 0xFFA500FF,
  purple: 0x800080FF,
  pink: 0xFFC0CBFF,
  transparent: TRANSPARENT,
};

/**
 * Parse any color input (string or number) to packed RGBA
 * Handles CSS strings (hex, rgb(), named) and passes through numbers
 */
export function parseColor(color: ColorInput | undefined): PackedRGBA | undefined {
  if (color === undefined) return undefined;
  if (typeof color === 'number') return color;
  return cssToRgba(color);
}

/**
 * Pack RGBA components into a single 32-bit value
 */
export function packRGBA(r: number, g: number, b: number, a: number = 255): PackedRGBA {
  return ((r & 0xFF) << 24) | ((g & 0xFF) << 16) | ((b & 0xFF) << 8) | (a & 0xFF);
}

/**
 * Unpack a 32-bit RGBA value into components
 */
export function unpackRGBA(color: PackedRGBA): { r: number; g: number; b: number; a: number } {
  return {
    r: (color >> 24) & 0xFF,
    g: (color >> 16) & 0xFF,
    b: (color >> 8) & 0xFF,
    a: color & 0xFF
  };
}

// Color string cache to avoid per-cell string allocations
// Size-limited to prevent unbounded memory growth
const _colorStringCache = new Map<number, string>();
const _COLOR_CACHE_MAX_SIZE = 4096;

/**
 * Convert packed RGBA to CSS color string (cached)
 */
export function rgbaToCss(color: PackedRGBA): string {
  // Check cache first
  const cached = _colorStringCache.get(color);
  if (cached !== undefined) {
    return cached;
  }

  // Compute the color string
  const r = (color >> 24) & 0xFF;
  const g = (color >> 16) & 0xFF;
  const b = (color >> 8) & 0xFF;
  const a = color & 0xFF;

  let result: string;
  if (a === 255) {
    result = `rgb(${r},${g},${b})`;
  } else {
    result = `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
  }

  // Add to cache with size limit
  if (_colorStringCache.size >= _COLOR_CACHE_MAX_SIZE) {
    // Clear oldest entries (first 25% of cache)
    const deleteCount = _COLOR_CACHE_MAX_SIZE >> 2;
    let count = 0;
    for (const key of _colorStringCache.keys()) {
      if (count++ >= deleteCount) break;
      _colorStringCache.delete(key);
    }
  }
  _colorStringCache.set(color, result);

  return result;
}

/**
 * Parse CSS color string to packed RGBA
 */
export function cssToRgba(css: string): PackedRGBA {
  // Handle hex colors
  if (css.startsWith('#')) {
    const hex = css.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return packRGBA(r, g, b, 255);
    } else if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return packRGBA(r, g, b, 255);
    } else if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = parseInt(hex.slice(6, 8), 16);
      return packRGBA(r, g, b, a);
    }
  }
  // Handle rgb/rgba
  const rgbMatch = css.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]);
    const g = parseInt(rgbMatch[2]);
    const b = parseInt(rgbMatch[3]);
    const a = rgbMatch[4] ? Math.round(parseFloat(rgbMatch[4]) * 255) : 255;
    return packRGBA(r, g, b, a);
  }
  // Handle named colors (basic set)
  const namedColors: Record<string, PackedRGBA> = {
    'black': packRGBA(0, 0, 0, 255),
    'white': packRGBA(255, 255, 255, 255),
    'red': packRGBA(255, 0, 0, 255),
    'green': packRGBA(0, 128, 0, 255),
    'blue': packRGBA(0, 0, 255, 255),
    'yellow': packRGBA(255, 255, 0, 255),
    'cyan': packRGBA(0, 255, 255, 255),
    'magenta': packRGBA(255, 0, 255, 255),
    'orange': packRGBA(255, 165, 0, 255),
    'purple': packRGBA(128, 0, 128, 255),
    'pink': packRGBA(255, 192, 203, 255),
    'gray': packRGBA(128, 128, 128, 255),
    'grey': packRGBA(128, 128, 128, 255),
    'transparent': TRANSPARENT,
  };
  return namedColors[css.toLowerCase()] ?? DEFAULT_FG;
}

// ============================================================================
// Color Space Conversion and Interpolation
// ============================================================================

export type ColorSpace = 'rgb' | 'hsl' | 'oklch';

export interface RGB { r: number; g: number; b: number }
export interface HSL { h: number; s: number; l: number }
export interface OKLCH { l: number; c: number; h: number }

/**
 * Parse hex color string to RGB components (0-255)
 */
export function parseHexToRgb(color: string): RGB {
  const hex = color.replace('#', '');
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

/**
 * Convert RGB (0-255) to hex string
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

/**
 * Convert RGB (0-255) to HSL (h: 0-360, s: 0-1, l: 0-1)
 */
export function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s, l };
}

/**
 * Convert HSL to RGB (0-255)
 */
export function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360; // Normalize hue
  h /= 360;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };

  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

/**
 * Convert RGB (0-255) to OKLCH
 * Based on Björn Ottosson's Oklab color space
 */
export function rgbToOklch(r: number, g: number, b: number): OKLCH {
  // Convert sRGB to linear RGB
  const toLinear = (c: number) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);

  // Linear RGB to Oklab
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const bOk = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  // Oklab to OKLCH
  const c = Math.sqrt(a * a + bOk * bOk);
  let h = Math.atan2(bOk, a) * 180 / Math.PI;
  if (h < 0) h += 360;

  return { l: L, c, h };
}

/**
 * Convert OKLCH to RGB (0-255)
 */
export function oklchToRgb(l: number, c: number, h: number): RGB {
  // OKLCH to Oklab
  const hRad = h * Math.PI / 180;
  const a = c * Math.cos(hRad);
  const bOk = c * Math.sin(hRad);

  // Oklab to linear RGB
  const l_ = l + 0.3963377774 * a + 0.2158037573 * bOk;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * bOk;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * bOk;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const lr = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

  // Linear RGB to sRGB
  const toSrgb = (c: number) => {
    c = Math.max(0, Math.min(1, c));
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };

  return {
    r: toSrgb(lr) * 255,
    g: toSrgb(lg) * 255,
    b: toSrgb(lb) * 255,
  };
}

/**
 * Interpolate between two hex colors in the specified color space
 * @param color1 - Start color (hex string)
 * @param color2 - End color (hex string)
 * @param t - Interpolation factor (0-1)
 * @param colorSpace - Color space for interpolation ('rgb', 'hsl', 'oklch')
 * @returns Interpolated color as hex string
 */
export function lerpColor(color1: string, color2: string, t: number, colorSpace: ColorSpace = 'rgb'): string {
  const rgb1 = parseHexToRgb(color1);
  const rgb2 = parseHexToRgb(color2);

  if (colorSpace === 'rgb') {
    // Simple RGB interpolation
    return rgbToHex(
      rgb1.r + (rgb2.r - rgb1.r) * t,
      rgb1.g + (rgb2.g - rgb1.g) * t,
      rgb1.b + (rgb2.b - rgb1.b) * t
    );
  } else if (colorSpace === 'hsl') {
    // HSL interpolation (better for hue transitions)
    const hsl1 = rgbToHsl(rgb1.r, rgb1.g, rgb1.b);
    const hsl2 = rgbToHsl(rgb2.r, rgb2.g, rgb2.b);

    // Handle hue wraparound (take shortest path)
    let h1 = hsl1.h, h2 = hsl2.h;
    if (Math.abs(h2 - h1) > 180) {
      if (h2 > h1) h1 += 360;
      else h2 += 360;
    }

    const h = h1 + (h2 - h1) * t;
    const s = hsl1.s + (hsl2.s - hsl1.s) * t;
    const l = hsl1.l + (hsl2.l - hsl1.l) * t;

    const rgb = hslToRgb(h, s, l);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  } else {
    // OKLCH interpolation (perceptually uniform)
    const lch1 = rgbToOklch(rgb1.r, rgb1.g, rgb1.b);
    const lch2 = rgbToOklch(rgb2.r, rgb2.g, rgb2.b);

    // Handle hue wraparound (take shortest path)
    let h1 = lch1.h, h2 = lch2.h;
    // Handle achromatic colors (c ≈ 0)
    if (lch1.c < 0.001) h1 = h2;
    if (lch2.c < 0.001) h2 = h1;
    if (Math.abs(h2 - h1) > 180) {
      if (h2 > h1) h1 += 360;
      else h2 += 360;
    }

    const l = lch1.l + (lch2.l - lch1.l) * t;
    const c = lch1.c + (lch2.c - lch1.c) * t;
    const h = h1 + (h2 - h1) * t;

    const rgb = oklchToRgb(l, c, h);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }
}

// Color property names that should be parsed from strings to packed numbers
const COLOR_STYLE_PROPS = new Set([
  'color',
  'backgroundColor',
  'background',      // Alias for backgroundColor
  'foreground',      // Alias for color
  'borderColor',
  'borderTopColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderRightColor',
]);

/**
 * Normalize a style object by converting color strings to packed RGBA numbers.
 * This is called at entry points (createElement, stylesheet parsing) to ensure
 * all color values in Style are numbers internally.
 *
 * @param style - Style object that may contain color strings
 * @returns Style object with all colors as packed RGBA numbers
 */
export function normalizeStyle<T extends Record<string, unknown>>(style: T): T {
  if (!style || typeof style !== 'object') return style;

  const result = { ...style };
  for (const key of Object.keys(result)) {
    if (COLOR_STYLE_PROPS.has(key)) {
      const value = result[key];
      if (typeof value === 'string') {
        (result as Record<string, unknown>)[key] = cssToRgba(value);
      }
    }
  }
  return result;
}
