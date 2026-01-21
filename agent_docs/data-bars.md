# `data-bars` Component Architecture

## Overview

A data-driven bar chart component for terminal UIs. Renders bars using Unicode block characters with optional labels, supporting horizontal and vertical orientations, stacked or grouped bars, and sparkline mode for real-time data.

---

## 1. Data Model

```typescript
// Value type for bar data
export type BarValue = number | null | undefined;

// Bar data as 2D array: bars[entryIndex][seriesIndex] = value
export type DataBarsData = BarValue[][];

// Series definition
export interface DataBarSeries {
  name: string;           // Series name for legend/sparkline label
  color?: string;         // Optional color override
  stack?: string;         // Stack group ID (series with same stack are stacked)
}

// Event interfaces
export interface DataBarHoverEvent {
  type: 'hover';
  entryIndex: number;
  seriesIndex: number;
  value: BarValue;
  label?: string;
}

export interface DataBarSelectEvent {
  type: 'select';
  entryIndex: number;
  seriesIndex: number;
  value: BarValue;
  label?: string;
}
```

---

## 2. Props Interface

```typescript
export interface DataBarsProps extends BaseProps {
  // Data (required)
  series: DataBarSeries[];        // Series definitions
  bars: DataBarsData;             // 2D array: bars[entryIndex][seriesIndex]
  labels?: string[];              // Category labels (same length as bars)

  // Display
  showLabels?: boolean;           // Show labels (default: true)
  showValues?: boolean;           // Show values (default: false)
  valueFormat?: 'value' | 'sum' | 'last/max' | 'percent';  // Auto-detects
  showLegend?: boolean;           // Show series legend (default: false)
  showAxis?: boolean;             // Show value axis (default: true)

  // Scale
  min?: number;                   // Minimum value (auto-calculated)
  max?: number;                   // Maximum value (auto-calculated)

  // Interaction
  selectable?: boolean;           // Enable bar selection (default: false)
  onHover?: (event: DataBarHoverEvent) => void;
  onSelect?: (event: DataBarSelectEvent) => void;
}
```

### Style Props

These are set via `style=""` attribute, not direct props:

| Style Prop | Type | Default | Description |
|------------|------|---------|-------------|
| `orientation` | `'horizontal'` \| `'vertical'` | `'horizontal'` | Bar direction |
| `barWidth` | `number` | `1` | Bar thickness in characters |
| `gap` | `number` | `1` | Gap between entries |

```xml
<data-bars style="orientation: vertical; height: 10; gap: 0" ... />
```

---

## 3. Unicode Bar Characters

```typescript
// Horizontal bars (fractional blocks, left to right)
const H_BAR_CHARS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];  // 0-8 eighths

// Vertical bars (fractional blocks, bottom to top)
const V_BAR_CHARS = ['', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];  // 0-8 eighths

const FULL_BLOCK = '█';

// BW mode patterns for multi-series (no sub-char precision)
const BW_PATTERNS = ['█', '▓', '▒', '░'];
```

---

## 4. Theme-Aware Rendering

### Color/Fullcolor Modes
- Uses grayscale palette for multi-series differentiation
- Darker grays (45-150 range) visible against light backgrounds
- Fractional block characters for sub-character precision
- Stacked bars use fg/bg colors to eliminate gaps in partial blocks

### BW Mode
- Single series: fractional characters (▏▎▍▌▋▊▉█ or ▁▂▃▄▅▆▇█)
- Multi-series: pattern characters (█▓▒░) with whole-character rounding
- No sub-character precision for multi-series (patterns don't support it)

```typescript
// Grayscale palette for color modes (no white/near-white)
const GRAYSCALE_PALETTE: PackedRGBA[] = [
  packRGBA(60, 60, 60, 255),    // Dark gray
  packRGBA(120, 120, 120, 255), // Medium-dark gray
  packRGBA(90, 90, 90, 255),    // Darker gray
  packRGBA(150, 150, 150, 255), // Medium gray
  packRGBA(45, 45, 45, 255),    // Very dark gray
  packRGBA(105, 105, 105, 255), // Mid gray
];
```

---

## 5. Rendering Modes

### Horizontal Bars (bars extend right)
```
Q1 ████████████████████████████████████████████████████████████████████████ 100
Q2 ████████████████████████████████████████████████████████████████████████████████████████████████████████ 150
Q3 █████████████████████████████████████████████████████████ 80
```

### Vertical Bars (bars extend up)
```
100 150 80
   █
   █
█  █
█  █  █
█  █  █
Q1 Q2 Q3
```

### Stacked Bars (same stack group)
```
Jan █████████████████████████████████████▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░ 100
```
- Series with same `stack` value are rendered consecutively
- Uses fg/bg color trick to eliminate gaps in partial blocks

### Grouped Bars (different series, no stacking)
```
Q1 ██████████████████████████████████████████████████████████████████████ 50
   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 65
```

### Sparkline Mode (no labels, height: 1)
```
CPU:▁▂▃▅▇█▇▅▃▂ 80/85
MEM:▃▃▄▅▇█████  89%
```
- Triggered when `labels` is empty/omitted
- Uses `series[].name` as row label
- Each entry = one character
- Keeps fractional precision even in BW mode (single row per series)

---

## 6. Class Structure

```typescript
export class DataBarsElement extends Element implements
  Renderable, Focusable, Clickable, Interactive
{
  declare type: 'data-bars';
  declare props: DataBarsProps;

  private _barBounds: Map<string, Bounds> = new Map();  // "entry-series" -> bounds
  private _minValue: number = 0;
  private _maxValue: number = 0;
  private _scale: number = 1;
  private _selectedBar: { entry: number; series: number } | null = null;

  // Style prop accessors
  private _getOrientation(): 'horizontal' | 'vertical';
  private _getBarWidth(): number;
  private _getGap(): number;

  // Theme-aware helpers
  private _isBwMode(): boolean;
  private _getSeriesColor(seriesIndex: number): PackedRGBA | undefined;
  private _getSeriesPattern(seriesIndex: number): string;

  // Scale calculation
  private _calculateScale(): void;
  private _valueToEighths(value: number, availableLength: number): number;

  // Rendering
  private _renderHorizontalBar(buffer, x, y, eighths, style, pattern?): number;
  private _renderVerticalBar(buffer, x, baseY, eighths, style, pattern?): number;
  private _renderHorizontal(bounds, style, buffer): void;
  private _renderVertical(bounds, style, buffer): void;
  private _renderSparklines(bounds, style, buffer): void;

  // Public API
  getValue(): DataBarsData;
  setValue(bars: DataBarsData): void;
  appendEntry(values: BarValue[], label?: string): void;
  shiftEntry(): void;
}
```

---

## 7. Component Schema

```typescript
export const dataBarsSchema: ComponentSchema = {
  description: 'Data-driven bar chart with stacking and sparkline support.',
  props: {
    series: { type: 'array', description: 'Series definitions' },
    bars: { type: 'array', description: 'Bar data as 2D array: bars[entry][series]' },
    labels: { type: 'array', description: 'Category labels array (optional)' },
    showLabels: { type: 'boolean', description: 'Show labels (default: true)' },
    showValues: { type: 'boolean', description: 'Show values (default: false)' },
    valueFormat: { type: 'string', enum: ['value', 'sum', 'last/max', 'percent'] },
    showLegend: { type: 'boolean', description: 'Show series legend (default: false)' },
    showAxis: { type: 'boolean', description: 'Show value axis (default: true)' },
    min: { type: 'number', description: 'Minimum scale value' },
    max: { type: 'number', description: 'Maximum scale value' },
    selectable: { type: 'boolean', description: 'Enable bar selection (default: false)' },
    onHover: { type: 'handler', description: 'Hover event handler' },
    onSelect: { type: 'handler', description: 'Selection event handler' },
  },
  styles: {
    orientation: { type: 'string', enum: ['horizontal', 'vertical'], description: 'Bar direction (default: horizontal)' },
    barWidth: { type: 'number', description: 'Bar thickness in characters (default: 1)' },
    gap: { type: 'number', description: 'Gap between entries (default: 1)' },
  },
};
```

---

## 8. Usage Examples

### Simple Horizontal Bars
```xml
<data-bars
  series='[{"name": "Sales"}]'
  bars='[[100], [150], [80], [120]]'
  labels='["Q1", "Q2", "Q3", "Q4"]'
  showValues="true"
/>
```

### Grouped Bars (Multiple Series)
```xml
<data-bars
  series='[{"name": "2023"}, {"name": "2024"}]'
  bars='[[50, 65], [60, 80], [45, 70]]'
  labels='["Q1", "Q2", "Q3"]'
  showValues="true"
/>
```

### Stacked Bars
```xml
<data-bars
  series='[
    {"name": "A", "stack": "total"},
    {"name": "B", "stack": "total"},
    {"name": "C", "stack": "total"}
  ]'
  bars='[[30, 20, 15], [25, 30, 20], [35, 25, 25]]'
  labels='["Jan", "Feb", "Mar"]'
  showValues="true"
  valueFormat="sum"
/>
```

### Vertical Bars
```xml
<data-bars
  series='[{"name": "Sales"}]'
  bars='[[40], [75], [55], [90]]'
  labels='["Q1", "Q2", "Q3", "Q4"]'
  showValues="true"
  style="orientation: vertical; height: 10"
/>
```

### Sparkline
```xml
<data-bars
  series='[{"name": "CPU"}]'
  bars='[[10], [25], [40], [55], [70], [85], [75], [60], [45], [30]]'
  showValues="true"
  style="orientation: vertical; height: 1; gap: 0"
/>
<!-- Output: CPU:▁▂▄▅▇█▇▆▄▃ 30/85 -->
```

### Real-time Streaming Sparkline
```xml
<data-bars
  id="liveSparkline"
  series='[{"name": "LIVE"}]'
  bars='[]'
  showValues="true"
  max="100"
  style="orientation: vertical; height: 1; gap: 0"
/>

<script type="typescript">
  const MAX_POINTS = 30;

  setInterval(() => {
    const sparkline = $melker.getElementById('liveSparkline');
    sparkline.appendEntry([Math.random() * 100]);

    if (sparkline.getValue().length > MAX_POINTS) {
      sparkline.shiftEntry();
    }

    $melker.render();
  }, 1000);
</script>
```

---

## 9. File Location

`src/components/data-bars.ts`

Exported from `src/components/mod.ts`.
