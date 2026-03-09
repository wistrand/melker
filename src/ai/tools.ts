// AI Tool System for UI Control
// Defines tools that the AI assistant can use to interact with the UI

import { Document } from '../document.ts';
import { FocusManager } from '../focus.ts';
import { getLogger } from '../logging.ts';
import { hasKeyInputHandler, hasGetContent } from '../types.ts';
import { ensureError } from '../utils/error.ts';
import { GFX_MODES } from '../core-types.ts';
import { DITHER_MODES } from '../video/dither/mod.ts';
import { resolveVarReferences } from '../stylesheet.ts';
import { createElement } from '../element.ts';

const logger = getLogger('ai:tools');

// Tool parameter types
export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object';
  description: string;
  required?: boolean;
  enum?: string[];
}

// Tool definition
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
}

// Custom tool with handler function (for .melker files)
export interface CustomToolDefinition extends ToolDefinition {
  handler: (args: Record<string, unknown>, context: ToolContext) => ToolResult | Promise<ToolResult>;
}

// Tool call from the model
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// Tool result
export interface ToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

// Context for tool execution
export interface ToolContext {
  document: Document;
  focusManager: FocusManager | null;
  closeDialog: () => void;
  exitProgram: () => void | Promise<void>;
  render: () => void;
}

// =============================================================================
// Custom Tool Registry (for .melker files)
// =============================================================================

class CustomToolRegistry {
  private _tools: Map<string, CustomToolDefinition> = new Map();

  register(tool: CustomToolDefinition): void {
    if (this._tools.has(tool.name)) {
      logger.warn('Overwriting existing custom tool', { name: tool.name });
    }
    logger.info('Registering custom AI tool', { name: tool.name });
    this._tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this._tools.delete(name);
  }

  get(name: string): CustomToolDefinition | undefined {
    return this._tools.get(name);
  }

  getAll(): CustomToolDefinition[] {
    return Array.from(this._tools.values());
  }

  clear(): void {
    this._tools.clear();
  }
}

// Global instance
const globalCustomToolRegistry = new CustomToolRegistry();

/**
 * Register a custom AI tool from a .melker file
 * @example
 * registerAITool({
 *   name: "increment_counter",
 *   description: "Increase the counter value",
 *   parameters: {
 *     amount: { type: "number", required: false, description: "Amount to add" }
 *   },
 *   handler: (args) => {
 *     state.count += args.amount || 1;
 *     return { success: true, message: "Counter incremented" };
 *   }
 * });
 */
export function registerAITool(tool: CustomToolDefinition): void {
  globalCustomToolRegistry.register(tool);
}

/**
 * Unregister a custom AI tool
 */
export function unregisterAITool(name: string): boolean {
  return globalCustomToolRegistry.unregister(name);
}

/**
 * Get all registered custom tools
 */
export function getCustomTools(): CustomToolDefinition[] {
  return globalCustomToolRegistry.getAll();
}

/**
 * Clear all custom tools (useful when reloading .melker files)
 */
export function clearCustomTools(): void {
  globalCustomToolRegistry.clear();
}

// =============================================================================
// Built-in Tools
// =============================================================================

// All available tools
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'send_event',
    description: 'Send an event to a UI element to interact with it. Use this to click buttons, toggle checkboxes, select items, type in inputs, etc.',
    parameters: {
      element_id: {
        type: 'string',
        description: 'The ID of the element to send the event to',
        required: true,
      },
      event_type: {
        type: 'string',
        description: 'The type of event to send',
        required: true,
        enum: ['click', 'change', 'focus', 'keypress', 'draw', 'set_prop', 'style_element', 'add_connector', 'remove_connector'],
      },
      value: {
        type: 'string',
        description: 'For change events, the new value. For keypress events, the key to press. For draw events on tile-map, SVG path elements using SVG coordinate order (x=lon, y=lat). For draw events on canvas/img, SVG path elements using pixel coordinates (x/y). Supports M/L/C/Q/A/Z commands. Use A for circles, C/Q for curves, and enough points for smooth results. For set_prop events on canvas/img/video, comma-separated key=value pairs (e.g. "gfxMode=quadrant,dither=sierra-stable,ditherBits=3"). For style_element events, comma-separated key=value pairs to set inline styles (e.g. "backgroundColor=var(--theme-primary),bold=true,border=thin"). IMPORTANT: For color and backgroundColor, always prefer theme colors using var(--theme-X) syntax for readability across themes. Available theme colors: primary, secondary, success, warning, error, info, surface, border, focus-primary, focus-background, text-primary, text-secondary, text-muted, header-background, header-foreground. Supported style props: color, backgroundColor, border, borderColor, bold, italic, underline, dim, visible, opacity, padding, margin. For add_connector events, element_id is ignored (use any valid element); value = comma-separated params: from=<id>,to=<id> and optional label=<text>,arrow=none|end|start|both,routing=direct|orthogonal,color=<color>,lineStyle=thin|thick|dashed. Creates a visual connector line between two elements. For remove_connector events, element_id = the connector ID to remove; value is ignored.',
        required: false,
      },
    },
  },
  {
    name: 'click_canvas',
    description: 'Click at a specific position on a canvas element. The coordinates are in pixel buffer space (not terminal characters). Use this to interact with graphics, games, or clickable areas within a canvas.',
    parameters: {
      element_id: {
        type: 'string',
        description: 'The ID of the canvas element to click on',
        required: true,
      },
      x: {
        type: 'number',
        description: 'The X coordinate in pixel buffer space (0 = left edge)',
        required: true,
      },
      y: {
        type: 'number',
        description: 'The Y coordinate in pixel buffer space (0 = top edge)',
        required: true,
      },
    },
  },
  {
    name: 'read_element',
    description: 'Read the full text content of a UI element. ALWAYS use this tool FIRST when the user asks to summarize, translate, explain, or work with content - the screen content in the system prompt may be truncated. Works with text, markdown, input, textarea, and other text-containing elements.',
    parameters: {
      element_id: {
        type: 'string',
        description: 'The ID of the element to read',
        required: true,
      },
    },
  },
  {
    name: 'close_dialog',
    description: 'Close the AI assistant dialog. Use this when the user is done asking questions or explicitly asks to close.',
    parameters: {},
  },
  {
    name: 'exit_program',
    description: 'Exit the entire application. Only use this when the user explicitly asks to quit or exit the program.',
    parameters: {},
  },
];

// Convert tool definitions to OpenRouter format
export function toolsToOpenRouterFormat(): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required: string[];
    };
  };
}> {
  // Combine built-in and custom tools
  const customTools = getCustomTools();
  // Use BUILTIN_TOOLS constant to ensure built-in tools are always included
  const allTools: ToolDefinition[] = [
    ...TOOL_DEFINITIONS,
    ...customTools
  ];

  logger.info('Tools available for AI', {
    builtIn: TOOL_DEFINITIONS.map(t => t.name),
    custom: customTools.map(t => t.name),
    total: allTools.length
  });

  return allTools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([key, param]) => [
            key,
            {
              type: param.type,
              description: param.description,
              ...(param.enum ? { enum: param.enum } : {}),
            },
          ])
        ),
        required: Object.entries(tool.parameters)
          .filter(([_, param]) => param.required)
          .map(([key]) => key),
      },
    },
  }));
}

// Execute a tool call (supports both built-in and custom tools)
export async function executeTool(toolCall: ToolCall, context: ToolContext): Promise<ToolResult> {
  logger.info('Executing tool', {
    name: toolCall.name,
    args: JSON.stringify(toolCall.arguments),
    argsType: typeof toolCall.arguments
  });

  try {
    // Check built-in tools first
    switch (toolCall.name) {
      case 'send_event':
        return executeSendEvent(toolCall.arguments, context);

      case 'click_canvas':
        return executeClickCanvas(toolCall.arguments, context);

      case 'read_element':
        return executeReadElement(toolCall.arguments, context);

      case 'close_dialog':
        return executeCloseDialog(context);

      case 'exit_program':
        return executeExitProgram(context);
    }

    // Check custom tools
    const customTool = globalCustomToolRegistry.get(toolCall.name);
    if (customTool) {
      logger.debug('Executing custom tool', { name: toolCall.name });
      const result = await customTool.handler(toolCall.arguments, context);
      // Trigger render after custom tool execution
      context.render();
      return result;
    }

    // Unknown tool
    logger.warn('Unknown tool', { name: toolCall.name });
    return {
      success: false,
      message: `Unknown tool: ${toolCall.name}`,
    };
  } catch (error) {
    const err = ensureError(error);
    logger.error('Tool execution error', err);
    return {
      success: false,
      message: `Error executing tool: ${err.message}`,
    };
  }
}

// Execute send_event tool
function executeSendEvent(
  args: Record<string, unknown>,
  context: ToolContext
): ToolResult {
  const elementId = args.element_id as string;
  const eventType = args.event_type as string;
  const value = args.value as string | undefined;

  if (!elementId) {
    return { success: false, message: 'element_id is required' };
  }

  if (!eventType) {
    return { success: false, message: 'event_type is required' };
  }

  const element = context.document.getElementById(elementId);
  if (!element) {
    return { success: false, message: `Element not found: ${elementId}` };
  }

  logger.debug('Sending event to element', { elementId, eventType, value, elementType: element.type });

  switch (eventType) {
    case 'click': {
      // For checkboxes and radios, toggle/select them
      if (element.type === 'checkbox') {
        element.props.checked = !element.props.checked;
        if (typeof element.props.onChange === 'function') {
          element.props.onChange({ target: elementId, checked: element.props.checked });
        }
        context.render();
        return { success: true, message: `Toggled checkbox ${elementId} to: ${element.props.checked}` };
      }
      if (element.type === 'radio') {
        element.props.checked = true;
        if (typeof element.props.onChange === 'function') {
          element.props.onChange({ target: elementId, checked: true });
        }
        context.render();
        return { success: true, message: `Selected radio ${elementId}` };
      }
      // Trigger onClick handler if it exists
      if (typeof element.props.onClick === 'function') {
        element.props.onClick({ target: elementId });
        context.render();
        return { success: true, message: `Clicked element: ${elementId}` };
      }
      // For buttons, also check for activation
      if (element.type === 'button') {
        return { success: true, message: `Button ${elementId} activated` };
      }
      return { success: false, message: `Element ${elementId} (type: ${element.type}) has no click handler` };
    }

    case 'change': {
      // Update value for inputs
      if (element.type === 'input' || element.type === 'textarea') {
        element.props.value = value || '';
        if (typeof element.props.onChange === 'function') {
          element.props.onChange({ target: elementId, value: value || '' });
        }
        context.render();
        return { success: true, message: `Changed ${elementId} value to: ${value}` };
      }
      // Toggle checkboxes
      if (element.type === 'checkbox') {
        element.props.checked = !element.props.checked;
        if (typeof element.props.onChange === 'function') {
          element.props.onChange({ target: elementId, checked: element.props.checked });
        }
        context.render();
        return { success: true, message: `Toggled checkbox ${elementId} to: ${element.props.checked}` };
      }
      // Select radios
      if (element.type === 'radio') {
        element.props.checked = true;
        if (typeof element.props.onChange === 'function') {
          element.props.onChange({ target: elementId, checked: true });
        }
        context.render();
        return { success: true, message: `Selected radio ${elementId}` };
      }
      // Data table - select row by index
      if (element.type === 'data-table') {
        const tableElement = element as any;
        if (typeof tableElement.selectRowAtPosition !== 'function') {
          return { success: false, message: `Data table ${elementId} does not support selection` };
        }
        const rowIndex = Number(value);
        if (isNaN(rowIndex) || rowIndex < 0) {
          return { success: false, message: `Invalid row index: ${value}. Use the row index from read_element output (e.g. row:0, row:1).` };
        }
        const rows = tableElement.getValue();
        if (!rows || rowIndex >= rows.length) {
          return { success: false, message: `Row ${rowIndex} out of range (${rows?.length ?? 0} rows)` };
        }
        // selectRowAtPosition expects sorted position; find it
        const sortedIndices: number[] = tableElement._getSortedIndices();
        const sortedPos = sortedIndices.indexOf(rowIndex);
        if (sortedPos < 0) {
          return { success: false, message: `Row ${rowIndex} not found in sorted view` };
        }
        tableElement._focusedSortedIndex = sortedPos;
        tableElement.selectRowAtPosition(sortedPos, 'replace');
        context.render();
        const row = rows[rowIndex];
        const preview = row?.map((c: unknown) => String(c ?? '')).join(', ');
        return { success: true, message: `Selected row ${rowIndex} in ${elementId}: ${preview}` };
      }
      // Tile map - set view (lat, lon, zoom, provider)
      if (element.type === 'tile-map') {
        const mapEl = element as any;
        if (!value) {
          return { success: false, message: 'value is required for tile-map change events. Format: "lat=N,lon=N,zoom=N,provider=NAME" (all fields optional)' };
        }
        const params = new Map<string, string>();
        for (const part of value.split(',')) {
          const eq = part.indexOf('=');
          if (eq > 0) {
            params.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
          }
        }
        const lat = params.has('lat') ? Number(params.get('lat')) : undefined;
        const lon = params.has('lon') ? Number(params.get('lon')) : undefined;
        const zoom = params.has('zoom') ? Number(params.get('zoom')) : undefined;
        const provider = params.get('provider');
        if (provider) {
          mapEl.props.provider = provider;
        }
        if (typeof mapEl.setView === 'function' && (lat !== undefined || lon !== undefined)) {
          const center = typeof mapEl.getCenter === 'function' ? mapEl.getCenter() : { lat: 0, lon: 0 };
          mapEl.setView(lat ?? center.lat, lon ?? center.lon, zoom);
        } else if (typeof mapEl.setZoom === 'function' && zoom !== undefined) {
          mapEl.setZoom(zoom);
        }
        context.render();
        const newCenter = typeof mapEl.getCenter === 'function' ? mapEl.getCenter() : { lat: 0, lon: 0 };
        const newZoom = typeof mapEl.getZoom === 'function' ? mapEl.getZoom() : 0;
        return { success: true, message: `Map ${elementId}: lat=${newCenter.lat.toFixed(4)}, lon=${newCenter.lon.toFixed(4)}, zoom=${newZoom}, provider=${mapEl._currentProvider || mapEl.props.provider}` };
      }
      // Select/combobox/autocomplete - select option by value
      if (element.type === 'select' || element.type === 'combobox' || element.type === 'autocomplete') {
        const listElement = element as any;
        if (typeof listElement.findOptionByValue === 'function' && typeof listElement.selectOption === 'function') {
          if (!value) {
            return { success: false, message: `value is required for ${element.type} change events` };
          }
          const option = listElement.findOptionByValue(value);
          if (!option) {
            // List available options for the AI
            const allOptions = typeof listElement.getAllOptions === 'function' ? listElement.getAllOptions() : [];
            const available = allOptions.map((o: any) => o.id).join(', ');
            return { success: false, message: `Option "${value}" not found in ${elementId}. Available: ${available}` };
          }
          listElement.selectOption(option);
          context.render();
          return { success: true, message: `Selected "${option.label}" (value: ${option.id}) in ${elementId}` };
        }
      }
      return { success: false, message: `Element ${elementId} does not support change events` };
    }

    case 'focus': {
      if (context.focusManager) {
        const focused = context.focusManager.focus(elementId);
        if (focused) {
          context.render();
          return { success: true, message: `Focused element: ${elementId}` };
        }
        return { success: false, message: `Element ${elementId} is not focusable` };
      }
      return { success: false, message: `Focus management is not available` };
    }

    case 'keypress': {
      if (hasKeyInputHandler(element)) {
        element.handleKeyInput(value || '');
        context.render();
        return { success: true, message: `Sent keypress '${value}' to ${elementId}` };
      }
      return { success: false, message: `Element ${elementId} does not support keypress events` };
    }

    case 'draw': {
      const drawableTypes = new Set(['tile-map', 'canvas', 'img', 'video']);
      if (!drawableTypes.has(element.type)) {
        return { success: false, message: `draw events are only supported on tile-map, canvas, img, and video elements, not ${element.type}` };
      }
      const drawEl = element as any;
      const targetName = element.type === 'tile-map' ? 'map' : element.type;
      if (!value || value.trim() === '') {
        drawEl.props.svgOverlay = undefined;
        context.render();
        return { success: true, message: `Cleared SVG overlay on ${targetName} ${elementId}` };
      }
      // Resolve var(--theme-*) CSS variable references in SVG color attributes
      let resolvedValue = value;
      if (value.includes('var(')) {
        const cssVars = new Map<string, string>();
        for (const ss of context.document.stylesheets) {
          for (const [k, v] of ss.variables) {
            cssVars.set(k, v);
          }
        }
        resolvedValue = value.replace(/(?:stroke|fill|bg|background)\s*=\s*"([^"]*var\([^"]*\)[^"]*)"/g,
          (_match, val) => _match.replace(val, resolveVarReferences(val, cssVars) || val));
      }
      drawEl.props.svgOverlay = resolvedValue;
      context.render();
      const pathCount = (value.match(/<path\b/gi) || []).length;
      const textCount = (value.match(/<text\b/gi) || []).length;
      const parts: string[] = [];
      if (pathCount > 0) parts.push(`${pathCount} path(s)`);
      if (textCount > 0) parts.push(`${textCount} label(s)`);
      return { success: true, message: `Drew ${parts.join(' and ') || 'overlay'} on ${targetName} ${elementId}` };
    }

    case 'set_prop': {
      const canvasTypes = new Set(['canvas', 'img', 'video']);
      if (!canvasTypes.has(element.type)) {
        return { success: false, message: `set_prop events are only supported on canvas, img, and video elements, not ${element.type}` };
      }
      if (!value) {
        return { success: false, message: 'value is required for set_prop events. Format: "gfxMode=sixel,ditherBits=2"' };
      }
      const canvasEl = element as any;
      const validGfxModes = new Set<string>(GFX_MODES);
      const validDitherModes = new Set<string>(DITHER_MODES);
      const allowedProps: Record<string, (v: string) => unknown> = {
        gfxMode: (v) => validGfxModes.has(v) ? v : undefined,
        dither: (v) => validDitherModes.has(v) ? v : undefined,
        ditherBits: (v) => { const n = Number(v); return (n >= 1 && n <= 8) ? n : undefined; },
      };
      const changes: string[] = [];
      for (const part of value.split(',')) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const key = part.slice(0, eq).trim();
        const val = part.slice(eq + 1).trim();
        const parser = allowedProps[key];
        if (!parser) {
          return { success: false, message: `Unknown property: ${key}. Allowed: ${Object.keys(allowedProps).join(', ')}` };
        }
        const parsed = parser(val);
        if (parsed === undefined) {
          return { success: false, message: `Invalid value for ${key}: ${val}` };
        }
        canvasEl.props[key] = parsed;
        changes.push(`${key}=${parsed}`);
      }
      if (changes.length === 0) {
        return { success: false, message: 'No valid properties found in value' };
      }
      if (typeof canvasEl.markDirty === 'function') {
        canvasEl.markDirty();
      }
      context.render();
      return { success: true, message: `Set ${changes.join(', ')} on ${element.type} ${elementId}` };
    }

    case 'add_connector': {
      if (!value) {
        return { success: false, message: 'value is required for add_connector events. Format: "from=<id>,to=<id>[,label=<text>][,arrow=end][,routing=orthogonal][,color=<color>][,lineStyle=thin]"' };
      }
      const connParams = new Map<string, string>();
      for (const part of value.split(',')) {
        const eq = part.indexOf('=');
        if (eq > 0) {
          connParams.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
        }
      }
      const fromId = connParams.get('from');
      const toId = connParams.get('to');
      if (!fromId || !toId) {
        return { success: false, message: 'Both "from" and "to" element IDs are required. Format: "from=element-a,to=element-b"' };
      }
      if (!context.document.getElementById(fromId)) {
        return { success: false, message: `Source element not found: ${fromId}` };
      }
      if (!context.document.getElementById(toId)) {
        return { success: false, message: `Target element not found: ${toId}` };
      }
      const connectorId = `ai-connector-${fromId}-${toId}`;
      const existing = context.document.getElementById(connectorId);
      if (existing) {
        // Update existing connector props
        existing.props.from = fromId;
        existing.props.to = toId;
        if (connParams.has('label')) existing.props.label = connParams.get('label');
        if (connParams.has('arrow')) existing.props.arrow = connParams.get('arrow');
        if (connParams.has('routing')) existing.props.routing = connParams.get('routing');
        if (connParams.has('color') || connParams.has('lineStyle')) {
          if (!existing.props.style) existing.props.style = {};
          const s = existing.props.style as Record<string, unknown>;
          if (connParams.has('color')) s.color = connParams.get('color');
          if (connParams.has('lineStyle')) s.lineStyle = connParams.get('lineStyle');
        }
        context.render();
        return { success: true, message: `Updated connector ${connectorId}` };
      }
      // Create new connector
      const connProps: Record<string, unknown> = {
        id: connectorId,
        from: fromId,
        to: toId,
        style: { position: 'absolute' } as Record<string, unknown>,
      };
      if (connParams.has('label')) connProps.label = connParams.get('label');
      if (connParams.has('arrow')) connProps.arrow = connParams.get('arrow');
      if (connParams.has('routing')) connProps.routing = connParams.get('routing');
      const connStyle = connProps.style as Record<string, unknown>;
      if (connParams.has('color')) connStyle.color = connParams.get('color');
      if (connParams.has('lineStyle')) connStyle.lineStyle = connParams.get('lineStyle');

      const connector = createElement('connector', connProps);
      const root = context.document.root;
      if (root.children) {
        root.children.push(connector);
      } else {
        root.children = [connector];
      }
      context.document.addElement(connector);
      context.render();
      return { success: true, message: `Created connector ${connectorId} from ${fromId} to ${toId}` };
    }

    case 'remove_connector': {
      const connEl = context.document.getElementById(elementId);
      if (!connEl) {
        return { success: false, message: `Connector not found: ${elementId}` };
      }
      if (connEl.type !== 'connector') {
        return { success: false, message: `Element ${elementId} is not a connector (type: ${connEl.type})` };
      }
      // Remove from parent's children
      const root = context.document.root;
      if (root.children) {
        const idx = root.children.indexOf(connEl);
        if (idx !== -1) root.children.splice(idx, 1);
      }
      context.document.removeElement(elementId);
      context.render();
      return { success: true, message: `Removed connector ${elementId}` };
    }

    case 'style_element': {
      if (!value) {
        return { success: false, message: 'value is required for style_element events. Format: "backgroundColor=var(--theme-primary),border=thin,bold=true". Prefer var(--theme-*) for colors.' };
      }
      // Parse comma-separated key=value pairs
      const styleParams = new Map<string, string>();
      for (const part of value.split(',')) {
        const eq = part.indexOf('=');
        if (eq > 0) {
          styleParams.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
        }
      }
      if (styleParams.size === 0) {
        return { success: false, message: 'No valid style properties found. Format: "backgroundColor=var(--theme-primary),border=thin"' };
      }
      // Allowed style properties and their parsers
      const boolParse = (v: string): boolean | undefined => {
        if (v === 'true') return true;
        if (v === 'false') return false;
        return undefined;
      };
      const numParse = (v: string): number | undefined => {
        const n = Number(v);
        return isNaN(n) ? undefined : n;
      };
      const allowedStyles: Record<string, (v: string) => unknown> = {
        color: (v) => v,
        backgroundColor: (v) => v,
        border: (v) => v,
        borderColor: (v) => v,
        bold: (v) => boolParse(v),
        italic: (v) => boolParse(v),
        underline: (v) => boolParse(v),
        dim: (v) => boolParse(v),
        visible: (v) => boolParse(v),
        opacity: (v) => { const n = numParse(v); return n !== undefined && n >= 0 && n <= 1 ? n : undefined; },
        padding: (v) => numParse(v),
        margin: (v) => numParse(v),
      };
      // Collect CSS variables from all stylesheets for var() resolution
      const cssVars = new Map<string, string>();
      for (const ss of context.document.stylesheets) {
        for (const [k, v] of ss.variables) {
          cssVars.set(k, v);
        }
      }

      // Ensure element has a style object
      if (!element.props.style) {
        element.props.style = {};
      }
      const style = element.props.style as Record<string, unknown>;
      const styleChanges: string[] = [];
      for (const [key, val] of styleParams) {
        const parser = allowedStyles[key];
        if (!parser) {
          return { success: false, message: `Unknown style property: ${key}. Allowed: ${Object.keys(allowedStyles).join(', ')}` };
        }
        // Resolve var(--theme-*) references before parsing
        const resolvedVal = val.includes('var(') ? resolveVarReferences(val, cssVars) : val;
        if (!resolvedVal) {
          return { success: false, message: `Could not resolve CSS variable in value for ${key}: ${val}` };
        }
        const parsed = parser(resolvedVal);
        if (parsed === undefined) {
          return { success: false, message: `Invalid value for ${key}: ${val}` };
        }
        style[key] = parsed;
        styleChanges.push(`${key}=${resolvedVal}`);
      }
      context.render();
      return { success: true, message: `Styled ${elementId}: ${styleChanges.join(', ')}` };
    }

    default:
      return { success: false, message: `Unknown event type: ${eventType}` };
  }
}

// Execute read_element tool
function executeReadElement(
  args: Record<string, unknown>,
  context: ToolContext
): ToolResult {
  const elementId = args.element_id as string;

  if (!elementId) {
    return { success: false, message: 'element_id is required' };
  }

  const element = context.document.getElementById(elementId);
  if (!element) {
    return { success: false, message: `Element not found: ${elementId}` };
  }

  logger.debug('Reading element content', { elementId, elementType: element.type });

  // Extract text content based on element type
  let content: string | undefined;

  switch (element.type) {
    case 'text':
      content = element.props.text as string | undefined;
      break;
    case 'markdown':
      // Markdown can have inline text OR fetched content from src
      // Use public getContent() method if available
      if (hasGetContent(element)) {
        content = element.getContent();
      } else {
        content = element.props.text as string | undefined;
      }
      break;
    case 'input':
    case 'textarea':
      content = element.props.value as string | undefined;
      break;
    case 'tile-map': {
      const mapEl = element as any;
      const center = typeof mapEl.getCenter === 'function' ? mapEl.getCenter() : { lat: element.props.lat, lon: element.props.lon };
      const zoom = typeof mapEl.getZoom === 'function' ? mapEl.getZoom() : element.props.zoom;
      const provider = mapEl._currentProvider || element.props.provider || 'openstreetmap';
      const pathCount = mapEl.props.svgOverlay ? (mapEl.props.svgOverlay.match(/<path\b/gi) || []).length : 0;
      const labelCount = mapEl.props.svgOverlay ? (mapEl.props.svgOverlay.match(/<text\b/gi) || []).length : 0;
      const providers = typeof mapEl._getProviders === 'function' ? Object.keys(mapEl._getProviders()) : [];
      content = `Tile Map: lat=${Number(center.lat).toFixed(4)}, lon=${Number(center.lon).toFixed(4)}, zoom=${zoom}, provider=${provider}, paths=${pathCount}, labels=${labelCount}\nAvailable providers: ${providers.join(', ')}`;
      break;
    }
    case 'button':
      content = element.props.title as string | undefined;
      break;
    case 'checkbox':
    case 'radio':
      content = element.props.checked ? 'checked' : 'unchecked';
      if (element.props.label) {
        content = `${element.props.label}: ${content}`;
      }
      break;
    default:
      // Try ContentGettable interface first, then common text properties
      if (hasGetContent(element)) {
        content = element.getContent();
      } else {
        content = (element.props.text || element.props.value || element.props.title || element.props.label) as string | undefined;
      }
  }

  if (content === undefined || content === null) {
    return {
      success: true,
      message: `Element ${elementId} (type: ${element.type}) has no text content`,
      data: { elementId, type: element.type, content: null }
    };
  }

  return {
    success: true,
    message: `Content of ${elementId}: ${content}`,
    data: { elementId, type: element.type, content }
  };
}

// Execute close_dialog tool
function executeCloseDialog(context: ToolContext): ToolResult {
  logger.info('Closing dialog via tool');
  // Defer the close to after the current execution
  setTimeout(() => context.closeDialog(), 0);
  return { success: true, message: 'Closing assistant dialog' };
}

// Execute exit_program tool
function executeExitProgram(context: ToolContext): ToolResult {
  logger.info('Exiting program via tool');
  // Defer the exit to after the current execution completes
  // Use a longer timeout to allow any pending renders to complete
  setTimeout(async () => {
    try {
      await context.exitProgram();
    } catch (error) {
      logger.error('Error during program exit', ensureError(error));
    }
  }, 200);
  return { success: true, message: 'Exiting program...' };
}

// Execute click_canvas tool
function executeClickCanvas(
  args: Record<string, unknown>,
  context: ToolContext
): ToolResult {
  const elementId = args.element_id as string;
  const x = args.x as number;
  const y = args.y as number;

  if (!elementId) {
    return { success: false, message: 'element_id is required' };
  }

  if (typeof x !== 'number' || typeof y !== 'number') {
    return { success: false, message: 'x and y coordinates are required and must be numbers' };
  }

  const element = context.document.getElementById(elementId);
  if (!element) {
    return { success: false, message: `Element not found: ${elementId}` };
  }

  if (element.type !== 'canvas') {
    return { success: false, message: `Element ${elementId} is not a canvas (type: ${element.type})` };
  }

  logger.debug('Clicking canvas', { elementId, x, y });

  // Create a click event with position in pixel buffer space
  const clickEvent = {
    type: 'click' as const,
    target: element,
    timestamp: Date.now(),
    position: { x: Math.floor(x), y: Math.floor(y) },
  };

  // Call onClick handler if it exists
  if (typeof element.props.onClick === 'function') {
    element.props.onClick(clickEvent);
    context.render();
    return {
      success: true,
      message: `Clicked canvas ${elementId} at position (${Math.floor(x)}, ${Math.floor(y)})`,
    };
  }

  return {
    success: false,
    message: `Canvas ${elementId} has no onClick handler`,
  };
}
