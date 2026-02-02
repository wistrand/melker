// Image component - HTML-like img tag for displaying images in Melker
// Subclass of CanvasElement that provides a familiar API

import { Element, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { CanvasElement, type CanvasProps } from './canvas.ts';
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';
import { getLogger } from '../logging.ts';
import { parseDimension, isResponsiveDimension } from '../utils/dimensions.ts';
import { ensureError } from '../utils/error.ts';

const logger = getLogger('ImgElement');

export interface ImgProps extends Omit<CanvasProps, 'width' | 'height' | 'src'> {
  /** Image source path (relative to current file or absolute). Optional if using loadImageFromBytes() */
  src?: string;
  /** Alternative text for accessibility */
  alt?: string;
  /** Width in terminal columns, or percentage string like "50%" */
  width?: number | string;
  /** Height in terminal rows, or percentage string like "50%" */
  height?: number | string;
  /** How the image should fit: 'contain' (default, preserve aspect), 'fill' (stretch), 'cover' (crop) */
  objectFit?: 'contain' | 'fill' | 'cover';
  /** Called when image loads successfully */
  onLoad?: () => void;
  /** Called when image fails to load */
  onError?: (error: Error) => void;
}

export class ImgElement extends CanvasElement {
  declare props: ImgProps & CanvasProps;

  // Store callbacks separately to avoid type conflicts
  private _onLoad?: () => void;
  private _onError?: (error: Error) => void;
  private _originalSrc: string | undefined;
  private _srcResolved: boolean = false;
  private _originalWidth: number | string;
  private _originalHeight: number | string;
  private _lastBoundsWidth: number = 0;
  private _lastBoundsHeight: number = 0;

  constructor(props: ImgProps, children: Element[] = []) {
    // Store original dimensions for percentage calculation
    const origWidth = props.width ?? 30;
    const origHeight = props.height ?? 15;

    // Check if using responsive dimensions (percentage, fill, or decimal 0-1)
    const usesResponsive = isResponsiveDimension(origWidth) || isResponsiveDimension(origHeight);

    // For canvas buffer initialization, use placeholder sizes for responsive dimensions
    // The actual buffer will be resized in render() when bounds are known
    const canvasWidth = isResponsiveDimension(origWidth) ? 30 : (typeof origWidth === 'number' ? origWidth : 30);
    const canvasHeight = isResponsiveDimension(origHeight) ? 15 : (typeof origHeight === 'number' ? origHeight : 15);

    // Call parent constructor with canvas props
    // IMPORTANT: Keep original width/height for layout (percentage strings like "100%")
    // Only use placeholder for internal canvas buffer size
    // Don't pass src yet - we'll resolve it in render
    super(
      {
        ...props,
        // Keep original width/height in props for layout engine to handle percentages
        width: origWidth,
        height: origHeight,
        src: undefined, // Will be set after resolution
        style: {
          // Only prevent shrinking for fixed-dimension images
          // Responsive images should shrink with container
          ...(usesResponsive ? {} : { flexShrink: 0 }),
          ...props.style,
        },
      } as CanvasProps,
      children
    );

    // Initialize canvas buffer with placeholder size (will be resized in render)
    if (usesResponsive) {
      this.setSize(canvasWidth, canvasHeight);
    }

    // Override type
    (this as { type: string }).type = 'img';

    // Warn about common sizing footgun: style dimensions don't affect buffer size
    // Note: This is img-specific advice (use props with %, fill support)
    if (props.style?.width !== undefined && props.width === undefined) {
      logger.warn(`img: style.width doesn't resize image buffer. Use width prop instead (supports "100%", "fill", or number).`);
    }
    if (props.style?.height !== undefined && props.height === undefined) {
      logger.warn(`img: style.height doesn't resize image buffer. Use height prop instead (supports "100%", "fill", or number).`);
    }

    // Store original values for resolution
    this._originalSrc = props.src;
    this._originalWidth = origWidth;
    this._originalHeight = origHeight;
    this.props.alt = props.alt;
    this._onLoad = props.onLoad;
    this._onError = props.onError;

    // Default objectFit to 'fill' (matching HTML img tag behavior)
    this.props.objectFit = props.objectFit ?? 'fill';

    // Default dither to 'auto' for good results on all themes
    if (props.dither === undefined) {
      this.props.dither = 'auto';
    }
  }

  /**
   * Parse a dimension value (number, percentage string, or "fill")
   * Uses shared utility for consistent behavior across components.
   */
  private _parseDimension(value: number | string, available: number): number {
    return parseDimension(value, available, 30);
  }

  /**
   * Resolve src path relative to the .melker file
   */
  private _resolveSrc(): string | undefined {
    const src = this._originalSrc;
    if (!src) return undefined;

    // If already absolute or data URL, return as-is
    if (src.startsWith('http://') || src.startsWith('https://') ||
        src.startsWith('file://') || src.startsWith('/') ||
        src.startsWith('data:')) {
      return src;
    }

    // Try to resolve using the engine
    const engine = globalThis.melkerEngine;
    if (engine && typeof engine.resolveUrl === 'function') {
      const resolved = engine.resolveUrl(src);
      // Convert file:// URL to path
      if (resolved.startsWith('file://')) {
        return new URL(resolved).pathname;
      }
      return resolved;
    }

    // Fallback: resolve from cwd
    return `${Deno.cwd()}/${src}`;
  }

  /**
   * Load the image and call appropriate callbacks
   */
  override async loadImage(src: string): Promise<void> {
    try {
      await super.loadImage(src);
      if (this._onLoad) {
        this._onLoad();
      }
    } catch (error) {
      if (this._onError) {
        this._onError(ensureError(error));
      } else {
        throw error;
      }
    }
  }

  /**
   * Render the image
   */
  override render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Resolve src on first render (when engine is available)
    if (!this._srcResolved && this._originalSrc) {
      const resolvedSrc = this._resolveSrc();
      if (resolvedSrc) {
        this.props.src = resolvedSrc;
      }
      this._srcResolved = true;
    }

    // Check if using percentage dimensions
    const usesPercentage = typeof this._originalWidth === 'string' || typeof this._originalHeight === 'string';

    // Recalculate percentage dimensions if bounds changed
    if (bounds.width > 0 && bounds.height > 0) {
      const boundsChanged = bounds.width !== this._lastBoundsWidth || bounds.height !== this._lastBoundsHeight;

      if (boundsChanged) {
        logger.debug(`Bounds changed: ${this._lastBoundsWidth}x${this._lastBoundsHeight} -> ${bounds.width}x${bounds.height}`);
        this._lastBoundsWidth = bounds.width;
        this._lastBoundsHeight = bounds.height;

        const newWidth = this._parseDimension(this._originalWidth, bounds.width);
        const newHeight = this._parseDimension(this._originalHeight, bounds.height);

        // Update canvas dimensions if they changed (and valid)
        if (newWidth > 0 && newHeight > 0 && (newWidth !== this.props.width || newHeight !== this.props.height)) {
          // Resize the canvas buffer using parent's setSize method
          logger.debug(`Calling setSize: ${this.props.width}x${this.props.height} -> ${newWidth}x${newHeight}`);
          this.setSize(newWidth, newHeight);
        }
      }

      // For percentage dimensions, always refresh to handle async image loading
      if (usesPercentage) {
        this.refreshImage();
      }
    }

    // Let parent handle the actual rendering
    super.render(bounds, style, buffer, context);
  }

  /**
   * Calculate intrinsic size
   */
  override intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    // For percentage dimensions, use available space from context
    const width = this._parseDimension(this._originalWidth, context.availableSpace.width);
    const height = this._parseDimension(this._originalHeight, context.availableSpace.height);

    return {
      width: width > 0 ? width : (this.props.width ?? 30),
      height: height > 0 ? height : (this.props.height ?? 15),
    };
  }
}

// Register the component
registerComponent({
  type: 'img',
  componentClass: ImgElement,
  defaultProps: {
    width: 30,
    height: 15,
    disabled: false,
  },
});

// Lint schema for img component
export const imgSchema: ComponentSchema = {
  description: 'Display an image in the terminal',
  props: {
    src: { type: 'string', required: false, description: 'Image source path or data URL (data:image/png;base64,...). Optional if loading via loadImageFromBytes()' },
    alt: { type: 'string', description: 'Alternative text for accessibility' },
    width: { type: ['number', 'string'], description: 'Width in columns or percentage (e.g., 30 or "50%")' },
    height: { type: ['number', 'string'], description: 'Height in rows or percentage (e.g., 15 or "50%")' },
    objectFit: { type: 'string', enum: ['contain', 'fill', 'cover'], description: 'How image fits: contain (aspect ratio), fill (stretch), cover (crop)' },
    dither: { type: ['string', 'boolean'], enum: ['auto', 'none', 'floyd-steinberg', 'sierra-stable', 'ordered'], description: 'Dithering algorithm for limited color themes' },
    ditherBits: { type: 'number', description: 'Color depth for dithering (1-8)' },
    onLoad: { type: ['function', 'string'], description: 'Called when image loads successfully' },
    onError: { type: ['function', 'string'], description: 'Called when image fails to load' },
    onShader: { type: ['function', 'string'], description: 'Shader callback (x, y, time, resolution, source, utils) => [r,g,b]. utils: noise2d, fbm, palette, smoothstep, mix, fract' },
    onFilter: { type: ['function', 'string'], description: 'One-time filter callback, runs once when image loads. Same signature as onShader but time is always 0' },
    shaderFps: { type: 'number', description: 'Shader frame rate (default: 30)' },
  },
  styleWarnings: {
    width: 'Use width prop instead of style.width for image buffer sizing. style.width only affects layout, not pixel resolution. Props support "100%", "fill", or number.',
    height: 'Use height prop instead of style.height for image buffer sizing. style.height only affects layout, not pixel resolution. Props support "100%", "fill", or number.',
  },
};

registerComponentSchema('img', imgSchema);
