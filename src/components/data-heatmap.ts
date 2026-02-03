// Data-driven heatmap component for terminal UIs
// Renders 2D value grids as colored cells with optional values display

import {
  Element,
  BaseProps,
  Renderable,
  Focusable,
  Clickable,
  Interactive,
  TextSelectable,
  SelectableTextProvider,
  SelectionBounds,
  IntrinsicSizeContext,
  Bounds,
  ComponentRenderContext,
  ClickEvent,
  Style,
} from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';
import { getLogger } from '../logging.ts';
import { getCurrentTheme } from '../theme.ts';
import { packRGBA, unpackRGBA, parseColor } from './color-utils.ts';
import type { PackedRGBA } from '../types.ts';

const logger = getLogger('DataHeatmap');

// ===== Type Definitions =====

export type HeatmapValue = number | null | undefined;
export type HeatmapGrid = HeatmapValue[][];

export type ColorScaleName = 'viridis' | 'plasma' | 'inferno' | 'thermal' |
                             'grayscale' | 'diverging' | 'greens' | 'reds';

export type IsolineMode = 'equal' | 'quantile' | 'nice';

export interface Isoline {
  value: number;           // Value at which to draw the contour
  color?: string;          // Line color (default: theme foreground)
  label?: string;          // Optional label (e.g., "100")
}

export interface HeatmapHoverEvent {
  type: 'hover';
  row: number;
  col: number;
  value: HeatmapValue;
  rowLabel?: string;
  colLabel?: string;
}

export interface HeatmapSelectEvent {
  type: 'select';
  row: number;
  col: number;
  value: HeatmapValue;
  rowLabel?: string;
  colLabel?: string;
}

export interface DataHeatmapProps extends BaseProps {
  grid?: HeatmapGrid;
  rows?: number;  // Initial row count (used when grid is empty)
  cols?: number;  // Initial column count (used when grid is empty)
  rowLabels?: string[];
  colLabels?: string[];

  min?: number;
  max?: number;

  colorScale?: ColorScaleName;

  // Isolines
  isolines?: Isoline[];           // Manual isoline definitions
  isolineCount?: number;          // Auto-generate N isolines (overrides isolines if set)
  isolineMode?: IsolineMode;      // Algorithm: 'equal' (default), 'quantile', 'nice'
  showIsolineLabels?: boolean;

  showCells?: boolean;    // Show cell backgrounds (default: true). Set to false for isolines-only display
  showValues?: boolean;
  valueFormat?: string;  // 'd', '.1f', '.2f', '.0%', etc.
  minCellWidth?: number;  // Minimum cell width in characters
  showLegend?: boolean;
  showAxis?: boolean;

  selectable?: boolean;
  onHover?: (event: HeatmapHoverEvent) => void;
  onSelect?: (event: HeatmapSelectEvent) => void;
}

// ===== Color Scales =====
// Each scale is an array of [position, r, g, b] where position is 0-1

type ColorStop = [number, number, number, number];  // [position, r, g, b]

const COLOR_SCALES: Record<ColorScaleName, ColorStop[]> = {
  // Viridis: dark purple → teal → yellow (colorblind-safe)
  viridis: [
    [0.0, 68, 1, 84],
    [0.25, 59, 82, 139],
    [0.5, 33, 145, 140],
    [0.75, 94, 201, 98],
    [1.0, 253, 231, 37],
  ],
  // Plasma: dark purple → pink → yellow
  plasma: [
    [0.0, 13, 8, 135],
    [0.25, 126, 3, 168],
    [0.5, 204, 71, 120],
    [0.75, 248, 149, 64],
    [1.0, 240, 249, 33],
  ],
  // Inferno: black → red → yellow
  inferno: [
    [0.0, 0, 0, 4],
    [0.25, 87, 16, 110],
    [0.5, 188, 55, 84],
    [0.75, 249, 142, 9],
    [1.0, 252, 255, 164],
  ],
  // Thermal: blue → cyan → yellow → red (temperature)
  thermal: [
    [0.0, 0, 0, 139],      // dark blue
    [0.25, 0, 139, 139],   // dark cyan
    [0.5, 255, 255, 0],    // yellow
    [0.75, 255, 140, 0],   // orange
    [1.0, 178, 34, 34],    // firebrick red
  ],
  // Grayscale: black → white
  grayscale: [
    [0.0, 0, 0, 0],
    [1.0, 255, 255, 255],
  ],
  // Diverging: blue → white → red (centered data)
  diverging: [
    [0.0, 33, 102, 172],   // blue
    [0.5, 247, 247, 247],  // white
    [1.0, 178, 24, 43],    // red
  ],
  // Greens: white → green
  greens: [
    [0.0, 247, 252, 245],
    [0.5, 116, 196, 118],
    [1.0, 0, 68, 27],
  ],
  // Reds: white → red
  reds: [
    [0.0, 255, 245, 240],
    [0.5, 252, 138, 106],
    [1.0, 103, 0, 13],
  ],
};

// BW mode patterns for value bins (4 levels)
const BW_PATTERNS = [' ', '░', '▒', '▓', '█'];

// Legend dimensions
const LEGEND_HEIGHT = 2;  // Color bar (1) + labels (1)
const LEGEND_WIDTH = 20;  // Width of the color gradient bar

// ===== Marching Squares for Isolines =====
// Each case represents which corners are above the threshold (4-bit binary)
// Corners: topLeft(8), topRight(4), bottomRight(2), bottomLeft(1)
// Characters map edge crossings to box-drawing chars

// Marching squares case to box-drawing character
// Corners: topLeft(8), topRight(4), bottomRight(2), bottomLeft(1)
// The isoline crosses edges where adjacent corners have different threshold states
// Box-drawing: ╭(↓→) ╮(↓←) ╰(↑→) ╯(↑←) ─(←→) │(↑↓)
const MARCHING_SQUARES_CHARS: Record<number, string | null> = {
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

// ===== Default Props =====

const defaultProps: Partial<DataHeatmapProps> = {
  colorScale: 'viridis',
  showCells: true,
  showValues: false,
  showLegend: false,
  showAxis: true,
  selectable: false,
};

// ===== DataHeatmapElement Class =====

export class DataHeatmapElement extends Element implements Renderable, Focusable, Clickable, Interactive, TextSelectable, SelectableTextProvider {
  declare type: 'data-heatmap';
  declare props: DataHeatmapProps;

  private _cellBounds: Map<string, Bounds> = new Map();  // "row-col" -> bounds
  private _elementBounds: Bounds | null = null;
  private _minValue: number = 0;
  private _maxValue: number = 1;
  private _selectedCell: { row: number; col: number } | null = null;

  constructor(props: DataHeatmapProps = { grid: [] }, children: Element[] = []) {
    super('data-heatmap', { ...defaultProps, ...props }, children);
    this._parseProps();
    this._parseInlineData();
  }

  // Parse JSON strings from props (when passed as attributes in .melker files)
  private _parseProps(): void {
    const jsonProps = ['grid', 'rowLabels', 'colLabels', 'isolines'] as const;
    for (const key of jsonProps) {
      if (typeof this.props[key] === 'string') {
        try {
          // deno-lint-ignore no-explicit-any
          (this.props as any)[key] = JSON.parse(this.props[key] as unknown as string);
        } catch (e) {
          logger.error(`Failed to parse ${key} JSON`, e instanceof Error ? e : new Error(String(e)));
        }
      }
    }
  }

  private _parseInlineData(): void {
    if (!this.children || this.children.length === 0) return;

    for (const child of this.children) {
      if (child.type === 'text') {
        const text = (child.props.text || '').trim();
        if (text.startsWith('{')) {
          try {
            const data = JSON.parse(text);
            if (data.grid && Array.isArray(data.grid)) {
              this.props.grid = data.grid;
            }
            if (data.rowLabels && Array.isArray(data.rowLabels)) {
              this.props.rowLabels = data.rowLabels;
            }
            if (data.colLabels && Array.isArray(data.colLabels)) {
              this.props.colLabels = data.colLabels;
            }
            if (data.isolines && Array.isArray(data.isolines)) {
              this.props.isolines = data.isolines;
            }
            this.children = [];
            return;
          } catch (e) {
            logger.error('Failed to parse inline JSON data', e instanceof Error ? e : new Error(String(e)));
          }
        }
      }
    }
  }

  // Generic style prop accessor
  private _getStyleProp<K extends keyof Style>(key: K, defaultValue: NonNullable<Style[K]>): NonNullable<Style[K]> {
    return ((this.props.style as Style | undefined)?.[key] ?? defaultValue) as NonNullable<Style[K]>;
  }

  // Style prop accessors with defaults
  private _getCellWidth(): number {
    const styleWidth = this._getStyleProp('cellWidth', 0);
    if (styleWidth > 0) return styleWidth;
    // Auto-size based on showValues
    const minWidth = this.props.minCellWidth ?? 0;
    if (this.props.showValues) {
      return Math.max(minWidth, this._getValueWidth());
    }
    return Math.max(minWidth, 2);  // Default: 2 chars wide
  }

  private _getCellHeight(): number {
    return this._getStyleProp('cellHeight', 1);
  }

  private _getGap(): number {
    return this._getStyleProp('gap', 0);
  }

  // Get horizontal gap between columns (1 when isolines present for proper rendering)
  private _getColGap(): number {
    const styleGap = this._getGap();
    // When isolines are present, we need at least 1-char gap between columns
    // for the isoline characters to render at cell boundaries
    if (this._hasIsolines()) {
      return Math.max(1, styleGap);
    }
    return styleGap;
  }

  // Calculate min width needed for values
  private _getValueWidth(): number {
    if (!this.props.showValues) return 2;

    this._calculateScale();
    const format = this.props.valueFormat ?? this._detectValueFormat();

    // Estimate max value width
    if (format === '.0%' || format === 'd') {
      return Math.max(3, String(Math.round(this._maxValue)).length + 1);
    } else if (format === '.1f') {
      return Math.max(4, String(Math.round(this._maxValue)).length + 2);
    } else if (format === '.2f') {
      return Math.max(5, String(Math.round(this._maxValue)).length + 3);
    }
    return 4;
  }

  private _detectValueFormat(): string {
    const { grid } = this.props;
    if (!grid || grid.length === 0) return 'd';

    // Check if all values are integers
    let allIntegers = true;
    for (const row of grid) {
      if (!row) continue;
      for (const val of row) {
        if (val !== null && val !== undefined && !Number.isInteger(val)) {
          allIntegers = false;
          break;
        }
      }
      if (!allIntegers) break;
    }

    return allIntegers ? 'd' : '.1f';
  }

  // ===== Scale Calculations =====

  private _calculateScale(): void {
    const { grid, min, max } = this.props;

    if (!grid || !Array.isArray(grid) || grid.length === 0) {
      this._minValue = 0;
      this._maxValue = 1;
      return;
    }

    let dataMin = Infinity;
    let dataMax = -Infinity;

    for (const row of grid) {
      if (!row) continue;
      for (const val of row) {
        if (val !== null && val !== undefined && typeof val === 'number') {
          dataMin = Math.min(dataMin, val);
          dataMax = Math.max(dataMax, val);
        }
      }
    }

    if (dataMin === Infinity) {
      dataMin = 0;
      dataMax = 1;
    }

    this._minValue = min ?? dataMin;
    this._maxValue = max ?? dataMax;

    // Ensure we have a valid range
    if (this._maxValue <= this._minValue) {
      this._maxValue = this._minValue + 1;
    }
  }

  // Normalize value to 0-1 range
  private _normalizeValue(value: number): number {
    const range = this._maxValue - this._minValue;
    if (range === 0) return 0.5;
    return Math.max(0, Math.min(1, (value - this._minValue) / range));
  }

  // ===== Color Mapping =====

  private _getColorForValue(value: HeatmapValue): PackedRGBA | undefined {
    if (value === null || value === undefined) {
      return undefined;  // No color for missing data
    }

    const theme = getCurrentTheme();

    // BW mode: use patterns instead of colors
    if (theme.type === 'bw') {
      return undefined;  // Will use pattern chars instead
    }

    const normalized = this._normalizeValue(value);
    const scaleName = this.props.colorScale ?? 'viridis';
    const scale = COLOR_SCALES[scaleName];

    if (!scale || scale.length === 0) {
      return packRGBA(128, 128, 128, 255);  // Fallback gray
    }

    // Find the two stops to interpolate between
    let lower = scale[0];
    let upper = scale[scale.length - 1];

    for (let i = 0; i < scale.length - 1; i++) {
      if (normalized >= scale[i][0] && normalized <= scale[i + 1][0]) {
        lower = scale[i];
        upper = scale[i + 1];
        break;
      }
    }

    // Interpolate between the two stops
    const range = upper[0] - lower[0];
    const t = range === 0 ? 0 : (normalized - lower[0]) / range;

    const r = Math.round(lower[1] + (upper[1] - lower[1]) * t);
    const g = Math.round(lower[2] + (upper[2] - lower[2]) * t);
    const b = Math.round(lower[3] + (upper[3] - lower[3]) * t);

    return packRGBA(r, g, b, 255);
  }

  // Get BW pattern character for value
  private _getBwPatternForValue(value: HeatmapValue): string {
    if (value === null || value === undefined) {
      return ' ';  // Empty for missing data
    }

    const normalized = this._normalizeValue(value);
    // Map to 0-4 index (5 patterns including space)
    const index = Math.min(4, Math.floor(normalized * 5));
    return BW_PATTERNS[index];
  }

  // Get contrasting foreground color for text on background
  private _getContrastColor(bgColor: PackedRGBA): PackedRGBA {
    const { r, g, b } = unpackRGBA(bgColor);

    // Calculate relative luminance (ITU-R BT.709)
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

    // Use dark text on light backgrounds, light text on dark backgrounds
    return luminance > 0.5
      ? packRGBA(0, 0, 0, 255)      // Black text
      : packRGBA(255, 255, 255, 255);  // White text
  }

  // ===== Value Formatting =====

  private _formatValue(value: HeatmapValue): string {
    if (value === null || value === undefined) {
      return '';
    }

    const format = this.props.valueFormat ?? this._detectValueFormat();

    switch (format) {
      case 'd':
        return String(Math.round(value));
      case '.1f':
        return value.toFixed(1);
      case '.2f':
        return value.toFixed(2);
      case '.0%':
        return `${Math.round(value * 100)}%`;
      case '.1%':
        return `${(value * 100).toFixed(1)}%`;
      default:
        return String(Math.round(value));
    }
  }

  // ===== Isoline Detection (Marching Squares) =====

  private _hasIsolines(): boolean {
    if (this.props.isolineCount && this.props.isolineCount > 0) return true;
    return Array.isArray(this.props.isolines) && this.props.isolines.length > 0;
  }

  // Get effective isolines (manual or auto-generated)
  private _getEffectiveIsolines(): Isoline[] {
    // Manual isolines take precedence unless isolineCount is set
    if (this.props.isolineCount && this.props.isolineCount > 0) {
      return this._generateIsolines(this.props.isolineCount, this.props.isolineMode ?? 'equal');
    }
    return this.props.isolines ?? [];
  }

  // Generate N isolines using the specified algorithm
  private _generateIsolines(count: number, mode: IsolineMode): Isoline[] {
    this._calculateScale();
    const min = this._minValue;
    const max = this._maxValue;
    const range = max - min;

    if (range <= 0 || count <= 0) return [];

    let values: number[];

    switch (mode) {
      case 'quantile':
        values = this._generateQuantileValues(count);
        break;
      case 'nice':
        values = this._generateNiceValues(count, min, max);
        break;
      case 'equal':
      default:
        values = this._generateEqualValues(count, min, max);
        break;
    }

    return values.map(value => ({ value }));
  }

  // Equal intervals between min and max
  private _generateEqualValues(count: number, min: number, max: number): number[] {
    const values: number[] = [];
    const step = (max - min) / (count + 1);
    for (let i = 1; i <= count; i++) {
      values.push(min + step * i);
    }
    return values;
  }

  // Values at data percentiles
  private _generateQuantileValues(count: number): number[] {
    const { grid } = this.props;
    if (!grid) return [];

    // Collect all non-null values
    const allValues: number[] = [];
    for (const row of grid) {
      if (!row) continue;
      for (const val of row) {
        if (val !== null && val !== undefined) {
          allValues.push(val);
        }
      }
    }

    if (allValues.length === 0) return [];

    // Sort values
    allValues.sort((a, b) => a - b);

    // Get percentile values
    const values: number[] = [];
    for (let i = 1; i <= count; i++) {
      const percentile = i / (count + 1);
      const index = Math.floor(percentile * (allValues.length - 1));
      values.push(allValues[index]);
    }

    // Remove duplicates
    return [...new Set(values)];
  }

  // "Nice" rounded values (multiples of 1, 2, 5, 10, etc.)
  private _generateNiceValues(count: number, min: number, max: number): number[] {
    const range = max - min;
    if (range <= 0) return [];

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

  // Get the marching squares case for a 2x2 cell quad
  // Returns the 4-bit case number based on which corners are >= threshold
  private _getMarchingSquaresCase(
    topLeft: HeatmapValue,
    topRight: HeatmapValue,
    bottomLeft: HeatmapValue,
    bottomRight: HeatmapValue,
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

  // Get the box-drawing character for an isoline at a cell boundary
  private _getIsolineChar(
    topLeft: HeatmapValue,
    topRight: HeatmapValue,
    bottomLeft: HeatmapValue,
    bottomRight: HeatmapValue,
    threshold: number
  ): string | null {
    const caseNum = this._getMarchingSquaresCase(topLeft, topRight, bottomLeft, bottomRight, threshold);
    return MARCHING_SQUARES_CHARS[caseNum] ?? null;
  }

  // Build isoline segments for a row boundary (between data row `row` and `row+1`)
  // Returns array of { col, char, color, label? } for each column where isoline crosses
  private _buildIsolineRow(
    row: number,
    isoline: Isoline
  ): Array<{ col: number; char: string; color?: string; label?: string }> {
    const { grid } = this.props;
    const segments: Array<{ col: number; char: string; color?: string; label?: string }> = [];

    if (!grid || row < 0 || row >= grid.length - 1) return segments;

    const topRow = grid[row];
    const bottomRow = grid[row + 1];
    if (!topRow || !bottomRow) return segments;

    const numCols = Math.min(topRow.length, bottomRow.length);

    // Only iterate to numCols-1 because each quad needs col and col+1
    // The last column would have null for topRight/bottomRight which creates edge artifacts
    for (let col = 0; col < numCols - 1; col++) {
      // Get the 2x2 quad corners
      // For the isoline row between data rows, we look at:
      // - topLeft: grid[row][col]
      // - topRight: grid[row][col+1]
      // - bottomLeft: grid[row+1][col]
      // - bottomRight: grid[row+1][col+1]
      const topLeft = topRow[col];
      const topRight = topRow[col + 1];
      const bottomLeft = bottomRow[col];
      const bottomRight = bottomRow[col + 1];

      const char = this._getIsolineChar(topLeft, topRight, bottomLeft, bottomRight, isoline.value);
      if (char) {
        segments.push({
          col,
          char,
          color: isoline.color,
          label: this.props.showIsolineLabels ? (isoline.label ?? String(isoline.value)) : undefined,
        });
      }
    }

    return segments;
  }

  // ===== Label Dimensions =====

  private _getRowLabelWidth(): number {
    const { rowLabels, showAxis } = this.props;
    if (!showAxis || !rowLabels || rowLabels.length === 0) return 0;

    let maxLen = 0;
    for (const label of rowLabels) {
      if (label) maxLen = Math.max(maxLen, label.length);
    }
    return maxLen > 0 ? maxLen + 1 : 0;  // +1 for spacing
  }

  private _getColLabelHeight(): number {
    const { colLabels, showAxis } = this.props;
    if (!showAxis || !colLabels || colLabels.length === 0) return 0;
    return 1;  // Single row for column labels
  }

  // ===== Interface Implementations =====

  canReceiveFocus(): boolean {
    return this.props.selectable === true;
  }

  isInteractive(): boolean {
    return !this.props.disabled;
  }

  // ===== Intrinsic Size =====

  intrinsicSize(_context: IntrinsicSizeContext): { width: number; height: number } {
    const { grid, rows, cols } = this.props;
    const cellWidth = this._getCellWidth();
    const cellHeight = this._getCellHeight();
    const rowGap = this._getGap();
    const colGap = this._getColGap();  // Uses 1 when isolines present
    const hasIsolines = this._hasIsolines();

    // Use grid dimensions if available, otherwise fall back to rows/cols props
    const numRows = grid?.length ?? rows ?? 0;
    const numCols = grid?.[0]?.length ?? cols ?? 0;

    if (numRows === 0 || numCols === 0) {
      return { width: 0, height: 0 };
    }

    const rowLabelWidth = this._getRowLabelWidth();
    const colLabelHeight = this._getColLabelHeight();

    // Grid dimensions - use colGap for horizontal spacing
    const gridWidth = numCols * cellWidth + (numCols > 1 ? (numCols - 1) * colGap : 0);

    // Height includes isoline rows between data rows (1 char each)
    const isolineRowCount = hasIsolines ? numRows - 1 : 0;
    const gridHeight = numRows * cellHeight + isolineRowCount + (numRows > 1 ? (numRows - 1) * rowGap : 0);

    // Legend height (if enabled)
    const legendHeight = this.props.showLegend ? LEGEND_HEIGHT + 1 : 0;  // +1 for gap

    return {
      width: Math.max(rowLabelWidth + gridWidth, this.props.showLegend ? LEGEND_WIDTH + 10 : 0),
      height: colLabelHeight + gridHeight + legendHeight,
    };
  }

  // ===== Rendering =====

  render(
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    _context: ComponentRenderContext
  ): void {
    const { grid, isolines } = this.props;

    if (!grid || grid.length === 0) {
      return;
    }

    this._calculateScale();
    this._cellBounds.clear();
    this._elementBounds = bounds;
    this.setBounds(bounds);

    const cellWidth = this._getCellWidth();
    const cellHeight = this._getCellHeight();
    const rowGap = this._getGap();
    const colGap = this._getColGap();  // Uses 1 when isolines present
    const rowLabelWidth = this._getRowLabelWidth();
    const colLabelHeight = this._getColLabelHeight();
    const theme = getCurrentTheme();
    const isBwMode = theme.type === 'bw';
    const hasIsolines = this._hasIsolines();

    // Render column labels
    if (colLabelHeight > 0 && this.props.colLabels) {
      let x = bounds.x + rowLabelWidth;
      for (let col = 0; col < (this.props.colLabels?.length ?? 0); col++) {
        const label = this.props.colLabels[col] ?? '';
        const displayLabel = label.substring(0, cellWidth);
        buffer.currentBuffer.setText(x, bounds.y, displayLabel, style);
        x += cellWidth + colGap;
      }
    }

    // Render grid rows (with isoline rows between data rows)
    let y = bounds.y + colLabelHeight;
    for (let row = 0; row < grid.length; row++) {
      const rowData = grid[row];
      if (!rowData) continue;

      // Render row label
      if (rowLabelWidth > 0 && this.props.rowLabels) {
        const label = this.props.rowLabels[row] ?? '';
        buffer.currentBuffer.setText(bounds.x, y, label, style);
      }

      // Render data cells
      let x = bounds.x + rowLabelWidth;
      for (let col = 0; col < rowData.length; col++) {
        const value = rowData[col];

        // Store cell bounds for click handling
        this._cellBounds.set(`${row}-${col}`, {
          x, y, width: cellWidth, height: cellHeight
        });

        // Skip cell rendering if showCells is false (for isolines-only display)
        if (this.props.showCells === false) {
          // Leave cells transparent - just skip to the next cell
          x += cellWidth + colGap;
          continue;
        }

        if (isBwMode) {
          // BW mode: use pattern characters
          const pattern = this._getBwPatternForValue(value);
          for (let cy = 0; cy < cellHeight; cy++) {
            for (let cx = 0; cx < cellWidth; cx++) {
              buffer.currentBuffer.setCell(x + cx, y + cy, {
                char: pattern,
                ...style,
              });
            }
          }

          // Render value if enabled (no color contrast needed in BW)
          if (this.props.showValues && value !== null && value !== undefined) {
            const formatted = this._formatValue(value);
            const textX = x + cellWidth - formatted.length;  // Right-align
            buffer.currentBuffer.setText(textX, y, formatted, style);
          }
        } else {
          // Color mode: use background color
          const bgColor = this._getColorForValue(value);

          for (let cy = 0; cy < cellHeight; cy++) {
            for (let cx = 0; cx < cellWidth; cx++) {
              buffer.currentBuffer.setCell(x + cx, y + cy, {
                char: ' ',
                ...style,
                background: bgColor,
              });
            }
          }

          // Render value if enabled (with contrasting foreground)
          if (this.props.showValues && value !== null && value !== undefined && bgColor) {
            const fgColor = this._getContrastColor(bgColor);
            const formatted = this._formatValue(value);
            const textX = x + cellWidth - formatted.length;  // Right-align
            buffer.currentBuffer.setText(textX, y, formatted, {
              ...style,
              foreground: fgColor,
              background: bgColor,
            });
          }
        }

        x += cellWidth + colGap;
      }

      y += cellHeight;

      // Render isoline row between this data row and the next
      if (hasIsolines && row < grid.length - 1) {
        this._renderIsolineRow(bounds, y, row, rowLabelWidth, cellWidth, cellHeight, colGap, style, buffer);
        y += 1;  // Isoline row takes 1 character height
      }

      y += rowGap;
      if (y >= bounds.y + bounds.height) break;
    }

    // Render legend if enabled
    if (this.props.showLegend) {
      this._renderLegend(bounds, y + 1, style, buffer, isBwMode);
    }
  }

  // Render color scale legend
  private _renderLegend(
    bounds: Bounds,
    y: number,
    style: Partial<Cell>,
    buffer: DualBuffer,
    isBwMode: boolean
  ): void {
    const x = bounds.x;

    // Format min/max values
    const format = this.props.valueFormat ?? this._detectValueFormat();
    const minStr = this._formatValueWithFormat(this._minValue, format);
    const maxStr = this._formatValueWithFormat(this._maxValue, format);

    // Calculate legend bar width (fit between min and max labels)
    const barWidth = Math.min(LEGEND_WIDTH, bounds.width - minStr.length - maxStr.length - 2);
    if (barWidth < 5) return;  // Not enough space

    // Render color/pattern bar
    for (let i = 0; i < barWidth; i++) {
      const t = i / (barWidth - 1);  // 0 to 1
      const value = this._minValue + t * (this._maxValue - this._minValue);

      if (isBwMode) {
        const pattern = this._getBwPatternForValue(value);
        buffer.currentBuffer.setCell(x + i, y, { char: pattern, ...style });
      } else {
        const bgColor = this._getColorForValue(value);
        buffer.currentBuffer.setCell(x + i, y, { char: ' ', ...style, background: bgColor });
      }
    }

    // Render min/max labels below the bar
    buffer.currentBuffer.setText(x, y + 1, minStr, style);
    const maxX = x + barWidth - maxStr.length;
    buffer.currentBuffer.setText(maxX, y + 1, maxStr, style);
  }

  // Format value with specific format string
  private _formatValueWithFormat(value: number, format: string): string {
    if (format === '.0%') {
      return `${Math.round(value * 100)}%`;
    } else if (format === '.1f') {
      return value.toFixed(1);
    } else if (format === '.2f') {
      return value.toFixed(2);
    } else {
      return String(Math.round(value));
    }
  }

  // Render isolines for the boundary between data row `dataRow` and `dataRow+1`
  private _renderIsolineRow(
    bounds: Bounds,
    y: number,
    dataRow: number,
    rowLabelWidth: number,
    cellWidth: number,
    cellHeight: number,
    colGap: number,
    style: Partial<Cell>,
    buffer: DualBuffer
  ): void {
    const isolines = this._getEffectiveIsolines();
    if (isolines.length === 0) return;

    const numCols = this.props.grid?.[dataRow]?.length ?? 0;
    const invisibleCells = this.props.showCells === false;

    // Track which cells have isoline characters (for label placement)
    const isolineChars: Map<number, { char: string; color?: string; label?: string }> = new Map();

    // Process each isoline and collect characters
    for (const isoline of isolines) {
      const segments = this._buildIsolineRow(dataRow, isoline);
      for (const seg of segments) {
        // If multiple isolines cross the same cell, we just use the last one
        // (could be enhanced to use junction chars like ┼)
        isolineChars.set(seg.col, seg);
      }
    }

    // Render the isoline row - place box-drawing chars at cell centers
    let x = bounds.x + rowLabelWidth;
    let lastIsolineEndX = 0;
    let labelInfo: { label: string; style: Partial<Cell> } | null = null;
    let prevHasHorizontalRight = false;
    let prevCellStyle: Partial<Cell> = style;

    for (let col = 0; col < numCols; col++) {
      const seg = isolineChars.get(col);
      const midX = x + Math.floor(cellWidth / 2);

      if (seg) {
        // Parse isoline color if specified
        const fgColor = seg.color ? parseColor(seg.color) : undefined;
        const cellStyle = fgColor ? { ...style, foreground: fgColor } : style;

        // Determine horizontal connectivity
        // Characters that enter from the left: ─ ╮ ╯
        const hasHorizontalLeft = seg.char === '─' || seg.char === '╮' || seg.char === '╯';
        // Characters that exit to the right: ─ ╭ ╰
        const hasHorizontalRight = seg.char === '─' || seg.char === '╭' || seg.char === '╰';

        // Determine vertical connectivity
        // Characters with top connection (coming from above): │ ╰ ╯
        const hasVerticalTop = seg.char === '│' || seg.char === '╰' || seg.char === '╯';
        // Characters with bottom connection (going below): │ ╮ ╭
        const hasVerticalBottom = seg.char === '│' || seg.char === '╮' || seg.char === '╭';

        // Fill left part of cell (from x to midX-1)
        for (let cx = 0; cx < midX - x; cx++) {
          const char = (hasHorizontalLeft || prevHasHorizontalRight) ? '─' : ' ';
          buffer.currentBuffer.setCell(x + cx, y, { char, ...cellStyle });
        }

        // Render the box-drawing character at the center
        buffer.currentBuffer.setCell(midX, y, { char: seg.char, ...cellStyle });

        // Fill right part of cell (from midX+1 to x+cellWidth-1)
        for (let cx = midX + 1; cx < x + cellWidth; cx++) {
          const char = hasHorizontalRight ? '─' : ' ';
          buffer.currentBuffer.setCell(cx, y, { char, ...cellStyle });
        }

        // Render horizontal continuation in the gap between cells
        if (colGap > 0 && hasHorizontalRight && col < numCols - 1) {
          for (let gx = 0; gx < colGap; gx++) {
            buffer.currentBuffer.setCell(x + cellWidth + gx, y, { char: '─', ...cellStyle });
          }
        }

        // When cells are invisible, extend vertical lines through data rows
        if (invisibleCells) {
          // Extend upward through the data row above (y - cellHeight to y - 1)
          if (hasVerticalTop) {
            for (let cy = 1; cy <= cellHeight; cy++) {
              buffer.currentBuffer.setCell(midX, y - cy, { char: '│', ...cellStyle });
            }
          }
          // Extend downward through the data row below (y + 1 to y + cellHeight)
          if (hasVerticalBottom) {
            for (let cy = 1; cy <= cellHeight; cy++) {
              buffer.currentBuffer.setCell(midX, y + cy, { char: '│', ...cellStyle });
            }
          }
        }

        // Track the end position of this isoline segment
        lastIsolineEndX = x + cellWidth + colGap;

        // Track label info (use first label found in this row)
        if (seg.label && !labelInfo) {
          labelInfo = { label: seg.label, style: cellStyle };
        }

        prevHasHorizontalRight = hasHorizontalRight;
        prevCellStyle = cellStyle;
      } else {
        // No isoline at this cell
        // If previous cell exits right, continue the line
        if (prevHasHorizontalRight) {
          // Check if next cell has an isoline that enters from the left
          const nextSeg = isolineChars.get(col + 1);
          const nextHasHorizontalLeft = nextSeg && (nextSeg.char === '─' || nextSeg.char === '╮' || nextSeg.char === '╯');

          // When cells are invisible, extend horizontal lines all the way through
          // When cells are visible, stop at the center
          const invisibleCells = this.props.showCells === false;
          const extendThroughCell = invisibleCells && nextHasHorizontalLeft;

          if (extendThroughCell) {
            // Extend line through the full cell width
            for (let cx = 0; cx < cellWidth; cx++) {
              buffer.currentBuffer.setCell(x + cx, y, { char: '─', ...prevCellStyle });
            }
            // Continue through gap if present
            if (colGap > 0) {
              for (let gx = 0; gx < colGap; gx++) {
                buffer.currentBuffer.setCell(x + cellWidth + gx, y, { char: '─', ...prevCellStyle });
              }
            }
            // Keep tracking horizontal continuation
            prevHasHorizontalRight = true;
          } else {
            // Stop at the middle of this cell
            for (let cx = 0; cx <= midX - x; cx++) {
              buffer.currentBuffer.setCell(x + cx, y, { char: '─', ...prevCellStyle });
            }
            for (let cx = midX - x + 1; cx < cellWidth; cx++) {
              buffer.currentBuffer.setCell(x + cx, y, { char: ' ', ...style });
            }
            prevHasHorizontalRight = false;
          }
        } else {
          // Leave empty
          for (let cx = 0; cx < cellWidth; cx++) {
            buffer.currentBuffer.setCell(x + cx, y, { char: ' ', ...style });
          }
          prevHasHorizontalRight = false;
        }
      }

      x += cellWidth + colGap;
    }

    // Render label at the end of the isoline (after the last segment)
    if (labelInfo && lastIsolineEndX > 0) {
      const labelX = lastIsolineEndX;
      if (labelX + labelInfo.label.length < bounds.x + bounds.width) {
        buffer.currentBuffer.setText(labelX, y, labelInfo.label, labelInfo.style);
      }
    }
  }

  // ===== Click Handling =====

  handleClick(event: ClickEvent, _document: unknown): boolean {
    const { x, y } = event.position;
    const { selectable, onSelect } = this.props;

    for (const [key, b] of this._cellBounds) {
      if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) {
        const [row, col] = key.split('-').map(Number);

        if (selectable) {
          this._selectedCell = { row, col };
        }

        if (onSelect) {
          onSelect({
            type: 'select',
            row,
            col,
            value: this.props.grid?.[row]?.[col],
            rowLabel: this.props.rowLabels?.[row],
            colLabel: this.props.colLabels?.[col],
          });
        }

        return true;
      }
    }

    return false;
  }

  // ===== Text Selection =====

  isTextSelectable(): boolean {
    return true;
  }

  /**
   * Get the JSON representation of selected cells for clipboard
   * Output format: { grid, rowLabels?, colLabels? } for selected rows
   * @param selectionBounds - Optional bounds of the visual selection relative to element
   */
  getSelectableText(selectionBounds?: SelectionBounds): string {
    const { grid, rowLabels, colLabels } = this.props;

    if (!grid || grid.length === 0 || !this._elementBounds) {
      return '';
    }

    // Find which row/col indices are within the selection bounds
    const selectedRows = new Set<number>();
    const selectedCols = new Set<number>();

    for (const [key, b] of this._cellBounds) {
      const [row, col] = key.split('-').map(Number);

      // Convert cell bounds to be relative to element
      const relativeStartX = b.x - this._elementBounds.x;
      const relativeEndX = relativeStartX + b.width - 1;
      const relativeStartY = b.y - this._elementBounds.y;
      const relativeEndY = relativeStartY + b.height - 1;

      // Check if this cell overlaps with selection
      let overlaps = true;
      if (selectionBounds) {
        const xOverlaps = relativeStartX <= selectionBounds.endX && relativeEndX >= selectionBounds.startX;
        const yOverlaps = selectionBounds.startY !== undefined && selectionBounds.endY !== undefined
          ? (relativeStartY <= selectionBounds.endY && relativeEndY >= selectionBounds.startY)
          : true;
        overlaps = xOverlaps && yOverlaps;
      }

      if (overlaps) {
        selectedRows.add(row);
        selectedCols.add(col);
      }
    }

    if (selectedRows.size === 0 || selectedCols.size === 0) {
      return '';
    }

    // Sort indices for consistent output
    const sortedRows = [...selectedRows].sort((a, b) => a - b);
    const sortedCols = [...selectedCols].sort((a, b) => a - b);

    // Build output grid with selected rows and columns
    const outputGrid: HeatmapGrid = sortedRows.map(row =>
      sortedCols.map(col => grid[row]?.[col] ?? null)
    );

    // Build output object
    const output: { grid: HeatmapGrid; rowLabels?: string[]; colLabels?: string[] } = {
      grid: outputGrid,
    };

    // Include labels if present
    if (rowLabels && rowLabels.length > 0) {
      output.rowLabels = sortedRows.map(idx => rowLabels[idx] ?? '');
    }
    if (colLabels && colLabels.length > 0) {
      output.colLabels = sortedCols.map(idx => colLabels[idx] ?? '');
    }

    return JSON.stringify(output, null, 2);
  }

  // ===== Getters and Setters =====

  getValue(): HeatmapGrid {
    return this.props.grid ?? [];
  }

  setValue(grid: HeatmapGrid): void {
    this.props.grid = grid;
  }

  getCell(row: number, col: number): HeatmapValue {
    return this.props.grid?.[row]?.[col];
  }

  setCell(row: number, col: number, value: HeatmapValue): void {
    if (!this.props.grid) this.props.grid = [];
    if (!this.props.grid[row]) this.props.grid[row] = [];
    this.props.grid[row][col] = value;
  }

  setRow(row: number, values: HeatmapValue[]): void {
    if (!this.props.grid) this.props.grid = [];
    this.props.grid[row] = values;
  }

  setColumn(col: number, values: HeatmapValue[]): void {
    if (!this.props.grid) this.props.grid = [];
    for (let row = 0; row < values.length; row++) {
      if (!this.props.grid[row]) this.props.grid[row] = [];
      this.props.grid[row][col] = values[row];
    }
  }

  getRowLabels(): string[] | undefined {
    return this.props.rowLabels;
  }

  setRowLabels(labels: string[]): void {
    this.props.rowLabels = labels;
  }

  getColLabels(): string[] | undefined {
    return this.props.colLabels;
  }

  setColLabels(labels: string[]): void {
    this.props.colLabels = labels;
  }
}

// ===== Component Schema =====

export const dataHeatmapSchema: ComponentSchema = {
  description: 'Data-driven heatmap with color scales and isolines. Supports inline JSON content.',
  props: {
    grid: { type: 'array', description: 'Grid data as 2D array: grid[row][col]' },
    rows: { type: 'number', description: 'Initial row count (for sizing when grid is empty)' },
    cols: { type: 'number', description: 'Initial column count (for sizing when grid is empty)' },
    rowLabels: { type: 'array', description: 'Row labels (Y-axis)' },
    colLabels: { type: 'array', description: 'Column labels (X-axis)' },
    min: { type: 'number', description: 'Minimum scale value' },
    max: { type: 'number', description: 'Maximum scale value' },
    colorScale: {
      type: 'string',
      enum: ['viridis', 'plasma', 'inferno', 'thermal', 'grayscale', 'diverging', 'greens', 'reds'],
      description: 'Color scale (default: viridis)',
    },
    isolines: { type: 'array', description: 'Isoline definitions: [{value, color?, label?}]' },
    showIsolineLabels: { type: 'boolean', description: 'Show labels on isolines (default: false)' },
    showCells: { type: 'boolean', description: 'Show cell backgrounds (default: true). Set to false for isolines-only display' },
    showValues: { type: 'boolean', description: 'Show numeric values in cells (default: false)' },
    valueFormat: { type: 'string', description: 'Value format: d, .1f, .2f, .0% (auto-detects)' },
    minCellWidth: { type: 'number', description: 'Minimum cell width in characters' },
    showLegend: { type: 'boolean', description: 'Show color scale legend (default: false)' },
    showAxis: { type: 'boolean', description: 'Show axis labels (default: true)' },
    selectable: { type: 'boolean', description: 'Enable cell selection (default: false)' },
    onHover: { type: 'handler', description: 'Hover event handler' },
    onSelect: { type: 'handler', description: 'Selection event handler' },
  },
  styles: {
    cellWidth: { type: 'number', description: 'Cell width in characters (default: 2, auto-sizes for values)' },
    cellHeight: { type: 'number', description: 'Cell height in characters (default: 1)' },
    gap: { type: 'number', description: 'Gap between cells (default: 0)' },
  },
};

registerComponentSchema('data-heatmap', dataHeatmapSchema);

registerComponent({
  type: 'data-heatmap',
  componentClass: DataHeatmapElement,
  defaultProps,
});
