// Shader animation runner for canvas component
// Uses shared state object for zero-overhead field access

import { packRGBA, unpackRGBA, TRANSPARENT } from './color-utils.ts';
import { shaderUtils, type ShaderResolution, type ShaderSource, type ShaderCallback } from './canvas-shader.ts';
import { getGlobalPerformanceDialog } from '../performance-dialog.ts';
import { getLogger } from '../logging.ts';
import type { Bounds } from '../types.ts';
import type { LoadedImage } from './canvas-image.ts';

const logger = getLogger('shader-runner');

/**
 * Shared state object for shader runner.
 * Canvas element owns this object, runner functions read/write directly.
 */
export interface ShaderState {
  // Timer management
  timer: number | null;
  startTime: number;
  lastFrameTime: number;
  frameInterval: number;
  finished: boolean;
  registeredId: string | null;

  // Resolution and aspect
  resolution: ShaderResolution;

  // Mouse tracking
  mouseX: number;
  mouseY: number;
  bounds: Bounds | null;

  // Source accessor (reused each frame)
  source: ShaderSource | null;

  // Output buffer (separate to avoid race conditions)
  outputBuffer: Uint32Array | null;

  // Permission warning flag
  permissionWarned: boolean;

  // Callbacks
  requestRender: (() => void) | null;
  requestCachedRender: (() => void) | null;
}

/**
 * Create initial shader state
 */
export function createShaderState(): ShaderState {
  return {
    timer: null,
    startTime: 0,
    lastFrameTime: 0,
    frameInterval: 33,
    finished: false,
    registeredId: null,
    resolution: { width: 0, height: 0, pixelAspect: 0.7 },
    mouseX: -1,
    mouseY: -1,
    bounds: null,
    source: null,
    outputBuffer: null,
    permissionWarned: false,
    requestRender: null,
    requestCachedRender: null,
  };
}

/**
 * Canvas context needed by shader runner
 */
export interface ShaderContext {
  // Buffer references (direct access)
  colorBuffer: Uint32Array;
  imageColorBuffer: Uint32Array;
  bufferWidth: number;
  bufferHeight: number;

  // Props
  onShader: ShaderCallback | undefined;
  shaderFps: number | undefined;
  shaderRunTime: number | undefined;
  id: string | undefined;

  // Methods
  getPixelAspectRatio: () => number;
  setDirty: () => void;

  // For _freezeShaderAsImage
  setLoadedImage: (img: LoadedImage) => void;
  previousColorBuffer: Uint32Array;
  invalidateDitherCache: () => void;

  // When true, shader runs synchronously during render() as post-processing over onPaint
  hasPaintHandler?: boolean;
}

/**
 * Start the shader animation loop
 */
export function startShader(
  state: ShaderState,
  ctx: ShaderContext,
  requestRender?: () => void,
  requestCachedRender?: () => void
): void {
  if (state.timer !== null) {
    return; // Already running
  }

  if (!ctx.onShader) {
    return; // No shader callback
  }

  // Check shader permission
  const engine = globalThis.melkerEngine;
  if (!engine || typeof engine.hasPermission !== 'function' || !engine.hasPermission('shader')) {
    if (!state.permissionWarned) {
      state.permissionWarned = true;
      logger.warn(`Shader blocked: requires policy with "shader": true permission.`);
    }
    return;
  }

  state.requestRender = requestRender ?? null;
  state.requestCachedRender = requestCachedRender ?? null;
  state.startTime = performance.now();
  state.finished = false;
  state.resolution = {
    width: ctx.bufferWidth,
    height: ctx.bufferHeight,
    pixelAspect: ctx.getPixelAspectRatio()
  };

  const fps = ctx.shaderFps ?? 30;
  state.frameInterval = Math.floor(1000 / fps);
  state.lastFrameTime = performance.now();

  // Register with performance dialog
  const shaderId = ctx.id ?? `shader_${Date.now()}`;
  state.registeredId = shaderId;
  const pixelCount = ctx.bufferWidth * ctx.bufferHeight;
  getGlobalPerformanceDialog().registerShader(shaderId, pixelCount);

  // Schedule first frame
  state.timer = setTimeout(() => {
    state.lastFrameTime = performance.now();
    runShaderFrame(state, ctx);
  }, 0);
}

/**
 * Schedule next shader frame
 */
function scheduleNextFrame(state: ShaderState, ctx: ShaderContext): void {
  if (state.timer === null) return;

  const now = performance.now();
  const elapsed = now - state.lastFrameTime;
  const delay = Math.max(0, state.frameInterval - elapsed);

  state.timer = setTimeout(() => {
    state.lastFrameTime = performance.now();
    runShaderFrame(state, ctx);
  }, delay);
}

/**
 * Stop the shader animation loop
 */
export function stopShader(state: ShaderState, ctx: ShaderContext): void {
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  if (state.registeredId !== null) {
    const pixelCount = ctx.bufferWidth * ctx.bufferHeight;
    getGlobalPerformanceDialog().unregisterShader(state.registeredId, pixelCount);
    state.registeredId = null;
  }
}

/**
 * Check if shader is running
 */
export function isShaderRunning(state: ShaderState): boolean {
  return state.timer !== null;
}

/**
 * Freeze current shader output as a LoadedImage
 */
function freezeShaderAsImage(state: ShaderState, ctx: ShaderContext): void {
  const bufW = ctx.bufferWidth;
  const bufH = ctx.bufferHeight;
  const bufferSize = bufW * bufH;

  // Convert color buffer to RGBA Uint8ClampedArray
  const rgbaData = new Uint8ClampedArray(bufferSize * 4);

  for (let i = 0; i < bufferSize; i++) {
    const color = ctx.colorBuffer[i];
    const rgba = unpackRGBA(color);
    const idx = i * 4;
    rgbaData[idx] = rgba.r;
    rgbaData[idx + 1] = rgba.g;
    rgbaData[idx + 2] = rgba.b;
    rgbaData[idx + 3] = rgba.a;
  }

  // Store as LoadedImage
  ctx.setLoadedImage({
    width: bufW,
    height: bufH,
    data: rgbaData,
    bytesPerPixel: 4,
  });

  // Copy to image buffer
  ctx.imageColorBuffer.set(ctx.colorBuffer);

  // Clear drawing layer
  ctx.colorBuffer.fill(TRANSPARENT);
  ctx.previousColorBuffer.fill(TRANSPARENT);

  // Invalidate dither cache
  ctx.invalidateDitherCache();

  logger.debug(`Shader frozen as ${bufW}x${bufH} image`);
}

/**
 * Run a single shader frame
 */
function runShaderFrame(state: ShaderState, ctx: ShaderContext): void {
  const shader = ctx.onShader;
  if (!shader) return;

  const bufW = ctx.bufferWidth;
  const bufH = ctx.bufferHeight;
  const bufferSize = bufW * bufH;
  const elapsedMs = performance.now() - state.startTime;
  const time = elapsedMs / 1000;

  // Check shaderRunTime limit
  if (ctx.shaderRunTime !== undefined && elapsedMs >= ctx.shaderRunTime) {
    freezeShaderAsImage(state, ctx);
    state.finished = true;
    stopShader(state, ctx);
    if (state.requestRender) {
      state.requestRender();
    }
    return;
  }

  // When onPaint coexists, the timer only drives animation timing.
  // The actual shader computation runs synchronously during render().
  if (ctx.hasPaintHandler) {
    scheduleNextFrame(state, ctx);
    if (state.requestRender) {
      state.requestRender();
    }
    return;
  }

  // Update resolution
  state.resolution.width = bufW;
  state.resolution.height = bufH;
  state.resolution.pixelAspect = ctx.getPixelAspectRatio();

  // Ensure output buffer exists
  if (!state.outputBuffer || state.outputBuffer.length !== bufferSize) {
    state.outputBuffer = new Uint32Array(bufferSize);
  }

  // Create source accessor
  const imageBuffer = ctx.imageColorBuffer;
  if (!state.source) {
    state.source = {
      hasImage: false,
      width: 0,
      height: 0,
      getPixel: (_x: number, _y: number) => null,
      mouse: { x: -1, y: -1 },
      mouseUV: { u: -1, v: -1 },
    };
  }

  // Update source properties
  state.source.hasImage = false; // Will be updated by canvas if needed
  state.source.width = bufW;
  state.source.height = bufH;

  // Update mouse position
  state.source.mouse.x = state.mouseX;
  state.source.mouse.y = state.mouseY;
  if (state.mouseX >= 0 && state.mouseY >= 0) {
    state.source.mouseUV.u = state.mouseX / bufW;
    state.source.mouseUV.v = state.mouseY / bufH;
  } else {
    state.source.mouseUV.u = -1;
    state.source.mouseUV.v = -1;
  }

  // getPixel function
  const source = state.source;
  source.getPixel = (px: number, py: number): [number, number, number, number] | null => {
    if (px < 0 || px >= bufW || py < 0 || py >= bufH) return null;
    const idx = py * bufW + px;
    const color = imageBuffer[idx];
    if (color === TRANSPARENT) return null;
    const rgba = unpackRGBA(color);
    return [rgba.r, rgba.g, rgba.b, rgba.a];
  };

  // Run shader for each pixel
  const shaderExecStart = performance.now();
  const colorBuffer = ctx.colorBuffer;

  for (let y = 0; y < bufH; y++) {
    for (let x = 0; x < bufW; x++) {
      const rgba = shader(x, y, time, state.resolution, source, shaderUtils);
      const r = Math.max(0, Math.min(255, Math.floor(rgba[0])));
      const g = Math.max(0, Math.min(255, Math.floor(rgba[1])));
      const b = Math.max(0, Math.min(255, Math.floor(rgba[2])));
      const a = rgba.length > 3 ? Math.max(0, Math.min(255, Math.floor((rgba as [number, number, number, number])[3]))) : 255;
      const color = a === 0 ? TRANSPARENT : packRGBA(r, g, b, a);
      const index = y * bufW + x;
      colorBuffer[index] = color;
    }
  }

  const shaderExecTime = performance.now() - shaderExecStart;
  getGlobalPerformanceDialog().recordShaderFrameTime(shaderExecTime);

  ctx.setDirty();

  // Schedule next frame
  scheduleNextFrame(state, ctx);

  // Request canvas-only render (skips layout) when available, fall back to full render
  if (state.requestCachedRender) {
    state.requestCachedRender();
  } else if (state.requestRender) {
    state.requestRender();
  }
}

/**
 * Run shader as a synchronous post-processing pass over onPaint output.
 * Called during render() when both onPaint and onShader are present.
 * Reads from paintSnapshot (copy of _colorBuffer after onPaint), writes to ctx.colorBuffer.
 */
export function runShaderPassSync(
  state: ShaderState,
  ctx: ShaderContext,
  paintSnapshot: Uint32Array
): void {
  const shader = ctx.onShader;
  if (!shader) return;

  const bufW = ctx.bufferWidth;
  const bufH = ctx.bufferHeight;
  const elapsedMs = performance.now() - state.startTime;
  const time = elapsedMs / 1000;

  // Update resolution
  state.resolution.width = bufW;
  state.resolution.height = bufH;
  state.resolution.pixelAspect = ctx.getPixelAspectRatio();

  // Create source accessor if needed
  if (!state.source) {
    state.source = {
      hasImage: false,
      width: 0,
      height: 0,
      getPixel: (_x: number, _y: number) => null,
      mouse: { x: -1, y: -1 },
      mouseUV: { u: -1, v: -1 },
    };
  }

  // Update source properties
  state.source.hasImage = true;
  state.source.width = bufW;
  state.source.height = bufH;

  // Update mouse position
  state.source.mouse.x = state.mouseX;
  state.source.mouse.y = state.mouseY;
  if (state.mouseX >= 0 && state.mouseY >= 0) {
    state.source.mouseUV.u = state.mouseX / bufW;
    state.source.mouseUV.v = state.mouseY / bufH;
  } else {
    state.source.mouseUV.u = -1;
    state.source.mouseUV.v = -1;
  }

  // getPixel reads from the paint snapshot (onPaint output), falling back to image buffer
  const imageBuffer = ctx.imageColorBuffer;
  const source = state.source;
  source.getPixel = (px: number, py: number): [number, number, number, number] | null => {
    if (px < 0 || px >= bufW || py < 0 || py >= bufH) return null;
    const idx = py * bufW + px;
    let color = paintSnapshot[idx];
    if (color === TRANSPARENT) color = imageBuffer[idx];
    if (color === TRANSPARENT) return null;
    const rgba = unpackRGBA(color);
    return [rgba.r, rgba.g, rgba.b, rgba.a];
  };

  // Run shader for each pixel, write directly to colorBuffer
  const shaderExecStart = performance.now();
  const colorBuffer = ctx.colorBuffer;

  for (let y = 0; y < bufH; y++) {
    for (let x = 0; x < bufW; x++) {
      const rgba = shader(x, y, time, state.resolution, source, shaderUtils);
      const r = Math.max(0, Math.min(255, Math.floor(rgba[0])));
      const g = Math.max(0, Math.min(255, Math.floor(rgba[1])));
      const b = Math.max(0, Math.min(255, Math.floor(rgba[2])));
      const a = rgba.length > 3 ? Math.max(0, Math.min(255, Math.floor((rgba as [number, number, number, number])[3]))) : 255;
      const color = a === 0 ? TRANSPARENT : packRGBA(r, g, b, a);
      const index = y * bufW + x;
      colorBuffer[index] = color;
    }
  }

  const shaderExecTime = performance.now() - shaderExecStart;
  getGlobalPerformanceDialog().recordShaderFrameTime(shaderExecTime);

  ctx.setDirty();
}

/**
 * Update shader mouse position from terminal coordinates
 */
export function updateShaderMouse(
  state: ShaderState,
  termX: number,
  termY: number,
  bufferWidth: number,
  bufferHeight: number
): void {
  if (!state.bounds) {
    state.mouseX = -1;
    state.mouseY = -1;
    return;
  }

  const bounds = state.bounds;

  if (termX < bounds.x || termX >= bounds.x + bounds.width ||
      termY < bounds.y || termY >= bounds.y + bounds.height) {
    state.mouseX = -1;
    state.mouseY = -1;
    return;
  }

  const localX = termX - bounds.x;
  const localY = termY - bounds.y;

  state.mouseX = Math.floor((localX / bounds.width) * bufferWidth);
  state.mouseY = Math.floor((localY / bounds.height) * bufferHeight);
}

/**
 * Clear shader mouse position
 */
export function clearShaderMouse(state: ShaderState): void {
  state.mouseX = -1;
  state.mouseY = -1;
}

/**
 * Get current shader mouse position
 */
export function getShaderMouse(state: ShaderState): { x: number; y: number } {
  return { x: state.mouseX, y: state.mouseY };
}
