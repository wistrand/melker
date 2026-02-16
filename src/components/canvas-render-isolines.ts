// Canvas render isolines - contour line rendering using marching squares
// Extracted from canvas-render.ts for modularity

import { type DualBuffer, type Cell, EMPTY_CHAR } from '../buffer.ts';
import { type Bounds } from '../types.ts';
import { TRANSPARENT, packRGBA, parseColor } from './color-utils.ts';
import { MelkerConfig } from '../config/mod.ts';
import {
  type Isoline, type IsolineMode, type IsolineSource, type IsolineFill, type IsolineColor,
  getMarchingSquaresChar, getMarchingSquaresCase,
  generateIsolines, getScalarFromColor,
} from '../isoline.ts';
import type { CanvasRenderData } from './canvas-render-types.ts';

/**
 * Isoline rendering props for renderIsolinesToTerminal
 */
export interface IsolineRenderProps {
  isolineCount?: number;
  isolineMode?: IsolineMode;
  isolines?: Isoline[];
  isolineSource?: IsolineSource;
  isolineFill?: IsolineFill;
  isolineColor?: IsolineColor;
}

/**
 * Isolines mode rendering - renders contour lines using marching squares algorithm.
 * Output is exactly propsWidth × propsHeight terminal cells with box-drawing chars.
 */
export function renderIsolinesToTerminal(
  bounds: Bounds,
  style: Partial<Cell>,
  buffer: DualBuffer,
  data: CanvasRenderData,
  props: IsolineRenderProps,
  filled: boolean
): void {
  const config = MelkerConfig.get();
  let terminalWidth = Math.min(data.propsWidth, bounds.width);
  const terminalHeight = Math.min(data.propsHeight, bounds.height);

  // Workaround for terminal edge rendering glitch
  const engine = globalThis.melkerEngine;
  if (engine && bounds.x + terminalWidth >= engine.terminalSize?.width) {
    terminalWidth = Math.max(1, terminalWidth - 1);
  }

  const pixelsPerCellX = 2 * data.scale;
  const pixelsPerCellY = 3 * data.scale;

  // Get isoline source channel (oklab perceptual lightness is default)
  const source: IsolineSource = props.isolineSource ?? config.isolineSource ?? 'oklab';
  const fillMode: IsolineFill = props.isolineFill ?? config.isolineFill ?? 'source';
  const isolineColorVal = props.isolineColor ?? config.isolineColor ?? '';
  const isIsolineNone = isolineColorVal === 'none';
  const isIsolineAuto = isolineColorVal === 'auto';
  // Precompute static fg color for non-special isolineColor values
  const staticIsolineFg = (!isIsolineNone && !isIsolineAuto && isolineColorVal)
    ? parseColor(isolineColorVal) : undefined;

  // Sub-cell sampling: sample at higher resolution to catch thin features
  // subSample=2 means 2×2 sub-cells per terminal cell (3×3 sample points per cell)
  const subSample = 2;
  const subPixelsX = pixelsPerCellX / subSample;
  const subPixelsY = pixelsPerCellY / subSample;

  // Area averaging: sample a region around each grid point instead of single pixel
  // This helps thin lines contribute to neighboring sample points
  const avgRadius = 1; // 3×3 area (radius 1 = 1 pixel in each direction)

  // Build scalar grid at sub-cell resolution
  // Grid is (terminalWidth * subSample + 1) × (terminalHeight * subSample + 1)
  const gridWidth = terminalWidth * subSample + 1;
  const gridHeight = terminalHeight * subSample + 1;

  // When color-mean fill or auto contour color needs band colors, accumulate
  // averaged colors per grid point during the scalar grid build pass
  const needBandColors = (filled || isIsolineAuto) && fillMode === 'color-mean';
  const gridColors: Uint32Array | null = needBandColors ? new Uint32Array(gridWidth * gridHeight) : null;

  // Helper to get scalar with area averaging
  // When gridColors is non-null, also stores the area-averaged color at gridIdx
  const getAveragedScalar = (centerX: number, centerY: number, gridIdx: number): number => {
    let sum = 0;
    let count = 0;
    let totalR = 0, totalG = 0, totalB = 0;

    for (let dy = -avgRadius; dy <= avgRadius; dy++) {
      for (let dx = -avgRadius; dx <= avgRadius; dx++) {
        const px = Math.max(0, Math.min(centerX + dx, data.bufferWidth - 1));
        const py = Math.max(0, Math.min(centerY + dy, data.bufferHeight - 1));

        // Composite drawing layer over image layer
        let color = data.colorBuffer[py * data.bufferWidth + px];
        if (color === TRANSPARENT) {
          color = data.imageColorBuffer[py * data.bufferWidth + px];
        }

        if (color !== TRANSPARENT) {
          sum += getScalarFromColor(color, source);
          if (gridColors) {
            totalR += (color >> 24) & 0xFF;
            totalG += (color >> 16) & 0xFF;
            totalB += (color >> 8) & 0xFF;
          }
          count++;
        }
      }
    }

    if (gridColors && count > 0) {
      gridColors[gridIdx] = packRGBA(
        Math.round(totalR / count),
        Math.round(totalG / count),
        Math.round(totalB / count),
        255
      );
    }

    return count > 0 ? sum / count : 0;
  };
  const scalarGrid: number[][] = [];

  let minVal = Infinity;
  let maxVal = -Infinity;
  const allValues: number[] = [];

  for (let gy = 0; gy < gridHeight; gy++) {
    const row: number[] = [];
    for (let gx = 0; gx < gridWidth; gx++) {
      const pixelX = Math.min(Math.floor(gx * subPixelsX), data.bufferWidth - 1);
      const pixelY = Math.min(Math.floor(gy * subPixelsY), data.bufferHeight - 1);

      const scalar = getAveragedScalar(pixelX, pixelY, gy * gridWidth + gx);
      row.push(scalar);

      if (scalar < minVal) minVal = scalar;
      if (scalar > maxVal) maxVal = scalar;
      allValues.push(scalar);
    }
    scalarGrid.push(row);
  }

  // Handle edge case: no data
  if (minVal === Infinity) {
    minVal = 0;
    maxVal = 255;
  }

  // Generate isoline thresholds
  const isolineCount = props.isolineCount ?? config.isolineCount ?? 5;
  const isolineMode: IsolineMode = props.isolineMode ?? config.isolineMode ?? 'equal';
  const isolines = props.isolines ?? generateIsolines(minVal, maxVal, isolineCount, isolineMode, allValues);

  // Pre-compute fill colors for filled mode
  const midThreshold = isolines.length > 0
    ? isolines[Math.floor(isolines.length / 2)]?.value ?? ((minVal + maxVal) / 2)
    : (minVal + maxVal) / 2;

  // Compute mean color per isoline band for 'color-mean' fill mode
  // Uses the color grid accumulated during scalar grid build (no separate pixel pass)
  let bandColors: (number | undefined)[] | null = null;
  if (gridColors && isolines.length > 0) {
    const bandCount = isolines.length + 1;
    const bandR = new Float64Array(bandCount);
    const bandG = new Float64Array(bandCount);
    const bandB = new Float64Array(bandCount);
    const bandN = new Uint32Array(bandCount);

    // Classify grid points into bands using already-computed scalars and colors
    for (let gy = 0; gy < gridHeight; gy++) {
      for (let gx = 0; gx < gridWidth; gx++) {
        const color = gridColors[gy * gridWidth + gx];
        if (color === 0) continue; // unset (transparent area)

        const scalar = scalarGrid[gy][gx];
        let band = isolines.length;
        for (let i = 0; i < isolines.length; i++) {
          if (scalar < isolines[i].value) { band = i; break; }
        }

        bandR[band] += (color >> 24) & 0xFF;
        bandG[band] += (color >> 16) & 0xFF;
        bandB[band] += (color >> 8) & 0xFF;
        bandN[band]++;
      }
    }

    bandColors = [];
    for (let i = 0; i < bandCount; i++) {
      if (bandN[i] > 0) {
        bandColors.push(packRGBA(
          Math.round(bandR[i] / bandN[i]),
          Math.round(bandG[i] / bandN[i]),
          Math.round(bandB[i] / bandN[i]),
          255
        ));
      } else {
        bandColors.push(undefined);
      }
    }
  }

  // Get theme colors for fill
  const hasStyleFg = style.foreground !== undefined;
  const hasStyleBg = style.background !== undefined;
  const propsBg = data.backgroundColor ? parseColor(data.backgroundColor) : undefined;

  // Render each terminal cell using corner values from the sub-sampled grid
  // The finer grid + area averaging improves scalar quality; marching squares runs on cell corners
  for (let ty = 0; ty < terminalHeight; ty++) {
    for (let tx = 0; tx < terminalWidth; tx++) {
      // Terminal cell corners in the sub-sampled grid
      const baseGx = tx * subSample;
      const baseGy = ty * subSample;

      // Get corner values for this terminal cell
      const tl = scalarGrid[baseGy][baseGx];
      const tr = scalarGrid[baseGy][baseGx + subSample];
      const bl = scalarGrid[baseGy + subSample][baseGx];
      const br = scalarGrid[baseGy + subSample][baseGx + subSample];

      let char: string | null = null;
      let fgColor: number | undefined;
      let bgColor: number | undefined;
      let autoFgNeeded = false;

      // Check each isoline (last one wins if multiple cross the cell)
      // Skip marching squares entirely when isolineColor='none'
      if (!isIsolineNone) {
        for (const isoline of isolines) {
          const caseNum = getMarchingSquaresCase(tl, tr, bl, br, isoline.value);
          const isoChar = getMarchingSquaresChar(caseNum);
          if (isoChar) {
            char = isoChar;
            if (isoline.color) {
              fgColor = parseColor(isoline.color);
              autoFgNeeded = false;
            } else if (isIsolineAuto) {
              autoFgNeeded = true;
            } else if (staticIsolineFg !== undefined) {
              fgColor = staticIsolineFg;
            } else {
              fgColor = hasStyleFg ? style.foreground : undefined;
            }
          }
        }
      }

      // Compute fill-derived color (used for background in filled mode, or auto contour color)
      let fillColor: number | undefined;
      if (filled || (autoFgNeeded && isIsolineAuto)) {
        if (fillMode === 'color-mean' && bandColors) {
          // Use precomputed mean color for the isoline band this cell falls into
          const avg = (tl + tr + bl + br) / 4;
          let band = isolines.length;
          for (let i = 0; i < isolines.length; i++) {
            if (avg < isolines[i].value) {
              band = i;
              break;
            }
          }
          if (bandColors[band] !== undefined) {
            fillColor = bandColors[band]!;
          }
        } else if (fillMode === 'color') {
          // Sample actual pixel colors from the buffer (same technique as renderBlockMode)
          const baseBufferX = tx * pixelsPerCellX;
          const baseBufferY = ty * pixelsPerCellY;
          const halfScale = data.scale >> 1;
          let totalR = 0, totalG = 0, totalB = 0, count = 0;
          for (let py = 0; py < 3; py++) {
            const bufferY = Math.min(baseBufferY + py * data.scale + halfScale, data.bufferHeight - 1);
            const rowOffset = bufferY * data.bufferWidth;
            for (let px = 0; px < 2; px++) {
              const bufferX = Math.min(baseBufferX + px * data.scale + halfScale, data.bufferWidth - 1);
              let color = data.colorBuffer[rowOffset + bufferX];
              if (color === TRANSPARENT) color = data.imageColorBuffer[rowOffset + bufferX];
              if (color !== TRANSPARENT) {
                totalR += (color >> 24) & 0xFF;
                totalG += (color >> 16) & 0xFF;
                totalB += (color >> 8) & 0xFF;
                count++;
              }
            }
          }
          if (count > 0) {
            fillColor = packRGBA(Math.round(totalR / count), Math.round(totalG / count), Math.round(totalB / count), 255);
          }
        } else {
          // 'source' mode: grayscale based on average scalar value
          const avg = (tl + tr + bl + br) / 4;
          const t = maxVal > minVal ? (avg - minVal) / (maxVal - minVal) : 0.5;
          const gray = Math.floor(64 + t * 128); // 64-192 range
          fillColor = packRGBA(gray, gray, gray, 255);
        }
      }

      if (filled) {
        bgColor = fillColor;
      }

      // Auto contour color: use fill-derived color for contour lines
      if (autoFgNeeded && fillColor !== undefined) {
        fgColor = fillColor;
      }

      // Only write cell if there's content
      if (char || (filled && bgColor)) {
        buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
          char: char ?? EMPTY_CHAR,
          foreground: fgColor,
          background: bgColor ?? propsBg ?? (hasStyleBg ? style.background : undefined),
          bold: style.bold,
          dim: style.dim,
        });
      }
    }
  }
}
