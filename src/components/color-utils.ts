// Color utility functions for RGBA color manipulation

// Color constants
export const TRANSPARENT = 0x00000000; // Fully transparent (alpha = 0)
export const DEFAULT_FG = 0xFFFFFFFF;  // White, fully opaque

/**
 * Pack RGBA components into a single 32-bit value
 */
export function packRGBA(r: number, g: number, b: number, a: number = 255): number {
  return ((r & 0xFF) << 24) | ((g & 0xFF) << 16) | ((b & 0xFF) << 8) | (a & 0xFF);
}

/**
 * Unpack a 32-bit RGBA value into components
 */
export function unpackRGBA(color: number): { r: number; g: number; b: number; a: number } {
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
export function rgbaToCss(color: number): string {
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
export function cssToRgba(css: string): number {
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
  const namedColors: Record<string, number> = {
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
