/**
 * Connector Utilities
 *
 * Line drawing utilities for the Connector component.
 * Uses box-drawing characters for orthogonal lines.
 * Supports obstacle avoidance and drawing under obstacles when unavoidable.
 */

import type { DualBuffer, Cell } from '../buffer.ts';
import type { Bounds } from '../types.ts';

/** Point in 2D space */
export interface Point {
  x: number;
  y: number;
}

/** Side of a bounding box */
export type Side = 'top' | 'bottom' | 'left' | 'right' | 'center' | 'auto';

/** Routing options */
export interface RoutingOptions {
  /** Bounds of obstacles to avoid */
  obstacles?: Bounds[];
  /** Paths of existing connectors to avoid */
  existingPaths?: Point[][];
  /** Margin around obstacles (default: 1) */
  margin?: number;
  /** Source element bounds (to exclude from obstacles) */
  fromBounds?: Bounds;
  /** Target element bounds (to exclude from obstacles) */
  toBounds?: Bounds;
}

/** Line characters for different styles */
export const LINE_CHARS = {
  thin: {
    h: '─',      // horizontal
    v: '│',      // vertical
    tl: '┌',     // top-left corner
    tr: '┐',     // top-right corner
    bl: '└',     // bottom-left corner
    br: '┘',     // bottom-right corner
    t: '┬',      // T down
    b: '┴',      // T up
    l: '├',      // T right
    r: '┤',      // T left
    x: '┼',      // cross
  },
  thick: {
    h: '━',
    v: '┃',
    tl: '┏',
    tr: '┓',
    bl: '┗',
    br: '┛',
    t: '┳',
    b: '┻',
    l: '┣',
    r: '┫',
    x: '╋',
  },
  double: {
    h: '═',
    v: '║',
    tl: '╔',
    tr: '╗',
    bl: '╚',
    br: '╝',
    t: '╦',
    b: '╩',
    l: '╠',
    r: '╣',
    x: '╬',
  },
  dashed: {
    h: '╌',
    v: '╎',
    tl: '┌',
    tr: '┐',
    bl: '└',
    br: '┘',
    t: '┬',
    b: '┴',
    l: '├',
    r: '┤',
    x: '┼',
  },
};

/** Arrow characters */
export const ARROW_CHARS = {
  right: '▶',
  left: '◀',
  up: '▲',
  down: '▼',
  // Alternative simpler arrows
  rightSimple: '>',
  leftSimple: '<',
  upSimple: '^',
  downSimple: 'v',
};

export type LineStyle = keyof typeof LINE_CHARS;

/**
 * Get the connection point on a bounds for a given side
 */
export function getConnectionPoint(bounds: Bounds, side: Side): Point {
  const centerX = bounds.x + Math.floor(bounds.width / 2);
  const centerY = bounds.y + Math.floor(bounds.height / 2);

  switch (side) {
    case 'top':
      return { x: centerX, y: bounds.y };
    case 'bottom':
      return { x: centerX, y: bounds.y + bounds.height - 1 };
    case 'left':
      return { x: bounds.x, y: centerY };
    case 'right':
      return { x: bounds.x + bounds.width - 1, y: centerY };
    case 'center':
    default:
      return { x: centerX, y: centerY };
  }
}

/**
 * Determine the best sides to connect two bounds
 */
export function determineBestSides(
  fromBounds: Bounds,
  toBounds: Bounds
): { fromSide: Side; toSide: Side } {
  const fromCenter = getConnectionPoint(fromBounds, 'center');
  const toCenter = getConnectionPoint(toBounds, 'center');

  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  // Determine primary direction
  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal primary
    if (dx > 0) {
      return { fromSide: 'right', toSide: 'left' };
    } else {
      return { fromSide: 'left', toSide: 'right' };
    }
  } else {
    // Vertical primary
    if (dy > 0) {
      return { fromSide: 'bottom', toSide: 'top' };
    } else {
      return { fromSide: 'top', toSide: 'bottom' };
    }
  }
}

/**
 * Check if a point is inside a bounds (with optional margin)
 */
function pointInBounds(point: Point, bounds: Bounds, margin: number = 0): boolean {
  return (
    point.x >= bounds.x - margin &&
    point.x < bounds.x + bounds.width + margin &&
    point.y >= bounds.y - margin &&
    point.y < bounds.y + bounds.height + margin
  );
}

/**
 * Check if a horizontal line segment intersects a bounds
 */
function horizontalSegmentIntersects(
  y: number,
  x1: number,
  x2: number,
  bounds: Bounds,
  margin: number = 0
): boolean {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const bLeft = bounds.x - margin;
  const bRight = bounds.x + bounds.width + margin;
  const bTop = bounds.y - margin;
  const bBottom = bounds.y + bounds.height + margin;

  // Check if Y is within bounds height and X range overlaps
  return y >= bTop && y < bBottom && maxX >= bLeft && minX < bRight;
}

/**
 * Check if a vertical line segment intersects a bounds
 */
function verticalSegmentIntersects(
  x: number,
  y1: number,
  y2: number,
  bounds: Bounds,
  margin: number = 0
): boolean {
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const bLeft = bounds.x - margin;
  const bRight = bounds.x + bounds.width + margin;
  const bTop = bounds.y - margin;
  const bBottom = bounds.y + bounds.height + margin;

  // Check if X is within bounds width and Y range overlaps
  return x >= bLeft && x < bRight && maxY >= bTop && minY < bBottom;
}

/**
 * Check if a path intersects any obstacles
 */
function pathIntersectsObstacles(
  points: Point[],
  obstacles: Bounds[],
  margin: number = 0
): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    for (const obs of obstacles) {
      if (p1.x === p2.x) {
        // Vertical segment
        if (verticalSegmentIntersects(p1.x, p1.y, p2.y, obs, margin)) {
          return true;
        }
      } else if (p1.y === p2.y) {
        // Horizontal segment
        if (horizontalSegmentIntersects(p1.y, p1.x, p2.x, obs, margin)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Get the combined bounding box of all obstacles
 */
function getCombinedBounds(obstacles: Bounds[]): Bounds | null {
  if (obstacles.length === 0) return null;

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const b of obstacles) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Filter obstacles to exclude source and target bounds
 */
function filterObstacles(
  obstacles: Bounds[],
  fromBounds?: Bounds,
  toBounds?: Bounds
): Bounds[] {
  return obstacles.filter(obs => {
    if (fromBounds && boundsEqual(obs, fromBounds)) return false;
    if (toBounds && boundsEqual(obs, toBounds)) return false;
    return true;
  });
}

/**
 * Check if two bounds are equal
 */
function boundsEqual(a: Bounds, b: Bounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Find obstacles that are between the source and target points
 */
function findObstaclesBetween(
  from: Point,
  to: Point,
  obstacles: Bounds[],
  margin: number
): Bounds[] {
  const minX = Math.min(from.x, to.x) - margin;
  const maxX = Math.max(from.x, to.x) + margin;
  const minY = Math.min(from.y, to.y) - margin;
  const maxY = Math.max(from.y, to.y) + margin;

  return obstacles.filter(obs => {
    const obsRight = obs.x + obs.width;
    const obsBottom = obs.y + obs.height;
    // Check if obstacle overlaps with the bounding box between from and to
    return !(obsRight < minX || obs.x > maxX || obsBottom < minY || obs.y > maxY);
  });
}

/**
 * Calculate an orthogonal (right-angle) route between two points
 * - First segment exits in the direction of fromSide
 * - Final segment approaches in the direction of toSide
 * - Avoids obstacles by routing around them
 */
export function calculateOrthogonalRoute(
  from: Point,
  to: Point,
  fromSide: Side,
  toSide: Side,
  options?: RoutingOptions
): Point[] {
  const allObstacles = options?.obstacles
    ? filterObstacles(options.obstacles, options.fromBounds, options.toBounds)
    : [];
  const margin = options?.margin ?? 1;

  // If no obstacles, just use simple routing
  if (allObstacles.length === 0) {
    return simplifyPath(calculateSimpleRoute(from, to, fromSide, toSide));
  }

  // Find obstacles that might be in the way
  const relevantObstacles = findObstaclesBetween(from, to, allObstacles, margin * 2);

  if (relevantObstacles.length === 0) {
    return simplifyPath(calculateSimpleRoute(from, to, fromSide, toSide));
  }

  // Try simple route first
  const simplePath = calculateSimpleRoute(from, to, fromSide, toSide);
  if (!pathIntersectsObstacles(simplePath, allObstacles, 0)) {
    return simplifyPath(simplePath);
  }

  // Get combined bounds of ALL obstacles (not just relevant ones)
  // This ensures routing goes completely outside even when wrapping around
  const combined = getCombinedBounds(allObstacles);
  if (!combined) {
    return simplifyPath(simplePath);
  }

  // Calculate outer edges with margin based on ALL obstacles
  const outerLeft = combined.x - margin - 2;
  const outerRight = combined.x + combined.width + margin + 2;
  const outerTop = combined.y - margin - 2;
  const outerBottom = combined.y + combined.height + margin + 2;

  // Try routing strategies - use composite routes that go via TWO outer edges
  // This ensures we clear obstacles both horizontally AND vertically
  // Try both horizontal-first and vertical-first variants for each corner
  const strategies: (() => Point[])[] = [];

  const goingRight = to.x > from.x;
  const goingDown = to.y > from.y;

  // Composite strategies: go to outer corner first, then to target
  // Try both horizontal-first and vertical-first for each corner
  // Choose based on direction to minimize path length
  if (goingDown) {
    if (goingRight) {
      // Going down-right: prefer right-bottom routes
      strategies.push(() => routeViaCornerHorizontalFirst(from, to, outerRight, outerBottom));
      strategies.push(() => routeViaCornerVerticalFirst(from, to, outerRight, outerBottom));
      strategies.push(() => routeViaCornerHorizontalFirst(from, to, outerLeft, outerBottom));
      strategies.push(() => routeViaCornerVerticalFirst(from, to, outerLeft, outerBottom));
    } else {
      // Going down-left: prefer left-bottom routes
      strategies.push(() => routeViaCornerHorizontalFirst(from, to, outerLeft, outerBottom));
      strategies.push(() => routeViaCornerVerticalFirst(from, to, outerLeft, outerBottom));
      strategies.push(() => routeViaCornerHorizontalFirst(from, to, outerRight, outerBottom));
      strategies.push(() => routeViaCornerVerticalFirst(from, to, outerRight, outerBottom));
    }
  } else {
    if (goingRight) {
      // Going up-right: prefer right-top routes
      strategies.push(() => routeViaCornerHorizontalFirst(from, to, outerRight, outerTop));
      strategies.push(() => routeViaCornerVerticalFirst(from, to, outerRight, outerTop));
      strategies.push(() => routeViaCornerHorizontalFirst(from, to, outerLeft, outerTop));
      strategies.push(() => routeViaCornerVerticalFirst(from, to, outerLeft, outerTop));
    } else {
      // Going up-left: prefer left-top routes
      strategies.push(() => routeViaCornerHorizontalFirst(from, to, outerLeft, outerTop));
      strategies.push(() => routeViaCornerVerticalFirst(from, to, outerLeft, outerTop));
      strategies.push(() => routeViaCornerHorizontalFirst(from, to, outerRight, outerTop));
      strategies.push(() => routeViaCornerVerticalFirst(from, to, outerRight, outerTop));
    }
  }

  // Also try simple single-edge routes (for cases where they work)
  strategies.push(() => routeViaLeft(from, to, fromSide, toSide, outerLeft, margin));
  strategies.push(() => routeViaRight(from, to, fromSide, toSide, outerRight, margin));
  strategies.push(() => routeViaTop(from, to, fromSide, toSide, outerTop, margin));
  strategies.push(() => routeViaBottom(from, to, fromSide, toSide, outerBottom, margin));

  // Try each strategy
  for (const strategy of strategies) {
    const path = strategy();
    if (!pathIntersectsObstacles(path, allObstacles, 0)) {
      return simplifyPath(path);
    }
  }

  // Absolute last resort - use simple path (will draw under elements)
  return simplifyPath(simplePath);
}

/**
 * Route via an outer corner - horizontal first variant
 * Goes horizontally to outer X first, then vertically to outer Y, then to target
 */
function routeViaCornerHorizontalFirst(
  from: Point,
  to: Point,
  cornerX: number,
  cornerY: number
): Point[] {
  return [
    from,
    { x: cornerX, y: from.y },  // Go horizontally to outer X
    { x: cornerX, y: cornerY }, // Go vertically to outer Y (along outer edge)
    { x: to.x, y: cornerY },    // Go horizontally to target X (along outer edge)
    to,                          // Go vertically to target
  ];
}

/**
 * Route via an outer corner - vertical first variant
 * Goes vertically to outer Y first, then horizontally to outer X, then to target
 */
function routeViaCornerVerticalFirst(
  from: Point,
  to: Point,
  cornerX: number,
  cornerY: number
): Point[] {
  return [
    from,
    { x: from.x, y: cornerY },  // Go vertically to outer Y
    { x: cornerX, y: cornerY }, // Go horizontally to outer X (along outer edge)
    { x: cornerX, y: to.y },    // Go vertically to target Y (along outer edge)
    to,                          // Go horizontally to target
  ];
}

/**
 * Route via the left side of obstacles
 */
function routeViaLeft(
  from: Point,
  to: Point,
  fromSide: Side,
  toSide: Side,
  leftX: number,
  margin: number
): Point[] {
  const points: Point[] = [from];
  const fromVertical = fromSide === 'top' || fromSide === 'bottom';
  const toVertical = toSide === 'top' || toSide === 'bottom';

  if (fromVertical) {
    // Exit vertically first, then go to left edge, then to target
    const exitY = fromSide === 'bottom' ? from.y + margin : from.y - margin;
    points.push({ x: from.x, y: exitY });
    points.push({ x: leftX, y: exitY });
    if (toVertical) {
      const entryY = toSide === 'top' ? to.y - margin : to.y + margin;
      points.push({ x: leftX, y: entryY });
      points.push({ x: to.x, y: entryY });
    } else {
      points.push({ x: leftX, y: to.y });
    }
  } else {
    // Exit horizontally, go to left edge
    points.push({ x: leftX, y: from.y });
    if (toVertical) {
      const entryY = toSide === 'top' ? to.y - margin : to.y + margin;
      points.push({ x: leftX, y: entryY });
      points.push({ x: to.x, y: entryY });
    } else {
      points.push({ x: leftX, y: to.y });
    }
  }

  points.push(to);
  return points;
}

/**
 * Route via the right side of obstacles
 */
function routeViaRight(
  from: Point,
  to: Point,
  fromSide: Side,
  toSide: Side,
  rightX: number,
  margin: number
): Point[] {
  const points: Point[] = [from];
  const fromVertical = fromSide === 'top' || fromSide === 'bottom';
  const toVertical = toSide === 'top' || toSide === 'bottom';

  if (fromVertical) {
    const exitY = fromSide === 'bottom' ? from.y + margin : from.y - margin;
    points.push({ x: from.x, y: exitY });
    points.push({ x: rightX, y: exitY });
    if (toVertical) {
      const entryY = toSide === 'top' ? to.y - margin : to.y + margin;
      points.push({ x: rightX, y: entryY });
      points.push({ x: to.x, y: entryY });
    } else {
      points.push({ x: rightX, y: to.y });
    }
  } else {
    points.push({ x: rightX, y: from.y });
    if (toVertical) {
      const entryY = toSide === 'top' ? to.y - margin : to.y + margin;
      points.push({ x: rightX, y: entryY });
      points.push({ x: to.x, y: entryY });
    } else {
      points.push({ x: rightX, y: to.y });
    }
  }

  points.push(to);
  return points;
}

/**
 * Route via the top of obstacles
 */
function routeViaTop(
  from: Point,
  to: Point,
  fromSide: Side,
  toSide: Side,
  topY: number,
  margin: number
): Point[] {
  const points: Point[] = [from];
  const fromVertical = fromSide === 'top' || fromSide === 'bottom';
  const toVertical = toSide === 'top' || toSide === 'bottom';

  if (fromVertical) {
    points.push({ x: from.x, y: topY });
    if (toVertical) {
      points.push({ x: to.x, y: topY });
    } else {
      const entryX = toSide === 'left' ? to.x - margin : to.x + margin;
      points.push({ x: entryX, y: topY });
      points.push({ x: entryX, y: to.y });
    }
  } else {
    const exitX = fromSide === 'right' ? from.x + margin : from.x - margin;
    points.push({ x: exitX, y: from.y });
    points.push({ x: exitX, y: topY });
    if (toVertical) {
      points.push({ x: to.x, y: topY });
    } else {
      const entryX = toSide === 'left' ? to.x - margin : to.x + margin;
      points.push({ x: entryX, y: topY });
      points.push({ x: entryX, y: to.y });
    }
  }

  points.push(to);
  return points;
}

/**
 * Route via the bottom of obstacles
 * Goes horizontally to target x first (to avoid obstacles), then down to bottomY, then to target
 */
function routeViaBottom(
  from: Point,
  to: Point,
  fromSide: Side,
  toSide: Side,
  bottomY: number,
  _margin: number
): Point[] {
  const points: Point[] = [from];
  const toVertical = toSide === 'top' || toSide === 'bottom';

  // Go down to bottomY at from.x, then horizontally to to.x, then up to target
  // This ensures we go OUTSIDE all obstacles before moving horizontally
  points.push({ x: from.x, y: bottomY });
  if (toVertical) {
    points.push({ x: to.x, y: bottomY });
  } else {
    points.push({ x: to.x, y: bottomY });
    points.push({ x: to.x, y: to.y });
  }

  points.push(to);
  return points;
}

/**
 * Threshold for "near alignment" - if the offset is within this many characters,
 * draw a straight line (ignoring exact source center alignment)
 */
const STRAIGHT_LINE_THRESHOLD = 3;

/**
 * Simple route without obstacle avoidance (midpoint Z-shape or L-shape)
 * When endpoints are nearly aligned (within STRAIGHT_LINE_THRESHOLD), draws a
 * straight line at the target's position - the source end doesn't need to match
 * the exact center for small offsets
 */
function calculateSimpleRoute(
  from: Point,
  to: Point,
  fromSide: Side,
  toSide: Side
): Point[] {
  const fromVertical = fromSide === 'top' || fromSide === 'bottom';
  const toVertical = toSide === 'top' || toSide === 'bottom';
  const perpendicular = fromVertical !== toVertical;

  if (perpendicular) {
    const points: Point[] = [from];
    if (fromVertical) {
      points.push({ x: from.x, y: to.y });
    } else {
      points.push({ x: to.x, y: from.y });
    }
    points.push(to);
    return points;
  } else {
    if (fromVertical) {
      const dx = Math.abs(to.x - from.x);
      // If nearly aligned horizontally, draw a straight vertical line at target's x
      // (source doesn't need to connect exactly at center for small offsets)
      if (dx <= STRAIGHT_LINE_THRESHOLD) {
        return [{ x: to.x, y: from.y }, to];
      } else {
        // Standard Z-shape with midpoint bend
        const midY = Math.round((from.y + to.y) / 2);
        return [from, { x: from.x, y: midY }, { x: to.x, y: midY }, to];
      }
    } else {
      const dy = Math.abs(to.y - from.y);
      // If nearly aligned vertically, draw a straight horizontal line at target's y
      // (source doesn't need to connect exactly at center for small offsets)
      if (dy <= STRAIGHT_LINE_THRESHOLD) {
        return [{ x: from.x, y: to.y }, to];
      } else {
        // Standard Z-shape with midpoint bend
        const midX = Math.round((from.x + to.x) / 2);
        return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
      }
    }
  }
}

/**
 * Simplify a path by removing redundant intermediate points
 */
function simplifyPath(points: Point[]): Point[] {
  if (points.length <= 2) return points;

  const result: Point[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];

    // Keep point if direction changes
    const sameX = prev.x === curr.x && curr.x === next.x;
    const sameY = prev.y === curr.y && curr.y === next.y;

    if (!sameX && !sameY) {
      result.push(curr);
    } else if (!sameX || !sameY) {
      result.push(curr);
    }
  }

  result.push(points[points.length - 1]);
  return result;
}

/**
 * Check if a cell can be drawn to (is empty, space, or box-drawing character)
 * Box-drawing characters can be overwritten/merged with other box-drawing chars
 */
const BOX_DRAWING_CHARS = new Set([
  '─', '━', '│', '┃', '┌', '┐', '└', '┘', '├', '┤', '┬', '┴', '┼',
  '┏', '┓', '┗', '┛', '┣', '┫', '┳', '┻', '╋',
  '╔', '╗', '╚', '╝', '╠', '╣', '╦', '╩', '╬',
  '═', '║', '╌', '╎', ' ', ''
]);

function canDrawAt(buffer: DualBuffer, x: number, y: number): boolean {
  const cell = buffer.currentBuffer.getCell(x, y);
  if (!cell || !cell.char) return true;
  return BOX_DRAWING_CHARS.has(cell.char);
}

/**
 * Safely set a cell, only if it won't overwrite text content
 */
function safeSetCell(
  buffer: DualBuffer,
  x: number,
  y: number,
  cell: { char: string } & Partial<Cell>
): void {
  if (canDrawAt(buffer, x, y)) {
    buffer.currentBuffer.setCell(x, y, cell);
  }
}

/**
 * Get the appropriate corner character for a direction change
 */
function getCornerChar(
  fromDir: 'h' | 'v',
  toDir: 'h' | 'v',
  fromDelta: number,
  toDelta: number,
  chars: typeof LINE_CHARS.thin
): string {
  if (fromDir === 'h' && toDir === 'v') {
    // Horizontal to vertical
    if (fromDelta > 0 && toDelta > 0) return chars.tr; // going right, then down -> ┐
    if (fromDelta > 0 && toDelta < 0) return chars.br; // going right, then up -> ┘
    if (fromDelta < 0 && toDelta > 0) return chars.tl; // going left, then down -> ┌
    if (fromDelta < 0 && toDelta < 0) return chars.bl; // going left, then up -> └
  } else if (fromDir === 'v' && toDir === 'h') {
    // Vertical to horizontal
    if (fromDelta > 0 && toDelta > 0) return chars.bl; // going down, then right -> └
    if (fromDelta > 0 && toDelta < 0) return chars.br; // going down, then left -> ┘
    if (fromDelta < 0 && toDelta > 0) return chars.tl; // going up, then right -> ┌
    if (fromDelta < 0 && toDelta < 0) return chars.tr; // going up, then left -> ┐
  }
  return chars.x; // fallback to cross
}

/**
 * Draw an orthogonal path on the buffer
 */
export function drawOrthogonalPath(
  buffer: DualBuffer,
  points: Point[],
  style: Partial<Cell>,
  lineStyle: LineStyle = 'thin',
  arrowStart: boolean = false,
  arrowEnd: boolean = false
): void {
  if (points.length < 2) return;

  const chars = LINE_CHARS[lineStyle];

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    if (dx !== 0) {
      // Horizontal segment
      const startX = Math.min(p1.x, p2.x);
      const endX = Math.max(p1.x, p2.x);

      for (let x = startX; x <= endX; x++) {
        let char = chars.h;

        // Check for corners at endpoints
        if (x === p1.x && i > 0) {
          // Start of segment, check previous direction
          const prev = points[i - 1];
          const prevDy = p1.y - prev.y;
          if (prevDy !== 0) {
            char = getCornerChar('v', 'h', prevDy, dx, chars);
          }
        } else if (x === p2.x && i < points.length - 2) {
          // End of segment, check next direction
          const next = points[i + 2];
          const nextDy = next.y - p2.y;
          if (nextDy !== 0) {
            char = getCornerChar('h', 'v', dx, nextDy, chars);
          }
        }

        // Arrow at start
        if (arrowStart && i === 0 && x === p1.x) {
          char = dx > 0 ? ARROW_CHARS.left : ARROW_CHARS.right;
        }

        // Arrow at end
        if (arrowEnd && i === points.length - 2 && x === p2.x) {
          char = dx > 0 ? ARROW_CHARS.right : ARROW_CHARS.left;
        }

        safeSetCell(buffer, x, p1.y, { char, ...style });
      }
    } else if (dy !== 0) {
      // Vertical segment
      const startY = Math.min(p1.y, p2.y);
      const endY = Math.max(p1.y, p2.y);

      for (let y = startY; y <= endY; y++) {
        let char = chars.v;

        // Check for corners at endpoints
        if (y === p1.y && i > 0) {
          // Start of segment, check previous direction
          const prev = points[i - 1];
          const prevDx = p1.x - prev.x;
          if (prevDx !== 0) {
            char = getCornerChar('h', 'v', prevDx, dy, chars);
          }
        } else if (y === p2.y && i < points.length - 2) {
          // End of segment, check next direction
          const next = points[i + 2];
          const nextDx = next.x - p2.x;
          if (nextDx !== 0) {
            char = getCornerChar('v', 'h', dy, nextDx, chars);
          }
        }

        // Arrow at start
        if (arrowStart && i === 0 && y === p1.y) {
          char = dy > 0 ? ARROW_CHARS.up : ARROW_CHARS.down;
        }

        // Arrow at end
        if (arrowEnd && i === points.length - 2 && y === p2.y) {
          char = dy > 0 ? ARROW_CHARS.down : ARROW_CHARS.up;
        }

        safeSetCell(buffer, p1.x, y, { char, ...style });
      }
    }
  }
}

/**
 * Draw a simple direct line (only works for horizontal or vertical)
 */
export function drawDirectLine(
  buffer: DualBuffer,
  from: Point,
  to: Point,
  style: Partial<Cell>,
  lineStyle: LineStyle = 'thin',
  arrowStart: boolean = false,
  arrowEnd: boolean = false
): void {
  const chars = LINE_CHARS[lineStyle];
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx !== 0 && dy !== 0) {
    // Diagonal - fall back to orthogonal routing
    const points = [from, { x: to.x, y: from.y }, to];
    drawOrthogonalPath(buffer, points, style, lineStyle, arrowStart, arrowEnd);
    return;
  }

  if (dx !== 0) {
    // Horizontal line
    const startX = Math.min(from.x, to.x);
    const endX = Math.max(from.x, to.x);
    const dir = dx > 0 ? 1 : -1;

    for (let x = startX; x <= endX; x++) {
      let char = chars.h;

      if (arrowStart && x === from.x) {
        char = dir > 0 ? ARROW_CHARS.left : ARROW_CHARS.right;
      } else if (arrowEnd && x === to.x) {
        char = dir > 0 ? ARROW_CHARS.right : ARROW_CHARS.left;
      }

      safeSetCell(buffer, x, from.y, { char, ...style });
    }
  } else if (dy !== 0) {
    // Vertical line
    const startY = Math.min(from.y, to.y);
    const endY = Math.max(from.y, to.y);
    const dir = dy > 0 ? 1 : -1;

    for (let y = startY; y <= endY; y++) {
      let char = chars.v;

      if (arrowStart && y === from.y) {
        char = dir > 0 ? ARROW_CHARS.up : ARROW_CHARS.down;
      } else if (arrowEnd && y === to.y) {
        char = dir > 0 ? ARROW_CHARS.down : ARROW_CHARS.up;
      }

      safeSetCell(buffer, from.x, y, { char, ...style });
    }
  }
}
