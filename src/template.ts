// Template literal system for Melker - HTML-style syntax
// Converts '<name prop1="value1" prop2={expr}>children</name>' to createElement calls

import { createElement } from './element.ts';
import type { Element } from './types.ts';
import { parse } from 'npm:html5parser';
import { Stylesheet } from './stylesheet.ts';
import { isLintEnabled, validateElementProps, addWarning, reportWarnings, clearWarnings, BASE_STYLES_SCHEMA, getComponentSchema, getRegisteredComponents } from './lint.ts';

// Types for template processing
interface TemplateContext {
  expressions: any[];
  expressionIndex: number;
}

interface OAuthParseConfig {
  wellknown: string;
  clientId?: string;
  redirectUri?: string;
  scopes?: string;
  audience?: string;
  autoLogin?: boolean;
  debugServer?: boolean;
  // Callback expressions (stored as strings to be evaluated in script context)
  onLogin?: string;
  onLogout?: string;
  onFail?: string;
}

interface MelkerParseResult {
  element: Element;
  scripts: Array<{
    type: string;
    content: string;
    src?: string;
  }>;
  title?: string;
  stylesheet?: Stylesheet;
  oauthConfig?: OAuthParseConfig;
  sourceContent?: string;  // Original source for error reporting
}

// Source location info from parser
interface SourceLocation {
  start: number;  // Character offset in source
  end: number;
  attributeLocations?: Record<string, { start: number; end: number }>;
}

interface ParsedNode {
  type: 'element' | 'text';
  name?: string;
  attributes?: Record<string, any>;
  children?: ParsedNode[];
  content?: string;
  sourceLocation?: SourceLocation;  // Track source position
}

/**
 * Preprocess content to convert self-closing special tags to explicit open/close.
 * HTML5 parser doesn't handle self-closing script/style tags properly.
 */
function preprocessSelfClosingTags(content: string): string {
  // Convert self-closing special tags: <script .../> -> <script ...></script>
  // Handles: script, style, title, oauth
  return content.replace(
    /<(script|style|title|oauth)(\s[^>]*)?\s*\/>/gi,
    '<$1$2></$1>'
  );
}

/**
 * Validate style tag content for lint mode.
 * Checks selectors and properties against schema.
 */
function validateStyleContent(styleContent: string): void {
  if (!isLintEnabled()) return;

  // Parse CSS-like rules: selector { properties }
  const rulePattern = /([^{]+)\{([^}]*)\}/g;
  let match;

  while ((match = rulePattern.exec(styleContent)) !== null) {
    const selectorStr = match[1].trim();
    const propertiesStr = match[2].trim();

    // Validate selector - check element type selectors
    if (selectorStr && !selectorStr.startsWith('#') && !selectorStr.startsWith('.')) {
      // Extract type selector (before any dots)
      const typeMatch = selectorStr.match(/^([^.]+)/);
      if (typeMatch) {
        const typeName = typeMatch[1];
        const schema = getComponentSchema(typeName);
        const registeredComponents = getRegisteredComponents();

        if (!schema && registeredComponents.length > 0) {
          addWarning({
            type: 'unknown-element',
            elementType: 'style',
            property: 'selector',
            value: typeName,
            message: `Unknown element type "${typeName}" in style selector`,
          });
        }
      }
    }

    // Validate properties
    if (propertiesStr) {
      const properties = propertiesStr.split(';').map(p => p.trim()).filter(p => p.length > 0);

      for (const property of properties) {
        const colonIndex = property.indexOf(':');
        if (colonIndex === -1) continue;

        const keyPart = property.substring(0, colonIndex).trim();
        const valuePart = property.substring(colonIndex + 1).trim();

        // Convert kebab-case to camelCase for lookup
        const camelKey = keyPart.replace(/-([a-z])/g, (_m, letter) => letter.toUpperCase());

        const schema = BASE_STYLES_SCHEMA[camelKey];

        if (!schema) {
          addWarning({
            type: 'unknown-style',
            elementType: 'style',
            property: keyPart,
            value: valuePart,
            message: `Unknown style property "${keyPart}" in <style> block`,
          });
        } else if (schema.enum && valuePart && !schema.enum.includes(valuePart)) {
          addWarning({
            type: 'invalid-style-value',
            elementType: 'style',
            property: keyPart,
            value: valuePart,
            message: `Invalid value "${valuePart}" for style "${keyPart}". Valid values: ${schema.enum.join(', ')}`,
          });
        }
      }
    }
  }
}

/**
 * Parse a .melker file content that may have a top-level melker wrapper tag
 * Returns both the UI element and any extracted scripts
 */
export function parseMelkerFile(content: string): MelkerParseResult {
  try {
    // Preprocess to handle self-closing special tags
    const preprocessed = preprocessSelfClosingTags(content.trim());
    // Parse the content to check for melker wrapper tag
    const ast = parse(preprocessed);

    if (ast.length === 0) {
      throw new Error('Empty melker file');
    }

    // Check if we have a top-level melker tag
    const rootNode = ast[0];
    if (rootNode.type === 'Tag' && rootNode.name === 'melker') {
      // Extract scripts, title, style, oauth config, and find the UI element
      const scripts: Array<{ type: string; content: string; src?: string }> = [];
      let uiElement: any = null;
      let title: string | undefined = undefined;
      let stylesheet: Stylesheet | undefined = undefined;
      let oauthConfig: OAuthParseConfig | undefined = undefined;

      if (rootNode.body) {
        for (const child of rootNode.body) {
          if (child.type === 'Tag' && child.name === 'script') {
            // Extract script attributes
            const type = child.attributes?.find((attr: any) => attr.name.value === 'type')?.value?.value || 'javascript';
            const src = child.attributes?.find((attr: any) => attr.name.value === 'src')?.value?.value;

            // Extract script content (inline content)
            const content = child.body?.map((node: any) => node.type === 'Text' ? node.value : '').join('') || '';

            scripts.push({ type, content, src });
          } else if (child.type === 'Tag' && child.name === 'style') {
            // Extract style content and parse into stylesheet
            const styleContent = child.body?.map((node: any) => node.type === 'Text' ? node.value : '').join('') || '';
            if (styleContent.trim()) {
              // Validate style content in lint mode
              validateStyleContent(styleContent);

              if (!stylesheet) {
                stylesheet = new Stylesheet();
              }
              stylesheet.addFromString(styleContent);
            }
          } else if (child.type === 'Tag' && child.name === 'title') {
            // Extract title content
            title = child.body?.map((node: any) => node.type === 'Text' ? node.value : '').join('').trim() || undefined;
          } else if (child.type === 'Tag' && child.name === 'oauth') {
            // Extract oauth configuration
            const getAttr = (name: string) => child.attributes?.find((attr: any) => attr.name.value === name)?.value?.value;
            const wellknown = getAttr('wellknown');
            if (wellknown) {
              const autoLoginAttr = getAttr('auto-login') || getAttr('autoLogin');
              const debugServerAttr = getAttr('debug-server') || getAttr('debugServer');
              oauthConfig = {
                wellknown,
                clientId: getAttr('client-id'),
                redirectUri: getAttr('redirect-uri'),
                scopes: getAttr('scopes') || getAttr('scope'),
                audience: getAttr('audience'),
                autoLogin: autoLoginAttr === 'true' || autoLoginAttr === '',
                debugServer: debugServerAttr === 'true' || debugServerAttr === '',
                onLogin: getAttr('onLogin'),
                onLogout: getAttr('onLogout'),
                onFail: getAttr('onFail'),
              };
            }
          } else if (child.type === 'Tag' && !uiElement && !child.name.startsWith('!')) {
            // This should be the UI element (skip comments which start with !)
            uiElement = child;
          }
        }
      }

      if (!uiElement) {
        throw new Error('No UI element found in melker tag');
      }

      // Convert the UI element to Element using existing parsing logic
      const context: TemplateContext = { expressions: [], expressionIndex: 0 };
      const parsedNode = convertAstNode(uiElement, context);
      const element = convertToElement(parsedNode as ParsedNode, context);

      // Report lint warnings if enabled
      if (isLintEnabled()) {
        reportWarnings();
        clearWarnings();
      }

      return { element, scripts, title, stylesheet, oauthConfig, sourceContent: content };
    } else {
      // No melker wrapper, treat as direct UI element (existing behavior)
      const context: TemplateContext = { expressions: [], expressionIndex: 0 };
      const parsedNode = convertAstNode(rootNode, context);
      const element = convertToElement(parsedNode as ParsedNode, context);

      // Report lint warnings if enabled
      if (isLintEnabled()) {
        reportWarnings();
        clearWarnings();
      }

      return { element, scripts: [], sourceContent: content };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Melker file parsing error: ${errorMessage}`);
  }
}

/**
 * Tagged template literal for creating Melker elements with HTML-style syntax
 *
 * @example
 * ```typescript
 * const ui = melker`
 *   <container style={{ display: 'flex', flexDirection: 'column' }}>
 *     <text style={{ fontWeight: 'bold' }}>Hello World</text>
 *     <button title="Click me" onClick=${handleClick} />
 *   </container>
 * `;
 * ```
 */
export function melker(strings: TemplateStringsArray, ...expressions: any[]): Element {
  // Combine template strings with expressions
  let html = '';
  const context: TemplateContext = {
    expressions,
    expressionIndex: 0
  };

  for (let i = 0; i < strings.length; i++) {
    html += strings[i];
    if (i < expressions.length) {
      // Replace expressions with placeholders that we can parse later
      html += `__EXPR_${context.expressionIndex}__`;
      context.expressionIndex++;
    }
  }

  // Parse the HTML-like string
  const parsed = parseHtmlLike(html, context);

  // Convert parsed tree to createElement calls
  const element = convertToElement(parsed, context);

  // Report lint warnings if enabled
  if (isLintEnabled()) {
    reportWarnings();
    clearWarnings();
  }

  return element;
}

/**
 * Parse HTML-like syntax into a tree structure
 */
function parseHtmlLike(html: string, context: TemplateContext): ParsedNode {
  try {
    // Use html5parser to parse the HTML structure
    const ast = parse(html.trim());

    if (ast.length === 0) {
      throw new Error('Empty template');
    }

    // Convert html5parser AST to our format
    const result = convertAstNode(ast[0], context);

    // If convertAstNode returns an array, take the first element
    // This shouldn't happen at the root level, but handle it for safety
    return Array.isArray(result) ? result[0] : result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Template parsing error: ${errorMessage}`);
  }
}

/**
 * Convert html5parser AST node to our ParsedNode format
 */
function convertAstNode(node: any, context: TemplateContext): ParsedNode | ParsedNode[] {
  if (node.type === 'Text') {
    const textContent = node.value.trim();

    // Check if this text node contains expression placeholders
    const exprPattern = /__EXPR_(\d+)__/g;
    const expressions = [...textContent.matchAll(exprPattern)];

    if (expressions.length > 0) {
      const nodes: ParsedNode[] = [];
      let lastIndex = 0;

      for (const match of expressions) {
        const matchStart = match.index || 0;
        const matchEnd = matchStart + match[0].length;
        const exprIndex = parseInt(match[1]);
        const expr = context.expressions[exprIndex];

        // Add text content before the expression (if any)
        if (matchStart > lastIndex) {
          const beforeText = textContent.slice(lastIndex, matchStart).trim();
          if (beforeText) {
            nodes.push({
              type: 'text',
              content: beforeText
            });
          }
        }

        // Handle the expression
        if (expr && typeof expr === 'object' && expr.type && expr.props) {
          // It's an Element object - add as interpolated element
          nodes.push({
            type: 'element',
            name: '__INTERPOLATED_ELEMENT__',
            attributes: { __elementRef: expr },
            children: []
          });
        } else {
          // It's a regular value - add as text
          nodes.push({
            type: 'text',
            content: String(expr)
          });
        }

        lastIndex = matchEnd;
      }

      // Add any remaining text after the last expression
      if (lastIndex < textContent.length) {
        const afterText = textContent.slice(lastIndex).trim();
        if (afterText) {
          nodes.push({
            type: 'text',
            content: afterText
          });
        }
      }

      // Return array of nodes if multiple, single node if one, or empty text if none
      if (nodes.length > 1) {
        return nodes;
      } else if (nodes.length === 1) {
        return nodes[0];
      } else {
        return {
          type: 'text',
          content: ''
        };
      }
    }

    return {
      type: 'text',
      content: textContent
    };
  }

  if (node.type === 'Tag') {
    // Skip HTML comments
    if (node.name === '!--') {
      return {
        type: 'text',
        content: ''
      };
    }

    // Parse attributes and track their source locations
    const attributes: Record<string, any> = {};
    const attributeLocations: Record<string, { start: number; end: number }> = {};

    if (node.attributes) {
      for (const attr of node.attributes) {
        const attrName = attr.name.value;
        // Handle boolean attributes without values (e.g., <text wrap>)
        if (!attr.value || attr.value.value === undefined) {
          attributes[attrName] = true;
          // Track location of the attribute name for boolean attrs
          attributeLocations[attrName] = { start: attr.start, end: attr.end };
        } else {
          const value = parseAttributeValue(attr.value.value, context, attrName);
          attributes[attrName] = value;
          // Track location of the attribute value (more useful for handlers)
          attributeLocations[attrName] = { start: attr.value.start, end: attr.value.end };
        }
      }
    }

    // Parse children
    const children: ParsedNode[] = [];
    if (node.body) {
      for (const child of node.body) {
        const childNode = convertAstNode(child, context);

        // Handle array of nodes (for interpolated elements)
        if (Array.isArray(childNode)) {
          children.push(...childNode);
        } else if (childNode.type === 'text' && (!childNode.content || childNode.content.trim() === '')) {
          continue; // Skip empty text nodes
        } else {
          children.push(childNode);
        }
      }
    }

    return {
      type: 'element',
      name: node.name,
      attributes,
      children,
      sourceLocation: {
        start: node.start,
        end: node.end,
        attributeLocations
      }
    };
  }

  throw new Error(`Unsupported node type: ${node.type}`);
}

/**
 * Parse CSS-style string into style object
 * Converts "width: 40; height: 10; border: thin;" to { width: 40, height: 10, border: 'thin' }
 */
function parseCssStyleString(cssString: string): Record<string, any> {
  const style: Record<string, any> = {};

  // Split by semicolons and process each property
  const properties = cssString.split(';').map(prop => prop.trim()).filter(prop => prop.length > 0);

  for (const property of properties) {
    const colonIndex = property.indexOf(':');
    if (colonIndex === -1) continue;

    const key = property.substring(0, colonIndex).trim();
    const value = property.substring(colonIndex + 1).trim();

    if (!key || !value) continue;

    // Convert kebab-case to camelCase for properties like border-color
    const camelKey = key.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());

    // Try to parse as number
    if (/^\d+(\.\d+)?$/.test(value)) {
      style[camelKey] = parseFloat(value);
    }
    // Try to parse as boolean
    else if (value === 'true') {
      style[camelKey] = true;
    } else if (value === 'false') {
      style[camelKey] = false;
    }
    // Handle quoted strings - remove quotes
    else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      style[camelKey] = value.slice(1, -1);
    }
    // Keep as string
    else {
      style[camelKey] = value;
    }
  }

  // Normalize shorthand properties
  // Convert `bold: true` to `fontWeight: 'bold'`
  if (style.bold === true) {
    style.fontWeight = 'bold';
    delete style.bold;
  } else if (style.bold === false) {
    style.fontWeight = 'normal';
    delete style.bold;
  }

  // Normalize padding/margin: consolidate individual properties into BoxSpacing
  normalizeBoxSpacing(style, 'padding');
  normalizeBoxSpacing(style, 'margin');

  return style;
}

/**
 * Consolidate individual padding/margin properties (paddingLeft, marginTop, etc.)
 * into BoxSpacing objects for consistent handling
 */
function normalizeBoxSpacing(style: Record<string, any>, property: 'padding' | 'margin'): void {
  const top = style[`${property}Top`];
  const right = style[`${property}Right`];
  const bottom = style[`${property}Bottom`];
  const left = style[`${property}Left`];

  if (top !== undefined || right !== undefined || bottom !== undefined || left !== undefined) {
    // Get base value (could be number or object)
    const base = style[property];
    let baseTop = 0, baseRight = 0, baseBottom = 0, baseLeft = 0;

    if (typeof base === 'number') {
      baseTop = baseRight = baseBottom = baseLeft = base;
    } else if (base && typeof base === 'object') {
      baseTop = base.top || 0;
      baseRight = base.right || 0;
      baseBottom = base.bottom || 0;
      baseLeft = base.left || 0;
    }

    // Override with individual properties
    style[property] = {
      top: top !== undefined ? top : baseTop,
      right: right !== undefined ? right : baseRight,
      bottom: bottom !== undefined ? bottom : baseBottom,
      left: left !== undefined ? left : baseLeft,
    };

    // Clean up individual properties
    delete style[`${property}Top`];
    delete style[`${property}Right`];
    delete style[`${property}Bottom`];
    delete style[`${property}Left`];
  }
}

/**
 * Parse attribute values, handling expression placeholders and CSS-style strings
 */
function parseAttributeValue(value: string, context: TemplateContext, attributeName?: string, templateContext?: any): any {
  if (!value) return '';

  // Check for expression placeholder
  const exprMatch = value.match(/^__EXPR_(\d+)__$/);
  if (exprMatch) {
    const index = parseInt(exprMatch[1]);
    return context.expressions[index];
  }

  // Check for inline expressions in strings
  const inlineExprPattern = /__EXPR_(\d+)__/g;
  if (inlineExprPattern.test(value)) {
    return value.replace(inlineExprPattern, (match, index) => {
      const expr = context.expressions[parseInt(index)];
      return String(expr);
    });
  }

  // Handle style attribute with CSS-style string parsing
  if (attributeName === 'style' && !value.startsWith('{') && value.includes(':')) {
    return parseCssStyleString(value);
  }

  // Handle event handler attributes (onClick, onInput, etc.) as string functions
  if (attributeName && attributeName.startsWith('on') && attributeName.length > 2) {
    // If it's not already a function expression, mark it as a string handler
    if (!value.startsWith('{') && !value.includes('function')) {
      // Return a special object that indicates this is a string handler
      return {
        __isStringHandler: true,
        __handlerCode: value
      };
    }
  }

  // Try to parse as JSON for object literals
  if (value.startsWith('{') && value.endsWith('}')) {
    try {
      return JSON.parse(value);
    } catch {
      // If JSON parsing fails, return as string
      return value;
    }
  }

  // Boolean attributes
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Numeric values
  if (/^\d+(\.\d+)?$/.test(value)) {
    return parseFloat(value);
  }

  // Return as string
  return value;
}

/**
 * Convert parsed tree to Melker createElement calls
 */
function convertToElement(node: ParsedNode, context: TemplateContext): Element {
  if (node.type === 'text') {
    return createElement('text', { text: node.content || '' });
  }

  if (node.type === 'element' && node.name) {
    // Handle interpolated elements specially
    if (node.name === '__INTERPOLATED_ELEMENT__' && node.attributes?.__elementRef) {
      return node.attributes.__elementRef as Element;
    }

    // Process children
    const children: Element[] = [];
    if (node.children) {
      for (const child of node.children) {
        children.push(convertToElement(child, context));
      }
    }

    // Lint validation
    if (isLintEnabled() && node.name !== '__INTERPOLATED_ELEMENT__') {
      const warnings = validateElementProps(node.name, node.attributes || {});
      for (const warning of warnings) {
        addWarning(warning);
      }
    }

    // Build props with source location metadata
    const props = { ...node.attributes };
    if (node.sourceLocation) {
      props.__sourceLocation = node.sourceLocation;
    }

    // Handle self-closing tags or tags with special handling
    if (node.name === 'text' && props.text && children.length === 0) {
      // <text text="content" /> syntax
      return createElement('text', props);
    }

    if (node.name === 'text' && children.length > 0) {
      // <text>content</text> syntax - combine text children
      const textContent = children
        .filter(child => child.type === 'text')
        .map(child => child.props.text)
        .join('');

      return createElement('text', {
        ...props,
        text: textContent
      });
    }

    // For other elements, pass children normally
    return createElement(node.name as any, props, ...children);
  }

  throw new Error(`Cannot convert node to element: ${JSON.stringify(node)}`);
}

/**
 * Convert a character offset in source to line and column numbers
 * @param source The source content
 * @param offset Character offset (0-based)
 * @returns { line, column } where line is 1-based and column is 1-based
 */
export function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  const lines = before.split('\n');
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length || 0) + 1
  };
}

// Export SourceLocation type for use in error reporting
export type { SourceLocation };

// =============================================================================
// Bundler Integration - Handler Extraction
// =============================================================================

import type {
  ParsedScript as BundlerParsedScript,
  ParsedHandler,
  ParseResult as BundlerParseResult,
  SourcePosition,
  SourceRange,
  ScriptType,
} from './bundler/types.ts';

/**
 * Calculate a SourceRange from content and character offsets
 */
function calculateRange(content: string, startOffset: number, endOffset: number): SourceRange {
  const startPos = offsetToSourcePosition(content, startOffset);
  const endPos = offsetToSourcePosition(content, endOffset);
  return { start: startPos, end: endPos };
}

/**
 * Convert a character offset to a SourcePosition
 */
function offsetToSourcePosition(content: string, offset: number): SourcePosition {
  const before = content.slice(0, offset);
  const lines = before.split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1]?.length || 0,
    offset,
  };
}

/**
 * Extract scripts from a parsed .melker file for the bundler.
 *
 * This extracts script blocks with their type (sync, init, ready),
 * source location, and detects async usage. For scripts with src attribute,
 * loads the external file content.
 */
export async function extractScriptsForBundler(
  content: string,
  scripts: Array<{ type: string; content: string; src?: string }>,
  sourceUrl: string
): Promise<BundlerParsedScript[]> {
  const result: BundlerParsedScript[] = [];

  // Find script tags in the content to get their positions
  // Note: Use non-greedy [^>]*? to avoid matching past /> in self-closing tags
  // type attribute is optional - scripts with only src attribute should also be matched
  const scriptTagPattern = /<script(?:\s+[^>]*?)?(?:\s*\/>|>[\s\S]*?<\/script>)/gi;

  let match;
  let scriptIndex = 0;

  while ((match = scriptTagPattern.exec(content)) !== null) {
    if (scriptIndex >= scripts.length) break;

    const scriptData = scripts[scriptIndex];
    const tagContent = match[0];
    const startOffset = match.index;
    const endOffset = startOffset + tagContent.length;

    // Determine script type from async attribute
    let scriptType: ScriptType = 'sync';
    const asyncMatch = tagContent.match(/async=["'](init|ready)["']/i);
    if (asyncMatch) {
      scriptType = asyncMatch[1].toLowerCase() as ScriptType;
    }

    // Get script code - load from external file if src is specified
    let code = scriptData.content;
    if (scriptData.src && !code.trim()) {
      try {
        const srcUrl = new URL(scriptData.src, sourceUrl).href;
        if (srcUrl.startsWith('file://')) {
          const { fromFileUrl } = await import('https://deno.land/std@0.224.0/path/mod.ts');
          code = await Deno.readTextFile(fromFileUrl(srcUrl));
        } else {
          const response = await fetch(srcUrl);
          if (response.ok) {
            code = await response.text();
          } else {
            throw new Error(`Failed to fetch ${srcUrl}: ${response.status}`);
          }
        }
      } catch (error) {
        throw new Error(`Failed to load script from ${scriptData.src}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Detect if script contains await (auto-async detection)
    const isAsync = scriptType !== 'sync' || /\bawait\b/.test(code);

    result.push({
      id: `script_${scriptIndex}`,
      type: scriptType,
      code,
      externalSrc: scriptData.src,
      isAsync,
      sourceRange: calculateRange(content, startOffset, endOffset),
    });

    scriptIndex++;
  }

  return result;
}

/**
 * Find the containing element tag for an attribute at a given offset.
 */
function findContainingElement(content: string, offset: number): { tag: string; id?: string; line: number } {
  const before = content.slice(0, offset);

  // Find the most recent opening tag
  const tagMatch = before.match(/<(\w+)(?:\s[^>]*)?$/);
  const tag = tagMatch?.[1] || 'unknown';

  // Count lines
  const line = (before.match(/\n/g) || []).length + 1;

  // Try to find id attribute nearby
  const nearbyContent = content.slice(Math.max(0, offset - 200), Math.min(content.length, offset + 200));
  const idMatch = nearbyContent.match(/\bid=["']([^"']+)["']/);

  return { tag, id: idMatch?.[1], line };
}

/**
 * Extract event handlers from a .melker file for the bundler.
 *
 * This finds all event handler attributes (onClick, onInput, etc.)
 * and extracts them with their source positions.
 */
export function extractHandlersForBundler(content: string): ParsedHandler[] {
  const handlers: ParsedHandler[] = [];

  // Match event handler attributes: onXxx="code" or onXxx='code'
  // Need to handle both simple handlers and handlers with nested quotes
  const handlerPattern = /\b(on[A-Z][a-zA-Z]*)\s*=\s*(["'])((?:(?!\2)[^\\]|\\.)*)\2/g;

  let match;
  let handlerIndex = 0;

  while ((match = handlerPattern.exec(content)) !== null) {
    const attributeName = match[1];
    const quote = match[2];
    const code = match[3];

    // Skip empty handlers
    if (!code.trim()) continue;

    // Skip handlers that are already registry calls (from previous processing)
    if (code.includes('__melker.')) continue;

    const attrStartOffset = match.index;
    const attrEndOffset = match.index + match[0].length;

    // Calculate code position (inside quotes)
    const codeStartOffset = match.index + attributeName.length + match[0].indexOf(quote) + 1;
    const codeEndOffset = codeStartOffset + code.length;

    // Detect async handlers
    const isAsync = /\bawait\b/.test(code);

    // Detect parameters
    const params: Array<{ name: string; type: string }> = [];
    if (/\bevent\b/.test(code)) {
      params.push({ name: 'event', type: 'any' });
    }

    // Find containing element info
    const element = findContainingElement(content, attrStartOffset);

    handlers.push({
      id: `__h${handlerIndex}`,
      attributeName,
      code,
      isAsync,
      params,
      attributeRange: calculateRange(content, attrStartOffset, attrEndOffset),
      codeRange: calculateRange(content, codeStartOffset, codeEndOffset),
      element,
    });

    handlerIndex++;
  }

  return handlers;
}

/**
 * Remove script tags from content to get the template portion.
 */
function removeScriptTags(content: string): string {
  // Remove regular closing script tags first
  // Use non-greedy matching to avoid consuming too much
  return content
    .replace(/<script\s+(?:[^>]*?\s+)?type=["'](?:typescript|text\/typescript|javascript|text\/javascript|module)["'][^>]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\s+(?:[^>]*?\s+)?type=["'](?:typescript|text\/typescript|javascript|text\/javascript|module)["'][^>]*?\s*\/>/gi, '');
}

/**
 * Parse a .melker file and return data suitable for the bundler.
 *
 * This is the main entry point for bundler integration. It returns:
 * - scripts: Extracted script blocks with positions and types
 * - handlers: Extracted event handlers with positions
 * - template: The template content (without scripts)
 * - sourceUrl: The source file URL
 * - originalContent: The original file content
 * - resolvedContent: Content after ${} substitution (same for now)
 */
export async function parseMelkerForBundler(
  content: string,
  sourceUrl: string
): Promise<BundlerParseResult> {
  // Parse the file to get scripts
  const parseResult = parseMelkerFile(content);

  // Extract scripts with position info (loads external scripts if needed)
  const scripts = await extractScriptsForBundler(content, parseResult.scripts, sourceUrl);

  // Extract handlers from the original content
  const handlers = extractHandlersForBundler(content);

  // Get template (content without script tags)
  const template = removeScriptTags(content);

  return {
    sourceUrl,
    originalContent: content,
    resolvedContent: content, // ${} substitution happens in melker-main.ts
    scripts,
    handlers,
    template,
  };
}

