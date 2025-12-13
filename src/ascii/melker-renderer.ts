// ASCII-to-Melker renderer - converts parsed ASCII boxes to melker XML

import { Box, BoxStructure, LayoutHints, ParsedButton, TabBarInfo } from './types.ts';
import { parseButtonShortcuts, inferFlexDirection } from './parser.ts';

export interface RenderOptions {
  /** Indent string (default: 2 spaces) */
  indent?: string;
  /** Include melker root element */
  includeRoot?: boolean;
}

export interface RenderContext {
  /** Document title (from root block name) */
  title?: string;
  /** Handlers from melker-script:#id.event blocks */
  handlers?: Map<string, Map<string, string>>; // id -> event -> code
  /** Properties from json:#id blocks */
  jsonProperties?: Map<string, Record<string, unknown>>;
  /** Global script content from melker-script blocks */
  scriptContent?: string;
  /** Style content from melker-style blocks */
  styleContent?: string;
  /** JSON data from melker-json:NAME blocks */
  jsonData?: Map<string, string>;
  /** Component definitions from melker-block (non-root) */
  components?: Map<string, BoxStructure>;
  /** Registered element types from engine (e.g., 'text', 'button', 'input') */
  elementTypes?: Set<string>;
  /** Comments for components (from preceding prose) */
  componentComments?: Map<string, string>;
  /** Comment for root element (from preceding prose) */
  rootComment?: string;
}

// Fallback element types when context.elementTypes is not provided
const DEFAULT_ELEMENT_TYPES = new Set([
  'text', 'button', 'input', 'textarea', 'checkbox', 'radio',
  'list', 'li', 'canvas', 'file-browser', 'markdown',
]);

/**
 * Render BoxStructure to melker XML
 */
export function renderToMelker(
  structure: BoxStructure,
  options: RenderOptions = {},
  context: RenderContext = {}
): string {
  const indent = options.indent ?? '  ';
  const includeRoot = options.includeRoot ?? true;

  const lines: string[] = [];

  if (includeRoot) {
    lines.push('<melker>');

    // Add title from root block name
    if (context.title) {
      lines.push(`${indent}<title>${escapeXml(context.title)}</title>`);
      lines.push('');
    }

    // Add JSON data scripts
    if (context.jsonData) {
      for (const [name, data] of context.jsonData) {
        lines.push(`${indent}<script type="application/json" id="${name}">`);
        lines.push(`${indent}${indent}${data}`);
        lines.push(`${indent}</script>`);
        lines.push('');
      }
    }

    // Add style
    if (context.styleContent) {
      lines.push(`${indent}<style>`);
      for (const line of context.styleContent.split('\n')) {
        lines.push(`${indent}${indent}${line}`);
      }
      lines.push(`${indent}</style>`);
      lines.push('');
    }

    // Add script
    if (context.scriptContent) {
      lines.push(`${indent}<script type="typescript">`);
      for (const line of context.scriptContent.split('\n')) {
        lines.push(`${indent}${indent}${line}`);
      }
      lines.push(`${indent}</script>`);
      lines.push('');
    }
  }

  // Render root boxes
  for (const rootBox of structure.rootBoxes) {
    // Add root comment if present
    if (context.rootComment) {
      lines.push(`${indent}<!-- ${escapeXmlComment(context.rootComment)} -->`);
    }
    const boxLines = renderBox(rootBox, 1, indent, context, structure);
    lines.push(...boxLines);
  }

  if (includeRoot) {
    lines.push('</melker>');
  }

  return lines.join('\n');
}

function renderBox(
  box: Box,
  depth: number,
  indent: string,
  context: RenderContext,
  structure: BoxStructure,
  visiting: Set<string> = new Set()
): string[] {
  const lines: string[] = [];
  const prefix = indent.repeat(depth);

  // Check if this is a reference to a component (defined in a separate melker-block)
  // A box is a component reference if:
  // 1. Its ID matches a component in context.components
  // 2. It's not the root of that component (to avoid infinite recursion)
  // 3. We're not already visiting this component (cycle detection)
  if (context.components?.has(box.id)) {
    const component = context.components.get(box.id)!;
    const isComponentRoot = component.rootBoxes.some(
      (rootBox) => rootBox.bounds?.top === box.bounds?.top && rootBox.bounds?.left === box.bounds?.left
    );

    if (!isComponentRoot && !visiting.has(box.id)) {
      // This is a reference - render the component inline
      const newVisiting = new Set(visiting);
      newVisiting.add(box.id);

      // Add component comment if present
      const comment = context.componentComments?.get(box.id);
      if (comment) {
        lines.push(`${prefix}<!-- ${escapeXmlComment(comment)} -->`);
      }

      for (const rootBox of component.rootBoxes) {
        lines.push(...renderBox(rootBox, depth, indent, context, structure, newVisiting));
      }
      return lines;
    }
  }

  // Check for tabs element (has tabBar info)
  if (box.tabBar) {
    return renderTabsBox(box, depth, indent, context, structure, visiting);
  }

  // Determine element type
  const elementType = getElementType(box, context);
  const attributes = buildAttributes(box, context);

  // Sort children by position (left for row, top for column)
  const direction = box.hints?.direction ?? inferFlexDirection(box.children ?? []);
  const children = [...(box.children ?? [])].sort((a, b) => {
    if (direction === 'row') {
      return (a.bounds?.left ?? 0) - (b.bounds?.left ?? 0);
    } else {
      return (a.bounds?.top ?? 0) - (b.bounds?.top ?? 0);
    }
  });

  // Parse buttons from content lines if this box has content
  const buttons = parseButtonsFromBox(box);

  // Check if element is self-closing
  const hasChildren = children.length > 0 || buttons.length > 0;
  const hasTextContent = elementType === 'text' && box.properties?.text;

  if (hasTextContent && !hasChildren) {
    // Text element with content
    const textContent = escapeXml(box.properties!.text!);
    // Remove text from attributes since it's now content
    const attrsWithoutText = attributes.filter((a) => !a.startsWith('text='));
    const attrsStr = attrsWithoutText.length > 0 ? ' ' + attrsWithoutText.join(' ') : '';
    lines.push(`${prefix}<${elementType}${attrsStr}>${textContent}</${elementType}>`);
  } else if (!hasChildren && buttons.length === 0) {
    // Self-closing element
    const attrsStr = attributes.length > 0 ? ' ' + attributes.join(' ') : '';
    lines.push(`${prefix}<${elementType}${attrsStr} />`);
  } else {
    // Element with children
    const attrsStr = attributes.length > 0 ? ' ' + attributes.join(' ') : '';
    lines.push(`${prefix}<${elementType}${attrsStr}>`);

    // Render buttons first (from content lines)
    for (const button of buttons) {
      lines.push(...renderButton(button, depth + 1, indent, context));
    }

    // Render child boxes
    for (const child of children) {
      lines.push(...renderBox(child, depth + 1, indent, context, structure, visiting));
    }

    lines.push(`${prefix}</${elementType}>`);
  }

  return lines;
}

/**
 * Resolve a box that might be a component reference to its actual content
 */
function resolveComponentBox(box: Box, context: RenderContext): Box {
  // If the box is a component reference, get the component's root box
  if (context.components?.has(box.id)) {
    const component = context.components.get(box.id)!;
    if (component.rootBoxes.length > 0) {
      return component.rootBoxes[0];
    }
  }
  return box;
}

/**
 * Render a tabs element with tab bar info
 */
function renderTabsBox(
  box: Box,
  depth: number,
  indent: string,
  context: RenderContext,
  structure: BoxStructure,
  visiting: Set<string>
): string[] {
  const lines: string[] = [];
  const prefix = indent.repeat(depth);
  const tabBar = box.tabBar!;

  // Build tabs attributes
  const tabsAttrs: string[] = [];

  // ID
  const id = box.properties?.id ?? box.id;
  if (id) {
    tabsAttrs.push(`id="${escapeXml(id)}"`);
  }

  // Find active tab index
  const activeIndex = tabBar.tabs.findIndex(t => t.isActive);
  if (activeIndex >= 0) {
    tabsAttrs.push(`activeTab="${activeIndex}"`);
  }

  // Add style from box
  const styleStr = buildStyleString(box);
  if (styleStr) {
    tabsAttrs.push(`style="${escapeXml(styleStr)}"`);
  }

  // Add handlers from context
  if (context.handlers?.has(id)) {
    const handlers = context.handlers.get(id)!;
    for (const [event, code] of handlers) {
      tabsAttrs.push(`${event}="${escapeXml(code)}"`);
    }
  }

  const tabsAttrsStr = tabsAttrs.length > 0 ? ' ' + tabsAttrs.join(' ') : '';
  lines.push(`${prefix}<tabs${tabsAttrsStr}>`);

  // Sort children by position (top to bottom)
  const children = [...(box.children ?? [])].sort((a, b) => {
    return (a.bounds?.top ?? 0) - (b.bounds?.top ?? 0);
  });

  // Map children to tabs
  for (let i = 0; i < tabBar.tabs.length; i++) {
    const tabInfo = tabBar.tabs[i];
    const childRef = children[i];

    const tabPrefix = indent.repeat(depth + 1);
    const tabAttrs = [`title="${escapeXml(tabInfo.title)}"`];

    if (childRef) {
      // Resolve component reference if needed
      const child = resolveComponentBox(childRef, context);

      // Get child's id if it has one
      const childId = child.properties?.id ?? child.id;
      if (childId && childId !== child.id) {
        tabAttrs.push(`id="${escapeXml(childId)}"`);
      }

      // Get child's style
      const childStyleStr = buildStyleString(child);
      if (childStyleStr) {
        tabAttrs.push(`style="${escapeXml(childStyleStr)}"`);
      }

      const tabAttrsStr = tabAttrs.length > 0 ? ' ' + tabAttrs.join(' ') : '';

      // Check if child has its own children
      const grandChildren = child.children ?? [];
      if (grandChildren.length > 0) {
        lines.push(`${tabPrefix}<tab${tabAttrsStr}>`);
        for (const grandChild of grandChildren) {
          lines.push(...renderBox(grandChild, depth + 2, indent, context, structure, visiting));
        }
        lines.push(`${tabPrefix}</tab>`);
      } else if (child.properties?.text) {
        // Tab with text content
        lines.push(`${tabPrefix}<tab${tabAttrsStr}>`);
        lines.push(`${indent.repeat(depth + 2)}<text>${escapeXml(child.properties.text)}</text>`);
        lines.push(`${tabPrefix}</tab>`);
      } else {
        // Empty tab
        lines.push(`${tabPrefix}<tab${tabAttrsStr} />`);
      }
    } else {
      // No child for this tab - create empty tab
      const tabAttrsStr = tabAttrs.length > 0 ? ' ' + tabAttrs.join(' ') : '';
      lines.push(`${tabPrefix}<tab${tabAttrsStr} />`);
    }
  }

  lines.push(`${prefix}</tabs>`);
  return lines;
}

function renderButton(
  button: ParsedButton,
  depth: number,
  indent: string,
  context: RenderContext
): string[] {
  const prefix = indent.repeat(depth);
  const attributes: string[] = [];

  if (button.id) {
    attributes.push(`id="${escapeXml(button.id)}"`);

    // Check for handler from context
    if (context.handlers?.has(button.id)) {
      const handlers = context.handlers.get(button.id)!;
      if (handlers.has('onClick') && !button.onClick) {
        attributes.push(`onClick="${escapeXml(handlers.get('onClick')!)}"`);
      }
    }

    // Check for JSON properties from context
    if (context.jsonProperties?.has(button.id)) {
      const props = context.jsonProperties.get(button.id)!;
      for (const [key, value] of Object.entries(props)) {
        if (key !== 'id') {
          attributes.push(`${key}="${escapeXml(String(value))}"`);
        }
      }
    }
  }

  attributes.push(`title="${escapeXml(button.title)}"`);

  if (button.onClick) {
    attributes.push(`onClick="${escapeXml(button.onClick)}"`);
  }

  const attrsStr = attributes.join(' ');
  return [`${prefix}<button ${attrsStr} />`];
}

function getElementType(box: Box, context: RenderContext): string {
  const typeProperty = box.properties?.type;
  if (typeProperty) {
    const validTypes = context.elementTypes ?? DEFAULT_ELEMENT_TYPES;
    if (validTypes.has(typeProperty)) {
      return typeProperty;
    }
  }
  return 'container';
}

function buildAttributes(box: Box, context: RenderContext): string[] {
  const attributes: string[] = [];

  // ID (use explicit id property or box name)
  const id = box.properties?.id ?? box.id;
  if (id) {
    attributes.push(`id="${escapeXml(id)}"`);
  }

  // Check for JSON properties from context
  const jsonProps = context.jsonProperties?.get(id);
  if (jsonProps) {
    for (const [key, value] of Object.entries(jsonProps)) {
      if (key !== 'id' && key !== 'type') {
        if (key === 'style' && typeof value === 'object') {
          // Convert object style to CSS string
          const styleStr = objectStyleToCss(value as Record<string, string>);
          attributes.push(`style="${escapeXml(styleStr)}"`);
        } else {
          attributes.push(`${key}="${escapeXml(String(value))}"`);
        }
      }
    }
  }

  // Build style from hints and explicit properties
  const styleStr = buildStyleString(box);
  if (styleStr) {
    // Check if we already have style from JSON props
    const existingStyleIndex = attributes.findIndex((a) => a.startsWith('style='));
    if (existingStyleIndex >= 0) {
      // Merge styles
      const existing = attributes[existingStyleIndex].match(/style="([^"]*)"/)?.[1] ?? '';
      attributes[existingStyleIndex] = `style="${existing}; ${escapeXml(styleStr)}"`;
    } else {
      attributes.push(`style="${escapeXml(styleStr)}"`);
    }
  }

  // Map other properties to attributes
  const skipProps = new Set(['type', 'id', 'style', 'layout', 'flex', 'gap', 'justify', 'align']);

  if (box.properties) {
    for (const [key, value] of Object.entries(box.properties)) {
      if (skipProps.has(key)) continue;
      attributes.push(`${key}="${escapeXml(value)}"`);
    }
  }

  // Add event handlers from context
  if (context.handlers?.has(id)) {
    const handlers = context.handlers.get(id)!;
    for (const [event, code] of handlers) {
      // Check if we already have this event handler
      if (!attributes.some((a) => a.startsWith(`${event}=`))) {
        attributes.push(`${event}="${escapeXml(code)}"`);
      }
    }
  }

  return attributes;
}

function buildStyleString(box: Box): string {
  const styles: string[] = [];
  const props = box.properties ?? {};
  const hints = box.hints ?? {};
  const children = box.children ?? [];

  // Explicit style property
  if (props.style) {
    styles.push(props.style);
  }

  // Flex display (if has children or explicit layout)
  if (children.length > 0 || hints.direction || props.layout) {
    styles.push('display: flex');

    // Direction from hints or property or inferred
    const direction = hints.direction ?? props.layout ?? inferFlexDirection(children);
    styles.push(`flex-direction: ${direction}`);
  }

  // Gap
  const gap = hints.gap ?? (props.gap ? parseInt(props.gap, 10) : undefined);
  if (gap !== undefined) {
    styles.push(`gap: ${gap}`);
  }

  // Justify content
  const justify = hints.justify ?? props.justify;
  if (justify) {
    const justifyMap: Record<string, string> = {
      start: 'flex-start',
      center: 'center',
      end: 'flex-end',
      'space-between': 'space-between',
    };
    styles.push(`justify-content: ${justifyMap[justify] ?? justify}`);
  }

  // Align items
  const align = hints.align ?? props.align;
  if (align) {
    const alignMap: Record<string, string> = {
      start: 'flex-start',
      center: 'center',
      end: 'flex-end',
      stretch: 'stretch',
    };
    styles.push(`align-items: ${alignMap[align] ?? align}`);
  }

  // Flex value
  const flex = hints.flex ?? (props.flex ? parseInt(props.flex, 10) : undefined);
  if (flex !== undefined) {
    styles.push(`flex: ${flex}`);
  }

  // Width
  const width = hints.width ?? props.width;
  if (width !== undefined) {
    styles.push(`width: ${width === 'fill' ? '100%' : width}`);
  }

  // Height
  const height = hints.height ?? props.height;
  if (height !== undefined) {
    styles.push(`height: ${height === 'fill' ? '100%' : height}`);
  }

  return styles.join('; ');
}

function objectStyleToCss(obj: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    // Convert camelCase to kebab-case
    const kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    parts.push(`${kebabKey}: ${value}`);
  }
  return parts.join('; ');
}

function parseButtonsFromBox(box: Box): ParsedButton[] {
  const buttons: ParsedButton[] = [];

  // Get content lines from the original parsed box
  // This requires the box to have been parsed with content preservation
  // For now, we'll look at the properties for any button-like patterns

  // Buttons are parsed during the initial box parsing from content lines
  // Here we just return empty since buttons were already extracted during parsing

  return buttons;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeXmlComment(str: string): string {
  // XML comments cannot contain "--", so replace with "- -"
  return str.replace(/--/g, '- -');
}

/**
 * Render a single box and its children to melker XML (without root wrapper)
 */
export function renderBoxToMelker(
  box: Box,
  options: RenderOptions = {},
  context: RenderContext = {}
): string {
  const indent = options.indent ?? '  ';
  const structure: BoxStructure = {
    boxes: new Map([[box.id, box]]),
    rootBoxes: [box],
  };
  const lines = renderBox(box, 0, indent, context, structure);
  return lines.join('\n');
}
