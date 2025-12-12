// Core element types for the Melker UI library

import type { KeyPressEvent, ChangeEvent } from './events.ts';


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

// Common terminal/ANSI colors
export type TerminalColor =
  | 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white'
  | 'gray' | 'grey' | 'brightBlack' | 'brightRed' | 'brightGreen' | 'brightYellow'
  | 'brightBlue' | 'brightMagenta' | 'brightCyan' | 'brightWhite'
  | string; // Allow custom colors/hex values

export interface Style extends Record<string, any> {
  color?: TerminalColor;
  backgroundColor?: TerminalColor;
  fontWeight?: 'normal' | 'bold';
  border?: 'none' | 'thin' | 'thick';
  borderTop?: 'none' | 'thin' | 'thick';
  borderBottom?: 'none' | 'thin' | 'thick';
  borderLeft?: 'none' | 'thin' | 'thick';
  borderRight?: 'none' | 'thin' | 'thick';
  borderColor?: TerminalColor;
  padding?: number | BoxSpacing;
  margin?: number | BoxSpacing;
  marginBottom?: number;
  boxSizing?: 'content-box' | 'border-box';
  textWrap?: 'nowrap' | 'wrap';
  // Layout properties in style section
  display?: 'block' | 'flex';
  position?: 'static' | 'relative' | 'absolute' | 'fixed';
  overflow?: 'visible' | 'hidden' | 'scroll';
  width?: number | 'auto' | 'fill';
  height?: number | 'auto' | 'fill';
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
  width?: number | 'auto' | 'fill';
  height?: number | 'auto' | 'fill';
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



// Base element class
export abstract class Element {
  type: string;
  props: Record<string, any>;
  children?: Element[];
  id: string;
  protected _bounds: Bounds | null = null;

  constructor(type: string, props: Record<string, any> = {}, children?: Element[]) {
    this.type = type;
    this.props = props;
    this.children = children;
    this.id = props.id || '';
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
  [key: string]: any;
}

// Layout context for intrinsic size calculation
export interface IntrinsicSizeContext {
  availableSpace: { width: number; height: number };
}

// Focusable interface for components that can receive focus
export interface Focusable {
  canReceiveFocus(): boolean;
}

// Type guard for Focusable interface
export function isFocusable(element: Element): element is Element & Focusable {
  return 'canReceiveFocus' in element && typeof element.canReceiveFocus === 'function';
}

// Rendering interface for components
export interface Renderable {
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void;
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number };
}

// Type guard for Renderable interface
export function isRenderable(element: Element): element is Element & Renderable {
  return 'render' in element &&
         typeof element.render === 'function' &&
         'intrinsicSize' in element &&
         typeof element.intrinsicSize === 'function';
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