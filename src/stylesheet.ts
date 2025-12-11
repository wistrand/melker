// Stylesheet support for Melker - CSS-like style rules
// Simple selectors: #id, type, .class (no nesting or combinators)

import type { Element, Style } from './types.ts';
import { hasClass } from './element.ts';

/**
 * Selector types supported by the stylesheet system
 */
export type SelectorType = 'id' | 'type' | 'class';

/**
 * A single selector part (id, type, or class)
 */
export interface SelectorPart {
  type: SelectorType;
  value: string;
}

/**
 * Parsed selector - can be a compound selector with multiple parts
 * e.g., "#myid.class1.class2" or "button.primary"
 */
export interface StyleSelector {
  parts: SelectorPart[];
}

/**
 * A single style rule with selector and style properties
 */
export interface StyleItem {
  selector: StyleSelector;
  style: Style;
}

/**
 * Parse a selector string into a StyleSelector
 * Supports compound selectors: #id.class1.class2, type.class1.class2, .class1.class2
 */
export function parseSelector(selector: string): StyleSelector {
  const trimmed = selector.trim();
  const parts: SelectorPart[] = [];

  if (!trimmed) {
    return { parts: [] };
  }

  // Parse the selector into parts
  // Handle: #id.class1.class2, type.class1.class2, .class1.class2
  let remaining = trimmed;

  // Check for ID selector first (#id)
  if (remaining.startsWith('#')) {
    const idMatch = remaining.match(/^#([^.]+)/);
    if (idMatch) {
      parts.push({ type: 'id', value: idMatch[1] });
      remaining = remaining.slice(idMatch[0].length);
    }
  }
  // Check for type selector (must be at start, before any dots)
  else if (!remaining.startsWith('.')) {
    const typeMatch = remaining.match(/^([^.]+)/);
    if (typeMatch) {
      parts.push({ type: 'type', value: typeMatch[1] });
      remaining = remaining.slice(typeMatch[0].length);
    }
  }

  // Parse remaining class selectors (.class1.class2...)
  while (remaining.startsWith('.')) {
    const classMatch = remaining.match(/^\.([^.]+)/);
    if (classMatch) {
      parts.push({ type: 'class', value: classMatch[1] });
      remaining = remaining.slice(classMatch[0].length);
    } else {
      break;
    }
  }

  return { parts };
}

/**
 * Check if a single selector part matches an element
 */
function selectorPartMatches(part: SelectorPart, element: Element): boolean {
  switch (part.type) {
    case 'id':
      return element.id === part.value;
    case 'type':
      return element.type === part.value;
    case 'class':
      return hasClass(element, part.value);
    default:
      return false;
  }
}

/**
 * Check if a selector matches an element
 * All parts of a compound selector must match
 */
export function selectorMatches(selector: StyleSelector, element: Element): boolean {
  if (selector.parts.length === 0) {
    return false;
  }

  // All parts must match (compound selector)
  return selector.parts.every(part => selectorPartMatches(part, element));
}

/**
 * Parse a CSS-like style value string into a Style object
 * Converts "width: 40; height: 10; border: thin;" to { width: 40, height: 10, border: 'thin' }
 */
export function parseStyleProperties(cssString: string): Style {
  const style: Style = {};

  // Split by semicolons and process each property
  const properties = cssString.split(';').map(prop => prop.trim()).filter(prop => prop.length > 0);

  for (const property of properties) {
    const colonIndex = property.indexOf(':');
    if (colonIndex === -1) continue;

    const key = property.substring(0, colonIndex).trim();
    const value = property.substring(colonIndex + 1).trim();

    if (!key || !value) continue;

    // Convert kebab-case to camelCase for properties like border-color
    const camelKey = key.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());

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
 * Parse a CSS-like style block into StyleItems
 *
 * Example input:
 * ```
 * #header {
 *   background-color: blue;
 *   color: white;
 * }
 *
 * button {
 *   border: thin;
 * }
 *
 * .primary {
 *   background-color: green;
 * }
 * ```
 */
export function parseStyleBlock(css: string): StyleItem[] {
  const items: StyleItem[] = [];

  // Simple regex-based parsing for CSS-like rules
  // Match: selector { properties }
  const rulePattern = /([^{]+)\{([^}]*)\}/g;

  let match;
  while ((match = rulePattern.exec(css)) !== null) {
    const selectorStr = match[1].trim();
    const propertiesStr = match[2].trim();

    if (!selectorStr || !propertiesStr) continue;

    const selector = parseSelector(selectorStr);
    const style = parseStyleProperties(propertiesStr);

    items.push({ selector, style });
  }

  return items;
}

/**
 * Stylesheet class to manage style rules
 */
export class Stylesheet {
  private _items: StyleItem[] = [];

  constructor(items: StyleItem[] = []) {
    this._items = [...items];
  }

  /**
   * Add a rule from a selector string and style object
   */
  addRule(selector: string, style: Style): void {
    this._items.push({
      selector: parseSelector(selector),
      style,
    });
  }

  /**
   * Add a pre-parsed StyleItem
   */
  addItem(item: StyleItem): void {
    this._items.push(item);
  }

  /**
   * Add multiple items from a CSS-like string
   */
  addFromString(css: string): void {
    const items = parseStyleBlock(css);
    this._items.push(...items);
  }

  /**
   * Get all styles that match an element (in order of definition)
   */
  getMatchingStyles(element: Element): Style[] {
    const matchingStyles: Style[] = [];

    for (const item of this._items) {
      if (selectorMatches(item.selector, element)) {
        matchingStyles.push(item.style);
      }
    }

    return matchingStyles;
  }

  /**
   * Get merged style for an element (all matching rules combined)
   */
  getMergedStyle(element: Element): Style {
    const matchingStyles = this.getMatchingStyles(element);
    return matchingStyles.reduce((merged, style) => ({ ...merged, ...style }), {});
  }

  /**
   * Get all items in the stylesheet
   */
  get items(): readonly StyleItem[] {
    return this._items;
  }

  /**
   * Get number of rules in the stylesheet
   */
  get length(): number {
    return this._items.length;
  }

  /**
   * Clear all rules
   */
  clear(): void {
    this._items = [];
  }

  /**
   * Create a stylesheet from a CSS-like string
   */
  static fromString(css: string): Stylesheet {
    const items = parseStyleBlock(css);
    return new Stylesheet(items);
  }

  /**
   * Apply stylesheet styles to an element tree.
   * Merges stylesheet styles with element's inline styles (inline takes priority).
   * This should be called once at element creation time.
   */
  applyTo(element: Element): void {
    applyStylesheet(element, this);
  }
}

/**
 * Apply stylesheet styles to an element and all its children.
 * Stylesheet styles are merged under inline styles (inline takes priority).
 */
export function applyStylesheet(element: Element, stylesheet: Stylesheet): void {
  // Get matching stylesheet styles for this element
  const stylesheetStyle = stylesheet.getMergedStyle(element);

  if (Object.keys(stylesheetStyle).length > 0) {
    // Merge: stylesheet styles first, then inline styles on top
    const inlineStyle = element.props.style || {};
    element.props.style = { ...stylesheetStyle, ...inlineStyle };
  }

  // Recursively apply to children
  if (element.children) {
    for (const child of element.children) {
      applyStylesheet(child, stylesheet);
    }
  }
}
