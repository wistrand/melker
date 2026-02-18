// Canvas render half-block mode - 1x2 pixels per terminal cell using ▀▄█
// Uses upper/lower half-block characters with fg+bg colors for 2x vertical resolution.
// Available on basic Unicode tier (TERM=linux) where sextant characters are not.

import { type DualBuffer, type Cell, EMPTY_CHAR } from '../buffer.ts';
import { type Bounds } from '../types.ts';
import { TRANSPARENT, parseColor } from './color-utils.ts';
import type { CanvasRenderData } from './canvas-render-types.ts';
import { getThemeManager } from '../theme.ts';
import { nearestColor16Plus, nearestSolid16, blendShadeChars } from '../color16-palette.ts';

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
  const use16Plus = getThemeManager().getColorSupport() === '16';

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
        const bg = propsBg ?? (hasStyleBg ? style.background : undefined);
        if (bg) {
          buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
            char: EMPTY_CHAR, background: bg, bold: style.bold, dim: style.dim,
          });
        }
        continue;
      }

      let char: string;
      let fg: number | undefined;
      let bg: number | undefined;

      if (use16Plus && upperOn && lowerOn) {
        // Color16+ adaptive rendering
        const upperR = (upperColor >> 24) & 0xFF, upperG = (upperColor >> 16) & 0xFF, upperB = (upperColor >> 8) & 0xFF;
        const lowerR = (lowerColor >> 24) & 0xFF, lowerG = (lowerColor >> 16) & 0xFF, lowerB = (lowerColor >> 8) & 0xFF;
        const upperEntry = nearestColor16Plus(upperR, upperG, upperB);
        const lowerEntry = nearestColor16Plus(lowerR, lowerG, lowerB);

        if (upperEntry.fgPacked === lowerEntry.fgPacked &&
            upperEntry.bgPacked === lowerEntry.bgPacked) {
          // B: same fg+bg pair — blend shade densities
          char = blendShadeChars(upperEntry.char, lowerEntry.char);
          fg = upperEntry.fgPacked;
          bg = upperEntry.bgPacked;
        } else {
          // A: different fg+bg — spatial ▀ with Oklab-matched solid colors
          char = UPPER_HALF;
          fg = nearestSolid16(upperR, upperG, upperB);
          bg = nearestSolid16(lowerR, lowerG, lowerB);
        }
      } else if (upperOn && lowerOn) {
        if (upperColor === lowerColor) {
          char = FULL_BLOCK;
          fg = upperColor;
          bg = propsBg ?? (hasStyleBg ? style.background : undefined);
        } else {
          char = UPPER_HALF;
          fg = upperColor;
          bg = lowerColor;
        }
      } else if (upperOn) {
        char = UPPER_HALF;
        fg = upperColor;
        bg = propsBg ?? (hasStyleBg ? style.background : undefined);
      } else {
        char = LOWER_HALF;
        fg = lowerColor;
        bg = propsBg ?? (hasStyleBg ? style.background : undefined);
      }

      buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
        char, foreground: fg, background: bg, bold: style.bold, dim: style.dim,
      });
    }
  }
}
