// Table component type definitions

import type { BaseProps, BorderStyle } from '../types.ts';

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
