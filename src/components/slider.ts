// Slider component implementation

import { Element, BaseProps, Renderable, Focusable, Clickable, Interactive, Draggable, Bounds, ComponentRenderContext, IntrinsicSizeContext, ClickEvent } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import type { Document } from '../document.ts';
import { createChangeEvent } from '../events.ts';
import { getCurrentTheme } from '../theme.ts';
import { COLORS } from './color-utils.ts';
import { getStringWidth } from '../char-width.ts';
import { parseDimension } from '../utils/dimensions.ts';

export interface SliderProps extends Omit<BaseProps, 'width' | 'height'> {
  // Value range
  min?: number;
  max?: number;
  value?: number;

  // Stepping/snapping
  step?: number;         // Discrete step size (e.g., 5 = values 0,5,10,...)
  snaps?: number[];      // Specific snap points (e.g., [0, 25, 50, 75, 100])

  // Orientation
  orientation?: 'horizontal' | 'vertical';

  // Display
  showValue?: boolean;   // Show value label

  // Dimensions (flow to style if style not set)
  width?: number | string;   // Slider width: number, "50%", or "fill" (flows to style.width)
  height?: number | string;  // Slider height: number, "50%", or "fill" (flows to style.height)

  // Colors (optional, theme provides defaults)
  trackColor?: string;
  thumbColor?: string;
  fillColor?: string;
}

export class SliderElement extends Element implements Renderable, Focusable, Clickable, Interactive, Draggable {
  declare type: 'slider';
  declare props: SliderProps;

  // Internal state for dragging
  private _dragging: boolean = false;
  private _lastBounds: Bounds | null = null;

  constructor(props: SliderProps, children: Element[] = []) {
    // Parse numeric values from strings (XML attributes come as strings)
    const min = props.min !== undefined ? Number(props.min) : 0;
    const max = props.max !== undefined ? Number(props.max) : 100;
    const value = props.value !== undefined ? Number(props.value) : 0;
    const step = props.step !== undefined ? Number(props.step) : undefined;

    // Flow width/height props to style if style doesn't have them
    // This allows using <slider width="30" /> instead of <slider style="width: 30;" />
    const styleWithDimensions = {
      ...props.style,
      ...(props.width !== undefined && props.style?.width === undefined ? { width: props.width } : {}),
      ...(props.height !== undefined && props.style?.height === undefined ? { height: props.height } : {}),
    };

    const defaultProps: SliderProps = {
      orientation: 'horizontal',
      showValue: false,
      disabled: false,
      tabIndex: 0,
      ...props,
      // Override with parsed numbers
      min,
      max,
      step,
      value: Math.max(min, Math.min(max, value)),
      style: styleWithDimensions,
    };

    // Ensure value is clamped
    defaultProps.value = Math.max(min, Math.min(max, defaultProps.value ?? min));

    super('slider', defaultProps, children);
  }

  /**
   * Get normalized value (0-1)
   */
  private _getNormalizedValue(): number {
    const { min = 0, max = 100, value } = this.props;
    const v = value ?? min;
    if (max === min) return 0;
    return (v - min) / (max - min);
  }

  /**
   * Convert a position (0-based from track start) to a value
   */
  private _positionToValue(pos: number, trackWidth: number): number {
    const { min = 0, max = 100, step } = this.props;
    const snaps = this._getSnaps();
    if (trackWidth <= 1) return min;

    // Calculate raw value from position
    const normalized = Math.max(0, Math.min(1, pos / (trackWidth - 1)));
    let raw = min + normalized * (max - min);

    // Apply snapping
    if (snaps && snaps.length > 0) {
      return this._snapToNearest(raw, snaps);
    }
    if (step && step > 0) {
      raw = Math.round(raw / step) * step;
    }

    // Clamp to range
    return Math.max(min, Math.min(max, raw));
  }

  /**
   * Get parsed snaps array (handles string from XML attributes)
   */
  private _getSnaps(): number[] | undefined {
    const { snaps } = this.props;
    if (!snaps) return undefined;
    if (Array.isArray(snaps)) return snaps;
    if (typeof snaps === 'string') {
      try {
        const parsed = JSON.parse(snaps);
        return Array.isArray(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Find nearest snap point
   */
  private _snapToNearest(value: number, snaps: number[]): number {
    return snaps.reduce((nearest, snap) =>
      Math.abs(snap - value) < Math.abs(nearest - value) ? snap : nearest
    );
  }

  /**
   * Set value and trigger onChange
   */
  private _setValue(newValue: number, isInput: boolean = false): void {
    const { min = 0, max = 100, step } = this.props;
    const snaps = this._getSnaps();

    // Apply snapping
    if (snaps && snaps.length > 0) {
      newValue = this._snapToNearest(newValue, snaps);
    } else if (step && step > 0) {
      newValue = Math.round(newValue / step) * step;
    }

    // Clamp to range
    newValue = Math.max(min, Math.min(max, newValue));

    // Only trigger if value changed
    if (newValue !== this.props.value) {
      this.props.value = newValue;

      // Trigger onChange (or onInput for continuous drag)
      const callback = isInput ? (this.props as any).onInput : this.props.onChange;
      if (typeof callback === 'function') {
        callback(createChangeEvent(String(newValue), this.id));
      }
      // Always trigger onChange even during drag for simplicity
      if (isInput && typeof this.props.onChange === 'function') {
        this.props.onChange(createChangeEvent(String(newValue), this.id));
      }
    }
  }

  /**
   * Get current value
   */
  getValue(): number {
    return this.props.value ?? this.props.min ?? 0;
  }

  /**
   * Set value programmatically
   */
  setValue(value: number): void {
    this._setValue(value);
  }

  /**
   * Render the slider to the terminal buffer
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    this._lastBounds = bounds;
    const { min = 0, showValue, orientation = 'horizontal' } = this.props;
    const isFocused = context.focusedElementId === this.id;
    const isDisabled = this.props.disabled ?? false;

    // Get theme for character selection
    const theme = getCurrentTheme();
    const isBW = theme.type === 'bw';

    // Character set based on theme
    const chars = isBW ? {
      trackEmpty: '-',
      trackFilled: '#',
      thumb: 'O',
      thumbFocused: '(O)',
    } : {
      trackEmpty: '─',
      trackFilled: '▓',
      thumb: '●',
      thumbFocused: '◉',
    };

    if (orientation === 'vertical') {
      this._renderVertical(bounds, style, buffer, chars, isFocused, isDisabled);
    } else {
      this._renderHorizontal(bounds, style, buffer, chars, isFocused, isDisabled, showValue);
    }
  }

  private _renderHorizontal(
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    chars: { trackEmpty: string; trackFilled: string; thumb: string; thumbFocused: string },
    isFocused: boolean,
    isDisabled: boolean,
    showValue?: boolean
  ): void {
    const { min = 0 } = this.props;

    // Reserve space for value display
    const valueStr = showValue ? ` ${Math.round(this.getValue())}` : '';
    const valueWidth = getStringWidth(valueStr);
    const trackWidth = Math.max(3, bounds.width - valueWidth);

    // Calculate thumb position
    const normalized = this._getNormalizedValue();
    const thumbPos = Math.round(normalized * (trackWidth - 1));

    // Build display string
    let display = '';
    for (let i = 0; i < trackWidth; i++) {
      if (i === thumbPos) {
        display += isFocused ? chars.thumbFocused : chars.thumb;
      } else if (i < thumbPos) {
        display += chars.trackFilled;
      } else {
        display += chars.trackEmpty;
      }
    }

    // Add value label if enabled
    display += valueStr;

    // Apply styling
    const sliderStyle = { ...style };
    if (isDisabled) {
      sliderStyle.foreground = COLORS.gray;
    }

    // For focused state, use reverse video on the thumb for visibility
    if (isFocused) {
      // Render track before thumb
      if (thumbPos > 0) {
        const beforeThumb = display.substring(0, thumbPos);
        buffer.currentBuffer.setText(bounds.x, bounds.y, beforeThumb, sliderStyle);
      }

      // Render thumb with reverse video
      const thumbChar = display.substring(thumbPos, thumbPos + 1);
      const thumbStyle = { ...sliderStyle, reverse: true, bold: true };
      buffer.currentBuffer.setText(bounds.x + thumbPos, bounds.y, thumbChar, thumbStyle);

      // Render track after thumb
      const afterThumb = display.substring(thumbPos + 1);
      if (afterThumb.length > 0) {
        buffer.currentBuffer.setText(bounds.x + thumbPos + 1, bounds.y, afterThumb, sliderStyle);
      }
    } else {
      buffer.currentBuffer.setText(bounds.x, bounds.y, display, sliderStyle);
    }
  }

  private _renderVertical(
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    chars: { trackEmpty: string; trackFilled: string; thumb: string; thumbFocused: string },
    isFocused: boolean,
    isDisabled: boolean
  ): void {
    const trackHeight = bounds.height;
    const normalized = this._getNormalizedValue();
    // For vertical, 0 is at bottom, max at top
    const thumbPos = Math.round((1 - normalized) * (trackHeight - 1));

    const sliderStyle = { ...style };
    if (isDisabled) {
      sliderStyle.foreground = COLORS.gray;
    }

    for (let i = 0; i < trackHeight; i++) {
      let char: string;
      let cellStyle = sliderStyle;

      if (i === thumbPos) {
        char = isFocused ? chars.thumbFocused : chars.thumb;
        // Use reverse video for focused thumb
        if (isFocused) {
          cellStyle = { ...sliderStyle, reverse: true, bold: true };
        }
      } else if (i > thumbPos) {
        // Below thumb = filled (higher values)
        char = chars.trackFilled;
      } else {
        // Above thumb = empty
        char = '│';  // Use vertical bar for empty track
      }
      buffer.currentBuffer.setText(bounds.x, bounds.y + i, char, cellStyle);
    }
  }

  /**
   * Handle keyboard input
   */
  handleKeyInput(key: string, _ctrlKey: boolean = false, _altKey: boolean = false): boolean {
    if (this.props.disabled) return false;

    const { min = 0, max = 100, step, orientation = 'horizontal' } = this.props;
    const snaps = this._getSnaps();
    let newValue = this.props.value ?? min;

    // Determine step amounts
    const smallStep = step || (max - min) / 100;
    const largeStep = (max - min) / 10;

    // Map keys based on orientation
    const decreaseKeys = orientation === 'vertical'
      ? ['ArrowDown', 'ArrowLeft']
      : ['ArrowLeft', 'ArrowDown'];
    const increaseKeys = orientation === 'vertical'
      ? ['ArrowUp', 'ArrowRight']
      : ['ArrowRight', 'ArrowUp'];

    if (decreaseKeys.includes(key)) {
      if (snaps && snaps.length > 0) {
        // Find previous snap point
        const sorted = [...snaps].sort((a, b) => a - b);
        const currentIndex = sorted.findIndex(s => s >= newValue);
        if (currentIndex > 0) {
          newValue = sorted[currentIndex - 1];
        } else if (currentIndex === 0 && newValue > sorted[0]) {
          newValue = sorted[0];
        }
      } else {
        newValue -= smallStep;
      }
    } else if (increaseKeys.includes(key)) {
      if (snaps && snaps.length > 0) {
        // Find next snap point
        const sorted = [...snaps].sort((a, b) => a - b);
        const currentIndex = sorted.findIndex(s => s > newValue);
        if (currentIndex !== -1) {
          newValue = sorted[currentIndex];
        }
      } else {
        newValue += smallStep;
      }
    } else if (key === 'PageDown') {
      newValue -= largeStep;
    } else if (key === 'PageUp') {
      newValue += largeStep;
    } else if (key === 'Home') {
      newValue = min;
    } else if (key === 'End') {
      newValue = max;
    } else {
      return false;  // Key not handled
    }

    this._setValue(newValue);
    return true;
  }

  /**
   * Calculate intrinsic size for the slider
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const { showValue, orientation = 'horizontal' } = this.props;
    const style = this.props.style || {};

    if (orientation === 'vertical') {
      // Respect style height if set (style takes precedence, props are fallback)
      const explicitHeight = style.height ?? this.props.height;
      const height = explicitHeight !== undefined
        ? parseDimension(explicitHeight, context.availableSpace.height, 10)
        : 10;
      return { width: 1, height };
    }

    // Horizontal: respect style width if set (style takes precedence, props are fallback)
    const explicitWidth = style.width ?? this.props.width;
    let width = explicitWidth !== undefined
      ? parseDimension(explicitWidth, context.availableSpace.width, 10)
      : 10;

    if (showValue && explicitWidth === undefined) {
      // Only add value space to minimum width, not explicit width
      const { max = 100 } = this.props;
      width += String(Math.round(max)).length + 1;
    }

    return { width, height: 1 };
  }

  /**
   * Check if this slider can receive focus
   */
  canReceiveFocus(): boolean {
    return !this.props.disabled;
  }

  /**
   * Handle click event - jump to clicked position
   */
  handleClick(event: ClickEvent, _document: Document): boolean {
    if (this.props.disabled || !this._lastBounds) return false;

    const { orientation = 'horizontal', showValue } = this.props;

    if (orientation === 'vertical') {
      // Vertical: calculate from y position
      const relY = event.position.y - this._lastBounds.y;
      const trackHeight = this._lastBounds.height;
      // Invert because 0 is at bottom
      const normalized = 1 - (relY / (trackHeight - 1));
      const { min = 0, max = 100 } = this.props;
      const newValue = min + normalized * (max - min);
      this._setValue(newValue);
    } else {
      // Horizontal: calculate from x position
      const relX = event.position.x - this._lastBounds.x;
      const valueStr = showValue ? ` ${Math.round(this.getValue())}` : '';
      const valueWidth = getStringWidth(valueStr);
      const trackWidth = Math.max(3, this._lastBounds.width - valueWidth);
      const newValue = this._positionToValue(relX, trackWidth);
      this._setValue(newValue);
    }

    return true;
  }

  /**
   * Check if this slider is interactive
   */
  isInteractive(): boolean {
    return !this.props.disabled;
  }

  // Draggable interface implementation

  /**
   * Get drag zone at position
   */
  getDragZone(x: number, y: number): string | null {
    if (this.props.disabled || !this._lastBounds) return null;

    // Check if position is within bounds
    const b = this._lastBounds;
    if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) {
      return 'track';
    }
    return null;
  }

  /**
   * Handle drag start
   */
  handleDragStart(_zone: string, x: number, y: number): void {
    this._dragging = true;
    // Jump to position on drag start
    this._handleDragPosition(x, y);
  }

  /**
   * Handle drag movement
   */
  handleDragMove(_zone: string, x: number, y: number): void {
    if (!this._dragging) return;
    this._handleDragPosition(x, y);
  }

  /**
   * Handle drag end
   */
  handleDragEnd(_zone: string, _x: number, _y: number): void {
    this._dragging = false;
  }

  /**
   * Common drag position handler
   */
  private _handleDragPosition(x: number, y: number): void {
    if (!this._lastBounds) return;

    const { orientation = 'horizontal', showValue } = this.props;

    if (orientation === 'vertical') {
      const relY = y - this._lastBounds.y;
      const trackHeight = this._lastBounds.height;
      const normalized = Math.max(0, Math.min(1, 1 - (relY / (trackHeight - 1))));
      const { min = 0, max = 100 } = this.props;
      const newValue = min + normalized * (max - min);
      this._setValue(newValue, true);  // true = isInput (continuous)
    } else {
      const relX = x - this._lastBounds.x;
      const valueStr = showValue ? ` ${Math.round(this.getValue())}` : '';
      const valueWidth = getStringWidth(valueStr);
      const trackWidth = Math.max(3, this._lastBounds.width - valueWidth);
      const newValue = this._positionToValue(relX, trackWidth);
      this._setValue(newValue, true);
    }
  }

  static validate(props: SliderProps): boolean {
    if (props.min !== undefined && typeof props.min !== 'number') {
      return false;
    }
    if (props.max !== undefined && typeof props.max !== 'number') {
      return false;
    }
    if (props.value !== undefined && typeof props.value !== 'number') {
      return false;
    }
    if (props.step !== undefined && (typeof props.step !== 'number' || props.step <= 0)) {
      return false;
    }
    if (props.snaps !== undefined && !Array.isArray(props.snaps)) {
      return false;
    }
    if (props.orientation !== undefined && !['horizontal', 'vertical'].includes(props.orientation)) {
      return false;
    }
    return true;
  }
}

// Lint schema for slider component
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const sliderSchema: ComponentSchema = {
  description: 'Numeric slider for selecting a value within a range',
  props: {
    min: { type: 'number', description: 'Minimum value (default: 0)' },
    max: { type: 'number', description: 'Maximum value (default: 100)' },
    value: { type: 'number', description: 'Current value' },
    step: { type: 'number', description: 'Step size for discrete values' },
    snaps: { type: 'array', description: 'Array of snap points' },
    orientation: { type: 'string', description: 'horizontal or vertical' },
    showValue: { type: 'boolean', description: 'Show value label' },
    width: { type: ['number', 'string'], description: 'Slider width (flows to style.width)' },
    height: { type: ['number', 'string'], description: 'Slider height (flows to style.height)' },
    trackColor: { type: 'string', description: 'Track color override' },
    thumbColor: { type: 'string', description: 'Thumb color override' },
    fillColor: { type: 'string', description: 'Filled portion color override' },
    onChange: { type: 'handler', description: 'Called when value changes. Event: { value: string, target }' },
  },
};

registerComponentSchema('slider', sliderSchema);

// Register slider component
registerComponent({
  type: 'slider',
  componentClass: SliderElement,
  defaultProps: {
    min: 0,
    max: 100,
    value: 0,
    orientation: 'horizontal',
    showValue: false,
    disabled: false,
    tabIndex: 0,
  },
  validate: (props) => SliderElement.validate(props as any),
});
