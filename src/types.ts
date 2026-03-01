// Core element types for the Melker UI library
// Runtime code: Element class, border chars, type guards, scroll helpers.
// Pure type definitions live in ./core-types.ts and are re-exported below.

// Re-export all pure types
export * from './core-types.ts';

import type {
  AnimationState, Bounds, BorderChars, BorderStyle, ClickEvent,
  Clickable, ComponentRenderContext, ContentGettable, Disposable,
  Draggable, Focusable, FocusCapturable, HasIntrinsicSize,
  HasSubtreeElements, IntrinsicSizeContext, Interactive,
  KeyboardElement, KeyInputHandler, OverflowValue, PositionalClickHandler,
  Renderable, SelectableTextProvider, ShaderElement, Size,
  TextSelectable, Toggleable, TransitionState, Wheelable,
} from './core-types.ts';
import { getUnicodeTier } from './utils/terminal-detection.ts';

export const BORDER_CHARS: Record<Exclude<BorderStyle, 'none'>, BorderChars> = {
  thin:           { h: '─', v: '│', tl: '┌', tr: '┐', bl: '└', br: '┘', tm: '┬', bm: '┴', lm: '├', rm: '┤', mm: '┼' },
  thick:          { h: '━', v: '┃', tl: '┏', tr: '┓', bl: '┗', br: '┛', tm: '┳', bm: '┻', lm: '┣', rm: '┫', mm: '╋' },
  double:         { h: '═', v: '║', tl: '╔', tr: '╗', bl: '╚', br: '╝', tm: '╦', bm: '╩', lm: '╠', rm: '╣', mm: '╬' },
  rounded:        { h: '─', v: '│', tl: '╭', tr: '╮', bl: '╰', br: '╯', tm: '┬', bm: '┴', lm: '├', rm: '┤', mm: '┼' },
  dashed:         { h: '┄', v: '┆', tl: '┌', tr: '┐', bl: '└', br: '┘', tm: '┬', bm: '┴', lm: '├', rm: '┤', mm: '┼' },
  'dashed-rounded': { h: '┄', v: '┆', tl: '╭', tr: '╮', bl: '╰', br: '╯', tm: '┬', bm: '┴', lm: '├', rm: '┤', mm: '┼' },
  ascii:          { h: '-', v: '|', tl: '+', tr: '+', bl: '+', br: '+', tm: '+', bm: '+', lm: '+', rm: '+', mm: '+' },
  'ascii-rounded': { h: '-', v: '|', tl: '·', tr: '·', bl: '·', br: '·', tm: '+', bm: '+', lm: '+', rm: '+', mm: '+' },
  block:          { h: ' ', v: ' ', tl: ' ', tr: ' ', bl: ' ', br: ' ', tm: ' ', bm: ' ', lm: ' ', rm: ' ', mm: ' ' },
  dotted:         { h: '·', v: '·', tl: '·', tr: '·', bl: '·', br: '·', tm: '·', bm: '·', lm: '·', rm: '·', mm: '·' },
};

// Styles that need full Unicode (rounded corners, thick/dashed lines, braille, etc.)
const FULL_ONLY_STYLES: ReadonlySet<string> = new Set([
  'thick', 'rounded', 'dashed', 'dashed-rounded', 'dotted',
]);

// All Unicode border styles (basic tier still needs ascii fallback for these)
const ALL_UNICODE_STYLES: ReadonlySet<string> = new Set([
  'thin', 'thick', 'double', 'rounded', 'dashed', 'dashed-rounded', 'dotted',
]);

/**
 * Get border characters for a style, with tiered fallback:
 * - full:  all styles available as-is
 * - basic: thin/double work; thick/rounded/dashed/dotted → thin
 * - ascii: all Unicode styles → ascii
 */
export function getBorderChars(style: Exclude<BorderStyle, 'none'>): BorderChars {
  const tier = getUnicodeTier();
  let effective: string = style;
  if (tier === 'ascii' && ALL_UNICODE_STYLES.has(style)) {
    effective = 'ascii';
  } else if (tier === 'basic' && FULL_ONLY_STYLES.has(style)) {
    effective = 'thin';
  }
  return BORDER_CHARS[effective as Exclude<BorderStyle, 'none'>] || BORDER_CHARS.thin;
}

// Global element ID counter for auto-generation
let _elementIdCounter = 0;

/**
 * Generate a unique element ID
 */
export function generateElementId(): string {
  return `el-${++_elementIdCounter}`;
}

// Base element class
export abstract class Element {
  readonly type: string;
  readonly id: string;
  props: Record<string, any>;
  children?: Element[];
  protected _bounds: Bounds | null = null;

  // Style origin tracking for media query re-application.
  // _inlineStyle: ground truth from markup style="..." or script .props.style = {...}
  // _computedStyle: last result of applyStylesheet merge (for diffing script changes)
  // Both undefined until first applyStylesheet call.
  _inlineStyle?: Record<string, any>;
  _computedStyle?: Record<string, any>;

  // CSS animation state (Option B: never written to props.style, read by _computeStyle())
  _animationState?: AnimationState;
  _animationRegistration?: () => void;  // UIAnimationManager unregister fn

  // CSS transition state
  _transitionState?: TransitionState;
  _transitionRegistration?: () => void;  // UIAnimationManager unregister fn

  constructor(type: string, props: Record<string, any> = {}, children?: Element[]) {
    this.type = type;
    this.props = props;
    this.children = children;
    // Always generate an ID if not provided - ensures all elements are identifiable
    this.id = props.id || generateElementId();
  }

  /**
   * Get the element's layout bounds (set during render)
   */
  getBounds(): Bounds | null {
    return this._bounds;
  }

  /**
   * Set the element's layout bounds (called by layout/render system)
   */
  setBounds(bounds: Bounds): void {
    this._bounds = bounds;
  }
}

// Type guard for Focusable interface
export function isFocusable(element: Element): element is Element & Focusable {
  return 'canReceiveFocus' in element && typeof element.canReceiveFocus === 'function';
}

// Type guard for HasSubtreeElements interface
export function hasSubtreeElements(element: Element): element is Element & HasSubtreeElements {
  return 'getSubtreeElements' in element && typeof (element as unknown as HasSubtreeElements).getSubtreeElements === 'function';
}

// Type guard for Disposable interface
export function isDisposable(element: Element): element is Element & Disposable {
  return 'dispose' in element && typeof (element as unknown as Disposable).dispose === 'function';
}

// Type guard for FocusCapturable interface
export function isFocusCapturable(element: Element): element is Element & FocusCapturable {
  return 'capturesFocusForChildren' in element && typeof (element as unknown as FocusCapturable).capturesFocusForChildren === 'function';
}

// Type guard for Toggleable interface
export function isToggleable(element: Element): element is Element & Toggleable {
  return 'toggle' in element && typeof (element as unknown as Toggleable).toggle === 'function';
}

// Type guard for KeyInputHandler interface
export function hasKeyInputHandler(element: Element): element is Element & KeyInputHandler {
  return 'handleKeyInput' in element && typeof (element as unknown as KeyInputHandler).handleKeyInput === 'function';
}

// Type guard for ContentGettable interface
export function hasGetContent(element: Element): element is Element & ContentGettable {
  return 'getContent' in element && typeof (element as unknown as ContentGettable).getContent === 'function';
}

// Type guard for Renderable interface
export function isRenderable(element: Element): element is Element & Renderable {
  return 'render' in element &&
         typeof element.render === 'function' &&
         'intrinsicSize' in element &&
         typeof element.intrinsicSize === 'function';
}

// Type guard for HasIntrinsicSize interface
export function hasIntrinsicSize(element: Element): element is Element & HasIntrinsicSize {
  return 'intrinsicSize' in element && typeof (element as unknown as HasIntrinsicSize).intrinsicSize === 'function';
}

// Type guard for Clickable interface
export function isClickable(element: Element): element is Element & Clickable {
  return 'handleClick' in element && typeof element.handleClick === 'function';
}

// Type guard for PositionalClickHandler interface
export function hasPositionalClickHandler(element: Element): element is Element & PositionalClickHandler {
  return 'handleClick' in element && typeof (element as unknown as PositionalClickHandler).handleClick === 'function';
}

// Type guard for Interactive interface
export function isInteractive(element: Element): element is Element & Interactive {
  return 'isInteractive' in element && typeof element.isInteractive === 'function';
}

// Type guard for TextSelectable interface
export function isTextSelectable(element: Element): element is Element & TextSelectable {
  return 'isTextSelectable' in element && typeof element.isTextSelectable === 'function';
}

// Type guard for SelectableTextProvider interface
export function hasSelectableText(element: Element): element is Element & SelectableTextProvider {
  return 'getSelectableText' in element && typeof element.getSelectableText === 'function';
}

// Type guard for checking if element provides custom highlight bounds
export function hasSelectionHighlightBounds(element: Element): element is Element & { getSelectionHighlightBounds: (startX: number, endX: number, startY?: number, endY?: number) => { startX: number; endX: number; startY?: number; endY?: number } | undefined } {
  return 'getSelectionHighlightBounds' in element && typeof element.getSelectionHighlightBounds === 'function';
}

// Type guard for Draggable interface
export function isDraggable(element: Element): element is Element & Draggable {
  return 'getDragZone' in element && typeof element.getDragZone === 'function';
}

// Type guard for ShaderElement interface
export function hasShaderMethods(element: Element): element is Element & ShaderElement {
  return 'updateShaderMouse' in element && typeof (element as unknown as ShaderElement).updateShaderMouse === 'function' &&
    'clearShaderMouse' in element && typeof (element as unknown as ShaderElement).clearShaderMouse === 'function';
}

// Type guard for KeyboardElement interface (full keyboard handling)
export function isKeyboardElement(element: Element): element is Element & KeyboardElement {
  return 'handlesOwnKeyboard' in element && typeof (element as unknown as KeyboardElement).handlesOwnKeyboard === 'function' &&
    'onKeyPress' in element && typeof (element as unknown as KeyboardElement).onKeyPress === 'function';
}

// Type guard for elements with just onKeyPress handler
export function hasKeyPressHandler(element: Element): element is Element & Pick<KeyboardElement, 'onKeyPress'> {
  return 'onKeyPress' in element && typeof (element as unknown as Pick<KeyboardElement, 'onKeyPress'>).onKeyPress === 'function';
}

// Type guard for Wheelable interface
export function isWheelable(element: Element): element is Element & Wheelable {
  return 'handleWheel' in element && typeof element.handleWheel === 'function';
}

// Helper to check if an element type supports scrolling
export function isScrollableType(type: string): boolean {
  return type === 'container' || type === 'tbody';
}

// Resolve per-axis overflow values, falling back to the shorthand `overflow` property
export function getOverflowAxis(element: Element): { x: OverflowValue; y: OverflowValue } {
  if (element.props.scrollable) return { x: 'scroll', y: 'scroll' };
  const style = element.props.style;
  const base: OverflowValue = style?.overflow || 'visible';
  return {
    x: style?.overflowX || base,
    y: style?.overflowY || base,
  };
}

function isScrollOverflow(value: OverflowValue): boolean {
  return value === 'scroll' || value === 'auto';
}

// Helper to check if scrolling is enabled on an element (either axis)
export function isScrollingEnabled(element: Element): boolean {
  const { x, y } = getOverflowAxis(element);
  return isScrollOverflow(x) || isScrollOverflow(y);
}
