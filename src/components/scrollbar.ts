/**
 * Shared scrollbar rendering utility
 */

import type { DualBuffer, Cell } from '../buffer.ts';
import { isUnicodeSupported } from '../utils/terminal-detection.ts';

export interface ScrollbarOptions {
  // Calculation: provide scrollRatio OR (totalItems + visibleItems + scrollTop)
  scrollRatio?: number;
  totalItems?: number;
  visibleItems?: number;
  scrollTop?: number;

  // Pre-calculated thumb (overrides calculation)
  thumbPosition?: number;
  thumbSize?: number;

  // Styling
  thumbStyle?: Partial<Cell>;
  trackStyle?: Partial<Cell>;

  // Characters (defaults: █ and ░)
  thumbChar?: string;
  trackChar?: string;

  // Behavior
  renderTrack?: boolean; // default true
}

export function renderScrollbar(
  buffer: DualBuffer,
  x: number,
  y: number,
  height: number,
  options: ScrollbarOptions
): void {
  if (height <= 0) return;

  const unicodeOk = isUnicodeSupported();
  const thumbChar = options.thumbChar ?? (unicodeOk ? '█' : '#');
  const trackChar = options.trackChar ?? (unicodeOk ? '░' : '.');
  const renderTrack = options.renderTrack ?? true;

  let thumbPos: number;
  let thumbSize: number;

  if (options.thumbPosition !== undefined && options.thumbSize !== undefined) {
    // Use pre-calculated values
    thumbPos = options.thumbPosition;
    thumbSize = options.thumbSize;
  } else {
    // Calculate from scroll parameters
    const totalItems = options.totalItems ?? 1;
    const visibleItems = options.visibleItems ?? 1;
    const scrollTop = options.scrollTop ?? 0;

    if (totalItems <= visibleItems) {
      // No scrolling needed - full thumb
      thumbSize = height;
      thumbPos = 0;
    } else {
      thumbSize = Math.max(1, Math.floor((visibleItems / totalItems) * height));
      const maxScroll = totalItems - visibleItems;
      const scrollRatio = options.scrollRatio ?? (maxScroll > 0 ? scrollTop / maxScroll : 0);
      thumbPos = Math.floor(scrollRatio * (height - thumbSize));
    }
  }

  // Clamp thumb position
  thumbPos = Math.max(0, Math.min(height - thumbSize, thumbPos));

  for (let i = 0; i < height; i++) {
    const isThumb = i >= thumbPos && i < thumbPos + thumbSize;

    if (isThumb) {
      buffer.currentBuffer.setCell(x, y + i, { char: thumbChar, ...options.thumbStyle });
    } else if (renderTrack) {
      buffer.currentBuffer.setCell(x, y + i, { char: trackChar, ...options.trackStyle });
    }
  }
}
