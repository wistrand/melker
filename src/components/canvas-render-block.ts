// Canvas render block mode - 1 colored space per terminal cell
// Extracted from canvas-render.ts for modularity

import { type DualBuffer, type Cell, EMPTY_CHAR } from '../buffer.ts';
import { type Bounds } from '../types.ts';
import { TRANSPARENT, packRGBA, parseColor } from './color-utils.ts';
import type { CanvasRenderData } from './canvas-render-types.ts';

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

      // Determine background color
      let bgColor: number | undefined;
      if (count > 0) {
        const avgR = Math.round(totalR / count);
        const avgG = Math.round(totalG / count);
        const avgB = Math.round(totalB / count);
        bgColor = packRGBA(avgR, avgG, avgB, 255);
      } else {
        bgColor = propsBg ?? (hasStyleBg ? style.background : undefined);
      }

      // Skip empty cells with no background
      if (!bgColor) continue;

      buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
        char: EMPTY_CHAR,
        background: bgColor,
        bold: style.bold,
        dim: style.dim,
      });
    }
  }
}
