// Stylesheet support for Melker - CSS-like style rules
// Selectors: *, #id, type, .class, compound (e.g., *.class, type.class)
// Combinators: descendant (space), child (>)

import type { Element, Style } from './types.ts';
import { hasClass } from './element.ts';
import { parseColor } from './components/color-utils.ts';

/**
 * Selector types supported by the stylesheet system
 */
export type SelectorType = 'id' | 'type' | 'class' | 'universal';

/**
 * Combinator types between selectors
 * - descendant: matches any ancestor (space in CSS)
 * - child: matches direct parent only (> in CSS)
 */
export type Combinator = 'descendant' | 'child';

/**
 * A single selector part (id, type, or class)
 */
export interface SelectorPart {
  type: SelectorType;
  value: string;
}

/**
 * A compound selector - multiple parts that must all match the same element
 * e.g., "button.primary" = [{ type: 'type', value: 'button' }, { type: 'class', value: 'primary' }]
 */
export interface CompoundSelector {
  parts: SelectorPart[];
}

/**
 * A segment in a selector chain - compound selector with its preceding combinator
 */
export interface SelectorSegment {
  combinator: Combinator | null;  // null for the first segment
  compound: CompoundSelector;
}

/**
 * Parsed selector - a chain of selector segments
 * e.g., "container > .card text" = [container, >(child).card, (descendant)text]
 */
export interface StyleSelector {
  segments: SelectorSegment[];
}

/**
 * Media query condition — all specified fields must match.
 */
export interface MediaCondition {
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

/**
 * Terminal dimensions for evaluating @media conditions.
 */
export interface StyleContext {
  terminalWidth: number;
  terminalHeight: number;
}

/**
 * Evaluate whether a media condition matches the given terminal dimensions.
 * All specified fields must match (AND logic). Empty condition always matches.
 */
export function mediaConditionMatches(condition: MediaCondition, ctx: StyleContext): boolean {
  if (condition.minWidth !== undefined && ctx.terminalWidth < condition.minWidth) return false;
  if (condition.maxWidth !== undefined && ctx.terminalWidth > condition.maxWidth) return false;
  if (condition.minHeight !== undefined && ctx.terminalHeight < condition.minHeight) return false;
  if (condition.maxHeight !== undefined && ctx.terminalHeight > condition.maxHeight) return false;
  return true;
}

/**
 * A single style rule with selector and style properties
 */
export interface StyleItem {
  selector: StyleSelector;
  style: Style;
  mediaCondition?: MediaCondition;
}

/**
 * Parse a single compound selector (no spaces)
 * e.g., "#id.class1.class2", "button.primary", ".class1.class2"
 */
function parseCompoundSelector(selector: string): CompoundSelector {
  const parts: SelectorPart[] = [];
  let remaining = selector;

  if (!remaining) {
    return { parts: [] };
  }

  // Check for ID selector first (#id)
  if (remaining.startsWith('#')) {
    const idMatch = remaining.match(/^#([^.#]+)/);
    if (idMatch) {
      parts.push({ type: 'id', value: idMatch[1] });
      remaining = remaining.slice(idMatch[0].length);
    }
  }
  // Check for universal selector (*)
  else if (remaining.startsWith('*')) {
    parts.push({ type: 'universal', value: '*' });
    remaining = remaining.slice(1);
  }
  // Check for type selector (must be at start, before any dots)
  else if (!remaining.startsWith('.')) {
    const typeMatch = remaining.match(/^([^.#]+)/);
    if (typeMatch) {
      parts.push({ type: 'type', value: typeMatch[1] });
      remaining = remaining.slice(typeMatch[0].length);
    }
  }

  // Parse remaining class selectors (.class1.class2...)
  while (remaining.startsWith('.')) {
    const classMatch = remaining.match(/^\.([^.#]+)/);
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
 * Parse a selector string into a StyleSelector
 * Supports:
 * - Compound selectors: #id.class1.class2, type.class1.class2, .class1.class2
 * - Descendant combinator: "container .card text" (space-separated)
 * - Child combinator: "container > .card" (> symbol)
 */
export function parseSelector(selector: string): StyleSelector {
  const trimmed = selector.trim();

  if (!trimmed) {
    return { segments: [] };
  }

  const segments: SelectorSegment[] = [];

  // Tokenize: split by spaces and '>' while preserving '>' as a token
  // "container > .card text" -> ["container", ">", ".card", "text"]
  const tokens = trimmed.split(/(\s*>\s*|\s+)/).filter(t => t.trim().length > 0).map(t => t.trim());

  let currentCombinator: Combinator | null = null;

  for (const token of tokens) {
    if (token === '>') {
      currentCombinator = 'child';
    } else {
      segments.push({
        combinator: segments.length === 0 ? null : (currentCombinator || 'descendant'),
        compound: parseCompoundSelector(token),
      });
      currentCombinator = null;
    }
  }

  return { segments };
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
    case 'universal':
      return true; // Matches any element
    default:
      return false;
  }
}

/**
 * Check if a compound selector matches an element
 * All parts must match the same element
 */
function compoundSelectorMatches(compound: CompoundSelector, element: Element): boolean {
  if (compound.parts.length === 0) {
    return false;
  }
  return compound.parts.every(part => selectorPartMatches(part, element));
}

/**
 * Check if a selector matches an element, considering ancestors for combinators
 * @param selector The parsed selector (segments with combinators)
 * @param element The target element to match
 * @param ancestors Optional array of ancestor elements (parent first, then grandparent, etc.)
 */
export function selectorMatches(selector: StyleSelector, element: Element, ancestors: Element[] = []): boolean {
  if (selector.segments.length === 0) {
    return false;
  }

  // The last segment must match the target element
  const targetSegment = selector.segments[selector.segments.length - 1];
  if (!compoundSelectorMatches(targetSegment.compound, element)) {
    return false;
  }

  // If only one segment, we're done
  if (selector.segments.length === 1) {
    return true;
  }

  // Check ancestor segments, respecting combinator types
  // Work backwards through segments, matching against ancestors
  let ancestorIndex = 0;

  for (let i = selector.segments.length - 2; i >= 0; i--) {
    const segment = selector.segments[i];
    // The combinator is on the NEXT segment (the one that comes after this in the chain)
    const nextSegment = selector.segments[i + 1];
    const combinator = nextSegment.combinator || 'descendant';

    if (combinator === 'child') {
      // Child combinator: must match the immediate ancestor (current ancestorIndex)
      if (ancestorIndex >= ancestors.length) {
        return false;
      }
      if (!compoundSelectorMatches(segment.compound, ancestors[ancestorIndex])) {
        return false;
      }
      ancestorIndex++;
    } else {
      // Descendant combinator: search through ancestors for a match
      let found = false;
      while (ancestorIndex < ancestors.length) {
        if (compoundSelectorMatches(segment.compound, ancestors[ancestorIndex])) {
          ancestorIndex++;
          found = true;
          break;
        }
        ancestorIndex++;
      }
      if (!found) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Check if a selector string matches an element.
 * Supports comma-separated selectors (OR): "img, canvas, .media"
 * @param ancestors Optional array of ancestor elements for descendant matching
 */
export function selectorStringMatches(selectorString: string, element: Element, ancestors: Element[] = []): boolean {
  // Handle comma-separated selectors (OR)
  if (selectorString.includes(',')) {
    return selectorString.split(',').some(s => selectorStringMatches(s.trim(), element, ancestors));
  }
  return selectorMatches(parseSelector(selectorString), element, ancestors);
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

    // Check if this is a color property
    const isColorProp = camelKey === 'color' || camelKey === 'backgroundColor' ||
                        camelKey === 'borderColor' || camelKey.endsWith('Color');

    // Check if this is padding or margin with CSS shorthand (e.g., "0 1", "1 2 3", "1 2 3 4")
    const isBoxSpacingProp = camelKey === 'padding' || camelKey === 'margin';
    if (isBoxSpacingProp) {
      const parts = value.split(/\s+/).map(p => parseFloat(p));
      if (parts.length >= 2 && parts.every(p => !isNaN(p))) {
        // CSS shorthand: 2 values = vertical horizontal
        //               3 values = top horizontal bottom
        //               4 values = top right bottom left
        if (parts.length === 2) {
          style[camelKey] = { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
        } else if (parts.length === 3) {
          style[camelKey] = { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
        } else if (parts.length >= 4) {
          style[camelKey] = { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
        }
        continue;
      }
      // Fall through to single number or string handling
    }

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
      const unquoted = value.slice(1, -1);
      // If it's a color property, parse to packed RGBA
      style[camelKey] = isColorProp ? parseColor(unquoted) : unquoted;
    }
    // Color properties - parse to packed RGBA
    else if (isColorProp) {
      style[camelKey] = parseColor(value);
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
 * Parse a @media condition string like "(max-width: 80)" or
 * "(min-width: 60) and (max-width: 100)" into a MediaCondition.
 * Returns undefined for invalid/unrecognized conditions.
 */
function parseMediaCondition(conditionStr: string): MediaCondition | undefined {
  const condition: MediaCondition = {};
  const parts = conditionStr.split(/\)\s+and\s+\(/i);
  let hasValid = false;

  for (let part of parts) {
    part = part.replace(/^\(/, '').replace(/\)$/, '').trim();
    const match = part.match(/^(min-width|max-width|min-height|max-height)\s*:\s*(\d+)$/);
    if (!match) continue;

    const [, prop, val] = match;
    const num = parseInt(val, 10);
    if (prop === 'min-width') condition.minWidth = num;
    else if (prop === 'max-width') condition.maxWidth = num;
    else if (prop === 'min-height') condition.minHeight = num;
    else if (prop === 'max-height') condition.maxHeight = num;
    hasValid = true;
  }

  return hasValid ? condition : undefined;
}

/**
 * A top-level block extracted by the brace-balancing tokenizer.
 */
interface CSSBlock {
  selector: string;
  body: string;
}

/**
 * Tokenize CSS into top-level blocks using brace-depth tracking.
 * Handles nested braces (e.g., @media { .rule { } }) that regex cannot.
 */
function tokenizeCSS(css: string): CSSBlock[] {
  const blocks: CSSBlock[] = [];
  let depth = 0;
  let selectorStart = 0;
  let bodyStart = 0;

  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      if (depth === 0) {
        bodyStart = i;
      }
      depth++;
    } else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        const selector = css.slice(selectorStart, bodyStart).trim();
        const body = css.slice(bodyStart + 1, i).trim();
        blocks.push({ selector, body });
        selectorStart = i + 1;
      }
    }
  }
  return blocks;
}

/**
 * Parse a CSS-like style block into StyleItems.
 * Supports both regular rules and @media blocks with nested rules.
 *
 * Example input:
 * ```
 * #header {
 *   height: 3;
 *   font-weight: bold;
 * }
 *
 * @media (max-width: 80) {
 *   .sidebar { width: 20; }
 * }
 *
 * .primary {
 *   background-color: green;
 * }
 * ```
 */
export function parseStyleBlock(css: string): StyleItem[] {
  const items: StyleItem[] = [];

  // Strip CSS comments before parsing
  const cssWithoutComments = css
    .replace(/\/\*[\s\S]*?\*\//g, '')  // Block comments
    .replace(/\/\/.*$/gm, '');          // Single-line comments

  const blocks = tokenizeCSS(cssWithoutComments);

  for (const block of blocks) {
    if (block.selector.startsWith('@media')) {
      // Extract condition from "@media (condition)"
      const condStr = block.selector.slice(6).trim();
      const condition = parseMediaCondition(condStr);
      if (!condition) continue;  // Skip unrecognized @media conditions

      // Recursively parse nested rules inside the @media block
      const nestedItems = parseStyleBlock(block.body);
      for (const item of nestedItems) {
        items.push({ ...item, mediaCondition: condition });
      }
    } else {
      // Regular rule: selector { properties }
      const selectorStr = block.selector;
      const propertiesStr = block.body;

      if (!selectorStr || !propertiesStr) continue;

      const selector = parseSelector(selectorStr);
      const style = parseStyleProperties(propertiesStr);

      items.push({ selector, style });
    }
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
   * Get all styles that match an element (in order of definition).
   * When ctx is provided, media-conditioned rules are evaluated against it.
   * When ctx is omitted, media-conditioned rules are excluded.
   */
  getMatchingStyles(element: Element, ancestors: Element[] = [], ctx?: StyleContext): Style[] {
    const matchingStyles: Style[] = [];

    for (const item of this._items) {
      if (item.mediaCondition) {
        if (!ctx || !mediaConditionMatches(item.mediaCondition, ctx)) continue;
      }
      if (selectorMatches(item.selector, element, ancestors)) {
        matchingStyles.push(item.style);
      }
    }

    return matchingStyles;
  }

  /**
   * Get merged style for an element (all matching rules combined).
   * When ctx is provided, media-conditioned rules are evaluated against it.
   * When ctx is omitted, media-conditioned rules are excluded.
   */
  getMergedStyle(element: Element, ancestors: Element[] = [], ctx?: StyleContext): Style {
    const matchingStyles = this.getMatchingStyles(element, ancestors, ctx);
    return matchingStyles.reduce((merged, style) => ({ ...merged, ...style }), {});
  }

  /**
   * Whether any rules have @media conditions.
   * Fast path: skip re-application on resize when false.
   */
  get hasMediaRules(): boolean {
    return this._items.some(item => item.mediaCondition !== undefined);
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
   * Safe to call multiple times — tracks style origins for correct re-application.
   */
  applyTo(element: Element, ctx?: StyleContext): void {
    applyStylesheet(element, this, [], ctx);
  }
}

/**
 * Apply stylesheet styles to an element and all its children.
 * Stylesheet styles are merged under inline styles (inline takes priority).
 * Supports descendant selectors by tracking ancestor chain.
 *
 * Tracks style origins for safe re-application (e.g., on terminal resize):
 * - _inlineStyle: ground truth from markup or script writes (survives re-apply)
 * - _computedStyle: last merged result (used to diff-detect script changes)
 *
 * On first call: captures element.props.style as _inlineStyle.
 * On subsequent calls: diffs props.style vs _computedStyle to detect script
 * changes, merges those into _inlineStyle, then recomputes from scratch.
 */
export function applyStylesheet(element: Element, stylesheet: Stylesheet, ancestors: Element[] = [], ctx?: StyleContext): void {
  // Get matching stylesheet styles for this element (with ancestor context)
  const stylesheetStyle = stylesheet.getMergedStyle(element, ancestors, ctx);

  if (element._inlineStyle === undefined) {
    // First application: capture current props.style as inline ground truth
    element._inlineStyle = element.props.style ? { ...element.props.style } : {};
  } else if (element._computedStyle !== undefined) {
    // Re-application: detect script changes by diffing current vs last computed
    const currentStyle = element.props.style || {};
    const lastComputed = element._computedStyle;

    // Properties added or changed by script → merge into _inlineStyle
    for (const key of Object.keys(currentStyle)) {
      if (currentStyle[key] !== lastComputed[key]) {
        element._inlineStyle[key] = currentStyle[key];
      }
    }
    // Properties removed by script → remove from _inlineStyle
    for (const key of Object.keys(element._inlineStyle)) {
      if (!(key in currentStyle)) {
        delete element._inlineStyle[key];
      }
    }
  }

  // Compute merged style: stylesheet under inline (inline always wins)
  const inlineStyle = element._inlineStyle!;
  const hasStylesheet = Object.keys(stylesheetStyle).length > 0;
  const hasInline = Object.keys(inlineStyle).length > 0;

  if (hasStylesheet || hasInline) {
    element.props.style = { ...stylesheetStyle, ...inlineStyle };
  }

  // Track what we computed for future script-change detection
  element._computedStyle = element.props.style ? { ...element.props.style } : {};

  // Recursively apply to children, adding current element to ancestors
  if (element.children) {
    const childAncestors = [element, ...ancestors];
    for (const child of element.children) {
      applyStylesheet(child, stylesheet, childAncestors, ctx);
    }
  }
}
