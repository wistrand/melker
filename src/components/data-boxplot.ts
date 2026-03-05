// Data-driven box-and-whisker plot component for terminal UIs
// Displays statistical distribution: median, quartiles, whiskers, outliers

import {
  Element,
  type BaseProps,
  type Renderable,
  type Focusable,
  type Clickable,
  type Interactive,
  type TextSelectable,
  type SelectableTextProvider,
  type SelectionBounds,
  type IntrinsicSizeContext,
  type Bounds,
  type ComponentRenderContext,
  type ClickEvent,
} from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import type { TooltipProvider, TooltipContext } from '../tooltip/types.ts';
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';
import { getLogger } from '../logging.ts';
import { getBorderChars } from '../types.ts';
import { getThemeColor } from '../theme.ts';
import { parseJsonProps, parseInlineJsonData, boundsContain, isBwMode } from './utils/component-utils.ts';
import { getUnicodeTier } from '../utils/terminal-detection.ts';

const logger = getLogger('DataBoxplot');

// ===== Type Definitions =====

export interface BoxplotStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers?: number[];
}

export interface BoxplotGroup {
  label: string;
  values?: number[];
  stats?: BoxplotStats;
}

export interface DataBoxplotTooltipContext extends TooltipContext {
  type: 'data-boxplot';
  groupIndex: number;
  label: string;
  stats: BoxplotStats;
  outlierValue?: number;
}

export interface BoxplotSelectEvent {
  type: 'select';
  groupIndex: number;
  label: string;
  stats: BoxplotStats;
}

export interface DataBoxplotProps extends BaseProps {
  groups: BoxplotGroup[];
  title?: string;
  yAxisLabel?: string;
  showOutliers?: boolean;
  whiskerRule?: 'iqr' | 'minmax';
  selectable?: boolean;
  onSelect?: (event: BoxplotSelectEvent) => void;
}

// ===== Box-drawing characters =====
// Reuse predefined BorderChars (handles unicode tier fallback automatically)

const _bc = getBorderChars('thin');
const _whiskerDot = getUnicodeTier() !== 'ascii' ? '·' : '.';
const _outlierChar = '*';

// ===== Default Props =====

const defaultProps: Partial<DataBoxplotProps> = {
  showOutliers: true,
  whiskerRule: 'iqr',
};

// ===== Statistics =====

function computeStats(values: number[], whiskerRule: 'iqr' | 'minmax'): BoxplotStats {
  if (values.length === 0) {
    return { min: 0, q1: 0, median: 0, q3: 0, max: 0, outliers: [] };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const median = percentile(sorted, 0.5);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);

  if (whiskerRule === 'minmax') {
    return { min: sorted[0], q1, median, q3, max: sorted[n - 1], outliers: [] };
  }

  // IQR rule: whiskers extend to last value within 1.5*IQR
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;

  let wMin = sorted[0];
  for (let i = 0; i < n; i++) {
    if (sorted[i] >= lowerFence) { wMin = sorted[i]; break; }
  }

  let wMax = sorted[n - 1];
  for (let i = n - 1; i >= 0; i--) {
    if (sorted[i] <= upperFence) { wMax = sorted[i]; break; }
  }

  const outliers: number[] = [];
  for (const v of sorted) {
    if (v < lowerFence || v > upperFence) outliers.push(v);
  }

  return { min: wMin, q1, median, q3, max: wMax, outliers };
}

function percentile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ===== DataBoxplotElement Class =====

export class DataBoxplotElement extends Element implements Renderable, Focusable, Clickable, Interactive, TextSelectable, SelectableTextProvider, TooltipProvider {
  declare type: 'data-boxplot';
  declare props: DataBoxplotProps;

  private _groupBounds: Map<number, Bounds> = new Map();
  private _outlierPositions: Map<string, { groupIndex: number; value: number }> = new Map(); // "x,y" -> info
  private _computedStats: BoxplotStats[] = [];
  private _selectedGroups: Set<number> = new Set();
  private _plotTopRel = 0;   // plot area top relative to element bounds
  private _plotBotRel = 0;   // plot area bottom (exclusive) relative to element bounds

  constructor(props: DataBoxplotProps = { groups: [] }, children: Element[] = []) {
    super('data-boxplot', { ...defaultProps, ...props }, children);
    this._parseProps();
    this._parseInlineData();
  }

  private _parseProps(): void {
    parseJsonProps(this.props as unknown as Record<string, unknown>, ['groups'] as const);
  }

  private _parseInlineData(): void {
    if (!this.children || this.children.length === 0) return;

    const data = parseInlineJsonData(this.children);
    if (data) {
      if (data.groups && Array.isArray(data.groups)) {
        this.props.groups = data.groups as BoxplotGroup[];
      }
      if (data.title !== undefined) {
        this.props.title = data.title as string;
      }
      if (data.yAxisLabel !== undefined) {
        this.props.yAxisLabel = data.yAxisLabel as string;
      }
      this.children = [];
    }
  }

  canReceiveFocus(): boolean {
    return true;
  }

  isInteractive(): boolean {
    return !this.props.disabled;
  }

  // ===== Selection =====

  handleClick(event: ClickEvent, _document: unknown): boolean {
    const { x, y } = event.position;
    const { selectable, onSelect } = this.props;

    for (const [gi, b] of this._groupBounds) {
      if (boundsContain(x, y, b)) {
        if (selectable) {
          if (this._selectedGroups.has(gi) && this._selectedGroups.size === 1) {
            this._selectedGroups.clear();
          } else {
            this._selectedGroups.clear();
            this._selectedGroups.add(gi);
          }
        }

        if (onSelect) {
          this._ensureStats();
          const s = this._computedStats[gi];
          const group = this.props.groups[gi];
          if (s && group) {
            onSelect({
              type: 'select',
              groupIndex: gi,
              label: group.label,
              stats: s,
            });
          }
        }

        return true;
      }
    }

    // Click outside any group — clear selection
    if (selectable) {
      this._selectedGroups.clear();
    }

    return false;
  }

  // ===== Drag Selection =====

  getSelectedGroups(): Set<number> {
    return this._selectedGroups;
  }

  setSelectedGroups(indices: Set<number>): void {
    this._selectedGroups = indices;
  }

  // ===== Text Selection (copy support) =====

  isTextSelectable(): boolean {
    return true;
  }

  private _getSelectedIndices(selectionBounds?: SelectionBounds): number[] {
    const { groups } = this.props;
    if (!groups || groups.length === 0) return [];

    const bounds = this.getBounds();
    if (!bounds) return [];

    const indices = new Set<number>();
    for (const [gi, b] of this._groupBounds) {
      const relStartX = b.x - bounds.x;
      const relEndX = relStartX + b.width - 1;
      if (selectionBounds) {
        if (relStartX <= selectionBounds.endX && relEndX >= selectionBounds.startX) {
          indices.add(gi);
        }
      } else {
        indices.add(gi);
      }
    }
    return [...indices].sort((a, b) => a - b);
  }

  getSelectableText(selectionBounds?: SelectionBounds): string {
    const { groups } = this.props;
    if (!groups || groups.length === 0) return '';

    this._ensureStats();
    const sorted = this._getSelectedIndices(selectionBounds);
    if (sorted.length === 0) return '';

    const output = sorted.map(i => {
      const g = groups[i];
      const s = this._computedStats[i];
      const entry: Record<string, unknown> = { label: g.label };
      if (g.values) entry.values = g.values;
      if (s) entry.stats = { min: s.min, q1: s.q1, median: s.median, q3: s.q3, max: s.max };
      if (s?.outliers && s.outliers.length > 0) entry.outliers = s.outliers;
      return entry;
    });

    return JSON.stringify(output, null, 2);
  }

  getClipboardDescription(selectionBounds?: SelectionBounds): string | undefined {
    const { groups } = this.props;
    if (!groups || groups.length === 0) return undefined;

    const sorted = this._getSelectedIndices(selectionBounds);
    if (sorted.length === 0) return undefined;

    const labels = sorted.map(i => groups[i]?.label).filter(Boolean);
    return `${sorted.length} group${sorted.length !== 1 ? 's' : ''} (${labels.join(', ')})`;
  }

  getSelectionHighlightBounds(startX: number, endX: number, _startY?: number, _endY?: number): { startX: number; endX: number; startY?: number; endY?: number } | undefined {
    const bounds = this.getBounds();
    if (!bounds || this._groupBounds.size === 0) return undefined;

    let minX = Infinity;
    let maxX = -Infinity;
    let hasOverlap = false;

    for (const [_gi, b] of this._groupBounds) {
      const relStartX = b.x - bounds.x;
      const relEndX = relStartX + b.width - 1;

      if (relStartX <= endX && relEndX >= startX) {
        hasOverlap = true;
        minX = Math.min(minX, relStartX);
        maxX = Math.max(maxX, relEndX);
      }
    }

    if (!hasOverlap) return undefined;
    return { startX: minX, endX: maxX, startY: this._plotTopRel, endY: this._plotBotRel - 1 };
  }

  // ===== Compute Stats =====

  private _ensureStats(): void {
    const { groups, whiskerRule } = this.props;
    if (!groups || groups.length === 0) {
      this._computedStats = [];
      return;
    }

    this._computedStats = groups.map(g => {
      if (g.stats) return g.stats;
      if (g.values && g.values.length > 0) return computeStats(g.values, whiskerRule ?? 'iqr');
      return { min: 0, q1: 0, median: 0, q3: 0, max: 0, outliers: [] };
    });
  }

  // ===== Layout =====

  private _getYAxisWidth(): number {
    this._ensureStats();
    const stats = this._computedStats;
    if (stats.length === 0) return 4;

    let globalMin = Infinity;
    let globalMax = -Infinity;
    for (const s of stats) {
      const outliers = s.outliers ?? [];
      const allVals = [s.min, s.max, ...outliers];
      for (const v of allVals) {
        if (v < globalMin) globalMin = v;
        if (v > globalMax) globalMax = v;
      }
    }
    if (!isFinite(globalMin)) globalMin = 0;
    if (!isFinite(globalMax)) globalMax = 0;

    const maxLabelLen = Math.max(
      String(Math.round(globalMin)).length,
      String(Math.round(globalMax)).length,
    );
    return maxLabelLen + 2; // label + space + axis char
  }

  intrinsicSize(_context: IntrinsicSizeContext): { width: number; height: number } {
    const { groups, title } = this.props;
    if (!groups || groups.length === 0) return { width: 0, height: 0 };

    const yAxisWidth = this._getYAxisWidth();
    // Each boxplot is 3 cells wide + 1 gap
    const plotWidth = groups.length * 4 - 1;
    const titleRow = title ? 1 : 0;
    const labelRow = 2; // bottom axis line + labels

    const width = yAxisWidth + plotWidth + 1;
    const height = titleRow + 12 + labelRow; // default 12 rows for plot area

    return { width, height };
  }

  // ===== Rendering =====

  render(
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    _context: ComponentRenderContext
  ): void {
    const { groups, title, yAxisLabel, showOutliers } = this.props;

    if (!groups || groups.length === 0) return;

    this._ensureStats();
    this._groupBounds.clear();
    this._outlierPositions.clear();
    this.setBounds(bounds);

    const stats = this._computedStats;
    if (stats.length === 0) return;

    // Calculate global range including outliers
    let globalMin = Infinity;
    let globalMax = -Infinity;
    for (const s of stats) {
      if (s.min < globalMin) globalMin = s.min;
      if (s.max > globalMax) globalMax = s.max;
      if (showOutliers && s.outliers) {
        for (const o of s.outliers) {
          if (o < globalMin) globalMin = o;
          if (o > globalMax) globalMax = o;
        }
      }
    }
    if (!isFinite(globalMin)) globalMin = 0;
    if (!isFinite(globalMax)) globalMax = 100;
    if (globalMin === globalMax) { globalMin -= 1; globalMax += 1; }

    // Add 5% padding to range
    const rangePad = (globalMax - globalMin) * 0.05;
    globalMin = globalMin - rangePad;
    globalMax = globalMax + rangePad;

    // Layout regions
    const titleRow = title ? 1 : 0;
    const labelRow = 2; // bottom axis line + labels
    const yAxisWidth = this._getYAxisWidth();

    const plotTop = bounds.y + titleRow;
    const plotHeight = bounds.height - titleRow - labelRow;
    const plotLeft = bounds.x + yAxisWidth;
    const plotWidth = bounds.width - yAxisWidth;

    this._plotTopRel = titleRow;
    this._plotBotRel = titleRow + plotHeight; // exclusive (axis line row)

    if (plotHeight < 3) return; // too small to render

    const range = globalMax - globalMin;

    // Helper: map value to row (top = high values, bottom = low values)
    const valueToRow = (v: number): number => {
      const frac = (v - globalMin) / range;
      return plotTop + plotHeight - 1 - Math.round(frac * (plotHeight - 1));
    };

    // Draw title
    if (title) {
      const titleX = bounds.x + Math.max(0, Math.floor((bounds.width - title.length) / 2));
      buffer.currentBuffer.setText(titleX, bounds.y, title, { ...style, bold: true });
    }

    // Draw y-axis label (vertical text)
    if (yAxisLabel && plotHeight >= yAxisLabel.length) {
      const labelStartRow = plotTop + Math.floor((plotHeight - yAxisLabel.length) / 2);
      for (let i = 0; i < yAxisLabel.length; i++) {
        buffer.currentBuffer.setCell(bounds.x, labelStartRow + i, { char: yAxisLabel[i], ...style });
      }
    }

    // Draw y-axis with ticks (faded)
    const tickCount = Math.min(plotHeight, 6);
    const axisX = plotLeft - 1;
    const axisStyle = { ...style, foreground: getThemeColor('textMuted'), dim: false };
    for (let i = 0; i < plotHeight; i++) {
      buffer.currentBuffer.setCell(axisX, plotTop + i, { char: _bc.v, ...axisStyle });
    }

    for (let t = 0; t < tickCount; t++) {
      const frac = t / Math.max(1, tickCount - 1);
      const row = plotTop + Math.round(frac * (plotHeight - 1));
      const val = globalMax - frac * range;
      const label = String(Math.round(val));
      const labelX = axisX - label.length - 1;
      if (labelX >= bounds.x) {
        buffer.currentBuffer.setText(Math.max(bounds.x, labelX), row, label, axisStyle);
      }
      buffer.currentBuffer.setCell(axisX, row, { char: _bc.rm, ...axisStyle });
    }

    // Draw bottom axis line (faded)
    const axisY = plotTop + plotHeight;
    buffer.currentBuffer.setCell(axisX, axisY, { char: _bc.bl, ...axisStyle });
    for (let x = plotLeft; x < plotLeft + plotWidth && x < bounds.x + bounds.width; x++) {
      buffer.currentBuffer.setCell(x, axisY, { char: _bc.h, ...axisStyle });
    }

    // Draw each boxplot
    const colWidth = 3; // box is 3 chars wide
    const gap = 1;
    const stride = colWidth + gap;

    for (let gi = 0; gi < groups.length; gi++) {
      const s = stats[gi];
      const group = groups[gi];
      const cx = plotLeft + gi * stride; // left edge of this boxplot column

      if (cx + colWidth > bounds.x + bounds.width) break;

      // Map stats to rows
      const rowQ1 = valueToRow(s.q1);
      const rowQ3 = valueToRow(s.q3);
      const rowMedian = valueToRow(s.median);
      const rowMin = valueToRow(s.min);
      const rowMax = valueToRow(s.max);

      // Store group bounds for tooltip and click selection
      // Include label row (axisY + 1) so clicking a label selects the group
      this._groupBounds.set(gi, {
        x: cx, y: Math.min(rowMax, plotTop),
        width: colWidth,
        height: axisY + 2 - Math.min(rowMax, plotTop),
      });

      const bw = isBwMode();
      const selected = this._selectedGroups.has(gi);
      const gs: Partial<Cell> = selected ? { ...style, reverse: true } : style;

      // Draw box (Q1 to Q3)
      // Top of box (Q3 - higher value = lower row number)
      const boxTop = Math.min(rowQ1, rowQ3);
      const boxBot = Math.max(rowQ1, rowQ3);

      // Upper whisker
      if (rowMax < boxTop) {
        const whiskerLen = boxTop - rowMax;
        if (whiskerLen === 1) {
          // Single-row whisker: dot marker
          buffer.currentBuffer.setCell(cx + 1, rowMax, { char: _whiskerDot, ...gs });
        } else {
          // Multi-row whisker
          buffer.currentBuffer.setCell(cx + 1, rowMax, { char: _bc.tm, ...gs });
          for (let r = rowMax + 1; r < boxTop; r++) {
            buffer.currentBuffer.setCell(cx + 1, r, { char: _bc.v, ...gs });
          }
        }
        // Box top edge
        buffer.currentBuffer.setCell(cx, boxTop, { char: _bc.tl, ...gs });
        buffer.currentBuffer.setCell(cx + 1, boxTop, { char: _bc.bm, ...gs });
        buffer.currentBuffer.setCell(cx + 2, boxTop, { char: _bc.tr, ...gs });
      } else {
        // Zero-length or no upper whisker — flat top ┌─┐
        // No upper whisker - standard top
        buffer.currentBuffer.setCell(cx, boxTop, { char: _bc.tl, ...gs });
        buffer.currentBuffer.setCell(cx + 1, boxTop, { char: _bc.h, ...gs });
        buffer.currentBuffer.setCell(cx + 2, boxTop, { char: _bc.tr, ...gs });
      }

      // Box body
      for (let r = boxTop + 1; r < boxBot; r++) {
        if (r === rowMedian) {
          // Median line
          buffer.currentBuffer.setCell(cx, r, { char: _bc.lm, ...gs, bold: !bw });
          buffer.currentBuffer.setCell(cx + 1, r, { char: _bc.h, ...gs, bold: !bw });
          buffer.currentBuffer.setCell(cx + 2, r, { char: _bc.rm, ...gs, bold: !bw });
        } else {
          buffer.currentBuffer.setCell(cx, r, { char: _bc.v, ...gs });
          buffer.currentBuffer.setCell(cx + 2, r, { char: _bc.v, ...gs });
        }
      }

      // Degenerate: Q1 === Q3, single-row box — just a flat line
      if (boxTop === boxBot) {
        buffer.currentBuffer.setCell(cx, boxTop, { char: _bc.h, ...gs, bold: !bw });
        buffer.currentBuffer.setCell(cx + 1, boxTop, { char: _bc.h, ...gs, bold: !bw });
        buffer.currentBuffer.setCell(cx + 2, boxTop, { char: _bc.h, ...gs, bold: !bw });
      } else if (rowMedian === boxTop) {
        // Median at top edge — bold the top edge, preserve junction if whisker exists
        buffer.currentBuffer.setCell(cx, boxTop, { char: _bc.tl, ...gs, bold: !bw });
        buffer.currentBuffer.setCell(cx + 1, boxTop, {
          char: rowMax < boxTop ? _bc.bm : _bc.h, ...gs, bold: !bw,
        });
        buffer.currentBuffer.setCell(cx + 2, boxTop, { char: _bc.tr, ...gs, bold: !bw });
      }

      // Box bottom edge
      if (boxTop !== boxBot) {
        if (rowMin > boxBot) {
          // Lower whisker exists
          buffer.currentBuffer.setCell(cx, boxBot, { char: _bc.bl, ...gs });
          buffer.currentBuffer.setCell(cx + 1, boxBot, { char: _bc.tm, ...gs });
          buffer.currentBuffer.setCell(cx + 2, boxBot, { char: _bc.br, ...gs });
        } else {
          // Zero-length or no lower whisker — flat bottom └─┘
          buffer.currentBuffer.setCell(cx, boxBot, { char: _bc.bl, ...gs });
          buffer.currentBuffer.setCell(cx + 1, boxBot, { char: _bc.h, ...gs });
          buffer.currentBuffer.setCell(cx + 2, boxBot, { char: _bc.br, ...gs });
        }

        // Handle median at bottom edge — bold the bottom edge, preserve junction if whisker exists
        if (rowMedian === boxBot) {
          buffer.currentBuffer.setCell(cx, boxBot, { char: _bc.bl, ...gs, bold: !bw });
          buffer.currentBuffer.setCell(cx + 1, boxBot, {
            char: rowMin > boxBot ? _bc.tm : _bc.h, ...gs, bold: !bw,
          });
          buffer.currentBuffer.setCell(cx + 2, boxBot, { char: _bc.br, ...gs, bold: !bw });
        }
      }

      // Lower whisker
      if (rowMin > boxBot) {
        const whiskerLen = rowMin - boxBot;
        if (whiskerLen === 1) {
          buffer.currentBuffer.setCell(cx + 1, rowMin, { char: _whiskerDot, ...gs });
        } else {
          for (let r = boxBot + 1; r < rowMin; r++) {
            buffer.currentBuffer.setCell(cx + 1, r, { char: _bc.v, ...gs });
          }
          buffer.currentBuffer.setCell(cx + 1, rowMin, { char: _bc.bm, ...gs });
        }
      }

      // Outliers — skip any that overlap the box or whisker range
      if (showOutliers && s.outliers) {
        for (const o of s.outliers) {
          const oRow = valueToRow(o);
          if (oRow >= plotTop && oRow < plotTop + plotHeight && (oRow < rowMax || oRow > rowMin)) {
            buffer.currentBuffer.setCell(cx + 1, oRow, { char: _outlierChar, ...gs });
            this._outlierPositions.set(`${cx + 1},${oRow}`, { groupIndex: gi, value: o });
          }
        }
      }

      // Bottom label — truncate to column width so labels don't overlap
      const label = group.label || '';
      const truncated = label.length > colWidth ? label.substring(0, colWidth) : label;
      const labelX = cx + Math.max(0, Math.floor((colWidth - truncated.length) / 2));
      buffer.currentBuffer.setText(labelX, axisY + 1, truncated, selected ? gs : axisStyle);
    }
  }

  // ===== Getters/Setters =====

  getGroups(): BoxplotGroup[] {
    return this.props.groups;
  }

  setGroups(groups: BoxplotGroup[]): void {
    this.props.groups = groups;
    this._computedStats = [];
  }

  getStats(): BoxplotStats[] {
    this._ensureStats();
    return this._computedStats;
  }

  // ===== Tooltip =====

  getTooltipContext(relX: number, relY: number): DataBoxplotTooltipContext | undefined {
    const bounds = this.getBounds();
    if (!bounds) return undefined;

    const screenX = bounds.x + relX;
    const screenY = bounds.y + relY;

    // Check outlier positions first (exact cell match)
    const outlierKey = `${screenX},${screenY}`;
    const outlier = this._outlierPositions.get(outlierKey);
    if (outlier) {
      this._ensureStats();
      const s = this._computedStats[outlier.groupIndex];
      if (s) {
        return {
          type: 'data-boxplot',
          groupIndex: outlier.groupIndex,
          label: this.props.groups[outlier.groupIndex]?.label ?? `Group ${outlier.groupIndex}`,
          stats: s,
          outlierValue: outlier.value,
        };
      }
    }

    for (const [gi, b] of this._groupBounds) {
      if (boundsContain(screenX, screenY, b)) {
        this._ensureStats();
        const s = this._computedStats[gi];
        if (!s) continue;
        return {
          type: 'data-boxplot',
          groupIndex: gi,
          label: this.props.groups[gi]?.label ?? `Group ${gi}`,
          stats: s,
        };
      }
    }

    return undefined;
  }

  getDefaultTooltip(context: DataBoxplotTooltipContext): string | undefined {
    if (context.type !== 'data-boxplot') return undefined;
    const { label, stats: s, outlierValue } = context;

    if (outlierValue !== undefined) {
      return `**${label}** outlier: ${outlierValue.toFixed(1)}`;
    }

    const lines = [
      `**${label}**`,
      `Max: ${s.max.toFixed(1)}`,
      `Q3:  ${s.q3.toFixed(1)}`,
      `Med: ${s.median.toFixed(1)}`,
      `Q1:  ${s.q1.toFixed(1)}`,
      `Min: ${s.min.toFixed(1)}`,
    ];
    if (s.outliers && s.outliers.length > 0) {
      lines.push(`Outliers: ${s.outliers.map(o => o.toFixed(1)).join(', ')}`);
    }
    return lines.join('\n');
  }
}

// ===== Component Schema =====

export const dataBoxplotSchema: ComponentSchema = {
  description: 'Box-and-whisker plot for statistical distribution visualization. Supports inline JSON content.',
  props: {
    groups: { type: 'array', description: 'BoxplotGroup[] with label and values/stats' },
    title: { type: 'string', description: 'Chart title' },
    yAxisLabel: { type: 'string', description: 'Y-axis label (rendered vertically)' },
    showOutliers: { type: 'boolean', description: 'Show outlier markers (default: true)' },
    whiskerRule: { type: 'string', enum: ['iqr', 'minmax'], description: 'Whisker calculation rule (default: iqr)' },
    selectable: { type: 'boolean', description: 'Enable group selection (default: false)' },
    onSelect: { type: 'handler', description: 'Selection event handler' },
  },
};

registerComponentSchema('data-boxplot', dataBoxplotSchema);

registerComponent({
  type: 'data-boxplot',
  componentClass: DataBoxplotElement,
  defaultProps,
});
