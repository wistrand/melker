// Data-driven table component for simple, fast tabular data rendering

import {
  Element,
  BaseProps,
  Renderable,
  Focusable,
  Clickable,
  Interactive,
  Draggable,
  Wheelable,
  IntrinsicSizeContext,
  Bounds,
  ComponentRenderContext,
  BorderStyle,
  BORDER_CHARS,
  ClickEvent,
} from '../types.ts';
import type { KeyPressEvent } from '../events.ts';
import { type DualBuffer, type Cell, EMPTY_CHAR } from '../buffer.ts';
import type { DataTableTooltipContext, TooltipProvider } from '../tooltip/types.ts';
import { ViewportDualBuffer, createClipViewport } from '../viewport-buffer.ts';
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';
import { getThemeColor } from '../theme.ts';
import { getLogger } from '../logging.ts';
import { renderScrollbar } from './scrollbar.ts';

const logger = getLogger('DataTable');

// Type definitions
export type CellValue = string | number | boolean | null | undefined;
export type DataTableRows = CellValue[][];
export type DataTableFooter = CellValue[][];
export type DataTableSortDirection = 'asc' | 'desc';

export interface DataTableColumn {
  header: string;
  width?: number | `${number}%` | 'fill';
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  comparator?: (a: CellValue, b: CellValue) => number;
}

export interface DataTableSortEvent {
  type: 'sort';
  columnIndex: number;
  direction: DataTableSortDirection;
}

export interface DataTableSelectEvent {
  type: 'select';
  rowIndex: number;
  selectedRows: number[];
  action: 'replace' | 'add' | 'toggle';
}

export interface DataTableActivateEvent {
  type: 'activate';
  rowIndex: number;
  row: CellValue[];
}

export interface DataTableProps extends Omit<BaseProps, 'onChange'> {
  columns: DataTableColumn[];
  rows: DataTableRows;
  footer?: DataTableFooter;

  // Display
  rowHeight?: number;
  showHeader?: boolean;
  showFooter?: boolean;
  showColumnBorders?: boolean;
  border?: BorderStyle;

  // Scrolling
  scrollable?: boolean;
  maxHeight?: number;
  scrollY?: number;

  // Sorting
  sortColumn?: number;
  sortDirection?: DataTableSortDirection;
  onSort?: (event: DataTableSortEvent) => void;

  // Selection
  selectable?: 'none' | 'single' | 'multi';
  selectedRows?: number[];
  onChange?: (event: DataTableSelectEvent) => void;  // Preferred for selection changes
  onSelect?: (event: DataTableSelectEvent) => void;  // Deprecated: use onChange
  onActivate?: (event: DataTableActivateEvent) => void;
}

/**
 * Default comparator - auto-detect numeric vs string
 */
function defaultComparator(a: CellValue, b: CellValue): number {
  // Handle nullish values
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  // Convert to strings for comparison
  const strA = String(a);
  const strB = String(b);

  // Try numeric comparison
  const numA = parseFloat(strA.replace(/[,$%]/g, ''));
  const numB = parseFloat(strB.replace(/[,$%]/g, ''));

  if (!isNaN(numA) && !isNaN(numB)) {
    return numA - numB;
  }

  // Fall back to string comparison
  return strA.toLowerCase().localeCompare(strB.toLowerCase());
}

export class DataTableElement extends Element implements Renderable, Focusable, Clickable, Interactive, Draggable, Wheelable, TooltipProvider {
  declare type: 'data-table';
  declare props: DataTableProps;

  // Scroll state
  private _scrollY: number = 0;
  private _totalContentLines: number = 0;
  private _viewportLines: number = 0;

  // Selection state (stores original row indices)
  private _selectedRows: Set<number> = new Set();
  private _focusedSortedIndex: number = 0;

  // Sorting state - maps sorted position to original index
  private _sortedIndices: number[] | null = null;
  private _sortCacheKey: string = '';

  // Hit testing bounds
  private _headerCellBounds: Array<{ colIndex: number; bounds: Bounds }> = [];
  private _rowBounds: Map<number, Bounds> = new Map();
  private _scrollbarBounds: Bounds | null = null;
  private _bodyBounds: Bounds | null = null;

  // Scrollbar drag state
  private _dragStartY: number = 0;
  private _dragStartScrollY: number = 0;

  // Double-click detection
  private _lastClickTime: number = 0;
  private _lastClickSortedPos: number = -1;
  private static readonly DOUBLE_CLICK_THRESHOLD_MS = 400;

  // Cached calculations
  private _columnWidths: number[] = [];

  constructor(props: DataTableProps = { columns: [], rows: [] }, children: Element[] = []) {
    const defaultProps: DataTableProps = {
      rowHeight: 1,
      showHeader: true,
      showFooter: true,
      showColumnBorders: false,
      border: 'thin',
      selectable: 'none',
      ...props,
    };
    super('data-table', defaultProps, children);

    // Parse inline JSON data from children (text content)
    this._parseInlineData();

    // Initialize selection from props
    if (props.selectedRows) {
      this._selectedRows = new Set(props.selectedRows);
    }
  }

  // Parse JSON data from element's text content
  private _parseInlineData(): void {
    // Check for text content in children
    if (!this.children || this.children.length === 0) return;

    // Look for text child with JSON content
    for (const child of this.children) {
      if (child.type === 'text') {
        const text = (child.props.text || '').trim();
        if (text.startsWith('{')) {
          try {
            const data = JSON.parse(text);
            // Merge parsed data into props
            if (data.columns && Array.isArray(data.columns)) {
              this.props.columns = data.columns;
            }
            if (data.rows && Array.isArray(data.rows)) {
              this.props.rows = data.rows;
            }
            if (data.footer && Array.isArray(data.footer)) {
              this.props.footer = data.footer;
            }
            // Clear children since we consumed the JSON
            this.children = [];
            return;
          } catch (e) {
            logger.error('Failed to parse inline JSON data', e instanceof Error ? e : new Error(String(e)), {
              id: this.id,
              preview: text.substring(0, 100),
            });
          }
        }
      }
    }
  }

  // Focusable interface
  canReceiveFocus(): boolean {
    return this.props.selectable !== 'none';
  }

  // Interactive interface
  isInteractive(): boolean {
    return !this.props.disabled;
  }

  // Tell engine to route keyboard events directly to onKeyPress
  handlesOwnKeyboard(): boolean {
    return this.props.selectable !== 'none';
  }

  // Returns array of original indices in sorted order
  private _getSortedIndices(): number[] {
    const { rows, columns, sortColumn, sortDirection } = this.props;

    // Guard against undefined rows
    if (!rows || !Array.isArray(rows)) {
      return [];
    }

    if (sortColumn === undefined || !sortDirection) {
      // No sorting - return identity mapping
      return rows.map((_, i) => i);
    }

    // Cache check
    const cacheKey = `${sortColumn}:${sortDirection}:${rows.length}`;
    if (this._sortCacheKey === cacheKey && this._sortedIndices) {
      return this._sortedIndices;
    }

    // Get comparator
    const column = columns[sortColumn];
    const comparator = column?.comparator || defaultComparator;

    // Create index array and sort by comparing row values
    const indices = rows.map((_, i) => i);
    indices.sort((a, b) => {
      const aVal = rows[a][sortColumn];
      const bVal = rows[b][sortColumn];
      const result = comparator(aVal, bVal);
      return sortDirection === 'desc' ? -result : result;
    });

    this._sortedIndices = indices;
    this._sortCacheKey = cacheKey;
    return indices;
  }

  // Convert sorted position to original row index
  private _getOriginalIndex(sortedPos: number): number {
    const indices = this._getSortedIndices();
    return indices[sortedPos] ?? sortedPos;
  }

  // Calculate column widths
  private _calculateColumnWidths(availableWidth: number): number[] {
    const { columns, showColumnBorders } = this.props;
    if (!columns || !Array.isArray(columns) || columns.length === 0) return [];

    // Border/separator count: left border + separators between columns + right border
    // With column borders: | col1 | col2 | col3 | = columns.length + 1 vertical lines
    // Without column borders: | col1 col2 col3 | = 2 borders + (columns.length - 1) spaces = columns.length + 1
    const borderWidth = columns.length + 1;
    const contentWidth = Math.max(0, availableWidth - borderWidth);

    let remainingWidth = contentWidth;
    let fillCount = 0;
    const widths: number[] = [];

    // Pass 1: Calculate fixed and percentage widths
    for (const col of columns) {
      if (typeof col.width === 'number') {
        widths.push(col.width);
        remainingWidth -= col.width;
      } else if (typeof col.width === 'string' && col.width.endsWith('%')) {
        const pct = parseFloat(col.width) / 100;
        const w = Math.floor(contentWidth * pct);
        widths.push(w);
        remainingWidth -= w;
      } else {
        widths.push(-1); // Mark as fill
        fillCount++;
      }
    }

    // Pass 2: Distribute remaining to fill columns
    if (fillCount > 0) {
      const fillWidth = Math.max(1, Math.floor(remainingWidth / fillCount));
      for (let i = 0; i < widths.length; i++) {
        if (widths[i] === -1) {
          widths[i] = fillWidth;
        }
      }
    }

    return widths;
  }

  // Format cell value to string
  private _formatValue(value: CellValue): string {
    if (value == null) return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }

  // Truncate text with ellipsis
  private _truncate(text: string, width: number): string {
    if (text.length <= width) return text;
    if (width <= 3) return text.slice(0, width);
    return text.slice(0, width - 3) + '...';
  }

  // Align text within width
  private _align(text: string, width: number, align: 'left' | 'center' | 'right'): string {
    const padding = Math.max(0, width - text.length);
    if (padding === 0) return text.slice(0, width);

    switch (align) {
      case 'right':
        return ' '.repeat(padding) + text;
      case 'center': {
        const leftPad = Math.floor(padding / 2);
        const rightPad = padding - leftPad;
        return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
      }
      default:
        return text + ' '.repeat(padding);
    }
  }

  // Word wrap text for multi-line cells
  private _wrapText(text: string, width: number): string[] {
    if (width <= 0) return [''];
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if (currentLine.length === 0) {
        currentLine = word;
      } else if (currentLine.length + 1 + word.length <= width) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [''];
  }

  // Draw horizontal border
  private _drawHorizontalBorder(
    buffer: DualBuffer,
    x: number,
    y: number,
    position: 'top' | 'middle' | 'bottom',
    style: Partial<Cell>,
    totalWidth: number
  ): void {
    const borderStyle = this.props.border || 'thin';
    if (borderStyle === 'none') return;

    const chars = BORDER_CHARS[borderStyle];
    const { showColumnBorders } = this.props;

    // Determine corner/junction characters
    let leftChar: string, middleChar: string, rightChar: string;
    switch (position) {
      case 'top':
        leftChar = chars.tl;
        middleChar = chars.tm;
        rightChar = chars.tr;
        break;
      case 'middle':
        leftChar = chars.lm;
        middleChar = chars.mm;
        rightChar = chars.rm;
        break;
      case 'bottom':
        leftChar = chars.bl;
        middleChar = chars.bm;
        rightChar = chars.br;
        break;
    }

    // Draw left corner
    buffer.currentBuffer.setCell(x, y, { char: leftChar, ...style });

    let cellX = x + 1;
    for (let i = 0; i < this._columnWidths.length; i++) {
      const colWidth = this._columnWidths[i];

      // Draw horizontal line for column
      buffer.currentBuffer.setText(cellX, y, chars.h.repeat(colWidth), style);
      cellX += colWidth;

      // Draw junction or separator
      if (i < this._columnWidths.length - 1) {
        buffer.currentBuffer.setCell(cellX, y, {
          char: showColumnBorders ? middleChar : chars.h,
          ...style,
        });
        cellX++;
      }
    }

    // Fill remaining space before right corner (for scrollbar area)
    const remainingH = x + totalWidth - 1 - cellX;
    if (remainingH > 0) {
      buffer.currentBuffer.setText(cellX, y, chars.h.repeat(remainingH), style);
    }

    // Draw right corner
    buffer.currentBuffer.setCell(x + totalWidth - 1, y, { char: rightChar, ...style });
  }

  // Draw scrollbar
  private _drawScrollbar(
    buffer: DualBuffer,
    x: number,
    y: number,
    height: number,
    style: Partial<Cell>
  ): void {
    if (height <= 0 || this._totalContentLines <= this._viewportLines) return;

    // Store bounds for hit testing
    this._scrollbarBounds = { x, y, width: 1, height };

    renderScrollbar(buffer, x, y, height, {
      scrollTop: this._scrollY,
      totalItems: this._totalContentLines,
      visibleItems: this._viewportLines,
      thumbStyle: style,
      trackStyle: style,
    });
  }

  // Render header row
  private _renderHeaderRow(
    buffer: DualBuffer,
    x: number,
    y: number,
    style: Partial<Cell>,
    totalWidth: number
  ): void {
    const { columns, showColumnBorders, sortColumn, sortDirection } = this.props;
    const borderStyle = this.props.border || 'thin';
    const chars = BORDER_CHARS[borderStyle !== 'none' ? borderStyle : 'thin'];

    this._headerCellBounds = [];

    // Draw left border
    buffer.currentBuffer.setCell(x, y, { char: chars.v, ...style });

    let cellX = x + 1;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const width = this._columnWidths[i];

      // Add sort indicator if sorted
      let headerText = col.header;
      if (sortColumn === i) {
        headerText += sortDirection === 'asc' ? ' ^' : ' v';
      }

      const displayText = this._truncate(headerText, width);
      const aligned = this._align(displayText, width, col.align || 'left');

      // Store bounds for click detection
      this._headerCellBounds.push({
        colIndex: i,
        bounds: { x: cellX, y, width, height: 1 },
      });

      // Render with bold style for headers
      const headerStyle = { ...style, bold: true };
      buffer.currentBuffer.setText(cellX, y, aligned.substring(0, width), headerStyle);

      cellX += width;

      // Column separator
      if (showColumnBorders) {
        buffer.currentBuffer.setCell(cellX, y, { char: chars.v, ...style });
        cellX++;
      } else if (i < columns.length - 1) {
        buffer.currentBuffer.setCell(cellX, y, { char: EMPTY_CHAR, ...style });
        cellX++;
      }
    }

    // Fill remaining space before right border (for scrollbar area)
    const remainingSpace = x + totalWidth - 1 - cellX;
    if (remainingSpace > 0) {
      buffer.currentBuffer.fillLine(cellX, y, remainingSpace, style);
    }

    // Draw right border
    buffer.currentBuffer.setCell(x + totalWidth - 1, y, { char: chars.v, ...style });
  }

  // Render data row
  private _renderDataRow(
    buffer: DualBuffer | ViewportDualBuffer,
    x: number,
    y: number,
    rowData: CellValue[],
    style: Partial<Cell>,
    totalWidth: number,  // Full row width for proper border placement
    scrollbarX: number = -1,  // X position where scrollbar will be drawn, -1 means no scrollbar
    borderStyleOverride?: Partial<Cell>  // Style for borders (without selection highlight)
  ): void {
    const { columns, rowHeight = 1, showColumnBorders } = this.props;
    const borderPropStyle = this.props.border || 'thin';
    const chars = BORDER_CHARS[borderPropStyle !== 'none' ? borderPropStyle : 'thin'];

    // Use borderStyleOverride for borders (to avoid selection highlight on borders)
    const borderCellStyle = borderStyleOverride || style;

    // Draw for each line of row height
    for (let line = 0; line < rowHeight; line++) {
      // Draw left border (without selection highlight)
      buffer.currentBuffer.setCell(x, y + line, { char: chars.v, ...borderCellStyle });

      let cellX = x + 1;
      for (let colIndex = 0; colIndex < columns.length; colIndex++) {
        const col = columns[colIndex];
        const width = this._columnWidths[colIndex];
        const value = rowData[colIndex];
        const text = this._formatValue(value);

        let displayText: string;
        if (rowHeight === 1) {
          displayText = this._truncate(text, width);
        } else {
          const lines = this._wrapText(text, width);
          displayText = lines[line] || '';
        }

        const aligned = this._align(displayText, width, col.align || 'left');
        buffer.currentBuffer.setText(cellX, y + line, aligned.substring(0, width), style);

        cellX += width;

        // Column separator
        if (showColumnBorders) {
          // Draw vertical line between columns (without selection highlight)
          buffer.currentBuffer.setCell(cellX, y + line, { char: chars.v, ...borderCellStyle });
          cellX++;
        } else if (colIndex < columns.length - 1) {
          // Add space between columns when no column borders (with content style)
          buffer.currentBuffer.setCell(cellX, y + line, { char: EMPTY_CHAR, ...style });
          cellX++;
        }
      }

      // Draw right border at scrollbar position (will be overwritten by scrollbar)
      // or at full width position if no scrollbar
      if (scrollbarX >= 0) {
        // Fill gap between content and scrollbar position (with content style)
        const gap = scrollbarX - cellX;
        if (gap > 0) {
          buffer.currentBuffer.fillLine(cellX, y + line, gap, style);
        }
        // Draw border at scrollbar position (will be overwritten) - use border style
        buffer.currentBuffer.setCell(scrollbarX, y + line, { char: chars.v, ...borderCellStyle });
      } else {
        // No scrollbar - fill gap and draw right border at full width
        const rightBorderX = x + totalWidth - 1;
        const gap = rightBorderX - cellX;
        if (gap > 0) {
          buffer.currentBuffer.fillLine(cellX, y + line, gap, style);
        }
        buffer.currentBuffer.setCell(rightBorderX, y + line, { char: chars.v, ...borderCellStyle });
      }
    }
  }

  // Render footer row
  private _renderFooterRow(
    buffer: DualBuffer,
    x: number,
    y: number,
    rowData: CellValue[],
    style: Partial<Cell>,
    totalWidth: number
  ): void {
    const { columns, showColumnBorders } = this.props;
    const borderStyle = this.props.border || 'thin';
    const chars = BORDER_CHARS[borderStyle !== 'none' ? borderStyle : 'thin'];

    // Draw left border
    buffer.currentBuffer.setCell(x, y, { char: chars.v, ...style });

    let cellX = x + 1;
    for (let colIndex = 0; colIndex < columns.length; colIndex++) {
      const col = columns[colIndex];
      const width = this._columnWidths[colIndex];
      const value = rowData[colIndex];
      const text = this._formatValue(value);
      const displayText = this._truncate(text, width);
      const aligned = this._align(displayText, width, col.align || 'left');

      // Render with bold style for footer
      const footerStyle = { ...style, bold: true };
      buffer.currentBuffer.setText(cellX, y, aligned.substring(0, width), footerStyle);

      cellX += width;

      // Column separator
      if (showColumnBorders) {
        buffer.currentBuffer.setCell(cellX, y, { char: chars.v, ...style });
        cellX++;
      } else if (colIndex < columns.length - 1) {
        buffer.currentBuffer.setCell(cellX, y, { char: EMPTY_CHAR, ...style });
        cellX++;
      }
    }

    // Fill remaining space before right border (for scrollbar area)
    const remainingFooter = x + totalWidth - 1 - cellX;
    if (remainingFooter > 0) {
      buffer.currentBuffer.fillLine(cellX, y, remainingFooter, style);
    }

    // Draw right border
    buffer.currentBuffer.setCell(x + totalWidth - 1, y, { char: chars.v, ...style });
  }

  // Ensure row is visible (scroll if needed)
  private _ensureRowVisible(sortedIndex: number): void {
    const { rowHeight = 1 } = this.props;
    const rowTop = sortedIndex * rowHeight;
    const rowBottom = rowTop + rowHeight;

    if (rowTop < this._scrollY) {
      this._scrollY = rowTop;
    } else if (rowBottom > this._scrollY + this._viewportLines) {
      this._scrollY = rowBottom - this._viewportLines;
    }

    // Clamp scroll
    const maxScroll = Math.max(0, this._totalContentLines - this._viewportLines);
    this._scrollY = Math.max(0, Math.min(this._scrollY, maxScroll));
  }

  // intrinsicSize implementation
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const { columns, rows, footer, rowHeight = 1, showHeader = true, showFooter = true, showColumnBorders } = this.props;

    // Guard against undefined/empty data
    if (!columns || !Array.isArray(columns) || columns.length === 0) {
      return { width: 0, height: 0 };
    }
    const rowsArray = rows && Array.isArray(rows) ? rows : [];

    // Calculate width from columns (borders + separators = columns.length + 1)
    let width = columns.length + 1;
    for (const col of columns) {
      if (typeof col.width === 'number') {
        width += col.width;
      } else {
        width += 10; // default column width
      }
    }

    // Calculate height
    let height = 2; // top + bottom border
    if (showHeader) height += 2; // header + separator
    height += rowsArray.length * rowHeight;
    if (showFooter && footer?.length) {
      height += 1 + footer.length; // separator + footer rows
    }

    return { width, height };
  }

  // Main render method
  render(
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer | ViewportDualBuffer,
    context: ComponentRenderContext
  ): void {
    const {
      columns,
      rows,
      footer,
      rowHeight = 1,
      showHeader = true,
      showFooter = true,
    } = this.props;

    logger.debug(`render: columns=${JSON.stringify(columns)?.slice(0, 100)}, rows.length=${rows?.length}, bounds=${JSON.stringify(bounds)}`);

    if (!columns || columns.length === 0) {
      logger.warn('data-table: no columns provided');
      return;
    }
    if (!rows) {
      logger.warn('data-table: no rows provided');
      return;
    }

    const sortedIndices = this._getSortedIndices();

    // Store bounds
    this.setBounds(bounds);

    // Workaround for terminal edge rendering glitch:
    // When table extends to the exact right edge of the terminal, some terminals
    // have issues with characters in the last column (autowrap, cursor positioning).
    // Reduce width by 1 when at the terminal edge to avoid visual artifacts.
    const engine = globalThis.melkerEngine;
    const atTerminalEdge = engine && bounds.x + bounds.width >= engine.terminalSize?.width;
    const effectiveWidth = atTerminalEdge ? bounds.width - 1 : bounds.width;

    const headerHeight = showHeader ? 2 : 0; // header row + separator
    const footerHeight = showFooter && footer?.length ? 1 + footer.length : 0; // separator + rows
    const bodyHeight = Math.max(0, bounds.height - headerHeight - footerHeight - 2); // -2 for top/bottom borders

    // Scroll calculations
    this._totalContentLines = rows.length * rowHeight;
    this._viewportLines = bodyHeight;

    // Calculate column widths - account for scrollbar if needed
    const needsScrollbar = this._totalContentLines > this._viewportLines;
    const availableWidth = needsScrollbar ? effectiveWidth - 1 : effectiveWidth;
    this._columnWidths = this._calculateColumnWidths(availableWidth);
    const totalWidth = effectiveWidth;

    const maxScroll = Math.max(0, this._totalContentLines - this._viewportLines);
    this._scrollY = Math.max(0, Math.min(this._scrollY, maxScroll));

    // Sync selection from props if controlled
    if (this.props.selectedRows) {
      this._selectedRows = new Set(this.props.selectedRows);
    }

    let y = bounds.y;

    // Draw top border
    this._drawHorizontalBorder(buffer as DualBuffer, bounds.x, y, 'top', style, totalWidth);
    y++;

    // Render header
    if (showHeader) {
      this._renderHeaderRow(buffer as DualBuffer, bounds.x, y, style, totalWidth);
      y++;
      this._drawHorizontalBorder(buffer as DualBuffer, bounds.x, y, 'middle', style, totalWidth);
      y++;
    }

    // Render body with clipping
    const bodyStartY = y;
    this._bodyBounds = { x: bounds.x, y: bodyStartY, width: effectiveWidth, height: bodyHeight };

    // Use clipped buffer if not already clipped - include scrollbar column so border can be drawn there
    const clipBounds = { x: bounds.x, y: bodyStartY, width: effectiveWidth, height: bodyHeight };
    const clippedBuffer = buffer instanceof ViewportDualBuffer
      ? buffer
      : new ViewportDualBuffer(buffer as DualBuffer, createClipViewport(clipBounds));

    this._rowBounds.clear();
    let virtualY = bodyStartY - this._scrollY;

    for (let sortedPos = 0; sortedPos < sortedIndices.length; sortedPos++) {
      // Skip if completely out of view
      if (virtualY + rowHeight <= bodyStartY) {
        virtualY += rowHeight;
        continue;
      }
      if (virtualY >= bodyStartY + bodyHeight) break;

      const originalIndex = sortedIndices[sortedPos];
      const rowData = rows[originalIndex];
      const isSelected = this._selectedRows.has(originalIndex);
      const isFocused = sortedPos === this._focusedSortedIndex && context.focusedElementId === this.id;

      let rowStyle = style;
      let borderStyle: Partial<Cell> | undefined;
      if (isSelected || isFocused) {
        rowStyle = { ...style, reverse: true };
        borderStyle = style;  // Pass base style for borders (no highlight)
      }

      const scrollbarX = needsScrollbar ? bounds.x + effectiveWidth - 1 : -1;
      this._renderDataRow(clippedBuffer, bounds.x, virtualY, rowData, rowStyle, effectiveWidth, scrollbarX, borderStyle);
      this._rowBounds.set(sortedPos, { x: bounds.x, y: virtualY, width: effectiveWidth, height: rowHeight });

      virtualY += rowHeight;
    }

    // Draw vertical borders for empty space below data rows
    const borderPropStyle = this.props.border || 'thin';
    const borderChars = BORDER_CHARS[borderPropStyle !== 'none' ? borderPropStyle : 'thin'];
    const rightBorderX = bounds.x + effectiveWidth - 1;
    for (let emptyY = virtualY; emptyY < bodyStartY + bodyHeight; emptyY++) {
      buffer.currentBuffer.setCell(bounds.x, emptyY, { char: borderChars.v, ...style });
      buffer.currentBuffer.setCell(rightBorderX, emptyY, { char: borderChars.v, ...style });
    }

    y = bodyStartY + bodyHeight;

    // Draw scrollbar if needed
    if (needsScrollbar) {
      this._drawScrollbar(buffer as DualBuffer, bounds.x + effectiveWidth - 1, bodyStartY, bodyHeight, style);
    }

    // Render footer
    if (showFooter && footer?.length) {
      this._drawHorizontalBorder(buffer as DualBuffer, bounds.x, y, 'middle', style, totalWidth);
      y++;
      for (const footerRow of footer) {
        this._renderFooterRow(buffer as DualBuffer, bounds.x, y, footerRow, style, totalWidth);
        y++;
      }
    }

    // Draw bottom border
    this._drawHorizontalBorder(buffer as DualBuffer, bounds.x, y, 'bottom', style, totalWidth);
  }

  // Selection management
  selectRowAtPosition(sortedPos: number, mode: 'replace' | 'add' | 'toggle'): void {
    const { selectable = 'none' } = this.props;
    if (selectable === 'none') return;

    const originalIndex = this._getOriginalIndex(sortedPos);

    if (mode === 'replace' || selectable === 'single') {
      this._selectedRows.clear();
      this._selectedRows.add(originalIndex);
    } else if (mode === 'add') {
      this._selectedRows.add(originalIndex);
    } else if (mode === 'toggle') {
      if (this._selectedRows.has(originalIndex)) {
        this._selectedRows.delete(originalIndex);
      } else {
        this._selectedRows.add(originalIndex);
      }
    }

    // Fire event with original indices
    const selectEvent: DataTableSelectEvent = {
      type: 'select',
      rowIndex: originalIndex,
      selectedRows: [...this._selectedRows],
      action: mode,
    };
    this.props.onChange?.(selectEvent);
    this.props.onSelect?.(selectEvent);
  }

  // Keyboard handling - called by engine for focused element
  onKeyPress(event: KeyPressEvent): boolean {
    const { selectable = 'none', rows, rowHeight = 1 } = this.props;
    if (selectable === 'none' || rows.length === 0) return false;

    const sortedIndices = this._getSortedIndices();

    switch (event.key) {
      case 'ArrowUp':
        if (this._focusedSortedIndex > 0) {
          this._focusedSortedIndex--;
          if (selectable === 'single') {
            this.selectRowAtPosition(this._focusedSortedIndex, 'replace');
          }
          this._ensureRowVisible(this._focusedSortedIndex);
        }
        return true;

      case 'ArrowDown':
        if (this._focusedSortedIndex < sortedIndices.length - 1) {
          this._focusedSortedIndex++;
          if (selectable === 'single') {
            this.selectRowAtPosition(this._focusedSortedIndex, 'replace');
          }
          this._ensureRowVisible(this._focusedSortedIndex);
        }
        return true;

      case 'PageUp': {
        const pageSize = Math.max(1, Math.floor(this._viewportLines / rowHeight));
        this._focusedSortedIndex = Math.max(0, this._focusedSortedIndex - pageSize);
        if (selectable === 'single') {
          this.selectRowAtPosition(this._focusedSortedIndex, 'replace');
        }
        this._ensureRowVisible(this._focusedSortedIndex);
        return true;
      }

      case 'PageDown': {
        const pageSize = Math.max(1, Math.floor(this._viewportLines / rowHeight));
        this._focusedSortedIndex = Math.min(sortedIndices.length - 1, this._focusedSortedIndex + pageSize);
        if (selectable === 'single') {
          this.selectRowAtPosition(this._focusedSortedIndex, 'replace');
        }
        this._ensureRowVisible(this._focusedSortedIndex);
        return true;
      }

      case 'Home':
        this._focusedSortedIndex = 0;
        if (selectable === 'single') {
          this.selectRowAtPosition(this._focusedSortedIndex, 'replace');
        }
        this._ensureRowVisible(this._focusedSortedIndex);
        return true;

      case 'End':
        this._focusedSortedIndex = sortedIndices.length - 1;
        if (selectable === 'single') {
          this.selectRowAtPosition(this._focusedSortedIndex, 'replace');
        }
        this._ensureRowVisible(this._focusedSortedIndex);
        return true;

      case ' ': // Space - toggle in multi mode
        if (selectable === 'multi') {
          this.selectRowAtPosition(this._focusedSortedIndex, 'toggle');
        }
        return true;

      case 'Enter': {
        // Activate row
        const originalIndex = this._getOriginalIndex(this._focusedSortedIndex);
        this.props.onActivate?.({
          type: 'activate',
          rowIndex: originalIndex,
          row: this.props.rows[originalIndex] || [],
        });
        return true;
      }
    }

    return false;
  }

  // Click handling
  handleClick(event: ClickEvent, _document: unknown): boolean {
    const { x, y } = event.position;
    const { selectable = 'none', columns, showHeader = true } = this.props;

    // Check header clicks for sorting
    if (showHeader) {
      for (const { colIndex, bounds } of this._headerCellBounds) {
        if (
          x >= bounds.x &&
          x < bounds.x + bounds.width &&
          y >= bounds.y &&
          y < bounds.y + bounds.height
        ) {
          const col = columns[colIndex];
          if (col.sortable !== false) {
            this._handleSortClick(colIndex);
            return true;
          }
        }
      }
    }

    // Check row clicks for selection and double-click activation
    const currentTime = Date.now();
    for (const [sortedPos, bounds] of this._rowBounds) {
      if (
        x >= bounds.x &&
        x < bounds.x + bounds.width &&
        y >= bounds.y &&
        y < bounds.y + bounds.height
      ) {
        // Check for double-click
        const timeSinceLastClick = currentTime - this._lastClickTime;
        const isDoubleClick = (
          this._lastClickSortedPos === sortedPos &&
          timeSinceLastClick < DataTableElement.DOUBLE_CLICK_THRESHOLD_MS
        );

        if (isDoubleClick) {
          // Double-click: activate the row
          const originalIndex = this._getOriginalIndex(sortedPos);
          this.props.onActivate?.({
            type: 'activate',
            rowIndex: originalIndex,
            row: this.props.rows[originalIndex] || [],
          });
          // Reset double-click tracking
          this._lastClickTime = 0;
          this._lastClickSortedPos = -1;
        } else {
          // Single click: select the row (if selectable)
          if (selectable !== 'none') {
            this._focusedSortedIndex = sortedPos;
            this.selectRowAtPosition(sortedPos, selectable === 'single' ? 'replace' : 'toggle');
          }
          // Track for potential double-click
          this._lastClickTime = currentTime;
          this._lastClickSortedPos = sortedPos;
        }
        return true;
      }
    }

    // Check scrollbar clicks
    if (this._scrollbarBounds) {
      const sb = this._scrollbarBounds;
      if (x >= sb.x && x < sb.x + sb.width && y >= sb.y && y < sb.y + sb.height) {
        // Click on scrollbar - jump to position
        const clickRatio = (y - sb.y) / sb.height;
        const maxScroll = this._totalContentLines - this._viewportLines;
        this._scrollY = Math.floor(clickRatio * maxScroll);
        return true;
      }
    }

    return false;
  }

  private _handleSortClick(columnIndex: number): void {
    const { sortColumn, sortDirection } = this.props;

    let newDirection: DataTableSortDirection;
    if (sortColumn === columnIndex) {
      // Toggle direction
      newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      // New column, start with asc
      newDirection = 'asc';
    }

    // Update props directly (works without external handler)
    this.props.sortColumn = columnIndex;
    this.props.sortDirection = newDirection;

    // Invalidate cache
    this._sortCacheKey = '';
    this._sortedIndices = null;

    // Fire event for external listeners (optional)
    this.props.onSort?.({
      type: 'sort',
      columnIndex,
      direction: newDirection,
    });
  }

  // Wheel handling
  canHandleWheel(x: number, y: number): boolean {
    if (!this._bodyBounds) return false;
    const b = this._bodyBounds;
    return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
  }

  handleWheel(deltaX: number, deltaY: number): boolean {
    if (this._totalContentLines <= this._viewportLines) return false;

    const maxScroll = this._totalContentLines - this._viewportLines;
    const oldScroll = this._scrollY;

    this._scrollY = Math.max(0, Math.min(maxScroll, this._scrollY + deltaY));

    return this._scrollY !== oldScroll;
  }

  // Drag handling (for scrollbar)
  getDragZone(x: number, y: number): string | null {
    if (!this._scrollbarBounds) return null;
    const sb = this._scrollbarBounds;
    if (x >= sb.x && x < sb.x + sb.width && y >= sb.y && y < sb.y + sb.height) {
      return 'scrollbar';
    }
    return null;
  }

  handleDragStart(zone: string, x: number, y: number): void {
    if (zone === 'scrollbar') {
      this._dragStartY = y;
      this._dragStartScrollY = this._scrollY;
    }
  }

  handleDragMove(zone: string, x: number, y: number): void {
    if (zone === 'scrollbar' && this._scrollbarBounds) {
      const deltaY = y - this._dragStartY;
      const scrollRange = this._totalContentLines - this._viewportLines;
      const pixelRatio = scrollRange / this._scrollbarBounds.height;

      this._scrollY = Math.max(
        0,
        Math.min(scrollRange, this._dragStartScrollY + deltaY * pixelRatio)
      );
    }
  }

  handleDragEnd(zone: string, x: number, y: number): void {
    // Nothing to clean up
  }

  // Get selected rows (original indices)
  getSelectedRows(): number[] {
    return [...this._selectedRows];
  }

  // Clear selection
  clearSelection(): void {
    this._selectedRows.clear();
  }

  // Scroll to row
  scrollToRow(originalIndex: number): void {
    const sortedIndices = this._getSortedIndices();
    const sortedPos = sortedIndices.indexOf(originalIndex);
    if (sortedPos >= 0) {
      this._ensureRowVisible(sortedPos);
    }
  }

  /**
   * Get tooltip context for a position within the component.
   * Returns row/column/cell information for dynamic tooltips.
   */
  getTooltipContext(relX: number, relY: number): DataTableTooltipContext | undefined {
    const bounds = this.getBounds();
    if (!bounds) return undefined;

    const screenX = bounds.x + relX;
    const screenY = bounds.y + relY;

    // Check if over a header cell
    for (const { colIndex, bounds: cellBounds } of this._headerCellBounds) {
      if (
        screenX >= cellBounds.x &&
        screenX < cellBounds.x + cellBounds.width &&
        screenY >= cellBounds.y &&
        screenY < cellBounds.y + cellBounds.height
      ) {
        const col = this.props.columns[colIndex];
        return {
          type: 'data-table',
          row: -1, // -1 indicates header row
          column: colIndex,
          columnHeader: col?.header || `Column ${colIndex}`,
          cellValue: col?.header || '',
        };
      }
    }

    // Check if over a data row
    for (const [sortedPos, rowBounds] of this._rowBounds) {
      if (
        screenX >= rowBounds.x &&
        screenX < rowBounds.x + rowBounds.width &&
        screenY >= rowBounds.y &&
        screenY < rowBounds.y + rowBounds.height
      ) {
        const originalIndex = this._getOriginalIndex(sortedPos);
        const row = this.props.rows[originalIndex];
        if (!row) continue;

        // Determine which column based on cumulative widths
        let colIndex = 0;
        let cumX = rowBounds.x;
        for (let i = 0; i < this._columnWidths.length; i++) {
          const colWidth = this._columnWidths[i];
          if (screenX >= cumX && screenX < cumX + colWidth) {
            colIndex = i;
            break;
          }
          cumX += colWidth;
        }

        const col = this.props.columns[colIndex];
        const cellValue = row[colIndex];
        const cellStr = cellValue !== undefined && cellValue !== null ? String(cellValue) : '';

        return {
          type: 'data-table',
          row: originalIndex,
          column: colIndex,
          columnHeader: col?.header || `Column ${colIndex}`,
          cellValue: cellStr,
        };
      }
    }

    return undefined;
  }

  /**
   * Get default tooltip content for auto tooltips.
   */
  getDefaultTooltip(context: DataTableTooltipContext): string | undefined {
    if (context.type !== 'data-table') return undefined;
    const { row, columnHeader, cellValue } = context;
    if (row === -1) {
      // Header row
      return `**${columnHeader}**\nClick to sort`;
    }
    return `**${columnHeader}**\n${cellValue}`;
  }

  /**
   * Get the table rows (standard API)
   */
  getValue(): DataTableRows {
    return this.props.rows;
  }

  /**
   * Set the table rows (standard API)
   */
  setValue(rows: DataTableRows): void {
    this.props.rows = rows;
    // Invalidate sort cache when data changes
    this._sortCacheKey = '';
    this._sortedIndices = null;
  }
}

// Component schema for lint validation
export const dataTableSchema: ComponentSchema = {
  description: 'Data-driven table with sorting, selection, and scrolling',
  props: {
    columns: { type: 'array', required: true, description: 'Column definitions array' },
    rows: { type: 'array', required: true, description: 'Row data as 2D array' },
    footer: { type: 'array', description: 'Footer rows as 2D array' },
    rowHeight: { type: 'number', description: 'Row height in lines (default: 1)' },
    showHeader: { type: 'boolean', description: 'Show header row (default: true)' },
    showFooter: { type: 'boolean', description: 'Show footer rows (default: true)' },
    showColumnBorders: { type: 'boolean', description: 'Show column separators (default: false)' },
    border: {
      type: 'string',
      enum: ['none', 'thin', 'thick', 'double', 'rounded', 'dashed', 'dashed-rounded', 'ascii', 'ascii-rounded'],
      description: 'Border style (default: thin)',
    },
    sortColumn: { type: 'number', description: 'Column index to sort by' },
    sortDirection: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
    onSort: { type: 'handler', description: 'Sort change handler' },
    selectable: { type: 'string', enum: ['none', 'single', 'multi'], description: 'Selection mode (default: none)' },
    selectedRows: { type: 'array', description: 'Selected row indices (controlled)' },
    onChange: { type: 'handler', description: 'Selection change handler (preferred)' },
    onSelect: { type: 'handler', description: 'Selection change handler (deprecated: use onChange)' },
    onActivate: { type: 'handler', description: 'Row activation handler (Enter/double-click)' },
  },
};

registerComponentSchema('data-table', dataTableSchema);

// Register component
registerComponent({
  type: 'data-table',
  componentClass: DataTableElement,
  defaultProps: {
    rowHeight: 1,
    showHeader: true,
    showFooter: true,
    showColumnBorders: false,
    border: 'thin',
    selectable: 'none',
  },
});
