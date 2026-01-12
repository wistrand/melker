# `<data-table>` Component

A data-driven table component optimized for performance with simple data arrays instead of nested element trees.

## Key Differences from `<table>`

| Aspect | `<table>` | `<data-table>` |
|--------|-----------|----------------|
| Data source | Nested elements (thead/tbody/tr/td) | `columns` and `rows` props with arrays |
| Cell content | Any component (buttons, inputs, nested tables) | Simple values only (string/number) |
| Row height | Variable per row (based on cell intrinsicSize) | Uniform (configurable, default 1) |
| Rendering | Complex multi-pass with component delegation | Simple direct text rendering |
| Use case | Complex tables with interactive cells | Large datasets, simple display |

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
type DataTableRows = CellValue[][];      // rows[rowIndex][colIndex]
type DataTableFooter = CellValue[][];    // footer rows, same structure

interface DataTableProps extends BaseProps {
  // Data as simple arrays
  columns: DataTableColumn[];
  rows: DataTableRows;
  footer?: DataTableFooter;

  // Display
  rowHeight?: number;           // Default: 1, >1 enables word wrap
  showHeader?: boolean;         // Default: true
  showFooter?: boolean;         // Default: true (if footer data exists)
  showColumnBorders?: boolean;  // Default: false
  border?: BorderStyle;         // Default: 'thin'

  // Sorting (handled internally, events optional)
  sortColumn?: number;          // Column index to sort by
  sortDirection?: 'asc' | 'desc';
  onSort?: (event: SortEvent) => void;  // Optional notification

  // Selection (uses original row indices)
  selectable?: 'none' | 'single' | 'multi';  // Default: 'none'
  selectedRows?: number[];      // Original row indices (controlled)
  onSelect?: (event: SelectEvent) => void;
  onActivate?: (event: ActivateEvent) => void;  // Enter or double-click
}
```

## Usage Examples

### Inline JSON Data (Simplest)

For static data, embed JSON directly inside the element. Parse errors are logged via the logging system.

```xml
<data-table
  id="users"
  style="width: fill; height: 20;"
  selectable="single"
  sortColumn="0"
  sortDirection="asc"
>
{
  "columns": [
    { "header": "ID", "width": 5, "align": "right" },
    { "header": "Name", "width": "30%" },
    { "header": "Status", "width": 10 },
    { "header": "Description" }
  ],
  "rows": [
    [1, "Alice", "Active", "Engineer"],
    [2, "Bob", "Away", "Designer"],
    [3, "Carol", "Active", "Manager"]
  ],
  "footer": [
    ["", "3 users", "", ""]
  ]
}
</data-table>
```

### Dynamic Data via Script

For dynamic data (e.g., fetched from API, generated), use a script:

```xml
<melker>
  <script type="typescript">
    export const columns = [
      { header: 'ID', width: 5, align: 'right' as const },
      { header: 'Name', width: '30%' as const },
      { header: 'Status', width: 10 },
      { header: 'Description' }
    ];

    export const rows = [
      [1, 'Alice', 'Active', 'Engineer'],
      [2, 'Bob', 'Away', 'Designer'],
      [3, 'Carol', 'Active', 'Manager'],
    ];

    export function handleActivate(event: { rowIndex: number }) {
      const row = rows[event.rowIndex];
      $melker.alert('Activated: ' + row[1]);
    }
  </script>

  <script type="typescript" async="ready">
    const table = $melker.getElementById('users');
    if (table) {
      table.props.columns = $app.columns;
      table.props.rows = $app.rows;
      $melker.render();
    }
  </script>

  <data-table
    id="users"
    style="width: fill; height: 20;"
    selectable="single"
    onActivate="$app.handleActivate(event)"
  />
</melker>
```

**Note:** Use inline JSON for static data; use script for dynamic data. You can mix both - e.g., inline columns with script-set rows. JSON parse errors are logged to the logging system.

## Features

### Sorting
- Click column headers to sort
- Sorting is handled internally - no handler required
- `onSort` event is optional for external notification
- Sort indicator shows in header (^ for asc, v for desc)

### Selection
- `selectable="single"` - One row at a time
- `selectable="multi"` - Multiple rows (Space to toggle)
- Selection highlight uses reverse video
- Borders remain unhighlighted for clean appearance

### Activation
- Enter key or double-click triggers `onActivate`
- Event provides `rowIndex` (original index, not sorted position)

### Scrolling
- Automatic scrollbar when content exceeds viewport
- Mouse wheel scrolling
- Keyboard navigation (Arrow, PageUp/Down, Home/End)
- Scrollbar drag support

### Index Mapping
- Selection and events always use original row indices
- Sorting creates internal mapping (sorted position -> original index)
- `selectedRows` prop accepts/returns original indices

## Keyboard Navigation

| Key | Action |
|-----|--------|
| Arrow Up/Down | Move selection |
| Page Up/Down | Move by page |
| Home/End | Jump to first/last |
| Enter | Activate row |
| Space | Toggle selection (multi mode) |

## Implementation Files

| File | Purpose |
|------|---------|
| `src/components/data-table.ts` | Component implementation |
| `src/components/mod.ts` | Component export |

## Performance

| Operation | Complexity |
|-----------|-----------|
| Column width calc | O(columns) |
| Row render | O(visible rows) |
| Sort | O(n log n), cached |
| Selection lookup | O(1) |
| Click hit test | O(visible rows) |
