// Progress bar component using canvas pixels for smooth fill

import { Element, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { CanvasElement, CanvasProps } from './canvas.ts';
import { getCurrentTheme } from '../theme.ts';
import { lerpColor, type ColorSpace } from './color-utils.ts';
import { getLogger } from '../logging.ts';
import { parseDimension, isResponsiveDimension } from '../utils/dimensions.ts';

const logger = getLogger('progress');

export interface GradientStop {
  stop: number;              // Position 0-1 (0 = start, 1 = end)
  color: string;             // Color at this position
}

export type { ColorSpace } from './color-utils.ts';

export interface ProgressProps extends Omit<CanvasProps, 'width' | 'height'> {
  width?: number | string;   // Bar width: number, "50%", or "fill" (default: 20)
  height?: number | string;  // Bar height: number, "50%", or "fill" (default: 1)
  value?: number;            // Current value (default: 0)
  max?: number;              // Maximum value (default: 100)
  min?: number;              // Minimum value (default: 0)
  indeterminate?: boolean;   // Animated loading state (default: false)
  showValue?: boolean;       // Display percentage text after bar (default: false)
  fillColor?: string;        // Color for filled portion (ignored if gradient set)
  emptyColor?: string;       // Color for empty portion
  gradient?: GradientStop[]; // Gradient colors based on position in bar
  colorSpace?: ColorSpace;   // Color interpolation space: 'rgb', 'hsl', 'oklch' (default: 'rgb')
  animationSpeed?: number;   // Indeterminate animation speed in ms (default: 50)
}

export class ProgressElement extends CanvasElement {
  // Indeterminate animation state
  private _animationTimer: number | null = null;
  private _animationPosition: number = 0;
  private _animationDirection: number = 1;
  private _requestRender: (() => void) | null = null;

  // Responsive sizing state (like img)
  private _originalWidth: number | string;
  private _originalHeight: number | string;
  private _lastBoundsWidth: number = 0;
  private _lastBoundsHeight: number = 0;

  constructor(props: ProgressProps, children: Element[] = []) {
    // Store original dimensions for percentage calculation
    const origWidth = props.width ?? 20;
    const origHeight = props.height ?? 1;

    // Check if using responsive dimensions (percentage, fill, or decimal 0-1)
    const usesResponsive = isResponsiveDimension(origWidth) || isResponsiveDimension(origHeight);

    // Parse initial dimensions using parseDimension to handle numeric strings from XML
    // For responsive values, use defaults (will be recalculated in render)
    // For fixed values (including numeric strings like "20"), parse them properly
    const width = isResponsiveDimension(origWidth) ? 20 : parseDimension(origWidth, 0, 20);
    const height = isResponsiveDimension(origHeight) ? 1 : parseDimension(origHeight, 0, 1);

    // Call parent constructor with canvas props
    // Merge style to enforce minimum dimensions (prevent layout compression AND stretching)
    super(
      {
        ...props,
        width,
        height,
        style: {
          // Prevent flex stretching - set explicit height in style and prevent grow/shrink
          // This ensures the layout engine doesn't give more space than the canvas needs
          ...(usesResponsive ? {} : { flexShrink: 0, flexGrow: 0, height }),
          ...props.style,
        },
      } as CanvasProps,
      children
    );

    // Override type
    (this as { type: string }).type = 'progress';

    // Store original dimensions for responsive recalculation
    this._originalWidth = origWidth;
    this._originalHeight = origHeight;

    // Warn about common sizing footgun: style dimensions don't affect buffer size
    if (props.style?.width !== undefined && props.width === undefined) {
      logger.warn(`progress: style.width only affects layout, not buffer resolution. Use width prop instead (supports "100%", "fill", or number).`);
    }
    if (props.style?.height !== undefined && props.height === undefined) {
      logger.warn(`progress: style.height only affects layout, not buffer resolution. Use height prop instead (supports "100%", "fill", or number).`);
    }

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
   * Get color at position from gradient using the configured color space
   */
  private _getGradientColor(position: number): string {
    const gradient = this.props.gradient;
    if (!gradient || gradient.length === 0) {
      return this._getColors().fillColor;
    }

    // Sort stops by position
    const sorted = [...gradient].sort((a, b) => a.stop - b.stop);

    // Clamp position to 0-1
    position = Math.max(0, Math.min(1, position));

    // Find surrounding stops
    let lower = sorted[0];
    let upper = sorted[sorted.length - 1];

    for (let i = 0; i < sorted.length - 1; i++) {
      if (position >= sorted[i].stop && position <= sorted[i + 1].stop) {
        lower = sorted[i];
        upper = sorted[i + 1];
        break;
      }
    }

    // Handle edge cases
    if (position <= lower.stop) return lower.color;
    if (position >= upper.stop) return upper.color;

    // Interpolate between stops using configured color space
    const t = (position - lower.stop) / (upper.stop - lower.stop);
    return lerpColor(lower.color, upper.color, t, this.props.colorSpace || 'rgb');
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
      if (this.props.gradient && this.props.gradient.length > 0) {
        // Draw with gradient - each column gets its color based on position
        for (let x = 0; x < fillPixels; x++) {
          const position = x / bufW;
          const color = this._getGradientColor(position);
          this.setColor(color);
          this.fillRect(x, 0, 1, bufH);
        }
      } else {
        // Single color fill
        this.setColor(fillColor);
        this.fillRect(0, 0, fillPixels, bufH);
      }
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
    // Recalculate percentage dimensions if bounds changed (like img)
    if (bounds.width > 0 && bounds.height > 0) {
      const boundsChanged = bounds.width !== this._lastBoundsWidth || bounds.height !== this._lastBoundsHeight;

      if (boundsChanged) {
        this._lastBoundsWidth = bounds.width;
        this._lastBoundsHeight = bounds.height;

        const newWidth = parseDimension(this._originalWidth, bounds.width, 20);
        const newHeight = parseDimension(this._originalHeight, bounds.height, 1);

        // Update canvas dimensions if they changed (and valid)
        if (newWidth > 0 && newHeight > 0 && (newWidth !== this.props.width || newHeight !== this.props.height)) {
          this.setSize(newWidth, newHeight);
        }
      }
    }

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
    // Use parseDimension for responsive dimensions
    let width = parseDimension(this._originalWidth, context.availableSpace.width, 20);
    const height = parseDimension(this._originalHeight, context.availableSpace.height, 1);

    // Add space for percentage text if shown
    if (this.props.showValue) {
      width += 5; // " 100%"
    }

    return {
      width: width > 0 ? width : 20,
      height: height > 0 ? height : 1,
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
    // width/height can be number or string (for percentages, "fill")
    if (props.width !== undefined && typeof props.width !== 'number' && typeof props.width !== 'string') {
      return false;
    }
    if (props.height !== undefined && typeof props.height !== 'number' && typeof props.height !== 'string') {
      return false;
    }
    return true;
  }
}

// Lint schema for progress component
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const progressSchema: ComponentSchema = {
  description: 'Progress bar using canvas pixels for smooth fill',
  props: {
    value: { type: 'number', description: 'Current progress value (default: 0)' },
    max: { type: 'number', description: 'Maximum value (default: 100)' },
    min: { type: 'number', description: 'Minimum value (default: 0)' },
    indeterminate: { type: 'boolean', description: 'Show animated loading state' },
    showValue: { type: 'boolean', description: 'Display percentage text after bar' },
    fillColor: { type: 'string', description: 'Color for filled portion (ignored if gradient set)' },
    emptyColor: { type: 'string', description: 'Color for empty portion' },
    gradient: { type: 'array', description: 'Gradient color stops: [{stop: 0-1, color: "#hex"}]' },
    colorSpace: { type: 'string', enum: ['rgb', 'hsl', 'oklch'], description: 'Color interpolation space (default: rgb)' },
    animationSpeed: { type: 'number', description: 'Indeterminate animation speed in ms (default: 50)' },
    width: { type: ['number', 'string'], description: 'Bar width: number, "50%", or "fill" (default: 20)' },
    height: { type: ['number', 'string'], description: 'Bar height: number, "50%", or "fill" (default: 1)' },
  },
  styleWarnings: {
    width: 'Use width prop instead of style.width for progress bar sizing. style.width only affects layout, not pixel resolution.',
    height: 'Use height prop instead of style.height for progress bar sizing. style.height only affects layout, not pixel resolution.',
  },
};

registerComponentSchema('progress', progressSchema);

// Register progress component
registerComponent({
  type: 'progress',
  componentClass: ProgressElement,
  defaultProps: {
    width: 20,
    height: 1,
    value: 0,
    max: 100,
    min: 0,
    indeterminate: false,
    showValue: false,
    animationSpeed: 50,
    disabled: false,
  },
  validate: (props) => ProgressElement.validate(props as any),
});
