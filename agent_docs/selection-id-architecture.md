# Selection ID Architecture

Cross-component selection sync via string-based identity mapping.

## Summary

- String IDs bridge different internal selection primitives (group indices, row indices, entry+series) across data components
- `onGetId` prop maps raw items to string IDs; `IdSelectable` interface provides `getSelectedIds()` / `setSelectedIds()`
- Click-outside deselection fires events consistently across all five data components
- Select events include an `id` field alongside existing index-based fields
- Implemented on: `data-boxplot`, `data-table`, `data-bars`, `data-heatmap`, `data-tree`

## Interface

### `IdSelectable` — `src/core-types.ts`

```typescript
interface IdSelectable {
  setSelectedIds(ids: Set<string>): void;
  getSelectedIds(): Set<string>;
}
```

### Props

```typescript
onGetId?: (item: unknown) => string | undefined;  // Map raw item → selection ID
selectedIds?: string[];                            // Controlled selection by ID (declarative)
```

When both `selectedIds` and index-based props (`selectedRows`, etc.) are set, `selectedIds` wins. When `setSelectedIds()` is called with IDs that match no items, selection is cleared.

## `onGetId` handler

### What it receives

| Component      | Item passed to `onGetId`   | Type                                                                |
|----------------|---------------------------|---------------------------------------------------------------------|
| `data-boxplot`  | The `BoxplotGroup` object  | `{ label, values?, stats? }`                                       |
| `data-table`    | The row data array         | `CellValue[]` (e.g., `["SE3", "59.12", ...]`)                     |
| `data-bars`     | Synthetic item             | `{ values: BarValue[], label?: string, index: number }`            |
| `data-heatmap`  | Synthetic item             | `{ row: number, col: number, value: number, rowLabel?, colLabel? }` |
| `data-tree`     | The `TreeNode` object      | `{ id?, label, value?, values?, children?, ... }`                  |

Return `undefined` to exclude an item from ID-based selection.

### Code generation

`onGetId` is a pure mapping function called synchronously in tight loops. The generator auto-detects whether the code is an event property access or a function call:

| Syntax                        | Generated code             | Result          |
|-------------------------------|----------------------------|-----------------|
| `onGetId="event.label"`       | `return event.label`       | Property value  |
| `onGetId="event[0]"`          | `return event[0]`          | Array access    |
| `onGetId="$app.getId(event)"` | `return $app.getId(event)` | Call expression |
| `onGetId="$app.getId"`        | `return $app.getId(event)` | Function call   |
| `onGetId="getId"`             | `return __fn(event)`       | Function call   |

In `generator.ts`: `isEventAccess` check (`/^event[\.\[]/`) — if code starts with `event.` or `event[`, return as value; otherwise treat as a normal function call.

### Runner: synchronous callback

The runner wraps all `on*` handlers in an async wrapper for auto-render. `onGetId` bypasses this — the raw compiled function is stored directly on `element.props.onGetId`. Without this, `onGetId()` returns a `Promise<string>` instead of `string`, and `ids.has(Promise)` silently fails.

In `melker-runner.ts`:
- Added to `noAutoRenderCallbacks` (no auto-render after call)
- Stored as synchronous callback: `element.props[propName] = capturedHandlerFn`

## Selection flow

### Click within a component

1. User clicks item at index `i`
2. Component calls `onGetId(rawData[i])` → `"SE3"`
3. Component updates internal index-based selection
4. Component fires `onSelect`/`onChange` with `{ ..., id: "SE3" }`
5. On deselect (click-outside or toggle-off), fires event with `id: undefined`

### External selection via `setSelectedIds`

1. Caller invokes `component.setSelectedIds(new Set(["SE3"]))`
2. Component iterates its data, calls `onGetId(item)` for each
3. Finds matching indices, sets internal selection state
4. If no matches found, selection is cleared
5. Component renders with matched items highlighted

### Click-outside deselection

All five components clear selection and fire events on click-outside:

| Component      | Event fired                                                          |
|----------------|----------------------------------------------------------------------|
| `data-boxplot`  | `onSelect` with `{ groupIndex: -1, id: undefined }`                 |
| `data-table`    | `onChange`/`onSelect` with `{ selectedRows: [], id: undefined }`     |
| `data-bars`     | `onSelect` with `{ id: undefined }`                                  |
| `data-heatmap`  | `onSelect` with `{ id: undefined }`                                  |
| `data-tree`     | `onChange` with `{ selectedNodes: [], id: undefined }`               |

## Components

| Component      | Selection type | Internal state                     | `IdSelectable` | Public setters                             |
|----------------|----------------|------------------------------------|----------------|--------------------------------------------|
| `data-boxplot`  | Single toggle  | `_selectedGroups: Set<number>`     | Yes            | `get/setSelectedGroups()`                  |
| `data-table`    | Single/Multi   | `_selectedRows: Set<number>`       | Yes            | `getSelectedRows()`, `clearSelection()`    |
| `data-bars`     | Single         | `_selectedBar: {entry,series}?`    | Yes            | `getSelectedBar()`, `setSelectedBar()`, `clearSelection()` |
| `data-heatmap`  | Single cell    | `_selectedCell: {row,col}?`        | Yes            | `getSelectedCell()`, `setSelectedCell()`, `clearSelection()` |
| `data-tree`     | Single/Multi   | `_selectedNodes: Set<string>`      | Yes            | `getSelectedNodes()`                       |

**Out of scope:**
- `table-section` — already has `setSelectedIds()` via `data-id` attributes
- `select`/`combobox`/`autocomplete` — single-value pickers, not data visualization
- `list` — child-element based, not data-driven
- `file-browser` — domain-specific (paths), internal selection

## Usage

### Manual sync (without `bind:selection`)

```xml
<data-boxplot id="priceBoxplot" selectable="true"
              onGetId="event.label" onSelect="$app.selectArea(event)" />
<data-table   id="statsTable"    selectable="single"
              onGetId="event[0]"  onChange="$app.selectArea(event)" />
<data-bars    id="avgBars"       selectable="true"
              onGetId="event.label" onSelect="$app.selectArea(event)" />
```

```typescript
export function selectArea(event: { id?: string }): void {
  const id = event.id;
  const ids = id ? new Set([id]) : new Set<string>();
  $melker.getElementById('priceBoxplot')?.setSelectedIds(ids);
  $melker.getElementById('statsTable')?.setSelectedIds(ids);
  $melker.getElementById('avgBars')?.setSelectedIds(ids);
  if (id) updatePriceCurve(id);
}
```

### Automatic sync (with `bind:selection`)

```xml
<data-boxplot bind:selection="selectedAreas" onGetId="event.label" selectable="true"
              onSelect="$app.onSelect(event)" />
<data-table   bind:selection="selectedAreas" onGetId="event[0]"    selectable="single" />
<data-bars    bind:selection="selectedAreas" onGetId="event.label"  selectable="true" />
```

```typescript
const state = $melker.createState({ selectedAreas: [] as string[] });

export function onSelect(event: { id?: string }): void {
  if (event.id) updatePriceCurve(event.id);  // only side effects
}
```

See [bind-selection-architecture.md](bind-selection-architecture.md) for how the binding layer works.

## Performance

`setSelectedIds()` iterates all items calling `onGetId()` per item — O(n) linear scan. For typical dashboards (10-30 items) this is trivial. For large tables (10,000+ rows), an `id → index` cache could be added, invalidated on data change.

## Files

| File                             | What                                                    |
|----------------------------------|---------------------------------------------------------|
| `src/core-types.ts`              | `IdSelectable` interface                                |
| `src/melker-runner.ts`           | Synchronous callback bypass for `onGetId`               |
| `src/bundler/generator.ts`       | `isEventAccess` auto-detection for `onGetId`            |
| `src/components/data-boxplot.ts`  | `IdSelectable` impl, `onGetId`, deselect event          |
| `src/components/data-table.ts`    | `IdSelectable` impl, `onGetId`, click-outside deselect  |
| `src/components/data-bars.ts`     | `IdSelectable` impl, `onGetId`, click-outside, highlight |
| `src/components/data-heatmap.ts`  | `IdSelectable` impl, `onGetId`, click-outside, highlight |
| `src/components/data-tree.ts`     | `IdSelectable` impl, `onGetId`, click-outside deselect  |

## See Also

- [bind-selection-architecture.md](bind-selection-architecture.md) — `bind:selection` for automatic cross-component sync
- [state-binding-architecture.md](state-binding-architecture.md) — primary value binding (`bind="key"`)
- [data-boxplot-architecture.md](data-boxplot-architecture.md) — boxplot component details
- [data-table.md](data-table.md) — data table component details
- [data-bars.md](data-bars.md) — bar chart component details
- [data-heatmap-architecture.md](data-heatmap-architecture.md) — heatmap component details
- [data-tree-architecture.md](data-tree-architecture.md) — tree component details
