// Canvas render ASCII mode - pattern and luma character rendering
// Extracted from canvas-render.ts for modularity

import { type DualBuffer, type Cell } from '../buffer.ts';
import { type Bounds } from '../types.ts';
import { TRANSPARENT, packRGBA, parseColor } from './color-utils.ts';
import { PATTERN_TO_ASCII, LUMA_RAMP } from './canvas-terminal.ts';
import type { CanvasRenderData } from './canvas-render-types.ts';

/**
 * ASCII mode rendering - converts canvas to ASCII characters.
 * Two modes:
 * - 'pattern': Maps 2x3 sextant patterns to spatially-similar ASCII chars
 * - 'luma': Maps pixel brightness to density character ramp
 */
export function renderAsciiMode(
  bounds: Bounds,
  style: Partial<Cell>,
  buffer: DualBuffer,
  terminalWidth: number,
  terminalHeight: number,
  mode: 'pattern' | 'luma',
  data: CanvasRenderData
): void {
  const bufW = data.bufferWidth;
  const bufH = data.bufferHeight;
  const scale = data.scale;
  const halfScale = scale >> 1;
  const hasStyleFg = style.foreground !== undefined;
  const hasStyleBg = style.background !== undefined;
  const propsBg = data.backgroundColor ? parseColor(data.backgroundColor) : undefined;

  for (let ty = 0; ty < terminalHeight; ty++) {
    const baseBufferY = ty * 3 * scale;

    for (let tx = 0; tx < terminalWidth; tx++) {
      const baseBufferX = tx * 2 * scale;

      if (mode === 'luma') {
        // Luminance mode: average brightness → density character
        let totalR = 0, totalG = 0, totalB = 0, count = 0;

        for (let py = 0; py < 3; py++) {
          const bufferY = baseBufferY + py * scale + halfScale;
          if (bufferY < 0 || bufferY >= bufH) continue;
          const rowOffset = bufferY * bufW;

          for (let px = 0; px < 2; px++) {
            const bufferX = baseBufferX + px * scale + halfScale;
            if (bufferX < 0 || bufferX >= bufW) continue;

            const bufIndex = rowOffset + bufferX;
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

        if (count === 0) continue;

        const avgR = totalR / count;
        const avgG = totalG / count;
        const avgB = totalB / count;
        // Perceptual luminance: 0.299*R + 0.587*G + 0.114*B
        const luma = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
        const charIndex = Math.floor((luma / 255) * (LUMA_RAMP.length - 1));
        const char = LUMA_RAMP[Math.min(charIndex, LUMA_RAMP.length - 1)];

        if (char === ' ') continue;

        const fgColor = packRGBA(Math.round(avgR), Math.round(avgG), Math.round(avgB), 255);
        buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
          char,
          foreground: fgColor ?? (hasStyleFg ? style.foreground : undefined),
          background: propsBg ?? (hasStyleBg ? style.background : undefined),
          bold: style.bold,
          dim: style.dim,
        });
      } else {
        // Pattern mode: use brightness thresholding to determine pattern
        // Similar to sextant quantization - bright pixels are "on", dark are "off"
        const colors: number[] = [0, 0, 0, 0, 0, 0];
        const brightness: number[] = [-1, -1, -1, -1, -1, -1];
        let minBright = 256, maxBright = -1;
        let validCount = 0;

        // Sample 2x3 grid - index matches bit position
        // Index: 0=top-left, 1=top-right, 2=mid-left, 3=mid-right, 4=bot-left, 5=bot-right
        const positions = [
          [0, 0], [1, 0],  // top row
          [0, 1], [1, 1],  // mid row
          [0, 2], [1, 2],  // bottom row
        ];

        for (let i = 0; i < 6; i++) {
          const [px, py] = positions[i];
          const bufferX = baseBufferX + px * scale + halfScale;
          const bufferY = baseBufferY + py * scale + halfScale;
          if (bufferX < 0 || bufferX >= bufW || bufferY < 0 || bufferY >= bufH) continue;

          const bufIndex = bufferY * bufW + bufferX;
          let color = data.colorBuffer[bufIndex];
          if (color === TRANSPARENT) {
            color = data.imageColorBuffer[bufIndex];
          }
          if (color !== TRANSPARENT) {
            colors[i] = color;
            const r = (color >> 24) & 0xFF;
            const g = (color >> 16) & 0xFF;
            const b = (color >> 8) & 0xFF;
            const bright = (r * 77 + g * 150 + b * 29) >> 8;
            brightness[i] = bright;
            if (bright < minBright) minBright = bright;
            if (bright > maxBright) maxBright = bright;
            validCount++;
          }
        }

        if (validCount === 0) continue;

        // Use brightness threshold to determine pattern
        const threshold = (minBright + maxBright) >> 1;
        let pattern = 0;
        let fgR = 0, fgG = 0, fgB = 0, fgCount = 0;

        // Bit positions: 5=top-left, 4=top-right, 3=mid-left, 2=mid-right, 1=bot-left, 0=bot-right
        const bitPos = [5, 4, 3, 2, 1, 0];
        for (let i = 0; i < 6; i++) {
          if (brightness[i] >= threshold) {
            pattern |= (1 << bitPos[i]);
            const color = colors[i];
            fgR += (color >> 24) & 0xFF;
            fgG += (color >> 16) & 0xFF;
            fgB += (color >> 8) & 0xFF;
            fgCount++;
          }
        }

        if (pattern === 0) continue;

        const char = PATTERN_TO_ASCII[pattern];
        if (char === ' ') continue;

        let fgColor: number | undefined;
        if (fgCount > 0) {
          fgColor = packRGBA(
            Math.round(fgR / fgCount),
            Math.round(fgG / fgCount),
            Math.round(fgB / fgCount),
            255
          );
        }

        buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
          char,
          foreground: fgColor ?? (hasStyleFg ? style.foreground : undefined),
          background: propsBg ?? (hasStyleBg ? style.background : undefined),
          bold: style.bold,
          dim: style.dim,
        });
      }
    }
  }
}
