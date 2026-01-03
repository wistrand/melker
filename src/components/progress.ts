// Progress bar component using canvas pixels for smooth fill

import { Element, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { CanvasElement, CanvasProps } from './canvas.ts';
import { getCurrentTheme } from '../theme.ts';

export interface ProgressProps extends Omit<CanvasProps, 'width' | 'height'> {
  width?: number;            // Bar width in terminal columns (default: 20)
  height?: number;           // Bar height in terminal rows (default: 1)
  value?: number;            // Current value (default: 0)
  max?: number;              // Maximum value (default: 100)
  min?: number;              // Minimum value (default: 0)
  indeterminate?: boolean;   // Animated loading state (default: false)
  showValue?: boolean;       // Display percentage text after bar (default: false)
  fillColor?: string;        // Color for filled portion
  emptyColor?: string;       // Color for empty portion
  animationSpeed?: number;   // Indeterminate animation speed in ms (default: 50)
}

export class ProgressElement extends CanvasElement {
  // Indeterminate animation state
  private _animationTimer: number | null = null;
  private _animationPosition: number = 0;
  private _animationDirection: number = 1;
  private _requestRender: (() => void) | null = null;

  constructor(props: ProgressProps, children: Element[] = []) {
    // Set default dimensions
    const width = props.width ?? 20;
    const height = props.height ?? 1;

    // Call parent constructor with canvas props
    // Merge style to enforce minimum dimensions (prevent layout compression)
    super(
      {
        ...props,
        width,
        height,
        style: {
          flexShrink: 0,  // Don't shrink below intrinsic size
          height,         // Enforce height
          ...props.style,
        },
      } as CanvasProps,
      children
    );

    // Override type
    (this as { type: string }).type = 'progress';

    // Set default props
    this.props.value = props.value ?? 0;
    this.props.max = props.max ?? 100;
    this.props.min = props.min ?? 0;
    this.props.indeterminate = props.indeterminate ?? false;
    this.props.showValue = props.showValue ?? false;
    this.props.animationSpeed = props.animationSpeed ?? 50;
  }

  /**
   * Get colors based on theme
   */
  private _getColors(): { fillColor: string; emptyColor: string } {
    const theme = getCurrentTheme();
    const isBW = theme.type === 'bw';

    if (this.props.fillColor && this.props.emptyColor) {
      return {
        fillColor: this.props.fillColor,
        emptyColor: this.props.emptyColor,
      };
    }

    if (isBW) {
      // B&W theme: black fill on light gray background
      return {
        fillColor: this.props.fillColor ?? '#000000',
        emptyColor: this.props.emptyColor ?? '#ffffff',
      };
    }

    // Color themes - green fill on light gray background
    return {
      fillColor: this.props.fillColor ?? '#4CAF50',
      emptyColor: this.props.emptyColor ?? '#aaaaaa',
    };
  }

  /**
   * Calculate current progress percentage
   */
  private _getPercentage(): number {
    const { value = 0, min = 0, max = 100 } = this.props;
    if (max <= min) return 0;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  }

  /**
   * Draw the progress bar to the canvas buffer
   */
  private _drawProgressBar(): void {
    const bufW = this.getBufferWidth();
    const bufH = this.getBufferHeight();
    const { fillColor, emptyColor } = this._getColors();

    // Clear canvas
    this.clear();

    if (this.props.indeterminate) {
      // Draw indeterminate animation
      this._drawIndeterminate(bufW, bufH, fillColor, emptyColor);
    } else {
      // Draw determinate progress
      this._drawDeterminate(bufW, bufH, fillColor, emptyColor);
    }
  }

  /**
   * Draw determinate progress bar
   */
  private _drawDeterminate(
    bufW: number,
    bufH: number,
    fillColor: string,
    emptyColor: string
  ): void {
    const percentage = this._getPercentage();
    const fillPixels = Math.round(percentage * bufW);

    // Draw empty portion first (background)
    if (fillPixels < bufW) {
      this.setColor(emptyColor);
      this.fillRect(fillPixels, 0, bufW - fillPixels, bufH);
    }

    // Draw filled portion
    if (fillPixels > 0) {
      this.setColor(fillColor);
      this.fillRect(0, 0, fillPixels, bufH);
    }
  }

  /**
   * Draw indeterminate animation
   */
  private _drawIndeterminate(
    bufW: number,
    bufH: number,
    fillColor: string,
    emptyColor: string
  ): void {
    // Draw empty background
    this.setColor(emptyColor);
    this.fillRect(0, 0, bufW, bufH);

    // Draw sliding pulse block (about 30% of width)
    const pulseWidth = Math.max(4, Math.floor(bufW * 0.3));
    const maxPosition = bufW - pulseWidth;

    // Calculate pulse position
    const pulseX = Math.floor(this._animationPosition * maxPosition);

    this.setColor(fillColor);
    this.fillRect(pulseX, 0, pulseWidth, bufH);
  }

  /**
   * Start indeterminate animation
   */
  private _startAnimation(requestRender?: () => void): void {
    if (this._animationTimer !== null) return;

    this._requestRender = requestRender ?? null;
    const speed = this.props.animationSpeed ?? 50;

    this._animationTimer = setInterval(() => {
      // Update position (ping-pong animation)
      this._animationPosition += 0.05 * this._animationDirection;

      if (this._animationPosition >= 1) {
        this._animationPosition = 1;
        this._animationDirection = -1;
      } else if (this._animationPosition <= 0) {
        this._animationPosition = 0;
        this._animationDirection = 1;
      }

      // Mark dirty and request render
      this.markDirty();
      if (this._requestRender) {
        this._requestRender();
      }
    }, speed);
  }

  /**
   * Stop indeterminate animation
   */
  private _stopAnimation(): void {
    if (this._animationTimer !== null) {
      clearInterval(this._animationTimer);
      this._animationTimer = null;
    }
  }

  /**
   * Set progress value
   */
  setValue(value: number): void {
    this.props.value = value;
    this.markDirty();
  }

  /**
   * Get current progress value
   */
  getValue(): number {
    return this.props.value ?? 0;
  }

  /**
   * Set indeterminate state
   */
  setIndeterminate(indeterminate: boolean): void {
    const wasIndeterminate = this.props.indeterminate;
    this.props.indeterminate = indeterminate;

    if (indeterminate && !wasIndeterminate) {
      this._startAnimation(this._requestRender ?? undefined);
    } else if (!indeterminate && wasIndeterminate) {
      this._stopAnimation();
    }

    this.markDirty();
  }

  /**
   * Render the progress bar
   */
  override render(
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    context: ComponentRenderContext
  ): void {
    // Start/stop animation based on indeterminate state
    if (this.props.indeterminate && this._animationTimer === null) {
      this._startAnimation(context.requestRender);
    } else if (!this.props.indeterminate && this._animationTimer !== null) {
      this._stopAnimation();
    }

    // Draw the progress bar to our pixel buffer
    this._drawProgressBar();

    // Calculate bounds for the canvas portion
    let canvasBounds = bounds;

    // If showValue, we need to render text after the bar
    if (this.props.showValue && !this.props.indeterminate) {
      const percentage = Math.round(this._getPercentage() * 100);
      const text = ` ${percentage}%`;
      const textOffset = text.length;

      // Adjust canvas bounds to leave room for text
      canvasBounds = {
        ...bounds,
        width: Math.max(1, bounds.width - textOffset),
      };

      // Render percentage text
      const textX = bounds.x + canvasBounds.width;
      const textY = bounds.y;
      buffer.currentBuffer.setText(textX, textY, text, style);
    }

    // Call parent render to convert pixels to terminal characters
    super.render(canvasBounds, style, buffer, context);
  }

  /**
   * Calculate intrinsic size
   */
  override intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    let width = this.props.width ?? 20;

    // Add space for percentage text if shown
    if (this.props.showValue) {
      width += 5; // " 100%"
    }

    return {
      width,
      height: this.props.height ?? 1,
    };
  }

  static override validate(props: ProgressProps): boolean {
    if (props.value !== undefined && typeof props.value !== 'number') {
      return false;
    }
    if (props.max !== undefined && typeof props.max !== 'number') {
      return false;
    }
    if (props.min !== undefined && typeof props.min !== 'number') {
      return false;
    }
    if (props.width !== undefined && (typeof props.width !== 'number' || props.width <= 0)) {
      return false;
    }
    if (props.height !== undefined && (typeof props.height !== 'number' || props.height <= 0)) {
      return false;
    }
    return true;
  }
}

// Lint schema for progress component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const progressSchema: ComponentSchema = {
  description: 'Progress bar using canvas pixels for smooth fill',
  props: {
    value: { type: 'number', description: 'Current progress value (default: 0)' },
    max: { type: 'number', description: 'Maximum value (default: 100)' },
    min: { type: 'number', description: 'Minimum value (default: 0)' },
    indeterminate: { type: 'boolean', description: 'Show animated loading state' },
    showValue: { type: 'boolean', description: 'Display percentage text after bar' },
    fillColor: { type: 'string', description: 'Color for filled portion' },
    emptyColor: { type: 'string', description: 'Color for empty portion' },
    animationSpeed: { type: 'number', description: 'Indeterminate animation speed in ms (default: 50)' },
    width: { type: 'number', description: 'Bar width in terminal columns (default: 20)' },
    height: { type: 'number', description: 'Bar height in terminal rows (default: 1)' },
  },
};

registerComponentSchema('progress', progressSchema);
