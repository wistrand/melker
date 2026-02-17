// Tooltip Renderer - renders tooltip overlay to buffer using MarkdownElement

import type { DualBuffer, Cell } from '../buffer.ts';
import type { Bounds } from '../types.ts';
import { getBorderChars } from '../types.ts';
import { getThemeColor } from '../theme.ts';
import { getTooltipManager } from './tooltip-manager.ts';
import { createElement } from '../element.ts';
import { MarkdownElement } from '../components/markdown.ts';

/** Border characters for tooltip (rounded style, with ASCII fallback) */
function getBorder() {
  const c = getBorderChars('rounded');
  return { topLeft: c.tl, topRight: c.tr, bottomLeft: c.bl, bottomRight: c.br, horizontal: c.h, vertical: c.v };
}
const BORDER = getBorder();

// Cached markdown element for tooltip rendering
let _cachedMarkdown: MarkdownElement | null = null;
let _cachedContent: string | null = null;

/**
 * Get or create a markdown element for tooltip content
 */
function getMarkdownElement(content: string): MarkdownElement {
  if (_cachedMarkdown && _cachedContent === content) {
    return _cachedMarkdown;
  }

  _cachedMarkdown = createElement('markdown', {
    text: content,
    wrap: true,
  }) as MarkdownElement;
  _cachedContent = content;

  return _cachedMarkdown;
}

/**
 * Calculate tooltip bounds based on content
 */
function calculateTooltipBounds(
  content: string,
  anchorX: number,
  anchorY: number,
  viewportWidth: number,
  viewportHeight: number,
  config: { maxWidth: number; minWidth: number; maxHeight: number }
): Bounds {
  // Calculate width first (needed for wrap estimation)
  const lines = content.split('\n');
  let maxLineWidth = 0;
  for (const line of lines) {
    if (line.length > maxLineWidth) {
      maxLineWidth = line.length;
    }
  }
  const width = Math.max(config.minWidth, Math.min(maxLineWidth + 4, config.maxWidth));
  const contentWidth = width - 4; // minus borders and padding

  // Estimate height accounting for text wrapping
  let estimatedLines = 0;
  for (const line of lines) {
    if (line.length === 0) {
      estimatedLines += 1; // empty line
    } else {
      // Estimate wrapped lines (ceil of line length / content width)
      estimatedLines += Math.ceil(line.length / contentWidth);
    }
  }

  // Calculate height with borders
  const height = Math.max(3, Math.min(estimatedLines + 2, config.maxHeight)); // +2 for top/bottom border

  // Position: prefer below and centered on anchor
  let x = anchorX - Math.floor(width / 2);
  let y = anchorY + 1; // 1 row below anchor

  // Clamp to viewport
  if (x < 0) x = 0;
  if (x + width > viewportWidth) x = viewportWidth - width;

  // If not enough room below, position above
  if (y + height > viewportHeight) {
    y = anchorY - height;
    if (y < 0) y = 0;
  }

  return { x, y, width, height };
}

/**
 * Render tooltip overlay directly to buffer.
 * Returns true if tooltip was rendered.
 */
export function renderTooltipOverlay(buffer: DualBuffer): boolean {
  const manager = getTooltipManager();
  const state = manager.getState();

  if (!state?.visible) {
    return false;
  }

  const config = manager.getConfig();
  const viewportWidth = buffer.width;
  const viewportHeight = buffer.height;

  const bounds = calculateTooltipBounds(
    state.content,
    state.anchorX,
    state.anchorY,
    viewportWidth,
    viewportHeight,
    config
  );

  renderTooltipBox(buffer, bounds, state.content);
  return true;
}

/**
 * Render the tooltip box with markdown content
 */
function renderTooltipBox(
  buffer: DualBuffer,
  bounds: Bounds,
  content: string
): void {
  const { x, y, width, height } = bounds;

  // Get theme colors
  const bgColor = getThemeColor('surface');
  const borderColor = getThemeColor('border');
  const textColor = getThemeColor('textPrimary');

  const baseStyle: Partial<Cell> = {
    background: bgColor,
    foreground: textColor,
  };

  const borderStyle: Partial<Cell> = {
    background: bgColor,
    foreground: borderColor,
  };

  // Draw background
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      buffer.currentBuffer.setCell(x + col, y + row, {
        char: ' ',
        width: 1,
        ...baseStyle,
      });
    }
  }

  // Draw border
  // Top
  buffer.currentBuffer.setCell(x, y, { char: BORDER.topLeft, width: 1, ...borderStyle });
  buffer.currentBuffer.setCell(x + width - 1, y, { char: BORDER.topRight, width: 1, ...borderStyle });
  for (let col = 1; col < width - 1; col++) {
    buffer.currentBuffer.setCell(x + col, y, { char: BORDER.horizontal, width: 1, ...borderStyle });
  }

  // Bottom
  buffer.currentBuffer.setCell(x, y + height - 1, { char: BORDER.bottomLeft, width: 1, ...borderStyle });
  buffer.currentBuffer.setCell(x + width - 1, y + height - 1, { char: BORDER.bottomRight, width: 1, ...borderStyle });
  for (let col = 1; col < width - 1; col++) {
    buffer.currentBuffer.setCell(x + col, y + height - 1, { char: BORDER.horizontal, width: 1, ...borderStyle });
  }

  // Sides
  for (let row = 1; row < height - 1; row++) {
    buffer.currentBuffer.setCell(x, y + row, { char: BORDER.vertical, width: 1, ...borderStyle });
    buffer.currentBuffer.setCell(x + width - 1, y + row, { char: BORDER.vertical, width: 1, ...borderStyle });
  }

  // Render markdown content inside the box
  const markdown = getMarkdownElement(content);
  const contentBounds: Bounds = {
    x: x + 2, // 1 border + 1 padding
    y: y + 1, // 1 border
    width: width - 4, // minus borders and padding
    height: height - 2, // minus top/bottom border
  };

  // Render markdown
  markdown.render(contentBounds, baseStyle, buffer, {
    buffer,
    style: baseStyle,
  });
}

/**
 * Check if coordinates are within tooltip bounds
 */
export function isPointInTooltip(screenX: number, screenY: number): boolean {
  const manager = getTooltipManager();
  const state = manager.getState();

  if (!state?.visible) {
    return false;
  }

  // Tooltips don't need click handling
  return false;
}
