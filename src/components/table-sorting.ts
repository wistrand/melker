// Table sorting helpers — standalone functions extracted from TableElement

import type { TableProps, SortDirection } from './table-types.ts';
import type { TableSectionElement } from './table-section.ts';
import type { TableRowElement } from './table-row.ts';
import type { TableCellElement } from './table-cell.ts';

/**
 * Context interface for sorting functions that need access to table state.
 */
export interface TableSortContext {
  props: TableProps;
  getThead(): TableSectionElement | undefined;
  getTbody(): TableSectionElement | undefined;
  columnComparators: Map<number, (a: string, b: string) => number>;
}

/**
 * Mutable sort cache — passed by reference so functions can update it.
 */
export interface SortCache {
  cachedSortedRows: TableRowElement[] | null;
  sortCacheKey: string;
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

/**
 * Handle click on a sortable header cell — updates props and fires event.
 */
export function handleSortClick(ctx: TableSortContext, columnIndex: number, cell: TableCellElement): void {
  const currentColumn = ctx.props.sortColumn;
  const currentDirection = ctx.props.sortDirection;

  let newDirection: SortDirection;

  if (currentColumn === columnIndex) {
    // Toggle direction: asc -> desc -> asc
    newDirection = currentDirection === 'asc' ? 'desc' : 'asc';
  } else {
    // New column: start with ascending
    newDirection = 'asc';
  }

  // Cache comparator for this column if not already cached
  if (!ctx.columnComparators.has(columnIndex)) {
    const comparator = getComparatorForColumn(ctx, columnIndex, cell);
    ctx.columnComparators.set(columnIndex, comparator);
  }

  // Update props
  ctx.props.sortColumn = columnIndex;
  ctx.props.sortDirection = newDirection;

  // Fire event
  if (ctx.props.onSort) {
    ctx.props.onSort({
      type: 'sort',
      column: columnIndex,
      direction: newDirection,
      previousColumn: currentColumn ?? null,
      previousDirection: currentDirection ?? null,
    });
  }
}

/**
 * Get the comparator function for a column.
 */
export function getComparatorForColumn(ctx: TableSortContext, columnIndex: number, headerCell: TableCellElement): (a: string, b: string) => number {
  // Use custom comparator if provided
  if (headerCell.props.onCompare) {
    return headerCell.props.onCompare;
  }

  // Auto-detect comparator based on column values
  const tbody = ctx.getTbody();
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
 * Get sorted tbody rows based on current sort state.
 * Uses caching to avoid re-sorting on every render.
 */
export function getSortedRows(ctx: TableSortContext, rows: TableRowElement[], cache: SortCache): TableRowElement[] {
  const sortColumn = ctx.props.sortColumn;
  const sortDirection = ctx.props.sortDirection;

  if (sortColumn === undefined || sortDirection === undefined) {
    return rows;
  }

  // Build cache key from sort params and row boundaries
  // Uses count + first/last row IDs for fast change detection
  const firstRowId = rows.length > 0 ? (rows[0].getDataId() || rows[0].id || '') : '';
  const lastRowId = rows.length > 0 ? (rows[rows.length - 1].getDataId() || rows[rows.length - 1].id || '') : '';
  const cacheKey = `${sortColumn}:${sortDirection}:${rows.length}:${firstRowId}:${lastRowId}`;

  // Return cached result if still valid
  if (cache.cachedSortedRows && cache.sortCacheKey === cacheKey) {
    return cache.cachedSortedRows;
  }

  // Get or create comparator for this column
  let comparator = ctx.columnComparators.get(sortColumn);
  if (!comparator) {
    // Try to get header cell for custom comparator
    const thead = ctx.getThead();
    const headerRow = thead?.getRows()[0];
    const headerCell = headerRow?.getCellAtIndex(sortColumn);
    comparator = headerCell ? getComparatorForColumn(ctx, sortColumn, headerCell) : defaultStringComparator;
    ctx.columnComparators.set(sortColumn, comparator);
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
  cache.cachedSortedRows = sorted;
  cache.sortCacheKey = cacheKey;

  return sorted;
}

/**
 * Check if table has sortable headers.
 */
export function hasSortableHeaders(ctx: TableSortContext): boolean {
  const thead = ctx.getThead();
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
