# Plan: `<data-table>` Component

## Overview

A new data-driven table component that is visually identical to `<table>` but optimized for performance with simple data arrays instead of nested element trees.

## Key Differences from Existing `<table>`

| Aspect | `<table>` | `<data-table>` |
|--------|-----------|----------------|
| Data source | Nested elements (thead/tbody/tr/td) | Single `data` prop with arrays |
| Cell content | Any component (buttons, inputs, nested tables) | Simple values only (string/number) |
| Row height | Variable per row (based on cell intrinsicSize) | Uniform (configurable, default 1) |
| Rendering | Complex multi-pass with component delegation | Simple direct text rendering |
| Code size | ~2300 lines | Target ~800 lines |

## Data Structure

```typescript
interface DataTableColumn {
  header: string;           // Header display text
  width?: number | `${number}%` | 'fill';  // Fixed chars, percentage, or fill remaining
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;       // Default: true
  comparator?: (a: CellValue, b: CellValue) => number;
}

type CellValue = string | number | boolean | null | undefined;

// Simple array-based data - no wrapper objects
type DataTableRows = CellValue[][];      // rows[rowIndex][colIndex]
type DataTableFooter = CellValue[][];    // footer rows, same structure

interface DataTableProps extends BaseProps {
  // Data as simple arrays
  columns: DataTableColumn[];
  rows: DataTableRows;
  footer?: DataTableFooter;

  // Display
  rowHeight?: number;       // Default: 1, >1 enables word wrap
  showHeader?: boolean;     // Default: true
  showFooter?: boolean;     // Default: true (if footer data exists)
  showColumnBorders?: boolean;  // Default: false

  // Scrolling
  scrollable?: boolean;     // Default: auto-detect
  maxHeight?: number;       // Max visible rows before scrolling
  scrollY?: number;         // Current scroll position (lines)

  // Sorting
  sortColumn?: number;      // Column index to sort by
  sortDirection?: 'asc' | 'desc';
  onSort?: (event: SortEvent) => void;  // event.columnIndex, event.direction

  // Selection (uses original row indices)
  selectable?: 'none' | 'single' | 'multi';  // Default: 'none'
  selectedRows?: number[];  // Original row indices (controlled)
  onSelect?: (event: SelectEvent) => void;   // event.rowIndex (original), event.selectedRows
  onActivate?: (event: ActivateEvent) => void;  // event.rowIndex (original)
}
```

**Internal Index Mapping:**
- Component maintains `_sortedIndices: number[]` mapping sorted position → original index
- Selection state stored as original indices in `_selectedRows: Set<number>`
- Events always report original row indices, not sorted positions
- `selectedRows` prop accepts/returns original indices

## Usage Example

```xml
<script type="typescript">
  const columns = [
    { header: 'ID', width: 5, align: 'right' },
    { header: 'Name', width: '30%' },
    { header: 'Status', width: 10 },
    { header: 'Description' }  // fill remaining
  ];

  const rows = [
    [1, 'Alice', 'Active', 'Engineer'],
    [2, 'Bob', 'Away', 'Designer'],
    [3, 'Carol', 'Active', 'Manager'],
  ];

  const footer = [
    ['Total:', '3 users', '', '']
  ];

  export function handleSelect(event) {
    // event.rowIndex is the original index (0, 1, or 2), even when sorted
    $melker.logger.info(`Selected row ${event.rowIndex}`);
  }

  export function handleSort(event) {
    // event.columnIndex, event.direction
    $melker.logger.info(`Sort column ${event.columnIndex} ${event.direction}`);
  }
</script>

<data-table
  id="users"
  columns="${columns}"
  rows="${rows}"
  footer="${footer}"
  style="width: fill; height: 20;"
  selectable="single"
  onSelect="$app.handleSelect(event)"
  onSort="$app.handleSort(event)"
/>
```

## Implementation Plan

### File: `src/components/data-table.ts`

#### 1. Class Structure (~100 lines)

```typescript
export class DataTableElement extends Element implements Renderable, Focusable, Interactive, Wheelable, Draggable {
  declare props: DataTableProps;

  // Scroll state
  private _scrollY: number = 0;
  private _totalContentLines: number = 0;
  private _viewportLines: number = 0;

  // Selection state (stores original row indices)
  private _selectedRows: Set<number> = new Set();
  private _focusedSortedIndex: number = -1;  // Position in sorted view

  // Sorting state - maps sorted position to original index
  private _sortedIndices: number[] | null = null;  // sortedPos → originalIndex
  private _sortCacheKey: string = '';

  // Hit testing bounds (keyed by sorted position for efficiency)
  private _headerCellBounds: Array<{ colIndex: number; bounds: Bounds }> = [];
  private _rowBounds: Map<number, Bounds> = new Map();  // sortedPos → bounds
  private _scrollbarBounds: Bounds | null = null;

  // Cached calculations
  private _columnWidths: number[] = [];
}
```

#### 2. Column Width Calculation (~80 lines)

```typescript
private _calculateColumnWidths(availableWidth: number): number[] {
  const { columns, showColumnBorders } = this.props;
  const borderWidth = showColumnBorders ? columns.length + 1 : 2;  // +1 per col if borders, else just left+right
  const contentWidth = availableWidth - borderWidth;

  // Pass 1: Calculate fixed and percentage widths
  let remainingWidth = contentWidth;
  let fillCount = 0;
  const widths: number[] = [];

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
      widths.push(-1);  // Mark as fill
      fillCount++;
    }
  }

  // Pass 2: Distribute remaining to fill columns
  if (fillCount > 0) {
    const fillWidth = Math.floor(remainingWidth / fillCount);
    for (let i = 0; i < widths.length; i++) {
      if (widths[i] === -1) {
        widths[i] = fillWidth;
      }
    }
  }

  return widths;
}
```

#### 3. Sorting (~60 lines)

```typescript
// Returns array of original indices in sorted order
private _getSortedIndices(): number[] {
  const { rows, columns, sortColumn, sortDirection } = this.props;

  if (sortColumn === undefined || !sortDirection) {
    // No sorting - return identity mapping [0, 1, 2, ...]
    return rows.map((_, i) => i);
  }

  // Cache check
  const cacheKey = `${sortColumn}:${sortDirection}:${rows.length}`;
  if (this._sortCacheKey === cacheKey && this._sortedIndices) {
    return this._sortedIndices;
  }

  // Get comparator
  const column = columns[sortColumn];
  const comparator = column?.comparator || this._autoDetectComparator(sortColumn);

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
  return indices[sortedPos];
}
```

#### 4. Render Method (~200 lines)

```typescript
render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
  const { columns, rows, footer, rowHeight = 1, showHeader = true, showFooter = true } = this.props;
  const sortedIndices = this._getSortedIndices();

  // Calculate dimensions
  this._columnWidths = this._calculateColumnWidths(bounds.width);
  const headerHeight = showHeader ? 1 : 0;
  const footerHeight = showFooter && footer?.length ? footer.length : 0;
  const bodyHeight = bounds.height - headerHeight - footerHeight - 2;  // -2 for top/bottom borders

  // Scroll calculations
  this._totalContentLines = rows.length * rowHeight;
  this._viewportLines = bodyHeight;
  const maxScroll = Math.max(0, this._totalContentLines - this._viewportLines);
  this._scrollY = Math.min(this._scrollY, maxScroll);

  let y = bounds.y;

  // Draw top border
  this._drawHorizontalBorder(buffer, bounds.x, y, 'top', style);
  y++;

  // Render header
  if (showHeader) {
    this._renderHeaderRow(buffer, bounds.x, y, columns, style);
    y++;
    this._drawHorizontalBorder(buffer, bounds.x, y, 'middle', style);
    y++;
  }

  // Render body with clipping
  const bodyStartY = y;
  const clipBounds = { x: bounds.x, y: bodyStartY, width: bounds.width, height: bodyHeight };
  const clippedBuffer = new ClippedDualBuffer(buffer, clipBounds);

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
    const rowStyle = isSelected ? { ...style, inverse: true } : style;

    this._renderDataRow(clippedBuffer, bounds.x, virtualY, rowData, rowStyle);
    this._rowBounds.set(sortedPos, { x: bounds.x, y: virtualY, width: bounds.width, height: rowHeight });
    virtualY += rowHeight;
  }
  y = bodyStartY + bodyHeight;

  // Draw scrollbar if needed
  if (this._totalContentLines > this._viewportLines) {
    this._drawScrollbar(buffer, bounds.x + bounds.width - 1, bodyStartY, bodyHeight, style);
  }

  // Render footer
  if (showFooter && footer?.length) {
    this._drawHorizontalBorder(buffer, bounds.x, y, 'middle', style);
    y++;
    for (const footerRow of footer) {
      this._renderFooterRow(buffer, bounds.x, y, footerRow, style);
      y++;
    }
  }

  // Draw bottom border
  this._drawHorizontalBorder(buffer, bounds.x, y, 'bottom', style);
}
```

#### 5. Row Rendering (~80 lines)

```typescript
private _renderDataRow(
  buffer: DualBuffer | ClippedDualBuffer,
  x: number,
  y: number,
  rowData: CellValue[],  // Simple array of values
  style: Partial<Cell>
): void {
  const { columns, rowHeight = 1 } = this.props;

  // Draw left border
  buffer.currentBuffer.setCell(x, y, { char: '│', ...style });

  let cellX = x + 1;
  for (let colIndex = 0; colIndex < columns.length; colIndex++) {
    const col = columns[colIndex];
    const width = this._columnWidths[colIndex];
    const value = rowData[colIndex];  // Direct array access
    const text = this._formatValue(value);

    if (rowHeight === 1) {
      // Single line: truncate
      const displayText = this._truncate(text, width);
      const aligned = this._align(displayText, width, col.align || 'left');
      buffer.currentBuffer.setText(cellX, y, aligned, style);
    } else {
      // Multi-line: word wrap
      const lines = this._wrapText(text, width);
      for (let line = 0; line < rowHeight && line < lines.length; line++) {
        const aligned = this._align(lines[line], width, col.align || 'left');
        buffer.currentBuffer.setText(cellX, y + line, aligned, style);
      }
    }

    cellX += width;

    // Column separator (always draw right border, optionally draw inner separators)
    if (this.props.showColumnBorders || colIndex === columns.length - 1) {
      buffer.currentBuffer.setCell(cellX, y, { char: '│', ...style });
      cellX++;
    }
  }
}
```

#### 6. Event Handling (~150 lines)

- `handleClick()`: Header sort clicks, row selection, scrollbar
- `handleKeyPress()`: Arrow navigation, Enter activation, Space toggle
- `handleWheel()`: Scroll by delta
- `handleDragStart/Move/End()`: Scrollbar dragging

#### 7. Selection Management (~50 lines)

```typescript
// Called with sorted position, converts to original index internally
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

  // Event reports original indices
  this.props.onSelect?.({
    rowIndex: originalIndex,
    selectedRows: [...this._selectedRows],
    action: mode
  });
}
```

#### 8. Utility Methods (~80 lines)

- `_formatValue(value)`: Convert to string
- `_truncate(text, width)`: Truncate with ellipsis
- `_align(text, width, align)`: Pad text for alignment
- `_wrapText(text, width)`: Word wrap for multi-line
- `_drawHorizontalBorder()`: Draw table borders
- `_drawScrollbar()`: Draw scrollbar with thumb
- `_autoDetectComparator()`: Auto-detect numeric/date/string

### File Updates

#### `src/components/mod.ts`
- Export DataTableElement

#### `mod.ts`
- Re-export from components

#### `src/element.ts`
- Register 'data-table' component

#### `src/lint.ts`
- Add schema for data-table props

## Performance Characteristics

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Column width calc | O(columns) | No row sampling needed |
| Row render | O(visible rows) | Skip rows outside viewport |
| Sort | O(n log n) | Cached after first sort |
| Selection lookup | O(1) | Set-based |
| Click hit test | O(visible rows) | Bounds map lookup |

## Advantages Over `<table>`

1. **No intrinsicSize calls on cells** - widths defined in column spec
2. **No component rendering delegation** - direct text output
3. **Uniform row height** - no per-row height calculation
4. **Simpler data binding** - single data prop, not element tree
5. **Faster re-render** - just re-draw text, no element reconciliation

## Testing Strategy

1. Unit tests for column width calculation
2. Unit tests for sorting with different data types
3. Unit tests for selection modes
4. Integration tests for scrolling
5. Visual tests comparing to `<table>` output

## Estimated Implementation: ~800 lines

- Class + props: 100 lines
- Column widths: 80 lines
- Sorting: 60 lines
- Render: 200 lines
- Row rendering: 80 lines
- Events: 150 lines
- Selection: 50 lines
- Utilities: 80 lines
