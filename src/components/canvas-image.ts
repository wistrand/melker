// Image loading and decoding for canvas component
// Supports PNG, JPEG, and GIF formats

import { decodePng, decodeJpeg, GifReader } from '../deps.ts';

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
 * Detect image format from magic bytes
 */
export function detectImageFormat(bytes: Uint8Array): 'png' | 'jpeg' | 'gif' | null {
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
 * Decode image bytes (PNG, JPEG, or GIF) to LoadedImage format
 * Detects format automatically from magic bytes
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
    default:
      throw new Error('Unsupported image format. Supported: PNG, JPEG, GIF');
  }
}

/**
 * Load image from a file path, data URL, or HTTP/HTTPS URL
 */
export async function loadImageFromSource(src: string): Promise<Uint8Array> {
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

  // Handle HTTP/HTTPS URLs
  if (src.startsWith('http://') || src.startsWith('https://')) {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
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
    resolvedSrc = `${Deno.cwd()}/${src}`;
  }

  // Read the image file
  return await Deno.readFile(resolvedSrc);
}
