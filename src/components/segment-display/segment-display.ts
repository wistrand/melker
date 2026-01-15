// Segment Display Component
// Renders LCD/LED-style digits using Unicode characters

import { Element, BaseProps, Renderable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../../types.ts';
import type { DualBuffer, Cell } from '../../buffer.ts';
import { getCharset, isSpecialChar, type SegmentMask } from './charsets.ts';
import { getRenderer, type SegmentRenderer } from './renderers.ts';
import type { SegmentHeight, SegmentRenderOptions } from './types.ts';

export interface SegmentDisplayProps extends BaseProps {
  value?: string;              // Text to display
  renderer?: string;           // Renderer style: box-drawing, block, rounded, geometric
  scroll?: boolean;            // Enable horizontal scrolling
  scrollSpeed?: number;        // Scroll speed in ms (default: 200)
  scrollGap?: number;          // Gap between repeated text (default: 3)
}

export class SegmentDisplayElement extends Element implements Renderable {
  declare type: 'segment-display';
  declare props: SegmentDisplayProps;

  private _renderer: SegmentRenderer | null = null;
  private _charset: Record<string, SegmentMask> | null = null;
  private _scrollOffset = 0;
  private _scrollTimer: number | null = null;
  private _lastValue: string | null = null;
  private _renderedLines: string[] | null = null;
  private _totalWidth = 0;

  constructor(props: SegmentDisplayProps, children: Element[] = []) {
    const defaultProps: SegmentDisplayProps = {
      disabled: false,
      renderer: 'box-drawing',
      scroll: false,
      scrollSpeed: 24,
      scrollGap: 3,
      ...props,
      style: {
        ...props.style,
      },
    };

    super('segment-display', defaultProps, children);
  }

  /**
   * Get the renderer instance
   */
  private getRendererInstance(): SegmentRenderer {
    if (!this._renderer) {
      const height = this.getHeight();
      this._renderer = getRenderer(this.props.renderer || 'box-drawing', height);
    }
    return this._renderer;
  }

  /**
   * Get the charset (always l33t for full letter support)
   */
  private getCharsetInstance(): Record<string, SegmentMask> {
    if (!this._charset) {
      this._charset = getCharset('l33t');
    }
    return this._charset;
  }

  /**
   * Get height from style (5 or 7)
   */
  private getHeight(): SegmentHeight {
    const styleHeight = this.props.style?.height;
    // Support both number 7 and string '7' (from XML attributes)
    if (styleHeight === 7 || Number(styleHeight) === 7) return 7;
    return 5;
  }

  /**
   * Get normalized value as string (handles number values from XML)
   */
  private getNormalizedValue(): string {
    const rawValue = this.props.value;
    return rawValue != null ? String(rawValue) : '';
  }

  /**
   * Render all characters to lines
   */
  private renderAllChars(): { lines: string[]; totalWidth: number } {
    const value = this.getNormalizedValue();
    const renderer = this.getRendererInstance();
    const charset = this.getCharsetInstance();
    const options: SegmentRenderOptions = {
      showOffSegments: !!this.props.style?.['off-color'],
    };

    // Initialize empty lines
    const height = renderer.charHeight;
    const lines: string[] = Array(height).fill('');
    let totalWidth = 0;

    for (const char of value) {
      let rendered;

      if (isSpecialChar(char)) {
        if (char === ':') {
          rendered = renderer.renderColon(options);
        } else {
          rendered = renderer.renderDot(options);
        }
      } else {
        const segments = charset[char] || charset[char.toUpperCase()] || charset[' '];
        if (segments) {
          rendered = renderer.renderChar(segments, options);
        } else {
          // Unknown character - render as space
          rendered = renderer.renderChar(charset[' ']!, options);
        }
      }

      if (rendered) {
        for (let i = 0; i < height; i++) {
          lines[i] += rendered.lines[i] || ' '.repeat(rendered.width);
        }
        totalWidth += rendered.width;
      }
    }

    return { lines, totalWidth };
  }

  /**
   * Start scrolling animation
   */
  private startScrolling(): void {
    if (this._scrollTimer !== null) return;

    const speed = this.props.scrollSpeed || 200;
    this._scrollTimer = setInterval(() => {
      this._scrollOffset++;
      const gap = this.props.scrollGap || 3;
      if (this._scrollOffset >= this._totalWidth + gap) {
        this._scrollOffset = 0;
      }
      // Request re-render
      const engine = globalThis.melkerEngine;
      if (engine?.render) {
        engine.render();
      }
    }, speed) as unknown as number;
  }

  /**
   * Stop scrolling animation
   */
  private stopScrolling(): void {
    if (this._scrollTimer !== null) {
      clearInterval(this._scrollTimer);
      this._scrollTimer = null;
    }
  }

  /**
   * Clean up on destroy
   */
  destroy(): void {
    this.stopScrolling();
  }

  /**
   * Render the segment display to the terminal buffer
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    const value = this.getNormalizedValue();

    if (!value) return;

    // Re-render if value changed
    if (value !== this._lastValue || !this._renderedLines) {
      const result = this.renderAllChars();
      this._renderedLines = result.lines;
      this._totalWidth = result.totalWidth;
      this._lastValue = value;
    }

    // Handle scrolling - scroll if enabled (width check happens visually via truncation)
    if (this.props.scroll) {
      this.startScrolling();
    } else {
      this.stopScrolling();
      this._scrollOffset = 0;
    }

    // Get colors from style
    const onColor = this.props.style?.color;
    const offColor = this.props.style?.['off-color'];
    const bgColor = this.props.style?.['background-color'] || this.props.style?.backgroundColor;

    // Build cell style
    const cellStyle: Partial<Cell> = { ...style };
    if (onColor) {
      cellStyle.foreground = onColor as string;
    }
    if (bgColor) {
      cellStyle.background = bgColor as string;
    }

    // Render lines to buffer
    const lines = this._renderedLines!;
    for (let y = 0; y < lines.length && y < bounds.height; y++) {
      let line = lines[y];

      // Handle scrolling offset
      if (this.props.scroll && this._scrollOffset > 0) {
        const gap = ' '.repeat(this.props.scrollGap || 3);
        const fullLine = line + gap + line;
        line = fullLine.substring(this._scrollOffset);
      }

      // Truncate to fit bounds
      if (line.length > bounds.width) {
        line = line.substring(0, bounds.width);
      }

      // Write to buffer, handling off-color for dimmed segments
      if (offColor) {
        // Character-by-character rendering for off-color support
        for (let x = 0; x < line.length && x < bounds.width; x++) {
          const char = line[x];
          const charStyle = { ...cellStyle };

          // Check if this is an "off" segment character
          const isOffChar = char === '·' || char === '░' || char === '▯' || char === '─';
          if (isOffChar) {
            charStyle.foreground = offColor as string;
          }

          buffer.currentBuffer.setCell(bounds.x + x, bounds.y + y, {
            char,
            ...charStyle,
          });
        }
      } else {
        // Fast path: write entire line
        buffer.currentBuffer.setText(bounds.x, bounds.y + y, line, cellStyle);
      }
    }
  }

  /**
   * Calculate intrinsic size
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const value = this.getNormalizedValue();
    if (!value) return { width: 0, height: 0 };

    const renderer = this.getRendererInstance();

    // Calculate width: each char + special chars
    let width = 0;
    for (const char of value) {
      if (isSpecialChar(char)) {
        width += 2; // Colon and dot are narrower
      } else {
        width += renderer.charWidth;
      }
    }

    return {
      width,
      height: renderer.charHeight,
    };
  }

  /**
   * Get the current value
   */
  getValue(): string {
    return this.getNormalizedValue();
  }

  /**
   * Set the value
   */
  setValue(value: string): void {
    this.props.value = value;
    this._lastValue = null; // Force re-render
    this._renderedLines = null;
  }

  /**
   * Invalidate renderer cache (call when style changes)
   */
  invalidateRenderer(): void {
    this._renderer = null;
    this._renderedLines = null;
    this._lastValue = null;
  }

  static validate(props: SegmentDisplayProps): boolean {
    if (props.value !== undefined && typeof props.value !== 'string') {
      return false;
    }
    if (props.renderer !== undefined &&
        !['box-drawing', 'block', 'rounded', 'geometric'].includes(props.renderer)) {
      return false;
    }
    // Validate height if in style (must be 5 or 7)
    const height = props.style?.height;
    if (height !== undefined) {
      const numHeight = Number(height);
      if (numHeight !== 5 && numHeight !== 7) {
        return false;
      }
    }
    return true;
  }
}

// Lint schema for segment-display component
import { registerComponentSchema, type ComponentSchema } from '../../lint.ts';

export const segmentDisplaySchema: ComponentSchema = {
  description: 'LCD/LED-style segment display for digits and text. Styles: height (5 or 7), color (lit segments), off-color (dimmed), background-color.',
  props: {
    value: { type: 'string', description: 'Text to display' },
    renderer: {
      type: 'string',
      description: 'Rendering style',
      enum: ['box-drawing', 'block', 'rounded', 'geometric'],
    },
    scroll: { type: 'boolean', description: 'Enable horizontal scrolling' },
    scrollSpeed: { type: 'number', description: 'Scroll speed in milliseconds' },
    scrollGap: { type: 'number', description: 'Gap between repeated text when scrolling' },
  },
};

registerComponentSchema('segment-display', segmentDisplaySchema);
