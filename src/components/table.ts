// Table component implementation

import { Element, BaseProps, Renderable, Focusable, Clickable, Interactive, Draggable, Wheelable, IntrinsicSizeContext, Bounds, ComponentRenderContext, BorderStyle, BorderChars, BORDER_CHARS, ClickEvent, isRenderable, isClickable } from '../types.ts';
import type { KeyEvent } from '../events.ts';
import type { Document } from '../document.ts';
import type { DualBuffer, Cell, TerminalBuffer } from '../buffer.ts';
import { ClippedDualBuffer } from '../clipped-buffer.ts';
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';
import { TableSectionElement } from './table-section.ts';
import { TableRowElement } from './table-row.ts';
import { TableCellElement } from './table-cell.ts';
import { getThemeColor } from '../theme.ts';
import { getLogger } from '../logging.ts';

const logger = getLogger('Table');

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  column: number;
  direction: SortDirection;
}

export interface SortEvent {
  type: 'sort';
  column: number;
  direction: SortDirection;
  previousColumn: number | null;
  previousDirection: SortDirection | null;
}

/**
 * Default comparator for string values (case-insensitive)
 */
export function defaultStringComparator(a: string, b: string): number {
  return a.toLowerCase().localeCompare(b.toLowerCase());
}

/**
 * Default comparator for numeric values
 * Falls back to string comparison if values aren't numbers
 */
export function defaultNumericComparator(a: string, b: string): number {
  const numA = parseFloat(a.replace(/[,$%]/g, ''));
  const numB = parseFloat(b.replace(/[,$%]/g, ''));

  if (!isNaN(numA) && !isNaN(numB)) {
    return numA - numB;
  }
  return defaultStringComparator(a, b);
}

/**
 * Default comparator for date values
 * Supports common date formats, falls back to string comparison
 */
export function defaultDateComparator(a: string, b: string): number {
  const dateA = new Date(a);
  const dateB = new Date(b);

  if (!isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) {
    return dateA.getTime() - dateB.getTime();
  }
  return defaultStringComparator(a, b);
}

/**
 * Auto-detect comparator based on column values
 * Examines sample values to determine if numeric or date comparison is appropriate
 */
export function autoDetectComparator(values: string[]): (a: string, b: string) => number {
  // Filter out empty values
  const nonEmpty = values.filter(v => v.trim() !== '');
  if (nonEmpty.length === 0) return defaultStringComparator;

  // Check if all values are numeric
  const allNumeric = nonEmpty.every(v => {
    const cleaned = v.replace(/[,$%]/g, '');
    return !isNaN(parseFloat(cleaned));
  });
  if (allNumeric) return defaultNumericComparator;

  // Check if all values are valid dates
  const allDates = nonEmpty.every(v => {
    const d = new Date(v);
    return !isNaN(d.getTime());
  });
  if (allDates) return defaultDateComparator;

  return defaultStringComparator;
}

export interface ColumnResizeEvent {
  type: 'columnResize';
  column: number;
  oldWidth: number;
  newWidth: number;
  columnWidths: number[];
}

export interface TableProps extends BaseProps {
  border?: BorderStyle;
  columnBorders?: boolean;  // Whether to show internal column borders (default: true)
  cellPadding?: number;
  cellSpacing?: number;
  // Sorting props
  sortColumn?: number;
  sortDirection?: SortDirection;
  onSort?: (event: SortEvent) => void;
  // Column resize props
  resizable?: boolean;
  columnWidths?: number[];
  minColumnWidth?: number;
  onColumnResize?: (event: ColumnResizeEvent) => void;
}

export class TableElement extends Element implements Renderable, Focusable, Clickable, Interactive, Draggable, Wheelable {
  declare type: 'table';
  declare props: TableProps;

  // Calculated column widths (updated during render)
  private _columnWidths: number[] = [];

  // Track row bounds for click detection
  private _rowBounds: Map<string, Bounds> = new Map();

  // Track scrollbar bounds for click/drag
  private _scrollbarBounds: Bounds | null = null;

  // Track tbody bounds for wheel events
  private _tbodyBounds: Bounds | null = null;

  // Track cell component bounds for click delegation
  private _cellComponentBounds: Array<{ element: Element; bounds: Bounds }> = [];

  // Track header cell bounds for sort click detection
  private _headerCellBounds: Array<{ cell: TableCellElement; columnIndex: number; bounds: Bounds }> = [];

  // Double-click detection
  private _lastClickTime: number = 0;
  private _lastClickRowId: string | null = null;
  private static readonly DOUBLE_CLICK_THRESHOLD_MS = 400;

  // Track column border positions for resize drag zones (x position of each border after column i)
  private _columnBorderPositions: Array<{ columnIndex: number; x: number; y: number; height: number }> = [];

  // Resize drag state
  private _resizeDragState: {
    active: boolean;
    columnIndex: number;
    startX: number;
    startWidth: number;
  } | null = null;

  // User-specified column widths (overrides calculated widths)
  private _userColumnWidths: number[] | null = null;

  // Cached comparators per column (auto-detected or from th.onCompare)
  private _columnComparators: Map<number, (a: string, b: string) => number> = new Map();

  // Drag state for scrollbar
  private _dragStartY: number = 0;
  private _dragStartScrollY: number = 0;

  // Auto-scroll state (when table doesn't fit in available height)
  private _autoScrollEnabled: boolean = false;
  private _autoScrollMaxVisible: number = 0;

  // Line-based scroll metrics (set during render for wheel/drag handlers)
  private _totalContentLines: number = 0;
  private _viewportLines: number = 0;

  // Sorted rows cache - avoid re-sorting on every render
  private _cachedSortedRows: TableRowElement[] | null = null;
  private _sortCacheKey: string = '';

  // Content height cache - avoid recalculating row heights on every render
  private _cachedContentHeight: number = 0;
  private _contentHeightCacheKey: string = '';

  // Column widths cache - avoid iterating all rows on every render
  private _cachedColumnWidths: number[] = [];
  private _columnWidthsCacheKey: string = '';

  constructor(props: TableProps = {}, children: Element[] = []) {
    const defaultProps: TableProps = {
      border: 'thin',
      cellPadding: 1,
      cellSpacing: 0,
      ...props,
    };
    super('table', defaultProps, children);
  }

  /**
   * Focusable interface - table can receive focus when selectable
   */
  canReceiveFocus(): boolean {
    const tbody = this.getTbody();
    return tbody?.props.selectable !== 'none' && tbody?.props.selectable !== undefined;
  }

  /**
   * Handle keyboard events for navigation and selection
   */
  handleKeyDown(event: KeyEvent): boolean {
    const tbody = this.getTbody();
    if (!tbody || tbody.props.selectable === 'none') return false;

    const rows = tbody.getRows();
    if (rows.length === 0) return false;

    const focusedIndex = tbody.getFocusedRowIndex();
    const selectable = tbody.props.selectable || 'none';

    switch (event.key) {
      case 'ArrowUp':
        // Move focus/selection up
        if (focusedIndex > 0) {
          const newIndex = focusedIndex - 1;
          tbody.setFocusedRowIndex(newIndex);
          if (selectable === 'single') {
            const rowId = rows[newIndex].getDataId();
            if (rowId) tbody.selectRow(rowId, 'replace');
          }
          // Scroll to keep focused row visible
          this._ensureRowVisible(newIndex);
        }
        return true;

      case 'ArrowDown':
        // Move focus/selection down
        if (focusedIndex < rows.length - 1) {
          const newIndex = focusedIndex + 1;
          tbody.setFocusedRowIndex(newIndex);
          if (selectable === 'single') {
            const rowId = rows[newIndex].getDataId();
            if (rowId) tbody.selectRow(rowId, 'replace');
          }
          // Scroll to keep focused row visible
          this._ensureRowVisible(newIndex);
        }
        return true;

      case ' ': // Space
        // Toggle selection in multi mode
        if (selectable === 'multi') {
          const rowId = rows[focusedIndex]?.getDataId();
          if (rowId) tbody.selectRow(rowId, 'toggle');
        }
        return true;

      case 'Enter':
        // Select current row and fire event
        const rowId = rows[focusedIndex]?.getDataId();
        if (rowId) {
          tbody.selectRow(rowId, selectable === 'single' ? 'replace' : 'add');
        }
        return true;

      case 'Escape':
        // Clear selection
        tbody.clearSelection();
        return true;

      case 'Home':
        // Jump to first row
        tbody.setFocusedRowIndex(0);
        if (selectable === 'single') {
          const rowId = rows[0]?.getDataId();
          if (rowId) tbody.selectRow(rowId, 'replace');
        }
        this._ensureRowVisible(0);
        return true;

      case 'End':
        // Jump to last row
        const lastIndex = rows.length - 1;
        tbody.setFocusedRowIndex(lastIndex);
        if (selectable === 'single') {
          const rowId = rows[lastIndex]?.getDataId();
          if (rowId) tbody.selectRow(rowId, 'replace');
        }
        this._ensureRowVisible(lastIndex);
        return true;
    }

    return false;
  }

  /**
   * Handle click on a sortable header cell
   */
  private _handleSortClick(columnIndex: number, cell: TableCellElement): void {
    const currentColumn = this.props.sortColumn;
    const currentDirection = this.props.sortDirection;

    let newDirection: SortDirection;

    if (currentColumn === columnIndex) {
      // Toggle direction: asc -> desc -> asc
      newDirection = currentDirection === 'asc' ? 'desc' : 'asc';
    } else {
      // New column: start with ascending
      newDirection = 'asc';
    }

    // Cache comparator for this column if not already cached
    if (!this._columnComparators.has(columnIndex)) {
      const comparator = this._getComparatorForColumn(columnIndex, cell);
      this._columnComparators.set(columnIndex, comparator);
    }

    // Update props
    this.props.sortColumn = columnIndex;
    this.props.sortDirection = newDirection;

    // Fire event
    if (this.props.onSort) {
      this.props.onSort({
        type: 'sort',
        column: columnIndex,
        direction: newDirection,
        previousColumn: currentColumn ?? null,
        previousDirection: currentDirection ?? null,
      });
    }
  }

  /**
   * Get the comparator function for a column
   */
  private _getComparatorForColumn(columnIndex: number, headerCell: TableCellElement): (a: string, b: string) => number {
    // Use custom comparator if provided
    if (headerCell.props.onCompare) {
      return headerCell.props.onCompare;
    }

    // Auto-detect comparator based on column values
    const tbody = this.getTbody();
    if (!tbody) return defaultStringComparator;

    const values: string[] = [];
    for (const row of tbody.getRows()) {
      const cell = row.getCellAtIndex(columnIndex);
      if (cell) {
        values.push(cell.getTextContent());
      }
    }

    return autoDetectComparator(values);
  }

  /**
   * Get sorted tbody rows based on current sort state
   * Uses caching to avoid re-sorting on every render
   */
  private _getSortedRows(rows: TableRowElement[]): TableRowElement[] {
    const sortColumn = this.props.sortColumn;
    const sortDirection = this.props.sortDirection;

    if (sortColumn === undefined || sortDirection === undefined) {
      return rows;
    }

    // Build cache key from sort params and row boundaries
    // Uses count + first/last row IDs for fast change detection
    const firstRowId = rows.length > 0 ? (rows[0].getDataId() || rows[0].id || '') : '';
    const lastRowId = rows.length > 0 ? (rows[rows.length - 1].getDataId() || rows[rows.length - 1].id || '') : '';
    const cacheKey = `${sortColumn}:${sortDirection}:${rows.length}:${firstRowId}:${lastRowId}`;

    // Return cached result if still valid
    if (this._cachedSortedRows && this._sortCacheKey === cacheKey) {
      return this._cachedSortedRows;
    }

    // Get or create comparator for this column
    let comparator = this._columnComparators.get(sortColumn);
    if (!comparator) {
      // Try to get header cell for custom comparator
      const thead = this.getThead();
      const headerRow = thead?.getRows()[0];
      const headerCell = headerRow?.getCellAtIndex(sortColumn);
      comparator = headerCell ? this._getComparatorForColumn(sortColumn, headerCell) : defaultStringComparator;
      this._columnComparators.set(sortColumn, comparator);
    }

    // Create a sorted copy of rows
    const sorted = [...rows].sort((rowA, rowB) => {
      const cellA = rowA.getCellAtIndex(sortColumn);
      const cellB = rowB.getCellAtIndex(sortColumn);

      const valueA = cellA?.getTextContent() || '';
      const valueB = cellB?.getTextContent() || '';

      const result = comparator!(valueA, valueB);
      return sortDirection === 'asc' ? result : -result;
    });

    // Cache the result
    this._cachedSortedRows = sorted;
    this._sortCacheKey = cacheKey;

    return sorted;
  }

  /**
   * Check if table has sortable headers
   */
  hasSortableHeaders(): boolean {
    const thead = this.getThead();
    if (!thead) return false;

    for (const row of thead.getRows()) {
      for (const cell of row.getCells()) {
        if (cell.isHeader() && cell.props.sortable !== false) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if this table is interactive (has cell components, selectable rows, or scrollable)
   */
  isInteractive(): boolean {
    logger.debug(`Table.isInteractive: id=${this.id}, cellComponentBounds=${this._cellComponentBounds.length}`);
    // Check if any cells have interactive children (buttons, checkboxes, etc.)
    for (const row of this.getAllRows()) {
      for (const cell of row.getCells()) {
        if (cell.children && cell.children.length > 0) {
          for (const child of cell.children) {
            // Check for interactive components
            if (child.type === 'button' || child.type === 'checkbox' || child.type === 'radio' ||
                child.type === 'input' || typeof child.props.onClick === 'function') {
              return true;
            }
            // Check containers for nested interactive elements
            if (child.type === 'container' && child.children) {
              for (const nested of child.children) {
                if (nested.type === 'button' || nested.type === 'checkbox' || nested.type === 'radio' ||
                    nested.type === 'input' || typeof nested.props.onClick === 'function') {
                  return true;
                }
              }
            }
          }
        }
      }
    }

    const tbody = this.getTbody();
    const hasSelection = tbody?.props.selectable !== 'none' && tbody?.props.selectable !== undefined;
    const hasExplicitScrollbar = !!(tbody?.props.scrollable && (tbody.getRows().length > (tbody.props.maxHeight || 0)));
    const hasAutoScrollbar = this._autoScrollEnabled;
    const hasSortable = this.hasSortableHeaders();
    const hasResizable = this.props.resizable === true;
    // Also check if we have stored cell component bounds from rendering
    const hasCellComponents = this._cellComponentBounds.length > 0;
    return hasSelection || hasExplicitScrollbar || hasAutoScrollbar || hasSortable || hasResizable || hasCellComponents;
  }

  /**
   * Table should capture focus for all children when interactive.
   * This tells hit-testing to return the table instead of text elements inside cells,
   * allowing the table to handle clicks for sorting, row selection, etc.
   */
  capturesFocusForChildren(): boolean {
    return true;
  }

  /**
   * Handle click events on cell components, rows and scrollbar
   */
  handleClick(event: ClickEvent, document: Document): boolean {
    const clickX = event.position.x;
    const clickY = event.position.y;

    logger.debug(`Table.handleClick: click at (${clickX}, ${clickY}), cellComponentBounds=${this._cellComponentBounds.length}, headerCellBounds=${this._headerCellBounds.length}`);
    for (const { element, bounds } of this._cellComponentBounds) {
      logger.trace(`  - ${element.type}/${element.id}: (${bounds.x},${bounds.y}) ${bounds.width}x${bounds.height}`);
    }
    for (const { columnIndex, bounds } of this._headerCellBounds) {
      logger.trace(`  header column ${columnIndex}: (${bounds.x},${bounds.y}) ${bounds.width}x${bounds.height}`);
    }

    // First check if click is on a sortable header cell
    for (const { cell, columnIndex, bounds } of this._headerCellBounds) {
      if (cell.props.sortable !== false && // sortable by default or explicitly true
          clickX >= bounds.x && clickX < bounds.x + bounds.width &&
          clickY >= bounds.y && clickY < bounds.y + bounds.height) {
        this._handleSortClick(columnIndex, cell);
        return true;
      }
    }

    // Check if click is on a cell component (buttons, checkboxes, etc.)
    for (const { element, bounds } of this._cellComponentBounds) {
      if (clickX >= bounds.x && clickX < bounds.x + bounds.width &&
          clickY >= bounds.y && clickY < bounds.y + bounds.height) {
        // Delegate click to the component
        if (isClickable(element)) {
          const componentEvent: ClickEvent = {
            type: 'click',
            target: element,
            timestamp: event.timestamp,
            position: { x: clickX, y: clickY }
          };
          return element.handleClick(componentEvent, document);
        }
        // Also check for onClick handler
        if (typeof element.props.onClick === 'function') {
          element.props.onClick(event);
          return true;
        }
      }
    }

    const tbody = this.getTbody();
    if (!tbody) return false;

    // Check if click is on scrollbar (now uses line-based scrolling)
    if (this._scrollbarBounds) {
      const sb = this._scrollbarBounds;
      if (clickX >= sb.x && clickX < sb.x + sb.width &&
          clickY >= sb.y && clickY < sb.y + sb.height) {
        // Clicked on scrollbar - calculate scroll position in lines
        const maxScrollY = Math.max(0, this._totalContentLines - this._viewportLines);

        // Map click position to scroll position
        const relativeY = clickY - sb.y;
        const scrollRatio = relativeY / sb.height;
        const newScrollY = Math.round(scrollRatio * maxScrollY);

        tbody.props.scrollY = Math.max(0, Math.min(maxScrollY, newScrollY));
        return true;
      }
    }

    // Check if click is on a row (for selection)
    if (tbody.props.selectable === 'none') return false;

    const currentTime = Date.now();
    const rows = tbody.getRows();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowId = row.getDataId();
      if (!rowId) continue;

      const rowBounds = this._rowBounds.get(rowId);
      if (rowBounds && clickY >= rowBounds.y && clickY < rowBounds.y + rowBounds.height) {
        // Row was clicked
        logger.debug(`Table row clicked: index=${i}, rowId=${rowId}`);
        tbody.setFocusedRowIndex(i);

        // Check for double-click
        const timeSinceLastClick = currentTime - this._lastClickTime;
        const isDoubleClick = (
          this._lastClickRowId === rowId &&
          timeSinceLastClick < TableElement.DOUBLE_CLICK_THRESHOLD_MS
        );

        logger.info(`Table click: rowId=${rowId}, lastRowId=${this._lastClickRowId}, timeDiff=${timeSinceLastClick}ms, isDouble=${isDoubleClick}`);

        if (isDoubleClick) {
          // Double-click: activate the row
          logger.info(`Table row DOUBLE-CLICKED: rowId=${rowId}`);
          tbody.activateRow(rowId);
          // Reset double-click tracking
          this._lastClickTime = 0;
          this._lastClickRowId = null;
        } else {
          // Single click: select the row
          tbody.selectRow(rowId, 'replace');
          // Track for potential double-click
          this._lastClickTime = currentTime;
          this._lastClickRowId = rowId;
        }
        return true;
      }
    }

    return false;
  }

  /**
   * Draggable interface - check if position is in a drag zone
   */
  getDragZone(x: number, y: number): string | null {
    // Check column resize borders first (higher priority)
    if (this.props.resizable) {
      for (const border of this._columnBorderPositions) {
        // Allow 1 cell on either side of the border for easier targeting
        if (x >= border.x - 1 && x <= border.x + 1 &&
            y >= border.y && y < border.y + border.height) {
          return `resize:${border.columnIndex}`;
        }
      }
    }

    // Check scrollbar
    if (this._scrollbarBounds) {
      const sb = this._scrollbarBounds;
      if (x >= sb.x && x < sb.x + sb.width &&
          y >= sb.y && y < sb.y + sb.height) {
        return 'scrollbar';
      }
    }

    return null;
  }

  /**
   * Draggable interface - handle drag start
   */
  handleDragStart(zone: string, x: number, y: number): void {
    if (zone === 'scrollbar') {
      const tbody = this.getTbody();
      this._dragStartY = y;
      this._dragStartScrollY = tbody?.props.scrollY || 0;
    } else if (zone.startsWith('resize:')) {
      const columnIndex = parseInt(zone.substring(7), 10);
      if (!isNaN(columnIndex) && columnIndex < this._columnWidths.length) {
        // Initialize user column widths if not set
        if (!this._userColumnWidths) {
          this._userColumnWidths = [...this._columnWidths];
        }
        this._resizeDragState = {
          active: true,
          columnIndex,
          startX: x,
          startWidth: this._columnWidths[columnIndex]
        };
      }
    }
  }

  /**
   * Draggable interface - handle drag movement
   * Now uses line-based scrolling
   */
  handleDragMove(zone: string, x: number, y: number): void {
    if (zone === 'scrollbar' && this._scrollbarBounds) {
      const tbody = this.getTbody();
      if (!tbody) return;

      // Use line-based max scroll
      const maxScrollY = Math.max(0, this._totalContentLines - this._viewportLines);

      // Calculate scroll delta based on Y movement
      const deltaY = y - this._dragStartY;
      const scrollRange = this._scrollbarBounds.height;
      const scrollRatio = deltaY / scrollRange;
      const scrollDelta = Math.round(scrollRatio * maxScrollY);

      const newScrollY = Math.max(0, Math.min(maxScrollY, this._dragStartScrollY + scrollDelta));
      tbody.props.scrollY = newScrollY;
    } else if (zone.startsWith('resize:') && this._resizeDragState?.active) {
      const { columnIndex, startX, startWidth } = this._resizeDragState;
      const minWidth = this.props.minColumnWidth || 3; // Minimum 3 characters

      // Calculate new width based on mouse movement
      const deltaX = x - startX;
      const newWidth = Math.max(minWidth, startWidth + deltaX);

      // Update user column widths
      if (this._userColumnWidths) {
        const oldWidth = this._userColumnWidths[columnIndex];
        this._userColumnWidths[columnIndex] = newWidth;
        this._columnWidths = this._userColumnWidths;

        // Fire resize event
        if (this.props.onColumnResize && newWidth !== oldWidth) {
          this.props.onColumnResize({
            type: 'columnResize',
            column: columnIndex,
            oldWidth,
            newWidth,
            columnWidths: [...this._userColumnWidths]
          });
        }
      }
    }
  }

  /**
   * Draggable interface - handle drag end
   */
  handleDragEnd(zone: string, x: number, y: number): void {
    // Clear resize drag state
    if (zone.startsWith('resize:')) {
      this._resizeDragState = null;
    }
  }

  /**
   * Wheelable interface - check if wheel event should be handled
   */
  canHandleWheel(x: number, y: number): boolean {
    if (!this._tbodyBounds) return false;
    const tbody = this.getTbody();
    // Handle wheel if explicitly scrollable OR auto-scroll is enabled
    if (!tbody?.props.scrollable && !this._autoScrollEnabled) return false;

    const b = this._tbodyBounds;
    return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
  }

  /**
   * Wheelable interface - handle wheel event
   * scrollY is now in lines, not rows
   */
  handleWheel(deltaX: number, deltaY: number): boolean {
    const tbody = this.getTbody();
    if (!tbody) return false;

    // Check if scrollable (explicit or auto)
    const isScrollable = tbody.props.scrollable || this._autoScrollEnabled;
    if (!isScrollable) return false;

    // Use line-based scrolling
    const currentScrollY = tbody.props.scrollY || 0;
    const maxScrollY = Math.max(0, this._totalContentLines - this._viewportLines);

    logger.debug(`Table.handleWheel: deltaY=${deltaY}, currentScrollY=${currentScrollY}, maxScrollY=${maxScrollY}, totalContentLines=${this._totalContentLines}, viewportLines=${this._viewportLines}`);

    // Calculate new scroll position (deltaY > 0 = scroll down)
    const newScrollY = Math.max(0, Math.min(maxScrollY, currentScrollY + deltaY));

    if (newScrollY !== currentScrollY) {
      tbody.props.scrollY = newScrollY;
      logger.debug(`Table.handleWheel: scrolled to ${newScrollY}`);
      return true;
    }
    logger.debug(`Table.handleWheel: no change (already at limit?)`);
    return false;
  }

  /**
   * Ensure a row is visible by scrolling if needed
   * Now uses line-based scrolling
   */
  private _ensureRowVisible(rowIndex: number): void {
    const tbody = this.getTbody();
    if (!tbody) return;

    // Check if scrollable (explicit or auto)
    const isScrollable = tbody.props.scrollable || this._autoScrollEnabled;
    if (!isScrollable) return;

    const rows = tbody.getRows();
    if (rowIndex < 0 || rowIndex >= rows.length) return;

    // Calculate line offset for the target row
    let rowStartLine = 0;
    for (let i = 0; i < rowIndex; i++) {
      rowStartLine += this._calculateRowHeight(rows[i], this._columnWidths, this.props.cellPadding || 1);
    }
    const rowHeight = this._calculateRowHeight(rows[rowIndex], this._columnWidths, this.props.cellPadding || 1);
    const rowEndLine = rowStartLine + rowHeight;

    const scrollY = tbody.props.scrollY || 0;
    const viewportEnd = scrollY + this._viewportLines;
    const maxScrollY = Math.max(0, this._totalContentLines - this._viewportLines);

    if (rowStartLine < scrollY) {
      // Row is above visible area, scroll up to show row start
      tbody.props.scrollY = rowStartLine;
    } else if (rowEndLine > viewportEnd) {
      // Row is below visible area, scroll down to show row end
      tbody.props.scrollY = Math.min(maxScrollY, rowEndLine - this._viewportLines);
    }
  }

  /**
   * Get thead section
   */
  getThead(): TableSectionElement | undefined {
    return this.children?.find(
      (child): child is TableSectionElement => child.type === 'thead'
    ) as TableSectionElement | undefined;
  }

  /**
   * Get tbody section
   */
  getTbody(): TableSectionElement | undefined {
    return this.children?.find(
      (child): child is TableSectionElement => child.type === 'tbody'
    ) as TableSectionElement | undefined;
  }

  /**
   * Get tfoot section
   */
  getTfoot(): TableSectionElement | undefined {
    return this.children?.find(
      (child): child is TableSectionElement => child.type === 'tfoot'
    ) as TableSectionElement | undefined;
  }

  /**
   * Get all rows from all sections
   */
  getAllRows(): TableRowElement[] {
    const rows: TableRowElement[] = [];
    const thead = this.getThead();
    const tbody = this.getTbody();
    const tfoot = this.getTfoot();

    if (thead) rows.push(...thead.getRows());
    if (tbody) rows.push(...tbody.getRows());
    if (tfoot) rows.push(...tfoot.getRows());

    return rows;
  }

  /**
   * Calculate the number of columns
   */
  getColumnCount(): number {
    const allRows = this.getAllRows();
    if (allRows.length === 0) return 0;

    return Math.max(...allRows.map(row => row.getColumnCount()));
  }

  /**
   * Get current column widths
   */
  getColumnWidths(): number[] {
    return [...this._columnWidths];
  }

  /**
   * Set column widths programmatically
   */
  setColumnWidths(widths: number[]): void {
    this._userColumnWidths = [...widths];
    this._columnWidths = this._userColumnWidths;
  }

  /**
   * Reset column widths to auto-calculated values
   */
  resetColumnWidths(): void {
    this._userColumnWidths = null;
  }

  /**
   * Set a single column width
   */
  setColumnWidth(columnIndex: number, width: number): void {
    if (!this._userColumnWidths) {
      this._userColumnWidths = [...this._columnWidths];
    }
    if (columnIndex >= 0 && columnIndex < this._userColumnWidths.length) {
      const minWidth = this.props.minColumnWidth || 3;
      this._userColumnWidths[columnIndex] = Math.max(minWidth, width);
      this._columnWidths = this._userColumnWidths;
    }
  }

  /**
   * Calculate column widths based on content
   * @param availableWidth - maximum width available for the table
   * @param expandToFill - if true, expand columns to fill available width (default: true for root tables)
   */
  private _calculateColumnWidths(availableWidth: number, expandToFill: boolean = true): number[] {
    const columnCount = this.getColumnCount();
    if (columnCount === 0) return [];

    const cellPadding = this.props.cellPadding || 1;
    const hasBorder = this.props.border !== 'none';

    // Check cache - use row count and sort cache key to detect data changes
    // Use children.length directly (O(1)) instead of getRows().length (O(n))
    const tbody = this.getTbody();
    const tbodyChildCount = tbody?.children?.length ?? 0;
    const cacheKey = `${availableWidth}:${expandToFill}:${columnCount}:${tbodyChildCount}:${cellPadding}:${hasBorder}:${this._sortCacheKey}`;
    if (this._columnWidthsCacheKey === cacheKey && this._cachedColumnWidths.length === columnCount) {
      return this._cachedColumnWidths;
    }

    // Calculate intrinsic widths for each column (use a small available width to get natural sizes)
    const intrinsicWidths: number[] = new Array(columnCount).fill(0);

    for (const row of this.getAllRows()) {
      let colIndex = 0;
      for (const cell of row.getCells()) {
        const colspan = cell.getColspan();
        // Use a small intrinsic width to prevent nested tables from over-expanding
        const cellWidth = cell.intrinsicSize({ availableSpace: { width: 200, height: 100 } }).width;

        if (colspan === 1) {
          intrinsicWidths[colIndex] = Math.max(intrinsicWidths[colIndex], cellWidth);
        }
        // For colspan > 1, we'd need to distribute width (simplified for now)

        colIndex += colspan;
      }
    }

    // Add padding to each column
    const widths = intrinsicWidths.map(w => w + cellPadding * 2);

    // Calculate total width needed
    const showColumnBorders = this.props.columnBorders ?? true;
    const borderWidth = hasBorder ? (showColumnBorders ? columnCount + 1 : 2) : 0; // vertical borders
    const totalNeeded = widths.reduce((sum, w) => sum + w, 0) + borderWidth;

    // If we have more space and expansion is enabled, distribute evenly
    if (expandToFill && totalNeeded < availableWidth) {
      const extra = availableWidth - totalNeeded;
      const perColumn = Math.floor(extra / columnCount);
      const remainder = extra % columnCount;
      for (let i = 0; i < columnCount; i++) {
        widths[i] += perColumn;
        // Distribute remainder to first columns (1 extra char each)
        if (i < remainder) {
          widths[i] += 1;
        }
      }
    }

    // Cache result
    this._cachedColumnWidths = widths;
    this._columnWidthsCacheKey = cacheKey;

    return widths;
  }

  /**
   * Render the table
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    logger.debug(`Table.render: bounds=${JSON.stringify(bounds)}, children=${this.children?.length || 0}`);

    // Clear bounds for fresh tracking
    this._rowBounds.clear();
    this._scrollbarBounds = null;
    this._tbodyBounds = null;
    this._cellComponentBounds = [];
    this._headerCellBounds = [];
    this._columnBorderPositions = [];

    const borderStyle = this.props.border || 'thin';
    const hasBorder = borderStyle !== 'none';
    const showColumnBorders = this.props.columnBorders ?? true;
    const chars = hasBorder ? BORDER_CHARS[borderStyle] : null;
    const cellPadding = this.props.cellPadding || 1;

    // Calculate column widths (use user-specified widths if provided)
    if (this.props.columnWidths && this.props.columnWidths.length > 0) {
      this._userColumnWidths = [...this.props.columnWidths];
      this._columnWidths = this._userColumnWidths;
    } else if (this._userColumnWidths && this._userColumnWidths.length > 0) {
      // Keep using user-modified widths from resize
      this._columnWidths = this._userColumnWidths;
    } else {
      this._columnWidths = this._calculateColumnWidths(bounds.width);
    }
    const columnCount = this._columnWidths.length;

    logger.debug(`Table.render: columnCount=${columnCount}, columnWidths=${JSON.stringify(this._columnWidths)}`);

    if (columnCount === 0) return;

    const thead = this.getThead();
    const tbody = this.getTbody();
    const tfoot = this.getTfoot();

    logger.debug(`Table.render: thead=${!!thead}, tbody=${!!tbody}, tfoot=${!!tfoot}`);

    // Calculate fixed heights (thead, tfoot, borders, separators)
    let fixedHeight = 0;
    if (hasBorder) fixedHeight += 2; // Top and bottom borders

    if (thead) {
      for (const row of thead.getRows()) {
        fixedHeight += this._calculateRowHeight(row, this._columnWidths, cellPadding);
      }
      if (tbody || tfoot) fixedHeight++; // Separator after thead
    }

    if (tfoot) {
      for (const row of tfoot.getRows()) {
        fixedHeight += this._calculateRowHeight(row, this._columnWidths, cellPadding);
      }
      if (tbody) fixedHeight++; // Separator before tfoot (counted when tbody exists)
    }

    // Calculate total tbody height needed
    let tbodyTotalHeight = 0;
    if (tbody) {
      const rows = tbody.getRows();
      for (const row of rows) {
        tbodyTotalHeight += this._calculateRowHeight(row, this._columnWidths, cellPadding);
      }
    }

    // Check if auto-scroll is needed
    // Never auto-scroll nested tables (tables inside table cells)
    const isNested = context.nestedInTable === true;
    const availableHeight = bounds.height;
    const totalNeeded = fixedHeight + tbodyTotalHeight;
    const needsAutoScroll = !isNested && totalNeeded > availableHeight && tbody && !tbody.props.scrollable;

    // Calculate available height for tbody
    // If tbody has explicit maxHeight, use that as a cap on the viewport
    let availableTbodyHeight = Math.max(1, availableHeight - fixedHeight);
    if (tbody?.props.scrollable && tbody.props.maxHeight && tbody.props.maxHeight < availableTbodyHeight) {
      availableTbodyHeight = tbody.props.maxHeight;
    }

    logger.debug(`Table.render: availableHeight=${availableHeight}, totalNeeded=${totalNeeded}, needsAutoScroll=${needsAutoScroll}, availableTbodyHeight=${availableTbodyHeight}`);

    let y = bounds.y;

    // Border style for drawing - include background from component style
    const borderCellStyle: Partial<Cell> = {
      foreground: style.foreground || getThemeColor('border'),
      background: style.background,
    };

    // Header style
    const headerCellStyle: Partial<Cell> = {
      ...style,
      bold: true,
      foreground: getThemeColor('primary'),
    };

    // Selected row style
    const selectedRowStyle: Partial<Cell> = {
      ...style,
      background: getThemeColor('focusBackground'),
    };

    // Draw top border
    if (hasBorder && chars) {
      this._drawHorizontalBorder(buffer, bounds.x, y, this._columnWidths, chars.tl, chars.tm, chars.tr, chars.h, borderCellStyle, showColumnBorders);
      y++;
    }

    // Render thead with sort indicators
    if (thead) {
      for (const row of thead.getRows()) {
        y = this._renderHeaderRow(buffer, bounds.x, y, row, this._columnWidths, headerCellStyle, borderCellStyle, chars, cellPadding, context, showColumnBorders);
      }

      // Draw separator after thead
      if (hasBorder && chars && (tbody || tfoot)) {
        this._drawHorizontalBorder(buffer, bounds.x, y, this._columnWidths, chars.lm, chars.mm, chars.rm, chars.h, borderCellStyle, showColumnBorders);
        y++;
      }
    }

    // Render tbody (with sorted rows if sorting is active)
    if (tbody) {
      const rows = this._getSortedRows(tbody.getRows());
      const selectable = tbody.props.selectable || 'none';

      // Determine scroll parameters
      // If explicitly scrollable, use its settings; otherwise auto-scroll if needed
      const isScrollable = tbody.props.scrollable || needsAutoScroll;

      // Enable scrollable on tbody when auto-scroll is needed
      // This ensures scroll-handler.ts recognizes tbody as a scrollable container
      if (needsAutoScroll && !tbody.props.scrollable) {
        tbody.props.scrollable = true;
      }

      // scrollY is a LINE offset for true line-by-line scrolling
      const scrollYLines = tbody.props.scrollY || 0;

      // Initialize focused row index if not set
      if (tbody.getFocusedRowIndex() === -1 && rows.length > 0 && selectable !== 'none') {
        tbody.setFocusedRowIndex(0);
      }
      const focusedIndex = tbody.getFocusedRowIndex();

      // Focused row style (underline for multi-select mode)
      const focusedRowStyle: Partial<Cell> = {
        ...style,
        underline: true,
      };

      const tbodyStartY = y;
      // Calculate table width accounting for column borders setting
      const borderCount = showColumnBorders ? this._columnWidths.length + 1 : 2;
      const tableWidth = this._columnWidths.reduce((sum, w) => sum + w, 0) + borderCount;

      // Calculate total content height in lines (cached)
      const heightCacheKey = `${rows.length}:${cellPadding}:${this._columnWidths.join(',')}:${this._sortCacheKey}`;
      let totalContentLines: number;
      if (this._contentHeightCacheKey === heightCacheKey && this._cachedContentHeight > 0) {
        totalContentLines = this._cachedContentHeight;
      } else {
        totalContentLines = 0;
        for (const row of rows) {
          totalContentLines += this._calculateRowHeight(row, this._columnWidths, cellPadding);
        }
        this._cachedContentHeight = totalContentLines;
        this._contentHeightCacheKey = heightCacheKey;
      }

      // Store metrics for wheel handling
      this._viewportLines = availableTbodyHeight;
      this._totalContentLines = totalContentLines;
      this._autoScrollEnabled = !!(isScrollable && totalContentLines > availableTbodyHeight);

      // Store actual dimensions on tbody for scroll-handler integration
      tbody.setActualContentHeight(totalContentLines);
      tbody.setActualViewportHeight(availableTbodyHeight);

      // Track tbody bounds for wheel events and scroll-handler
      this._tbodyBounds = { x: bounds.x, y: tbodyStartY, width: tableWidth, height: availableTbodyHeight };
      tbody.setActualBounds(this._tbodyBounds);

      logger.debug(`Table scroll metrics: totalContentLines=${totalContentLines}, viewportLines=${availableTbodyHeight}, maxScrollY=${totalContentLines - availableTbodyHeight}, scrollY=${scrollYLines}`);

      // Determine if we need scrollbar (reserve space for it)
      const needsScrollbar = isScrollable && totalContentLines > availableTbodyHeight && hasBorder;
      const scrollbarX = bounds.x + tableWidth - 1;

      if (isScrollable && totalContentLines > availableTbodyHeight) {
        // Use ClippedDualBuffer for line-by-line scrolling
        // Create clip bounds for the tbody viewport area
        const clipBounds: Bounds = {
          x: bounds.x,
          y: tbodyStartY,
          width: tableWidth,
          height: availableTbodyHeight
        };

        // Create a clipped buffer that will clip all rendering to the viewport
        const clippedBuffer = new ClippedDualBuffer(buffer, clipBounds);

        // Render ALL rows at their virtual positions, offset by scroll
        // The clipped buffer will automatically hide anything outside the viewport
        let virtualY = tbodyStartY - scrollYLines; // Start at virtual position

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rowHeight = this._calculateRowHeight(row, this._columnWidths, cellPadding);

          // Skip rows that are completely above the viewport
          if (virtualY + rowHeight <= tbodyStartY - availableTbodyHeight) {
            virtualY += rowHeight;
            continue;
          }

          // Stop if we're completely below the viewport
          if (virtualY >= tbodyStartY + availableTbodyHeight) {
            break;
          }

          const isSelected = row.isSelected();
          const isFocused = i === focusedIndex && selectable !== 'none';

          let rowStyle = style;
          if (isSelected) {
            rowStyle = selectedRowStyle;
          }
          if (isFocused && selectable === 'multi' && !isSelected) {
            rowStyle = focusedRowStyle;
          }

          // Render row into the clipped buffer - clipping handles visibility
          this._renderRow(clippedBuffer, bounds.x, virtualY, row, this._columnWidths, rowStyle, borderCellStyle, chars, cellPadding, isSelected, isFocused, context, 0, undefined, showColumnBorders);
          virtualY += rowHeight;
        }

        // Draw scrollbar
        if (needsScrollbar) {
          const scrollbarHeight = availableTbodyHeight;
          this._scrollbarBounds = { x: scrollbarX, y: tbodyStartY, width: 1, height: scrollbarHeight };

          // Calculate thumb size and position based on line scroll
          const viewportLines = availableTbodyHeight;
          const visibleRatio = Math.min(1, viewportLines / totalContentLines);
          const thumbHeight = Math.max(1, Math.round(visibleRatio * scrollbarHeight));

          const maxScrollLines = Math.max(1, totalContentLines - viewportLines);
          const scrollRatio = Math.min(1, scrollYLines / maxScrollLines);
          const maxThumbPosition = scrollbarHeight - thumbHeight;
          const thumbPosition = Math.round(scrollRatio * maxThumbPosition);

          // Register scrollbar bounds
          const scrollElementId = tbody.id || this.id || '';
          if (scrollElementId && context.registerScrollbarBounds) {
            context.registerScrollbarBounds(scrollElementId, {
              vertical: {
                track: { x: scrollbarX, y: tbodyStartY, width: 1, height: scrollbarHeight },
                thumb: { x: scrollbarX, y: tbodyStartY + thumbPosition, width: 1, height: thumbHeight },
                contentHeight: totalContentLines,
                viewportHeight: viewportLines,
              }
            });
          }

          // Draw scrollbar directly to main buffer (not clipped)
          this._drawScrollbarLines(buffer, scrollbarX, tbodyStartY, scrollbarHeight, thumbPosition, thumbHeight, borderCellStyle);
        }

        // Advance y past the tbody area
        y = tbodyStartY + availableTbodyHeight;
      } else {
        // No scrolling needed - render rows normally
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const isSelected = row.isSelected();
          const isFocused = i === focusedIndex && selectable !== 'none';

          let rowStyle = style;
          if (isSelected) {
            rowStyle = selectedRowStyle;
          }
          if (isFocused && selectable === 'multi' && !isSelected) {
            rowStyle = focusedRowStyle;
          }

          y = this._renderRow(buffer, bounds.x, y, row, this._columnWidths, rowStyle, borderCellStyle, chars, cellPadding, isSelected, isFocused, context, 0, undefined, showColumnBorders);
        }
      }

      // Draw separator after tbody
      if (hasBorder && chars && tfoot) {
        this._drawHorizontalBorder(buffer, bounds.x, y, this._columnWidths, chars.lm, chars.mm, chars.rm, chars.h, borderCellStyle, showColumnBorders);
        y++;
      }
    }

    // Render tfoot
    if (tfoot) {
      for (const row of tfoot.getRows()) {
        y = this._renderRow(buffer, bounds.x, y, row, this._columnWidths, style, borderCellStyle, chars, cellPadding, false, false, context, 0, undefined, showColumnBorders);
      }
    }

    // Draw bottom border
    if (hasBorder && chars) {
      this._drawHorizontalBorder(buffer, bounds.x, y, this._columnWidths, chars.bl, chars.bm, chars.br, chars.h, borderCellStyle, showColumnBorders);
    }
  }

  /**
   * Calculate how many rows fit in the given height
   */
  private _calculateVisibleRowCount(rows: TableRowElement[], columnWidths: number[], cellPadding: number, availableHeight: number, startIndex: number = 0): number {
    let totalHeight = 0;
    let count = 0;

    // Start from the given index to handle variable-height rows correctly when scrolled
    for (let i = startIndex; i < rows.length; i++) {
      const rowHeight = this._calculateRowHeight(rows[i], columnWidths, cellPadding);
      if (totalHeight + rowHeight > availableHeight) {
        break;
      }
      totalHeight += rowHeight;
      count++;
    }

    return Math.max(1, count); // At least 1 row visible
  }

  /**
   * Draw a horizontal border line
   */
  private _drawHorizontalBorder(
    buffer: DualBuffer,
    x: number,
    y: number,
    columnWidths: number[],
    left: string,
    middle: string,
    right: string,
    horizontal: string,
    style: Partial<Cell>,
    showColumnBorders: boolean = true
  ): void {
    let currentX = x;

    // Left corner
    buffer.currentBuffer.setText(currentX, y, left, style);
    currentX++;

    // Draw columns with separators
    for (let i = 0; i < columnWidths.length; i++) {
      // Horizontal line for column width
      buffer.currentBuffer.setText(currentX, y, horizontal.repeat(columnWidths[i]), style);
      currentX += columnWidths[i];

      // Junction or right corner
      if (i < columnWidths.length - 1) {
        if (showColumnBorders) {
          buffer.currentBuffer.setText(currentX, y, middle, style);
          currentX++;
        }
      } else {
        buffer.currentBuffer.setText(currentX, y, right, style);
        currentX++;
      }
    }
  }

  /**
   * Calculate the height of a row based on its cells
   */
  private _calculateRowHeight(row: TableRowElement, columnWidths: number[], cellPadding: number): number {
    let maxHeight = 1;

    const cells = row.getCells();
    let colIndex = 0;

    for (const cell of cells) {
      const colspan = cell.getColspan();
      let cellWidth = 0;

      for (let i = 0; i < colspan && colIndex + i < columnWidths.length; i++) {
        cellWidth += columnWidths[colIndex + i];
      }

      const contentWidth = cellWidth - cellPadding * 2;
      const cellHeight = cell.intrinsicSize({ availableSpace: { width: contentWidth, height: 100 } }).height;
      maxHeight = Math.max(maxHeight, cellHeight);

      colIndex += colspan;
    }

    return maxHeight;
  }

  /**
   * Render a header row with sort indicators and track cell bounds for click detection
   */
  private _renderHeaderRow(
    buffer: DualBuffer,
    x: number,
    y: number,
    row: TableRowElement,
    columnWidths: number[],
    style: Partial<Cell>,
    borderStyle: Partial<Cell>,
    chars: BorderChars | null,
    cellPadding: number,
    context?: ComponentRenderContext,
    showColumnBorders: boolean = true
  ): number {
    const cells = row.getCells();
    const hasBorder = chars !== null;
    const borderCount = showColumnBorders ? columnWidths.length + 1 : 2;
    const tableWidth = columnWidths.reduce((sum, w) => sum + w, 0) + (hasBorder ? borderCount : 0);
    const rowHeight = 1; // Headers are single line

    // Sort indicators
    const SORT_ASC = ' ^';  // Use ^ for ascending (caret up alternative)
    const SORT_DESC = ' v'; // Use v for descending (caret down alternative)

    // Track content X position for cell rendering
    let contentX = x + (hasBorder ? 1 : 0);
    let colIndex = 0;

    for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
      const cell = cells[cellIdx];
      const colspan = cell.getColspan();
      let cellWidth = 0;

      // Calculate total cell width (including spanned columns)
      for (let i = 0; i < colspan && colIndex + i < columnWidths.length; i++) {
        cellWidth += columnWidths[colIndex + i];
        if (i > 0 && hasBorder && showColumnBorders) cellWidth++; // Include border between spanned columns
      }

      const align = cell.props.align || 'left';
      const cellContentWidth = cellWidth - cellPadding * 2;
      const cellContentX = contentX + cellPadding;

      // Track cell bounds for click detection (only for th cells that can be sorted)
      const isHeaderCell = cell.isHeader();
      const sortable = cell.props.sortable !== false;
      logger.debug(`_renderHeaderRow: cell=${cellIdx}, type=${cell.type}, isHeader=${isHeaderCell}, sortable=${sortable}`);
      if (isHeaderCell && sortable) {
        this._headerCellBounds.push({
          cell,
          columnIndex: colIndex,
          bounds: { x: contentX, y, width: cellWidth, height: rowHeight }
        });
        logger.debug(`_renderHeaderRow: added header cell bounds for column ${colIndex}`);
      }

      // Get cell text content and add sort indicator if this column is sorted
      let content = cell.getTextContent();
      if (this.props.sortColumn === colIndex && this.props.sortDirection) {
        const indicator = this.props.sortDirection === 'asc' ? SORT_ASC : SORT_DESC;
        content = content + indicator;
      }

      // Calculate text position based on alignment
      let textX = cellContentX;
      const textLen = content.length;

      if (align === 'center') {
        textX += Math.floor((cellContentWidth - textLen) / 2);
      } else if (align === 'right') {
        textX += cellContentWidth - textLen;
      }

      // Truncate if too long
      const truncatedContent = content.substring(0, cellContentWidth);
      buffer.currentBuffer.setText(textX, y, truncatedContent, style);

      const isLastCell = cellIdx === cells.length - 1;
      contentX += cellWidth + (hasBorder && (showColumnBorders || isLastCell) ? 1 : 0);
      colIndex += colspan;
    }

    // Draw borders AFTER content and track column border positions for resize
    if (hasBorder && chars) {
      let borderX = x;

      // Left border
      buffer.currentBuffer.setText(borderX, y, chars.v, borderStyle);
      borderX++;

      // Column separators and right border
      colIndex = 0;
      for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
        const cell = cells[cellIdx];
        const colspan = cell.getColspan();
        let cellWidth = 0;
        for (let i = 0; i < colspan && colIndex + i < columnWidths.length; i++) {
          cellWidth += columnWidths[colIndex + i];
          if (i > 0 && showColumnBorders) cellWidth++;
        }
        borderX += cellWidth;

        // Only draw internal borders if showColumnBorders is true, always draw right border
        const isLastCell = cellIdx === cells.length - 1;
        if (isLastCell || showColumnBorders) {
          buffer.currentBuffer.setText(borderX, y, chars.v, borderStyle);

          // Track column border position for resize (not for the last column's right border)
          const lastColInSpan = colIndex + colspan - 1;
          if (this.props.resizable && lastColInSpan < columnWidths.length - 1 && showColumnBorders) {
            this._columnBorderPositions.push({
              columnIndex: lastColInSpan,
              x: borderX,
              y: y,
              height: rowHeight
            });
          }

          borderX++;
        }
        colIndex += colspan;
      }
    }

    return y + rowHeight;
  }

  /**
   * Render a single row (supports multi-line rows for nested tables)
   * @param skipLines - Number of lines to skip at top (for partial row rendering)
   * @param maxLines - Maximum lines to render (for clipping at bottom)
   * @param showColumnBorders - Whether to show internal column borders
   */
  private _renderRow(
    buffer: DualBuffer | ClippedDualBuffer,
    x: number,
    y: number,
    row: TableRowElement,
    columnWidths: number[],
    style: Partial<Cell>,
    borderStyle: Partial<Cell>,
    chars: BorderChars | null,
    cellPadding: number,
    isSelected: boolean,
    isFocused: boolean = false,
    context?: ComponentRenderContext,
    skipLines: number = 0,
    maxLines?: number,
    showColumnBorders: boolean = true
  ): number {
    const cells = row.getCells();
    const hasBorder = chars !== null;
    const borderCount = showColumnBorders ? columnWidths.length + 1 : 2;
    const tableWidth = columnWidths.reduce((sum, w) => sum + w, 0) + (hasBorder ? borderCount : 0);

    // Calculate row height based on tallest cell
    const fullRowHeight = this._calculateRowHeight(row, columnWidths, cellPadding);

    // Calculate actual lines to render after clipping
    const availableLines = fullRowHeight - skipLines;
    const linesToRender = maxLines !== undefined ? Math.min(availableLines, maxLines) : availableLines;

    if (linesToRender <= 0) return y;

    // Track row bounds for click detection (use actual rendered position and height)
    const rowId = row.getDataId();
    if (rowId) {
      this._rowBounds.set(rowId, { x, y, width: tableWidth, height: linesToRender });
    }

    // First pass: Fill backgrounds for selected rows
    if (isSelected) {
      for (let line = 0; line < linesToRender; line++) {
        let currentX = x + (hasBorder ? 1 : 0);
        for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
          const cell = cells[cellIdx];
          const colspan = cell.getColspan();
          let cellWidth = 0;
          let colIdx = 0;
          for (let i = 0; i < colspan && colIdx + i < columnWidths.length; i++) {
            cellWidth += columnWidths[colIdx + i];
            if (i > 0 && hasBorder && showColumnBorders) cellWidth++;
          }
          buffer.currentBuffer.setText(currentX, y + line, ' '.repeat(cellWidth), style);
          const isLastCell = cellIdx === cells.length - 1;
          currentX += cellWidth + (hasBorder && (showColumnBorders || isLastCell) ? 1 : 0);
        }
      }
    }

    // Second pass: Render cell content with line clipping
    let contentX = x + (hasBorder ? 1 : 0);
    let colIndex = 0;
    for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
      const cell = cells[cellIdx];
      const colspan = cell.getColspan();
      let cellWidth = 0;

      // Calculate total cell width (including spanned columns)
      for (let i = 0; i < colspan && colIndex + i < columnWidths.length; i++) {
        cellWidth += columnWidths[colIndex + i];
        if (i > 0 && hasBorder && showColumnBorders) cellWidth++; // Include border between spanned columns
      }

      const align = cell.props.align || 'left';
      const cellContentWidth = cellWidth - cellPadding * 2;
      const cellContentX = contentX + cellPadding;

      // Render cell children with clipping
      if (cell.children && cell.children.length > 0 && context) {
        this._renderCellChildrenClipped(buffer, cellContentX, y, cellContentWidth, linesToRender, cell, align, style, context, skipLines);
      } else {
        // Fallback to text content for cells without proper children
        // Only render if the text line is visible (not skipped)
        if (skipLines === 0) {
          const content = this._getCellContent(cell);
          let textX = cellContentX;

          // Apply alignment for text
          const textLen = content.length;
          if (align === 'center') {
            textX += Math.floor((cellContentWidth - textLen) / 2);
          } else if (align === 'right') {
            textX += cellContentWidth - textLen;
          }

          const truncatedContent = content.substring(0, cellContentWidth);
          buffer.currentBuffer.setText(textX, y, truncatedContent, style);
        }
      }

      const isLastCell = cellIdx === cells.length - 1;
      contentX += cellWidth + (hasBorder && (showColumnBorders || isLastCell) ? 1 : 0);
      colIndex += colspan;
    }

    // Third pass: Draw borders AFTER all content (so they're not overwritten by nested tables)
    if (hasBorder && chars) {
      for (let line = 0; line < linesToRender; line++) {
        let borderX = x;

        // Left border
        buffer.currentBuffer.setText(borderX, y + line, chars.v, borderStyle);
        borderX++;

        // Column separators and right border
        colIndex = 0;
        for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
          const cell = cells[cellIdx];
          const colspan = cell.getColspan();
          let cellWidth = 0;
          for (let i = 0; i < colspan && colIndex + i < columnWidths.length; i++) {
            cellWidth += columnWidths[colIndex + i];
            if (i > 0 && showColumnBorders) cellWidth++;
          }
          borderX += cellWidth;

          // Only draw internal borders if showColumnBorders is true, always draw right border
          const isLastCell = cellIdx === cells.length - 1;
          if (isLastCell || showColumnBorders) {
            buffer.currentBuffer.setText(borderX, y + line, chars.v, borderStyle);
            borderX++;
          }
          colIndex += colspan;
        }
      }
    }

    return y + linesToRender;
  }

  /**
   * Render cell children with line clipping support
   */
  private _renderCellChildrenClipped(
    buffer: DualBuffer | ClippedDualBuffer,
    x: number,
    y: number,
    width: number,
    maxLines: number,
    cell: TableCellElement,
    align: 'left' | 'center' | 'right',
    style: Partial<Cell>,
    context: ComponentRenderContext,
    skipLines: number = 0
  ): void {
    if (!cell.children || cell.children.length === 0) return;

    // Calculate total width of all children for alignment
    let totalChildWidth = 0;
    for (const child of cell.children) {
      if (child.type === 'container') {
        totalChildWidth += this._estimateContainerWidth(child, width);
      } else if (isRenderable(child)) {
        const size = child.intrinsicSize({ availableSpace: { width, height: maxLines + skipLines } });
        totalChildWidth += size.width;
      } else if (child.type === 'text' && child.props.text) {
        totalChildWidth += String(child.props.text).length;
      }
    }

    // Calculate starting X based on alignment
    let currentX = x;
    if (align === 'center') {
      currentX = x + Math.floor((width - totalChildWidth) / 2);
    } else if (align === 'right') {
      currentX = x + width - totalChildWidth;
    }

    // For renderable children (like nested tables), we need to render to a virtual position
    // and then copy only the visible lines
    for (const child of cell.children) {
      // Handle containers specially - render their children and track each for click handling
      if (child.type === 'container' && child.children) {
        if (skipLines === 0) {
          const containerWidth = this._estimateContainerWidth(child, width);
          this._renderContainerChildrenClipped(buffer, currentX, y, containerWidth, child, style, context);
          currentX += containerWidth;
        }
      } else if (isRenderable(child)) {
        const size = child.intrinsicSize({ availableSpace: { width, height: maxLines + skipLines } });

        // For clipped rendering, we render the full component but offset the Y position
        // The component will render starting from (y - skipLines) conceptually,
        // but we only want lines [skipLines, skipLines + maxLines) to appear at y
        if (skipLines === 0) {
          // No clipping needed at top, just render with height limit
          const childBounds: Bounds = { x: currentX, y, width: size.width, height: Math.min(size.height, maxLines) };
          // Mark nested tables so they don't enable auto-scroll
          const nestedContext = { ...context, nestedInTable: true };
          child.render(childBounds, style, buffer, nestedContext);
          this._cellComponentBounds.push({ element: child, bounds: childBounds });
        } else {
          // Need to clip top lines - render to a temporary offset and rely on buffer clipping
          // For now, render at adjusted Y and let component handle partial rendering
          // This requires components to support skipLines parameter - for now we'll skip rendering
          // the component if it would be partially clipped at top (simplified approach)
          if (skipLines < size.height) {
            // Component is partially visible - render what we can
            // For nested tables, the table itself would need to handle this recursively
            // For now, render at y with reduced height
            const visibleHeight = Math.min(size.height - skipLines, maxLines);
            const childBounds: Bounds = { x: currentX, y, width: size.width, height: visibleHeight };
            // Pass skipLines info via context or render partial
            // Simplified: render the component but it may show wrong lines
            // TODO: implement proper line-offset rendering for nested Renderables
            // Mark nested tables so they don't enable auto-scroll
            const nestedContext = { ...context, nestedInTable: true };
            child.render(childBounds, style, buffer, nestedContext);
            this._cellComponentBounds.push({ element: child, bounds: childBounds });
          }
        }
        currentX += size.width;
      } else if (child.type === 'text' && child.props.text) {
        // Text is single line - only show if not skipped
        if (skipLines === 0) {
          const text = String(child.props.text);
          const truncated = text.substring(0, width);
          buffer.currentBuffer.setText(currentX, y, truncated, style);
          currentX += text.length;
        }
      }
    }
  }

  /**
   * Render container children within a cell (for clipped rendering)
   * Tracks each child component for click handling
   */
  private _renderContainerChildrenClipped(
    buffer: DualBuffer | ClippedDualBuffer,
    x: number,
    y: number,
    width: number,
    container: Element,
    style: Partial<Cell>,
    context: ComponentRenderContext
  ): void {
    if (!container.children || container.children.length === 0) return;

    const gap = container.props.style?.gap || 0;
    let currentX = x;

    for (const child of container.children) {
      if (isRenderable(child)) {
        const size = child.intrinsicSize({ availableSpace: { width, height: 1 } });
        const childBounds: Bounds = { x: currentX, y, width: size.width, height: 1 };
        child.render(childBounds, style, buffer, context);
        // Track component bounds for click handling
        this._cellComponentBounds.push({ element: child, bounds: childBounds });
        currentX += size.width + gap;
      } else if (child.type === 'text' && child.props.text) {
        const text = String(child.props.text);
        buffer.currentBuffer.setText(currentX, y, text, style);
        currentX += text.length + gap;
      }
    }
  }

  /**
   * Render the children of a table cell
   */
  private _renderCellChildren(
    buffer: DualBuffer,
    x: number,
    y: number,
    width: number,
    height: number,
    cell: TableCellElement,
    align: 'left' | 'center' | 'right',
    style: Partial<Cell>,
    context: ComponentRenderContext
  ): void {
    if (!cell.children || cell.children.length === 0) return;

    // Calculate total width and heights of all children
    let totalChildWidth = 0;
    const childWidths: number[] = [];
    const childHeights: number[] = [];

    for (const child of cell.children) {
      // Handle containers specially - calculate width from their children
      if (child.type === 'container') {
        const containerWidth = this._estimateContainerWidth(child, width);
        childWidths.push(containerWidth);
        childHeights.push(1);
        totalChildWidth += containerWidth;
      } else if (isRenderable(child)) {
        const size = child.intrinsicSize({ availableSpace: { width, height } });
        childWidths.push(size.width);
        childHeights.push(size.height);
        totalChildWidth += size.width;
      } else if (child.type === 'text' && child.props.text) {
        const textLen = String(child.props.text).length;
        childWidths.push(textLen);
        childHeights.push(1);
        totalChildWidth += textLen;
      }
    }

    // Calculate starting X based on alignment
    let currentX = x;
    if (align === 'center') {
      currentX = x + Math.floor((width - totalChildWidth) / 2);
    } else if (align === 'right') {
      currentX = x + width - totalChildWidth;
    }

    // Render each child
    for (let i = 0; i < cell.children.length; i++) {
      const child = cell.children[i];
      const childWidth = childWidths[i] || 0;
      const childHeight = childHeights[i] || 1;

      // Handle containers specially - render their children inline
      if (child.type === 'container' && child.children) {
        this._renderContainerChildren(buffer, currentX, y, childWidth, child, style, context);
        currentX += childWidth;
      } else if (isRenderable(child)) {
        const childBounds: Bounds = { x: currentX, y, width: childWidth, height: childHeight };
        child.render(childBounds, style, buffer, context);
        // Track component bounds for click handling
        this._cellComponentBounds.push({ element: child, bounds: childBounds });
        currentX += childWidth;
      } else if (child.type === 'text' && child.props.text) {
        const text = String(child.props.text);
        const truncated = text.substring(0, Math.max(0, x + width - currentX));
        buffer.currentBuffer.setText(currentX, y, truncated, style);
        currentX += text.length;
      }
    }
  }

  /**
   * Estimate width of a container element
   */
  private _estimateContainerWidth(container: Element, availableWidth: number): number {
    if (!container.children || container.children.length === 0) return 0;

    let totalWidth = 0;
    const gap = container.props.style?.gap || 0;

    for (const child of container.children) {
      if (isRenderable(child)) {
        const size = child.intrinsicSize({ availableSpace: { width: availableWidth, height: 1 } });
        totalWidth += size.width;
      } else if (child.type === 'text' && child.props.text) {
        totalWidth += String(child.props.text).length;
      }
    }

    // Add gaps between children
    if (container.children.length > 1) {
      totalWidth += gap * (container.children.length - 1);
    }

    return totalWidth;
  }

  /**
   * Render children of a container within a cell
   */
  private _renderContainerChildren(
    buffer: DualBuffer,
    x: number,
    y: number,
    width: number,
    container: Element,
    style: Partial<Cell>,
    context: ComponentRenderContext
  ): void {
    if (!container.children || container.children.length === 0) return;

    const gap = container.props.style?.gap || 0;
    let currentX = x;

    for (const child of container.children) {
      if (isRenderable(child)) {
        const size = child.intrinsicSize({ availableSpace: { width, height: 1 } });
        const childBounds: Bounds = { x: currentX, y, width: size.width, height: 1 };
        child.render(childBounds, style, buffer, context);
        // Track component bounds for click handling
        this._cellComponentBounds.push({ element: child, bounds: childBounds });
        currentX += size.width + gap;
      } else if (child.type === 'text' && child.props.text) {
        const text = String(child.props.text);
        buffer.currentBuffer.setText(currentX, y, text, style);
        currentX += text.length + gap;
      }
    }
  }

  /**
   * Get text content from a cell
   */
  private _getCellContent(cell: TableCellElement): string {
    if (!cell.children || cell.children.length === 0) {
      return '';
    }

    // Simple text extraction - for Phase 1, just get text content
    const texts: string[] = [];
    for (const child of cell.children) {
      if (child.type === 'text' && child.props.text) {
        texts.push(String(child.props.text));
      }
    }
    return texts.join('');
  }

  /**
   * Calculate intrinsic size
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const hasBorder = this.props.border !== 'none';
    const cellPadding = this.props.cellPadding || 1;
    const showColumnBorders = this.props.columnBorders ?? true;
    // Use expandToFill: false to get natural/intrinsic widths (important for nested tables)
    const columnWidths = this._calculateColumnWidths(context.availableSpace.width, false);
    const columnCount = columnWidths.length;

    // Width = sum of columns + borders (respect columnBorders setting)
    const borderWidth = hasBorder ? (showColumnBorders ? columnCount + 1 : 2) : 0;
    const width = columnWidths.reduce((sum, w) => sum + w, 0) + borderWidth;

    // Height = all rows (with actual heights for multi-line rows) + border lines
    let height = 0;
    const thead = this.getThead();
    const tbody = this.getTbody();
    const tfoot = this.getTfoot();

    if (hasBorder) height++; // Top border

    if (thead) {
      for (const row of thead.getRows()) {
        height += this._calculateRowHeight(row, columnWidths, cellPadding);
      }
      if (tbody || tfoot) height++; // Separator
    }

    if (tbody) {
      const rows = tbody.getRows();
      const maxHeight = tbody.props.maxHeight;
      const visibleRows = tbody.props.scrollable && maxHeight ? rows.slice(0, maxHeight) : rows;
      for (const row of visibleRows) {
        height += this._calculateRowHeight(row, columnWidths, cellPadding);
      }
      if (tfoot) height++; // Separator
    }

    if (tfoot) {
      for (const row of tfoot.getRows()) {
        height += this._calculateRowHeight(row, columnWidths, cellPadding);
      }
    }

    if (hasBorder) height++; // Bottom border

    return { width, height };
  }

  /**
   * Draw a scrollbar indicator on the right side of the table
   *
   * @param buffer - The buffer to draw to
   * @param x - X position of scrollbar
   * @param y - Y position (top of scrollbar)
   * @param trackHeight - Height of the scrollbar track in lines
   * @param totalRows - Total number of rows in tbody
   * @param scrollY - Current scroll position (row index)
   * @param style - Cell style
   * @param visibleRowCount - Optional: number of visible rows (for proper thumb sizing)
   */
  private _drawScrollbar(
    buffer: DualBuffer,
    x: number,
    y: number,
    trackHeight: number,
    totalRows: number,
    scrollY: number,
    style: Partial<Cell>,
    visibleRowCount?: number
  ): void {
    if (trackHeight <= 0 || totalRows <= 0) return;

    // Calculate scrollbar thumb size based on ratio of visible to total rows
    const visibleRatio = visibleRowCount !== undefined
      ? Math.min(1, visibleRowCount / totalRows)
      : Math.min(1, trackHeight / (totalRows * 2)); // Fallback estimate

    const thumbHeight = Math.max(1, Math.round(visibleRatio * trackHeight));

    // Calculate thumb position based on scroll position
    const maxScrollY = Math.max(1, totalRows - (visibleRowCount || 1));
    const scrollRatio = Math.min(1, scrollY / maxScrollY);
    const maxThumbPosition = trackHeight - thumbHeight;
    const thumbPosition = Math.round(scrollRatio * maxThumbPosition);

    // Draw the scrollbar track and thumb
    for (let i = 0; i < trackHeight; i++) {
      const isThumb = i >= thumbPosition && i < thumbPosition + thumbHeight;
      const char = isThumb ? '█' : '░';
      buffer.currentBuffer.setText(x, y + i, char, style);
    }
  }

  /**
   * Draw a scrollbar with pre-calculated thumb position and height
   * Used for line-based scrolling where thumb is calculated externally
   */
  private _drawScrollbarLines(
    buffer: DualBuffer,
    x: number,
    y: number,
    trackHeight: number,
    thumbPosition: number,
    thumbHeight: number,
    style: Partial<Cell>
  ): void {
    if (trackHeight <= 0) return;

    for (let i = 0; i < trackHeight; i++) {
      const isThumb = i >= thumbPosition && i < thumbPosition + thumbHeight;
      const char = isThumb ? '█' : '░';
      buffer.currentBuffer.setText(x, y + i, char, style);
    }
  }

  /**
   * Scroll the tbody by a delta amount (in lines)
   */
  scrollBy(delta: number): void {
    const tbody = this.getTbody();
    if (!tbody) return;

    // Support both explicit scrollable and auto-scroll mode
    const isScrollable = tbody.props.scrollable || this._autoScrollEnabled;
    if (!isScrollable) return;

    // Use line-based scrolling
    const currentScrollY = tbody.props.scrollY || 0;
    const maxScrollY = Math.max(0, this._totalContentLines - this._viewportLines);

    const newScrollY = Math.max(0, Math.min(maxScrollY, currentScrollY + delta));
    tbody.props.scrollY = newScrollY;
  }

  /**
   * Scroll to a specific line offset
   */
  scrollTo(lineOffset: number): void {
    const tbody = this.getTbody();
    if (!tbody) return;

    // Support both explicit scrollable and auto-scroll mode
    const isScrollable = tbody.props.scrollable || this._autoScrollEnabled;
    if (!isScrollable) return;

    // Use line-based scrolling
    const maxScrollY = Math.max(0, this._totalContentLines - this._viewportLines);

    const newScrollY = Math.max(0, Math.min(maxScrollY, lineOffset));
    tbody.props.scrollY = newScrollY;
  }
}

// Factory function
export function createTable(props: TableProps = {}, children: Element[] = []): TableElement {
  return new TableElement(props, children);
}

// Register component
registerComponent({
  type: 'table',
  componentClass: TableElement as any,
  defaultProps: { border: 'thin', cellPadding: 1, cellSpacing: 0 },
});

// Lint schema
export const tableSchema: ComponentSchema = {
  description: 'HTML-like table with optional scrolling, selection, sorting, and column resizing',
  props: {
    border: { type: 'string', enum: ['none', 'thin', 'thick', 'double', 'rounded', 'dashed', 'ascii'], description: 'Border style' },
    cellPadding: { type: 'number', description: 'Padding inside cells' },
    cellSpacing: { type: 'number', description: 'Space between cells' },
    sortColumn: { type: 'number', description: 'Currently sorted column index (0-based)' },
    sortDirection: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
    onSort: { type: 'function', description: 'Callback when sort changes' },
    resizable: { type: 'boolean', description: 'Enable column resizing by dragging borders' },
    columnWidths: { type: 'array', description: 'Explicit column widths (array of numbers)' },
    minColumnWidth: { type: 'number', description: 'Minimum column width when resizing (default: 3)' },
    onColumnResize: { type: 'function', description: 'Callback when column is resized' },
  },
};

registerComponentSchema('table', tableSchema);
