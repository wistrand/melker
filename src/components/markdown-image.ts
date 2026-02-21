// Markdown image rendering support
// Handles image loading, caching, aspect ratio tracking, and rendering

import { type Bounds } from '../types.ts';
import { type Cell } from '../buffer.ts';
import { getGlobalEngine } from '../global-accessors.ts';
import { getThemeColor, getThemeManager } from '../theme.ts';
import { CanvasElement } from './canvas.ts';
import { type SixelOutputData, type KittyOutputData, type ITermOutputData, getEffectiveGfxMode } from './canvas-render.ts';
import { getLogger } from '../logging.ts';
import type { MarkdownRenderContext, Image } from './markdown-types.ts';

const logger = getLogger('MarkdownImage');

/**
 * Manages image rendering for markdown content.
 * Handles caching of CanvasElements and aspect ratios for efficient re-renders.
 */
export class MarkdownImageRenderer {
  /** Cache of CanvasElements keyed by "src:widthxheight" */
  private _imageCanvases: Map<string, CanvasElement> = new Map();

  /** Cache of image aspect ratios keyed by resolved src */
  private _imageAspectRatios: Map<string, number> = new Map();

  /** Resolved URL of the markdown source file (for relative path resolution) */
  private _resolvedSrcUrl: string | null = null;

  /** Whether height has stabilized after image loads */
  private _heightStabilized: boolean = false;

  /** Callback to reset height stabilization (triggers re-layout) */
  private _onHeightStabilizationReset?: () => void;

  /**
   * Set the resolved source URL for path resolution
   */
  setResolvedSrcUrl(url: string | null): void {
    this._resolvedSrcUrl = url;
  }

  /**
   * Get the resolved source URL
   */
  getResolvedSrcUrl(): string | null {
    return this._resolvedSrcUrl;
  }

  /**
   * Check if height is stabilized
   */
  isHeightStabilized(): boolean {
    return this._heightStabilized;
  }

  /**
   * Set height stabilization state
   */
  setHeightStabilized(value: boolean): void {
    this._heightStabilized = value;
  }

  /**
   * Set callback for when height stabilization needs to be reset
   */
  onHeightStabilizationReset(callback: () => void): void {
    this._onHeightStabilizationReset = callback;
  }

  /**
   * Reset state for new content
   */
  reset(): void {
    this._heightStabilized = false;
  }

  /**
   * Render markdown image node ![alt](url)
   */
  renderImage(node: Image, ctx: MarkdownRenderContext): number {
    const width = ctx.bounds.width;
    return this.renderImageElement(node.url, node.alt, width, undefined, ctx);
  }

  /**
   * Parse a dimension value with optional unit suffix.
   * - Bare numbers or 'px' suffix: treated as CSS pixels, converted to chars (divide by 8)
   * - 'ch' suffix: treated as characters, used as-is
   * - '%' suffix: percentage of available width
   */
  parseDimension(value: string, availableWidth: number): number {
    const match = value.match(/^(\d+(?:\.\d+)?)(px|ch|%)?$/i);
    if (!match) return 0;

    const num = parseFloat(match[1]);
    const unit = (match[2] || 'px').toLowerCase();

    switch (unit) {
      case 'ch':
        return Math.round(num);
      case '%':
        return Math.round((num / 100) * availableWidth);
      case 'px':
      default:
        // Convert pixels to characters (approx 8px per char)
        return Math.round(num / 8);
    }
  }

  /**
   * Parse and render an <img> tag
   */
  renderImgTag(attributes: string, ctx: MarkdownRenderContext): number {
    // Parse attributes
    const srcMatch = attributes.match(/src\s*=\s*["']([^"']+)["']/i);
    const widthMatch = attributes.match(/width\s*=\s*["']?(\d+(?:px|ch|%)?|\d+)["']?/i);
    const heightMatch = attributes.match(/height\s*=\s*["']?(\d+(?:px|ch|%)?|\d+)["']?/i);
    const altMatch = attributes.match(/alt\s*=\s*["']([^"']*)["']/i);

    if (!srcMatch) {
      return 0; // No src, skip
    }

    const src = srcMatch[1];
    const availableWidth = ctx.bounds.width;
    const width = widthMatch ? this.parseDimension(widthMatch[1], availableWidth) : undefined;
    const height = heightMatch ? this.parseDimension(heightMatch[1], availableWidth) : undefined;
    const alt = altMatch ? altMatch[1] : undefined;

    return this.renderImageElement(src, alt, width, height, ctx);
  }

  /**
   * Render an image using Canvas element
   */
  renderImageElement(
    src: string,
    alt: string | undefined,
    width: number | undefined,
    height: number | undefined,
    ctx: MarkdownRenderContext
  ): number {
    // Resolve src relative to markdown source file
    const resolvedSrc = this.resolveImagePath(src);
    logger.debug('Resolved image path', { originalSrc: src, resolvedSrc });

    // Calculate dimensions
    const imgWidth = width || 30;
    let imgHeight: number;

    if (height !== undefined) {
      // Height explicitly specified
      imgHeight = height;
    } else if (width !== undefined) {
      // Width specified but height not - try to calculate from cached aspect ratio
      const cachedAspect = this._imageAspectRatios.get(resolvedSrc);
      if (cachedAspect !== undefined) {
        // Calculate height from width and aspect ratio, accounting for terminal char aspect
        // Terminal chars are typically ~2x taller than wide, so we divide by 2
        imgHeight = Math.round(imgWidth / cachedAspect / 2);
        logger.debug('Using cached aspect ratio for height', { cachedAspect, imgWidth, imgHeight });
      } else {
        // Aspect ratio not yet known - use placeholder height
        imgHeight = 15;
        logger.debug('Aspect ratio not cached, using placeholder height', { imgWidth, imgHeight });
      }
    } else {
      // Neither specified - use defaults
      imgHeight = 15;
    }

    logger.debug('Rendering image element', { src, alt, width: imgWidth, height: imgHeight });

    // Create a unique cache key combining src, dimensions, and dither settings
    const cacheKey = `${resolvedSrc}:${imgWidth}x${imgHeight}`;

    // Check if we already have a canvas for this image
    let canvas = this._imageCanvases.get(cacheKey);

    if (!canvas) {
      // Create a new Canvas element with dithering for B&W/color themes
      // Include src prop for sixel palette caching and id for debugging
      const canvasId = `md-img-${this._imageCanvases.size}`;
      const isSixel = getEffectiveGfxMode() === 'sixel';
      canvas = new CanvasElement({
        id: canvasId,
        width: imgWidth,
        height: imgHeight,
        dither: 'auto',
        // 3-bit (8 levels) for sixel - good balance of quality and palette usage
        ...(isSixel && { ditherBits: 3 }),
        src: resolvedSrc,
      }, []);

      // Store in cache
      this._imageCanvases.set(cacheKey, canvas);

      // Start loading the image asynchronously
      logger.info('Starting image load', { resolvedSrc });
      canvas.loadImage(resolvedSrc).then(() => {
        logger.info('Image loaded successfully', { resolvedSrc });

        // Cache the image aspect ratio for future renders
        const loadedImage = (canvas as any)._loadedImage;
        if (loadedImage && loadedImage.width && loadedImage.height) {
          const aspectRatio = loadedImage.width / loadedImage.height;
          const previousAspect = this._imageAspectRatios.get(resolvedSrc);
          this._imageAspectRatios.set(resolvedSrc, aspectRatio);
          logger.debug('Cached image aspect ratio', { resolvedSrc, aspectRatio });

          // If this is a new aspect ratio, reset height stabilization to allow re-layout
          if (previousAspect === undefined) {
            this._heightStabilized = false;
            logger.debug('Reset height stabilization for new image aspect ratio');
            if (this._onHeightStabilizationReset) {
              this._onHeightStabilizationReset();
            }

            // Invalidate the cache and re-render with correct dimensions
            if (width !== undefined && height === undefined) {
              this._imageCanvases.delete(cacheKey);
              logger.debug('Invalidating canvas cache for aspect ratio update', { cacheKey });
            }
          }
        }

        // Trigger re-render when image loads
        if (ctx.context.requestRender) {
          ctx.context.requestRender();
        }
      }).catch((err) => {
        logger.error('Failed to load image: ' + String(err), undefined, { resolvedSrc });
      });
    }

    // Render the canvas at current position
    const bounds: Bounds = {
      x: ctx.currentX,
      y: ctx.currentY,
      width: Math.min(imgWidth, ctx.bounds.width),
      height: imgHeight,
    };

    canvas.render(bounds, ctx.style, ctx.buffer, ctx.context);

    // Add alt text below image if provided
    let totalHeight = imgHeight + 1; // +1 for spacing

    if (alt) {
      const altStyle: Partial<Cell> = {
        ...ctx.style,
        foreground: getThemeColor('textMuted'),
        italic: true,
      };
      const altText = `[${alt}]`;
      ctx.buffer.currentBuffer.setText(ctx.currentX, ctx.currentY + imgHeight, altText, altStyle);
      totalHeight += 1;
    }

    return totalHeight;
  }

  /**
   * Resolve image path relative to markdown source file
   */
  resolveImagePath(src: string): string {
    logger.debug('Resolving image path', { src, markdownSrc: this._resolvedSrcUrl });

    // If src is already absolute URL, return as-is
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('file://')) {
      logger.debug('Image src is absolute URL');
      return src;
    }

    // If src is absolute path, return as-is
    if (src.startsWith('/')) {
      logger.debug('Image src is absolute path');
      return src;
    }

    // Use the actual resolved URL of the markdown file (set during loadUrl)
    // This correctly handles cwd-relative paths passed as command-line arguments
    const markdownUrl = this._resolvedSrcUrl;
    if (!markdownUrl) {
      // No resolved URL yet, fall back to engine resolution
      const engine = getGlobalEngine();
      if (engine && typeof engine.resolveUrl === 'function') {
        const resolved = engine.resolveUrl(src);
        logger.debug('Resolved via engine (no resolved markdown URL)', { resolved });
        return resolved;
      }
      logger.debug('No engine available, returning src as-is');
      return src;
    }

    // Resolve relative to markdown file's directory
    try {
      // Get the directory of the markdown file
      const markdownDir = markdownUrl.substring(0, markdownUrl.lastIndexOf('/') + 1);
      const combinedUrl = markdownDir + src;

      // Normalize the URL to resolve ../ and ./
      const normalizedUrl = new URL(combinedUrl);
      // Return plain pathname (strip file:// protocol) for local files
      const resolvedPath = normalizedUrl.protocol === 'file:' ? normalizedUrl.pathname : normalizedUrl.href;
      logger.debug('Resolved relative to markdown file', { markdownUrl, markdownDir, combinedUrl, resolvedPath });
      return resolvedPath;
    } catch (e) {
      logger.error('Error resolving image path: ' + String(e));
    }

    return src;
  }

  /**
   * Get sixel outputs from embedded image canvases.
   * Used by engine to render sixel graphics for images in markdown content.
   */
  getSixelOutputs(): SixelOutputData[] {
    const outputs: SixelOutputData[] = [];
    logger.debug('getSixelOutputs called', { canvasCount: this._imageCanvases.size });
    for (const [key, canvas] of this._imageCanvases.entries()) {
      const sixelOutput = canvas.getSixelOutput();
      logger.debug('Checking canvas for sixel output', {
        key,
        hasSixelOutput: !!sixelOutput,
        hasData: !!sixelOutput?.data,
        hasBounds: !!sixelOutput?.bounds,
        isSixelMode: canvas.isSixelMode(),
      });
      if (sixelOutput?.data && sixelOutput.bounds) {
        outputs.push(sixelOutput);
      }
    }
    logger.debug('getSixelOutputs returning', { outputCount: outputs.length });
    return outputs;
  }

  /**
   * Get kitty outputs from embedded image canvases.
   * Used by engine to render kitty graphics for images in markdown content.
   */
  getKittyOutputs(): KittyOutputData[] {
    const outputs: KittyOutputData[] = [];
    for (const [key, canvas] of this._imageCanvases.entries()) {
      const kittyOutput = canvas.getKittyOutput();
      if (kittyOutput?.data && kittyOutput.bounds) {
        outputs.push(kittyOutput);
      }
    }
    logger.debug('getKittyOutputs returning', { outputCount: outputs.length });
    return outputs;
  }

  /**
   * Get iTerm2 outputs from embedded image canvases.
   * Used by engine to render iTerm2 graphics for images in markdown content.
   */
  getITermOutputs(): ITermOutputData[] {
    const outputs: ITermOutputData[] = [];
    for (const [key, canvas] of this._imageCanvases.entries()) {
      const itermOutput = canvas.getITermOutput();
      if (itermOutput?.data && itermOutput.bounds) {
        outputs.push(itermOutput);
      }
    }
    logger.debug('getITermOutputs returning', { outputCount: outputs.length });
    return outputs;
  }

  /**
   * Get all cached canvas elements (for subtree element access)
   */
  getImageCanvases(): CanvasElement[] {
    return Array.from(this._imageCanvases.values());
  }
}
