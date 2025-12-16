// AI Tool System for UI Control
// Defines tools that the AI assistant can use to interact with the UI

import { Document } from '../document.ts';
import { getLogger } from '../logging.ts';

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
        enum: ['click', 'change', 'focus', 'keypress'],
      },
      value: {
        type: 'string',
        description: 'For change events, the new value. For keypress events, the key to press.',
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
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Tool execution error', error instanceof Error ? error : new Error(errorMsg));
    return {
      success: false,
      message: `Error executing tool: ${errorMsg}`,
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
      return { success: false, message: `Element ${elementId} does not support change events` };
    }

    case 'focus': {
      // This would need focusManager integration
      return { success: true, message: `Focused element: ${elementId}` };
    }

    case 'keypress': {
      if (typeof (element as any).handleKeyInput === 'function') {
        (element as any).handleKeyInput(value || '');
        context.render();
        return { success: true, message: `Sent keypress '${value}' to ${elementId}` };
      }
      return { success: false, message: `Element ${elementId} does not support keypress events` };
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
      if (typeof (element as any).getContent === 'function') {
        content = (element as any).getContent() as string | undefined;
      } else {
        content = element.props.text as string | undefined;
      }
      break;
    case 'input':
    case 'textarea':
      content = element.props.value as string | undefined;
      break;
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
      // Try common text properties
      content = (element.props.text || element.props.value || element.props.title || element.props.label) as string | undefined;
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
      logger.error('Error during program exit', error instanceof Error ? error : new Error(String(error)));
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
