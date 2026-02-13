// Generic error-diffusion dithering engine
// All error-diffusion algorithms (Floyd-Steinberg, Atkinson, Sierra) share
// the same per-pixel loop: accumulate error → clamp → quantize → write → distribute.
// Only the error distribution kernel differs between algorithms.

import { quantizeChannel, rgbToGray } from './utils.ts';

/**
 * Error distribution kernel for an error-diffusion dithering algorithm.
 * Each offset defines where to spread a fraction of the quantization error.
 */
export interface DitherKernel {
  /** [dx, dy, weight] tuples. dx/dy relative to current pixel; weight is fraction of error. */
  readonly offsets: ReadonlyArray<readonly [dx: number, dy: number, weight: number]>;
  /** Maximum dy in offsets (determines number of row buffers: maxDy + 1). */
  readonly maxDy: number;
  /** Padding on each side of row buffers (must accommodate max |dx|). */
  readonly padding: number;
}

/** Clamp a value to [0, 255]. */
export function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// Reusable row buffers — grown on demand, never shrunk.
let _bufs: Float32Array[][] = [];
let _bufsSize = 0;
let _bufsRows = 0;

function getRowBuffers(numRows: number, bufSize: number): Float32Array[][] {
  if (_bufsRows < numRows || _bufsSize < bufSize) {
    _bufsRows = numRows;
    _bufsSize = bufSize;
    _bufs = [];
    for (let i = 0; i < numRows; i++) {
      _bufs.push([
        new Float32Array(bufSize),
        new Float32Array(bufSize),
        new Float32Array(bufSize),
      ]);
    }
  } else {
    // Clear only what we need
    for (let i = 0; i < numRows; i++) {
      _bufs[i][0].fill(0, 0, bufSize);
      _bufs[i][1].fill(0, 0, bufSize);
      _bufs[i][2].fill(0, 0, bufSize);
    }
  }
  return _bufs;
}

/**
 * Apply error-diffusion dithering using the given kernel.
 * Modifies frameData in place.
 *
 * @param frameData RGBA pixel data
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @param bits Bits per channel (1-8)
 * @param kernel Error distribution kernel
 * @param stable If true, vertical error (dy > 0) is multiplied by 0.5 for temporal stability
 */
export function applyErrorDiffusion(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number,
  kernel: DitherKernel,
  stable: boolean = false,
): void {
  bits = Math.max(1, Math.min(8, Math.round(bits)));
  const levels = 1 << bits;

  const { offsets, maxDy, padding } = kernel;
  const bufSize = width + padding;
  const halfPad = padding >> 1;
  const numRows = maxDy + 1;
  const DECAY = stable ? 0.5 : 1.0;

  const rows = getRowBuffers(numRows, bufSize);

  for (let y = 0; y < height; y++) {
    // Rotate row buffers: row[0] is consumed, move everything up, clear last
    if (y > 0) {
      const consumed = rows[0];
      for (let i = 0; i < numRows - 1; i++) {
        rows[i] = rows[i + 1];
      }
      rows[numRows - 1] = consumed;
      consumed[0].fill(0, 0, bufSize);
      consumed[1].fill(0, 0, bufSize);
      consumed[2].fill(0, 0, bufSize);
    }

    const curr0 = rows[0][0];
    const curr1 = rows[0][1];
    const curr2 = rows[0][2];

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const ex = x + halfPad;

      // Accumulate error
      let r = frameData[idx] + curr0[ex];
      let g = frameData[idx + 1] + curr1[ex];
      let b = frameData[idx + 2] + curr2[ex];

      // Clamp
      r = clamp255(r);
      g = clamp255(g);
      b = clamp255(b);

      // Quantize + calculate error
      let qr: number, qg: number, qb: number;
      let errR: number, errG: number, errB: number;

      if (bits === 1) {
        const gray = rgbToGray(r, g, b);
        const bw = gray >= 128 ? 255 : 0;
        qr = qg = qb = bw;
        errR = errG = errB = gray - bw;
      } else {
        qr = quantizeChannel(r, levels);
        qg = quantizeChannel(g, levels);
        qb = quantizeChannel(b, levels);
        errR = r - qr;
        errG = g - qg;
        errB = b - qb;
      }

      // Write quantized color back (alpha unchanged)
      frameData[idx] = qr;
      frameData[idx + 1] = qg;
      frameData[idx + 2] = qb;

      // Distribute error to neighbors
      for (let i = 0; i < offsets.length; i++) {
        const off = offsets[i];
        const w = off[2] * (off[1] > 0 ? DECAY : 1.0);
        const bx = ex + off[0];
        const buf = rows[off[1]];
        buf[0][bx] += errR * w;
        buf[1][bx] += errG * w;
        buf[2][bx] += errB * w;
      }
    }
  }
}
