# `data-heatmap` Component Architecture

## Overview

A data-driven heatmap component for terminal UIs. Renders 2D value grids as colored cells with optional isolines (contour lines).

---

## 1. Data Model

```typescript
// Cell value (null = missing data, rendered as gap)
export type HeatmapValue = number | null | undefined;

// Grid data as 2D array: grid[row][col] = value
export type HeatmapGrid = HeatmapValue[][];

// Isoline definition
export interface Isoline {
  value: number;           // Value at which to draw the contour
  color?: string;          // Line color (default: theme foreground)
  label?: string;          // Optional label (e.g., "100")
}
```

**Why this format:**
- Mirrors data-bars: `bars[entry][series]` → `grid[row][col]`
- Row-major matches how you'd write it in XML/JSON
- Null handling consistent with data-bars

---

## 2. Props Interface

```typescript
export interface DataHeatmapProps extends BaseProps {
  // Data
  grid?: HeatmapGrid;             // 2D array: grid[row][col]
  rows?: number;                  // Initial row count (for sizing when grid is empty)
  cols?: number;                  // Initial column count (for sizing when grid is empty)

  // Labels (optional)
  rowLabels?: string[];           // Y-axis labels (left side)
  colLabels?: string[];           // X-axis labels (top or bottom)

  // Value range
  min?: number;                   // Minimum value (auto-calculated)
  max?: number;                   // Maximum value (auto-calculated)

  // Color mapping
  colorScale?: 'viridis' | 'plasma' | 'inferno' | 'thermal' |
               'grayscale' | 'diverging' | 'greens' | 'reds';

  // Isolines
  isolines?: Isoline[];           // Contour lines at specific values (manual)
  isolineCount?: number;          // Auto-generate N isolines (overrides isolines if set)
  isolineMode?: 'equal' | 'quantile' | 'nice';  // Algorithm for auto-generation (default: 'equal')
  showIsolineLabels?: boolean;    // Show value labels on isolines

  // Display
  showCells?: boolean;            // Show cell backgrounds (default: true). Set to false for isolines-only display
  showValues?: boolean;           // Show numeric values in cells
  valueFormat?: string;           // Format string (e.g., '.1f', 'd', '.0%')
  minCellWidth?: number;          // Minimum cell width in characters
  showLegend?: boolean;           // Show color scale legend
  showAxis?: boolean;             // Show axis labels (default: true)

  // Interaction
  selectable?: boolean;
  onHover?: (event: HeatmapHoverEvent) => void;
  onSelect?: (event: HeatmapSelectEvent) => void;
}
```

### Style Props

| Style Prop   | Type   | Default  | Description                                      |
|--------------|--------|----------|--------------------------------------------------|
| `cellWidth`  | number | 2 (auto) | Cell width in characters (auto-sizes for values) |
| `cellHeight` | number | 1        | Cell height in characters                        |
| `gap`        | number | 0        | Gap between cells (min 1 when isolines present)  |

---

## 3. Rendering

Cells are rendered as colored backgrounds using the selected color scale. When `isolines` are provided, box-drawing characters are rendered in dedicated rows between data rows.

### Heat Cells

One terminal cell = one data cell, colored via background color.

```
     Mon Tue Wed Thu Fri
 9am  ██  ██  ██  ██  ██
10am  ██  ██  ██  ██  ██
11am  ██  ██  ██  ██  ██
```

- Background color from color scale (based on value)
- Values right-aligned within cell when `showValues` is true
- Foreground color auto-selected for contrast

### Isolines

When `isolines` prop is provided, contour lines are rendered using box-drawing characters between data rows. Box-drawing characters are placed at the center of each cell, with horizontal lines connecting between cell centers.

#### Example

**Data:** Temperature readings across a 6x8 grid with isolines at 20°C, 30°C, 40°C:

```
         Col1  Col2  Col3  Col4  Col5  Col6  Col7  Col8
       ┌──────────────────────────────────────────────────┐
  Row1 │  ░░    ░░    ▒▒    ▒▒────▓▓    ▓▓    ██    ██   │
       │              20°─╮                               │
  Row2 │  ░░    ▒▒    ▒▒  │ ▓▓────██    ██    ██    ██   │
       │                  ╰─────30°─╮                     │
  Row3 │  ▒▒    ▒▒    ▓▓    ██    ██│   ██────██    ██   │
       │                            │40°╮                 │
  Row4 │  ▒▒    ▓▓    ▓▓    ██    ██│   ██    ██    ██   │
       │                            ╰────────────────     │
  Row5 │  ▒▒    ▒▒    ▓▓    ██────██    ██    ██    ██   │
       │              ╭──30°──╯                           │
  Row6 │  ░░    ▒▒    ▒▒    ▓▓    ██────██    ██    ██   │
       │        ╰20°──╯                                   │
       └──────────────────────────────────────────────────┘

Legend: ░░ <20  ▒▒ 20-30  ▓▓ 30-40  ██ >40
```

**With values (showValues=true):**

```
       ┌─────────────────────────────────────────────────────────────┐
  Row1 │  12     15     18     22  ───  25     28     30     32     │
       │                      20°─╮                                  │
  Row2 │  14     17     21     │  26  ───  30     33     35     36  │
       │                       ╰──────30°─╮                          │
  Row3 │  16     20     25     31     36  │  40  ───  42     43     │
       │                                  │40°╮                      │
  Row4 │  18     23     29     35     41  │  45     47     48       │
       │                                  ╰───────────────────       │
  Row5 │  17     21     27     33  ───  39     43     45     46     │
       │                     ╭──30°──╯                               │
  Row6 │  15     18     23     28     33  ───  37     40     41     │
       │              ╰20°───╯                                       │
       └─────────────────────────────────────────────────────────────┘
       (cells have colored backgrounds; values use contrasting foreground)
```

#### Grid Layout

To accommodate isolines between cells, the grid uses alternating rows:

```
Row 0: ──────── Col labels ────────
Row 1: [heat] [heat] [heat] [heat]    ← data row 0
Row 2: ─────╮──────╰─────────────     ← isoline row (between data 0 and 1)
Row 3: [heat] [heat] [heat] [heat]    ← data row 1
Row 4: ──────────────────────────     ← isoline row
...
```

Each data row takes `cellHeight` characters. Each isoline row takes 1 character.

### Box-Drawing Character Mapping

Marching squares determines which cell edges the isoline crosses:

```typescript
// Box-drawing lookup based on marching squares case
// Corners: topLeft(8), topRight(4), bottomRight(2), bottomLeft(1)
const MARCHING_SQUARES_CHARS: Record<number, string | null> = {
  0b0000: null,  // All below - no line
  0b0001: '╮',   // BL above
  0b0010: '╭',   // BR above
  0b0011: '─',   // BL,BR above (horizontal)
  0b0100: '╰',   // TR above
  0b0101: '│',   // TR,BL above (saddle)
  0b0110: '│',   // TR,BR above (vertical)
  0b0111: '╯',   // Only TL below
  0b1000: '╯',   // Only TL above
  0b1001: '│',   // TL,BL above (vertical)
  0b1010: '│',   // TL,BR above (saddle)
  0b1011: '╰',   // Only TR below
  0b1100: '─',   // TL,TR above (horizontal)
  0b1101: '╭',   // Only BR below
  0b1110: '╮',   // Only BL below
  0b1111: null,  // All above - no line
};
```

---

## 4. Color Scales

### Built-in Palettes

| Name        | Direction      | Description                   | Use Case                      |
|-------------|----------------|-------------------------------|-------------------------------|
| `viridis`   | dark → light   | Purple → teal → yellow        | Default, colorblind-safe      |
| `plasma`    | dark → light   | Purple → pink → yellow        | Intensity, density            |
| `inferno`   | dark → light   | Black → red → yellow          | Heat, energy                  |
| `thermal`   | cold → hot     | Blue → cyan → yellow → red    | Temperature                   |
| `grayscale` | dark → light   | Black → white                 | BW-safe, print                |
| `diverging` | cold ↔ hot     | Blue → white → red            | Anomalies, centered data      |
| `greens`    | light → dark   | White → green                 | Positive values, growth       |
| `reds`      | light → dark   | White → red                   | Alerts, warnings              |

### BW Mode Fallback

When theme is BW:
- Use pattern characters (` `, `░`, `▒`, `▓`, `█`) for value bins
- Provides 5-level density mapping

---

## 5. Cell Values

When `showValues` is true, numeric values are rendered inside cells using foreground text on a background-colored cell.

### Cell Sizing

Cell width auto-sizes when `showValues` is true:

| Data Range  | Format    | Example | Min Width |
|-------------|-----------|---------|-----------|
| 0-99        | integer   | `42`    | 2         |
| 0-999       | integer   | `123`   | 3         |
| 0.0-9.9     | 1 decimal | `3.7`   | 3         |
| 0.00-9.99   | 2 decimal | `3.14`  | 4         |
| percentages | percent   | `85%`   | 3-4       |

Use `minCellWidth` prop to enforce a minimum width.

### Contrast Color Selection

Foreground color is auto-selected for readability based on background luminance (ITU-R BT.709):

```typescript
const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
return luminance > 0.5 ? black : white;
```

### Value Formatting

`valueFormat` uses printf-style format specifiers:

| Format | Output  | Use Case               |
|--------|---------|------------------------|
| `d`    | `42`    | Integers               |
| `.1f`  | `3.1`   | 1 decimal place        |
| `.2f`  | `3.14`  | 2 decimal places       |
| `.0%`  | `85%`   | Percentage (value×100) |
| `.1%`  | `85.5%` | Percentage with decimal|

Default: auto-detect based on data (integers if all whole numbers, else `.1f`).

---

## 6. Usage Examples

### Simple Heatmap

```xml
<data-heatmap
  grid='[[1, 2, 3], [4, 5, 6], [7, 8, 9]]'
  rowLabels='["A", "B", "C"]'
  colLabels='["X", "Y", "Z"]'
/>
```

### With Isolines

```xml
<data-heatmap
  grid='[[10, 20, 30], [25, 50, 35], [30, 40, 20]]'
  isolines='[{"value": 25, "label": "25"}, {"value": 40, "label": "40"}]'
  showIsolineLabels="true"
  colorScale="thermal"
/>
```

### Inline JSON

```xml
<data-heatmap>
{
  "grid": [[1, 2], [3, 4]],
  "rowLabels": ["Row1", "Row2"],
  "colLabels": ["Col1", "Col2"]
}
</data-heatmap>
```

### With Values

```xml
<data-heatmap
  grid='[[12, 45, 78], [23, 56, 89], [34, 67, 99]]'
  showValues="true"
  valueFormat="d"
  style="cellWidth: 4;"
/>
```

### Auto-Generated Isolines

Instead of specifying exact isoline values, use `isolineCount` to auto-generate isolines:

```xml
<!-- Auto-generate 4 isolines using equal intervals -->
<data-heatmap
  grid='[[10, 20, 30, 40], [20, 40, 60, 80], [30, 60, 90, 120]]'
  isolineCount="4"
  isolineMode="equal"
  showIsolineLabels="true"
/>
```

**Modes:**

| Mode       | Description                                      | Use Case                         |
|------------|--------------------------------------------------|----------------------------------|
| `equal`    | Evenly spaced between min and max values         | Default, uniform data            |
| `quantile` | Values at data percentiles (e.g., 25%, 50%, 75%) | Skewed distributions             |
| `nice`     | Rounds to "nice" numbers (5, 10, 25, 50, 100...) | Human-readable labels            |

Note: `isolineCount` overrides `isolines` if both are specified.

### Isolines-Only Display

Set `showCells="false"` to hide cell backgrounds and show only the contour lines. When cells are invisible, isoline segments extend through the full cell dimensions (both horizontally and vertically) for smoother, more continuous contour curves.

```xml
<data-heatmap
  grid='[[10, 20, 30, 40], [15, 35, 45, 50], [20, 40, 55, 60], [25, 45, 50, 45]]'
  isolines='[{"value": 30, "label": "30"}, {"value": 50, "label": "50"}]'
  showCells="false"
  showIsolineLabels="true"
/>
```

**Isolines-only output:**
```
       ─────────╮
             ───╰────────30
 ──────────────────╮
               ────╰─────50
```

### Dynamic Update

```xml
<data-heatmap id="heatmap" grid='[]' />

<script type="typescript">
  export function updateCell(row: number, col: number, value: number) {
    const hm = $melker.getElementById('heatmap');
    const grid = hm.getValue();
    grid[row][col] = value;
    hm.setValue(grid);
  }
</script>
```

---

## 7. API Methods

```typescript
class DataHeatmapElement extends Element {
  // Get/set entire grid
  getValue(): HeatmapGrid;
  setValue(grid: HeatmapGrid): void;

  // Get/set single cell
  getCell(row: number, col: number): HeatmapValue;
  setCell(row: number, col: number, value: HeatmapValue): void;

  // Bulk operations
  setRow(row: number, values: HeatmapValue[]): void;
  setColumn(col: number, values: HeatmapValue[]): void;

  // Labels
  getRowLabels(): string[] | undefined;
  setRowLabels(labels: string[]): void;
  getColLabels(): string[] | undefined;
  setColLabels(labels: string[]): void;
}
```

---

## 8. Events

```typescript
interface HeatmapHoverEvent {
  type: 'hover';
  row: number;
  col: number;
  value: HeatmapValue;
  rowLabel?: string;
  colLabel?: string;
}

interface HeatmapSelectEvent {
  type: 'select';
  row: number;
  col: number;
  value: HeatmapValue;
  rowLabel?: string;
  colLabel?: string;
}
```

---

## 9. Text Selection

Supports copying selected region as JSON via Alt+C:

```json
{
  "grid": [[1, 2], [3, 4]],
  "rowLabels": ["A", "B"],
  "colLabels": ["X", "Y"]
}
```

---

## 10. Design Decisions

1. **Aspect ratio:** Cells are 1 line tall by default (`cellHeight: 1`). Terminal cells are ~2:1, so a 2-char wide cell appears roughly square.

2. **Large grids:** Grid size is intrinsic (rows × cellHeight, cols × cellWidth). Wrap in a scrollable container if needed:
   ```xml
   <container style="overflow: scroll; height: 20;">
     <data-heatmap grid="..." />
   </container>
   ```

3. **Isoline gap:** When isolines are present, a minimum 1-character gap is enforced between columns for proper rendering.

---

## Files

| File                             | Purpose                  |
|----------------------------------|--------------------------|
| `src/components/data-heatmap.ts` | Component implementation |

Export from `src/components/mod.ts`.

---

## See Also

- [data-bars.md](data-bars.md) — Similar data-driven component
- [data-table.md](data-table.md) — Grid-based data display
