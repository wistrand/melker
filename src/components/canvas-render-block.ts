// Canvas render block mode - 1 colored space per terminal cell
// Extracted from canvas-render.ts for modularity

import { type DualBuffer, type Cell, EMPTY_CHAR } from '../buffer.ts';
import { type Bounds } from '../types.ts';
import { TRANSPARENT, packRGBA, parseColor } from './color-utils.ts';
import type { CanvasRenderData } from './canvas-render-types.ts';
import { getThemeManager } from '../theme.ts';
import { nearestColor16Plus } from '../color16-palette.ts';

/**
 * Block mode rendering: 1 colored space per terminal cell (no sextant characters)
 * Each cell shows averaged color from the corresponding 2x3 pixel region
 */
export function renderBlockMode(
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
    const baseBufferY = ty * 3 * scale;

    for (let tx = 0; tx < terminalWidth; tx++) {
      const baseBufferX = tx * 2 * scale;

      // Sample center pixel of 2x3 block and average colors
      let totalR = 0, totalG = 0, totalB = 0, count = 0;

      // Sample 6 pixels in 2x3 grid
      for (let py = 0; py < 3; py++) {
        const bufferY = baseBufferY + py * scale + halfScale;
        if (bufferY < 0 || bufferY >= bufH) continue;
        const rowOffset = bufferY * bufW;

        for (let px = 0; px < 2; px++) {
          const bufferX = baseBufferX + px * scale + halfScale;
          if (bufferX < 0 || bufferX >= bufW) continue;

          const bufIndex = rowOffset + bufferX;
          // Check drawing layer first, then image layer
          let color = data.colorBuffer[bufIndex];
          if (color === TRANSPARENT) {
            color = data.imageColorBuffer[bufIndex];
          }
          if (color !== TRANSPARENT) {
            totalR += (color >> 24) & 0xFF;
            totalG += (color >> 16) & 0xFF;
            totalB += (color >> 8) & 0xFF;
            count++;
          }
        }
      }

      if (count === 0) {
        const bg = propsBg ?? (hasStyleBg ? style.background : undefined);
        if (bg) {
          buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
            char: EMPTY_CHAR, background: bg, bold: style.bold, dim: style.dim,
          });
        }
        continue;
      }

      const avgR = Math.round(totalR / count);
      const avgG = Math.round(totalG / count);
      const avgB = Math.round(totalB / count);

      if (use16Plus) {
        // Color16+ palette: shade characters for ~80+ distinguishable colors
        const entry = nearestColor16Plus(avgR, avgG, avgB);
        buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
          char: entry.char,
          foreground: entry.fgPacked,
          background: entry.bgPacked,
          bold: style.bold,
          dim: style.dim,
        });
      } else {
        buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
          char: EMPTY_CHAR,
          background: packRGBA(avgR, avgG, avgB, 255),
          bold: style.bold,
          dim: style.dim,
        });
      }
    }
  }
}
