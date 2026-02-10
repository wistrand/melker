// Tooltip system type definitions

import type { Element, Bounds } from '../types.ts';

/** Tooltip configuration */
export interface TooltipConfig {
  /** Delay before showing tooltip on hover in ms (default: 300) */
  showDelay: number;
  /** Delay before showing tooltip on focus in ms (default: 800) */
  focusShowDelay: number;
  /** Maximum tooltip width in characters (default: 60) */
  maxWidth: number;
  /** Minimum tooltip width in characters (default: 10) */
  minWidth: number;
  /** Maximum tooltip height in lines (default: 20) */
  maxHeight: number;
}

/** Default tooltip configuration */
export const DEFAULT_TOOLTIP_CONFIG: TooltipConfig = {
  showDelay: 300,
  focusShowDelay: 800,
  maxWidth: 50,
  minWidth: 10,
  maxHeight: 25,
};

/** Base tooltip context - components extend this */
export interface TooltipContext {
  /** Component type identifier */
  type: string;
}

/** data-table specific context */
export interface DataTableTooltipContext extends TooltipContext {
  type: 'data-table';
  /** 0-indexed row number */
  row: number;
  /** 0-indexed column number */
  column: number;
  /** Column header text */
  columnHeader: string;
  /** Cell content */
  cellValue: string;
}

/** data-bars specific context */
export interface DataBarsTooltipContext extends TooltipContext {
  type: 'data-bars';
  /** Which bar (0-indexed) */
  barIndex: number;
  /** Which series within the bar */
  seriesIndex: number;
  /** Bar label */
  label: string;
  /** Bar value */
  value: number;
  /** Series name */
  seriesName: string;
}

/** data-heatmap specific context */
export interface DataHeatmapTooltipContext extends TooltipContext {
  type: 'data-heatmap';
  /** 0-indexed row */
  row: number;
  /** 0-indexed column */
  column: number;
  /** Row label if available */
  rowLabel?: string;
  /** Column label if available */
  colLabel?: string;
  /** Cell value */
  value: number;
}

/** data-tree specific context */
export interface DataTreeTooltipContext extends TooltipContext {
  type: 'data-tree';
  /** Node ID */
  nodeId: string;
  /** Node label */
  label: string;
  /** Node value if available (single-column mode) */
  value?: string | number | boolean | null | undefined;
  /** Per-column values (multi-column mode) */
  values?: (string | number | boolean | null | undefined)[];
  /** Ancestor label path from root */
  path: string[];
  /** Nesting depth (0 = root) */
  depth: number;
  /** Whether node is expanded */
  isExpanded?: boolean;
  /** Whether node has children */
  hasChildren: boolean;
}

/** list/scrollable specific context */
export interface ListTooltipContext extends TooltipContext {
  type: 'list';
  /** Which item is hovered (0-indexed) */
  itemIndex: number;
  /** Item's id if available */
  itemId?: string;
}

/** Event passed to onTooltip handler */
export interface TooltipEvent {
  /** Mouse X relative to component (0 = left edge) */
  x: number;
  /** Mouse Y relative to component (0 = top edge) */
  y: number;
  /** Absolute screen X coordinate */
  screenX: number;
  /** Absolute screen Y coordinate */
  screenY: number;
  /** The element being hovered */
  element: Element;
  /** Component-specific context */
  context?: TooltipContext;
}

/** Internal tooltip state */
export interface TooltipState {
  /** Element the tooltip is for */
  elementId: string;
  /** Tooltip content (markdown string) */
  content: string;
  /** Screen position where tooltip should appear */
  anchorX: number;
  anchorY: number;
  /** Element bounds for positioning */
  elementBounds: Bounds;
  /** Timestamp when tooltip was scheduled */
  scheduledAt: number;
  /** Whether tooltip is visible */
  visible: boolean;
}

/** Interface for components that provide tooltip context */
export interface TooltipProvider {
  /** Get context information for tooltip at relative coordinates */
  getTooltipContext?(relX: number, relY: number): TooltipContext | undefined;
  /** Get default tooltip content for the given context (used when tooltip="auto") */
  getDefaultTooltip?(context: TooltipContext): string | undefined;
}
