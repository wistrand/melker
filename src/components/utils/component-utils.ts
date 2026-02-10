// Shared utilities for data components
import type { Element, Bounds } from '../../types.ts';
import { getLogger } from '../../logging.ts';
import { getCurrentTheme } from '../../theme.ts';

const logger = getLogger('ComponentUtils');

// ===== Text Formatting =====

export type CellValue = string | number | boolean | null | undefined;

export function formatValue(value: CellValue): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function truncateText(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return text.slice(0, width - 3) + '...';
}

export function alignText(text: string, width: number, align: 'left' | 'center' | 'right'): string {
  const padding = Math.max(0, width - text.length);
  if (padding === 0) return text.slice(0, width);

  switch (align) {
    case 'right':
      return ' '.repeat(padding) + text;
    case 'center': {
      const leftPad = Math.floor(padding / 2);
      const rightPad = padding - leftPad;
      return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
    }
    default:
      return text + ' '.repeat(padding);
  }
}

// ===== JSON Parsing =====

/**
 * Parse string props that should be JSON arrays/objects.
 * Mutates the props object in place.
 */
export function parseJsonProps(props: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    if (typeof props[key] === 'string') {
      try {
        props[key] = JSON.parse(props[key] as string);
      } catch (e) {
        logger.error(`Failed to parse ${key} JSON`, e instanceof Error ? e : new Error(String(e)));
      }
    }
  }
}

/**
 * Parse inline JSON data from text children.
 * Returns parsed object or null if no valid JSON found.
 */
export function parseInlineJsonData(children: Element[]): Record<string, unknown> | null {
  for (const child of children) {
    if (child.type === 'text') {
      const text = ((child.props as Record<string, unknown>).text as string || '').trim();
      if (text.startsWith('{')) {
        try {
          return JSON.parse(text);
        } catch (e) {
          logger.error('Failed to parse inline JSON data', e instanceof Error ? e : new Error(String(e)));
        }
      }
    }
  }
  return null;
}

// ===== Helpers =====

/**
 * Check if a point (x, y) is within the given bounds.
 */
export function boundsContain(x: number, y: number, bounds: Bounds): boolean {
  return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height;
}

/**
 * Check if the current theme is black-and-white mode.
 */
export function isBwMode(): boolean {
  return getCurrentTheme().type === 'bw';
}
