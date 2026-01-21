// Data-driven bar chart component for terminal UIs
// Supports horizontal/vertical bars, stacking, sparklines

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
import { packRGBA, parseColor } from './color-utils.ts';
import type { PackedRGBA } from '../types.ts';

const logger = getLogger('DataBars');

// Grayscale category palette for multi-series bars (color/fullcolor modes)
// Darker grays visible against light backgrounds (no white/near-white)
const GRAYSCALE_PALETTE: PackedRGBA[] = [
  packRGBA(60, 60, 60, 255),    // Dark gray
  packRGBA(120, 120, 120, 255), // Medium-dark gray
  packRGBA(90, 90, 90, 255),    // Darker gray
  packRGBA(150, 150, 150, 255), // Medium gray
  packRGBA(45, 45, 45, 255),    // Very dark gray
  packRGBA(105, 105, 105, 255), // Mid gray
];

// ===== Type Definitions =====

export type BarValue = number | null | undefined;
export type DataBarsData = BarValue[][];

export interface DataBarSeries {
  name: string;
  color?: string;
  stack?: string;
}

export interface DataBarHoverEvent {
  type: 'hover';
  entryIndex: number;
  seriesIndex: number;
  value: BarValue;
  label?: string;
}

export interface DataBarSelectEvent {
  type: 'select';
  entryIndex: number;
  seriesIndex: number;
  value: BarValue;
  label?: string;
}

export interface DataBarsProps extends BaseProps {
  series: DataBarSeries[];
  bars: DataBarsData;
  labels?: string[];

  // orientation, barWidth, gap are style props (via this.props.style)

  showLabels?: boolean;
  showValues?: boolean;
  valueFormat?: 'value' | 'sum' | 'last/max' | 'percent';
  showLegend?: boolean;
  showAxis?: boolean;

  min?: number;
  max?: number;

  selectable?: boolean;
  onHover?: (event: DataBarHoverEvent) => void;
  onSelect?: (event: DataBarSelectEvent) => void;
}

// ===== Unicode Bar Characters =====

// Horizontal bars (fractional blocks, left to right)
const H_BAR_CHARS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

// Vertical bars (fractional blocks, bottom to top)
const V_BAR_CHARS = ['', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

const FULL_BLOCK = '█';

// BW mode patterns for multi-series differentiation (no sub-char precision available)
const BW_PATTERNS = ['█', '▓', '▒', '░'];

// LED style characters (with visible gaps)
const LED_H_CHAR = '▊';  // Horizontal LED segment (3/4 block, gap on right)
const LED_V_CHAR = '▆';  // Vertical LED segment (3/4 block, gap on top)

// ===== Default Props =====

const defaultProps: Partial<DataBarsProps> = {
  showLabels: true,
  showValues: false,
  showLegend: false,
  showAxis: true,
  selectable: false,
};

// ===== DataBarsElement Class =====

export class DataBarsElement extends Element implements Renderable, Focusable, Clickable, Interactive, TextSelectable, SelectableTextProvider {
  declare type: 'data-bars';
  declare props: DataBarsProps;

  private _barBounds: Map<string, Bounds> = new Map();  // "entry-series" -> bounds
  private _elementBounds: Bounds | null = null;  // Track element bounds for selection
  private _minValue: number = 0;
  private _maxValue: number = 0;
  private _scale: number = 1;
  private _selectedBar: { entry: number; series: number } | null = null;

  constructor(props: DataBarsProps = { series: [], bars: [] }, children: Element[] = []) {
    super('data-bars', { ...defaultProps, ...props }, children);
    this._parseProps();
    this._parseInlineData();
  }

  // Parse JSON strings from props (when passed as attributes in .melker files)
  private _parseProps(): void {
    const jsonProps = ['series', 'bars', 'labels'] as const;
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
            if (data.series && Array.isArray(data.series)) {
              this.props.series = data.series;
            }
            if (data.bars && Array.isArray(data.bars)) {
              this.props.bars = data.bars;
            }
            if (data.labels && Array.isArray(data.labels)) {
              this.props.labels = data.labels;
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
  private _getOrientation() { return this._getStyleProp('orientation', 'horizontal'); }
  private _getBarWidth() { return this._getStyleProp('barWidth', 1); }
  private _getGap() { return this._getStyleProp('gap', 1); }
  private _getBarStyle() { return this._getStyleProp('barStyle', 'solid'); }
  private _getHighValue() { return this._getStyleProp('highValue', 80); }
  private _getLedColorLow() { return this._getStyleProp('ledColorLow', 'yellow'); }
  private _getLedColorHigh() { return this._getStyleProp('ledColorHigh', 'red'); }

  // Special case: ledWidth default depends on orientation
  private _getLedWidth(): number {
    const defaultWidth = this._getOrientation() === 'horizontal' ? 3 : 1;
    return this._getStyleProp('ledWidth', defaultWidth);
  }

  // Get color for a series (uses series.color if specified, otherwise grayscale palette)
  private _getSeriesColor(seriesIndex: number): PackedRGBA | undefined {
    const theme = getCurrentTheme();

    // Only apply colors in color or fullcolor modes
    if (theme.type !== 'color' && theme.type !== 'fullcolor') {
      return undefined;
    }

    const series = this.props.series;
    const seriesConfig = series?.[seriesIndex];

    // Use explicit series color if provided
    if (seriesConfig?.color) {
      return parseColor(seriesConfig.color);
    }

    // Use default grayscale palette
    return GRAYSCALE_PALETTE[seriesIndex % GRAYSCALE_PALETTE.length];
  }

  // Check if we're in BW mode (no sub-char precision, use patterns instead)
  private _isBwMode(): boolean {
    const theme = getCurrentTheme();
    return theme.type === 'bw';
  }

  // Get pattern character for a series in BW mode (undefined if not applicable)
  private _getBwPattern(seriesIndex: number): string | undefined {
    const { series } = this.props;
    if (!this._isBwMode() || series.length <= 1) return undefined;
    return BW_PATTERNS[seriesIndex % BW_PATTERNS.length];
  }

  // Check if any series has stacking enabled
  private _hasStacking(): boolean {
    const { series } = this.props;
    if (!series || series.length <= 1) return false;
    return series.some(s => s.stack !== undefined);
  }

  // Build map of stack groups: stackId -> series indices
  private _buildStackGroups(): Map<string, number[]> {
    const { series } = this.props;
    const groups = new Map<string, number[]>();
    for (let sIdx = 0; sIdx < series.length; sIdx++) {
      const stackId = series[sIdx]?.stack ?? `_${sIdx}`;
      if (!groups.has(stackId)) groups.set(stackId, []);
      groups.get(stackId)!.push(sIdx);
    }
    return groups;
  }

  // Render text string to buffer at position
  private _renderText(buffer: DualBuffer, x: number, y: number, text: string, style: Partial<Cell>, maxWidth?: number): void {
    const displayText = maxWidth !== undefined ? text.substring(0, maxWidth) : text;
    buffer.currentBuffer.setText(x, y, displayText, style);
  }

  // ===== Interface Implementations =====

  canReceiveFocus(): boolean {
    return this.props.selectable === true;
  }

  isInteractive(): boolean {
    return !this.props.disabled;
  }

  // ===== Scale Calculations =====

  private _calculateScale(): void {
    const { series, bars, min, max } = this.props;
    const isLed = this._getBarStyle() === 'led';

    if (!bars || !Array.isArray(bars) || bars.length === 0) {
      this._minValue = 0;
      this._maxValue = isLed ? 100 : 0;
      this._scale = isLed ? 100 : 1;
      return;
    }

    let dataMax = 0;
    for (const entry of bars) {
      if (!entry) continue;
      const stacks = new Map<string, number>();
      for (let i = 0; i < (series?.length ?? 0); i++) {
        const value = entry[i] ?? 0;
        if (typeof value !== 'number') continue;
        const stackId = series?.[i]?.stack ?? `_${i}`;
        stacks.set(stackId, (stacks.get(stackId) ?? 0) + value);
      }
      if (stacks.size > 0) {
        dataMax = Math.max(dataMax, ...stacks.values());
      }
    }

    // LED bars default to 0-100 scale (percentage-based)
    this._minValue = min ?? 0;
    this._maxValue = max ?? (isLed ? 100 : dataMax);
    this._scale = this._maxValue - this._minValue;
    if (this._scale === 0) this._scale = 1;
  }

  private _valueToEighths(value: number, availableLength: number): number {
    if (this._scale === 0) return 0;
    const normalized = (value - this._minValue) / this._scale;
    return Math.round(Math.max(0, Math.min(1, normalized)) * availableLength * 8);
  }

  // ===== Rendering =====

  private _renderHorizontalBar(
    buffer: DualBuffer,
    x: number,
    y: number,
    eighths: number,
    style: Partial<Cell>,
    pattern?: string // BW mode pattern char (no fractional precision)
  ): number {
    if (pattern) {
      // BW mode with pattern: round to whole chars, no fractional
      const chars = Math.round(eighths / 8);
      for (let i = 0; i < chars; i++) {
        buffer.currentBuffer.setCell(x + i, y, { char: pattern, ...style });
      }
      return chars;
    }

    const fullChars = Math.floor(eighths / 8);
    const remainder = eighths % 8;
    let drawn = 0;

    for (let i = 0; i < fullChars; i++) {
      buffer.currentBuffer.setCell(x + i, y, { char: FULL_BLOCK, ...style });
      drawn++;
    }

    if (remainder > 0) {
      buffer.currentBuffer.setCell(x + fullChars, y, { char: H_BAR_CHARS[remainder], ...style });
      drawn++;
    }

    return drawn;
  }

  private _renderVerticalBar(
    buffer: DualBuffer,
    x: number,
    baseY: number,
    eighths: number,
    style: Partial<Cell>,
    pattern?: string // BW mode pattern char (no fractional precision)
  ): number {
    if (pattern) {
      // BW mode with pattern: round to whole chars, no fractional
      const chars = Math.round(eighths / 8);
      for (let i = 0; i < chars; i++) {
        buffer.currentBuffer.setCell(x, baseY - i, { char: pattern, ...style });
      }
      return Math.max(1, chars);
    }

    const fullChars = Math.floor(eighths / 8);
    const remainder = eighths % 8;
    let drawn = 0;

    // Draw from bottom up
    for (let i = 0; i < fullChars; i++) {
      buffer.currentBuffer.setCell(x, baseY - i, { char: FULL_BLOCK, ...style });
      drawn++;
    }

    if (remainder > 0) {
      buffer.currentBuffer.setCell(x, baseY - fullChars, { char: V_BAR_CHARS[remainder], ...style });
      drawn++;
    }

    return Math.max(1, drawn);
  }

  private _renderLedBar(
    buffer: DualBuffer,
    x: number,
    y: number,
    value: number,
    availableLength: number,
    style: Partial<Cell>,
    isHorizontal: boolean
  ): number {
    const highValue = this._getHighValue();
    const ledColorLow = this._getLedColorLow();
    const ledColorHigh = this._getLedColorHigh();
    const barWidth = this._getBarWidth();
    const ledWidth = this._getLedWidth();
    const ledChar = isHorizontal ? LED_H_CHAR : LED_V_CHAR;

    const normalizedValue = (value - this._minValue) / this._scale;
    const segmentCount = Math.floor(availableLength / ledWidth);
    const filledSegments = Math.round(Math.max(0, Math.min(1, normalizedValue)) * segmentCount);
    const thresholdSegment = Math.floor((highValue / 100) * segmentCount);

    let drawn = 0;
    for (let i = 0; i < filledSegments; i++) {
      const color = i >= thresholdSegment ? ledColorHigh : ledColorLow;
      const segmentColor = parseColor(color);
      const segmentStyle = segmentColor ? { ...style, foreground: segmentColor } : style;

      // Render (ledWidth-1) full blocks + 1 partial LED char
      // Horizontal: partial at end, Vertical: partial at start
      for (let w = 0; w < ledWidth; w++) {
        const char = isHorizontal
          ? (w < ledWidth - 1 ? FULL_BLOCK : ledChar)
          : (w === 0 ? ledChar : FULL_BLOCK);

        if (isHorizontal) {
          for (let row = 0; row < barWidth; row++) {
            buffer.currentBuffer.setCell(x + drawn, y + row, { char, ...segmentStyle });
          }
        } else {
          for (let col = 0; col < barWidth; col++) {
            buffer.currentBuffer.setCell(x + col, y - drawn, { char, ...segmentStyle });
          }
        }
        drawn++;
      }
    }
    return drawn;
  }

  private _formatValue(entry: BarValue[], seriesIndex: number): string {
    const { valueFormat, series, bars } = this.props;
    const format = valueFormat ?? this._detectValueFormat();

    switch (format) {
      case 'sum': {
        let sum = 0;
        for (let i = 0; i < (series?.length ?? 0); i++) {
          const stackId = series?.[i]?.stack;
          if (stackId === series?.[seriesIndex]?.stack) {
            sum += entry[i] ?? 0;
          }
        }
        return String(Math.round(sum));
      }
      case 'last/max': {
        const lastEntry = bars[bars.length - 1];
        const lastValue = lastEntry?.[seriesIndex] ?? 0;
        return `${Math.round(lastValue)}/${Math.round(this._maxValue)}`;
      }
      case 'percent': {
        const lastEntry = bars[bars.length - 1];
        const lastValue = lastEntry?.[seriesIndex] ?? 0;
        const pct = this._maxValue > 0 ? (lastValue / this._maxValue) * 100 : 0;
        return `${Math.round(pct)}%`;
      }
      default:
        return String(Math.round(entry[seriesIndex] ?? 0));
    }
  }

  private _detectValueFormat(): 'value' | 'sum' | 'last/max' | 'percent' {
    const { series, labels } = this.props;
    const hasStacking = series?.some(s => s.stack);
    const isSparkline = !labels || labels.length === 0;

    if (hasStacking) return 'sum';
    if (isSparkline) return 'last/max';
    return 'value';
  }

  private _getLabelWidth(): number {
    const { labels, series, showLabels } = this.props;
    if (!showLabels) return 0;

    let maxLen = 0;
    if (labels && labels.length > 0) {
      for (const label of labels) {
        if (label) maxLen = Math.max(maxLen, label.length);
      }
    } else if (series) {
      for (const s of series) {
        if (s.name) maxLen = Math.max(maxLen, s.name.length);
      }
    }
    return maxLen > 0 ? maxLen + 1 : 0; // +1 for spacing
  }

  private _getValueWidth(): number {
    const { showValues, bars, series } = this.props;
    if (!showValues || !bars || bars.length === 0) return 0;

    // Estimate max value width: digits + 1 leading space + 1 trailing margin
    const format = this.props.valueFormat ?? this._detectValueFormat();
    if (format === 'last/max') {
      return String(Math.round(this._maxValue)).length * 2 + 3; // "xxx/xxx" + leading space + margin
    } else if (format === 'percent') {
      return 6; // "100%" + leading space + margin
    } else {
      return String(Math.round(this._maxValue)).length + 2; // digits + leading space + margin
    }
  }

  intrinsicSize(_context: IntrinsicSizeContext): { width: number; height: number } {
    const { bars, series } = this.props;
    const orientation = this._getOrientation();
    const barWidth = this._getBarWidth();
    const gap = this._getGap();
    const numSeries = series?.length ?? 0;
    const numEntries = bars?.length ?? 0;
    const isSparkline = !this.props.labels || this.props.labels.length === 0;

    // Handle empty data - still reserve space for sparklines
    if (!bars || !series || numSeries === 0) {
      return { width: 0, height: 0 };
    }

    if (numEntries === 0) {
      // Empty data but series defined - reserve minimum space
      if (orientation === 'vertical' && isSparkline) {
        return { width: 0, height: numSeries };
      }
      return { width: 0, height: 0 };
    }

    this._calculateScale();
    const labelWidth = this._getLabelWidth();
    const valueWidth = this._getValueWidth();

    if (orientation === 'vertical') {
      if (isSparkline) {
        // Sparkline mode: each series is one row, entries are adjacent chars
        const width = labelWidth + numEntries + valueWidth;
        const height = numSeries;
        return { width, height };
      }

      // Traditional vertical bars: entries go left-to-right, bars go up
      const barsPerEntry = numSeries;
      const entryWidth = barsPerEntry * barWidth + (barsPerEntry > 1 ? (barsPerEntry - 1) : 0);
      const width = labelWidth + numEntries * entryWidth + (numEntries - 1) * gap + valueWidth;
      const height = 10; // Default height, will be constrained by container
      return { width, height };
    } else {
      // Horizontal: entries go top-to-bottom, bars go right
      const rowsPerEntry = numSeries;
      const height = numEntries * rowsPerEntry + (numEntries - 1) * gap;
      const barAreaWidth = 20; // Default bar area
      const width = labelWidth + barAreaWidth + valueWidth;
      return { width, height };
    }
  }

  render(
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    _context: ComponentRenderContext
  ): void {
    const { bars, series } = this.props;

    if (!bars || !series || bars.length === 0 || series.length === 0) {
      return;
    }

    this._calculateScale();
    this._barBounds.clear();
    this._elementBounds = bounds;  // Store for selection calculations
    this.setBounds(bounds);

    if (this._getOrientation() === 'vertical') {
      this._renderVertical(bounds, style, buffer);
    } else {
      this._renderHorizontal(bounds, style, buffer);
    }
  }

  private _renderHorizontal(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    const { bars, series, labels, showLabels, showValues } = this.props;
    const gap = this._getGap();
    const barWidth = this._getBarWidth();

    const labelWidth = this._getLabelWidth();
    const valueWidth = this._getValueWidth();
    const barAreaWidth = bounds.width - labelWidth - valueWidth;

    let y = bounds.y;

    for (let entryIdx = 0; entryIdx < bars.length; entryIdx++) {
      const entry = bars[entryIdx];
      if (!entry) continue;

      // Check if we have stacking
      const stackGroups = this._buildStackGroups();
      const isStacked = [...stackGroups.values()].some(g => g.length > 1);

      if (isStacked) {
        // Render stacked bars
        for (const [_stackId, seriesIndices] of stackGroups) {
          let stackSum = 0;
          for (const sIdx of seriesIndices) {
            stackSum += entry[sIdx] ?? 0;
          }

          // Draw label on first row
          if (showLabels && seriesIndices[0] === 0) {
            this._renderText(buffer, bounds.x, y, labels?.[entryIdx] ?? '', style, labelWidth - 1);
          }

          // Draw stacked segments with proper bg colors for seamless stacking
          let barX = bounds.x + labelWidth;
          for (let i = 0; i < seriesIndices.length; i++) {
            const sIdx = seriesIndices[i];
            const value = entry[sIdx] ?? 0;
            if (value <= 0) continue;

            const eighths = this._valueToEighths(value, barAreaWidth);
            const seriesColor = this._getSeriesColor(sIdx);
            // Get next segment's color for background (fills gap in partial blocks)
            const nextIdx = i + 1 < seriesIndices.length ? seriesIndices[i + 1] : -1;
            const nextColor = nextIdx >= 0 ? this._getSeriesColor(nextIdx) : undefined;
            const barStyle = {
              ...style,
              foreground: seriesColor,
              background: nextColor ?? style.background,
            };
            // BW mode with multiple series: use pattern instead of fractional chars
            const bwPattern = this._getBwPattern(sIdx);
            // Render thick bars (multiple rows)
            let drawn = 0;
            for (let row = 0; row < barWidth; row++) {
              drawn = this._renderHorizontalBar(buffer, barX, y + row, eighths, barStyle, bwPattern);
            }

            this._barBounds.set(`${entryIdx}-${sIdx}`, {
              x: barX, y, width: Math.max(1, Math.ceil(eighths / 8)), height: barWidth
            });

            barX += drawn;
          }

          // Draw value
          if (showValues) {
            const valueX = bounds.x + labelWidth + barAreaWidth + 1;
            this._renderText(buffer, valueX, y, this._formatValue(entry, seriesIndices[0]), style);
          }

          y += barWidth;
        }
      } else {
        // Render grouped bars (one per series)
        const useLedStyle = this._getBarStyle() === 'led' && !this._hasStacking() && !this._isBwMode();

        for (let sIdx = 0; sIdx < series.length; sIdx++) {
          const value = entry[sIdx] ?? 0;

          // Draw label on first series row
          if (showLabels && sIdx === 0) {
            this._renderText(buffer, bounds.x, y, labels?.[entryIdx] ?? '', style, labelWidth - 1);
          }

          // Draw bar
          const barX = bounds.x + labelWidth;

          if (useLedStyle) {
            // LED style rendering
            const drawn = this._renderLedBar(buffer, barX, y, value, barAreaWidth, style, true);
            this._barBounds.set(`${entryIdx}-${sIdx}`, {
              x: barX, y, width: Math.max(1, drawn), height: barWidth
            });
          } else {
            // Solid style rendering
            const eighths = this._valueToEighths(value, barAreaWidth);
            const seriesColor = this._getSeriesColor(sIdx);
            const barStyle = seriesColor ? { ...style, foreground: seriesColor } : style;
            // BW mode with multiple series: use pattern instead of fractional chars
            const bwPattern = this._getBwPattern(sIdx);
            // Render thick bars (multiple rows)
            for (let row = 0; row < barWidth; row++) {
              this._renderHorizontalBar(buffer, barX, y + row, eighths, barStyle, bwPattern);
            }

            this._barBounds.set(`${entryIdx}-${sIdx}`, {
              x: barX, y, width: Math.max(1, Math.ceil(eighths / 8)), height: barWidth
            });
          }

          // Draw value
          if (showValues) {
            const valueX = bounds.x + labelWidth + barAreaWidth + 1;
            this._renderText(buffer, valueX, y, this._formatValue(entry, sIdx), style);
          }

          y += barWidth;
        }
      }

      y += gap;
      if (y >= bounds.y + bounds.height) break;
    }
  }

  private _renderVertical(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    const { bars, series, labels, showLabels, showValues } = this.props;
    const gap = this._getGap();
    const barWidth = this._getBarWidth();

    const isSparkline = !labels || labels.length === 0;
    const labelWidth = this._getLabelWidth();
    const valueWidth = this._getValueWidth();

    if (isSparkline) {
      // Sparkline mode: series on rows, entries as adjacent chars
      this._renderSparklines(bounds, style, buffer);
      return;
    }

    // Traditional vertical bars
    const barAreaHeight = bounds.height - 2; // Reserve for labels and values
    const baseY = bounds.y + bounds.height - 2; // Bottom of bar area

    let x = bounds.x + labelWidth;

    for (let entryIdx = 0; entryIdx < bars.length; entryIdx++) {
      const entry = bars[entryIdx];
      if (!entry) continue;

      // Check if we have stacking
      const stackGroups = this._buildStackGroups();
      const isStacked = [...stackGroups.values()].some(g => g.length > 1);

      if (isStacked) {
        // Render stacked bars (stack vertically on top of each other)
        for (const [_stackId, seriesIndices] of stackGroups) {
          let currentBaseY = baseY;

          for (let i = 0; i < seriesIndices.length; i++) {
            const sIdx = seriesIndices[i];
            const value = entry[sIdx] ?? 0;
            if (value <= 0) continue;

            const eighths = this._valueToEighths(value, barAreaHeight);
            const seriesColor = this._getSeriesColor(sIdx);
            // Get next segment's color for background (fills gap in partial blocks)
            const nextIdx = i + 1 < seriesIndices.length ? seriesIndices[i + 1] : -1;
            const nextColor = nextIdx >= 0 ? this._getSeriesColor(nextIdx) : undefined;
            const barStyle = {
              ...style,
              foreground: seriesColor,
              background: nextColor ?? style.background,
            };
            // BW mode with multiple series: use pattern instead of fractional chars
            const bwPattern = this._getBwPattern(sIdx);

            // Render thick bars (multiple columns)
            let drawn = 0;
            for (let col = 0; col < barWidth; col++) {
              drawn = this._renderVerticalBar(buffer, x + col, currentBaseY, eighths, barStyle, bwPattern);
            }

            this._barBounds.set(`${entryIdx}-${sIdx}`, {
              x, y: currentBaseY - drawn, width: barWidth, height: drawn
            });

            // Move base up for next stacked segment (use actual drawn height to avoid gaps)
            currentBaseY -= drawn;
          }

          // Value on top (sum for stacked)
          if (showValues) {
            this._renderText(buffer, x, bounds.y, this._formatValue(entry, seriesIndices[0]), style);
          }

          x += barWidth;
        }
      } else {
        // Render grouped bars (one per series, side by side)
        const useLedStyle = this._getBarStyle() === 'led' && !this._hasStacking() && !this._isBwMode();

        for (let sIdx = 0; sIdx < series.length; sIdx++) {
          const value = entry[sIdx] ?? 0;

          if (useLedStyle) {
            // LED style rendering
            const drawn = this._renderLedBar(buffer, x, baseY, value, barAreaHeight, style, false);
            this._barBounds.set(`${entryIdx}-${sIdx}`, {
              x, y: baseY - drawn, width: barWidth, height: Math.max(1, drawn)
            });
          } else {
            // Solid style rendering
            const eighths = this._valueToEighths(value, barAreaHeight);
            const seriesColor = this._getSeriesColor(sIdx);
            const barStyle = seriesColor ? { ...style, foreground: seriesColor } : style;
            // BW mode with multiple series: use pattern instead of fractional chars
            const bwPattern = this._getBwPattern(sIdx);

            // Render thick bars (multiple columns)
            for (let col = 0; col < barWidth; col++) {
              this._renderVerticalBar(buffer, x + col, baseY, eighths, barStyle, bwPattern);
            }

            this._barBounds.set(`${entryIdx}-${sIdx}`, {
              x, y: baseY - Math.ceil(eighths / 8), width: barWidth, height: Math.max(1, Math.ceil(eighths / 8))
            });
          }

          // Value on top
          if (showValues && sIdx === 0) {
            this._renderText(buffer, x, bounds.y, String(Math.round(value)), style);
          }

          x += barWidth;
        }
      }

      // Label on bottom
      if (showLabels) {
        const labelY = bounds.y + bounds.height - 1;
        const labelX = x - series.length * barWidth;
        this._renderText(buffer, labelX, labelY, labels?.[entryIdx] ?? '', style);
      }

      x += gap;
      if (x >= bounds.x + bounds.width) break;
    }
  }

  private _renderSparklines(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    const { bars, series, showLabels, showValues } = this.props;

    const labelWidth = this._getLabelWidth();
    const valueWidth = this._getValueWidth();
    const barAreaWidth = bounds.width - labelWidth - valueWidth;

    // Each series gets one row
    for (let sIdx = 0; sIdx < series.length; sIdx++) {
      const y = bounds.y + sIdx;
      if (y >= bounds.y + bounds.height) break;

      // Get series color for this sparkline row
      const seriesColor = this._getSeriesColor(sIdx);
      const barStyle = seriesColor ? { ...style, foreground: seriesColor } : style;

      // Draw series name as label with colon
      if (showLabels) {
        const label = series[sIdx]?.name ?? '';
        this._renderText(buffer, bounds.x, y, label ? label + ':' : '', style, labelWidth);
      }

      // Draw sparkline chars
      let x = bounds.x + labelWidth;
      for (let entryIdx = 0; entryIdx < bars.length && x < bounds.x + labelWidth + barAreaWidth; entryIdx++) {
        const value = bars[entryIdx]?.[sIdx] ?? 0;
        const eighths = this._valueToEighths(value, 1); // 1 char height
        const char = eighths === 0 ? ' ' : V_BAR_CHARS[Math.min(8, eighths)];
        buffer.currentBuffer.setCell(x, y, { char, ...barStyle });

        this._barBounds.set(`${entryIdx}-${sIdx}`, { x, y, width: 1, height: 1 });
        x++;
      }

      // Draw value
      if (showValues) {
        const lastEntry = bars[bars.length - 1];
        const valueX = bounds.x + labelWidth + barAreaWidth + 1;
        this._renderText(buffer, valueX, y, this._formatValue(lastEntry ?? [], sIdx), style);
      }
    }
  }

  // ===== Click Handling =====

  handleClick(event: ClickEvent, _document: unknown): boolean {
    const { x, y } = event.position;
    const { selectable, onSelect } = this.props;

    for (const [key, b] of this._barBounds) {
      if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) {
        const [entryIdx, seriesIdx] = key.split('-').map(Number);

        if (selectable) {
          this._selectedBar = { entry: entryIdx, series: seriesIdx };
        }

        if (onSelect) {
          onSelect({
            type: 'select',
            entryIndex: entryIdx,
            seriesIndex: seriesIdx,
            value: this.props.bars[entryIdx]?.[seriesIdx],
            label: this.props.labels?.[entryIdx],
          });
        }

        return true;
      }
    }

    return false;
  }

  // ===== Text Selection =====

  /**
   * Check if this element supports text selection
   */
  isTextSelectable(): boolean {
    return true;
  }

  /**
   * Get the JSON representation of selected bars for clipboard
   * Output matches input format: { series, bars, labels } but only for selected entries
   * @param selectionBounds - Optional bounds of the visual selection relative to element
   */
  getSelectableText(selectionBounds?: SelectionBounds): string {
    const { bars, series, labels } = this.props;

    if (!bars || bars.length === 0 || !this._elementBounds) {
      return '';
    }

    const orientation = this._getOrientation();

    // Find which entry indices are within the selection bounds
    const selectedEntryIndices = new Set<number>();

    for (const [key, b] of this._barBounds) {
      const [entryIdx] = key.split('-').map(Number);

      // Convert bar bounds to be relative to element
      const relativeStartX = b.x - this._elementBounds.x;
      const relativeEndX = relativeStartX + b.width - 1;
      const relativeStartY = b.y - this._elementBounds.y;
      const relativeEndY = relativeStartY + b.height - 1;

      // Check if this bar overlaps with selection
      let overlaps = true;
      if (selectionBounds) {
        // For horizontal bars, primarily check Y overlap (entries are rows)
        // For vertical bars, primarily check X overlap (entries are columns)
        const xOverlaps = relativeStartX <= selectionBounds.endX && relativeEndX >= selectionBounds.startX;

        if (orientation === 'horizontal') {
          // Horizontal bars: must overlap in Y, X overlap is secondary
          const yOverlaps = selectionBounds.startY !== undefined && selectionBounds.endY !== undefined
            ? (relativeStartY <= selectionBounds.endY && relativeEndY >= selectionBounds.startY)
            : true;
          overlaps = xOverlaps && yOverlaps;
        } else {
          // Vertical bars: check X overlap
          overlaps = xOverlaps;
        }
      }

      if (overlaps) {
        selectedEntryIndices.add(entryIdx);
      }
    }

    if (selectedEntryIndices.size === 0) {
      return '';
    }

    // Sort entry indices for consistent output
    const sortedIndices = [...selectedEntryIndices].sort((a, b) => a - b);

    // Build output in same format as input: { series, bars, labels }
    const output: { series: DataBarSeries[]; bars: BarValue[][]; labels?: string[] } = {
      series: series.map(s => {
        const entry: DataBarSeries = { name: s.name };
        if (s.color) entry.color = s.color;
        if (s.stack) entry.stack = s.stack;
        return entry;
      }),
      bars: sortedIndices.map(idx => bars[idx] ?? []),
    };

    // Include labels if present
    if (labels && labels.length > 0) {
      output.labels = sortedIndices.map(idx => labels[idx] ?? '');
    }

    return JSON.stringify(output, null, 2);
  }

  /**
   * Get aligned selection highlight bounds that snap to bar boundaries
   */
  getSelectionHighlightBounds(startX: number, endX: number, startY?: number, endY?: number): { startX: number; endX: number; startY?: number; endY?: number } | undefined {
    if (this._barBounds.size === 0 || !this._elementBounds) {
      return undefined;
    }

    const orientation = this._getOrientation();

    // Find the bar edges within the selection
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let hasOverlap = false;

    for (const [_key, b] of this._barBounds) {
      // Convert to relative coordinates
      const relativeStartX = b.x - this._elementBounds.x;
      const relativeEndX = relativeStartX + b.width - 1;
      const relativeStartY = b.y - this._elementBounds.y;
      const relativeEndY = relativeStartY + b.height - 1;

      // Check X overlap
      const xOverlaps = relativeStartX <= endX && relativeEndX >= startX;

      if (orientation === 'horizontal') {
        // Horizontal bars: must overlap in both X and Y
        const yOverlaps = startY !== undefined && endY !== undefined
          ? (relativeStartY <= endY && relativeEndY >= startY)
          : true;

        if (xOverlaps && yOverlaps) {
          hasOverlap = true;
          minX = Math.min(minX, relativeStartX);
          maxX = Math.max(maxX, relativeEndX);
          minY = Math.min(minY, relativeStartY);
          maxY = Math.max(maxY, relativeEndY);
        }
      } else {
        // Vertical bars: check X overlap only
        if (xOverlaps) {
          hasOverlap = true;
          minX = Math.min(minX, relativeStartX);
          maxX = Math.max(maxX, relativeEndX);
        }
      }
    }

    if (!hasOverlap) {
      return undefined;
    }

    // For horizontal bars, return Y bounds; for vertical bars, return X bounds only
    if (orientation === 'horizontal') {
      return { startX: minX, endX: maxX, startY: minY, endY: maxY };
    }
    return { startX: minX, endX: maxX };
  }

  // ===== Getters and Setters =====

  getValue(): DataBarsData {
    return this.props.bars;
  }

  setValue(bars: DataBarsData): void {
    this.props.bars = bars;
    this._invalidateScale();
  }

  getLabels(): string[] | undefined {
    return this.props.labels;
  }

  setLabels(labels: string[]): void {
    this.props.labels = labels;
  }

  getSeries(): DataBarSeries[] {
    return this.props.series;
  }

  setSeries(series: DataBarSeries[]): void {
    this.props.series = series;
    this._invalidateScale();
  }

  appendEntry(values: BarValue[], label?: string): void {
    this.props.bars.push(values);
    if (label !== undefined && this.props.labels) {
      this.props.labels.push(label);
    }
    this._invalidateScale();
  }

  shiftEntry(): void {
    this.props.bars.shift();
    if (this.props.labels) {
      this.props.labels.shift();
    }
    this._invalidateScale();
  }

  private _invalidateScale(): void {
    this._minValue = 0;
    this._maxValue = 0;
    this._scale = 1;
  }
}

// ===== Component Schema =====

export const dataBarsSchema: ComponentSchema = {
  description: 'Data-driven bar chart with stacking and sparkline support. Supports inline JSON content.',
  props: {
    series: { type: 'array', description: 'Series definitions (required unless in content JSON)' },
    bars: { type: 'array', description: 'Bar data as 2D array: bars[entry][series]' },
    labels: { type: 'array', description: 'Category labels array (optional)' },
    showLabels: { type: 'boolean', description: 'Show labels (default: true)' },
    showValues: { type: 'boolean', description: 'Show values (default: false)' },
    valueFormat: { type: 'string', enum: ['value', 'sum', 'last/max', 'percent'], description: 'Value format (auto-detects)' },
    showLegend: { type: 'boolean', description: 'Show series legend (default: false)' },
    showAxis: { type: 'boolean', description: 'Show value axis (default: true)' },
    min: { type: 'number', description: 'Minimum scale value' },
    max: { type: 'number', description: 'Maximum scale value' },
    selectable: { type: 'boolean', description: 'Enable bar selection (default: false)' },
    onHover: { type: 'handler', description: 'Hover event handler' },
    onSelect: { type: 'handler', description: 'Selection event handler' },
  },
  styles: {
    orientation: { type: 'string', enum: ['horizontal', 'vertical'], description: 'Bar direction (default: horizontal)' },
    barWidth: { type: 'number', description: 'Bar thickness in characters (default: 1)' },
    gap: { type: 'number', description: 'Gap between entries (default: 1)' },
    barStyle: { type: 'string', enum: ['solid', 'led'], description: 'Bar style (default: solid, led for single/grouped series)' },
    ledWidth: { type: 'number', description: 'LED segment width in characters (default: 3 horizontal, 1 vertical)' },
    highValue: { type: 'number', description: 'LED threshold percentage for warning color (default: 80)' },
    ledColorLow: { type: 'string', description: 'LED color below threshold (default: yellow)' },
    ledColorHigh: { type: 'string', description: 'LED color at/above threshold (default: red)' },
  },
};

registerComponentSchema('data-bars', dataBarsSchema);

registerComponent({
  type: 'data-bars',
  componentClass: DataBarsElement,
  defaultProps,
});
