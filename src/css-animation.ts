// CSS animation interpolation engine
// Given keyframes and progress, produces interpolated style properties.

import type { Style, AnimationKeyframe } from './types.ts';
import { packRGBA, unpackRGBA } from './components/color-utils.ts';

/** Style properties that hold packed RGBA color values */
const COLOR_PROPS = new Set([
  'color', 'backgroundColor', 'background', 'foreground',
  'borderColor', 'borderTopColor', 'borderBottomColor',
  'borderLeftColor', 'borderRightColor',
  'dividerColor', 'connectorColor',
]);

/** Style properties that are always numeric (integer lerp) */
const NUMERIC_PROPS = new Set([
  'width', 'height', 'top', 'right', 'bottom', 'left',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'gap',
  'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'flexGrow', 'flexShrink', 'zIndex',
  'barWidth', 'ledWidth', 'highValue', 'cellWidth', 'cellHeight',
  'minPaneSize',
]);

/** Properties that can be BoxSpacing objects { top, right, bottom, left } */
const BOX_SPACING_PROPS = new Set(['padding', 'margin']);

/** Normalize a padding/margin value to a { top, right, bottom, left } object */
function toBoxSpacing(v: any): { top: number; right: number; bottom: number; left: number } | null {
  if (typeof v === 'number') {
    return { top: v, right: v, bottom: v, left: v };
  }
  if (v && typeof v === 'object' && ('top' in v || 'right' in v || 'bottom' in v || 'left' in v)) {
    return { top: v.top || 0, right: v.right || 0, bottom: v.bottom || 0, left: v.left || 0 };
  }
  return null;
}

/**
 * Find the two bracketing keyframes for a given progress and
 * compute the local interpolation factor between them.
 *
 * Returns { from, to, localT } where localT ∈ [0, 1].
 */
export function findKeyframePair(
  keyframes: AnimationKeyframe[],
  progress: number,
): { from: AnimationKeyframe; to: AnimationKeyframe; localT: number } {
  // Clamp
  if (progress <= keyframes[0].offset) {
    return { from: keyframes[0], to: keyframes[0], localT: 0 };
  }
  if (progress >= keyframes[keyframes.length - 1].offset) {
    const last = keyframes[keyframes.length - 1];
    return { from: last, to: last, localT: 0 };
  }

  // Find bracketing pair
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (progress >= a.offset && progress <= b.offset) {
      const span = b.offset - a.offset;
      const localT = span > 0 ? (progress - a.offset) / span : 0;
      return { from: a, to: b, localT };
    }
  }

  // Fallback (shouldn't happen with sorted keyframes)
  const last = keyframes[keyframes.length - 1];
  return { from: last, to: last, localT: 0 };
}

/**
 * Interpolate a single style property value between two keyframe values.
 *
 * - Numeric: linear lerp, rounded to integer
 * - Percentage strings ("30%" / "70%"): lerp numeric part, emit as "XX%"
 * - Color (packed RGBA integer): component-wise lerp
 * - Discrete (everything else): snap at t >= 0.5
 */
function interpolateValue(key: string, from: any, to: any, t: number): any {
  // Same value — no interpolation needed
  if (from === to) return from;

  // Color properties (packed RGBA integers)
  if (COLOR_PROPS.has(key) && typeof from === 'number' && typeof to === 'number') {
    const a = unpackRGBA(from);
    const b = unpackRGBA(to);
    return packRGBA(
      Math.round(a.r + (b.r - a.r) * t),
      Math.round(a.g + (b.g - a.g) * t),
      Math.round(a.b + (b.b - a.b) * t),
      Math.round(a.a + (b.a - a.a) * t),
    );
  }

  // BoxSpacing objects (padding, margin) — lerp each component
  if (BOX_SPACING_PROPS.has(key)) {
    const fromBox = toBoxSpacing(from);
    const toBox = toBoxSpacing(to);
    if (fromBox && toBox) {
      return {
        top: Math.round(fromBox.top + (toBox.top - fromBox.top) * t),
        right: Math.round(fromBox.right + (toBox.right - fromBox.right) * t),
        bottom: Math.round(fromBox.bottom + (toBox.bottom - fromBox.bottom) * t),
        left: Math.round(fromBox.left + (toBox.left - fromBox.left) * t),
      };
    }
  }

  // Both percentage strings — lerp in percentage domain
  if (typeof from === 'string' && typeof to === 'string') {
    const fromPct = from.match(/^(-?\d+(?:\.\d+)?)%$/);
    const toPct = to.match(/^(-?\d+(?:\.\d+)?)%$/);
    if (fromPct && toPct) {
      const v = parseFloat(fromPct[1]) + (parseFloat(toPct[1]) - parseFloat(fromPct[1])) * t;
      return `${Math.round(v * 100) / 100}%`;
    }
  }

  // Numeric properties
  if (NUMERIC_PROPS.has(key) && typeof from === 'number' && typeof to === 'number') {
    return Math.round(from + (to - from) * t);
  }

  // Generic number interpolation (flexBasis when numeric, etc.)
  if (typeof from === 'number' && typeof to === 'number') {
    return Math.round(from + (to - from) * t);
  }

  // Discrete: snap at 50%
  return t < 0.5 ? from : to;
}

/**
 * Interpolate between two keyframe styles at a given local t ∈ [0, 1].
 * Returns a partial style with interpolated values for all properties
 * present in either keyframe.
 */
export function interpolateStyles(
  from: Partial<Style>,
  to: Partial<Style>,
  t: number,
): Partial<Style> {
  const result: Partial<Style> = {};

  // Collect all property keys from both keyframes
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);

  for (const key of keys) {
    const fromVal = key in from ? from[key] : undefined;
    const toVal = key in to ? to[key] : undefined;

    if (fromVal === undefined && toVal !== undefined) {
      // Property only in 'to' — snap at 50%
      if (t >= 0.5) result[key] = toVal;
    } else if (fromVal !== undefined && toVal === undefined) {
      // Property only in 'from' — snap at 50%
      if (t < 0.5) result[key] = fromVal;
    } else {
      result[key] = interpolateValue(key, fromVal, toVal, t);
    }
  }

  return result;
}
