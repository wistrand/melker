// Tooltip module exports

export type {
  TooltipConfig,
  TooltipContext,
  TooltipEvent,
  TooltipState,
  TooltipProvider,
  DataTableTooltipContext,
  DataBarsTooltipContext,
  DataHeatmapTooltipContext,
  ListTooltipContext,
} from './types.ts';

export {
  DEFAULT_TOOLTIP_CONFIG,
} from './types.ts';

export {
  TooltipManager,
  getTooltipManager,
  initTooltipManager,
} from './tooltip-manager.ts';

export {
  renderTooltipOverlay,
  isPointInTooltip,
} from './tooltip-renderer.ts';
