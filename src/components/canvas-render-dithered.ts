// Canvas render dithered - renders from pre-dithered buffer to terminal
// Extracted from canvas-render.ts for modularity

import { type DualBuffer, type Cell, EMPTY_CHAR } from '../buffer.ts';
import { type Bounds } from '../types.ts';
import { TRANSPARENT, packRGBA, parseColor } from './color-utils.ts';
import { PIXEL_TO_CHAR, PATTERN_TO_ASCII, LUMA_RAMP } from './canvas-terminal.ts';
import type { CanvasRenderData, CanvasRenderState, ResolvedGfxMode } from './canvas-render-types.ts';
import { quantizeBlockColorsInline } from './canvas-render-sextant.ts';
import { getThemeManager } from '../theme.ts';
import { nearestColor16Plus, nearestSolid16, blendShadeChars } from '../color16-palette.ts';

/**
 * Render from dithered buffer to terminal.
 * Uses the pre-composited and dithered RGBA buffer for output.
 */
export function renderDitheredToTerminal(
  bounds: Bounds,
  style: Partial<Cell>,
  buffer: DualBuffer,
  ditheredBuffer: Uint8Array,
  gfxMode: ResolvedGfxMode,
  data: CanvasRenderData,
  state: CanvasRenderState
): void {
  let terminalWidth = Math.min(data.propsWidth, bounds.width);
  const terminalHeight = Math.min(data.propsHeight, bounds.height);
  const bufW = data.bufferWidth;
  const bufH = data.bufferHeight;
  const scale = data.scale;
  const halfScale = scale >> 1;

  // Workaround for terminal edge rendering glitch (same as non-dithered path)
  const engine = globalThis.melkerEngine;
  if (engine && bounds.x + terminalWidth >= engine.terminalSize?.width) {
    terminalWidth = Math.max(1, terminalWidth - 1);
  }

  // Use pre-allocated arrays
  const sextantPixels = state.sextantPixels;
  const sextantColors = state.compositeColors;

  // Pre-compute base style properties
  const hasStyleFg = style.foreground !== undefined;
  const hasStyleBg = style.background !== undefined;
  const propsBg = data.backgroundColor ? parseColor(data.backgroundColor) : undefined;
  const use16Plus = getThemeManager().getColorSupport() === '16';

  // Half-block dithered path: 1x2 pixels per cell
  if (gfxMode === 'halfblock') {
    for (let ty = 0; ty < terminalHeight; ty++) {
      const baseBufferY = ty * 2 * scale;
      for (let tx = 0; tx < terminalWidth; tx++) {
        const bufferX = tx * 1 * scale + halfScale;
        const upperY = baseBufferY + halfScale;
        const lowerY = baseBufferY + scale + halfScale;

        let upperColor = TRANSPARENT;
        let lowerColor = TRANSPARENT;

        if (bufferX >= 0 && bufferX < bufW && upperY >= 0 && upperY < bufH) {
          const rgbaIdx = (upperY * bufW + bufferX) * 4;
          const a = ditheredBuffer[rgbaIdx + 3];
          if (a >= 128) {
            upperColor = packRGBA(ditheredBuffer[rgbaIdx], ditheredBuffer[rgbaIdx + 1], ditheredBuffer[rgbaIdx + 2], a);
          }
        }
        if (bufferX >= 0 && bufferX < bufW && lowerY >= 0 && lowerY < bufH) {
          const rgbaIdx = (lowerY * bufW + bufferX) * 4;
          const a = ditheredBuffer[rgbaIdx + 3];
          if (a >= 128) {
            lowerColor = packRGBA(ditheredBuffer[rgbaIdx], ditheredBuffer[rgbaIdx + 1], ditheredBuffer[rgbaIdx + 2], a);
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
          const uR = (upperColor >> 24) & 0xFF, uG = (upperColor >> 16) & 0xFF, uB = (upperColor >> 8) & 0xFF;
          const lR = (lowerColor >> 24) & 0xFF, lG = (lowerColor >> 16) & 0xFF, lB = (lowerColor >> 8) & 0xFF;
          const upperEntry = nearestColor16Plus(uR, uG, uB);
          const lowerEntry = nearestColor16Plus(lR, lG, lB);

          if (upperEntry.fgPacked === lowerEntry.fgPacked &&
              upperEntry.bgPacked === lowerEntry.bgPacked) {
            // B: same fg+bg pair — blend shade densities
            char = blendShadeChars(upperEntry.char, lowerEntry.char);
            fg = upperEntry.fgPacked;
            bg = upperEntry.bgPacked;
          } else {
            // A: different fg+bg — spatial ▀ with Oklab-matched solid colors
            char = '\u2580';
            fg = nearestSolid16(uR, uG, uB);
            bg = nearestSolid16(lR, lG, lB);
          }
        } else if (upperOn && lowerOn) {
          if (upperColor === lowerColor) {
            char = '\u2588'; fg = upperColor;
            bg = propsBg ?? (hasStyleBg ? style.background : undefined);
          } else {
            char = '\u2580'; fg = upperColor; bg = lowerColor;
          }
        } else if (upperOn) {
          char = '\u2580'; fg = upperColor;
          bg = propsBg ?? (hasStyleBg ? style.background : undefined);
        } else {
          char = '\u2584'; fg = lowerColor;
          bg = propsBg ?? (hasStyleBg ? style.background : undefined);
        }

        buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
          char, foreground: fg, background: bg, bold: style.bold, dim: style.dim,
        });
      }
    }
    return;
  }

  for (let ty = 0; ty < terminalHeight; ty++) {
    const baseBufferY = ty * 3 * scale;

    for (let tx = 0; tx < terminalWidth; tx++) {
      const baseBufferX = tx * 2 * scale;

      // Sample 2x3 block from dithered buffer
      // The positions match the non-dithered path sampling
      const positions = [
        // Row 0: (0,0), (1,0)
        { x: baseBufferX + halfScale, y: baseBufferY + halfScale },
        { x: baseBufferX + scale + halfScale, y: baseBufferY + halfScale },
        // Row 1: (0,1), (1,1)
        { x: baseBufferX + halfScale, y: baseBufferY + scale + halfScale },
        { x: baseBufferX + scale + halfScale, y: baseBufferY + scale + halfScale },
        // Row 2: (0,2), (1,2)
        { x: baseBufferX + halfScale, y: baseBufferY + 2 * scale + halfScale },
        { x: baseBufferX + scale + halfScale, y: baseBufferY + 2 * scale + halfScale },
      ];

      let hasAnyPixel = false;

      for (let i = 0; i < 6; i++) {
        const pos = positions[i];
        if (pos.x >= 0 && pos.x < bufW && pos.y >= 0 && pos.y < bufH) {
          const bufIndex = pos.y * bufW + pos.x;
          const rgbaIdx = bufIndex * 4;
          const r = ditheredBuffer[rgbaIdx];
          const g = ditheredBuffer[rgbaIdx + 1];
          const b = ditheredBuffer[rgbaIdx + 2];
          const a = ditheredBuffer[rgbaIdx + 3];

          // Consider pixel "on" if not fully transparent
          // Note: black pixels are valid colors for dithering, don't treat as "off"
          const isOn = a >= 128;
          sextantPixels[i] = isOn;
          sextantColors[i] = isOn ? packRGBA(r, g, b, a) : TRANSPARENT;
          if (isOn) hasAnyPixel = true;
        } else {
          sextantPixels[i] = false;
          sextantColors[i] = TRANSPARENT;
        }
      }

      // Block mode: average colors and output colored space (or shade char on 16-color)
      if (gfxMode === 'block') {
        if (!hasAnyPixel) continue;

        // Average all non-transparent colors
        let totalR = 0, totalG = 0, totalB = 0, count = 0;
        for (let i = 0; i < 6; i++) {
          const color = sextantColors[i];
          if (color !== TRANSPARENT) {
            totalR += (color >> 24) & 0xFF;
            totalG += (color >> 16) & 0xFF;
            totalB += (color >> 8) & 0xFF;
            count++;
          }
        }

        if (count === 0) continue;

        const avgR = Math.round(totalR / count);
        const avgG = Math.round(totalG / count);
        const avgB = Math.round(totalB / count);

        if (use16Plus) {
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
        continue;
      }

      // ASCII mode: convert dithered pixels to ASCII characters
      if (gfxMode === 'pattern' || gfxMode === 'luma') {
        if (!hasAnyPixel) continue;

        let char: string;
        let fgColor: number | undefined;

        if (gfxMode === 'luma') {
          // Luminance mode: average brightness → density character
          let totalR = 0, totalG = 0, totalB = 0, count = 0;
          for (let i = 0; i < 6; i++) {
            const color = sextantColors[i];
            if (color !== TRANSPARENT) {
              totalR += (color >> 24) & 0xFF;
              totalG += (color >> 16) & 0xFF;
              totalB += (color >> 8) & 0xFF;
              count++;
            }
          }
          if (count === 0) continue;

          const avgR = totalR / count;
          const avgG = totalG / count;
          const avgB = totalB / count;
          const luma = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
          const charIndex = Math.floor((luma / 255) * (LUMA_RAMP.length - 1));
          char = LUMA_RAMP[Math.min(charIndex, LUMA_RAMP.length - 1)];
          fgColor = packRGBA(Math.round(avgR), Math.round(avgG), Math.round(avgB), 255);
        } else {
          // Pattern mode: use brightness thresholding
          const brightness: number[] = [-1, -1, -1, -1, -1, -1];
          let minBright = 256, maxBright = -1;
          let validCount = 0;

          for (let i = 0; i < 6; i++) {
            const color = sextantColors[i];
            if (color !== TRANSPARENT) {
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

          // Threshold and build pattern
          const threshold = (minBright + maxBright) >> 1;
          let pattern = 0;
          let fgR = 0, fgG = 0, fgB = 0, fgCount = 0;

          // Bit positions: 5=top-left, 4=top-right, 3=mid-left, 2=mid-right, 1=bot-left, 0=bot-right
          const bitPos = [5, 4, 3, 2, 1, 0];
          for (let i = 0; i < 6; i++) {
            if (brightness[i] >= threshold) {
              pattern |= (1 << bitPos[i]);
              const color = sextantColors[i];
              fgR += (color >> 24) & 0xFF;
              fgG += (color >> 16) & 0xFF;
              fgB += (color >> 8) & 0xFF;
              fgCount++;
            }
          }

          if (pattern === 0) continue;
          char = PATTERN_TO_ASCII[pattern];
          if (fgCount > 0) {
            fgColor = packRGBA(Math.round(fgR / fgCount), Math.round(fgG / fgCount), Math.round(fgB / fgCount), 255);
          }
        }

        if (char === ' ') continue;

        buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
          char,
          foreground: fgColor ?? (hasStyleFg ? style.foreground : undefined),
          background: propsBg ?? (hasStyleBg ? style.background : undefined),
          bold: style.bold,
          dim: style.dim,
        });
        continue;
      }

      // Use quantization for color selection (same as image path)
      quantizeBlockColorsInline(sextantColors, sextantPixels, state);
      const fgColor = state.qFgColor !== 0 ? state.qFgColor : undefined;
      const bgColor = state.qBgColor !== 0 ? state.qBgColor : undefined;

      // Convert pixels to sextant character
      const pattern = (sextantPixels[5] ? 0b000001 : 0) |
                     (sextantPixels[4] ? 0b000010 : 0) |
                     (sextantPixels[3] ? 0b000100 : 0) |
                     (sextantPixels[2] ? 0b001000 : 0) |
                     (sextantPixels[1] ? 0b010000 : 0) |
                     (sextantPixels[0] ? 0b100000 : 0);
      const char = PIXEL_TO_CHAR[pattern];

      // Skip empty cells with no background
      if (char === ' ' && bgColor === undefined && !propsBg) {
        continue;
      }

      // Reuse cell style object to avoid allocation
      const cellStyle = state.cellStyle;
      cellStyle.foreground = fgColor ?? (hasStyleFg ? style.foreground : undefined);
      cellStyle.background = bgColor ?? propsBg ?? (hasStyleBg ? style.background : undefined);
      cellStyle.bold = style.bold;
      cellStyle.dim = style.dim;
      cellStyle.italic = style.italic;
      cellStyle.underline = style.underline;

      buffer.currentBuffer.setText(
        bounds.x + tx,
        bounds.y + ty,
        char,
        cellStyle
      );
    }
  }
}
