// Image loading, decoding, and rendering for canvas component
// Supports PNG, JPEG, GIF, and WebP formats

import { decodePng, decodeJpeg, GifReader, decodeWebp } from '../deps.ts';
import { getLogger } from '../logging.ts';
import { LRUCache } from '../lru-cache.ts';
import { TRANSPARENT, packRGBA, unpackRGBA, parseColor } from './color-utils.ts';
import { isUrl } from '../utils/content-loader.ts';
import { cwd, readFile } from '../runtime/mod.ts';

/**
 * Decoded image data in a standard format
 */
export interface LoadedImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;  // RGB or RGBA pixel data
  bytesPerPixel: number;    // 3 for RGB, 4 for RGBA
}

/**
 * Animated GIF data for frame-by-frame playback
 */
export interface GifAnimationData {
  reader: InstanceType<typeof GifReader>;
  frameCount: number;
  width: number;
  height: number;
  /** Per-frame delay in ms (from centiseconds in GIF spec) */
  delays: number[];
  loopCount: number | null;
}

const logger = getLogger("canvas-image");

/**
 * Detect image format from magic bytes
 */
export function detectImageFormat(bytes: Uint8Array): 'png' | 'jpeg' | 'gif' | 'webp' | null {
  // PNG magic: 0x89 0x50 0x4E 0x47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 &&
      bytes[2] === 0x4E && bytes[3] === 0x47) {
    return 'png';
  }
  // JPEG magic: 0xFF 0xD8 0xFF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'jpeg';
  }
  // GIF magic: GIF87a or GIF89a
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
      bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) &&
      bytes[5] === 0x61) {
    return 'gif';
  }
  // WebP magic: RIFF....WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'webp';
  }
  return null;
}

/**
 * Decode PNG image bytes to LoadedImage
 */
function decodePngImage(imageBytes: Uint8Array): LoadedImage {
  const decoded = decodePng(imageBytes) as {
    width: number;
    height: number;
    data: Uint8Array | Uint16Array;
    depth: number;
    channels: number;
    palette?: number[][];  // [[r,g,b], [r,g,b], ...] for indexed PNGs
  };

  const { width, height } = decoded;
  let rawData: Uint8Array;
  let pixelData: Uint8Array;
  let bytesPerPixel: number;

  // Handle 16-bit PNG by converting to 8-bit
  if (decoded.depth === 16) {
    const data16 = decoded.data as Uint16Array;
    rawData = new Uint8Array(data16.length);
    for (let i = 0; i < data16.length; i++) {
      rawData[i] = data16[i] >> 8; // Take high byte
    }
  } else {
    rawData = decoded.data as Uint8Array;
  }

  // Handle indexed/palette PNGs - expand palette to RGB
  if (decoded.palette && decoded.channels === 1) {
    const palette = decoded.palette;
    bytesPerPixel = 4;
    pixelData = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const colorIndex = rawData[i];
      const color = palette[colorIndex] || [0, 0, 0];
      pixelData[i * 4] = color[0];
      pixelData[i * 4 + 1] = color[1];
      pixelData[i * 4 + 2] = color[2];
      pixelData[i * 4 + 3] = 255;
    }
  } else if (decoded.channels === 1) {
    // Grayscale -> RGBA
    bytesPerPixel = 4;
    pixelData = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const gray = rawData[i];
      pixelData[i * 4] = gray;
      pixelData[i * 4 + 1] = gray;
      pixelData[i * 4 + 2] = gray;
      pixelData[i * 4 + 3] = 255;
    }
  } else if (decoded.channels === 2) {
    // Grayscale + Alpha -> RGBA
    bytesPerPixel = 4;
    pixelData = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const gray = rawData[i * 2];
      const alpha = rawData[i * 2 + 1];
      pixelData[i * 4] = gray;
      pixelData[i * 4 + 1] = gray;
      pixelData[i * 4 + 2] = gray;
      pixelData[i * 4 + 3] = alpha;
    }
  } else {
    // RGB (3) or RGBA (4) - use as-is
    bytesPerPixel = decoded.channels;
    pixelData = rawData;
  }

  return {
    width,
    height,
    data: new Uint8ClampedArray(pixelData),
    bytesPerPixel,
  };
}

/**
 * Decode JPEG image bytes to LoadedImage
 */
function decodeJpegImage(imageBytes: Uint8Array): LoadedImage {
  const decoded = decodeJpeg(imageBytes, { useTArray: true, formatAsRGBA: true });
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
    bytesPerPixel: 4, // jpeg-js with formatAsRGBA always gives RGBA
  };
}

/**
 * Decode GIF image bytes to LoadedImage (first frame only)
 */
function decodeGifImage(imageBytes: Uint8Array): LoadedImage {
  const gifReader = new GifReader(imageBytes);
  const width = gifReader.width;
  const height = gifReader.height;
  const pixelData = new Uint8Array(width * height * 4);
  gifReader.decodeAndBlitFrameRGBA(0, pixelData); // Decode first frame

  return {
    width,
    height,
    data: new Uint8ClampedArray(pixelData),
    bytesPerPixel: 4, // GIF decoder outputs RGBA
  };
}

/**
 * Try to parse GIF animation data from image bytes.
 * Returns null if not a GIF or single-frame.
 */
export function tryParseGifAnimation(imageBytes: Uint8Array): GifAnimationData | null {
  if (detectImageFormat(imageBytes) !== 'gif') return null;
  const reader = new GifReader(imageBytes);
  const frameCount = reader.numFrames();
  if (frameCount <= 1) return null;

  const delays: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    const info = reader.frameInfo(i);
    // GIF delay is in centiseconds; 0 means "use default" (~100ms)
    delays.push(info.delay > 0 ? info.delay * 10 : 100);
  }

  return {
    reader,
    frameCount,
    width: reader.width,
    height: reader.height,
    delays,
    loopCount: reader.loopCount(),
  };
}

/**
 * Decode a specific GIF frame to LoadedImage.
 * Handles disposal by compositing onto the provided previousPixels buffer.
 */
export function decodeGifFrame(anim: GifAnimationData, frameIndex: number, compositeBuffer: Uint8Array): LoadedImage {
  anim.reader.decodeAndBlitFrameRGBA(frameIndex, compositeBuffer);
  return {
    width: anim.width,
    height: anim.height,
    data: new Uint8ClampedArray(compositeBuffer),
    bytesPerPixel: 4,
  };
}

/**
 * Decode WebP image bytes to LoadedImage (async - WASM decoder)
 */
async function decodeWebpImage(imageBytes: Uint8Array): Promise<LoadedImage> {
  const buffer = imageBytes.buffer instanceof ArrayBuffer
    ? imageBytes.buffer
    : new ArrayBuffer(imageBytes.byteLength);
  if (!(imageBytes.buffer instanceof ArrayBuffer)) {
    new Uint8Array(buffer).set(imageBytes);
  }
  const decoded = await decodeWebp(buffer) as unknown as { width: number; height: number; data: Uint8ClampedArray };
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
    bytesPerPixel: 4, // @jsquash/webp outputs RGBA
  };
}

/**
 * Decode image bytes (PNG, JPEG, or GIF) to LoadedImage format (sync).
 * For WebP, use decodeImageBytesAsync().
 * Detects format automatically from magic bytes.
 */
export function decodeImageBytes(imageBytes: Uint8Array): LoadedImage {
  const format = detectImageFormat(imageBytes);

  switch (format) {
    case 'png':
      return decodePngImage(imageBytes);
    case 'jpeg':
      return decodeJpegImage(imageBytes);
    case 'gif':
      return decodeGifImage(imageBytes);
    case 'webp':
      throw new Error('WebP decoding is async. Use decodeImageBytesAsync() or canvas.loadImage()/loadImageFromBytes().');
    default:
      throw new Error('Unsupported image format. Supported: PNG, JPEG, GIF, WebP');
  }
}

/**
 * Decode image bytes (PNG, JPEG, GIF, or WebP) to LoadedImage format (async).
 * Supports all formats including WebP.
 */
export async function decodeImageBytesAsync(imageBytes: Uint8Array): Promise<LoadedImage> {
  const format = detectImageFormat(imageBytes);

  switch (format) {
    case 'png':
      return decodePngImage(imageBytes);
    case 'jpeg':
      return decodeJpegImage(imageBytes);
    case 'gif':
      return decodeGifImage(imageBytes);
    case 'webp':
      return decodeWebpImage(imageBytes);
    default:
      throw new Error('Unsupported image format. Supported: PNG, JPEG, GIF, WebP');
  }
}

// Cache for fetched images (HTTP/HTTPS URLs only)
// Stores Promises to handle concurrent requests for the same URL
// Uses LRU eviction when max size is exceeded
const imageCache = new LRUCache<string, Promise<Uint8Array>>(50);

/**
 * Clear the image cache
 */
export function clearImageCache(): void {
  imageCache.clear();
  logger.debug('image cache cleared');
}

/**
 * Fetch image from URL (internal, used by cache)
 */
async function fetchImageBytes(url: string): Promise<Uint8Array> {
  logger.debug("fetch image " + url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Load image from a file path, data URL, or HTTP/HTTPS URL
 */
export async function loadImageFromSource(src: string): Promise<Uint8Array> {

  logger.debug("loadImageFromSource path " + src);

  // Handle data: URLs (inline base64-encoded images)
  if (src.startsWith('data:')) {
    // Parse data URL: data:[<mediatype>][;base64],<data>
    const match = src.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
    if (!match) {
      throw new Error('Invalid data URL format');
    }
    const base64Data = match[2];
    // Decode base64 to binary
    const binaryString = atob(base64Data);
    const imageBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      imageBytes[i] = binaryString.charCodeAt(i);
    }
    return imageBytes;
  }

  // Handle HTTP/HTTPS URLs (with caching)
  if (isUrl(src)) {
    // Check cache first - cache stores Promises to handle concurrent requests
    // LRUCache.get() automatically updates LRU order
    const cached = imageCache.get(src);
    if (cached) {
      logger.debug('image cache hit: ' + src);
      const bytes = await cached;
      return new Uint8Array(bytes); // Return a copy
    }

    // Create and cache the fetch Promise immediately to prevent race conditions
    // LRUCache.set() automatically evicts oldest entries if over max size
    const fetchPromise = fetchImageBytes(src);
    imageCache.set(src, fetchPromise);

    try {
      const bytes = await fetchPromise;
      return new Uint8Array(bytes); // Return a copy
    } catch (error) {
      // Remove from cache on error so retry is possible
      imageCache.delete(src);
      throw error;
    }
  }

  // Resolve the path for file reading
  let resolvedSrc: string;
  if (src.startsWith('file://')) {
    // Handle file:// URLs - extract the path
    resolvedSrc = new URL(src).pathname;
  } else if (src.startsWith('/')) {
    // Absolute path
    resolvedSrc = src;
  } else {
    // Relative path - resolve from cwd
    resolvedSrc = `${cwd()}/${src}`;

    logger.debug("relative path " + src  + " -> " + resolvedSrc);
  }

  // Read the image file
  return await readFile(resolvedSrc);
}

// ============================================
// Image Rendering to Buffer
// ============================================

/**
 * Object fit modes for image rendering
 */
export type ObjectFit = 'contain' | 'fill' | 'cover';

/**
 * Data needed for image rendering calculations
 */
export interface ImageRenderConfig {
  bufferWidth: number;
  bufferHeight: number;
  pixelAspectRatio: number;
  objectFit: ObjectFit;
  backgroundColor?: number | string;
}

/**
 * Result of image scaling calculation
 */
export interface ImageScaleResult {
  scaledWidth: number;
  scaledHeight: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Calculate image scaling dimensions based on objectFit mode
 */
export function calculateImageScaling(
  image: LoadedImage,
  config: ImageRenderConfig
): ImageScaleResult {
  const { bufferWidth, bufferHeight, pixelAspectRatio, objectFit } = config;
  const visualBufW = bufferWidth * pixelAspectRatio;

  let scaledW: number;
  let scaledH: number;
  let offsetX: number;
  let offsetY: number;

  if (objectFit === 'fill') {
    // Stretch to fill entire buffer (may distort aspect ratio)
    scaledW = bufferWidth;
    scaledH = bufferHeight;
    offsetX = 0;
    offsetY = 0;
  } else if (objectFit === 'cover') {
    // Scale to cover entire buffer, cropping if needed
    const scaleX = visualBufW / image.width;
    const scaleY = bufferHeight / image.height;
    const scale = Math.max(scaleX, scaleY);
    scaledW = Math.floor(image.width * scale / pixelAspectRatio);
    scaledH = Math.floor(image.height * scale);
    // Center the crop
    offsetX = Math.floor((bufferWidth - scaledW) / 2);
    offsetY = Math.floor((bufferHeight - scaledH) / 2);
  } else {
    // 'contain' - fit while maintaining aspect ratio, center
    const scaleX = visualBufW / image.width;
    const scaleY = bufferHeight / image.height;
    const scale = Math.min(scaleX, scaleY);
    scaledW = Math.floor(image.width * scale / pixelAspectRatio);
    scaledH = Math.floor(image.height * scale);
    // Center the image
    offsetX = Math.floor((bufferWidth - scaledW) / 2);
    offsetY = Math.floor((bufferHeight - scaledH) / 2);
  }

  return {
    scaledWidth: scaledW,
    scaledHeight: scaledH,
    offsetX,
    offsetY,
  };
}

/**
 * Scale image to a temporary RGBA buffer using nearest neighbor sampling
 */
export function scaleImageToBuffer(
  image: LoadedImage,
  scaledWidth: number,
  scaledHeight: number
): Uint8Array {
  const scaledData = new Uint8Array(scaledWidth * scaledHeight * 4);
  const bpp = image.bytesPerPixel;

  for (let y = 0; y < scaledHeight; y++) {
    for (let x = 0; x < scaledWidth; x++) {
      // Map buffer coordinates to image coordinates
      const imgX = (x / scaledWidth) * image.width;
      const imgY = (y / scaledHeight) * image.height;

      // Nearest neighbor sampling
      const srcX = Math.floor(imgX);
      const srcY = Math.floor(imgY);

      // Get pixel color from image (using correct bytes per pixel)
      const srcIdx = (srcY * image.width + srcX) * bpp;
      const dstIdx = (y * scaledWidth + x) * 4;

      scaledData[dstIdx] = image.data[srcIdx];         // R
      scaledData[dstIdx + 1] = image.data[srcIdx + 1]; // G
      scaledData[dstIdx + 2] = image.data[srcIdx + 2]; // B
      // Alpha: use from data if RGBA, otherwise assume fully opaque
      scaledData[dstIdx + 3] = bpp === 4 ? image.data[srcIdx + 3] : 255;
    }
  }

  return scaledData;
}

/**
 * Render scaled RGBA data to the image color buffer with alpha blending
 */
export function renderScaledDataToBuffer(
  scaledData: Uint8Array,
  scaledWidth: number,
  scaledHeight: number,
  offsetX: number,
  offsetY: number,
  imageColorBuffer: Uint32Array,
  bufferWidth: number,
  bufferHeight: number,
  backgroundColor?: number | string
): void {
  // Get background color for alpha blending (default to black if not specified)
  let bgR = 0, bgG = 0, bgB = 0;
  if (backgroundColor) {
    const bgPacked = parseColor(backgroundColor);
    if (bgPacked !== undefined) {
      const bg = unpackRGBA(bgPacked);
      bgR = bg.r;
      bgG = bg.g;
      bgB = bg.b;
    }
  }

  // Render the scaled data to the buffer
  for (let y = 0; y < scaledHeight; y++) {
    for (let x = 0; x < scaledWidth; x++) {
      const srcIdx = (y * scaledWidth + x) * 4;
      let r = scaledData[srcIdx];
      let g = scaledData[srcIdx + 1];
      let b = scaledData[srcIdx + 2];
      const a = scaledData[srcIdx + 3];

      // Skip fully transparent pixels (alpha < 128)
      if (a < 128) continue;

      // Pre-blend semi-transparent pixels with background color
      // (Terminal cells can't do true alpha blending)
      if (a < 255) {
        const alpha = a / 255;
        const invAlpha = 1 - alpha;
        r = Math.round(r * alpha + bgR * invAlpha);
        g = Math.round(g * alpha + bgG * invAlpha);
        b = Math.round(b * alpha + bgB * invAlpha);
      }

      // Set the pixel in the image background buffer (now fully opaque)
      const bufX = offsetX + x;
      const bufY = offsetY + y;

      if (bufX >= 0 && bufX < bufferWidth && bufY >= 0 && bufY < bufferHeight) {
        const index = bufY * bufferWidth + bufX;
        imageColorBuffer[index] = packRGBA(r, g, b, 255);
      }
    }
  }
}

/**
 * Full image rendering pipeline: scale, then render to buffer.
 * For simple cases without filters or dithering.
 */
export function renderImageToBuffer(
  image: LoadedImage,
  imageColorBuffer: Uint32Array,
  config: ImageRenderConfig
): { scaledData: Uint8Array; scaling: ImageScaleResult } {
  // Clear the image buffer
  imageColorBuffer.fill(TRANSPARENT);

  // Calculate scaling
  const scaling = calculateImageScaling(image, config);

  // Scale image to temp buffer
  const scaledData = scaleImageToBuffer(image, scaling.scaledWidth, scaling.scaledHeight);

  // Render to image buffer (caller may want to apply filters/dithering to scaledData first)
  renderScaledDataToBuffer(
    scaledData,
    scaling.scaledWidth,
    scaling.scaledHeight,
    scaling.offsetX,
    scaling.offsetY,
    imageColorBuffer,
    config.bufferWidth,
    config.bufferHeight,
    config.backgroundColor
  );

  return { scaledData, scaling };
}
