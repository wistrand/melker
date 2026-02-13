// Geometry utilities for bounds, points, and clipping
// Shared utilities used across hit-testing, scrolling, rendering, and viewport management

import { Bounds, Position } from './types.ts';

// Re-export types for convenience
export type Point = Position;
export type { Bounds, Position };

/**
 * Clamp a number to a range [min, max]
 */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Check if a point is within bounds
 */
export function pointInBounds(x: number, y: number, bounds: Bounds): boolean {
  return x >= bounds.x && x < bounds.x + bounds.width &&
         y >= bounds.y && y < bounds.y + bounds.height;
}

/**
 * Clamp a point to stay within bounds
 */
export function clampToBounds(pos: Point, bounds: Bounds): Point {
  return {
    x: clamp(pos.x, bounds.x, bounds.x + bounds.width - 1),
    y: clamp(pos.y, bounds.y, bounds.y + bounds.height - 1),
  };
}

/**
 * Clip bounds to a rectangle (intersection of two bounds)
 */
export function clipBounds(bounds: Bounds, clipRect: Bounds): Bounds {
  const x1 = Math.max(bounds.x, clipRect.x);
  const y1 = Math.max(bounds.y, clipRect.y);
  const x2 = Math.min(bounds.x + bounds.width, clipRect.x + clipRect.width);
  const y2 = Math.min(bounds.y + bounds.height, clipRect.y + clipRect.height);

  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
  };
}

/**
 * Check if two bounds intersect
 */
export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width &&
         a.x + a.width > b.x &&
         a.y < b.y + b.height &&
         a.y + a.height > b.y;
}
