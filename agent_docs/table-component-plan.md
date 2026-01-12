# Table Component Plan

HTML-like table component for Melker with scrollable body, row selection, sorting, and column resizing.

## Syntax

```xml
<table id="users" border="thin" style="width: fill;">
  <colgroup resizable="true">
    <col width="30" minWidth="10" />
    <col width="fill" />
    <col width="20" align="right" />
  </colgroup>

  <thead>
    <tr>
      <th sortable="true">ID</th>
      <th sortable="true" onCompare="(a, b) => a.localeCompare(b)">Name</th>
      <th>Actions</th>
    </tr>
  </thead>

  <tbody scrollable="true" maxHeight="10"
         selectable="single"
         onSelect="handleSelect(event)">
    <tr data-id="1">
      <td>1</td>
      <td><text style="font-weight: bold;">Alice</text></td>
      <td><button label="Edit" onClick="edit(1)" /></td>
    </tr>
    <tr data-id="2">
      <td>2</td>
      <td>Bob</td>
      <td><checkbox checked="true" onChange="toggle(2)" /></td>
    </tr>
  </tbody>

  <tfoot>
    <tr>
      <td colspan="2">Total</td>
      <td>2 users</td>
    </tr>
  </tfoot>
</table>
```

## Elements

| Element | Parent | Props |
|---------|--------|-------|
| `table` | any | `border`, `cellPadding`, `cellSpacing`, `style`, `id` |
| `colgroup` | table | `resizable` |
| `col` | colgroup | `width`, `minWidth`, `maxWidth`, `align`, `style` |
| `thead` | table | `style` |
| `tbody` | table | `scrollable`, `maxHeight`, `selectable`, `onSelect`, `style` |
| `tfoot` | table | `style` |
| `tr` | thead/tbody/tfoot | `data-id`, `style` |
| `th` | tr | `colspan`, `rowspan`, `align`, `sortable`, `onCompare`, `style` |
| `td` | tr | `colspan`, `rowspan`, `align`, `valign`, `style` |

## Props Reference

### table

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `border` | `none \| thin \| thick \| double \| rounded` | `thin` | Border style |
| `cellPadding` | number | 1 | Padding inside cells |
| `cellSpacing` | number | 0 | Space between cells |

### colgroup

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `resizable` | boolean | false | Allow dragging column borders to resize |

### col

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `width` | number \| `auto` \| `fill` | `auto` | Column width |
| `minWidth` | number | - | Minimum width when resizing |
| `maxWidth` | number | - | Maximum width when resizing |
| `align` | `left \| center \| right` | `left` | Text alignment |

### thead > tr > th

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `sortable` | boolean | false | Enable click to sort |
| `onCompare` | `(a: string, b: string) => number` | - | Custom comparison function |
| `colspan` | number | 1 | Span multiple columns |
| `rowspan` | number | 1 | Span multiple rows |
| `align` | `left \| center \| right` | inherited | Override column alignment |

### tbody

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `scrollable` | boolean | false | Enable scrolling |
| `maxHeight` | number | - | Max visible rows (required if scrollable) |
| `selectable` | `none \| single \| multi` | `none` | Row selection mode |
| `onSelect` | `(event: SelectEvent) => void` | - | Selection change handler |

### tr

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data-id` | string | - | Unique row identifier for selection/sorting |

### td

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `colspan` | number | 1 | Span multiple columns |
| `rowspan` | number | 1 | Span multiple rows |
| `align` | `left \| center \| right` | inherited | Override column alignment |
| `valign` | `top \| center \| bottom` | `top` | Vertical alignment |

## Column Width Algorithm

1. If `<colgroup>` present, use defined widths
2. Otherwise, auto-calculate:
   - Measure intrinsic width of each cell (text length, component min-width)
   - Distribute `fill` columns proportionally in remaining space
   - Fixed widths take priority
   - `auto` = max intrinsic width of column

## Scrollable tbody

When `scrollable="true"`:
- `thead` renders at fixed position (sticky header)
- `tbody` becomes a scrollable viewport
- `tfoot` renders at fixed position (sticky footer)
- Scrollbar appears on right side of tbody area
- Column alignment preserved between sections

```
┌──────┬────────────┬─────────┐
│ ID   │ Name       │ Actions │  ← thead (fixed)
├──────┼────────────┼─────────┤
│ 1    │ Alice      │ [Edit]  │  ↑
│ 2    │ Bob        │ [✓]     │  │ tbody (scrolls)
│ 3    │ Carol      │ [Edit]  │  ↓ ▓
├──────┼────────────┼─────────┤
│ Total│            │ 50 users│  ← tfoot (fixed)
└──────┴────────────┴─────────┘
```

## Row Selection

### Events

```typescript
interface SelectEvent {
  type: 'select';
  selectedIds: string[];      // All currently selected row IDs
  rowId: string;              // The row that triggered the event
  action: 'add' | 'remove' | 'replace';  // What changed
}
```

### Single Selection (`selectable="single"`)

- Click row → selects it, deselects others
- Keyboard: ↑/↓ moves selection

### Multi Selection (`selectable="multi"`)

- Click row → selects it (deselects others)
- Ctrl+Click → toggle row selection
- Shift+Click → range select from last clicked
- Keyboard: Space toggles current, ↑/↓ moves focus

### Visual

```
┌──────┬────────────┬─────────┐
│ ID   │ Name     ▲ │ Actions │  ← ▲ = sorted ascending
├──────┼────────────┼─────────┤
│ 1    │ Alice      │ [Edit]  │
│ 2    │ Bob        │ [✓]     │  ← highlighted (selected)
│ 3    │ Carol      │ [Edit]  │
└──────┴────────────┴─────────┘
```

## Sorting

### Default Comparison

```typescript
// Numeric if both values are numbers, otherwise string compare
function defaultCompare(a: string, b: string): number {
  const numA = parseFloat(a);
  const numB = parseFloat(b);
  if (!isNaN(numA) && !isNaN(numB)) {
    return numA - numB;
  }
  return a.localeCompare(b);
}
```

### Custom Comparison

```xml
<th sortable="true" onCompare="(a, b) => new Date(a) - new Date(b)">Date</th>
```

### Sort Indicators

```
Unsorted:   Name
Ascending:  Name ▲
Descending: Name ▼
```

### Click Behavior

1. First click → ascending
2. Second click → descending
3. Third click → unsorted (original order)

### Sort Event

```typescript
interface SortEvent {
  type: 'sort';
  columnIndex: number;
  direction: 'asc' | 'desc' | 'none';
}
```

## Column Resizing

When `resizable="true"` on colgroup:

### Mouse Interaction

- Hover over column border → cursor changes to `col-resize` (⇔)
- Drag border → resize column
- Respects `minWidth` and `maxWidth` constraints
- Adjacent column adjusts to fill space (or table grows)

### Visual

```
┌──────┬──│──────────┬─────────┐
│ ID   │  ⇔  Name    │ Actions │  ← drag handle between columns
├──────┼────────────┼─────────┤
```

### Resize Event

```typescript
interface ResizeEvent {
  type: 'resize';
  columnIndex: number;
  width: number;
  previousWidth: number;
}
```

## Component Hierarchy

```
TableElement
├── props: border, cellPadding, cellSpacing
├── state:
│   ├── sortState?: { columnIndex, direction }
│   ├── columnWidths: number[]
│   └── resizeState?: { columnIndex, startX, startWidth }
├── colgroup?: ColGroupElement
│   ├── props: resizable
│   └── children: ColElement[]
├── thead?: TableSectionElement
│   └── children: TableRowElement[]
│       └── children: TableCellElement[] (th)
│           └── props: sortable, onCompare
├── tbody: TableSectionElement
│   ├── props: scrollable, maxHeight, selectable, onSelect
│   ├── state:
│   │   ├── selectedIds: Set<string>
│   │   ├── focusedRowIndex: number
│   │   └── scrollY: number
│   └── children: TableRowElement[]
│       └── props: data-id
└── tfoot?: TableSectionElement
```

## Key Bindings

| Key | Selection Mode | Action |
|-----|----------------|--------|
| ↑ | single | Move selection up |
| ↓ | single | Move selection down |
| ↑ | multi | Move focus up |
| ↓ | multi | Move focus down |
| Space | multi | Toggle focused row selection |
| Ctrl+A | multi | Select all rows |
| Escape | any | Clear selection |
| Enter | any | Trigger onSelect with current |
| Home | any | Jump to first row |
| End | any | Jump to last row |

## Methods

```typescript
class TableElement {
  // Selection
  getSelectedRows(): string[];
  setSelectedRows(ids: string[]): void;
  clearSelection(): void;

  // Sorting
  sort(columnIndex: number, direction: 'asc' | 'desc'): void;
  clearSort(): void;
  getSortState(): SortState | null;

  // Column widths
  getColumnWidths(): number[];
  setColumnWidth(index: number, width: number): void;
  resetColumnWidths(): void;

  // Data access
  getRowData(id: string): Element | undefined;
  getVisibleRows(): Element[];
}
```

## Border Characters

Extend existing `BorderChars` with T-junction characters:

```typescript
interface TableBorderChars extends BorderChars {
  // Existing: h, v, tl, tr, bl, br
  // New for tables:
  tm: string;  // top-middle (┬)
  bm: string;  // bottom-middle (┴)
  lm: string;  // left-middle (├)
  rm: string;  // right-middle (┤)
  mm: string;  // middle-middle (┼)
}
```

## Implementation Files

| File | Purpose |
|------|---------|
| `src/components/table.ts` | TableElement class |
| `src/components/table-section.ts` | thead/tbody/tfoot |
| `src/components/table-row.ts` | tr element |
| `src/components/table-cell.ts` | td/th elements |
| `src/components/colgroup.ts` | colgroup/col elements |

## Full Example

```xml
<table id="users" border="rounded">
  <colgroup resizable="true">
    <col width="5" align="right" />
    <col width="fill" minWidth="20" />
    <col width="15" />
    <col width="12" align="center" />
  </colgroup>

  <thead>
    <tr>
      <th sortable="true">ID</th>
      <th sortable="true">Name</th>
      <th sortable="true" onCompare="(a,b) => new Date(a) - new Date(b)">Created</th>
      <th>Actions</th>
    </tr>
  </thead>

  <tbody scrollable="true" maxHeight="15"
         selectable="multi"
         onSelect="$app.handleSelect(event)">
    ${users.map(u => `
      <tr data-id="${u.id}">
        <td>${u.id}</td>
        <td>${u.name}</td>
        <td>${u.created}</td>
        <td>
          <button label="✎" onClick="$app.edit('${u.id}')" />
          <button label="✕" onClick="$app.delete('${u.id}')" />
        </td>
      </tr>
    `).join('')}
  </tbody>

  <tfoot>
    <tr>
      <td colspan="3">Total: ${users.length} users</td>
      <td>
        <button label="Add" onClick="$app.addUser()" />
      </td>
    </tr>
  </tfoot>
</table>

<script>
export function handleSelect(event) {
  $melker.log.info(`Selected: ${event.selectedIds.join(', ')}`);
}
</script>
```

## Implementation Priority

1. **Phase 1**: Basic table structure (table, thead, tbody, tfoot, tr, td, th)
2. **Phase 2**: Column width calculation, alignment, borders
3. **Phase 3**: Scrollable tbody with sticky header/footer
4. **Phase 4**: Row selection (single, then multi)
5. **Phase 5**: Sorting with default and custom comparators
6. **Phase 6**: Column resizing

## Migration from Markdown Tables

Markdown tables in `<markdown>` component continue to work for simple cases. The new `<table>` component is for:
- Interactive cells (buttons, inputs)
- Scrollable data
- Complex layouts (colspan/rowspan)
- Fine-grained styling
- Row selection
- Sorting
- Column resizing
