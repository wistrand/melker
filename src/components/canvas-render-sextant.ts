// Canvas render sextant - main sextant render path
// Extracted from canvas-render.ts for modularity

import { type DualBuffer, type Cell } from '../buffer.ts';
import { type Bounds } from '../types.ts';
import { TRANSPARENT, DEFAULT_FG, packRGBA, parseColor } from './color-utils.ts';
import { PIXEL_TO_CHAR } from './canvas-terminal.ts';
import type { CanvasRenderData, CanvasRenderState } from './canvas-render-types.ts';

/**
 * Quantize 6 colors into foreground/background groups for sextant rendering.
 * Uses median brightness split with averaged colors per group.
 * Results stored in state.qFgColor, state.qBgColor, and sextantPixels array.
 */
export function quantizeBlockColorsInline(
  colors: number[],
  sextantPixels: boolean[],
  state: CanvasRenderState
): void {
  // First pass: calculate brightness, find min/max, check if all same
  let validCount = 0;
  let totalBrightness = 0;
  let minBright = 1000, maxBright = -1;
  let firstColor = 0;
  let allSame = true;

  for (let i = 0; i < 6; i++) {
    const color = colors[i];
    sextantPixels[i] = false;
    if (color !== TRANSPARENT) {
      const r = (color >> 24) & 0xFF;
      const g = (color >> 16) & 0xFF;
      const b = (color >> 8) & 0xFF;
      const bright = (r * 77 + g * 150 + b * 29) >> 8;
      state.qBrightness[i] = bright;
      totalBrightness += bright;
      if (bright < minBright) minBright = bright;
      if (bright > maxBright) maxBright = bright;
      if (validCount === 0) {
        firstColor = color;
      } else if (color !== firstColor) {
        allSame = false;
      }
      validCount++;
    } else {
      state.qBrightness[i] = -1;
    }
  }

  if (validCount === 0) {
    state.qFgColor = 0;
    state.qBgColor = 0;
    return;
  }

  if (allSame) {
    for (let i = 0; i < 6; i++) {
      if (colors[i] !== TRANSPARENT) sextantPixels[i] = true;
    }
    state.qFgColor = firstColor;
    state.qBgColor = firstColor;
    return;
  }

  // Second pass: partition by threshold and accumulate color sums
  let threshold = (minBright + maxBright) >> 1;
  let fgR = 0, fgG = 0, fgB = 0, fgCount = 0;
  let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;

  for (let i = 0; i < 6; i++) {
    const bright = state.qBrightness[i];
    if (bright < 0) continue;

    const color = colors[i];
    const r = (color >> 24) & 0xFF;
    const g = (color >> 16) & 0xFF;
    const b = (color >> 8) & 0xFF;

    if (bright >= threshold) {
      sextantPixels[i] = true;
      fgR += r; fgG += g; fgB += b; fgCount++;
    } else {
      bgR += r; bgG += g; bgB += b; bgCount++;
    }
  }

  // If all went to one group, use mean brightness as threshold
  if (fgCount === 0 || bgCount === 0) {
    threshold = (totalBrightness / validCount) | 0;
    fgR = fgG = fgB = fgCount = 0;
    bgR = bgG = bgB = bgCount = 0;

    for (let i = 0; i < 6; i++) {
      const bright = state.qBrightness[i];
      if (bright < 0) continue;

      const color = colors[i];
      const r = (color >> 24) & 0xFF;
      const g = (color >> 16) & 0xFF;
      const b = (color >> 8) & 0xFF;

      if (bright >= threshold) {
        sextantPixels[i] = true;
        fgR += r; fgG += g; fgB += b; fgCount++;
      } else {
        sextantPixels[i] = false;
        bgR += r; bgG += g; bgB += b; bgCount++;
      }
    }
  }

  // Compute averaged colors
  if (fgCount > 0) {
    state.qFgColor = packRGBA(
      (fgR / fgCount) | 0,
      (fgG / fgCount) | 0,
      (fgB / fgCount) | 0,
      255
    );
  } else {
    state.qFgColor = 0;
  }

  if (bgCount > 0) {
    state.qBgColor = packRGBA(
      (bgR / bgCount) | 0,
      (bgG / bgCount) | 0,
      (bgB / bgCount) | 0,
      255
    );
  } else {
    state.qBgColor = 0;
  }

  // Fallback: if one group empty, use the other's color for both
  if (state.qFgColor === 0 && state.qBgColor !== 0) {
    state.qFgColor = state.qBgColor;
  } else if (state.qBgColor === 0 && state.qFgColor !== 0) {
    state.qBgColor = state.qFgColor;
  }
}

/**
 * Main sextant render path - converts pixel buffers to terminal sextant characters.
 * Handles compositing of drawing and image layers with optimized hot path.
 */
export function renderSextantToTerminal(
  bounds: Bounds,
  style: Partial<Cell>,
  buffer: DualBuffer,
  data: CanvasRenderData,
  state: CanvasRenderState
): void {
  let terminalWidth = Math.min(data.propsWidth, bounds.width);
  const terminalHeight = Math.min(data.propsHeight, bounds.height);
  const bufW = data.bufferWidth;
  const bufH = data.bufferHeight;
  const scale = data.scale;
  const halfScale = scale >> 1;

  // Workaround for terminal edge rendering glitch:
  // When canvas extends to the exact right edge of the terminal, some terminals
  // have issues with sextant characters in the last column (autowrap, width calculation).
  // Skip the last column when we're at the terminal edge to avoid visual artifacts.
  const engine = globalThis.melkerEngine;
  if (engine && bounds.x + terminalWidth >= engine.terminalSize?.width) {
    terminalWidth = Math.max(1, terminalWidth - 1);
  }

  // Use pre-allocated arrays
  const drawingPixels = state.drawingPixels;
  const drawingColors = state.drawingColors;
  const imagePixels = state.imagePixels;
  const imageColors = state.imageColors;
  const sextantPixels = state.sextantPixels;
  const compositePixels = state.compositePixels;
  const compositeColors = state.compositeColors;
  const isDrawing = state.isDrawing;

  // Pre-compute base style properties
  const hasStyleFg = style.foreground !== undefined;
  const hasStyleBg = style.background !== undefined;
  const propsBg = data.backgroundColor ? parseColor(data.backgroundColor) : undefined;

  for (let ty = 0; ty < terminalHeight; ty++) {
    const baseBufferY = ty * 3 * scale;

    for (let tx = 0; tx < terminalWidth; tx++) {
      const baseBufferX = tx * 2 * scale;

      // Sample 2x3 block - track drawing and image layers separately
      // Unrolled for performance (avoid nested loop overhead)
      let hasDrawingOn = false;
      let hasImageOn = false;

      // Row 0
      {
        const bufferY = baseBufferY + halfScale;
        const rowOffset = bufferY * bufW;

        // Pixel (0,0)
        const bufferX0 = baseBufferX + halfScale;
        if (bufferX0 >= 0 && bufferX0 < bufW && bufferY >= 0 && bufferY < bufH) {
          const bufIndex = rowOffset + bufferX0;
          drawingColors[0] = data.colorBuffer[bufIndex];
          drawingPixels[0] = drawingColors[0] !== TRANSPARENT;
          imageColors[0] = data.imageColorBuffer[bufIndex];
          imagePixels[0] = imageColors[0] !== TRANSPARENT;
        } else {
          drawingPixels[0] = false;
          drawingColors[0] = TRANSPARENT;
          imagePixels[0] = false;
          imageColors[0] = TRANSPARENT;
        }
        if (drawingPixels[0] && drawingColors[0] !== TRANSPARENT && drawingColors[0] !== DEFAULT_FG) hasDrawingOn = true;
        if (imagePixels[0] && imageColors[0] !== TRANSPARENT) hasImageOn = true;

        // Pixel (1,0)
        const bufferX1 = baseBufferX + scale + halfScale;
        if (bufferX1 >= 0 && bufferX1 < bufW && bufferY >= 0 && bufferY < bufH) {
          const bufIndex = rowOffset + bufferX1;
          drawingColors[1] = data.colorBuffer[bufIndex];
          drawingPixels[1] = drawingColors[1] !== TRANSPARENT;
          imageColors[1] = data.imageColorBuffer[bufIndex];
          imagePixels[1] = imageColors[1] !== TRANSPARENT;
        } else {
          drawingPixels[1] = false;
          drawingColors[1] = TRANSPARENT;
          imagePixels[1] = false;
          imageColors[1] = TRANSPARENT;
        }
        if (drawingPixels[1] && drawingColors[1] !== TRANSPARENT && drawingColors[1] !== DEFAULT_FG) hasDrawingOn = true;
        if (imagePixels[1] && imageColors[1] !== TRANSPARENT) hasImageOn = true;
      }

      // Row 1
      {
        const bufferY = baseBufferY + scale + halfScale;
        const rowOffset = bufferY * bufW;

        // Pixel (0,1)
        const bufferX0 = baseBufferX + halfScale;
        if (bufferX0 >= 0 && bufferX0 < bufW && bufferY >= 0 && bufferY < bufH) {
          const bufIndex = rowOffset + bufferX0;
          drawingColors[2] = data.colorBuffer[bufIndex];
          drawingPixels[2] = drawingColors[2] !== TRANSPARENT;
          imageColors[2] = data.imageColorBuffer[bufIndex];
          imagePixels[2] = imageColors[2] !== TRANSPARENT;
        } else {
          drawingPixels[2] = false;
          drawingColors[2] = TRANSPARENT;
          imagePixels[2] = false;
          imageColors[2] = TRANSPARENT;
        }
        if (drawingPixels[2] && drawingColors[2] !== TRANSPARENT && drawingColors[2] !== DEFAULT_FG) hasDrawingOn = true;
        if (imagePixels[2] && imageColors[2] !== TRANSPARENT) hasImageOn = true;

        // Pixel (1,1)
        const bufferX1 = baseBufferX + scale + halfScale;
        if (bufferX1 >= 0 && bufferX1 < bufW && bufferY >= 0 && bufferY < bufH) {
          const bufIndex = rowOffset + bufferX1;
          drawingColors[3] = data.colorBuffer[bufIndex];
          drawingPixels[3] = drawingColors[3] !== TRANSPARENT;
          imageColors[3] = data.imageColorBuffer[bufIndex];
          imagePixels[3] = imageColors[3] !== TRANSPARENT;
        } else {
          drawingPixels[3] = false;
          drawingColors[3] = TRANSPARENT;
          imagePixels[3] = false;
          imageColors[3] = TRANSPARENT;
        }
        if (drawingPixels[3] && drawingColors[3] !== TRANSPARENT && drawingColors[3] !== DEFAULT_FG) hasDrawingOn = true;
        if (imagePixels[3] && imageColors[3] !== TRANSPARENT) hasImageOn = true;
      }

      // Row 2
      {
        const bufferY = baseBufferY + 2 * scale + halfScale;
        const rowOffset = bufferY * bufW;

        // Pixel (0,2)
        const bufferX0 = baseBufferX + halfScale;
        if (bufferX0 >= 0 && bufferX0 < bufW && bufferY >= 0 && bufferY < bufH) {
          const bufIndex = rowOffset + bufferX0;
          drawingColors[4] = data.colorBuffer[bufIndex];
          drawingPixels[4] = drawingColors[4] !== TRANSPARENT;
          imageColors[4] = data.imageColorBuffer[bufIndex];
          imagePixels[4] = imageColors[4] !== TRANSPARENT;
        } else {
          drawingPixels[4] = false;
          drawingColors[4] = TRANSPARENT;
          imagePixels[4] = false;
          imageColors[4] = TRANSPARENT;
        }
        if (drawingPixels[4] && drawingColors[4] !== TRANSPARENT && drawingColors[4] !== DEFAULT_FG) hasDrawingOn = true;
        if (imagePixels[4] && imageColors[4] !== TRANSPARENT) hasImageOn = true;

        // Pixel (1,2)
        const bufferX1 = baseBufferX + scale + halfScale;
        if (bufferX1 >= 0 && bufferX1 < bufW && bufferY >= 0 && bufferY < bufH) {
          const bufIndex = rowOffset + bufferX1;
          drawingColors[5] = data.colorBuffer[bufIndex];
          drawingPixels[5] = drawingColors[5] !== TRANSPARENT;
          imageColors[5] = data.imageColorBuffer[bufIndex];
          imagePixels[5] = imageColors[5] !== TRANSPARENT;
        } else {
          drawingPixels[5] = false;
          drawingColors[5] = TRANSPARENT;
          imagePixels[5] = false;
          imageColors[5] = TRANSPARENT;
        }
        if (drawingPixels[5] && drawingColors[5] !== TRANSPARENT && drawingColors[5] !== DEFAULT_FG) hasDrawingOn = true;
        if (imagePixels[5] && imageColors[5] !== TRANSPARENT) hasImageOn = true;
      }

      let fgColor: number | undefined;
      let bgColor: number | undefined;

      if (hasDrawingOn && hasImageOn) {
        // Two-color optimization: drawing as fg, image as bg
        // Compute sextant pattern and find dominant colors inline
        let fgColorVal = 0;
        let bgColorVal = 0;

        for (let i = 0; i < 6; i++) {
          const isOn = drawingPixels[i] && drawingColors[i] !== TRANSPARENT && drawingColors[i] !== DEFAULT_FG;
          sextantPixels[i] = isOn;
          if (isOn && fgColorVal === 0) {
            fgColorVal = drawingColors[i];
          }
          if (imagePixels[i] && imageColors[i] !== TRANSPARENT && bgColorVal === 0) {
            bgColorVal = imageColors[i];
          }
        }

        if (fgColorVal !== 0) fgColor = fgColorVal;
        if (bgColorVal !== 0) bgColor = bgColorVal;

      } else if (hasImageOn && !hasDrawingOn) {
        // Image-only block: use color quantization for sextant detail
        quantizeBlockColorsInline(imageColors, sextantPixels, state);
        fgColor = state.qFgColor !== 0 ? state.qFgColor : undefined;
        bgColor = state.qBgColor !== 0 ? state.qBgColor : undefined;

      } else {
        // Standard compositing: drawing on top of image
        let fgColorVal = 0;
        let bgColorVal = 0;

        for (let i = 0; i < 6; i++) {
          if (drawingPixels[i] || (drawingColors[i] !== TRANSPARENT && drawingColors[i] !== DEFAULT_FG)) {
            compositePixels[i] = drawingPixels[i];
            compositeColors[i] = drawingColors[i];
            isDrawing[i] = true;
          } else {
            compositePixels[i] = imagePixels[i];
            compositeColors[i] = imageColors[i];
            isDrawing[i] = false;
          }
          sextantPixels[i] = compositePixels[i];

          // Find dominant colors inline
          const color = compositeColors[i];
          if (compositePixels[i]) {
            if (color !== TRANSPARENT && color !== DEFAULT_FG && fgColorVal === 0) {
              fgColorVal = color;
            }
          } else {
            if (color !== TRANSPARENT && bgColorVal === 0) {
              bgColorVal = color;
            }
          }
        }

        if (fgColorVal !== 0) fgColor = fgColorVal;
        if (bgColorVal !== 0) bgColor = bgColorVal;
      }

      // Convert pixels to sextant character
      // Sextant bit pattern: bit 0 = bottom-right[5], bit 1 = bottom-left[4],
      //                      bit 2 = middle-right[3], bit 3 = middle-left[2],
      //                      bit 4 = top-right[1], bit 5 = top-left[0]
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
