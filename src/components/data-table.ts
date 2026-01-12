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
import type { KeyEvent } from '../events.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { ClippedDualBuffer } from '../clipped-buffer.ts';
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';
import { getThemeColor } from '../theme.ts';
import { getLogger } from '../logging.ts';

const logger = getLogger('DataTable');

// Type definitions
export type CellValue = string | number | boolean | null | undefined;
export type DataTableRows = CellValue[][];
export type DataTableFooter = CellValue[][];
export type SortDirection = 'asc' | 'desc';

export interface DataTableColumn {
  header: string;
  width?: number | `${number}%` | 'fill';
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  comparator?: (a: CellValue, b: CellValue) => number;
}

export interface SortEvent {
  type: 'sort';
  columnIndex: number;
  direction: SortDirection;
}

export interface SelectEvent {
  type: 'select';
  rowIndex: number;
  selectedRows: number[];
  action: 'replace' | 'add' | 'toggle';
}

export interface ActivateEvent {
  type: 'activate';
  rowIndex: number;
}

export interface DataTableProps extends BaseProps {
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
  sortDirection?: SortDirection;
  onSort?: (event: SortEvent) => void;

  // Selection
  selectable?: 'none' | 'single' | 'multi';
  selectedRows?: number[];
  onSelect?: (event: SelectEvent) => void;
  onActivate?: (event: ActivateEvent) => void;
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

export class DataTableElement extends Element implements Renderable, Focusable, Clickable, Interactive, Draggable, Wheelable {
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

    // Initialize selection from props
    if (props.selectedRows) {
      this._selectedRows = new Set(props.selectedRows);
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
      for (let j = 0; j < colWidth; j++) {
        buffer.currentBuffer.setCell(cellX + j, y, { char: chars.h, ...style });
      }
      cellX += colWidth;

      // Draw junction or right border
      if (i < this._columnWidths.length - 1) {
        buffer.currentBuffer.setCell(cellX, y, {
          char: showColumnBorders ? middleChar : chars.h,
          ...style,
        });
        cellX++;
      }
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

    // Calculate thumb size and position
    const thumbSize = Math.max(1, Math.floor((this._viewportLines / this._totalContentLines) * height));
    const maxScroll = this._totalContentLines - this._viewportLines;
    const scrollRatio = maxScroll > 0 ? this._scrollY / maxScroll : 0;
    const thumbPos = Math.floor(scrollRatio * (height - thumbSize));

    // Store bounds for hit testing
    this._scrollbarBounds = { x, y, width: 1, height };

    // Draw track and thumb
    for (let i = 0; i < height; i++) {
      const isThumb = i >= thumbPos && i < thumbPos + thumbSize;
      buffer.currentBuffer.setCell(x, y + i, {
        char: isThumb ? '█' : '░',
        ...style,
      });
    }
  }

  // Render header row
  private _renderHeaderRow(
    buffer: DualBuffer,
    x: number,
    y: number,
    style: Partial<Cell>
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
      for (let j = 0; j < aligned.length && j < width; j++) {
        buffer.currentBuffer.setCell(cellX + j, y, { char: aligned[j], ...headerStyle });
      }

      cellX += width;

      // Column separator
      if (showColumnBorders) {
        buffer.currentBuffer.setCell(cellX, y, { char: chars.v, ...style });
        cellX++;
      } else if (i < columns.length - 1) {
        buffer.currentBuffer.setCell(cellX, y, { char: ' ', ...style });
        cellX++;
      } else {
        buffer.currentBuffer.setCell(cellX, y, { char: chars.v, ...style });
        cellX++;
      }
    }
  }

  // Render data row
  private _renderDataRow(
    buffer: DualBuffer | ClippedDualBuffer,
    x: number,
    y: number,
    rowData: CellValue[],
    style: Partial<Cell>
  ): void {
    const { columns, rowHeight = 1, showColumnBorders } = this.props;
    const borderStyle = this.props.border || 'thin';
    const chars = BORDER_CHARS[borderStyle !== 'none' ? borderStyle : 'thin'];

    // Draw for each line of row height
    for (let line = 0; line < rowHeight; line++) {
      // Draw left border
      buffer.currentBuffer.setCell(x, y + line, { char: chars.v, ...style });

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

        for (let j = 0; j < aligned.length && j < width; j++) {
          buffer.currentBuffer.setCell(cellX + j, y + line, { char: aligned[j], ...style });
        }

        cellX += width;

        // Column separator
        if (showColumnBorders) {
          // Draw vertical line between columns
          buffer.currentBuffer.setCell(cellX, y + line, { char: chars.v, ...style });
          cellX++;
        } else if (colIndex < columns.length - 1) {
          // Add space between columns when no column borders
          buffer.currentBuffer.setCell(cellX, y + line, { char: ' ', ...style });
          cellX++;
        } else {
          // Last column - draw right border
          buffer.currentBuffer.setCell(cellX, y + line, { char: chars.v, ...style });
          cellX++;
        }
      }
    }
  }

  // Render footer row
  private _renderFooterRow(
    buffer: DualBuffer,
    x: number,
    y: number,
    rowData: CellValue[],
    style: Partial<Cell>
  ): void {
    // Footer renders same as data but with bold
    this._renderDataRow(buffer, x, y, rowData, { ...style, bold: true });
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
    buffer: DualBuffer | ClippedDualBuffer,
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

    // Calculate dimensions
    this._columnWidths = this._calculateColumnWidths(bounds.width);
    const totalWidth = bounds.width;

    const headerHeight = showHeader ? 2 : 0; // header row + separator
    const footerHeight = showFooter && footer?.length ? 1 + footer.length : 0; // separator + rows
    const bodyHeight = Math.max(0, bounds.height - headerHeight - footerHeight - 2); // -2 for top/bottom borders

    // Scroll calculations
    this._totalContentLines = rows.length * rowHeight;
    this._viewportLines = bodyHeight;
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
      this._renderHeaderRow(buffer as DualBuffer, bounds.x, y, style);
      y++;
      this._drawHorizontalBorder(buffer as DualBuffer, bounds.x, y, 'middle', style, totalWidth);
      y++;
    }

    // Render body with clipping
    const bodyStartY = y;
    this._bodyBounds = { x: bounds.x, y: bodyStartY, width: bounds.width, height: bodyHeight };

    // Use clipped buffer if not already clipped
    const clipBounds = { x: bounds.x, y: bodyStartY, width: bounds.width - 1, height: bodyHeight };
    const clippedBuffer = buffer instanceof ClippedDualBuffer
      ? buffer
      : new ClippedDualBuffer(buffer as DualBuffer, clipBounds);

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
      if (isSelected) {
        rowStyle = { ...style, reverse: true };
      } else if (isFocused) {
        rowStyle = { ...style, reverse: true };
      }

      this._renderDataRow(clippedBuffer, bounds.x, virtualY, rowData, rowStyle);
      this._rowBounds.set(sortedPos, { x: bounds.x, y: virtualY, width: bounds.width, height: rowHeight });

      virtualY += rowHeight;
    }

    y = bodyStartY + bodyHeight;

    // Draw scrollbar if needed
    if (this._totalContentLines > this._viewportLines) {
      this._drawScrollbar(buffer as DualBuffer, bounds.x + bounds.width - 1, bodyStartY, bodyHeight, style);
    }

    // Render footer
    if (showFooter && footer?.length) {
      this._drawHorizontalBorder(buffer as DualBuffer, bounds.x, y, 'middle', style, totalWidth);
      y++;
      for (const footerRow of footer) {
        this._renderFooterRow(buffer as DualBuffer, bounds.x, y, footerRow, style);
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
    this.props.onSelect?.({
      type: 'select',
      rowIndex: originalIndex,
      selectedRows: [...this._selectedRows],
      action: mode,
    });
  }

  // Keyboard handling
  handleKeyDown(event: KeyEvent): boolean {
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

      case 'Enter':
        // Activate row
        const originalIndex = this._getOriginalIndex(this._focusedSortedIndex);
        this.props.onActivate?.({
          type: 'activate',
          rowIndex: originalIndex,
        });
        return true;
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

    // Check row clicks for selection
    if (selectable !== 'none') {
      for (const [sortedPos, bounds] of this._rowBounds) {
        if (
          x >= bounds.x &&
          x < bounds.x + bounds.width &&
          y >= bounds.y &&
          y < bounds.y + bounds.height
        ) {
          this._focusedSortedIndex = sortedPos;
          this.selectRowAtPosition(sortedPos, selectable === 'single' ? 'replace' : 'toggle');
          return true;
        }
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

    let newDirection: SortDirection;
    if (sortColumn === columnIndex) {
      // Toggle direction
      newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      // New column, start with asc
      newDirection = 'asc';
    }

    // Invalidate cache
    this._sortCacheKey = '';
    this._sortedIndices = null;

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
    onSort: { type: ['function', 'string'], description: 'Sort change handler' },
    selectable: { type: 'string', enum: ['none', 'single', 'multi'], description: 'Selection mode (default: none)' },
    selectedRows: { type: 'array', description: 'Selected row indices (controlled)' },
    onSelect: { type: ['function', 'string'], description: 'Selection change handler' },
    onActivate: { type: ['function', 'string'], description: 'Row activation handler (Enter/double-click)' },
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
