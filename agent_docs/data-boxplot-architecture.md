# `data-boxplot` Component Architecture

## Summary

- Box-and-whisker plots rendered with `getBorderChars('thin')` (automatic unicode/ascii fallback)
- Shows median, quartiles (Q1/Q3), whiskers, and outliers
- Accepts raw values (auto-computes stats) or pre-computed statistics
- Character-based rendering (no canvas needed)
- Implements `Renderable`, `Focusable`, `Clickable`, `Interactive`, `TextSelectable`, `SelectableTextProvider`, `TooltipProvider`

## Overview

A data-driven box-and-whisker plot component for terminal UIs. Renders one or more groups as vertical boxplots with a shared Y-axis, labels, and optional outlier markers. Each boxplot column is 3 characters wide with 1-character gaps.

---

## 1. Data Model

```typescript
export interface BoxplotStats {
  min: number;       // Lower whisker end
  q1: number;        // First quartile (25th percentile)
  median: number;    // Median (50th percentile)
  q3: number;        // Third quartile (75th percentile)
  max: number;       // Upper whisker end
  outliers?: number[]; // Values beyond whisker fences
}

export interface BoxplotGroup {
  label: string;         // Bottom axis label (max 3 chars displayed)
  values?: number[];     // Raw values (component computes stats)
  stats?: BoxplotStats;  // OR pre-computed stats (takes priority)
}
```

---

## 2. Props Interface

```typescript
export interface DataBoxplotProps extends BaseProps {
  groups: BoxplotGroup[];       // Array of groups to plot
  title?: string;               // Chart title (top, centered, bold)
  yAxisLabel?: string;          // Y-axis label (rendered vertically, centered)
  showOutliers?: boolean;       // Show outlier markers (default: true)
  whiskerRule?: 'iqr' | 'minmax'; // Whisker calculation (default: 'iqr')
  selectable?: boolean;         // Enable click selection (default: false)
  onSelect?: (event: BoxplotSelectEvent) => void; // Selection callback
  onGetId?: (group: BoxplotGroup) => string | undefined; // Map group → selection ID
  selectedIds?: string[];       // Controlled selection by ID (overrides index-based)
  // bind:selection="key"       // Automatic cross-component sync via createState
}
```

### Whisker Rules

| Rule     | Behavior                                         |
|----------|--------------------------------------------------|
| `iqr`    | Whiskers to last value within 1.5 x IQR of box   |
| `minmax` | Whiskers to min/max values (no outliers reported) |

---

## 3. Rendering

### Character Set

Uses `getBorderChars('thin')` from `src/types.ts` — handles unicode tier fallback to `ascii` automatically. Only two extra characters defined locally:

- `_whiskerDot`: `·` (unicode) or `.` (ascii) — single-row whisker marker
- `_outlierChar`: `*` — outlier marker

### Character Mapping

| Element              | BorderChars field | Unicode | ASCII |
|----------------------|-------------------|---------|-------|
| Box top-left         | `tl`              | `┌`     | `+`   |
| Box top-right        | `tr`              | `┐`     | `+`   |
| Box bottom-left      | `bl`              | `└`     | `+`   |
| Box bottom-right     | `br`              | `┘`     | `+`   |
| Box sides / whisker  | `v`               | `│`     | `\|`  |
| Horizontal lines     | `h`               | `─`     | `-`   |
| Median left junction | `lm`              | `├`     | `+`   |
| Median right junction| `rm`              | `┤`     | `+`   |
| Whisker top end      | `tm`              | `┬`     | `+`   |
| Whisker bottom end   | `bm`              | `┴`     | `+`   |
| Y-axis tick          | `rm`              | `┤`     | `-`   |
| Axis corner          | `bl`              | `└`     | `+`   |

### Layout Structure

```
        Request Latency (ms)           <- title (centered, bold)
 734 ┤                                 <- Y-axis tick + label
     │       *                         <- outlier
     │       ┬                         <- whisker top (┬)
 500 ┤      ┌┴┐                        <- box top with whisker junction (┌┴┐)
     │      │ │                        <- box body (│ │)
 m   │      ├─┤                        <- median line (├─┤, bold)
 s   │      │ │                        <- box body
 250 ┤      └┬┘                        <- box bottom with whisker junction (└┬┘)
     │       │                         <- whisker shaft (│)
     │       ┴                         <- whisker bottom (┴)
   0 ┤
     └──────────────────               <- bottom axis (└───)
      API DB  Cch                      <- labels (truncated to 3 chars)
```

### Rendering Rules

- **Y-axis**: auto-scaled, max 6 ticks evenly distributed. Tick labels left-aligned. Width = max label length + 2. Rendered in `textMuted` theme color.
- **Axis lines**: Both the Y-axis and bottom axis line render in `textMuted` theme color for a faded appearance that recedes behind the data.
- **Value range**: 5% padding added above and below the global min/max.
- **Box (Q1 to Q3)**: top edge `┌─┐`, sides `│ │`, bottom edge `└─┘`.
- **Median**: `├─┤` (bold in non-BW mode) when inside a box with 3+ rows. At box edge: bold corners/edges with whisker junction preserved if whisker exists. Single-row box (Q1 === Q3): flat `───`.
- **Whisker with box junction**: top edge becomes `┌┴┐`, bottom edge becomes `└┬┘` (the junction char connects to the whisker shaft). When median is at a box edge, the junction character is preserved (not overwritten).
- **Whisker (2+ rows)**: `┬` at far end, `│` shaft, connects to box edge junction.
- **Whisker (1 row)**: `·` dot marker instead of `┬`/`┴`.
- **Zero-length whisker** (max === Q3 or min === Q1): flat box edge `┌─┐` / `└─┘`, no junction.
- **Outliers**: `*` rendered only outside the whisker range (skipped if they overlap box/whisker rows).
- **Labels**: truncated to 3 chars (column width), centered under column. Rendered in `textMuted` theme color.

### BW Mode

In BW mode (`isBwMode()`): box body fills center cell with `█` for visibility. Median and degenerate boxes use non-bold rendering.

---

## 4. Statistics Computation

When `values` is provided instead of `stats`, `computeStats()` runs:

1. **Sort** values ascending
2. **Quartiles** via linear interpolation (`percentile()` function):
   - Index = `p * (n - 1)`, interpolate between `sorted[floor]` and `sorted[ceil]`
3. **Whiskers** (IQR rule):
   - `IQR = Q3 - Q1`
   - Lower fence: `Q1 - 1.5 * IQR`
   - Upper fence: `Q3 + 1.5 * IQR`
   - Lower whisker: lowest value >= lower fence
   - Upper whisker: highest value <= upper fence
4. **Outliers**: values beyond fences

Stats are lazily computed via `_ensureStats()` and cached in `_computedStats[]`.

---

## 5. Tooltip Integration

Implements `TooltipProvider` with `getTooltipContext()` and `getDefaultTooltip()`.

Two tracking maps populated during render:
- `_groupBounds`: `Map<groupIndex, Bounds>` — hit area for each boxplot column
- `_outlierPositions`: `Map<"x,y", { groupIndex, value }>` — exact screen cell of each rendered outlier

Tooltip resolution order:
1. Check `_outlierPositions` for exact cell match (outlier-specific tooltip)
2. Fall back to `_groupBounds` containment check (group summary tooltip)

**Hovering a boxplot group** shows the five-number summary:

```
**Label**
Max: 700.0
Q3:  500.0
Med: 300.0
Q1:  150.0
Min: 120.0
Outliers: 900.0
```

**Hovering an outlier `*`** shows a focused tooltip:

```
**Label** outlier: 900.0
```

---

## 6. Selection

### Click Selection

When `selectable="true"`, clicking a group toggles its selection (reverse video highlight). Clicking outside any group clears the selection. Uses `_groupBounds` for hit testing via `handleClick()`.

```typescript
export interface BoxplotSelectEvent {
  type: 'select';
  groupIndex: number;
  label: string;
  stats: BoxplotStats;
  id?: string;              // Selection ID from onGetId (if configured)
}
```

The `onSelect` callback fires on every click regardless of `selectable` — `selectable` only controls the visual highlight state. Clicking outside any group clears selection and fires `onSelect` with `{ groupIndex: -1, id: undefined }`.

### Visual Feedback

Selected groups render all cells (box, whiskers, outliers, label) with `reverse: true`.

---

## 7. Text Selection & Copy

Implements `TextSelectable` and `SelectableTextProvider` for clipboard support (Alt+N / Alt+C).

Mouse-drag text selection over the component copies selected groups as JSON:

```json
[
  {
    "label": "USE",
    "values": [12, 14, 15, ...],
    "stats": {"min": 12, "q1": 16, "median": 20, "q3": 25, "max": 78}
  }
]
```

Selection highlight is clamped to the plot area (excludes title row and bottom axis labels) via `getSelectionHighlightBounds()`.

### Clipboard Toast

`getClipboardDescription()` provides a human-readable toast message instead of the default "N chars":

```
Copied 3 groups (USE, USW, EUW) to clipboard
```

---

## 8. Programmatic API

```typescript
// Getters/setters
boxplot.getGroups(): BoxplotGroup[]
boxplot.setGroups(groups: BoxplotGroup[]): void  // clears cached stats
boxplot.getStats(): BoxplotStats[]               // computes if needed

// Selection (index-based)
boxplot.getSelectedGroups(): Set<number>
boxplot.setSelectedGroups(indices: Set<number>): void

// Selection (ID-based — IdSelectable interface)
boxplot.getSelectedIds(): Set<string>
boxplot.setSelectedIds(ids: Set<string>): void
```

---

## 9. Example Usage

### Attribute-based (in .melker)

```html
<data-boxplot
  title="Response Times"
  tooltip="auto"
  selectable="true"
  groups='[
    {"label": "API", "values": [120, 150, 200, 300, 500, 900]},
    {"label": "DB",  "values": [50, 70, 90, 120, 200]}
  ]'
  style="height: 16"
/>
```

### Pre-computed stats

```html
<data-boxplot
  groups='[
    {"label": "Dev", "stats": {"min": 2, "q1": 5, "median": 8, "q3": 12, "max": 18}}
  ]'
/>
```

### Inline JSON

```html
<data-boxplot style="height: 14">
  {
    "title": "Memory Usage",
    "groups": [
      {"label": "Hep", "values": [128, 160, 200, 250, 320]},
      {"label": "RSS", "values": [256, 300, 350, 400, 450]}
    ]
  }
</data-boxplot>
```

### Programmatic (in script block)

```typescript
const boxplot = $melker.getElementById('myBoxplot');
boxplot.setGroups([
  { label: 'A', values: [10, 20, 30, 40, 50] },
  { label: 'B', stats: { min: 5, q1: 15, median: 25, q3: 35, max: 45 } },
]);
$melker.render();
```

---

## 10. Files

| File                                              | Role                     |
|---------------------------------------------------|--------------------------|
| [data-boxplot.ts](../src/components/data-boxplot.ts) | Component implementation |
| [mod.ts](../src/components/mod.ts)                | Export registration       |
| [types.ts](../src/tooltip/types.ts)               | Tooltip context type      |
| [data-boxplot.melker](../examples/components/data-boxplot.melker)           | Combined demo   |
| [data-boxplot-static.melker](../examples/components/data-boxplot-static.melker)   | Static example  |
| [data-boxplot-dynamic.melker](../examples/components/data-boxplot-dynamic.melker) | Dynamic example |
| [electricity-dashboard.melker](../examples/showcase/electricity-dashboard.melker) | Showcase: live EU electricity prices |

## See Also

- [selection-id-architecture.md](selection-id-architecture.md) — Cross-component selection sync via `onGetId`, `selectedIds`, `bind:selection`
