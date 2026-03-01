// Canvas render graphics - sixel, kitty, and iTerm2 protocol handlers
// Extracted from canvas-render.ts for modularity

import { type DualBuffer, type Cell } from '../buffer.ts';
import { type Bounds } from '../types.ts';
import { TRANSPARENT, packRGBA, parseColor } from './color-utils.ts';
import {
  encodeToSixel,
  positionedSixel,
  quantizePalette,
  type PaletteMode,
  type SixelCapabilities,
} from '../sixel/mod.ts';
import {
  encodeToKitty,
  positionedKitty,
  type KittyCapabilities,
} from '../kitty/mod.ts';
import {
  encodeToITerm2,
  positionedITerm2,
  type ITermCapabilities,
} from '../iterm2/mod.ts';
import {
  applyFloydSteinbergDither,
  applyFloydSteinbergStableDither,
  applyAtkinsonDither,
  applyAtkinsonStableDither,
  applyBlueNoiseDither,
  applyOrderedDither,
  applySierraDither,
  applySierraStableDither,
  type DitherMode,
} from '../video/dither.ts';
import { getGlobalEngine } from '../global-accessors.ts';
import type { CanvasRenderData, CanvasRenderState, SixelOutputData, KittyOutputData, ITermOutputData } from './canvas-render-types.ts';

/**
 * Graphics placeholder: fills region with dots so buffer content doesn't flash before graphics overlay.
 * The overlay (sixel/kitty/iTerm2) is drawn AFTER buffer output, covering whatever the buffer shows.
 */
export function renderGraphicsPlaceholder(
  bounds: Bounds,
  style: Partial<Cell>,
  buffer: DualBuffer,
  terminalWidth: number,
  terminalHeight: number,
  data: CanvasRenderData
): void {
  // Use style background, props background, or transparent
  const hasStyleBg = style.background !== undefined;
  const propsBg = data.backgroundColor ? parseColor(data.backgroundColor) : undefined;
  const bgColor = hasStyleBg ? style.background : (propsBg ?? TRANSPARENT);

  for (let ty = 0; ty < terminalHeight; ty++) {
    for (let tx = 0; tx < terminalWidth; tx++) {
      buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
        char: '.',
        foreground: bgColor !== TRANSPARENT ? bgColor : 0x666666FF,
        background: TRANSPARENT,
      });
    }
  }
}

export { renderGraphicsPlaceholder as renderSixelPlaceholder };
export { renderGraphicsPlaceholder as renderKittyPlaceholder };
export { renderGraphicsPlaceholder as renderITermPlaceholder };

/**
 * Scale pixel buffer using nearest-neighbor interpolation.
 * Fast and preserves hard edges.
 */
function scalePixelBuffer(
  src: Uint32Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): Uint32Array {
  const dst = new Uint32Array(dstWidth * dstHeight);

  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;

  for (let y = 0; y < dstHeight; y++) {
    const srcY = Math.floor(y * yRatio);
    const srcRowOffset = srcY * srcWidth;
    const dstRowOffset = y * dstWidth;

    for (let x = 0; x < dstWidth; x++) {
      const srcX = Math.floor(x * xRatio);
      dst[dstRowOffset + x] = src[srcRowOffset + srcX];
    }
  }

  return dst;
}

/**
 * Composite drawing layer over image layer with background fill.
 * Shared by sixel, kitty, and iTerm2 output generators.
 */
export function compositeBuffers(
  data: CanvasRenderData,
  target?: Uint32Array,
): { composited: Uint32Array; hasContent: boolean } {
  const pixelCount = data.bufferWidth * data.bufferHeight;
  const composited = target && target.length >= pixelCount ? target : new Uint32Array(pixelCount);
  let hasContent = false;
  const bgColor = data.backgroundColor ? (parseColor(data.backgroundColor) ?? TRANSPARENT) : TRANSPARENT;
  for (let i = 0; i < pixelCount; i++) {
    const drawColor = data.colorBuffer[i];
    const imageColor = data.imageColorBuffer[i];
    if (drawColor !== TRANSPARENT) {
      composited[i] = drawColor;
      hasContent = true;
    } else if (imageColor !== TRANSPARENT) {
      composited[i] = imageColor;
      hasContent = true;
    } else {
      composited[i] = bgColor;
    }
  }
  return { composited, hasContent };
}

/**
 * Prepare common graphics input: capability check, composite buffers, terminal dimensions.
 * Shared by sixel, kitty, and iTerm2 generators to eliminate duplicated setup code.
 */
function prepareGraphicsInput(
  bounds: Bounds,
  data: CanvasRenderData,
  supported: boolean,
  target?: Uint32Array,
): { composited: Uint32Array; terminalWidth: number; terminalHeight: number } | null {
  if (!supported) return null;

  const { composited, hasContent } = compositeBuffers(data, target);
  if (!hasContent) return null;

  let terminalWidth = Math.min(data.propsWidth, bounds.width);
  const terminalHeight = Math.min(data.propsHeight, bounds.height);

  // Workaround for terminal edge rendering glitch
  const engine = getGlobalEngine();
  if (engine && bounds.x + terminalWidth >= engine.terminalSize?.width) {
    terminalWidth = Math.max(1, terminalWidth - 1);
  }

  return { composited, terminalWidth, terminalHeight };
}

/**
 * Generate sixel output from canvas data.
 * Returns positioned sixel sequence ready to write to terminal.
 * Scales image to fill the terminal cell area at full pixel resolution.
 *
 * @param ditherMode - Optional dithering mode to apply before quantization.
 *                     Reduces color banding for dynamic content (onPaint/onShader/onFilter).
 * @param ditherBits - Bits per channel for dithering (default 3 = 8 levels per channel).
 */
export function generateSixelOutput(
  bounds: Bounds,
  data: CanvasRenderData,
  capabilities: SixelCapabilities,
  paletteMode: PaletteMode = 'cached',
  cacheKey?: string,
  ditherMode?: DitherMode | false,
  ditherBits?: number
): SixelOutputData | null {
  const prepared = prepareGraphicsInput(bounds, data, capabilities.supported);
  if (!prepared) return null;

  const { composited, terminalWidth, terminalHeight } = prepared;

  const rawTargetWidth = terminalWidth * capabilities.cellWidth;
  const rawTargetHeight = terminalHeight * capabilities.cellHeight;

  // Round height DOWN to nearest multiple of 6 (sixel row height)
  // This ensures the sixel doesn't extend beyond the intended cell bounds
  // Without this, ceil(height/6)*6 pixels would be rendered, potentially
  // bleeding into the next row of terminal cells
  const targetWidth = rawTargetWidth;
  const targetHeight = Math.floor(rawTargetHeight / 6) * 6;

  // Scale composited buffer to target size if different
  let scaledBuffer: Uint32Array = composited;
  let finalWidth = data.bufferWidth;
  let finalHeight = data.bufferHeight;

  if (targetWidth !== data.bufferWidth || targetHeight !== data.bufferHeight) {
    scaledBuffer = scalePixelBuffer(
      composited,
      data.bufferWidth,
      data.bufferHeight,
      targetWidth,
      targetHeight
    ) as Uint32Array;
    finalWidth = targetWidth;
    finalHeight = targetHeight;
  }

  // Apply dithering before quantization (reduces color banding for dynamic content)
  if (ditherMode && ditherMode !== 'none') {
    const bits = ditherBits ?? 3;  // 3 bits = 8 levels per channel
    const pixelCount = finalWidth * finalHeight;

    // Convert Uint32Array (packed RGBA) to Uint8Array (interleaved RGBA) for dithering
    const rgba = new Uint8Array(pixelCount * 4);
    for (let i = 0; i < pixelCount; i++) {
      const c = scaledBuffer[i];
      rgba[i * 4] = (c >>> 24) & 0xff;      // R
      rgba[i * 4 + 1] = (c >>> 16) & 0xff;  // G
      rgba[i * 4 + 2] = (c >>> 8) & 0xff;   // B
      rgba[i * 4 + 3] = c & 0xff;           // A
    }

    // Apply selected dither algorithm
    switch (ditherMode) {
      case 'ordered':
        applyOrderedDither(rgba, finalWidth, finalHeight, bits);
        break;
      case 'floyd-steinberg':
        applyFloydSteinbergDither(rgba, finalWidth, finalHeight, bits);
        break;
      case 'floyd-steinberg-stable':
        applyFloydSteinbergStableDither(rgba, finalWidth, finalHeight, bits);
        break;
      case 'sierra':
        applySierraDither(rgba, finalWidth, finalHeight, bits);
        break;
      case 'sierra-stable':
        applySierraStableDither(rgba, finalWidth, finalHeight, bits);
        break;
      case 'atkinson':
        applyAtkinsonDither(rgba, finalWidth, finalHeight, bits);
        break;
      case 'atkinson-stable':
        applyAtkinsonStableDither(rgba, finalWidth, finalHeight, bits);
        break;
      case 'blue-noise':
      default:
        applyBlueNoiseDither(rgba, finalWidth, finalHeight, bits);
        break;
    }

    // Convert back to Uint32Array (packed RGBA)
    for (let i = 0; i < pixelCount; i++) {
      scaledBuffer[i] = packRGBA(
        rgba[i * 4],
        rgba[i * 4 + 1],
        rgba[i * 4 + 2],
        rgba[i * 4 + 3]
      );
    }
  }

  // Quantize to palette
  // Use 255 max - some terminals (Konsole) have issues with color index 255
  const maxColors = Math.min(capabilities.colorRegisters, 255);
  const paletteResult = quantizePalette(scaledBuffer, paletteMode, maxColors, cacheKey);

  // Skip if palette is empty (shouldn't happen if hasContent, but safety check)
  if (paletteResult.colors.length === 0) {
    return null;
  }

  // Encode to sixel
  const sixelOutput = encodeToSixel({
    palette: paletteResult.colors,
    indexed: paletteResult.indexed,
    width: finalWidth,
    height: finalHeight,
    transparentIndex: paletteResult.transparentIndex,
    useRLE: true,
  });

  // Position at canvas bounds
  const positioned = positionedSixel(sixelOutput.data, bounds.x, bounds.y);

  // Return bounds that reflect actual sixel coverage (may be smaller than layout bounds)
  return {
    data: positioned,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: terminalWidth,
      height: terminalHeight,
    },
  };
}

/**
 * Generate Kitty graphics output from canvas data.
 * Returns positioned Kitty sequence ready to write to terminal.
 * Simpler than sixel - no quantization needed, supports full 32-bit RGBA.
 */
export function generateKittyOutput(
  bounds: Bounds,
  data: CanvasRenderData,
  capabilities: KittyCapabilities,
  renderState?: CanvasRenderState,
): KittyOutputData | null {
  const target = renderState?.kittyCache.getCompositedBuffer(data.bufferWidth * data.bufferHeight);
  const prepared = prepareGraphicsInput(bounds, data, capabilities.supported, target);
  if (!prepared) return null;

  const { composited, terminalWidth, terminalHeight } = prepared;

  // Check cache if render state available
  if (renderState) {
    const pixelCount = data.bufferWidth * data.bufferHeight;
    const contentHash = renderState.computeBufferHash(composited, pixelCount);
    const targetBounds = { x: bounds.x, y: bounds.y, width: terminalWidth, height: terminalHeight };

    const cached = renderState.kittyCache.getCachedOutput(contentHash, targetBounds);
    if (cached) {
      // Cache hit - return existing output with fromCache flag
      // Engine will skip writing to terminal (image already displayed)
      return { ...cached, fromCache: true };
    }

    // Cache miss - encode and store using stable image ID
    // Stable ID enables in-place replacement, eliminating display+delete flicker
    const kittyOutput = encodeToKitty({
      pixels: composited,
      width: data.bufferWidth,
      height: data.bufferHeight,
      format: 'rgba',
      columns: terminalWidth,
      rows: terminalHeight,
      imageId: renderState.getKittyStableImageId(),
    });

    const positioned = positionedKitty(kittyOutput, bounds.x + 1, bounds.y + 1);

    const output: KittyOutputData = {
      data: positioned,
      bounds: targetBounds,
      imageId: kittyOutput.imageId,
    };

    renderState.kittyCache.setCachedOutput(contentHash, targetBounds, output);
    return output;
  }

  // No render state - encode without caching (fallback path)
  const kittyOutput = encodeToKitty({
    pixels: composited,
    width: data.bufferWidth,
    height: data.bufferHeight,
    format: 'rgba',
    columns: terminalWidth,
    rows: terminalHeight,
  });

  // Position at canvas bounds (col and row are 1-based for ANSI cursor)
  const positioned = positionedKitty(kittyOutput, bounds.x + 1, bounds.y + 1);

  return {
    data: positioned,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: terminalWidth,
      height: terminalHeight,
    },
    imageId: kittyOutput.imageId,
  };
}


/**
 * Generate iTerm2 graphics output from canvas data.
 * Returns positioned iTerm2 sequence ready to write to terminal.
 * Uses pixel dimensions for display size to ensure correct aspect ratio.
 */
export function generateITerm2Output(
  bounds: Bounds,
  data: CanvasRenderData,
  capabilities: ITermCapabilities,
  renderState?: CanvasRenderState,
): ITermOutputData | null {
  const target = renderState?.itermCache.getCompositedBuffer(data.bufferWidth * data.bufferHeight);
  const prepared = prepareGraphicsInput(bounds, data, capabilities.supported, target);
  if (!prepared) return null;

  const { composited, terminalWidth, terminalHeight } = prepared;

  // Get cell dimensions from sixel capabilities (detected via terminal query)
  // Fall back to common defaults if not available
  const engine = getGlobalEngine();
  const cellWidth = engine?.sixelCapabilities?.cellWidth || 8;
  const cellHeight = engine?.sixelCapabilities?.cellHeight || 16;

  // Calculate target pixel dimensions for display
  // Use "Npx" format to tell iTerm2 exact pixel size (ensures correct aspect ratio)
  const displayWidthPx = `${terminalWidth * cellWidth}px`;
  const displayHeightPx = `${terminalHeight * cellHeight}px`;

  // Check cache if render state available
  if (renderState) {
    const pixelCount = data.bufferWidth * data.bufferHeight;
    const contentHash = renderState.computeBufferHash(composited, pixelCount);
    const targetBounds = { x: bounds.x, y: bounds.y, width: terminalWidth, height: terminalHeight };

    const cached = renderState.itermCache.getCachedOutput(contentHash, targetBounds);
    if (cached) {
      // Cache hit - return existing output with fromCache flag
      return { ...cached, fromCache: true };
    }

    // Cache miss - encode and store
    // Pass original buffer, let iTerm2 scale to pixel dimensions
    const itermOutput = encodeToITerm2({
      pixels: composited,
      width: data.bufferWidth,
      height: data.bufferHeight,
      displayWidth: displayWidthPx,
      displayHeight: displayHeightPx,
      preserveAspectRatio: false,  // We specify exact dimensions
      useMultipart: capabilities.useMultipart,
    });

    // Position at canvas bounds (col and row are 1-based for ANSI cursor)
    const positioned = positionedITerm2(itermOutput, bounds.x + 1, bounds.y + 1);

    const output: ITermOutputData = {
      data: positioned,
      bounds: targetBounds,
    };

    renderState.itermCache.setCachedOutput(contentHash, targetBounds, output);
    return output;
  }

  // No render state - encode without caching (fallback path)
  const itermOutput = encodeToITerm2({
    pixels: composited,
    width: data.bufferWidth,
    height: data.bufferHeight,
    displayWidth: displayWidthPx,
    displayHeight: displayHeightPx,
    preserveAspectRatio: false,  // We specify exact dimensions
    useMultipart: capabilities.useMultipart,
  });

  // Position at canvas bounds (col and row are 1-based for ANSI cursor)
  const positioned = positionedITerm2(itermOutput, bounds.x + 1, bounds.y + 1);

  return {
    data: positioned,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: terminalWidth,
      height: terminalHeight,
    },
  };
}
