// Stylesheet support for Melker - CSS-like style rules
// Selectors: *, #id, type, .class, compound (e.g., *.class, type.class)
// Combinators: descendant (space), child (>)

import type { Element, Style, KeyframeDefinition, AnimationKeyframe, AnimationState } from './types.ts';
import { hasClass } from './element.ts';
import { parseColor } from './components/color-utils.ts';
import { getTimingFunction } from './easing.ts';
import { getUIAnimationManager } from './ui-animation-manager.ts';

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
  orientation?: 'portrait' | 'landscape';
  minAspectRatio?: number;
  maxAspectRatio?: number;
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
  if (condition.orientation !== undefined) {
    const isPortrait = ctx.terminalHeight > ctx.terminalWidth;
    if (condition.orientation === 'portrait' && !isPortrait) return false;
    if (condition.orientation === 'landscape' && isPortrait) return false;
  }
  if (condition.minAspectRatio !== undefined || condition.maxAspectRatio !== undefined) {
    const ratio = ctx.terminalWidth / ctx.terminalHeight;
    if (condition.minAspectRatio !== undefined && ratio < condition.minAspectRatio) return false;
    if (condition.maxAspectRatio !== undefined && ratio > condition.maxAspectRatio) return false;
  }
  return true;
}

/**
 * A single style rule with selector and style properties
 */
export interface StyleItem {
  selector: StyleSelector;
  style: Style;
  specificity: number;
  mediaCondition?: MediaCondition;
}

/**
 * Compute CSS specificity from a parsed selector.
 * Returns ids * 1_000_000 + classes * 1_000 + types.
 */
function selectorSpecificity(selector: StyleSelector): number {
  let ids = 0, classes = 0, types = 0;
  for (const seg of selector.segments) {
    for (const part of seg.compound.parts) {
      if (part.type === 'id') ids++;
      else if (part.type === 'class') classes++;
      else if (part.type === 'type') types++;
    }
  }
  return ids * 1_000_000 + classes * 1_000 + types;
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
 * Parse a CSS time value (e.g., "500ms", "1s", "0.5s") to milliseconds.
 * Returns undefined if not a valid time value.
 */
function parseTimeValue(value: string): number | undefined {
  const msMatch = value.match(/^(\d+(?:\.\d+)?)ms$/);
  if (msMatch) return parseFloat(msMatch[1]);
  const sMatch = value.match(/^(\d+(?:\.\d+)?)s$/);
  if (sMatch) return parseFloat(sMatch[1]) * 1000;
  return undefined;
}

/** Properties that accept time values */
const TIME_PROPS = new Set(['animationDuration', 'animationDelay']);

/** Properties that accept 'infinite' as a keyword (mapped to Infinity) */
const INFINITE_PROPS = new Set(['animationIterationCount']);

/**
 * Parse the `animation` shorthand into individual properties.
 * Format: [name] [duration] [timing-function] [delay] [iteration-count] [direction] [fill-mode]
 * Only name is required. Duration/delay are disambiguated: first time value is duration, second is delay.
 */
function parseAnimationShorthand(value: string): Partial<Style> {
  const parts = value.split(/\s+/);
  const result: Partial<Style> = {};

  const timingFunctions = new Set([
    'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out',
  ]);
  const directions = new Set([
    'normal', 'reverse', 'alternate', 'alternate-reverse',
  ]);
  const fillModes = new Set([
    'none', 'forwards', 'backwards', 'both',
  ]);

  let timeCount = 0;

  for (const part of parts) {
    // Time value (duration first, then delay)
    const time = parseTimeValue(part);
    if (time !== undefined) {
      if (timeCount === 0) {
        result.animationDuration = time;
      } else {
        result.animationDelay = time;
      }
      timeCount++;
      continue;
    }

    // Iteration count
    if (part === 'infinite') {
      result.animationIterationCount = Infinity;
      continue;
    }
    if (/^\d+$/.test(part) && result.animationDuration !== undefined) {
      // Plain number after we already have a duration — iteration count
      result.animationIterationCount = parseInt(part, 10);
      continue;
    }

    // steps() function
    if (part.startsWith('steps(')) {
      result.animationTimingFunction = part;
      continue;
    }

    // Timing function
    if (timingFunctions.has(part)) {
      result.animationTimingFunction = part;
      continue;
    }

    // Direction
    if (directions.has(part)) {
      result.animationDirection = part as Style['animationDirection'];
      continue;
    }

    // Fill mode (only if not already matched as direction — 'none' is fill-mode only)
    if (fillModes.has(part) && !directions.has(part)) {
      result.animationFillMode = part as Style['animationFillMode'];
      continue;
    }

    // Must be the animation name
    if (!result.animationName) {
      result.animationName = part;
    }
  }

  return result;
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

    // Animation shorthand: expand into individual properties
    if (camelKey === 'animation') {
      const expanded = parseAnimationShorthand(value);
      Object.assign(style, expanded);
      continue;
    }

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

    // Time value properties (animation-duration, animation-delay)
    if (TIME_PROPS.has(camelKey)) {
      const time = parseTimeValue(value);
      if (time !== undefined) {
        style[camelKey] = time;
        continue;
      }
      // Fall through to number/string handling (bare number = ms)
    }

    // 'infinite' keyword for iteration count
    if (INFINITE_PROPS.has(camelKey) && value === 'infinite') {
      style[camelKey] = Infinity;
      continue;
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

    // Match dimension conditions: (min-width: 80), (max-height: 24)
    const dimMatch = part.match(/^(min-width|max-width|min-height|max-height)\s*:\s*(\d+)$/);
    if (dimMatch) {
      const [, prop, val] = dimMatch;
      const num = parseInt(val, 10);
      if (prop === 'min-width') condition.minWidth = num;
      else if (prop === 'max-width') condition.maxWidth = num;
      else if (prop === 'min-height') condition.minHeight = num;
      else if (prop === 'max-height') condition.maxHeight = num;
      hasValid = true;
      continue;
    }

    // Match orientation: (orientation: portrait), (orientation: landscape)
    const orientMatch = part.match(/^orientation\s*:\s*(portrait|landscape)$/);
    if (orientMatch) {
      condition.orientation = orientMatch[1] as 'portrait' | 'landscape';
      hasValid = true;
      continue;
    }

    // Match aspect-ratio: (min-aspect-ratio: 16/9), (max-aspect-ratio: 4/3)
    const ratioMatch = part.match(/^(min-aspect-ratio|max-aspect-ratio)\s*:\s*(\d+)\/(\d+)$/);
    if (ratioMatch) {
      const [, prop, num, den] = ratioMatch;
      const denominator = parseInt(den, 10);
      if (denominator > 0) {
        const ratio = parseInt(num, 10) / denominator;
        if (prop === 'min-aspect-ratio') condition.minAspectRatio = ratio;
        else if (prop === 'max-aspect-ratio') condition.maxAspectRatio = ratio;
        hasValid = true;
      }
      continue;
    }
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

/** Result of parsing a CSS block — style rules and keyframe definitions */
interface ParseResult {
  items: StyleItem[];
  keyframes: KeyframeDefinition[];
}

/**
 * Parse a @keyframes block body into an AnimationKeyframe array.
 * Supports percentage selectors (0%, 50%, 100%) and keywords (from, to).
 */
function parseKeyframeBlock(name: string, body: string): KeyframeDefinition {
  const innerBlocks = tokenizeCSS(body);
  const keyframes: AnimationKeyframe[] = [];

  for (const block of innerBlocks) {
    const sel = block.selector.trim();
    let offset: number;

    if (sel === 'from') {
      offset = 0;
    } else if (sel === 'to') {
      offset = 1;
    } else {
      const pctMatch = sel.match(/^(\d+(?:\.\d+)?)%$/);
      if (!pctMatch) continue;
      offset = parseFloat(pctMatch[1]) / 100;
    }

    const style = parseStyleProperties(block.body);
    keyframes.push({ offset, style });
  }

  // Sort by offset
  keyframes.sort((a, b) => a.offset - b.offset);

  return { name, keyframes };
}

/**
 * Parse a CSS-like style block into StyleItems and KeyframeDefinitions.
 * Supports regular rules, @media blocks with nested rules, and @keyframes blocks.
 *
 * Example input:
 * ```
 * @keyframes fadeIn {
 *   from { color: transparent; }
 *   to   { color: white; }
 * }
 *
 * #header {
 *   height: 3;
 *   font-weight: bold;
 *   animation: fadeIn 1s ease-in-out;
 * }
 *
 * @media (max-width: 80) {
 *   .sidebar { width: 20; }
 * }
 * ```
 */
export function parseStyleBlock(css: string): ParseResult {
  const items: StyleItem[] = [];
  const keyframes: KeyframeDefinition[] = [];

  // Strip CSS comments before parsing
  const cssWithoutComments = css
    .replace(/\/\*[\s\S]*?\*\//g, '')  // Block comments
    .replace(/\/\/.*$/gm, '');          // Single-line comments

  const blocks = tokenizeCSS(cssWithoutComments);

  for (const block of blocks) {
    if (block.selector.startsWith('@keyframes')) {
      // Extract name from "@keyframes name"
      const name = block.selector.slice(10).trim();
      if (name && block.body) {
        keyframes.push(parseKeyframeBlock(name, block.body));
      }
    } else if (block.selector.startsWith('@media')) {
      // Extract condition from "@media (condition)"
      const condStr = block.selector.slice(6).trim();
      const condition = parseMediaCondition(condStr);
      if (!condition) continue;  // Skip unrecognized @media conditions

      // Recursively parse nested rules inside the @media block
      const nested = parseStyleBlock(block.body);
      for (const item of nested.items) {
        items.push({ ...item, mediaCondition: condition });
      }
      // Keyframes inside @media are still global
      keyframes.push(...nested.keyframes);
    } else {
      // Regular rule: selector { properties }
      const selectorStr = block.selector;
      const propertiesStr = block.body;

      if (!selectorStr || !propertiesStr) continue;

      const selector = parseSelector(selectorStr);
      const style = parseStyleProperties(propertiesStr);

      items.push({ selector, style, specificity: selectorSpecificity(selector) });
    }
  }

  return { items, keyframes };
}

/**
 * Stylesheet class to manage style rules
 */
export class Stylesheet {
  private _items: StyleItem[] = [];
  private _keyframes: Map<string, KeyframeDefinition> = new Map();

  constructor(items: StyleItem[] = []) {
    this._items = [...items];
  }

  /**
   * Add a rule from a selector string and style object
   */
  addRule(selector: string, style: Style): void {
    const parsed = parseSelector(selector);
    this._items.push({
      selector: parsed,
      style,
      specificity: selectorSpecificity(parsed),
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
    const { items, keyframes } = parseStyleBlock(css);
    this._items.push(...items);
    for (const kf of keyframes) {
      this._keyframes.set(kf.name, kf);
    }
  }

  /**
   * Get all styles that match an element, sorted by CSS specificity.
   * Definition order is the tiebreaker (stable sort).
   * When ctx is provided, media-conditioned rules are evaluated against it.
   * When ctx is omitted, media-conditioned rules are excluded.
   */
  getMatchingStyles(element: Element, ancestors: Element[] = [], ctx?: StyleContext): Style[] {
    const matches: { style: Style; specificity: number; index: number }[] = [];

    for (let i = 0; i < this._items.length; i++) {
      const item = this._items[i];
      if (item.mediaCondition) {
        if (!ctx || !mediaConditionMatches(item.mediaCondition, ctx)) continue;
      }
      if (selectorMatches(item.selector, element, ancestors)) {
        matches.push({ style: item.style, specificity: item.specificity, index: i });
      }
    }

    matches.sort((a, b) => a.specificity - b.specificity || a.index - b.index);
    return matches.map(m => m.style);
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
   * Clear all rules and keyframes
   */
  clear(): void {
    this._items = [];
    this._keyframes.clear();
  }

  /**
   * Add a keyframe definition
   */
  addKeyframes(definition: KeyframeDefinition): void {
    this._keyframes.set(definition.name, definition);
  }

  /**
   * Get a keyframe definition by name
   */
  getKeyframes(name: string): KeyframeDefinition | undefined {
    return this._keyframes.get(name);
  }

  /**
   * Whether any keyframe definitions are registered
   */
  get hasKeyframes(): boolean {
    return this._keyframes.size > 0;
  }

  /**
   * Create a stylesheet from a CSS-like string
   */
  static fromString(css: string): Stylesheet {
    const { items, keyframes } = parseStyleBlock(css);
    const sheet = new Stylesheet(items);
    for (const kf of keyframes) {
      sheet._keyframes.set(kf.name, kf);
    }
    return sheet;
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

  // --- CSS Animation lifecycle ---
  const resolvedStyle = element.props.style || {};
  const animName = resolvedStyle.animationName;

  if (animName && animName !== 'none' && stylesheet.hasKeyframes) {
    const kfDef = stylesheet.getKeyframes(animName);
    if (kfDef && kfDef.keyframes.length > 0) {
      // If same animation already running, don't restart (handles resize re-apply)
      if (!element._animationState || element._animationState.name !== animName) {
        // Tear down previous animation if any
        stopElementAnimation(element);

        // Bootstrap new animation
        const state: AnimationState = {
          name: animName,
          keyframes: kfDef.keyframes,
          duration: resolvedStyle.animationDuration ?? 0,
          delay: resolvedStyle.animationDelay ?? 0,
          iterations: resolvedStyle.animationIterationCount ?? 1,
          direction: resolvedStyle.animationDirection ?? 'normal',
          timingFn: getTimingFunction(resolvedStyle.animationTimingFunction ?? 'linear'),
          fillMode: resolvedStyle.animationFillMode ?? 'none',
          startTime: performance.now(),
          finished: false,
        };
        element._animationState = state;

        // Register with UIAnimationManager — tick only requests render
        const manager = getUIAnimationManager();
        const animId = `css-anim-${element.id}-${Date.now()}`;
        const unregister = manager.register(animId, () => {
          if (state.finished) {
            stopElementAnimation(element);
            return;
          }
          manager.requestRender();
        }, 16); // ~60fps
        element._animationRegistration = unregister;
      }
    }
  } else if (element._animationState) {
    // animation-name removed or set to 'none' — tear down
    stopElementAnimation(element);
  }

  // Recursively apply to children, adding current element to ancestors
  if (element.children) {
    const childAncestors = [element, ...ancestors];
    for (const child of element.children) {
      applyStylesheet(child, stylesheet, childAncestors, ctx);
    }
  }
}

/**
 * Stop and clean up a CSS animation on an element.
 */
export function stopElementAnimation(element: Element): void {
  if (element._animationRegistration) {
    element._animationRegistration();
    element._animationRegistration = undefined;
  }
  element._animationState = undefined;
}
