# Data Tree Component Architecture

A data-driven tree component for displaying hierarchical data with expand/collapse, selection, keyboard navigation, multi-column support, and virtual scrolling.

## Design Principles

Follows the same patterns as `data-table`, `data-bars`, and `data-heatmap`:

| Pattern                | Implementation                                                    |
|------------------------|-------------------------------------------------------------------|
| Data via props         | Array/object props, JSON-parsed from strings in constructor       |
| Inline JSON            | Text children parsed via shared `parseInlineJsonData()`           |
| Interfaces             | `Renderable`, `Focusable`, `Clickable`, `Interactive`, `TooltipProvider`, `TextSelectable` |
| Bounds tracking        | `Map<string, Bounds>` for click hit-testing via `boundsContain()` |
| Theme awareness        | Shared `isBwMode()` utility for color/bw rendering               |
| Shared utilities       | `component-utils.ts` (formatting, JSON parsing, bounds, theme)   |
| Text selection         | `getSelectableText()` returns indented plain text                 |
| Schema                 | `registerComponentSchema()` + `registerComponent()`              |
| Public API             | `getValue()`/`setValue()` + domain-specific methods               |

## Data Model

### TreeNode

```typescript
interface TreeNode {
  id?: string;            // Unique ID (auto-generated from label path if omitted)
  label: string;          // Display text
  value?: CellValue;      // Optional associated value (single-column mode)
  values?: CellValue[];   // Per-column values (multi-column mode, index maps to columns)
  icon?: string;          // Optional 1-char marker
  children?: TreeNode[];  // Child nodes (presence = branch, absence = leaf)
  expanded?: boolean;     // Initial state (default: false)
  disabled?: boolean;     // Grayed out, not selectable
}
```

### TreeColumn (multi-column mode)

```typescript
interface TreeColumn {
  header: string;
  width?: number | `${number}%` | 'fill';
  align?: 'left' | 'center' | 'right';
}
```

The tree column (first column) is implicit and always present. `columns` defines additional value columns. `values[0]` maps to the first additional column, `values[1]` to the second, etc.

## Props

```typescript
interface DataTreeProps {
  // Data
  nodes: TreeNode[];

  // Display
  showConnectors?: boolean;      // Branch lines (default: true)
  indent?: number;               // Characters per level (default: 2)
  expandAll?: boolean;           // Start fully expanded (default: false)
  showValues?: boolean;          // Show value column in single-column mode (default: false)
  border?: BorderStyle;          // Border around component

  // Multi-column
  columns?: TreeColumn[];        // Additional value columns (tree column is implicit)
  showColumnBorders?: boolean;   // Vertical separators (default: false)
  showHeader?: boolean;          // Column headers (default: true when columns defined)

  // Selection
  selectable?: 'none' | 'single' | 'multi';
  selectedNodes?: string[];      // Controlled selection by node ID
  onChange?: handler;            // Selection change
  onActivate?: handler;         // Enter / double-click

  // Expand/collapse
  onExpand?: handler;            // Node expanded (enables lazy loading)
  onCollapse?: handler;          // Node collapsed
}
```

### Style Props

| Property         | Type         | Default | Description                                       |
|------------------|--------------|---------|---------------------------------------------------|
| `border-color`   | `ColorInput` | inherit | Color for the box border (`┌─┐│└─┘`)             |
| `connector-color`| `ColorInput` | `gray`  | Color for tree connector lines (`│├└─`) and icons |

On selected/focused rows, both border and connector colors revert to the base style so they blend with the selection highlight.

When `columns` is omitted, renders as a simple single-column tree.

## Events

```typescript
interface TreeSelectEvent {
  nodeId: string;
  label: string;
  value?: CellValue;
  path: string[];            // Ancestor labels from root
  selectedNodes: string[];   // All selected IDs
}

interface TreeExpandEvent {
  nodeId: string;
  label: string;
  expanded: boolean;
  path: string[];
}

interface TreeActivateEvent {
  nodeId: string;
  label: string;
  value?: CellValue;
  path: string[];
}
```

The `onExpand` event enables lazy loading -- an app can listen for expand, fetch children, then call `setChildren(nodeId, children)`.

## Visual Rendering

### Single-Column (default)

```
+------------------------------+
| > src                        |
| | > components               |
| | | +-- button.ts            |
| | | +-- input.ts             |
| | | `-- table.ts             |
| | > utils                    |
| | `-- mod.ts                 |
| > tests                      |
| | `-- button.test.ts         |
| `-- README.md                |
+------------------------------+
```

Expand/collapse icons: `>` (collapsed) / `v` (expanded) in both color and BW modes.
Connectors: box-drawing characters `│`, `├─`, `└─` in color mode; `|`, `+-`, `` `- `` in BW mode.
Connectors and icons are rendered with `dim: true` (or `connectorColor` if set).

### Single-Column with Values

```
+------------------------------------+
| > src                              |
| | +-- engine.ts          12,450 B  |
| | +-- layout.ts           8,200 B  |
| | `-- types.ts            3,100 B  |
| > tests                            |
| | `-- engine.test.ts      2,800 B  |
| `-- README.md               580 B  |
+------------------------------------+
```

### Multi-Column

```
+- Name ----------------------+-- Size --+-- Type ---+
| > src                       |          | dir       |
| | > components              |          | dir       |
| | | +-- button.ts           |  4,200 B | ts        |
| | | +-- input.ts            |  3,800 B | ts        |
| | | `-- table.ts            | 12,450 B | ts        |
| | > utils                   |          | dir       |
| | `-- mod.ts                |  1,200 B | ts        |
| > tests                     |          | dir       |
| | `-- engine.test.ts        |  2,800 B | ts        |
| `-- README.md               |    580 B | md        |
+-----------------------------+----------+-----------+
```

Column width calculation reuses data-table's two-pass algorithm:
1. Pass 1: Calculate fixed (`number`) and percentage (`${number}%`) widths
2. Pass 2: Distribute remaining equally among `'fill'` columns
3. Tree column defaults to `'fill'` to get the most space

## Keyboard Navigation

| Key           | Action                                              |
|---------------|-----------------------------------------------------|
| `ArrowUp`     | Move to previous visible node                       |
| `ArrowDown`   | Move to next visible node                           |
| `ArrowRight`  | Expand branch / move to first child if expanded     |
| `ArrowLeft`   | Collapse branch / move to parent if leaf or collapsed |
| `Enter`       | Fire `onActivate`                                   |
| `Space`       | Toggle selection (multi) or expand/collapse (none)  |
| `Home`        | First visible node                                  |
| `End`         | Last visible node                                   |
| `PageUp/Down` | Scroll by viewport height                           |

## Virtual Scrolling

### FlatNode Array

The core data structure for virtual scrolling is `_flatVisibleNodes` -- a flattened array of only expanded/visible nodes in display order:

```typescript
interface FlatNode {
  node: TreeNode;
  depth: number;              // Nesting level (0 = root)
  nodeId: string;             // Resolved ID
  isLastChild: boolean;       // For connector choice
  ancestorIsLast: boolean[];  // For ancestor connector columns
}
```

Rebuilt when expand state changes or data is updated. Only recurses into expanded branches, so cost is O(visible nodes), not O(total nodes).

### Range-Based Rendering

Uses the filterable-list pattern (not data-table's skip-and-render):

```
totalContentLines = flatVisibleNodes.length
viewportLines = bodyHeight

start = scrollY
end = min(start + viewportLines, flatVisibleNodes.length)

render only flatVisibleNodes[start..end)
```

No `ViewportDualBuffer` clipping needed -- only visible rows are iterated and rendered.

### Performance

| Operation        | Cost                                    |
|------------------|-----------------------------------------|
| Render frame     | O(viewport) -- only visible rows        |
| Expand/collapse  | O(visible nodes) -- rebuild flat list   |
| Keyboard nav     | O(1) -- index arithmetic                |
| Click hit-test   | O(1) -- Map lookup                      |
| `scrollToNode()` | O(visible nodes) -- scan flat list      |
| Search/filter    | O(total nodes) -- must check all        |

For a 10k-node tree with 200 expanded, rendering is O(viewport ~ 30-50), not O(10k).

### Scrollbar

Uses existing `renderScrollbar()` utility with `scrollTop = scrollY`, `totalItems = flatVisibleNodes.length`, `visibleItems = viewportLines`.

## Internal State

```typescript
_expandedNodes: Set<string>;               // Which nodes are expanded
_selectedNodes: Set<string>;               // Which nodes are selected
_focusedNodeId: string | null;             // Currently focused node
_flatVisibleNodes: FlatNode[];             // Cached flattened visible list
_nodeBounds: Map<string, Bounds>;          // For click hit-testing
_scroll: ScrollManager;                    // Scroll state (scrollY, totalLines, viewportLines)
_columnWidths: number[];                   // Cached column widths (multi-column)
_headerCellBounds: Array<{ colIndex: number; bounds: Bounds }>;  // Header click zones
```

## Public API

```typescript
getValue(): TreeNode[];
setValue(nodes: TreeNode[]): void;
expandNode(nodeId: string): void;
collapseNode(nodeId: string): void;
expandAll(): void;
collapseAll(): void;
toggleNode(nodeId: string): void;
setChildren(nodeId: string, children: TreeNode[]): void;  // For lazy loading
getSelectedNodes(): string[];
scrollToNode(nodeId: string): void;
```

## Dynamic Update Stability

When data changes at runtime (`setValue()`, `setChildren()`, etc.), the tree must preserve visual state: scroll position, focused node, expanded nodes, and selection. This requires stable node identity and careful state restoration.

### Node ID Generation

When `id` is omitted, IDs are auto-generated from the label path (e.g., `"src/components/button.ts"`). This is stable across updates as long as labels don't change. For dynamic data where labels may change or duplicate siblings exist, explicit `id` fields should be used.

Index-based auto-IDs (e.g., `"0.1.2"`) are not used because inserting a sibling would shift all subsequent IDs, breaking expand/selection/focus state.

### Stable Rebuild Flow

When `setValue()` or `setChildren()` is called, `_rebuildFlatList()` follows this sequence:

```
1. Capture anchorNodeId = _flatVisibleNodes[_scroll.scrollY]?.nodeId
2. Capture focusedId = _focusedNodeId
3. Replace node data
4. Rebuild _flatVisibleNodes using preserved _expandedNodes
5. Restore _scroll.scrollY:
   - Find anchorNodeId's new index in _flatVisibleNodes
   - If found, set _scroll.scrollY to that index (view stays on same node)
   - If not found (node removed/collapsed), clamp to nearest valid position
6. Restore _focusedIndex:
   - Find focusedId's new index in _flatVisibleNodes
   - If not found (node removed/collapsed away), move focus to nearest surviving node
7. Prune _selectedNodes: remove IDs no longer present in the tree
8. Prune _expandedNodes: remove IDs no longer present (prevents unbounded set growth)
```

### What Each Method Preserves

| Method            | Expand state | Scroll position | Focus  | Selection |
|-------------------|--------------|-----------------|--------|-----------|
| `setValue()`      | Preserved    | Anchored        | Restored | Pruned  |
| `setChildren()`   | Preserved    | Anchored        | Restored | Pruned  |
| `expandNode()`    | Updated      | Stable          | Stable | Stable    |
| `collapseNode()`  | Updated      | Anchored        | Adjusted | Stable  |
| `expandAll()`     | Reset        | Reset to top    | Stable | Stable    |
| `collapseAll()`   | Reset        | Reset to top    | To root | Stable   |

For `collapseNode()`: if the focused node is a descendant of the collapsed node, focus moves to the collapsed node itself.

### ID Stability Guidelines for App Developers

- **Static data**: Auto-generated label-path IDs are sufficient
- **Dynamic data with stable labels**: Auto-generated IDs work
- **Dynamic data with changing labels or duplicate siblings**: Use explicit `id` fields
- **Lazy-loaded children** (`setChildren()`): Children should have explicit IDs if the parent may be re-expanded with different data

## Click Hit-Testing

For tree column clicks, distinguish between:
- **Expand/collapse icon region** (first `indent * depth + 2` characters): toggle expand
- **Label region** (remainder): select/activate the node

For multi-column header clicks: could support sorting by that column (future).

## Text Selection

`getSelectableText()` returns indented plain text:

```
src
  components
    button.ts
    input.ts
    table.ts
  utils
  mod.ts
tests
  button.test.ts
README.md
```

## Inline JSON Example

```xml
<data-tree selectable="single" onChange="$app.onSelect(event)">
{
  "nodes": [
    {
      "label": "src",
      "children": [
        { "label": "engine.ts", "value": "12,450 B" },
        { "label": "layout.ts", "value": "8,200 B" }
      ]
    },
    { "label": "README.md", "value": "580 B" }
  ]
}
</data-tree>
```

## Multi-Column Example

```xml
<data-tree
  columns='[{"header": "Size", "width": 10, "align": "right"}, {"header": "Type", "width": 8}]'
  showColumnBorders="true"
  selectable="single"
  onChange="$app.onSelect(event)"
>
{
  "nodes": [
    {
      "label": "src",
      "values": ["", "dir"],
      "children": [
        { "label": "engine.ts", "values": ["12,450 B", "ts"] },
        { "label": "layout.ts", "values": ["8,200 B", "ts"] }
      ]
    },
    { "label": "README.md", "values": ["580 B", "md"] }
  ]
}
</data-tree>
```

## Tooltip Support

Implements `TooltipProvider` with `getTooltipContext()` and `getDefaultTooltip()`.

### Context

```typescript
interface DataTreeTooltipContext {
  type: 'data-tree';
  nodeId: string;
  label: string;
  value?: CellValue;           // Single-column mode
  values?: CellValue[];        // Multi-column mode
  path: string[];              // Ancestor label path
  depth: number;
  isExpanded?: boolean;
  hasChildren: boolean;
}
```

### Auto Tooltip

With `tooltip="auto"`, the default tooltip shows:
- **Bold path** (e.g., `src > components > button.ts`)
- Column values (multi-column) or single value, formatted as `Header: value` lines

### Custom Tooltip

Use `onTooltip` handler for custom content:

```xml
<data-tree tooltip="custom" onTooltip="$app.handleTooltip(event)" ... />
```

## Potential Future Additions

- **Checkboxes with tri-state** -- parent auto-checks when all children checked
- **Drag-and-drop reordering** -- moving nodes between parents
- **Filtering** -- show matching nodes + ancestors (reuse `filterable-list/filter.ts`)
- **Column sorting** -- sort children within each parent by a column value

## Estimated Complexity

~1500 lines, comparable to data-bars (1176) and data-table (1282). Column rendering mirrors data-table's. Virtual scrolling is simpler than data-table's skip-and-render since it uses range-based indexing. Shared utilities (`component-utils.ts`, `scroll-manager.ts`) reduce duplication with other data components.
