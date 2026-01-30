/**
 * Connector Component
 *
 * Draws a line between two elements identified by their IDs.
 * Uses box-drawing characters for orthogonal routing.
 *
 * Usage:
 *   <connector from="element-a" to="element-b" arrow="end" />
 */

import {
  Element,
  type Style,
  type Bounds,
  type Renderable,
  type ComponentRenderContext,
  type IntrinsicSizeContext,
  type BorderStyle,
} from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { parseColor } from './color-utils.ts';
import { getLogger } from '../logging.ts';

const logger = getLogger('Connector');
import {
  type Side,
  type LineStyle,
  type RoutingOptions,
  getConnectionPoint,
  determineBestSides,
  calculateOrthogonalRoute,
  drawOrthogonalPath,
  drawDirectLine,
} from './connector-utils.ts';

export interface ConnectorProps {
  /** ID of the source element */
  from: string;
  /** ID of the target element */
  to: string;
  /** Which side of the source element to connect from */
  fromSide?: Side;
  /** Which side of the target element to connect to */
  toSide?: Side;
  /** Arrow style: none, end (default), start, or both */
  arrow?: 'none' | 'end' | 'start' | 'both';
  /** Optional label text (displayed at midpoint) */
  label?: string;
  /**
   * Routing style:
   * - 'orthogonal' (default): right-angle routing with obstacle avoidance
   * - 'direct': straight line (may be diagonal)
   * - 'horizontal': straight horizontal line (for sequence diagrams)
   * - 'vertical': straight vertical line
   */
  routing?: 'direct' | 'orthogonal' | 'horizontal' | 'vertical';
  /** Style properties */
  style?: Style & {
    /** Line style: thin, thick, double, dashed */
    lineStyle?: LineStyle;
  };
}

export class ConnectorElement extends Element implements Renderable {
  static readonly type = 'connector';
  declare type: 'connector';
  declare props: ConnectorProps;

  constructor(props: ConnectorProps, _children: Element[] = []) {
    super('connector', props);
  }

  /**
   * Connectors have zero intrinsic size - they draw based on connected element positions
   * Using 0x0 prevents the connector's bounds from overlapping with other content
   */
  intrinsicSize(_context: IntrinsicSizeContext): { width: number; height: number } {
    return { width: 0, height: 0 };
  }

  /**
   * Render the connector line between source and target elements
   */
  render(
    _bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    context: ComponentRenderContext
  ): void {
    const { from, to, fromSide, toSide, arrow = 'end', routing = 'orthogonal' } = this.props;

    // Need getElementBounds to find the elements
    if (!context.getElementBounds) {
      return;
    }

    // Look up element bounds
    const fromBounds = context.getElementBounds(from);
    const toBounds = context.getElementBounds(to);

    logger.debug(`Connector render: from=${from}, to=${to}, fromBounds=${JSON.stringify(fromBounds)}, toBounds=${JSON.stringify(toBounds)}`);

    if (!fromBounds || !toBounds) {
      // Elements not found - silently skip
      logger.debug(`Connector: skipping - bounds not found`);
      return;
    }

    // Gather obstacles for routing (all element bounds except source and target)
    const obstacles: Bounds[] = [];
    if (context.getAllElementBounds) {
      const allBounds = context.getAllElementBounds();
      for (const [id, bounds] of allBounds) {
        // Skip source, target, and connector elements
        if (id === from || id === to || id.startsWith('connector-')) {
          continue;
        }
        obstacles.push(bounds);
      }
    }

    // Routing options for obstacle avoidance
    const routingOptions: RoutingOptions = {
      obstacles,
      margin: 1,
      fromBounds,
      toBounds,
    };

    // Get style properties
    const propStyle = this.props.style || {};
    const lineStyle = (propStyle.lineStyle || 'thin') as LineStyle;
    const color = propStyle.color ? parseColor(propStyle.color) : style.foreground;

    const cellStyle: Partial<Cell> = { ...style };
    if (color !== undefined) {
      cellStyle.foreground = color;
    }

    // Determine arrow settings
    const arrowStart = arrow === 'start' || arrow === 'both';
    const arrowEnd = arrow === 'end' || arrow === 'both';

    // Draw the line and get endpoints for label
    let labelFrom: { x: number; y: number };
    let labelTo: { x: number; y: number };

    if (routing === 'horizontal') {
      // Horizontal routing: straight horizontal line for sequence diagrams
      // Use the y-coordinate from fromBounds center, connect left/right edges
      const fromCenterY = fromBounds.y + Math.floor(fromBounds.height / 2);
      const toCenterY = toBounds.y + Math.floor(toBounds.height / 2);
      const y = Math.floor((fromCenterY + toCenterY) / 2); // Use average y

      // Determine direction and connection points
      const goingRight = toBounds.x > fromBounds.x;
      if (goingRight) {
        labelFrom = { x: fromBounds.x + fromBounds.width, y };
        labelTo = { x: toBounds.x - 1, y };
      } else {
        labelFrom = { x: fromBounds.x - 1, y };
        labelTo = { x: toBounds.x + toBounds.width, y };
      }
      drawDirectLine(buffer, labelFrom, labelTo, cellStyle, lineStyle, arrowStart, arrowEnd);
    } else if (routing === 'vertical') {
      // Vertical routing: straight vertical line
      const fromCenterX = fromBounds.x + Math.floor(fromBounds.width / 2);
      const toCenterX = toBounds.x + Math.floor(toBounds.width / 2);
      const x = Math.floor((fromCenterX + toCenterX) / 2); // Use average x

      // Determine direction and connection points
      const goingDown = toBounds.y > fromBounds.y;
      if (goingDown) {
        labelFrom = { x, y: fromBounds.y + fromBounds.height };
        labelTo = { x, y: toBounds.y - 1 };
      } else {
        labelFrom = { x, y: fromBounds.y - 1 };
        labelTo = { x, y: toBounds.y + toBounds.height };
      }
      drawDirectLine(buffer, labelFrom, labelTo, cellStyle, lineStyle, arrowStart, arrowEnd);
    } else if (routing === 'direct') {
      const sides = determineBestSides(fromBounds, toBounds);
      const actualFromSide = fromSide === 'auto' || !fromSide ? sides.fromSide : fromSide;
      const actualToSide = toSide === 'auto' || !toSide ? sides.toSide : toSide;
      const fromPt = getConnectionPoint(fromBounds, actualFromSide);
      const toPt = getConnectionPoint(toBounds, actualToSide);
      labelFrom = this._offsetPoint(fromPt, actualFromSide, 1);
      labelTo = this._offsetPoint(toPt, actualToSide, 1);
      drawDirectLine(buffer, labelFrom, labelTo, cellStyle, lineStyle, arrowStart, arrowEnd);
    } else {
      // Default: orthogonal routing with obstacle avoidance
      // Try multiple side combinations and pick the one with the clearest path
      const bestRoute = this._findBestRoute(
        fromBounds, toBounds, fromSide, toSide, routingOptions
      );
      drawOrthogonalPath(buffer, bestRoute.points, cellStyle, lineStyle, arrowStart, arrowEnd);
      // Use first and last points for label positioning
      labelFrom = bestRoute.points[0];
      labelTo = bestRoute.points[bestRoute.points.length - 1];
    }

    // Draw label if provided
    // Include fromBounds and toBounds in label obstacles (they're excluded from routing obstacles)
    if (this.props.label) {
      const labelObstacles = [...obstacles, fromBounds, toBounds];
      this._drawLabel(buffer, labelFrom, labelTo, this.props.label, cellStyle, labelObstacles, fromBounds, toBounds);
    }
  }

  /**
   * Offset a point away from its side
   */
  private _offsetPoint(point: { x: number; y: number }, side: Side, amount: number): { x: number; y: number } {
    switch (side) {
      case 'top':
        return { x: point.x, y: point.y - amount };
      case 'bottom':
        return { x: point.x, y: point.y + amount };
      case 'left':
        return { x: point.x - amount, y: point.y };
      case 'right':
        return { x: point.x + amount, y: point.y };
      default:
        return point;
    }
  }

  /**
   * Find the best route by trying multiple side combinations
   * Returns the route with the fewest obstacle intersections (ideally zero)
   */
  private _findBestRoute(
    fromBounds: Bounds,
    toBounds: Bounds,
    propFromSide: Side | undefined,
    propToSide: Side | undefined,
    routingOptions: RoutingOptions
  ): { points: { x: number; y: number }[]; fromSide: Side; toSide: Side } {
    // If sides are explicitly specified, use them
    if (propFromSide && propFromSide !== 'auto' && propToSide && propToSide !== 'auto') {
      const fromPoint = getConnectionPoint(fromBounds, propFromSide);
      const toPoint = getConnectionPoint(toBounds, propToSide);
      const offsetFromPoint = this._offsetPoint(fromPoint, propFromSide, 1);
      const offsetToPoint = this._offsetPoint(toPoint, propToSide, 1);
      const points = calculateOrthogonalRoute(
        offsetFromPoint, offsetToPoint, propFromSide, propToSide, routingOptions
      );
      return { points, fromSide: propFromSide, toSide: propToSide };
    }

    // Side combinations to try, ordered by preference
    // Start with the "natural" sides based on direction
    const sides = determineBestSides(fromBounds, toBounds);
    const sideCombinations: Array<{ fromSide: Side; toSide: Side }> = [
      sides, // Natural direction first
      // Vertical primary (useful for wrapped layouts)
      { fromSide: 'bottom', toSide: 'top' },
      { fromSide: 'top', toSide: 'bottom' },
      // Horizontal primary
      { fromSide: 'right', toSide: 'left' },
      { fromSide: 'left', toSide: 'right' },
      // Mixed combinations for complex layouts
      { fromSide: 'bottom', toSide: 'left' },
      { fromSide: 'bottom', toSide: 'right' },
      { fromSide: 'top', toSide: 'left' },
      { fromSide: 'top', toSide: 'right' },
      { fromSide: 'right', toSide: 'top' },
      { fromSide: 'right', toSide: 'bottom' },
      { fromSide: 'left', toSide: 'top' },
      { fromSide: 'left', toSide: 'bottom' },
    ];

    let bestRoute: { points: { x: number; y: number }[]; fromSide: Side; toSide: Side } | null = null;
    let bestScore = Infinity;

    for (const combo of sideCombinations) {
      const actualFromSide = propFromSide === 'auto' || !propFromSide ? combo.fromSide : propFromSide;
      const actualToSide = propToSide === 'auto' || !propToSide ? combo.toSide : propToSide;

      const fromPoint = getConnectionPoint(fromBounds, actualFromSide);
      const toPoint = getConnectionPoint(toBounds, actualToSide);
      const offsetFromPoint = this._offsetPoint(fromPoint, actualFromSide, 1);
      const offsetToPoint = this._offsetPoint(toPoint, actualToSide, 1);

      const points = calculateOrthogonalRoute(
        offsetFromPoint, offsetToPoint, actualFromSide, actualToSide, routingOptions
      );

      // Score the route: count obstacle intersections and path length
      const intersections = this._countIntersections(points, routingOptions.obstacles || []);
      const pathLength = this._calculatePathLength(points);

      // Score: prioritize zero intersections, then shorter paths
      const score = intersections * 10000 + pathLength;

      if (score < bestScore) {
        bestScore = score;
        bestRoute = { points, fromSide: actualFromSide, toSide: actualToSide };

        // If we found a path with no intersections, use it
        if (intersections === 0) {
          break;
        }
      }
    }

    return bestRoute!;
  }

  /**
   * Count how many obstacle intersections a path has
   */
  private _countIntersections(points: { x: number; y: number }[], obstacles: Bounds[]): number {
    let count = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      for (const obs of obstacles) {
        if (this._segmentIntersectsBounds(p1, p2, obs)) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Check if a line segment intersects a bounds
   */
  private _segmentIntersectsBounds(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    bounds: Bounds
  ): boolean {
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);

    // Check if the segment's bounding box overlaps with the obstacle
    if (maxX < bounds.x || minX >= bounds.x + bounds.width) return false;
    if (maxY < bounds.y || minY >= bounds.y + bounds.height) return false;

    // For orthogonal segments, check more precisely
    if (p1.x === p2.x) {
      // Vertical segment
      return p1.x >= bounds.x && p1.x < bounds.x + bounds.width &&
             maxY >= bounds.y && minY < bounds.y + bounds.height;
    } else if (p1.y === p2.y) {
      // Horizontal segment
      return p1.y >= bounds.y && p1.y < bounds.y + bounds.height &&
             maxX >= bounds.x && minX < bounds.x + bounds.width;
    }

    return true; // Diagonal (shouldn't happen in orthogonal routing)
  }

  /**
   * Calculate total path length
   */
  private _calculatePathLength(points: { x: number; y: number }[]): number {
    let length = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const dx = Math.abs(points[i + 1].x - points[i].x);
      const dy = Math.abs(points[i + 1].y - points[i].y);
      length += dx + dy;
    }
    return length;
  }

  /**
   * Draw a label at the midpoint of the line
   * Positions label above/below line when horizontal space is insufficient
   * Uses obstacle avoidance to find clear position
   */
  private _drawLabel(
    buffer: DualBuffer,
    from: { x: number; y: number },
    to: { x: number; y: number },
    label: string,
    style: Partial<Cell>,
    obstacles: Bounds[] = [],
    fromBounds?: Bounds,
    toBounds?: Bounds
  ): void {
    // Calculate midpoint
    const midX = Math.floor((from.x + to.x) / 2);
    const midY = Math.floor((from.y + to.y) / 2);

    // Calculate line dimensions
    const horizontalLength = Math.abs(to.x - from.x);
    const verticalLength = Math.abs(to.y - from.y);

    // Minimum horizontal space needed to fit label inline (label + padding + some line visible)
    const minInlineSpace = label.length + 4; // label + 2 padding + 2 for line visibility

    // Determine if we should position label above/below the line
    const isHorizontalLine = horizontalLength > verticalLength;
    const hasEnoughHorizontalSpace = horizontalLength >= minInlineSpace;

    // For inline labels on horizontal lines, calculate available width and truncate if needed
    let displayLabel = label;
    if (isHorizontalLine && hasEnoughHorizontalSpace) {
      const reservedSpace = 4; // Reserve 2 chars on each side for visible line
      const labelPadding = 2;  // 1 space on each side of label text
      const availableWidth = Math.max(0, horizontalLength - reservedSpace - labelPadding);
      if (label.length > availableWidth) {
        displayLabel = label.substring(0, availableWidth);
      }
    }

    // Add spaces around the label (only for inline horizontal labels)
    const paddedLabel = (isHorizontalLine && hasEnoughHorizontalSpace)
      ? ' ' + displayLabel + ' '
      : displayLabel;

    const labelWidth = paddedLabel.length;

    // Calculate candidate positions for label placement
    let labelX = midX;
    let labelY = midY;

    if (isHorizontalLine && !hasEnoughHorizontalSpace) {
      // Not enough horizontal space - position label below the connector line
      // Note: "above" positions often fall in container padding and get overwritten,
      // so we prefer below positions which are in the content area
      const startX = midX - Math.floor(labelWidth / 2);

      // Calculate positions outside the connected elements
      const maxY = Math.max(
        fromBounds ? fromBounds.y + fromBounds.height : midY,
        toBounds ? toBounds.y + toBounds.height : midY
      );

      // Try below the bottommost element first (more likely to be in visible content area)
      const belowY = maxY;
      const labelBoundsBelow: Bounds = { x: startX, y: belowY, width: labelWidth, height: 1 };
      const belowClear = !this._boundsIntersectsAny(labelBoundsBelow, obstacles);

      if (belowClear) {
        labelY = belowY;
      } else {
        // Below blocked - try further below
        const labelBoundsBelow2: Bounds = { x: startX, y: belowY + 1, width: labelWidth, height: 1 };
        if (!this._boundsIntersectsAny(labelBoundsBelow2, obstacles)) {
          labelY = belowY + 1;
        } else {
          // Fall back to just below elements
          labelY = belowY;
        }
      }
    } else if (!isHorizontalLine) {
      // Vertical or diagonal line - try right, then left of the midpoint
      const labelBoundsRight: Bounds = { x: midX + 1, y: midY, width: labelWidth, height: 1 };
      const labelBoundsLeft: Bounds = { x: midX - labelWidth, y: midY, width: labelWidth, height: 1 };

      const rightClear = !this._boundsIntersectsAny(labelBoundsRight, obstacles);
      const leftClear = !this._boundsIntersectsAny(labelBoundsLeft, obstacles);

      if (rightClear) {
        labelX = midX + 1;
      } else if (leftClear) {
        labelX = midX - labelWidth;
      } else {
        // Both blocked - default to right
        labelX = midX + 1;
      }
    }

    // Calculate final start position
    const startX = (isHorizontalLine || hasEnoughHorizontalSpace)
      ? labelX - Math.floor(labelWidth / 2)
      : labelX;

    // Draw label characters
    for (let i = 0; i < paddedLabel.length; i++) {
      buffer.currentBuffer.setCell(startX + i, labelY, {
        char: paddedLabel[i],
        ...style,
      });
    }
  }

  /**
   * Check if bounds intersects with any obstacle
   * Skips large containers (likely parent containers that encompass everything)
   */
  private _boundsIntersectsAny(bounds: Bounds, obstacles: Bounds[]): boolean {
    for (const obs of obstacles) {
      // Skip very large obstacles (likely outer containers)
      // A "large" obstacle is one that's much bigger than typical UI elements
      if (obs.width > 50 || obs.height > 20) {
        continue;
      }
      if (this._boundsIntersects(bounds, obs)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if two bounds intersect
   */
  private _boundsIntersects(a: Bounds, b: Bounds): boolean {
    return !(
      a.x + a.width <= b.x ||
      b.x + b.width <= a.x ||
      a.y + a.height <= b.y ||
      b.y + b.height <= a.y
    );
  }

  /**
   * Connectors don't have children
   */
  appendChild(): void {
    throw new Error('Connector elements cannot have children');
  }

  /**
   * Validate connector props
   */
  static validate(props: ConnectorProps): boolean {
    if (!props.from || typeof props.from !== 'string') {
      return false;
    }
    if (!props.to || typeof props.to !== 'string') {
      return false;
    }
    if (props.arrow && !['none', 'end', 'start', 'both'].includes(props.arrow)) {
      return false;
    }
    if (props.routing && !['direct', 'orthogonal', 'horizontal', 'vertical'].includes(props.routing)) {
      return false;
    }
    return true;
  }
}
