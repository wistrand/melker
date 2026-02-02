// Core element types for the Melker UI library

// Include global type declarations in the module graph
import './globals.d.ts';

import type { KeyPressEvent, ChangeEvent } from './events.ts';

// Re-export event types for component use
export type { KeyPressEvent, ChangeEvent };

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Bounds extends Position, Size {}

export interface TextSelection {
  start: Position;
  end: Position;
  isActive: boolean;
  selectedText?: string;
  componentId?: string;      // Which component owns selection (undefined for global)
  componentBounds?: Bounds;  // Bounds to constrain selection within (undefined for global)
  mode: 'component' | 'global';  // Selection mode
}

// Packed RGBA color - 32-bit number in 0xRRGGBBAA format
// Used internally for efficient color storage and manipulation
export type PackedRGBA = number;

// User input color type - accepts CSS color strings or packed RGBA numbers
// Use this for component props and user-facing APIs
export type ColorInput = string | PackedRGBA;

// Border styles using Unicode Box Drawing characters
// 'block' uses spaces with background color (for terminals without box-drawing support)
export type BorderStyle = 'none' | 'thin' | 'thick' | 'double' | 'rounded' | 'dashed' | 'dashed-rounded' | 'ascii' | 'ascii-rounded' | 'block' | 'dotted';

// Border character definitions: h=horizontal, v=vertical, tl/tr/bl/br=corners, tm/bm/lm/rm/mm=junctions
export interface BorderChars {
  h: string;   // horizontal line
  v: string;   // vertical line
  tl: string;  // top-left corner
  tr: string;  // top-right corner
  bl: string;  // bottom-left corner
  br: string;  // bottom-right corner
  tm: string;  // top-middle junction (┬)
  bm: string;  // bottom-middle junction (┴)
  lm: string;  // left-middle junction (├)
  rm: string;  // right-middle junction (┤)
  mm: string;  // middle-middle junction (┼)
}

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

// Percentage string type for width/height (e.g., "50%", "100%")
export type PercentageString = `${number}%`;

export interface Style extends Record<string, any> {
  color?: ColorInput;
  backgroundColor?: ColorInput;
  background?: ColorInput;   // Alias for backgroundColor
  foreground?: ColorInput;   // Alias for color
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline';
  dim?: boolean;
  reverse?: boolean;
  border?: BorderStyle;
  borderTop?: BorderStyle;
  borderBottom?: BorderStyle;
  borderLeft?: BorderStyle;
  borderRight?: BorderStyle;
  borderColor?: ColorInput;
  borderTopColor?: ColorInput;
  borderBottomColor?: ColorInput;
  borderLeftColor?: ColorInput;
  borderRightColor?: ColorInput;
  borderTitle?: string;
  padding?: number | BoxSpacing;
  margin?: number | BoxSpacing;
  marginBottom?: number;
  boxSizing?: 'content-box' | 'border-box';
  textWrap?: 'nowrap' | 'wrap';
  // Layout properties in style section
  display?: 'block' | 'flex';
  position?: 'static' | 'relative' | 'absolute' | 'fixed';
  overflow?: 'visible' | 'hidden' | 'scroll';
  width?: number | 'auto' | 'fill' | PercentageString;
  height?: number | 'auto' | 'fill' | PercentageString;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  zIndex?: number;

  // Flexbox properties in style section
  flex?: string | number; // Shorthand: "1", "1 1 auto", etc.
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  alignContent?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'space-between' | 'space-around';
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | 'auto';
  gap?: number;  // Space between flex items (both row and column gap)
  textAlign?: 'center' | 'left' | 'right';
  verticalAlign?: 'center' | 'top' | 'bottom';

  // Data-bars style properties
  orientation?: 'horizontal' | 'vertical';
  barWidth?: number;
  barStyle?: 'solid' | 'led';
  ledWidth?: number;
  highValue?: number;
  ledColorLow?: string;
  ledColorHigh?: string;

  // Allow any additional style properties for flexibility
  [key: string]: any;
}

export interface BoxSpacing {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface LayoutProps {
  width?: number | 'auto' | 'fill' | PercentageString;
  height?: number | 'auto' | 'fill' | PercentageString;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  display?: 'block' | 'flex';
  overflow?: 'visible' | 'hidden' | 'scroll';

  // Basic positioning
  position?: 'static' | 'relative' | 'absolute' | 'fixed';
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  zIndex?: number;

  // Flexbox basics
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  flexGrow?: number;
  flexShrink?: number;
  gap?: number;  // Space between flex items

}

export interface EventHandlers {
  onClick?: (event: ClickEvent) => void;
  onKeyPress?: (event: KeyPressEvent) => void;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  onChange?: (event: ChangeEvent) => void;
}

export interface BaseProps extends LayoutProps, EventHandlers, Record<string, any> {
  id?: string;
  class?: string;           // Space-separated class names (input format)
  classList?: string[];     // Internal array representation of classes
  style?: Style;
  tabIndex?: number;
  disabled?: boolean;
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

// Import buffer types for proper typing
import type { DualBuffer, Cell } from './buffer.ts';
import type { ClippedDualBuffer } from './clipped-buffer.ts';
import type { ViewportDualBuffer } from './viewport-buffer.ts';

export interface ComponentRenderContext {
  buffer: DualBuffer | ClippedDualBuffer | ViewportDualBuffer;
  style: Partial<Cell>;
  focusedElementId?: string;
  hoveredElementId?: string;
  requestRender?: () => void;  // Callback for components to request a re-render
  scrollOffset?: { x: number; y: number };  // Scroll offset from parent scrollable container
  /** Register an overlay to be rendered on top of normal content */
  registerOverlay?: (overlay: Overlay) => void;
  /** Full viewport/terminal bounds (for modal overlays) */
  viewport?: Bounds;
  /** Look up computed bounds for any element by ID (available after layout) */
  getElementBounds?: (elementId: string) => Bounds | undefined;
  /** Get all element bounds (for connector obstacle avoidance) */
  getAllElementBounds?: () => Map<string, Bounds>;
  /** Register element bounds dynamically (for components that render children internally like tables) */
  registerElementBounds?: (elementId: string, bounds: Bounds) => void;
  [key: string]: any;
}

/**
 * Overlay - Content rendered on top of normal UI elements.
 * Used for dropdowns, tooltips, context menus, etc.
 */
export interface Overlay {
  /** Unique identifier for the overlay */
  id: string;
  /** Z-index for ordering overlays (higher = on top) */
  zIndex: number;
  /** Absolute bounds where the overlay should render */
  bounds: Bounds;
  /** The render function that draws the overlay content */
  render: (buffer: DualBuffer, bounds: Bounds, style: Partial<Cell>) => void;
  /** Optional: bounds for hit testing (click handling) */
  hitTestBounds?: Bounds;
  /** Optional: click handler for the overlay */
  onClick?: (x: number, y: number) => boolean;
  /** Optional: callback when click happens outside this overlay (for dismiss behavior) */
  onClickOutside?: () => void;
  /** Optional: additional bounds to exclude from click-outside detection (e.g., the trigger element) */
  excludeBounds?: Bounds[];
}

// Layout context for intrinsic size calculation
export interface IntrinsicSizeContext {
  availableSpace: { width: number; height: number };
  /** Parent element's computed style (for orientation-aware components like separator) */
  parentStyle?: Style;
}

// Focusable interface for components that can receive focus
export interface Focusable {
  canReceiveFocus(): boolean;
}

// Type guard for Focusable interface
export function isFocusable(element: Element): element is Element & Focusable {
  return 'canReceiveFocus' in element && typeof element.canReceiveFocus === 'function';
}

// FocusCapturable interface for elements that capture focus for all children
// (e.g., dialogs, modals that handle focus internally)
export interface FocusCapturable {
  /**
   * Returns true if this element captures focus for all its children,
   * meaning clicks on children should focus this element instead.
   */
  capturesFocusForChildren(): boolean;
}

// Type guard for FocusCapturable interface
export function isFocusCapturable(element: Element): element is Element & FocusCapturable {
  const el = element as unknown as Record<string, unknown>;
  return typeof el.capturesFocusForChildren === 'function';
}

// Toggleable interface for elements that can be toggled open/closed
// (e.g., command palettes, dropdowns)
export interface Toggleable {
  /**
   * Toggle the element's open/closed state.
   */
  toggle(): void;
}

// Type guard for Toggleable interface
export function isToggleable(element: Element): element is Element & Toggleable {
  const el = element as unknown as Record<string, unknown>;
  return typeof el.toggle === 'function';
}

// KeyInputHandler interface for elements that handle text input
// (e.g., input fields, textareas)
export interface KeyInputHandler {
  /**
   * Handle text input for the element.
   * @param value - The text value to input
   */
  handleKeyInput(value: string): void;
}

// Type guard for KeyInputHandler interface
export function hasKeyInputHandler(element: Element): element is Element & KeyInputHandler {
  const el = element as unknown as Record<string, unknown>;
  return typeof el.handleKeyInput === 'function';
}

// ContentGettable interface for elements that can return their content
// (e.g., markdown with fetched content)
export interface ContentGettable {
  /**
   * Get the element's text content.
   * @returns The content string, or undefined if not available
   */
  getContent(): string | undefined;
}

// Type guard for ContentGettable interface
export function hasGetContent(element: Element): element is Element & ContentGettable {
  const el = element as unknown as Record<string, unknown>;
  return typeof el.getContent === 'function';
}

// Rendering interface for components
export interface Renderable {
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer | ClippedDualBuffer | ViewportDualBuffer, context: ComponentRenderContext): void;
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number };
}

// Type guard for Renderable interface
export function isRenderable(element: Element): element is Element & Renderable {
  return 'render' in element &&
         typeof element.render === 'function' &&
         'intrinsicSize' in element &&
         typeof element.intrinsicSize === 'function';
}

// HasIntrinsicSize interface for elements that can calculate their own size
export interface HasIntrinsicSize {
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number };
}

// Type guard for HasIntrinsicSize interface
export function hasIntrinsicSize(element: Element): element is Element & HasIntrinsicSize {
  const el = element as unknown as Record<string, unknown>;
  return typeof el.intrinsicSize === 'function';
}

// Clickable interface for components that handle mouse clicks
export interface Clickable {
  /**
   * Handle a click event on this element.
   * @param event - The click event with coordinates and button info
   * @param document - The document for accessing other elements (e.g., radio groups)
   * @returns true if the click was handled and a re-render is needed
   */
  handleClick(event: ClickEvent, document: any): boolean;
}

// Type guard for Clickable interface
export function isClickable(element: Element): element is Element & Clickable {
  return 'handleClick' in element && typeof element.handleClick === 'function';
}

// PositionalClickHandler interface for elements that handle clicks with x,y coordinates
// (e.g., markdown links, textarea cursor positioning)
export interface PositionalClickHandler {
  /**
   * Handle a click at specific coordinates.
   * @param x - X coordinate of the click
   * @param y - Y coordinate of the click
   * @returns true if the click was handled and a re-render is needed
   */
  handleClick(x: number, y: number): boolean;
}

// Type guard for PositionalClickHandler interface
export function hasPositionalClickHandler(element: Element): element is Element & PositionalClickHandler {
  const el = element as unknown as Record<string, unknown>;
  return typeof el.handleClick === 'function';
}

// Interactive interface for elements that can receive mouse events
export interface Interactive {
  /**
   * Check if this element is interactive (can receive clicks, focus, etc.)
   * Should return false if disabled.
   */
  isInteractive(): boolean;
}

// Type guard for Interactive interface
export function isInteractive(element: Element): element is Element & Interactive {
  return 'isInteractive' in element && typeof element.isInteractive === 'function';
}

// TextSelectable interface for elements that support text selection
export interface TextSelectable {
  /**
   * Check if this element supports text selection.
   */
  isTextSelectable(): boolean;
}

// Type guard for TextSelectable interface
export function isTextSelectable(element: Element): element is Element & TextSelectable {
  return 'isTextSelectable' in element && typeof element.isTextSelectable === 'function';
}

// Selection bounds for SelectableTextProvider
export interface SelectionBounds {
  startX: number;
  endX: number;
  startY?: number;  // Optional Y bounds for 2D selection (e.g., horizontal bar charts)
  endY?: number;
}

// SelectableTextProvider interface for elements that provide custom text for selection
// Instead of extracting rendered characters from the buffer, use the logical value
export interface SelectableTextProvider {
  /**
   * Get the logical text for selection (e.g., "12:34" instead of graphical chars)
   * @param selectionBounds - Optional bounds of the visual selection relative to element
   *                          If provided, returns only the characters within those bounds
   */
  getSelectableText(selectionBounds?: SelectionBounds): string;

  /**
   * Get aligned selection highlight bounds that snap to character boundaries
   * This allows components like segment displays to highlight entire graphical
   * characters instead of individual terminal cells
   * @param startX - Selection start x relative to element
   * @param endX - Selection end x relative to element
   * @param startY - Optional selection start y relative to element
   * @param endY - Optional selection end y relative to element
   * @returns Snapped bounds, or undefined to use default highlighting
   */
  getSelectionHighlightBounds?(startX: number, endX: number, startY?: number, endY?: number): { startX: number; endX: number; startY?: number; endY?: number } | undefined;
}

// Type guard for SelectableTextProvider interface
export function hasSelectableText(element: Element): element is Element & SelectableTextProvider {
  return 'getSelectableText' in element && typeof element.getSelectableText === 'function';
}

// Type guard for checking if element provides custom highlight bounds
export function hasSelectionHighlightBounds(element: Element): element is Element & { getSelectionHighlightBounds: (startX: number, endX: number, startY?: number, endY?: number) => { startX: number; endX: number; startY?: number; endY?: number } | undefined } {
  return 'getSelectionHighlightBounds' in element && typeof element.getSelectionHighlightBounds === 'function';
}

// Draggable interface for elements that handle mouse drag (scrollbars, resizers, etc.)
export interface Draggable {
  /**
   * Check if a drag can start at this position
   * @returns drag zone identifier or null if not draggable at this position
   */
  getDragZone(x: number, y: number): string | null;

  /**
   * Handle drag start
   * @param zone - The drag zone identifier from getDragZone
   * @param x - Starting x coordinate
   * @param y - Starting y coordinate
   */
  handleDragStart(zone: string, x: number, y: number): void;

  /**
   * Handle drag movement
   * @param zone - The drag zone identifier
   * @param x - Current x coordinate
   * @param y - Current y coordinate
   */
  handleDragMove(zone: string, x: number, y: number): void;

  /**
   * Handle drag end
   * @param zone - The drag zone identifier
   * @param x - End x coordinate
   * @param y - End y coordinate
   */
  handleDragEnd(zone: string, x: number, y: number): void;
}

// Type guard for Draggable interface
export function isDraggable(element: Element): element is Element & Draggable {
  return 'getDragZone' in element && typeof element.getDragZone === 'function';
}

// ShaderElement interface for elements with shader mouse tracking (canvas, img)
export interface ShaderElement {
  /**
   * Update shader mouse position from terminal coordinates
   */
  updateShaderMouse(termX: number, termY: number): void;

  /**
   * Clear shader mouse position (when mouse leaves element)
   */
  clearShaderMouse(): void;
}

// Type guard for ShaderElement interface
export function hasShaderMethods(element: Element): element is Element & ShaderElement {
  const el = element as unknown as Record<string, unknown>;
  return typeof el.updateShaderMouse === 'function' &&
    typeof el.clearShaderMouse === 'function';
}

// KeyboardElement interface for elements that handle their own keyboard events
export interface KeyboardElement {
  /**
   * Check if this element handles its own keyboard events
   */
  handlesOwnKeyboard(): boolean;

  /**
   * Handle a key press event
   * @returns true if the event was handled
   */
  onKeyPress(event: KeyPressEvent): boolean;
}

// Type guard for KeyboardElement interface (full keyboard handling)
export function isKeyboardElement(element: Element): element is Element & KeyboardElement {
  const el = element as unknown as Record<string, unknown>;
  return typeof el.handlesOwnKeyboard === 'function' &&
    typeof el.onKeyPress === 'function';
}

// Type guard for elements with just onKeyPress handler
export function hasKeyPressHandler(element: Element): element is Element & Pick<KeyboardElement, 'onKeyPress'> {
  const el = element as unknown as Record<string, unknown>;
  return typeof el.onKeyPress === 'function';
}

// Wheelable interface for elements that handle mouse wheel events
export interface Wheelable {
  /**
   * Check if wheel event at this position should be handled
   */
  canHandleWheel(x: number, y: number): boolean;

  /**
   * Handle wheel event
   * @returns true if the event was handled
   */
  handleWheel(deltaX: number, deltaY: number): boolean;
}

// Type guard for Wheelable interface
export function isWheelable(element: Element): element is Element & Wheelable {
  return 'handleWheel' in element && typeof element.handleWheel === 'function';
}

// Element type exports will come from component files

// Import component prop types for type safety
import type { ContainerProps } from './components/container.ts';
import type { InputProps } from './components/input.ts';
import type { TextProps } from './components/text.ts';
import type { ButtonProps } from './components/button.ts';
import type { RadioProps } from './components/radio.ts';
import type { CheckboxProps } from './components/checkbox.ts';
import type { DialogProps } from './components/dialog.ts';
import type { MarkdownProps } from './components/markdown.ts';
import type { CanvasProps } from './components/canvas.ts';
import type { TabProps } from './components/tab.ts';
import type { TabsProps } from './components/tabs.ts';
import type { ProgressProps } from './components/progress.ts';
import type { SliderProps } from './components/slider.ts';

// Type mapping for known element types to their specific props
export interface ComponentPropsMap {
  'container': ContainerProps;
  'input': InputProps;
  'text': TextProps;
  'button': ButtonProps;
  'radio': RadioProps;
  'checkbox': CheckboxProps;
  'dialog': DialogProps;
  'markdown': MarkdownProps;
  'canvas': CanvasProps;
  'tab': TabProps;
  'tabs': TabsProps;
  'progress': ProgressProps;
  'slider': SliderProps;
}

// Type mapping for known element types to their element classes
export type KnownElementTypeMap = {
  'container': Element;
  'input': Element;
  'text': Element;
  'button': Element;
  'radio': Element;
  'checkbox': Element;
  'dialog': Element;
  'canvas': Element;
  'tab': Element;
  'tabs': Element;
  'progress': Element;
  'slider': Element;
};

// Helper type to get props for a component type
export type PropsForComponent<T extends string> = T extends keyof ComponentPropsMap
  ? ComponentPropsMap[T]
  : Record<string, any>;

export interface Node extends Element {
  bounds: Bounds;
  visible: boolean;
  focused: boolean;
  computedStyle: Style;
}

// Event types
export interface BaseEvent {
  type: string;
  target: Element;
  timestamp: number;
}

export interface ClickEvent extends BaseEvent {
  type: 'click';
  position: Position;
}

export interface FocusEvent extends BaseEvent {
  type: 'focus' | 'blur';
}

export type UIEvent = ClickEvent | KeyPressEvent | FocusEvent | ChangeEvent;

// Component registration for extensibility
export interface ComponentDefinition {
  type: string;
  defaultProps?: Record<string, any>;
  componentClass: new (props: any, children: Element[]) => Element;
  validate?: (props: Record<string, any>) => boolean;
}

export interface ComponentRegistry {
  [key: string]: ComponentDefinition;
}

// Helper to check if an element type supports scrolling
export function isScrollableType(type: string): boolean {
  return type === 'container' || type === 'tbody';
}