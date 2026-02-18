// Canvas render half-block mode - 1x2 pixels per terminal cell using ▀▄█
// Uses upper/lower half-block characters with fg+bg colors for 2x vertical resolution.
// Available on basic Unicode tier (TERM=linux) where sextant characters are not.

import { type DualBuffer, type Cell, EMPTY_CHAR } from '../buffer.ts';
import { type Bounds } from '../types.ts';
import { TRANSPARENT, packRGBA, parseColor } from './color-utils.ts';
import type { CanvasRenderData } from './canvas-render-types.ts';

// Half-block characters
const UPPER_HALF = '\u2580'; // ▀
const LOWER_HALF = '\u2584'; // ▄
const FULL_BLOCK = '\u2588'; // █

/**
 * Half-block mode rendering: 1x2 pixels per terminal cell.
 * Each cell uses ▀ (upper), ▄ (lower), █ (both), or space (neither)
 * with fg color for the "on" half and bg color for the other.
 */
export function renderHalfBlockMode(
  bounds: Bounds,
  style: Partial<Cell>,
  buffer: DualBuffer,
  terminalWidth: number,
  terminalHeight: number,
  data: CanvasRenderData
): void {
  const bufW = data.bufferWidth;
  const bufH = data.bufferHeight;
  const scale = data.scale;
  const halfScale = scale >> 1;
  const hasStyleBg = style.background !== undefined;
  const propsBg = data.backgroundColor ? parseColor(data.backgroundColor) : undefined;

  for (let ty = 0; ty < terminalHeight; ty++) {
    const upperY = ty * 2 * scale + halfScale;
    const lowerY = ty * 2 * scale + scale + halfScale;

    for (let tx = 0; tx < terminalWidth; tx++) {
      const bufferX = tx * 1 * scale + halfScale;

      // Sample upper pixel (composited: drawing layer over image layer)
      let upperColor = TRANSPARENT;
      if (bufferX >= 0 && bufferX < bufW && upperY >= 0 && upperY < bufH) {
        const idx = upperY * bufW + bufferX;
        upperColor = data.colorBuffer[idx];
        if (upperColor === TRANSPARENT) {
          upperColor = data.imageColorBuffer[idx];
        }
      }

      // Sample lower pixel
      let lowerColor = TRANSPARENT;
      if (bufferX >= 0 && bufferX < bufW && lowerY >= 0 && lowerY < bufH) {
        const idx = lowerY * bufW + bufferX;
        lowerColor = data.colorBuffer[idx];
        if (lowerColor === TRANSPARENT) {
          lowerColor = data.imageColorBuffer[idx];
        }
      }

      const upperOn = upperColor !== TRANSPARENT;
      const lowerOn = lowerColor !== TRANSPARENT;

      if (!upperOn && !lowerOn) {
        // Both transparent — fill with background if available
        const bg = propsBg ?? (hasStyleBg ? style.background : undefined);
        if (bg) {
          buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
            char: EMPTY_CHAR,
            background: bg,
            bold: style.bold,
            dim: style.dim,
          });
        }
        continue;
      }

      let char: string;
      let fg: number | undefined;
      let bg: number | undefined;

      if (upperOn && lowerOn) {
        if (upperColor === lowerColor) {
          // Both same color — full block
          char = FULL_BLOCK;
          fg = upperColor;
          bg = propsBg ?? (hasStyleBg ? style.background : undefined);
        } else {
          // Different colors — upper half as fg, lower half as bg
          char = UPPER_HALF;
          fg = upperColor;
          bg = lowerColor;
        }
      } else if (upperOn) {
        // Upper only
        char = UPPER_HALF;
        fg = upperColor;
        bg = propsBg ?? (hasStyleBg ? style.background : undefined);
      } else {
        // Lower only
        char = LOWER_HALF;
        fg = lowerColor;
        bg = propsBg ?? (hasStyleBg ? style.background : undefined);
      }

      buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
        char,
        foreground: fg,
        background: bg,
        bold: style.bold,
        dim: style.dim,
      });
    }
  }
}
