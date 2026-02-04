# Tooltip Architecture

## Overview

Tooltips are compact overlays that display contextual information when hovering over or focusing on elements. They use the `MarkdownElement` component for full markdown rendering support and can be triggered by mouse hover or keyboard focus.

## Module Structure

```
src/tooltip/
├── mod.ts              # Module exports
├── types.ts            # Interfaces and config
├── tooltip-manager.ts  # Singleton manager with delay timer
└── tooltip-renderer.ts # Renders tooltip box with MarkdownElement content
```

## Usage

### Static Tooltip

```xml
<button tooltip="Click to save">Save</button>
<button tooltip="Supports **markdown** and `code`">Help</button>
```

### Auto Tooltip (Data Components)

Data components provide built-in default formatting:

```xml
<data-table tooltip="auto">...</data-table>
<data-bars tooltip="auto">...</data-bars>
<data-heatmap tooltip="auto">...</data-heatmap>
```

Default formats:

| Component      | Format                                                                      |
|----------------|-----------------------------------------------------------------------------|
| `data-table`   | `**{columnHeader}**\n{cellValue}` (header: `**{header}**\nClick to sort`)   |
| `data-bars`    | `**{label}**\n{seriesName}: {value}`                                        |
| `data-heatmap` | `**{rowLabel} / {colLabel}**\nValue: {value}`                               |

### Auto Tooltip (getValue Fallback)

Components without `TooltipProvider` but with a `getValue()` method show their current value:

```xml
<input tooltip="auto" />      <!-- Shows input text -->
<slider tooltip="auto" />     <!-- Shows numeric value -->
<checkbox tooltip="auto" />   <!-- Shows true/false -->
```

### Custom Handler

For full control over tooltip content:

```xml
<data-table onTooltip="$app.getTooltip(event)">...</data-table>
```

```javascript
export function getTooltip(event) {
  if (!event.context) return undefined;
  const { row, columnHeader, cellValue } = event.context;
  if (row === -1) return `**${columnHeader}**\n_Click to sort_`;
  return `Row ${row + 1}: **${cellValue}**`;
}
```

Return `undefined` to suppress the tooltip.

## Trigger Methods

| Trigger        | Delay | Description                                 |
|----------------|-------|---------------------------------------------|
| Mouse hover    | 300ms | Tooltip appears after hovering over element |
| Keyboard focus | 800ms | Tooltip appears after tabbing to element    |
| Any key        | —     | Dismisses visible tooltip                   |

## TooltipEvent Interface

```typescript
interface TooltipEvent {
  x: number;           // Mouse X relative to component
  y: number;           // Mouse Y relative to component
  screenX: number;     // Absolute screen X
  screenY: number;     // Absolute screen Y
  element: Element;    // The hovered element
  context?: TooltipContext;  // Component-specific data
}
```

## Component Context Types

### data-table

```typescript
interface DataTableTooltipContext {
  type: 'data-table';
  row: number;          // -1 for header row
  column: number;
  columnHeader: string;
  cellValue: string;
}
```

### data-bars

```typescript
interface DataBarsTooltipContext {
  type: 'data-bars';
  barIndex: number;
  seriesIndex: number;
  label: string;
  value: number;
  seriesName: string;
}
```

### data-heatmap

```typescript
interface DataHeatmapTooltipContext {
  type: 'data-heatmap';
  row: number;
  column: number;
  rowLabel?: string;
  colLabel?: string;
  value: number;
}
```

## TooltipProvider Interface

Components that support tooltips implement:

```typescript
interface TooltipProvider {
  /** Get context for tooltip at relative coordinates */
  getTooltipContext?(relX: number, relY: number): TooltipContext | undefined;

  /** Get default tooltip content for auto tooltips */
  getDefaultTooltip?(context: TooltipContext): string | undefined;
}
```

## Configuration

```typescript
interface TooltipConfig {
  showDelay: number;       // Hover delay (default: 300ms)
  focusShowDelay: number;  // Focus delay (default: 800ms)
  maxWidth: number;        // Max width in chars (default: 50)
  minWidth: number;        // Min width in chars (default: 10)
  maxHeight: number;       // Max height in lines (default: 25)
}
```

## Behavior

| Aspect   | Behavior                                                     |
|----------|--------------------------------------------------------------|
| Show     | After delay (hover: 300ms, focus: 800ms)                     |
| Hide     | On hover exit, blur, mouse click, any key press, or mouse wheel |
| Update   | Immediate when content changes within same element           |
| Position | Below element, flips above if no room, clamped to viewport   |
| Nesting  | Only one tooltip visible at a time                           |

## Rendering

Tooltips are rendered as overlays on top of the main content:

1. **Bounds calculation** - Estimates size based on content lines and text wrapping
2. **Box drawing** - Renders rounded border with theme colors (`surface`, `border`)
3. **Content rendering** - Uses `MarkdownElement` for full markdown support including:
   - `**bold**` and `__bold__`
   - `*italic*` and `_italic_`
   - `` `code` ``
   - Headers, lists, links

The tooltip is positioned below the anchor point, flipping above if insufficient space.

## Implementation Files

| File                              | Purpose                                     |
|-----------------------------------|---------------------------------------------|
| `src/tooltip/types.ts`            | Config, event, and context interfaces       |
| `src/tooltip/tooltip-manager.ts`  | Singleton managing tooltip state and timers |
| `src/tooltip/tooltip-renderer.ts` | Box rendering, uses MarkdownElement         |
| `src/text-selection-handler.ts`   | Handles hover and focus tooltip triggers    |
| `src/engine-keyboard-handler.ts`  | Keyboard dismissal                          |
| `src/types.ts`                    | Base props (`tooltip`, `onTooltip`)         |
| `src/components/data-table.ts`    | `getTooltipContext`, `getDefaultTooltip`    |
| `src/components/data-bars.ts`     | `getTooltipContext`, `getDefaultTooltip`    |
| `src/components/data-heatmap.ts`  | `getTooltipContext`, `getDefaultTooltip`    |
