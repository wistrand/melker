// Types for segment display renderers

import type { SegmentMask } from './charsets.ts';

export type SegmentHeight = 5 | 7;

export interface SegmentRenderOptions {
  showOffSegments: boolean;  // render "off" segments with offChar
}

/**
 * Result of rendering a character - array of lines with segment info
 */
export interface RenderedChar {
  lines: string[];           // The rendered lines
  width: number;             // Character width in columns
}

/**
 * Interface for segment display renderers
 */
export interface SegmentRenderer {
  readonly name: string;
  readonly charWidth: number;
  readonly charHeight: SegmentHeight;
  readonly onChar: string;   // Character used for "on" segments
  readonly offChar: string;  // Character used for "off" segments

  /**
   * Render a single character from segment mask
   */
  renderChar(segments: SegmentMask, options: SegmentRenderOptions): RenderedChar;

  /**
   * Render a colon (special handling - narrower)
   */
  renderColon(options: SegmentRenderOptions): RenderedChar;

  /**
   * Render a dot/period (special handling)
   */
  renderDot(options: SegmentRenderOptions): RenderedChar;
}

/**
 * Base class for segment renderers with common functionality
 */
export abstract class BaseRenderer implements SegmentRenderer {
  abstract readonly name: string;
  abstract readonly charWidth: number;
  abstract readonly charHeight: SegmentHeight;
  abstract readonly onChar: string;
  abstract readonly offChar: string;

  // Characters for horizontal and vertical segments
  abstract readonly horzOn: string;
  abstract readonly horzOff: string;
  abstract readonly vertOn: string;
  abstract readonly vertOff: string;

  constructor(protected height: SegmentHeight) {}

  abstract renderChar(segments: SegmentMask, options: SegmentRenderOptions): RenderedChar;
  abstract renderColon(options: SegmentRenderOptions): RenderedChar;
  abstract renderDot(options: SegmentRenderOptions): RenderedChar;

  /**
   * Helper to create a horizontal segment string
   */
  protected horzSegment(on: boolean, width: number, options: SegmentRenderOptions): string {
    const char = on ? this.horzOn : (options.showOffSegments ? this.horzOff : ' ');
    return char.repeat(width);
  }

  /**
   * Helper to get vertical segment character
   */
  protected vertSegment(on: boolean, options: SegmentRenderOptions): string {
    return on ? this.vertOn : (options.showOffSegments ? this.vertOff : ' ');
  }
}
